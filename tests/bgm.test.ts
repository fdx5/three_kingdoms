/**
 * 배경음 테스트.
 *
 * 유튜브 IFrame API의 메서드는 onReady 전에 부르면 조용히 사라진다 — 던지지도,
 * 큐에 쌓이지도 않는다. 그래서 "플레이어가 준비되기 전에 장이 바뀐" 경우
 * 곡 변경 요청이 통째로 없던 일이 되고, 플레이어는 생성 시점의 곡을
 * autoplay로 틀어 버렸다. 로그인이 늦는 날에만 나타나던 간헐적 버그다.
 *
 * 여기서는 그 준비 지연을 손으로 잡고 재현한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { YoutubeBgm } from '../src/audio/YoutubeBgm';

interface FakePlayer {
  videoId: string;
  playing: boolean;
  calls: string[];
  /** onReady 전인가. 그동안의 호출은 실제 API처럼 조용히 버린다. */
  ready: boolean;
}

let created: FakePlayer[] = [];
/** window 에 걸린 리스너들 — 제스처를 손으로 터뜨리려고 모아 둔다 */
let listeners: Record<string, (() => void)[]> = {};
/** iOS 흉내: 제스처 없이는 autoplay 가 시작되지 않는다 */
let blockAutoplay = false;
/** 마지막으로 생성된 플레이어가 받은 playerVars */
let capturedVars: Record<string, unknown> | undefined;
let fireReady: (() => void) | null = null;
let fireEnded: (() => void) | null = null;

const PlayerState = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

/** onReady를 우리가 원할 때 터뜨리는 가짜 IFrame API */
function installFakeYT(): void {
  const w = globalThis as unknown as Record<string, unknown>;
  w.window = w;
  w.document = {
    createElement: () => ({ style: {}, dataset: {}, append() {}, setAttribute() {} }),
    querySelector: () => ({}),
    head: { append() {} },
    body: { append() {} },
  };
  w.YT = {
    PlayerState,
    Player: class {
      constructor(_mount: unknown, opts: {
        videoId: string;
        playerVars: Record<string, unknown>;
        events: { onReady?: () => void; onStateChange?: (e: { data: number }) => void };
      }) {
        capturedVars = opts.playerVars;
        const self: FakePlayer = { videoId: opts.videoId, playing: false, calls: [], ready: false };
        created.push(self);
        // 실제 플레이어와 같게 — autoplay가 켜져 있으면 준비되기도 전에 소리가 난다.
        if (opts.playerVars.autoplay && !blockAutoplay) self.playing = true;
        /*
         * 여기가 이 가짜의 핵심이다. 진짜 IFrame API는 onReady 전의 메서드 호출을
         * 던지지도 큐에 넣지도 않고 **그냥 버린다**. 그 성질을 흉내내지 않으면
         * 이 테스트는 버그를 잡지 못한다.
         */
        const beforeReady = (name: string) => { self.calls.push(`dropped:${name}`); };
        Object.assign(this, {
          loadVideoById: (id: string) => {
            if (!self.ready) return beforeReady('load');
            self.calls.push(`load:${id}`); self.videoId = id; self.playing = true;
          },
          playVideo: () => {
            if (!self.ready) return beforeReady('play');
            self.calls.push('play'); self.playing = true;
          },
          pauseVideo: () => {
            if (!self.ready) return beforeReady('pause');
            self.calls.push('pause'); self.playing = false;
          },
          seekTo: () => { if (!self.ready) return beforeReady('seek'); self.calls.push('seek'); },
          setVolume: () => {}, mute: () => {}, unMute: () => {},
          getPlayerState: () => (self.playing ? PlayerState.PLAYING : PlayerState.PAUSED),
          destroy: () => {},
        });
        fireReady = () => { self.ready = true; opts.events.onReady?.(); };
        fireEnded = () => opts.events.onStateChange?.({ data: PlayerState.ENDED });
      }
    },
  };
  (w.window as Record<string, unknown>).addEventListener = (type: string, fn: () => void) => {
    (listeners[type] ??= []).push(fn);
  };
  (w.window as Record<string, unknown>).removeEventListener = (type: string, fn: () => void) => {
    listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
  };
  (w.window as Record<string, unknown>).YT = w.YT;
}

beforeEach(() => {
  created = []; fireReady = null; fireEnded = null; capturedVars = undefined;
  listeners = {}; blockAutoplay = false;
  installFakeYT();
});
afterEach(() => {
  for (const k of ['window', 'document', 'YT']) delete (globalThis as Record<string, unknown>)[k];
});

const CH1 = 'chapter-one-song';
const CH6 = 'chapter-six-song';
const last = () => created[created.length - 1];
/** 그 이벤트로 걸린 리스너를 전부 부른다 */
const fireGesture = (type: string) => { for (const fn of listeners[type] ?? []) fn(); };

describe('배경음 — 플레이어가 준비되기 전의 요청', () => {
  it('준비 전에 장이 바뀌면 준비된 뒤 바뀐 장의 곡이 나온다', async () => {
    const bgm = new YoutubeBgm();
    // 부팅: 로그인 전이라 일단 1장으로 세워 두고 곡을 건다.
    await bgm.play(CH1);
    // 로그인이 끝나 6장으로 바뀐다 — 아직 플레이어는 준비 전이다.
    bgm.stop();
    await bgm.play(CH6);
    expect(last()).toBeDefined();

    fireReady!();
    expect(last().videoId).toBe(CH6);
    expect(last().playing).toBe(true);
  });

  it('준비 전에 멈추라고 했으면 준비된 뒤에 소리가 나지 않는다', async () => {
    const bgm = new YoutubeBgm();
    await bgm.play(CH1);
    bgm.stop(); // 메뉴로 나갔다

    fireReady!();
    expect(last().playing).toBe(false);
  });

  it('준비된 뒤의 평범한 장 전환도 그대로 된다', async () => {
    const bgm = new YoutubeBgm();
    await bgm.play(CH1);
    fireReady!();
    expect(last().videoId).toBe(CH1);

    bgm.stop();
    await bgm.play(CH6);
    expect(last().videoId).toBe(CH6);
    expect(last().playing).toBe(true);
  });

  it('곡이 끝나면 지금 장의 곡을 처음부터 다시 튼다', async () => {
    const bgm = new YoutubeBgm();
    await bgm.play(CH1);
    fireReady!();
    bgm.stop();
    await bgm.play(CH6);
    last().calls.length = 0;

    fireEnded!();
    // 첫 장의 곡으로 되돌아가지 않는다 — 반복은 지금 올라간 곡 안에서만 일어난다.
    expect(last().videoId).toBe(CH6);
    expect(last().calls).toContain('seek');
  });

  it('playlist를 박아 두지 않는다 — 그것이 첫 장의 곡으로 되돌아가던 원인이었다', async () => {
    const bgm = new YoutubeBgm();
    await bgm.play(CH1);
    // 가짜 Player가 받은 playerVars 에 playlist/loop 가 없어야 한다.
    expect(created).toHaveLength(1);
    expect(capturedVars).toBeDefined();
    expect(capturedVars).not.toHaveProperty('playlist');
    expect(capturedVars).not.toHaveProperty('loop');
  });
});


/*
 * iOS 에서 배경음이 아예 안 나오던 버그.
 *
 * 세 가지가 겹쳐 있었다. (1) `pointerdown` 만 들었는데 iOS 사파리는 그것을 재생
 * 권한으로 인정하지 않는다 — `click` 이나 `touchend` 여야 한다. (2) 리스너를 1.5초
 * 뒤에, 그것도 `await ensurePlayer()` 뒤에 걸어서 로딩 중에 지나간 첫 탭을 놓쳤다.
 * (3) `once: true` 라 그 한 번이 실패하면 두 번째 기회가 없었다.
 *
 * 데스크톱에서는 pointerdown 으로 풀리므로 셋 다 안 보였다.
 */
describe('배경음 — 자동재생이 막힌 기기(iOS)', () => {
  it('iOS 가 인정하는 제스처(click·touchend)를 듣는다', async () => {
    blockAutoplay = true;
    const bgm = new YoutubeBgm();
    await bgm.play(CH1);
    expect(listeners.click?.length).toBeGreaterThan(0);
    expect(listeners.touchend?.length).toBeGreaterThan(0);
  });

  it('플레이어가 준비되기 전에 지나간 탭도 권한으로 쓴다', async () => {
    blockAutoplay = true;
    const bgm = new YoutubeBgm();
    await bgm.play(CH1);
    // 로딩 화면을 누르고 지나갔다 — 아직 onReady 전이라 playVideo 는 버려진다
    fireGesture('touchend');
    expect(last().playing).toBe(false);

    // 그 탭을 기억하고 있어야 준비된 순간 소리가 난다
    fireReady!();
    expect(last().playing).toBe(true);
  });

  it('첫 제스처가 실패해도 계속 기다린다 (한 번으로 포기하지 않는다)', async () => {
    blockAutoplay = true;
    const bgm = new YoutubeBgm();
    await bgm.play(CH1);
    fireReady!();
    // 준비는 됐지만 autoplay 가 막혀 아직 소리가 없다
    last().playing = false;

    expect(listeners.click?.length).toBeGreaterThan(0);
    fireGesture('click');
    expect(last().playing).toBe(true);
  });

  it('멈추라고 하면 제스처를 더 듣지 않는다', async () => {
    blockAutoplay = true;
    const bgm = new YoutubeBgm();
    await bgm.play(CH1);
    expect(listeners.click?.length).toBeGreaterThan(0);
    bgm.stop();
    expect(listeners.click?.length ?? 0).toBe(0);
  });
});
