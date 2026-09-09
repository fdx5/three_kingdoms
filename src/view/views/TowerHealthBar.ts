import * as THREE from 'three';

/**
 * 망루 머리 위의 체력바.
 *
 * 적 체력바(ScreenFx)와 달리 DOM 이 아니라 3D 다. 이유는 셋이다.
 *   - 망루는 안 움직인다. 매 프레임 화면 좌표를 다시 투영할 필요가 없다.
 *   - 여덟 기가 동시에 맞을 수 있고, 그때 DOM 노드가 여덟 개 떠다니면
 *     전장 위가 아니라 화면 위에 떠 있는 것으로 보인다.
 *   - 불·연기와 같은 공간에 있어야 "저 망루의" 체력바로 읽힌다.
 *
 * 평소에는 숨어 있다. 맞았거나 골랐을 때만 뜬다 — 멀쩡한 망루 여덟 기 위에
 * 초록 막대가 늘 떠 있으면 그건 정보가 아니라 잡음이다.
 */

const WIDTH = 46;
const HEIGHT = 5.4;
const BORDER = 1.1;

/** 남은 비율에 따른 색 — 옥색에서 호박색을 지나 핏빛으로. */
const FULL = new THREE.Color(0x51d18a);
const MID = new THREE.Color(0xe8b23c);
const LOW = new THREE.Color(0xd8402f);

export class TowerHealthBar {
  readonly group = new THREE.Group();
  private frame: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private track: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private fill: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /**
   * 방금 깎여 나간 부분을 잠깐 남겨 두는 흰 막대.
   * 한 대에 얼마나 날아갔는지는 막대가 **줄어드는 것**만으로는 안 보인다.
   */
  private ghost: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  private ratio = 1;
  private ghostRatio = 1;
  private visibleFor = 0;
  private pinned = false;
  private color = new THREE.Color();
  private billboard = new THREE.Quaternion();

  constructor(y: number) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const flat = (color: number, opacity: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });

    this.frame = new THREE.Mesh(quad, flat(0x0d0b08, 0.72));
    this.track = new THREE.Mesh(quad, flat(0x3a2f24, 0.9));
    this.ghost = new THREE.Mesh(quad, flat(0xfff0d0, 0.85));
    this.fill = new THREE.Mesh(quad, flat(0x51d18a, 1));

    this.frame.scale.set(WIDTH + BORDER * 2, HEIGHT + BORDER * 2, 1);
    this.track.scale.set(WIDTH, HEIGHT, 1);
    // 채움 막대는 왼쪽 끝을 축으로 늘어나야 한다 — 가운데를 축으로 두면
    // 체력이 줄 때 양쪽에서 동시에 줄어들어 게이지로 안 읽힌다.
    for (const m of [this.fill, this.ghost]) {
      m.geometry = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
      m.scale.set(WIDTH, HEIGHT, 1);
      m.position.x = -WIDTH / 2;
    }
    // 겹치는 순서: 테두리 < 홈 < 잔상 < 채움
    this.frame.renderOrder = 900;
    this.track.renderOrder = 901;
    this.ghost.renderOrder = 902;
    this.fill.renderOrder = 903;
    this.frame.position.z = -0.3;
    this.ghost.position.z = 0.1;
    this.fill.position.z = 0.2;

    this.group.add(this.frame, this.track, this.ghost, this.fill);
    this.group.position.y = y;
    this.group.visible = false;
    this.applyRatio(1);
  }

  /** 망루가 커지면(업그레이드) 막대도 같이 올라간다 */
  setHeight(y: number): void {
    this.group.position.y = y;
  }

  /** 체력이 바뀌었다. 맞은 것이면 잠깐 떠올랐다 사라진다. */
  set(ratio: number, showFor = 3.2): void {
    const next = THREE.MathUtils.clamp(ratio, 0, 1);
    if (next < this.ratio) this.ghostRatio = Math.max(this.ghostRatio, this.ratio);
    else this.ghostRatio = next;
    this.ratio = next;
    this.applyRatio(next);
    if (showFor > 0) this.visibleFor = Math.max(this.visibleFor, showFor);
  }

  /** 골라 둔 망루는 계속 보인다 — 수리할지 판단하는 중이기 때문이다 */
  setPinned(on: boolean): void {
    this.pinned = on;
  }

  /** 지금 당장 거둔다 (무너지는 중) */
  hide(): void {
    this.pinned = false;
    this.visibleFor = 0;
    this.group.visible = false;
  }

  update(dt: number, camera: THREE.Camera): void {
    if (this.visibleFor > 0) this.visibleFor = Math.max(0, this.visibleFor - dt);
    // 멀쩡하면 굳이 띄우지 않는다. 골라 둔 망루만 예외다.
    const show = this.pinned || (this.visibleFor > 0 && this.ratio < 1);
    this.group.visible = show;
    if (!show) return;

    // 잔상은 실제 체력을 향해 천천히 따라 내려간다 (한 박자 늦게)
    if (this.ghostRatio > this.ratio) {
      this.ghostRatio = Math.max(this.ratio, this.ghostRatio - dt * 0.55);
      this.ghost.scale.x = WIDTH * this.ghostRatio;
    }

    camera.getWorldQuaternion(this.billboard);
    this.group.quaternion.copy(this.billboard);
  }

  private applyRatio(r: number): void {
    this.fill.scale.x = Math.max(0.001, WIDTH * r);
    this.ghost.scale.x = WIDTH * this.ghostRatio;
    // 절반 위에서는 옥색->호박색, 아래에서는 호박색->핏빛.
    if (r > 0.5) this.color.copy(MID).lerp(FULL, (r - 0.5) * 2);
    else this.color.copy(LOW).lerp(MID, r * 2);
    this.fill.material.color.copy(this.color);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of [this.frame, this.track, this.ghost, this.fill]) {
      m.geometry.dispose();
      m.material.dispose();
    }
    this.group.clear();
  }
}
