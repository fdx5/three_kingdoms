import * as THREE from 'three';
import { BALANCE, type PerformancePreset } from '../../data/balance';

/**
 * 유닛이 죽을 때 지면에 남는 핏자국.
 *
 * 모양은 12가지 패턴을 미리 구워 두고(패턴마다 3가지 시드 변형) 죽을 때마다 하나를 고른다.
 * 여기에 무작위 회전·좌우 반전·크기·색조가 곱해지므로 같은 자국이 두 번 보이지 않는다.
 *
 * 텍스처를 쓰지 않는다 — 패턴은 XZ 평면 위의 불규칙한 타원 덩어리를 하나의
 * 인덱스 지오메트리로 합친 것이고, 가장자리 페더는 정점 알파로 만든다.
 * 덕분에 데칼 하나 = 드로우콜 하나이고, 캔버스가 없는 환경(테스트)에서도 만들어진다.
 */
export type BloodPatternId =
  /** 사방으로 뻗는 별 모양 — 정면에서 한 방에 갔다 */
  | 'star_burst'
  /** 한쪽으로 쏟아진 부채꼴 분사 */
  | 'fan_spray'
  /** 굵은 방울이 흩어진 자국 */
  | 'droplet_field'
  /** 길게 끌린 한 줄기 */
  | 'long_streak'
  /** 큰 웅덩이와 바깥으로 튄 고리 */
  | 'pool_ring'
  /** 두 덩이와 그것을 잇는 다리 */
  | 'twin_blob'
  /** 휘두른 무기를 따라간 초승달 호 */
  | 'crescent_arc'
  /** 미세한 안개처럼 퍼진 점들 */
  | 'mist_cloud'
  /** 네 방향으로 갈라진 십자 */
  | 'cross_spatter'
  /** 머리가 굵고 꼬리가 가는 혜성 */
  | 'comet_tail'
  /** 뾰족한 파편이 방사로 박힌 자국 */
  | 'shard_burst'
  /** 넓게 고인 웅덩이와 흘러내린 방울들 */
  | 'puddle_drips';

export const BLOOD_PATTERNS: readonly BloodPatternId[] = [
  'star_burst',
  'fan_spray',
  'droplet_field',
  'long_streak',
  'pool_ring',
  'twin_blob',
  'crescent_arc',
  'mist_cloud',
  'cross_spatter',
  'comet_tail',
  'shard_burst',
  'puddle_drips',
];

/** 패턴마다 구워 두는 시드 변형 수 */
const VARIANTS = 3;

/** 갓 튄 피 → 마른 피. 시간이 지나면 어두워진다. */
const FRESH = new THREE.Color(0x9e0f14);
const DRIED = new THREE.Color(0x3d1109);

// ── 패턴 정의 ────────────────────────────────────────────────────────
// 좌표계는 반지름 1 기준의 XZ 평면. 실제 크기는 메시 스케일이 정한다.

interface Blob {
  x: number;
  z: number;
  /** 장축/단축 반지름 */
  rx: number;
  rz: number;
  rot: number;
  alpha: number;
  /** 정점 색 배율 — 덩어리마다 농도가 다르다 */
  shade: number;
  /** 외곽선 일그러짐 (0=매끈한 타원, 1=너덜너덜) */
  wobble: number;
}

type Rng = () => number;

function makeRng(seed: number): Rng {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** [a,b) 균등 난수 */
function range(rng: Rng, a: number, b: number): number {
  return a + rng() * (b - a);
}

function blob(
  out: Blob[],
  rng: Rng,
  x: number,
  z: number,
  rx: number,
  rz: number,
  rot: number,
  alpha: number,
  wobble = 0.85,
): void {
  out.push({ x, z, rx, rz, rot, alpha, shade: range(rng, 0.72, 1.0), wobble });
}

/** 한 방향으로 튄 방울들. 멀어질수록 작아지고 옅어진다. */
function spray(
  out: Blob[],
  rng: Rng,
  angle: number,
  spread: number,
  count: number,
  near: number,
  far: number,
  size: number,
): void {
  for (let i = 0; i < count; i++) {
    const t = (i + rng()) / count;
    const a = angle + range(rng, -spread, spread);
    const d = near + t * (far - near) * range(rng, 0.7, 1.25);
    const r = size * (1 - t * 0.72) * range(rng, 0.55, 1.2);
    // 날아간 방향으로 늘어난다 — 이게 있어야 "튀었다"로 읽힌다
    blob(out, rng, Math.cos(a) * d, Math.sin(a) * d, r * range(rng, 1.1, 2.1), r, a, range(rng, 0.55, 0.95));
  }
}

/** 굵은 머리에서 가는 꼬리로 이어지는 줄기 */
function streak(
  out: Blob[],
  rng: Rng,
  x: number,
  z: number,
  angle: number,
  length: number,
  head: number,
  count: number,
  curve = 0,
): void {
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const a = angle + curve * t;
    const d = t * length;
    const r = head * (1 - t * 0.85) * range(rng, 0.85, 1.15);
    blob(
      out,
      rng,
      x + Math.cos(a) * d,
      z + Math.sin(a) * d,
      r * range(rng, 1.2, 1.7),
      r,
      a,
      range(rng, 0.6, 1.0) * (1 - t * 0.35),
    );
  }
}

/** 중심 웅덩이 — 거의 모든 패턴이 이걸 깔고 시작한다 */
function pool(out: Blob[], rng: Rng, radius: number, alpha = 0.95): void {
  blob(out, rng, 0, 0, radius * range(rng, 0.9, 1.15), radius * range(rng, 0.82, 1.05), rng() * Math.PI, alpha, 1);
  const lobes = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < lobes; i++) {
    const a = rng() * Math.PI * 2;
    const d = radius * range(rng, 0.5, 0.95);
    const r = radius * range(rng, 0.3, 0.62);
    blob(out, rng, Math.cos(a) * d, Math.sin(a) * d, r * range(rng, 1.0, 1.5), r, a, alpha * range(rng, 0.8, 1.0));
  }
}

const BUILDERS: Record<BloodPatternId, (rng: Rng, out: Blob[]) => void> = {
  star_burst: (rng, out) => {
    pool(out, rng, 0.3);
    const arms = 7 + Math.floor(rng() * 4);
    const base = rng() * Math.PI * 2;
    for (let i = 0; i < arms; i++) {
      const a = base + (i / arms) * Math.PI * 2 + range(rng, -0.18, 0.18);
      streak(out, rng, Math.cos(a) * 0.16, Math.sin(a) * 0.16, a, range(rng, 0.45, 0.95), 0.1, 4);
    }
    spray(out, rng, base, Math.PI, 10, 0.55, 1.0, 0.07);
  },

  fan_spray: (rng, out) => {
    const dir = rng() * Math.PI * 2;
    pool(out, rng, 0.24);
    spray(out, rng, dir, 0.55, 20, 0.2, 1.0, 0.13);
    spray(out, rng, dir, 0.9, 10, 0.5, 1.05, 0.07);
    streak(out, rng, 0, 0, dir, 0.55, 0.15, 5);
  },

  droplet_field: (rng, out) => {
    pool(out, rng, 0.22, 0.85);
    const n = 16 + Math.floor(rng() * 6);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const d = range(rng, 0.2, 1.0) ** 0.7;
      const r = range(rng, 0.05, 0.16) * (1.15 - d * 0.5);
      blob(out, rng, Math.cos(a) * d, Math.sin(a) * d, r * range(rng, 1.0, 1.6), r, a, range(rng, 0.6, 1.0));
    }
  },

  long_streak: (rng, out) => {
    const dir = rng() * Math.PI * 2;
    streak(out, rng, -Math.cos(dir) * 0.5, -Math.sin(dir) * 0.5, dir, 1.5, 0.22, 9, range(rng, -0.5, 0.5));
    spray(out, rng, dir + Math.PI / 2, 0.4, 6, 0.15, 0.5, 0.06);
    spray(out, rng, dir - Math.PI / 2, 0.4, 6, 0.15, 0.5, 0.06);
  },

  pool_ring: (rng, out) => {
    pool(out, rng, 0.5);
    const n = 12 + Math.floor(rng() * 6);
    const rad = range(rng, 0.72, 0.95);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + range(rng, -0.2, 0.2);
      const d = rad * range(rng, 0.85, 1.2);
      const r = range(rng, 0.06, 0.15);
      blob(out, rng, Math.cos(a) * d, Math.sin(a) * d, r * range(rng, 1.2, 2.0), r, a, range(rng, 0.5, 0.9));
    }
  },

  twin_blob: (rng, out) => {
    const a = rng() * Math.PI * 2;
    const gap = range(rng, 0.45, 0.7);
    const big = range(rng, 0.34, 0.44);
    const small = big * range(rng, 0.5, 0.75);
    blob(out, rng, -Math.cos(a) * gap, -Math.sin(a) * gap, big * 1.15, big, a, 0.95, 1);
    blob(out, rng, Math.cos(a) * gap, Math.sin(a) * gap, small * 1.2, small, a, 0.9, 1);
    // 두 덩이를 잇는 가는 다리
    streak(out, rng, -Math.cos(a) * gap, -Math.sin(a) * gap, a, gap * 2, 0.09, 6);
    spray(out, rng, a + Math.PI / 2, 1.2, 8, 0.4, 0.9, 0.06);
  },

  crescent_arc: (rng, out) => {
    const start = rng() * Math.PI * 2;
    const sweep = range(rng, 1.5, 2.6) * (rng() < 0.5 ? -1 : 1);
    const rad = range(rng, 0.6, 0.85);
    const n = 14;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = start + sweep * t;
      // 호의 가운데가 가장 굵다 — 휘두른 궤적의 힘이 실린 지점
      const thick = Math.sin(Math.PI * t) * range(rng, 0.09, 0.15) + 0.03;
      blob(
        out,
        rng,
        Math.cos(a) * rad * range(rng, 0.94, 1.06),
        Math.sin(a) * rad * range(rng, 0.94, 1.06),
        thick * range(rng, 1.4, 2.2),
        thick,
        a + Math.PI / 2,
        range(rng, 0.65, 1.0),
      );
    }
    spray(out, rng, start + sweep * 1.15, 0.35, 7, 0.85, 1.15, 0.06);
  },

  mist_cloud: (rng, out) => {
    blob(out, rng, 0, 0, 0.2, 0.17, rng() * Math.PI, 0.7, 1);
    const n = 34 + Math.floor(rng() * 12);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng());
      const r = range(rng, 0.02, 0.065);
      blob(out, rng, Math.cos(a) * d, Math.sin(a) * d, r * range(rng, 1.0, 1.5), r, a, range(rng, 0.35, 0.75), 0.5);
    }
  },

  cross_spatter: (rng, out) => {
    pool(out, rng, 0.26);
    const base = rng() * Math.PI * 2;
    for (let i = 0; i < 4; i++) {
      const a = base + (i / 4) * Math.PI * 2 + range(rng, -0.12, 0.12);
      const len = range(rng, 0.6, 1.0);
      streak(out, rng, 0, 0, a, len, 0.13, 5);
      spray(out, rng, a, 0.22, 4, len, len + 0.25, 0.055);
    }
  },

  comet_tail: (rng, out) => {
    const dir = rng() * Math.PI * 2;
    const head = range(rng, 0.32, 0.42);
    blob(out, rng, -Math.cos(dir) * 0.35, -Math.sin(dir) * 0.35, head * 1.25, head, dir, 0.95, 1);
    streak(out, rng, -Math.cos(dir) * 0.3, -Math.sin(dir) * 0.3, dir, 1.35, 0.2, 10, range(rng, -0.35, 0.35));
    spray(out, rng, dir, 0.3, 9, 0.9, 1.35, 0.06);
  },

  shard_burst: (rng, out) => {
    pool(out, rng, 0.2, 0.9);
    const shards = 9 + Math.floor(rng() * 5);
    const base = rng() * Math.PI * 2;
    for (let i = 0; i < shards; i++) {
      const a = base + (i / shards) * Math.PI * 2 + range(rng, -0.25, 0.25);
      const len = range(rng, 0.35, 1.0);
      // 가늘고 뾰족한 파편 — 방울이 아니라 창끝처럼 보여야 한다
      const n = 4;
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        const d = 0.1 + t * len;
        const r = 0.075 * (1 - t) ** 1.5 + 0.012;
        blob(out, rng, Math.cos(a) * d, Math.sin(a) * d, r * 2.6, r, a, range(rng, 0.6, 0.95), 0.4);
      }
    }
  },

  puddle_drips: (rng, out) => {
    pool(out, rng, 0.55);
    blob(out, rng, range(rng, -0.2, 0.2), range(rng, -0.2, 0.2), 0.42, 0.32, rng() * Math.PI, 0.9, 1);
    const drips = 5 + Math.floor(rng() * 4);
    for (let i = 0; i < drips; i++) {
      const a = rng() * Math.PI * 2;
      const len = range(rng, 0.25, 0.55);
      streak(out, rng, Math.cos(a) * 0.5, Math.sin(a) * 0.5, a, len, 0.1, 4);
      blob(
        out,
        rng,
        Math.cos(a) * (0.5 + len + 0.08),
        Math.sin(a) * (0.5 + len + 0.08),
        0.055,
        0.045,
        a,
        range(rng, 0.5, 0.8),
      );
    }
  },
};

// ── 지오메트리 굽기 ──────────────────────────────────────────────────

/**
 * 덩어리들을 XZ 평면 위의 인덱스 지오메트리 하나로 합친다.
 * 각 덩어리는 중심 → 코어 링 → 페더 링 구조라 가장자리가 알파로 부드럽게 사라진다.
 */
function bakeGeometry(pattern: BloodPatternId, seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const blobs: Blob[] = [];
  BUILDERS[pattern](rng, blobs);

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const b of blobs) {
    const size = Math.max(b.rx, b.rz);
    const seg = Math.max(7, Math.min(16, Math.round(7 + size * 20)));
    const p1 = rng() * Math.PI * 2;
    const p2 = rng() * Math.PI * 2;
    const p3 = rng() * Math.PI * 2;
    const cos = Math.cos(b.rot);
    const sin = Math.sin(b.rot);
    const base = positions.length / 3;

    positions.push(b.x, 0, b.z);
    colors.push(b.shade, b.shade, b.shade, b.alpha);

    for (let ring = 0; ring < 2; ring++) {
      // 안쪽 링까지는 꽉 찬 색, 바깥 링에서 0으로 사라진다
      const t = ring === 0 ? 0.74 : 1;
      const a = ring === 0 ? b.alpha : 0;
      for (let s = 0; s < seg; s++) {
        const th = (s / seg) * Math.PI * 2;
        const wob =
          1 +
          b.wobble * (0.2 * Math.sin(3 * th + p1) + 0.13 * Math.sin(5 * th + p2) + 0.08 * Math.sin(8 * th + p3));
        const lx = Math.cos(th) * b.rx * wob * t;
        const lz = Math.sin(th) * b.rz * wob * t;
        positions.push(b.x + lx * cos - lz * sin, 0, b.z + lx * sin + lz * cos);
        colors.push(b.shade, b.shade, b.shade, a);
      }
    }

    const inner = base + 1;
    const outer = inner + seg;
    for (let s = 0; s < seg; s++) {
      const n = (s + 1) % seg;
      indices.push(base, inner + n, inner + s);
      indices.push(inner + s, inner + n, outer + n);
      indices.push(inner + s, outer + n, outer + s);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);
  return geo;
}

/** 미리 구운 패턴 지오메트리 — 패턴 12종 × 시드 변형 3종 */
export function bakeBloodGeometries(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let p = 0; p < BLOOD_PATTERNS.length; p++) {
    for (let v = 0; v < VARIANTS; v++) out.push(bakeGeometry(BLOOD_PATTERNS[p], p * 97 + v * 7919 + 13));
  }
  return out;
}

interface Decal {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  /** 완전히 퍼진 뒤의 최종 크기 */
  size: number;
  peak: number;
  active: boolean;
}

/**
 * 핏자국 풀. 데칼은 지면에 눕고, 퍼지고, 마르고, 사라진다.
 * 상한을 넘으면 가장 오래된 자국부터 다시 쓴다 — 할당이 없다.
 */
export class BloodDecals {
  readonly group = new THREE.Group();

  private geometries = bakeBloodGeometries();
  private decals: Decal[] = [];
  private active: Decal[] = [];
  private budget: number;
  private rngState = 0x9e3779b9;

  constructor(preset: PerformancePreset) {
    this.budget = this.budgetFor(preset);
    this.group.renderOrder = 1;
    // 데칼은 시야 판정을 거치지 않는다 — 지면에 붙어 있어 항상 카메라 안이다
    this.group.frustumCulled = false;
  }

  private budgetFor(preset: PerformancePreset): number {
    return Math.max(8, Math.round(BALANCE.fx.blood.maxDecals * preset.particleScale));
  }

  /** 연출용 난수 (시뮬 결정론과 분리) */
  private rand(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  /**
   * 죽은 자리에 핏자국을 남긴다.
   * @param intensity 유닛 크기 배율. 큰 놈일수록 넓게 터진다.
   */
  splat(x: number, y: number, z: number, intensity = 1): void {
    const cfg = BALANCE.fx.blood;
    const decal = this.take();
    const geo = this.geometries[Math.floor(this.rand() * this.geometries.length)];
    decal.mesh.geometry = geo;

    const size = cfg.baseRadius * intensity * (0.78 + this.rand() * 0.55);
    decal.size = size;
    // 좌우 반전 + 무작위 회전 + 살짝 찌그러뜨리기 = 같은 패턴도 다른 자국이 된다
    decal.mesh.rotation.y = this.rand() * Math.PI * 2;
    decal.mesh.userData.flip = this.rand() < 0.5 ? -1 : 1;
    decal.mesh.userData.squash = 0.82 + this.rand() * 0.36;
    // 겹쳐도 z-파이팅이 나지 않게 자국마다 아주 조금씩 띄운다
    decal.mesh.position.set(x, y + cfg.lift + this.rand() * cfg.liftJitter, z);

    decal.material.color.copy(FRESH);
    decal.peak = cfg.opacity * (0.82 + this.rand() * 0.18);
    decal.material.opacity = 0;
    decal.age = 0;
    decal.life = cfg.holdSec * (0.75 + this.rand() * 0.5) + cfg.fadeSec;
    decal.mesh.visible = true;
    this.applyScale(decal, 0);
  }

  private applyScale(decal: Decal, spread: number): void {
    // 착지 순간 안쪽에서 바깥으로 번진다
    const s = decal.size * (0.5 + spread * 0.5);
    const flip = decal.mesh.userData.flip as number;
    const squash = decal.mesh.userData.squash as number;
    decal.mesh.scale.set(s * flip, 1, s * squash);
  }

  private take(): Decal {
    for (const d of this.decals) {
      if (!d.active) {
        d.active = true;
        this.active.push(d);
        return d;
      }
    }
    if (this.decals.length < this.budget) {
      const material = new THREE.MeshBasicMaterial({
        color: FRESH,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      const mesh = new THREE.Mesh(this.geometries[0], material);
      mesh.renderOrder = 1;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      const decal: Decal = { mesh, material, age: 0, life: 0, size: 1, peak: 1, active: true };
      this.decals.push(decal);
      this.active.push(decal);
      return decal;
    }
    // 자리가 없으면 가장 오래된 자국을 덮어쓴다
    const oldest = this.active.shift()!;
    this.active.push(oldest);
    return oldest;
  }

  update(dt: number): void {
    const cfg = BALANCE.fx.blood;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const d = this.active[i];
      d.age += dt;
      if (d.age >= d.life) {
        d.active = false;
        d.mesh.visible = false;
        this.active.splice(i, 1);
        continue;
      }
      const spread = Math.min(1, d.age / cfg.spreadSec);
      this.applyScale(d, 1 - (1 - spread) ** 3);

      const fadeIn = Math.min(1, d.age / cfg.fadeInSec);
      const remain = d.life - d.age;
      const fadeOut = remain < cfg.fadeSec ? remain / cfg.fadeSec : 1;
      d.material.opacity = d.peak * fadeIn * fadeOut;

      // 피는 마르면서 검붉게 가라앉는다
      const dry = Math.min(1, d.age / cfg.drySec);
      d.material.color.copy(FRESH).lerp(DRIED, dry);
    }
  }

  /** 성능 프리셋이 바뀌면 상한을 다시 잡고 초과분을 지운다 */
  setPreset(preset: PerformancePreset): void {
    this.budget = this.budgetFor(preset);
    while (this.decals.length > this.budget) {
      const d = this.decals.pop()!;
      const at = this.active.indexOf(d);
      if (at >= 0) this.active.splice(at, 1);
      d.mesh.removeFromParent();
      d.material.dispose();
    }
  }

  /** 스테이지가 초기화될 때 (레벨 재시작 등) 즉시 비운다 */
  clear(): void {
    for (const d of this.decals) {
      d.active = false;
      d.mesh.visible = false;
    }
    this.active.length = 0;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const d of this.decals) d.material.dispose();
    this.decals.length = 0;
    this.active.length = 0;
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    this.group.clear();
  }
}
