import * as THREE from 'three';
import type { Projectile } from '../../sim/Projectile';
import type { EntityView, ViewState } from '../EntityView';
import { FlameJetView } from '../vfx/DragonFireEffects';
import type { GroundFireAssets } from './GroundFireView';

/**
 * 투사체 뷰 — 화살(얇은 원기둥 + 원뿔 촉)과 투석(회전하는 바위) 두 모습.
 * 시뮬은 평면(x, z)만 계산한다 — 높이는 여기서 arcHeight * sin(pi*t) 포물선으로 만든다.
 *
 * N발 발사를 N발로 보이게 하기
 * ---------------------------
 * 시뮬은 이미 화살 수만큼 투사체를 따로 만든다. 그런데 전부 타워 중심에서
 * 같은 순간에 떠나므로, 목표가 가까이 뭉쳐 있으면 화면에서는 굵은 한 발로 뭉쳐 보인다.
 * 그래서 뷰가 `salvoIndex / salvoSize` 로 발마다
 *   - 출발점을 좌우로 벌리고 (망루 난간의 활 표식 자리에서 떠나는 것처럼)
 *   - 포물선 높이를 조금씩 다르게 주고
 *   - 도착에 가까워질수록 그 차이를 0으로 좁힌다 (명중은 그대로여야 하므로)
 * 세 가지를 겹친다. 시뮬의 명중 시점과 좌표는 건드리지 않는다.
 *
 * 업그레이드가 보이게 하기
 * ----------------------
 * 망루는 지붕의 활 표식이 늘어 레벨이 보이지만, 벽력거는 발사체가 계속 1개라
 * 레벨을 올려도 화면에서 달라지는 게 없었다. 그래서 던지는 물건 자체를 바꾼다.
 *   Lv1~2  민바위
 *   Lv3~4  달군 바위 - 붉게 달아오르고 불꽃 껍질이 붙는다
 *   Lv5    불덩이 - 껍질이 커지고 잔불이 길게 남는다
 * 피해량이 40에서 230으로 여섯 배가 되는 구간이라, 눈에도 그만큼 달라져야 한다.
 */
const TRAIL_DOTS = 3;

/** 발 사이 가로 간격(u). 망루 난간 반경(19.5)을 넘지 않게 잡는다. */
const LANE_SPACING = 8;
/** 발마다 포물선 높이를 이만큼 어긋나게 한다 */
const LANE_ARC = 0.07;
/**
 * 발마다 출발을 이만큼 늦춘다(지수). 뒤 발일수록 처음에 처지고 착탄에서 따라잡는다.
 * 같은 순간에 다섯 발이 떠나면 아무리 벌려 놔도 한 덩어리로 읽힌다 —
 * "차례로 떠난다"가 다발로 보이게 하는 가장 큰 요소다.
 */
const LANE_STAGGER = 0.12;

/** 투척체 연출 단계. 이 레벨 이상이면 그 단계가 된다. */
const HEAT_LEVEL = 3;
const BLAZE_LEVEL = 5;

export type ProjectileHeat = 'cold' | 'hot' | 'blazing';

/** 투척체가 이 레벨에서 어떤 모습인가 */
export function heatOf(level: number): ProjectileHeat {
  if (level >= BLAZE_LEVEL) return 'blazing';
  if (level >= HEAT_LEVEL) return 'hot';
  return 'cold';
}

/**
 * 화면에 그릴 모습. 시뮬의 damageKind와 1:1이 아니다 —
 * 같은 공성 피해라도 벽력거의 바위(stone)와 화포·성문의 포탄(shell)은 다르게 보인다.
 *   arrow  화살
 *   stone  던지는 바위 (레벨이 오르면 달아오른다)
 *   shell  쇠 포탄 — 회전하지 않고 곧게 날아가며 뒤에 화약 연기가 붙는다
 *   flame  불줄기 — 화공 망루의 기름불, 성문 화룡구의 화염
 */
export type ProjectileKind = 'arrow' | 'stone' | 'shell' | 'flame';

export class ProjectileView implements EntityView<Projectile> {
  readonly object3d = new THREE.Group();

  private arrow = new THREE.Group();
  private arrowShaft: THREE.Mesh;
  private arrowHead: THREE.Mesh;
  private stone: THREE.Mesh;
  /** 달군 바위를 감싸는 불꽃 껍질. 바위보다 조금 크고 뒤로 늘어진다. */
  private flame: THREE.Mesh;
  private kind: ProjectileKind = 'arrow';
  private heat: ProjectileHeat = 'cold';
  private incendiary = false;
  /**
   * 실제로 화살이 떠난 자리 (활 시위). 지정되면 레인 분산 대신 이 자리에서 출발한다 —
   * 활 망루는 쇠뇌가 다섯 군데에 있으므로 "어느 활에서 나갔는지"가 눈에 보여야 한다.
   */
  private launch: THREE.Vector3 | null = null;
  private jet: FlameJetView | null = null;
  private mouth: THREE.Object3D | null = null;
  private jetOrigin = new THREE.Vector3();
  private jetTarget = new THREE.Vector3();
  private assets: ProjectileAssets;

  /**
   * 화살 트레일 — 페이드하는 점 3개.
   * 리본을 매 프레임 다시 만들면 수백 발일 때 버퍼 갱신 비용이 커진다.
   * 뒤따라오는 점 3개면 속도감은 충분하고 비용은 거의 없다.
   */
  private trail: THREE.Mesh[] = [];
  private trailGroup = new THREE.Group();

  constructor(assets: ProjectileAssets) {
    this.assets = assets;
    const shaft = new THREE.Mesh(assets.shaft, assets.material);
    // 원기둥은 +Y가 축이다. +Z를 향하도록 눕힌다.
    shaft.rotation.x = Math.PI / 2;
    const head = new THREE.Mesh(assets.head, assets.material);
    head.rotation.x = Math.PI / 2;
    head.position.z = 9;
    this.arrowShaft = shaft;
    this.arrowHead = head;
    this.arrow.add(shaft, head);

    this.stone = new THREE.Mesh(assets.stone, assets.stoneMaterials.cold);
    this.stone.visible = false;

    this.flame = new THREE.Mesh(assets.flame, assets.flameMaterials.hot);
    this.flame.visible = false;

    this.object3d.add(this.arrow, this.stone, this.flame);
    this.object3d.castShadow = false;

    for (let i = 0; i < TRAIL_DOTS; i++) {
      const dot = new THREE.Mesh(assets.trailGeo, assets.trailMats[i]);
      this.trail.push(dot);
      this.trailGroup.add(dot);
    }
  }

  /**
   * 화살이냐 바위냐, 그리고 몇 레벨짜리냐. 풀에서 꺼낼 때 정한다 —
   * 지오메트리와 머티리얼은 전부 공유본이라 여기서는 참조만 바꾼다.
   */
  /**
   * 이 화살이 떠난 자리를 알려준다 (월드 좌표). null 이면 타워 중심에서 떠난 것으로 본다.
   * 시뮬은 타워 중심에서 쐈다고 계산하므로, 이 어긋남은 착탄에 가까워질수록 0으로 좁힌다.
   */
  setLaunch(origin: THREE.Vector3 | null): void {
    this.launch = origin ? origin.clone() : null;
  }

  get isFlame(): boolean { return this.kind === 'flame'; }

  setFlameSource(assets: GroundFireAssets, mouth: THREE.Object3D | null): void {
    this.mouth = mouth;
    if (this.kind !== 'flame') return;
    this.jet ??= new FlameJetView(assets);
    this.object3d.parent?.add(this.jet.object3d);
    this.jet.reset();
  }

  setKind(kind: ProjectileKind, level = 1, incendiary = false): void {
    this.kind = kind;
    this.mouth = null;
    if (this.jet) this.jet.object3d.visible = kind === 'flame';
    this.incendiary = incendiary;
    this.flame.quaternion.identity();
    // 포탄과 불줄기는 늘 뜨겁다 — 레벨과 무관하게 최고 단계로 그린다.
    this.heat = kind === 'flame' ? 'blazing' : kind === 'shell' ? 'hot' : heatOf(level);

    this.arrow.visible = kind === 'arrow';
    // 포탄은 바위와 같은 메시를 쓰되 표면과 크기가 다르다 (지오메트리는 공유본이다).
    this.stone.visible = kind === 'stone' || kind === 'shell';
    const fireArrow = kind === 'arrow' && this.heat !== 'cold';
    this.arrowShaft.material = fireArrow ? this.assets.fireArrowMaterial : this.assets.material;
    this.arrowHead.material = fireArrow ? this.assets.fireArrowMaterial : this.assets.material;

    if (kind === 'shell') {
      this.stone.geometry = this.assets.shell;
      this.stone.material = this.assets.shellMaterial;
      this.stone.scale.setScalar(incendiary ? 1 : 0.72);
    } else if (kind === 'stone') {
      this.stone.geometry = this.assets.stone;
      this.stone.scale.setScalar(1);
    }

    const heat = this.heat;
    if (kind === 'flame') {
      // 화염은 FlameJetView의 투명 분사로 그린다.
      this.flame.visible = false;
      this.flame.material = this.assets.flameMaterials.blazing;
      this.flame.scale.set(1.5, 1.9, 1.5);
    } else if (kind === 'shell') {
      this.flame.visible = true;
      this.flame.material = this.assets.flameMaterials.hot;
      this.flame.scale.set(0.62, 0.62, 0.62);
    } else if ((kind === 'stone' || fireArrow) && (heat === 'hot' || heat === 'blazing')) {
      if (kind === 'stone') this.stone.material = this.assets.stoneMaterials[heat];
      this.flame.visible = true;
      this.flame.material = this.assets.flameMaterials[heat];
      const k = kind === 'arrow' ? (heat === 'blazing' ? 0.34 : 0.27) : heat === 'blazing' ? 1.28 : 0.95;
      this.flame.scale.set(k, k, k);
    } else {
      if (kind === 'stone') this.stone.material = this.assets.stoneMaterials.cold;
      this.flame.visible = false;
    }

    // 잔불은 달군 바위와 화살에만. 민바위는 아무것도 남기지 않는다.
    this.trailGroup.visible = kind !== 'flame' && (kind !== 'stone' || this.heat !== 'cold');
    const trailMats = kind === 'arrow' && this.heat === 'cold' ? this.assets.trailMats : this.assets.emberMats;
    for (let i = 0; i < this.trail.length; i++) this.trail[i].material = trailMats[i];
  }

  mount(parent: THREE.Object3D): void {
    parent.add(this.object3d);
    parent.add(this.trailGroup);
  }

  sync(p: Projectile, alpha: number, _dt: number, camera?: THREE.Camera, impactY = 0): void {
    const x = p.prevX + (p.x - p.prevX) * alpha;
    const z = p.prevZ + (p.z - p.prevZ) * alpha;
    const travelled = p.prevTraveled + (p.traveled - p.prevTraveled) * alpha;
    const t = Math.min(1, travelled / p.totalDist);
    if (this.kind === 'flame' && this.jet && camera) {
      if (this.mouth) this.mouth.getWorldPosition(this.jetOrigin);
      else if (this.launch) this.jetOrigin.copy(this.launch);
      else this.jetOrigin.set(p.fromX, 38, p.fromZ);
      this.jetTarget.set(p.toX, impactY + 2.2, p.toZ);
      this.jet.update(this.jetOrigin, this.jetTarget, t, _dt, camera);
      this.object3d.position.lerpVectors(this.jetOrigin, this.jetTarget, t);
      return;
    }

    // 이 발이 한 다발의 몇 번째인가 — 가운데를 0으로 두고 좌우로 벌린다
    const lane = p.salvoSize > 1 ? p.salvoIndex - (p.salvoSize - 1) / 2 : 0;

    /*
     * 뒤 발을 뒤로 끌어당긴다.
     * 투사체는 살아 있는 목표를 추적하므로 실제 궤적이 직선이 아니다. 그래서
     * from→to 를 다시 보간하지 않고, 지금 시뮬 위치를 출발점 쪽으로 되감는다.
     * tv <= t 이고 t=1에서 tv=1이라 착탄 지점은 정확히 그대로다.
     */
    const tv = p.salvoSize > 1 ? Math.pow(t, 1 + LANE_STAGGER * p.salvoIndex) : t;
    const lag = t > 1e-4 ? tv / t : 1;

    // 벌어짐은 출발에서 가장 크고 착탄에서 0이 된다. 0.6제곱이라 중반까지 남는다.
    // 실제 발사 위치(활 시위)가 주어졌으면 그쪽이 우선이다 — 임의로 벌리지 않는다.
    const decay = Math.pow(1 - tv, 0.6);
    const spread = this.launch || lane === 0 ? 0 : LANE_SPACING * lane * decay;

    // 진행 방향과 그 수직 방향
    const dirX = p.toX - p.fromX;
    const dirZ = p.toZ - p.fromZ;
    const dirLen = Math.hypot(dirX, dirZ) || 1e-6;
    const perpX = dirZ / dirLen;
    const perpZ = -dirX / dirLen;

    const arc = p.arcHeight * (1 + LANE_ARC * (this.launch ? 0 : lane));
    let baseY = 38 * (1 - tv) + arc * Math.sin(Math.PI * tv);
    let lagX = p.fromX + (x - p.fromX) * lag;
    let lagZ = p.fromZ + (z - p.fromZ) * lag;
    if (this.launch) {
      // 시위 위치와 타워 중심의 차이만큼 밀어 준다. 착탄에서 0이 되므로 명중은 그대로다.
      lagX += (this.launch.x - p.fromX) * decay;
      lagZ += (this.launch.z - p.fromZ) * decay;
      baseY += (this.launch.y - 38) * decay;
    }
    const y = baseY;
    this.object3d.position.set(lagX + perpX * spread, y, lagZ + perpZ * spread);

    if (this.kind === 'flame') {
      // 불줄기는 진행 방향으로 늘어난다 — 앞이 뾰족하고 뒤가 끌린다.
      const hx = p.toX - lagX;
      const hz = p.toZ - lagZ;
      const hlen = Math.hypot(hx, hz) || 1e-6;
      this.object3d.rotation.set(0, Math.atan2(hx / hlen, hz / hlen), 0, 'YXZ');
      const flick = 1 + Math.sin(travelled * 0.6) * 0.18;
      this.flame.scale.set(1.5 * flick, 1.9, 2.6);
    } else if (this.kind === 'shell') {
      // 포탄은 구르지 않는다 — 축을 중심으로 천천히 돈다
      this.object3d.rotation.set(0, travelled * 0.02, 0);
      if (this.flame.visible) this.flame.quaternion.copy(this.object3d.quaternion).invert();
      if (this.incendiary) {
        const flick = 1 + Math.sin(travelled * .43 + p.id) * .16;
        this.flame.scale.set(.95 * flick, 1.25 * flick, .95);
      }
    } else if (this.kind === 'stone') {
      // 바위는 방향이 없다 - 굴러가는 것처럼 돌린다
      this.object3d.rotation.set(travelled * 0.05, travelled * 0.037, 0);
      if (this.flame.visible) {
        // 껍질까지 같이 돌면 불이 굴러다니는 것처럼 보인다.
        // 부모 회전을 상쇄하고 세로로만 일렁이게 둔다.
        this.flame.quaternion.copy(this.object3d.quaternion).invert();
        const flick = 1 + Math.sin(travelled * 0.35) * 0.12;
        const base = this.heat === 'blazing' ? 1.28 : 0.95;
        this.flame.scale.set(base, base * flick, base);
      }
    } else {
      // 화살은 진행 방향(수평 성분 + 포물선 기울기)으로 정렬한다
      const hx = p.toX - lagX;
      const hz = p.toZ - lagZ;
      const hlen = Math.hypot(hx, hz) || 1e-6;
      const dy = arc * Math.PI * Math.cos(Math.PI * tv) - 38;
      const pitch = Math.atan2(dy, p.totalDist);
      this.object3d.rotation.set(pitch, Math.atan2(hx / hlen, hz / hlen), 0, 'YXZ');
    }

    if (!this.trailGroup.visible) return;

    // 트레일: 지나온 궤적 위 세 지점을 같은 포물선·같은 레인으로 되짚는다.
    for (let i = 0; i < this.trail.length; i++) {
      const back = (i + 1) * 0.045;
      const tb = Math.max(0, tv - back);
      const sb = lane === 0 ? 0 : LANE_SPACING * lane * Math.pow(1 - tb, 0.6);
      const bx = p.fromX + (p.toX - p.fromX) * tb + perpX * sb;
      const bz = p.fromZ + (p.toZ - p.fromZ) * tb + perpZ * sb;
      const by = 38 * (1 - tb) + arc * Math.sin(Math.PI * tb);
      this.trail[i].position.set(bx, by, bz);
      if (this.launch) {
        const tailDecay = Math.pow(1 - tb, .6);
        this.trail[i].position.x += (this.launch.x - p.fromX) * tailDecay - perpX * sb;
        this.trail[i].position.y += (this.launch.y - 38) * tailDecay;
        this.trail[i].position.z += (this.launch.z - p.fromZ) * tailDecay - perpZ * sb;
      }
      this.trail[i].scale.setScalar(this.incendiary ? (3.8 - i * .85) : 1);
      this.trail[i].visible = tb > 0.02;
    }
  }

  playState(_state: ViewState): void {
    // 투사체는 상태가 없다.
  }

  setVisible(v: boolean): void {
    this.object3d.visible = v;
    this.trailGroup.visible = v && this.kind !== 'flame' && (this.kind === 'arrow' || this.heat !== 'cold');
    if (this.jet) this.jet.object3d.visible = v && this.kind === 'flame';
  }

  dispose(): void {
    this.jet?.dispose();
    this.object3d.removeFromParent();
    this.trailGroup.removeFromParent();
    this.object3d.clear();
    this.trailGroup.clear();
    this.arrow.clear();
    this.trail.length = 0;
  }
}

export interface ProjectileAssets {
  shaft: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  material: THREE.Material;
  fireArrowMaterial: THREE.Material;
  stone: THREE.BufferGeometry;
  shell: THREE.BufferGeometry;
  /** 연출 단계별 바위 표면 */
  stoneMaterials: Record<ProjectileHeat, THREE.Material>;
  /** 쇠 포탄 — 바위와 같은 메시에 다른 표면 */
  shellMaterial: THREE.Material;
  flame: THREE.BufferGeometry;
  /** 달군 단계에만 쓰는 불꽃 껍질 */
  flameMaterials: Record<'hot' | 'blazing', THREE.Material>;
  trailGeo: THREE.BufferGeometry;
  trailMats: THREE.Material[];
  /** 달군 바위가 남기는 잔불 */
  emberMats: THREE.Material[];
  dispose: () => void;
}

/** 지오메트리/머티리얼은 전부 공유한다 — 동시에 수백 개가 난다. */
export function createProjectileAssets(): ProjectileAssets {
  const shaft = new THREE.CylinderGeometry(0.7, 0.7, 18, 5);
  const head = new THREE.ConeGeometry(1.8, 5, 5);
  const material = new THREE.MeshStandardMaterial({ color: 0xe6dcc0, roughness: 0.7, metalness: 0.1 });
  const fireArrowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffb13b,
    emissive: 0xff5a12,
    emissiveIntensity: 2,
    roughness: 0.55,
  });

  // 투석 — 면이 적은 구라 각이 살아 있어서 굴리면 회전이 읽힌다
  const stone = new THREE.IcosahedronGeometry(6.5, 0);
  const shell = new THREE.SphereGeometry(6.5, 12, 8);
  const stoneMaterials: Record<ProjectileHeat, THREE.Material> = {
    cold: new THREE.MeshStandardMaterial({ color: 0x6e6a62, roughness: 1, flatShading: true }),
    // 달군 바위는 자체발광을 준다 — 그림자 속에서도 뜨거워 보인다
    hot: new THREE.MeshStandardMaterial({
      color: 0x7a4a34,
      emissive: 0xd2521a,
      emissiveIntensity: 0.9,
      roughness: 0.85,
      flatShading: true,
    }),
    blazing: new THREE.MeshStandardMaterial({
      color: 0x8a3b1c,
      emissive: 0xff7a1a,
      emissiveIntensity: 1.6,
      roughness: 0.7,
      flatShading: true,
    }),
  };

  // 쇠 포탄 — 검게 벼린 표면에 붉은 심지. 바위와 한눈에 구별된다.
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x23262a,
    emissive: 0xff4a10,
    emissiveIntensity: 0.55,
    roughness: 0.35,
    metalness: 0.85,
    flatShading: true,
  });

  // 불꽃 껍질 — 세로로 늘인 구. 바위를 감싸고 일렁인다.
  const flame = new THREE.SphereGeometry(9, 7, 6);
  flame.scale(1, 1.5, 1);
  const flameMaterials: Record<'hot' | 'blazing', THREE.Material> = {
    hot: new THREE.MeshBasicMaterial({
      color: 0xff8a2a,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    blazing: new THREE.MeshBasicMaterial({
      color: 0xffc23a,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  };

  const trailGeo = new THREE.SphereGeometry(1.5, 5, 4);
  // 뒤로 갈수록 흐려지는 세 단계. 인스턴스마다 머티리얼을 만들지 않고 이 셋을 공유한다.
  const trailMats: THREE.Material[] = [0.5, 0.3, 0.15].map(
    (opacity) =>
      new THREE.MeshBasicMaterial({
        color: 0xfff0c8,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
  );

  // 달군 바위의 잔불 — 화살 트레일과 같은 자리에 색만 다르게
  const emberMats: THREE.Material[] = [0.55, 0.34, 0.16].map(
    (opacity) =>
      new THREE.MeshBasicMaterial({
        color: 0xff7a26,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
  );

  return {
    shaft,
    head,
    material,
    fireArrowMaterial,
    stone,
    shell,
    stoneMaterials,
    shellMaterial,
    flame,
    flameMaterials,
    trailGeo,
    trailMats,
    emberMats,
    dispose: () => {
      shaft.dispose();
      head.dispose();
      material.dispose();
      fireArrowMaterial.dispose();
      stone.dispose();
      shell.dispose();
      for (const m of Object.values(stoneMaterials)) m.dispose();
      shellMaterial.dispose();
      flame.dispose();
      for (const m of Object.values(flameMaterials)) m.dispose();
      trailGeo.dispose();
      for (const m of trailMats) m.dispose();
      for (const m of emberMats) m.dispose();
    },
  };
}
