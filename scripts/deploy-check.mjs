/**
 * 지금 살아 있는 것이 어느 커밋인가 — 한 줄로 답한다.
 *
 *   npm run deploy:check            배포본과 로컬 HEAD 를 비교한다
 *   npm run deploy:check -- --wait  일치할 때까지 기다린다 (배포를 지켜볼 때)
 *
 * 왜 필요한가
 * ----------
 * 푸시했는데 화면이 안 바뀌면 원인이 셋인데 밖에서는 구분이 안 된다 —
 * 배포가 안 걸렸는지, 빌드가 깨졌는지, 브라우저가 캐시를 보는지.
 * 실제로 이걸 몰라서 에셋 파일을 하나씩 받아 크기를 재 보며 한나절을 썼다
 * (라이브 매니페스트에 모델이 18개뿐인 것을 보고서야 하루치 배포가 통째로
 * 빠진 것을 알았다). /api/health 가 커밋을 알려 주므로 이제 한 번이면 된다.
 */
/* global process, console, fetch, setTimeout, AbortSignal */
import { execSync } from 'node:child_process';

const URL_BASE = process.env.DEPLOY_URL ?? 'https://three-kingdoms-cmus.onrender.com';
const WAIT = process.argv.includes('--wait');
/** 스핀다운에서 깨어나는 데 30초~1분이 걸린다. 넉넉히 준다. */
const TIMEOUT_MS = 15 * 60_000;
const POLL_MS = 20_000;

const local = execSync('git rev-parse HEAD').toString().trim().slice(0, 12);

async function live() {
  const res = await fetch(`${URL_BASE}/api/health`, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/*
 * process.exit 로 즉시 끝내지 않는다. 윈도우의 node 는 fetch 가 아직 정리되지
 * 않은 채로 exit 하면 libuv 어서션으로 죽는다 — 종료 코드만 정하고 자연히 끝낸다.
 */
async function main() {
  const started = Date.now();
  for (;;) {
    let info;
    try {
      info = await live();
    } catch (err) {
      console.log(`[deploy] ${URL_BASE} 응답 없음 — ${err.message}`);
      if (!WAIT || Date.now() - started > TIMEOUT_MS) return 1;
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }

    const same = info.commit === local;
    console.log(
      `[deploy] 로컬 ${local}  배포 ${info.commit ?? '(모름)'}  ${same ? '일치' : '다름'}` +
        `  (기동 ${info.uptimeSec ?? '?'}초 전, DB ${info.db})`,
    );
    if (same) return 0;
    if (!info.commit) {
      // 이 필드 자체가 없다 = 커밋을 알려 주는 코드가 들어가기 전의 빌드다
      console.log('[deploy] 배포본이 커밋 필드를 모른다 — 이 기능이 들어가기 전의 오래된 빌드다.');
    }
    if (!WAIT) {
      console.log('[deploy] 아직 반영되지 않았다. --wait 로 기다리거나 Render 의 Events 를 보라.');
      return 1;
    }
    if (Date.now() - started > TIMEOUT_MS) {
      console.log(`[deploy] ${TIMEOUT_MS / 60000}분을 기다려도 안 바뀐다 — 빌드가 실패했거나 걸리지 않았다.`);
      return 1;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

process.exitCode = await main();
