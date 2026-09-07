/**
 * 터치 카메라 조작 테스트.
 *
 * 모바일에는 우클릭도 Q/E도 없어서 두 손가락이 시점 회전까지 맡는다.
 * 한 제스처가 팬·줌·회전·부감으로 갈리므로, 갈래를 잘못 고르면
 * 손가락을 조금 흔들 때마다 화면이 요동친다 — 그 갈림을 여기서 고정한다.
 *
 * CameraControls는 DOM 이벤트만 읽고 Stage의 메서드만 부른다.
 * 그래서 최소한의 가짜 엘리먼트와 가짜 Stage로 그대로 돌릴 수 있다.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { CameraControls } from '../src/view/CameraControls';
import type { Stage } from '../src/view/Stage';

interface Call {
  pan: { dx: number; dy: number }[];
  rotate: { yaw: number; pitch: number }[];
  zoom: number[];
}

function fakeStage(): Stage & { calls: Call } {
  const calls: Call = { pan: [], rotate: [], zoom: [] };
  return {
    calls,
    panByScreen: (dx: number, dy: number) => calls.pan.push({ dx, dy }),
    rotate: (yaw: number, pitch: number) => calls.rotate.push({ yaw, pitch }),
    setZoom: (z: number) => calls.zoom.push(z),
    zoomBy: (f: number) => calls.zoom.push(f),
    getZoom: () => 1,
    setParallax: () => {},
  } as unknown as Stage & { calls: Call };
}

/** addEventListener만 흉내내는 엘리먼트. 붙은 핸들러를 직접 부를 수 있다. */
function fakeElement() {
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  return {
    style: {} as Record<string, string>,
    handlers,
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
    },
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    fire: (type: string, e: Record<string, unknown>) => {
      for (const fn of handlers.get(type) ?? []) fn({ preventDefault: () => {}, ...e });
    },
  };
}

type Touch = { id: number; x: number; y: number };

function touchEvent(t: Touch) {
  return { pointerId: t.id, clientX: t.x, clientY: t.y, button: 0, pointerType: 'touch', shiftKey: false };
}

// node 환경이라 window가 없다. 카메라 조작은 키보드·포커스만 window에서 듣는다.
const noopWindow = { addEventListener: () => {}, removeEventListener: () => {} };
beforeAll(() => {
  (globalThis as { window?: unknown }).window = noopWindow;
});
afterAll(() => {
  delete (globalThis as { window?: unknown }).window;
});

let el: ReturnType<typeof fakeElement>;
let stage: ReturnType<typeof fakeStage>;
let taps: number;

beforeEach(() => {
  el = fakeElement();
  stage = fakeStage();
  taps = 0;
  new CameraControls(el as unknown as HTMLElement, stage, { parallax: false, onTap: () => { taps++; } });
});

/** 손가락들을 내리고, 주어진 경로대로 끌고, 뗀다. */
function gesture(steps: Touch[][]): void {
  for (const t of steps[0]) el.fire('pointerdown', touchEvent(t));
  for (const step of steps.slice(1)) for (const t of step) el.fire('pointermove', touchEvent(t));
  for (const t of steps[steps.length - 1]) el.fire('pointerup', touchEvent(t));
}

/** 두 손가락을 함수가 그리는 대로 20단계에 걸쳐 움직인다 */
function twoFinger(at: (k: number) => [Touch, Touch]): void {
  gesture(Array.from({ length: 21 }, (_, i) => at(i / 20)));
}

describe('터치 카메라', () => {
  it('한 손가락 드래그는 팬이다', () => {
    gesture(Array.from({ length: 11 }, (_, i) => [{ id: 1, x: 400 + i * 10, y: 300 }]));
    expect(stage.calls.pan.length).toBeGreaterThan(0);
    expect(stage.calls.pan.reduce((s, p) => s + p.dx, 0)).toBeCloseTo(100, 5);
    expect(stage.calls.rotate).toHaveLength(0);
  });

  it('두 손가락을 나란히 위아래로 끌면 부감 각도가 바뀐다 (PC의 우드래그 몫)', () => {
    twoFinger((k) => [
      { id: 1, x: 300, y: 300 + k * 200 },
      { id: 2, x: 500, y: 300 + k * 200 },
    ]);
    const pitch = stage.calls.rotate.reduce((s, r) => s + r.pitch, 0);
    expect(pitch).toBeGreaterThan(0); // 아래로 끌면 더 내려다본다 — PC와 같은 방향
    expect(stage.calls.rotate.every((r) => r.yaw === 0)).toBe(true);
    expect(stage.calls.pan).toHaveLength(0); // 부감 중에는 팬이 섞이지 않는다
  });

  it('두 손가락을 비틀면 좌우로 회전한다', () => {
    // 중점을 고정한 채 두 손가락을 시계 방향으로 90도 돌린다
    twoFinger((k) => {
      const a = (k * Math.PI) / 2;
      return [
        { id: 1, x: 400 - Math.cos(a) * 100, y: 300 - Math.sin(a) * 100 },
        { id: 2, x: 400 + Math.cos(a) * 100, y: 300 + Math.sin(a) * 100 },
      ];
    });
    const yaw = stage.calls.rotate.reduce((s, r) => s + r.yaw, 0);
    // 손가락을 시계 방향으로 돌리면 전장도 시계 방향으로 — 지도를 비트는 감각
    expect(yaw).toBeGreaterThan(1.0);
    expect(stage.calls.rotate.every((r) => r.pitch === 0)).toBe(true);
  });

  it('두 손가락을 가로로 끌면 회전이 아니라 팬이다', () => {
    twoFinger((k) => [
      { id: 1, x: 300 + k * 200, y: 300 },
      { id: 2, x: 500 + k * 200, y: 300 },
    ]);
    expect(stage.calls.pan.reduce((s, p) => s + p.dx, 0)).toBeCloseTo(200, 5);
    expect(stage.calls.rotate).toHaveLength(0); // 손목이 안 비틀렸으면 회전은 안 붙는다
  });

  it('두 손가락을 벌리면 줌이다', () => {
    twoFinger((k) => [
      { id: 1, x: 400 - 60 - k * 140, y: 300 },
      { id: 2, x: 400 + 60 + k * 140, y: 300 },
    ]);
    expect(stage.calls.zoom.length).toBeGreaterThan(0);
    expect(stage.calls.zoom[stage.calls.zoom.length - 1]).toBeLessThan(1); // 벌리면 가까워진다
  });

  it('두 손가락 팬은 판정에 쓴 첫 마디를 잃지 않는다', () => {
    twoFinger((k) => [
      { id: 1, x: 300 + k * 300, y: 300 },
      { id: 2, x: 500 + k * 300, y: 300 },
    ]);
    expect(stage.calls.pan.reduce((s, p) => s + p.dx, 0)).toBeCloseTo(300, 5);
  });

  it('제자리 탭은 여전히 탭이다', () => {
    gesture([[{ id: 1, x: 400, y: 300 }], [{ id: 1, x: 402, y: 301 }]]);
    expect(taps).toBe(1);
    expect(stage.calls.rotate).toHaveLength(0);
  });
});
