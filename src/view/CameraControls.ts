import type { Stage } from './Stage';
import { isTypingTarget } from '../ui/dom';

/**
 * 부감 고정 뷰 + 팬/줌/회전.
 *
 * 마우스: 좌드래그 = 팬, 우(또는 휠 버튼/Shift+좌) 드래그 = 회전, 휠 = 커서 기준 줌.
 * 터치: 한 손가락 드래그 = 팬, 두 손가락 = 핀치 줌 + 팬 + 비틀어 좌우 회전,
 *       두 손가락을 나란히 위아래로 = 부감 각도(터치에는 우클릭도 Q/E도 없어서 이 둘이 그 몫이다).
 * 키보드: WASD/화살표 = 팬, Q/E = 회전, +/- 또는 PageUp/Down = 줌.
 *
 * 캔버스 위 제스처는 브라우저에 넘기지 않는다(touch-action: none).
 * 탭(거의 움직이지 않은 포인터 업)은 onTap으로 넘겨 슬롯 선택에 쓴다.
 */
export interface CameraControlsOptions {
  onTap: (clientX: number, clientY: number) => void;
  /** 모바일에서는 패럴랙스를 끈다 */
  parallax: boolean;
}

/**
 * 탭으로 인정하는 이동 거리(px). 마우스는 손이 거의 안 떨리므로 좁게,
 * 손가락은 넓게 잡는다 — 이게 좁으면 "탭했는데 선택이 안 된다"가 된다.
 */
const TAP_SLOP = { mouse: 5, touch: 14 };
/** 누른 채로 오래 버티다 떼도 탭으로 친다. 롱프레스 제스처가 따로 없기 때문이다. */
const TAP_TIME_THRESHOLD = 1200; // ms

/** 회전 감도 (px → 라디안) */
const ROTATE_SPEED = { yaw: 0.006, pitch: 0.005 };
/**
 * 두 손가락 제스처 판정.
 *
 * 두 손가락은 팬·줌·회전·부감을 모두 뜻할 수 있어서, 손가락이 처음 `DECIDE_PX` 만큼
 * 움직인 모양을 보고 한 번만 갈래를 정한다. 매 프레임 다시 정하면 손이 조금 흔들릴 때마다
 * 팬과 부감을 오가며 화면이 요동친다.
 *
 * 나란히·세로로만 움직였으면 부감(tilt), 아니면 팬 + 줌 + 비틀기(move)다.
 * TWIST_ARM 은 비틀기가 붙기 시작하는 각도 — 이게 없으면 순수한 두 손가락 팬에도
 * 손목의 미세한 비틀림이 회전으로 새어 들어간다.
 */
const TWO_FINGER = {
  DECIDE_PX: 22,
  /** 부감으로 보려면 세로 이동이 가로의 이만큼을 넘어야 한다 */
  TILT_RATIO: 2,
  /** 그 사이 벌어짐·비틀림이 이보다 작아야 부감이다 (비율, 라디안) */
  TILT_SPREAD: 0.12,
  TILT_TWIST: 0.12,
  TWIST_ARM: 0.09,
};

/** 키보드 팬 속도 (초당 화면 픽셀). 화면 크기와 무관하게 같은 속도로 느껴진다. */
const KEY_PAN_PX_PER_SEC = 900;
const KEY_ROTATE_PER_SEC = 1.2;
const KEY_ZOOM_PER_SEC = 0.9;

interface PointerState {
  x: number;
  y: number;
  /** 이 포인터가 회전 드래그인가 (우클릭/휠클릭/Shift) */
  rotate: boolean;
  type: string;
}

export class CameraControls {
  private pointers = new Map<number, PointerState>();
  private downAt = 0;
  private downPos = { x: 0, y: 0 };
  private moved = 0;
  private downType = 'mouse';
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private pinchMid = { x: 0, y: 0 };
  /** 두 손가락 제스처의 시작 모양 — 갈래를 정하는 기준점 */
  private pinchStartMid = { x: 0, y: 0 };
  private pinchStartAngle = 0;
  private pinchAngle = 0;
  private twoFinger: 'undecided' | 'tilt' | 'move' = 'undecided';
  private twistArmed = false;
  private keys = new Set<string>();
  private disposed = false;

  private onPointerDown: (e: PointerEvent) => void;
  private onPointerMove: (e: PointerEvent) => void;
  private onPointerUp: (e: PointerEvent) => void;
  private onWheel: (e: WheelEvent) => void;
  private onContextMenu: (e: Event) => void;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onBlur: () => void;

  constructor(
    private readonly el: HTMLElement,
    private readonly stage: Stage,
    private readonly opts: CameraControlsOptions,
  ) {
    el.style.cursor = 'grab';
    el.style.touchAction = 'none';

    this.onPointerDown = (e) => {
      e.preventDefault();
      this.el.setPointerCapture?.(e.pointerId);
      const rotate = e.button === 2 || e.button === 1 || e.shiftKey;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, rotate, type: e.pointerType });
      this.el.style.cursor = rotate ? 'move' : 'grabbing';
      if (this.pointers.size === 1) {
        this.downAt = performance.now();
        this.downPos = { x: e.clientX, y: e.clientY };
        this.downType = e.pointerType;
        this.moved = 0;
      } else if (this.pointers.size === 2) {
        this.beginPinch();
      }
    };

    this.onPointerMove = (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) {
        // 버튼을 누르지 않은 상태의 이동 = 패럴랙스
        if (this.opts.parallax && this.pointers.size === 0) {
          const r = this.el.getBoundingClientRect();
          this.stage.setParallax(
            ((e.clientX - r.left) / r.width - 0.5) * 2,
            ((e.clientY - r.top) / r.height - 0.5) * 2,
          );
        }
        return;
      }

      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;
      // 탭 판정은 누적 이동이 아니라 누른 지점에서의 거리로 한다.
      // 누적이면 제자리에서 미세하게 떠는 손도 드래그로 오해한다.
      this.moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);

      const rect = this.el.getBoundingClientRect();

      if (this.pointers.size >= 2) {
        this.pinchMove(rect.height);
        return;
      }

      if (prev.rotate) {
        this.stage.rotate(-dx * ROTATE_SPEED.yaw, dy * ROTATE_SPEED.pitch);
        return;
      }
      this.stage.panByScreen(dx, dy, rect.height);
    };

    this.onPointerUp = (e) => {
      const wasSingle = this.pointers.size === 1;
      const state = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      this.el.releasePointerCapture?.(e.pointerId);
      if (this.pointers.size < 2) this.pinchStartDist = 0;
      if (this.pointers.size === 2) this.beginPinch();
      this.el.style.cursor = this.pointers.size === 0 ? 'grab' : 'grabbing';

      const slop = this.downType === 'mouse' ? TAP_SLOP.mouse : TAP_SLOP.touch;
      if (
        wasSingle &&
        !state?.rotate &&
        this.moved < slop &&
        performance.now() - this.downAt < TAP_TIME_THRESHOLD
      ) {
        this.opts.onTap(this.downPos.x, this.downPos.y);
      }
    };

    this.onWheel = (e) => {
      e.preventDefault();
      const r = this.el.getBoundingClientRect();
      // deltaMode: 0=픽셀, 1=줄, 2=페이지. 브라우저마다 단위가 달라 그대로 쓰면
      // 어떤 환경에서는 휠 한 칸이 꿈쩍도 하지 않는다.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      const delta = Math.max(-240, Math.min(240, e.deltaY * unit));
      this.stage.zoomBy(
        Math.exp(delta * 0.0012),
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -(((e.clientY - r.top) / r.height) * 2 - 1),
      );
    };

    // 롱프레스 / 우드래그 회전 중에 뜨는 컨텍스트 메뉴 방지
    this.onContextMenu = (e) => e.preventDefault();

    this.onKeyDown = (e) => {
      if (isTypingTarget(e.target)) return;
      const key = normalizeKey(e);
      if (!key) return;
      // 화살표는 페이지 스크롤을 부른다
      if (e.key.startsWith('Arrow') || e.key.startsWith('Page')) e.preventDefault();
      this.keys.add(key);
    };
    this.onKeyUp = (e) => {
      const key = normalizeKey(e);
      if (key) this.keys.delete(key);
    };
    // 창 포커스를 잃으면 눌린 키가 그대로 남아 카메라가 혼자 흘러간다
    this.onBlur = () => {
      this.keys.clear();
      this.pointers.clear();
      this.el.style.cursor = 'grab';
    };

    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** 매 프레임 — 키보드로 누르고 있는 방향만큼 카메라를 민다. */
  update(dt: number): void {
    if (this.keys.size === 0) return;
    const height = Math.max(1, this.el.getBoundingClientRect().height);

    let px = 0;
    let py = 0;
    if (this.keys.has('left')) px += 1;
    if (this.keys.has('right')) px -= 1;
    if (this.keys.has('up')) py += 1;
    if (this.keys.has('down')) py -= 1;
    if (px !== 0 || py !== 0) {
      const len = Math.hypot(px, py);
      const step = (KEY_PAN_PX_PER_SEC * dt) / len;
      this.stage.panByScreen(px * step, py * step, height);
    }

    let yaw = 0;
    if (this.keys.has('rotL')) yaw += 1;
    if (this.keys.has('rotR')) yaw -= 1;
    if (yaw !== 0) this.stage.rotate(yaw * KEY_ROTATE_PER_SEC * dt, 0);

    let zoom = 0;
    if (this.keys.has('zoomIn')) zoom -= 1;
    if (this.keys.has('zoomOut')) zoom += 1;
    if (zoom !== 0) this.stage.zoomBy(Math.exp(zoom * KEY_ZOOM_PER_SEC * dt), 0, 0);
  }

  private beginPinch(): void {
    this.pinchStartDist = this.pinchDistance();
    this.pinchStartZoom = this.stage.getZoom();
    this.pinchMid = this.pinchMidpoint();
    this.pinchStartMid = { ...this.pinchMid };
    this.pinchAngle = this.pinchAngleNow();
    this.pinchStartAngle = this.pinchAngle;
    this.twoFinger = 'undecided';
    this.twistArmed = false;
  }

  /**
   * 두 손가락이 움직였다. 갈래가 정해지기 전에는 줌만 따라간다 —
   * 줌은 손가락 사이 거리라 어느 갈래에서도 뜻이 같기 때문이다.
   */
  private pinchMove(viewportHeight: number): void {
    const dist = this.pinchDistance();
    const mid = this.pinchMidpoint();
    const angle = this.pinchAngleNow();

    if (this.twoFinger === 'undecided') {
      const dx = mid.x - this.pinchStartMid.x;
      const dy = mid.y - this.pinchStartMid.y;
      const spread = Math.abs(dist - this.pinchStartDist) / Math.max(1, this.pinchStartDist);
      const twist = Math.abs(angleDelta(angle, this.pinchStartAngle));
      if (Math.hypot(dx, dy) >= TWO_FINGER.DECIDE_PX) {
        const upright = Math.abs(dy) > Math.abs(dx) * TWO_FINGER.TILT_RATIO;
        this.twoFinger =
          upright && spread < TWO_FINGER.TILT_SPREAD && twist < TWO_FINGER.TILT_TWIST ? 'tilt' : 'move';
      } else if (spread >= TWO_FINGER.TILT_SPREAD || twist >= TWO_FINGER.TWIST_ARM) {
        // 중점은 가만둔 채 벌리거나 비틀기만 한 손. 부감일 수는 없으니 갈래는 정해졌다.
        // (이 갈래가 없으면 제자리 비틀기는 중점이 안 움직여 영영 판정이 안 난다.)
        this.twoFinger = 'move';
      }
    }

    if (this.pinchStartDist > 0) this.stage.setZoom(this.pinchStartZoom * (this.pinchStartDist / dist));

    if (this.twoFinger === 'tilt') {
      // PC의 우드래그와 같은 방향으로 — 아래로 끌면 더 내려다본다.
      this.stage.rotate(0, (mid.y - this.pinchMid.y) * ROTATE_SPEED.pitch);
    } else if (this.twoFinger === 'move') {
      // 지도를 비틀듯이 — 손가락을 시계 방향으로 돌리면 전장도 시계 방향으로 돈다.
      if (!this.twistArmed && Math.abs(angleDelta(angle, this.pinchStartAngle)) > TWO_FINGER.TWIST_ARM) {
        this.twistArmed = true;
      }
      if (this.twistArmed) this.stage.rotate(angleDelta(angle, this.pinchAngle), 0);
      this.stage.panByScreen(mid.x - this.pinchMid.x, mid.y - this.pinchMid.y, viewportHeight);
    }

    // 갈래가 정해지기 전의 움직임은 흘려보내지 않고 남겨 둔다.
    // 여기서 기준점을 옮겨 버리면 판정에 쓴 22px이 그대로 사라져,
    // 두 손가락 팬을 시작할 때마다 첫 마디가 씹힌다.
    if (this.twoFinger !== 'undecided') {
      this.pinchMid = mid;
      this.pinchAngle = angle;
    }
  }

  /** 두 손가락을 잇는 선의 화면 각도. y가 아래로 커지므로 시계 방향이 +다. */
  private pinchAngleNow(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  private pinchMidpoint(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    this.el.removeEventListener('pointermove', this.onPointerMove);
    this.el.removeEventListener('pointerup', this.onPointerUp);
    this.el.removeEventListener('pointercancel', this.onPointerUp);
    this.el.removeEventListener('wheel', this.onWheel);
    this.el.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.pointers.clear();
    this.keys.clear();
  }
}

/** 두 각의 차이를 -π~π로 접는다. 손가락이 한 바퀴 넘어가도 튀지 않게. */
function angleDelta(to: number, from: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 키를 카메라 동작으로 번역. 게임 단축키(1~9, U, R, Space 등)는 건드리지 않는다. */
function normalizeKey(e: KeyboardEvent): string | null {
  switch (e.key) {
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'PageUp':
      return 'zoomIn';
    case 'PageDown':
      return 'zoomOut';
    default:
      break;
  }
  switch (e.key.toLowerCase()) {
    case 'a':
      return 'left';
    case 'd':
      return 'right';
    case 'w':
      return 'up';
    case 's':
      return 'down';
    case 'q':
      return 'rotL';
    case 'e':
      return 'rotR';
    default:
      return null;
  }
}
