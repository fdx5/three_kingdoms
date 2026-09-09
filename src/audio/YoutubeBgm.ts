/**
 * 배경음 재생기 — 유튜브 IFrame Player를 화면 밖에 숨겨 두고 소리만 쓴다.
 *
 * 음원 파일을 직접 서빙하지 않는 이유는 트래픽이다. 곡 하나가 수 MB라
 * 접속자마다 그만큼이 나간다. 유튜브에서 스트리밍하면 우리 대역폭은 0이다.
 *
 * 규칙은 AudioManager와 같다 — 실패해도 절대 던지지 않는다.
 * API 스크립트가 막혔거나(광고 차단·오프라인) 영상이 임베드 불가여도
 * 게임은 무음으로 그대로 돌아간다.
 */

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  loadVideoById(videoId: string): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getPlayerState(): number;
  destroy(): void;
}

interface YTPlayerEvent {
  data: number;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady?: () => void;
        onStateChange?: (e: YTPlayerEvent) => void;
        onError?: (e: YTPlayerEvent) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** API 스크립트를 못 받는 환경에서 영원히 기다리지 않게 하는 상한 */
const API_TIMEOUT_MS = 8000;
/** 재생을 걸고 이 시간 안에 시작되지 않으면 자동재생이 막힌 것으로 본다 */
const AUTOPLAY_CHECK_MS = 1500;

/**
 * 재생 권한을 주는 사용자 조작들.
 *
 * `click` 과 `touchend` 가 iOS 에서 유일하게 인정되는 둘이다. `pointerdown` 은
 * 데스크톱에서 더 빨리 반응하니 남겨 두고, `keydown` 은 키보드로만 노는 사람 몫이다.
 */
const GESTURE_EVENTS = ['click', 'touchend', 'pointerdown', 'keydown'] as const;

let apiPromise: Promise<YTNamespace | null> | null = null;

/** iframe_api 스크립트를 한 번만 심는다. 실패하면 null. */
function loadApi(): Promise<YTNamespace | null> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace | null>((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    // 다른 코드가 이미 이 콜백을 쓰고 있을 수 있다 — 덮어쓰지 않고 이어 붙인다.
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT ?? null);
    };
    if (!document.querySelector('script[data-yt-api]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.dataset.ytApi = '1';
      tag.onerror = () => resolve(null);
      document.head.append(tag);
    }
    setTimeout(() => resolve(window.YT ?? null), API_TIMEOUT_MS);
  });
  return apiPromise;
}

export class YoutubeBgm {
  private host: HTMLElement | null = null;
  private player: YTPlayer | null = null;
  private creating: Promise<void> | null = null;

  /** 지금 틀어야 하는 곡 */
  private wantedId: string | null = null;
  /** 플레이어에 실제로 올라간 곡. onReady 전에는 신뢰할 수 없다. */
  private loadedId: string | null = null;
  /**
   * onReady가 왔는가.
   *
   * IFrame API의 메서드는 준비 전에 부르면 **조용히 사라진다** — 던지지도, 큐에 쌓이지도 않는다.
   * 그래서 준비 전의 loadVideoById·playVideo·pauseVideo는 전부 없던 일이 되고,
   * 플레이어는 생성 시점의 videoId를 autoplay로 틀어 버린다. 이 플래그가 그 창을 닫는다.
   */
  private ready = false;
  /** 재생 의사 (일시적으로 막혀 있어도 true일 수 있다) */
  private wantPlaying = false;
  private volume = 0.5;
  private muted = false;
  private gestureArmed = false;
  private disposed = false;
  /**
   * 사용자 조작을 한 번이라도 봤는가.
   *
   * 플레이어가 준비되기 전에 첫 탭이 지나가는 일이 흔하다(로딩 중에 화면을 누른다).
   * 그 사실을 기억해 두지 않으면 onReady 가 왔을 때 "아직 제스처가 없었다"고 보고
   * 조용히 막힌 채로 남는다.
   */
  private sawGesture = false;

  private onGesture = (): void => {
    this.sawGesture = true;
    if (!this.wantPlaying || this.disposed) return;
    // 이 호출은 반드시 제스처 핸들러와 **같은 실행 덩어리** 안에 있어야 한다.
    // await 를 하나라도 끼우면 iOS 가 사용자 조작으로 인정하지 않는다.
    this.applyVolume();
    this.player?.playVideo?.();
    // 한 번의 제스처로 풀리지 않는 경우가 있다(플레이어가 아직 준비 전이라거나,
    // 저전력 모드라거나). 실제로 재생이 시작됐는지 확인하고, 아니면 계속 기다린다.
    setTimeout(() => {
      if (this.disposed || !this.wantPlaying) return;
      const YT = window.YT;
      const state = this.safeState();
      if (YT && (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING)) {
        this.disarmGestureRetry();
      }
    }, AUTOPLAY_CHECK_MS);
  };

  /** 이 곡을 처음부터 반복 재생한다. 이미 같은 곡이 돌고 있으면 이어서 튼다. */
  async play(videoId: string | undefined): Promise<void> {
    if (!videoId || this.disposed) return;
    this.wantedId = videoId;
    this.wantPlaying = true;

    /*
     * 기다리기 **전에** 건다.
     *
     * ensurePlayer() 는 유튜브 API 스크립트를 받아 오므로 모바일 회선에서 몇 초가
     * 걸린다. 그 사이에 사람은 로딩 화면을 한 번 누르고 지나가고, 그게 iOS 에서는
     * 유일하게 인정되는 재생 권한이었다. await 뒤에 걸면 그 탭을 놓친다.
     */
    this.armGestureRetry();

    await this.ensurePlayer();
    const player = this.player;
    if (!player || this.disposed || this.wantedId !== videoId) return;
    // 아직 준비 전이면 아무것도 부르지 않는다. onReady가 wantedId를 보고 맞춘다.
    if (!this.ready) return;

    this.applyVolume();
    this.applyWanted();
    this.armGestureRetry();
  }

  /**
   * 지금 틀려던 곡과 실제로 올라간 곡을 맞춘다.
   * 준비된 플레이어에서만 부른다 — 준비 전에는 어떤 호출도 효과가 없기 때문이다.
   */
  private applyWanted(): void {
    const player = this.player;
    if (!player || !this.ready) return;
    if (!this.wantPlaying) {
      // 생성 시 autoplay로 이미 소리가 나기 시작했을 수 있다. 여기서 확실히 끈다.
      try {
        player.pauseVideo();
      } catch {
        /* 무시 */
      }
      return;
    }
    if (this.wantedId && this.loadedId !== this.wantedId) {
      this.loadedId = this.wantedId;
      player.loadVideoById?.(this.wantedId);
    } else {
      player.playVideo?.();
    }
  }

  /** 멈춘다. 어떤 곡이었는지는 호출자(AudioManager)가 기억한다. */
  stop(): void {
    this.wantPlaying = false;
    this.disarmGestureRetry();
    // 준비 전이라면 여기서 멈춰도 소용없다 — onReady가 wantPlaying을 보고 멈춘다.
    this.applyWanted();
  }

  /** 0~1 */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  private applyVolume(): void {
    const player = this.player;
    if (!player) return;
    try {
      player.setVolume(Math.round(this.volume * 100));
      if (this.muted) player.mute();
      else player.unMute();
    } catch {
      /* 준비 전 호출 — onReady에서 다시 적용된다 */
    }
  }

  /**
   * 자동재생이 막혔을 때를 대비해 사용자 조작에서 다시 시도한다.
   * 브라우저는 소리가 나는 재생을 제스처 없이는 막는다 — 게임 첫 탭이 그 제스처가 된다.
   *
   * iOS 에서 배경음이 아예 안 나오던 이유가 여기 있었다. 세 가지가 겹쳤다.
   *
   *   1) **듣는 이벤트가 틀렸다.** iOS 사파리는 `pointerdown`(과 `touchstart`)을
   *      미디어 재생 권한으로 인정하지 않는다. `click` 이나 `touchend` 여야 한다.
   *      데스크톱에서는 pointerdown 으로도 풀리므로 이 차이가 안 보였다.
   *   2) **너무 늦게 걸었다.** 1.5초 뒤에야 리스너를 달았는데, 그 사이에 사람이
   *      화면을 한 번 누르고 지나간다. 그 탭이 유일한 기회였다.
   *   3) **한 번만 시도했다.** `once: true` 라 첫 조작에서 실패하면(플레이어가 아직
   *      준비 전이면 playVideo 는 조용히 사라진다) 두 번째 기회가 없었다.
   *
   * 그래서 지금은 **곧바로, 네 이벤트 모두에, 재생이 확인될 때까지** 건다.
   */
  private armGestureRetry(): void {
    if (typeof window === 'undefined' || this.disposed) return;
    if (!this.wantPlaying || this.gestureArmed) return;
    this.gestureArmed = true;
    for (const type of GESTURE_EVENTS) {
      window.addEventListener(type, this.onGesture, { passive: true });
    }
  }

  private disarmGestureRetry(): void {
    if (typeof window === 'undefined' || !this.gestureArmed) return;
    this.gestureArmed = false;
    for (const type of GESTURE_EVENTS) {
      window.removeEventListener(type, this.onGesture);
    }
  }

  private safeState(): number {
    try {
      return this.player?.getPlayerState() ?? -1;
    } catch {
      return -1;
    }
  }

  private ensurePlayer(): Promise<void> {
    if (this.player) return Promise.resolve();
    if (this.creating) return this.creating;

    this.creating = (async () => {
      const YT = await loadApi();
      if (!YT?.Player || this.disposed || this.player) return;

      // 플레이어는 보이지 않는다. 다만 크기가 0이면 자동재생을 거부하는 브라우저가
      // 있어서, 정상 크기로 만들고 화면 밖으로 밀어낸다.
      const host = document.createElement('div');
      host.id = 'bgm-player';
      host.setAttribute('aria-hidden', 'true');
      Object.assign(host.style, {
        position: 'fixed',
        left: '-10000px',
        top: '0',
        width: '200px',
        height: '200px',
        opacity: '0',
        pointerEvents: 'none',
      });
      const mount = document.createElement('div');
      host.append(mount);
      document.body.append(host);
      this.host = host;

      // 생성 시점의 곡은 "지금 알고 있는 최선"일 뿐이다. 준비되기까지 몇 초가 걸리고
      // 그 사이 장이 바뀔 수 있으므로, 실제로 올라간 곡은 onReady에서 다시 맞춘다.
      const videoId = this.wantedId ?? '';
      this.loadedId = videoId;
      try {
        this.player = new YT.Player(mount, {
          videoId,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            /*
             * loop/playlist 는 쓰지 않는다.
             *
             * 단일 영상 반복은 playlist에 그 id를 적어야 도는데, 그 값은 플레이어를
             * **만들 때** 박히고 loadVideoById 로는 바뀌지 않는다. 그래서 다음 장으로
             * 넘어가 곡을 바꿔도 그 곡이 끝나면 유튜브가 playlist에 적힌 첫 장의 곡으로
             * 되돌아갔다. 반복은 아래 ENDED 처리가 직접 한다.
             */
          },
          events: {
            onReady: () => {
              // 여기가 상태를 맞추는 유일한 지점이다. 준비되기 전에 들어온 곡 변경과
              // 정지 요청은 전부 흘러갔으므로, 지금 wantedId/wantPlaying 을 다시 반영한다.
              this.ready = true;
              this.applyVolume();
              this.applyWanted();
              // 준비 전에 지나간 탭도 권한이다 — 여기서 한 번 더 눌러 본다.
              if (this.wantPlaying && this.sawGesture) this.player?.playVideo?.();
              if (this.wantPlaying) this.armGestureRetry();
            },
            onStateChange: (e) => {
              // playerVars의 loop만 믿지 않는다. 끝나면 직접 처음으로 돌린다.
              if (window.YT && e.data === window.YT.PlayerState.ENDED && this.wantPlaying) {
                this.player?.seekTo(0, true);
                this.player?.playVideo?.();
              }
            },
            onError: (e) => {
              // 100/101/150 = 삭제됐거나 임베드가 막힌 영상. 무음으로 넘어간다.
              console.warn(`[bgm] 유튜브 영상을 재생할 수 없습니다 (code ${e.data}) — 무음으로 진행합니다.`);
              this.wantPlaying = false;
            },
          },
        });
      } catch (err) {
        console.warn('[bgm] 유튜브 플레이어 생성 실패 — 무음으로 진행합니다.', err);
        this.player = null;
      }
    })();
    return this.creating;
  }

  dispose(): void {
    this.disposed = true;
    this.wantPlaying = false;
    this.disarmGestureRetry();
    try {
      this.player?.destroy();
    } catch {
      /* 이미 사라진 플레이어 — 무시 */
    }
    this.player = null;
    this.ready = false;
    this.host?.remove();
    this.host = null;
  }
}
