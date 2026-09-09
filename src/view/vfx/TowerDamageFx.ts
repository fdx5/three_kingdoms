import * as THREE from 'three';
import { Rng } from '../../core/Rng';
import type { GroundFireAssets } from '../views/GroundFireView';

/**
 * 부서져 가는 망루에 붙는 불·연기·잉걸.
 *
 * 숫자를 안 봐도 "저 망루는 곧 무너진다"가 읽혀야 한다는 것이 이 파일의 전부다.
 * 그래서 세 겹이 **피해 비율에 따라 차례로** 켜진다.
 *
 *   0.25~  기둥 사이에서 연기가 샌다        (아직 버틴다)
 *   0.50~  망루 몸통에 불이 붙는다          (손을 써야 한다)
 *   0.78~  불이 지붕까지 올라오고 잉걸이 날린다 (다음 파도에 무너진다)
 *
 * 지면 화재(GroundFireView)와 같은 텍스처를 쓰되 모양이 다르다. 저쪽은 땅에
 * 눕는 불이라 그을음 원판과 잉걸 바닥이 있고, 이쪽은 **서 있는 구조물**을
 * 타고 오르는 불이라 위로 길쭉하고 높이에 따라 크기가 줄어든다.
 *
 * 인스턴스 수는 고정이고 강도에 따라 스케일이 0이 된다 — 켜고 끌 때마다
 * 버퍼를 다시 만들면 망루 여덟 기가 동시에 맞을 때 프레임이 튄다.
 */

const FLAMES = 14;
const SMOKES = 7;
const EMBERS = 12;

interface Spot {
  /** 망루 중심 기준 위치 (반지름·높이 비율) */
  x: number;
  z: number;
  /** 0(바닥) ~ 1(지붕) */
  h: number;
  size: number;
  phase: number;
  /** 이 불이 켜지는 강도 문턱 — 낮은 것부터 하나씩 붙는다 */
  at: number;
}

export class TowerDamageFx {
  readonly object3d = new THREE.Group();
  private flames: THREE.InstancedMesh;
  private smoke: THREE.InstancedMesh;
  private embers: THREE.InstancedMesh;
  private flameSpots: Spot[] = [];
  private smokeSpots: Spot[] = [];
  private emberSpots: Spot[] = [];

  private intensity = 0;
  /** 목표 강도로 천천히 따라간다 — 한 대 맞을 때마다 불이 튀면 깜빡임이 된다 */
  private target = 0;
  private elapsed = 0;

  private matrix = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private billboard = new THREE.Quaternion();

  constructor(
    assets: GroundFireAssets,
    private height: number,
    private radius: number,
    seed: number,
  ) {
    const rng = new Rng(seed * 7919 + 13);
    const material = (map: THREE.Texture, opacity: number, additive: boolean): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        toneMapped: !additive,
      });

    this.flames = new THREE.InstancedMesh(assets.quad, material(assets.maps.flame, 0.95, true), FLAMES);
    /*
     * 연기는 어둡다. 지면 화재의 연기 텍스처는 흰빛이라 그대로 쓰면 망루에서
     * 수증기가 오르는 것처럼 보인다 — 목재가 타는 연기는 그을음이 섞여 검다.
     * 텍스처를 새로 굽는 대신 재질 색으로 눌러 쓴다.
     */
    const smokeMat = material(assets.maps.smoke, 0.42, false);
    smokeMat.color.setHex(0x5a534b);
    this.smoke = new THREE.InstancedMesh(assets.quad, smokeMat, SMOKES);
    this.embers = new THREE.InstancedMesh(assets.quad, material(assets.maps.spark, 0.9, true), EMBERS);
    for (const m of [this.flames, this.smoke, this.embers]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // 망루에 붙어 같이 움직이므로 개별 프러스텀 판정이 의미가 없다.
      m.frustumCulled = false;
      m.renderOrder = 3;
      this.object3d.add(m);
    }

    const place = (count: number, minH: number, maxH: number, sizeLo: number, sizeHi: number): Spot[] => {
      const out: Spot[] = [];
      for (let i = 0; i < count; i++) {
        const a = rng.range(0, Math.PI * 2);
        // 불은 망루 표면에 붙는다 — 안쪽에서 피면 목재에 파묻혀 안 보인다.
        const r = radius * rng.range(0.55, 1.0);
        out.push({
          x: Math.cos(a) * r,
          z: Math.sin(a) * r,
          h: rng.range(minH, maxH),
          size: rng.range(sizeLo, sizeHi),
          phase: rng.range(0, Math.PI * 2),
          // 0에서 1 사이에 고르게 흩어 둔다 — 강도가 오를수록 한 점씩 늘어난다.
          at: i / count,
        });
      }
      // 낮은 문턱부터 정렬해 두면 "아래에서 위로 번진다"가 저절로 나온다.
      out.sort((p, q) => p.at - q.at || p.h - q.h);
      for (let i = 0; i < out.length; i++) out[i].at = i / out.length;
      return out;
    };

    // 불은 아래에서 시작해 위로 번진다. 연기는 그보다 위, 잉걸은 가장 위에서 흩어진다.
    this.flameSpots = place(FLAMES, 0.08, 0.86, 0.2, 0.42);
    this.flameSpots.sort((p, q) => p.h - q.h);
    for (let i = 0; i < this.flameSpots.length; i++) this.flameSpots[i].at = i / this.flameSpots.length;
    this.smokeSpots = place(SMOKES, 0.35, 1.0, 0.5, 0.95);
    this.emberSpots = place(EMBERS, 0.2, 1.0, 0.06, 0.14);

    this.hideAll();
  }

  /**
   * 망루가 커지면(업그레이드) 불도 같이 커져야 한다.
   * 자리는 비율로 저장돼 있으므로 여기서 크기만 갈아 끼우면 된다.
   */
  setSize(height: number, radius: number): void {
    const rs = radius / (this.radius || 1);
    this.height = height;
    this.radius = radius;
    for (const list of [this.flameSpots, this.smokeSpots, this.emberSpots]) {
      for (const s of list) {
        s.x *= rs;
        s.z *= rs;
      }
    }
  }

  /** 0 = 멀쩡, 1 = 무너지기 직전 */
  setDamage(ratio: number): void {
    this.target = THREE.MathUtils.clamp(ratio, 0, 1);
  }

  /** 지금 눈에 보이는 강도 (수리 직후 잦아드는 동안에도 0이 아니다) */
  get visibleIntensity(): number {
    return this.intensity;
  }

  update(dt: number, camera: THREE.Camera): void {
    // 붙는 것은 빠르게, 잦아드는 것은 천천히. 수리하면 불이 서서히 사그라든다.
    const rate = this.target > this.intensity ? 6 : 1.4;
    this.intensity += (this.target - this.intensity) * Math.min(1, dt * rate);
    if (this.intensity < 0.002 && this.target === 0) {
      if (this.object3d.visible) {
        this.intensity = 0;
        this.hideAll();
        this.object3d.visible = false;
      }
      return;
    }
    this.object3d.visible = true;
    this.elapsed += dt;

    camera.getWorldQuaternion(this.billboard);
    const k = this.intensity;

    // 불 — 문턱을 넘은 것만, 넘은 정도만큼 자란다
    const smokeAt = 0.16;
    for (let i = 0; i < FLAMES; i++) {
      const s = this.flameSpots[i];
      // 불은 연기보다 늦게 붙는다: 강도의 앞 3할은 연기만 나는 구간이다.
      const grow = THREE.MathUtils.clamp((k - 0.34) / 0.66 - s.at * 0.85, 0, 1);
      if (grow <= 0) {
        this.setInstance(this.flames, i, 0, 0, 0, 0);
        continue;
      }
      const flick = 0.78 + Math.sin(this.elapsed * 9 + s.phase) * 0.16 + Math.sin(this.elapsed * 21 + s.phase * 3) * 0.06;
      const size = this.radius * s.size * (0.7 + grow * 1.5) * flick;
      // 불꽃은 세로로 길다. 그리고 위로 갈수록 바람에 밀려 조금 눕는다.
      const drift = Math.sin(this.elapsed * 1.7 + s.phase) * this.radius * 0.12 * grow;
      this.setInstance(
        this.flames,
        i,
        s.x + drift,
        this.height * s.h + size * 0.45,
        s.z,
        size,
        size * 1.55,
      );
    }

    // 연기 — 가장 먼저 켜지고 위로 흐른다
    for (let i = 0; i < SMOKES; i++) {
      const s = this.smokeSpots[i];
      const grow = THREE.MathUtils.clamp((k - smokeAt) / 0.5 - s.at * 0.6, 0, 1);
      if (grow <= 0) {
        this.setInstance(this.smoke, i, 0, 0, 0, 0);
        continue;
      }
      // 0..1 을 도는 상승 위상. 각 연기가 제 박자로 떠오르고 위에서 흩어진다.
      const rise = (this.elapsed * 0.34 + s.phase) % 1;
      const size = this.radius * s.size * (0.7 + rise * 1.35) * (0.4 + grow * 0.75);
      const fade = Math.sin(rise * Math.PI);
      this.setInstance(
        this.smoke,
        i,
        s.x + Math.sin(this.elapsed * 0.8 + s.phase) * this.radius * 0.4 * rise,
        this.height * s.h + rise * this.height * 0.85,
        s.z,
        size * fade,
      );
    }

    // 잉걸 — 마지막에야 켜진다. 이게 보이면 정말 위험하다는 신호다.
    for (let i = 0; i < EMBERS; i++) {
      const s = this.emberSpots[i];
      const grow = THREE.MathUtils.clamp((k - 0.62) / 0.38 - s.at * 0.5, 0, 1);
      if (grow <= 0) {
        this.setInstance(this.embers, i, 0, 0, 0, 0);
        continue;
      }
      const rise = (this.elapsed * 0.75 + s.phase) % 1;
      const size = this.radius * s.size * (1.3 - rise * 0.6) * grow;
      this.setInstance(
        this.embers,
        i,
        s.x + Math.sin(this.elapsed * 3 + s.phase * 5) * this.radius * 0.5 * rise,
        this.height * s.h + rise * this.height * 0.7,
        s.z + Math.cos(this.elapsed * 2.4 + s.phase * 3) * this.radius * 0.4 * rise,
        size * (1 - rise * 0.7),
      );
    }

    this.flames.instanceMatrix.needsUpdate = true;
    this.smoke.instanceMatrix.needsUpdate = true;
    this.embers.instanceMatrix.needsUpdate = true;
  }

  private setInstance(
    mesh: THREE.InstancedMesh,
    i: number,
    x: number,
    y: number,
    z: number,
    w: number,
    h = w,
  ): void {
    this.position.set(x, y, z);
    this.scale.set(w, h, 1);
    this.matrix.compose(this.position, this.billboard, this.scale);
    mesh.setMatrixAt(i, this.matrix);
  }

  private hideAll(): void {
    this.scale.set(0, 0, 0);
    this.position.set(0, 0, 0);
    this.matrix.compose(this.position, this.billboard, this.scale);
    for (const mesh of [this.flames, this.smoke, this.embers]) {
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, this.matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.object3d.removeFromParent();
    for (const mesh of [this.flames, this.smoke, this.embers]) {
      // 지오메트리와 텍스처는 GroundFireAssets 가 소유한다. 재질만 우리 것이다.
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.object3d.clear();
  }
}
