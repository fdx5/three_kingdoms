/**
 * 스핀다운 방지 — 자기 자신을 주기적으로 두드린다.
 *
 * 왜 필요한가
 * ----------
 * render.com 무료 플랜은 **15분 동안 들어오는 요청이 없으면 인스턴스를 재운다.**
 * 다음 사람이 들어오면 다시 깨는데, 콜드 스타트가 30초~1분이라 그동안 게임이
 * 아예 안 열린다. "서버가 15분마다 죽는다"로 보이는 것이 이것이다 — 크래시가
 * 아니라 재우는 것이라 로그에도 오류가 안 남는다.
 *
 * 재우는 기준은 **밖에서 들어온 트래픽**이다. 그래서 자기 공개 주소로 요청을
 * 보내면(밖으로 나갔다가 로드밸런서를 거쳐 다시 들어온다) 깨어 있는 것으로 친다.
 *
 * 이것만으로 충분하지 않은 이유
 * --------------------------
 * 이미 잠든 인스턴스는 스스로를 깨울 수 없다(타이머도 같이 멈춘다). 배포 교체나
 * 재시작으로 한 번 끊기면 그 뒤로는 영영 잠들어 있다. 그래서 바깥에서 두드리는
 * 것이 따로 있어야 한다 — .github/workflows/keepalive.yml 이 그 몫을 한다.
 * 둘은 서로를 보완한다. 이쪽은 시각이 정확하고, 저쪽은 잠든 것을 깨울 수 있다.
 *
 * 750시간 문제
 * -----------
 * 무료 플랜은 계정 전체에서 월 750 인스턴스시간을 쓴다. 하루도 안 쉬고 켜 두면
 * 31일 달이 744시간이라 **웹 서비스 하나면 겨우 들어간다.** 무료 서비스를 하나
 * 더 올리는 순간 월말에 둘 다 멈추므로, 그때는 KEEPALIVE=off 로 끄거나 유료
 * 플랜으로 옮겨야 한다.
 *
 * 환경변수
 *   RENDER_EXTERNAL_URL  render.com 이 자동으로 넣어 준다. 이게 있어야 켜진다
 *   KEEPALIVE_URL        직접 지정할 때 (다른 호스팅·로컬 실험)
 *   KEEPALIVE            'off' / '0' / 'false' 면 끈다
 *   KEEPALIVE_MINUTES    간격(분). 기본 10 — 15분 창을 한 번 놓쳐도 여유가 있다
 */

/** 재우는 기준이 15분이다. 한 번 실패해도 다음 차례가 창 안에 들어오게 잡는다. */
const DEFAULT_MINUTES = 10;

export interface KeepAlivePlan {
  /** 두드릴 주소. null 이면 켜지 않는다 */
  url: string | null;
  /** 간격(밀리초) */
  intervalMs: number;
  /** 켜지 않는 경우 그 이유 — 기동 로그에 그대로 찍는다 */
  reason: string;
}

/**
 * 무엇을 할지 환경변수만 보고 정한다.
 *
 * 순수 함수로 떼어 둔 이유는 이 판단이 틀리면 조용히 아무 일도 안 일어나기
 * 때문이다(스핀다운은 로그를 안 남긴다). 테스트가 여기를 본다.
 */
export function planKeepAlive(env: NodeJS.ProcessEnv = process.env): KeepAlivePlan {
  const off = (env.KEEPALIVE ?? '').trim().toLowerCase();
  const minutes = Number.parseFloat((env.KEEPALIVE_MINUTES ?? '').trim());
  /* 0 이하나 15분 이상은 의미가 없다 — 창을 못 지킨다. 이상하면 기본값으로 문다. */
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 && minutes < 15 ? minutes : DEFAULT_MINUTES;
  const intervalMs = Math.round(safeMinutes * 60_000);

  if (off === 'off' || off === '0' || off === 'false') {
    return { url: null, intervalMs, reason: 'KEEPALIVE 로 꺼 두었다' };
  }

  const base = (env.KEEPALIVE_URL ?? env.RENDER_EXTERNAL_URL ?? '').trim();
  if (!base) {
    return { url: null, intervalMs, reason: 'RENDER_EXTERNAL_URL 이 없다 (로컬로 본다)' };
  }
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return { url: null, intervalMs, reason: `주소를 읽을 수 없다: ${JSON.stringify(base)}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { url: null, intervalMs, reason: `http(s) 가 아니다: ${url.protocol}` };
  }
  // 정적 파일이 아니라 /api/health 를 두드린다. 응답이 작고, 살아 있다는 뜻이 분명하다.
  return { url: new URL('/api/health', url).toString(), intervalMs, reason: '' };
}

/**
 * 계획대로 타이머를 건다. 끄기로 했으면 아무것도 하지 않고 이유만 찍는다.
 *
 * 반환값은 멈추는 함수다 — 테스트와 종료 처리에서 쓴다.
 */
export function startKeepAlive(env: NodeJS.ProcessEnv = process.env): () => void {
  const plan = planKeepAlive(env);
  if (!plan.url) {
    console.log(`[keepalive] 켜지 않는다 — ${plan.reason}`);
    return () => {};
  }
  const everyMin = (plan.intervalMs / 60_000).toFixed(0);
  console.log(`[keepalive] ${everyMin}분마다 ${plan.url} 을 두드린다 (15분 스핀다운 방지)`);

  let failures = 0;
  const ping = async (): Promise<void> => {
    /*
     * 실패해도 절대 던지지 않는다. 이 타이머 하나 때문에 서비스가 내려가면
     * 스핀다운을 막으려다 더 큰 것을 잃는다(server/index.ts 의 설계와 같은 맥락).
     */
    try {
      const res = await fetch(plan.url!, {
        headers: { 'user-agent': 'three-kingdoms-keepalive' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 성공은 조용히 넘긴다 — 10분마다 한 줄씩 쌓이면 로그에서 진짜 문제가 안 보인다.
      if (failures > 0) console.log(`[keepalive] 다시 붙었다 (연속 실패 ${failures}회 뒤)`);
      failures = 0;
    } catch (err) {
      failures++;
      console.warn(`[keepalive] ${failures}회째 실패:`, err instanceof Error ? err.message : err);
    }
  };

  const timer = setInterval(() => void ping(), plan.intervalMs);
  /*
   * unref 로 이벤트 루프를 붙잡지 않게 한다. 붙잡으면 SIGTERM 을 받고도 이
   * 타이머 때문에 프로세스가 안 끝나서 배포 교체가 10초 강제 종료까지 늘어진다.
   * 서버 소켓이 이미 루프를 살리고 있으므로 이 타이머는 붙잡을 필요가 없다.
   */
  timer.unref();
  return () => clearInterval(timer);
}
