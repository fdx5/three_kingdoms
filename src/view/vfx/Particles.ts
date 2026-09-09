import * as THREE from 'three';
import { BALANCE, type PerformancePreset } from '../../data/balance';

const DYNAMIC_ATTRIBUTES = ['position', 'particleSize', 'particleAlpha', 'color'] as const;

export type ParticlePreset =
  | 'hit_spark'
  | 'death_dust'
  | 'castle_hit'
  | 'upgrade_ray'
  | 'splash_burst'
  | 'slow_dust'
  | 'charge_trail'
  | 'fire_burst'
  | 'weapon_spark'
  | 'blood_spray'
  | 'blood_mist'
  | 'muzzle_smoke'
  | 'ground_smoke'
  | 'wood_splinter'
  | 'stone_chip'
  | 'tower_rubble'
  | 'repair_dust';

interface PresetSpec {
  count: number;
  color: number;
  size: number;
  life: [number, number];
  speed: [number, number];
  /** 위로 쏘는 성향 (0=평면, 1=수직) */
  up: number;
  gravity: number;
  spread: number;
}

const PRESETS: Record<ParticlePreset, PresetSpec> = {
  hit_spark: { count: 8, color: 0xffe6a3, size: 3.4, life: [0.16, 0.3], speed: [70, 160], up: 0.4, gravity: -260, spread: 1 },
  death_dust: { count: 16, color: 0xa89372, size: 5.2, life: [0.35, 0.65], speed: [22, 62], up: 0.25, gravity: -70, spread: 1 },
  castle_hit: { count: 24, color: 0xc9b79a, size: 4.6, life: [0.4, 0.8], speed: [90, 210], up: 0.6, gravity: -320, spread: 1 },
  upgrade_ray: { count: 20, color: 0xffe07a, size: 4.0, life: [0.5, 0.9], speed: [40, 95], up: 1.0, gravity: 42, spread: 0.18 },
  // 벽력거 착탄 — 흙과 돌 파편이 넓게 퍼진다
  splash_burst: { count: 22, color: 0xb9a888, size: 6.5, life: [0.3, 0.6], speed: [80, 190], up: 0.45, gravity: -300, spread: 1 },
  // 철질려에 걸린 적 발밑 먼지
  slow_dust: { count: 4, color: 0x9fd8ff, size: 3.2, life: [0.25, 0.5], speed: [10, 30], up: 0.2, gravity: -40, spread: 1 },
  // 여포 돌진
  charge_trail: { count: 6, color: 0xff9a4a, size: 4.5, life: [0.25, 0.45], speed: [20, 60], up: 0.5, gravity: -30, spread: 1 },
  // 계략 화공 — 적 발밑에서 치솟는 불길
  fire_burst: { count: 10, color: 0xff6a1e, size: 6.2, life: [0.3, 0.62], speed: [40, 130], up: 0.85, gravity: -110, spread: 1 },
  // 무기가 성벽을 때리는 순간의 불꽃 — 짧고 빠르고 밝다
  weapon_spark: { count: 26, color: 0xffe9a8, size: 3.6, life: [0.18, 0.42], speed: [140, 320], up: 0.55, gravity: -520, spread: 1 },
  // 유닛이 죽는 순간 공중으로 튀는 피 — 무겁고 빠르게 떨어져 바닥 자국으로 이어진다
  blood_spray: { count: 18, color: 0x8e1113, size: 4.4, life: [0.22, 0.5], speed: [60, 190], up: 0.55, gravity: -520, spread: 1 },
  // 그 위로 잠깐 떠 있는 붉은 안개
  blood_mist: { count: 10, color: 0x5e0a0c, size: 6.8, life: [0.3, 0.6], speed: [14, 46], up: 0.35, gravity: -90, spread: 1 },
  /*
   * 화약 연기 — 지금까지의 프리셋과 반대로 **뜬다**.
   *
   * 다른 입자는 전부 중력이 음수라 떨어지고 바닥에 눌어붙는다. 연기는 그러면 안 된다:
   * 떨어지는 회색 점은 연기가 아니라 재로 보인다. 그래서 gravity 를 양수로 두어
   * 시간이 갈수록 위로 밀리게 하고, 대신 수명을 길게 잡아 천천히 흩어지게 한다.
   *
   * 크기를 크게 잡는 데는 이유가 둘이다. 입자 수를 늘리는 것보다 덩어리를 키우는 게
   * 싸고, 이 시스템은 입자마다 투명도를 줄 수 없어 **작아지는 것으로 사라짐을 흉내내기**
   * 때문이다(update 의 size 곡선). 크게 태어나 줄어드는 회색 덩어리가 흩어지는 연기다.
   */
  // 포구에서 옆으로 뿜었다가 떠오르는 연기. 포신 방향으로 뿜으므로 up 이 낮다.
  muzzle_smoke: { count: 12, color: 0x9a958c, size: 9.5, life: [0.6, 1.15], speed: [30, 78], up: 0.3, gravity: 26, spread: 1 },
  // 착탄 지점에서 피어오르는 연기 기둥. 위로 곧게 서야 폭발로 읽힌다.
  ground_smoke: { count: 14, color: 0x6f6a63, size: 12, life: [0.8, 1.5], speed: [26, 70], up: 0.8, gravity: 34, spread: 1 },
  /*
   * 도끼가 기둥을 찍을 때 튀는 나뭇조각.
   *
   * 불티(weapon_spark)와 다르게 무겁고 느리다. 쇠가 쇠를 칠 때는 빛이 튀지만
   * 쇠가 나무를 칠 때는 조각이 떨어진다 — 망루가 **목조**라는 것이
   * 이 한 프리셋으로 읽힌다. 그래서 수명이 길고 중력이 세다: 튀었다가
   * 눈에 보이는 속도로 떨어져야 무게가 있다.
   */
  wood_splinter: { count: 14, color: 0x7a5632, size: 4.2, life: [0.35, 0.7], speed: [60, 165], up: 0.5, gravity: -420, spread: 1 },
  // 돌로 쌓은 진지(화포)를 칠 때. 나뭇조각보다 밝고 작고 더 빨리 떨어진다.
  stone_chip: { count: 12, color: 0x9a938a, size: 3.6, life: [0.28, 0.55], speed: [70, 180], up: 0.45, gravity: -520, spread: 1 },
  /*
   * 망루가 무너질 때 쏟아지는 잔해. 이 게임에서 가장 큰 입자다 —
   * 기둥과 지붕이 통째로 부서지는 것이라 흙먼지(splash_burst)로는 모자란다.
   */
  tower_rubble: { count: 34, color: 0x6b4f32, size: 9.5, life: [0.6, 1.25], speed: [90, 260], up: 0.6, gravity: -380, spread: 1 },
  // 수리 — 대패밥과 먼지가 위로 인다. 골드를 썼다는 것이 눈에 보여야 한다.
  repair_dust: { count: 16, color: 0xe6d3a8, size: 5.0, life: [0.45, 0.85], speed: [30, 80], up: 0.9, gravity: 30, spread: 0.5 },
};

/**
 * 입자 한 알의 모양 — 가운데가 진하고 가장자리로 사라지는 흰 원.
 *
 * 이게 없으면 `PointsMaterial` 은 입자를 **네모**로 그린다. 불티나 피처럼
 * 작고 빠른 입자는 네모여도 티가 안 나지만, 연기처럼 크고 오래 남는 입자는
 * 회색 사각형이 둥둥 떠다니는 것으로 보인다(실제로 그랬다).
 *
 * 색은 정점 색이 곱해지므로 여기서는 흰색만 두고 알파만 만든다.
 * 32x32면 충분하다 — 화면에서 가장 큰 입자도 스무 픽셀 남짓이다.
 */
function softSprite(): THREE.DataTexture {
  const size = 32;
  const pixels = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) / size * 2 - 1;
      const y = (j + 0.5) / size * 2 - 1;
      const r = Math.hypot(x, y);
      // 가장자리에서 0, 가운데에서 1. 제곱해서 중심을 뭉쳐 준다.
      const a = Math.pow(Math.max(0, 1 - r), 1.6);
      const k = (j * size + i) * 4;
      pixels[k] = 255;
      pixels[k + 1] = 255;
      pixels[k + 2] = 255;
      pixels[k + 3] = Math.min(255, Math.round(a * 255));
    }
  }
  const tex = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 가벼운 자체 파티클 시스템. 라이브러리 도입 금지.
 * 하나의 Points 버퍼를 재사용하고 죽은 입자 슬롯을 다시 쓴다 — 할당이 없다.
 * 최대 동시 입자 수는 성능 프리셋에 따라 정해진다.
 */
export class ParticleSystem {
  readonly points: THREE.Points;
  private geometry = new THREE.BufferGeometry();
  private material: THREE.PointsMaterial;
  private sprite: THREE.DataTexture;

  private capacity: number;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private alphas: Float32Array;
  private smoke: Uint8Array;
  private activeCount = 0;
  private limit = 0;
  private color = new THREE.Color();

  private velX: Float32Array;
  private velY: Float32Array;
  private velZ: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private gravity: Float32Array;
  private baseSize: Float32Array;

  private scalarData: (Float32Array | Uint8Array)[];
  private cursor = 0;
  private scale = 1;
  private rngState = 0x1a2b3c;

  constructor(preset: PerformancePreset) {
    this.scale = preset.particleScale;
    this.capacity = BALANCE.maxParticles;
    this.limit = Math.max(32, Math.round(this.capacity * this.scale));

    this.positions = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.sizes = new Float32Array(this.capacity);
    this.alphas = new Float32Array(this.capacity);
    this.smoke = new Uint8Array(this.capacity);
    this.velX = new Float32Array(this.capacity);
    this.velY = new Float32Array(this.capacity);
    this.velZ = new Float32Array(this.capacity);
    this.life = new Float32Array(this.capacity);
    this.maxLife = new Float32Array(this.capacity);
    this.gravity = new Float32Array(this.capacity);
    this.baseSize = new Float32Array(this.capacity);
    this.scalarData = [this.sizes, this.alphas, this.smoke, this.velX, this.velY, this.velZ,
      this.life, this.maxLife, this.gravity, this.baseSize];

    // Reserve the high budget once; drawRange excludes all unused slots.
    for (let i = 0; i < this.capacity; i++) this.positions[i * 3 + 1] = -9999;

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('particleSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('particleAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(600, 0, 350), 3000);

    this.sprite = softSprite();
    this.material = new THREE.PointsMaterial({
      size: 1,
      map: this.sprite,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.NormalBlending,
    });
    // PointsMaterial ignores custom size attributes unless its shader reads them.
    // Retain Three's fog, tone mapping, DPR and perspective attenuation.
    this.material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>',
        '#include <common>\nattribute float particleSize;\nattribute float particleAlpha;\nvarying float vParticleAlpha;')
        .replace('gl_PointSize = size;', 'gl_PointSize = size * particleSize;\nvParticleAlpha = particleAlpha;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
        '#include <common>\nvarying float vParticleAlpha;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vParticleAlpha;');
    };
    this.material.customProgramCacheKey = () => 'battle-particles-size-alpha-v1';

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.points.visible = false;
  }

  /** 결정론이 필요 없는 연출용 난수 (시뮬과 분리) */
  private rand(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  emit(preset: ParticlePreset, x: number, y: number, z: number, intensity = 1): void {
    const spec = PRESETS[preset];
    const count = Math.max(1, Math.round(spec.count * this.scale * intensity));
    if (intensity <= 0 || this.scale <= 0) return;
    const color = this.color.set(spec.color);

    for (let i = 0; i < count; i++) {
      const idx = this.activeCount < this.limit ? this.activeCount++ : this.cursor++ % this.limit;

      const theta = this.rand() * Math.PI * 2;
      const upBias = spec.up;
      const horiz = (1 - upBias) + this.rand() * spec.spread;
      const speed = spec.speed[0] + this.rand() * (spec.speed[1] - spec.speed[0]);

      this.velX[idx] = Math.cos(theta) * horiz * speed;
      this.velZ[idx] = Math.sin(theta) * horiz * speed;
      this.velY[idx] = (upBias + this.rand() * 0.5) * speed;
      this.gravity[idx] = spec.gravity;

      const life = spec.life[0] + this.rand() * (spec.life[1] - spec.life[0]);
      this.life[idx] = life;
      this.maxLife[idx] = life;

      this.positions[idx * 3] = x;
      this.positions[idx * 3 + 1] = y;
      this.positions[idx * 3 + 2] = z;

      this.colors[idx * 3] = color.r;
      this.colors[idx * 3 + 1] = color.g;
      this.colors[idx * 3 + 2] = color.b;

      this.baseSize[idx] = spec.size;
      this.sizes[idx] = spec.size;
      this.alphas[idx] = 1;
      this.smoke[idx] = Number(preset === 'muzzle_smoke' || preset === 'ground_smoke' || preset === 'blood_mist' || preset === 'death_dust');
    }
    this.points.visible = true;
    this.upload(true);
  }

  update(dt: number): void {
    if (this.activeCount === 0 || dt <= 0) return;
    let moved = false;
    const drag = Math.exp(-1.8 * dt);
    const friction = Math.exp(-21.4 * dt);
    for (let i = 0; i < this.activeCount; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // Keep live slots contiguous: only live particles are simulated and drawn.
        const last = --this.activeCount;
        if (i !== last) {
          for (const data of this.scalarData) data[i] = data[last];
          this.positions.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.colors.copyWithin(i * 3, last * 3, last * 3 + 3);
          moved = true;
        }
        this.life[last] = 0;
        this.positions[last * 3 + 1] = -9999;
        this.sizes[last] = 0;
        this.alphas[last] = 0;
        i--;
        continue;
      }
      this.velY[i] += this.gravity[i] * dt;
      if (this.smoke[i]) {
        this.velX[i] *= drag;
        this.velZ[i] *= drag;
      }
      this.positions[i * 3] += this.velX[i] * dt;
      this.positions[i * 3 + 1] += this.velY[i] * dt;
      this.positions[i * 3 + 2] += this.velZ[i] * dt;
      // 지면 아래로 내려가면 붙는다
      if (this.positions[i * 3 + 1] < 0.5) {
        this.positions[i * 3 + 1] = 0.5;
        this.velY[i] = 0;
        this.velX[i] *= friction;
        this.velZ[i] *= friction;
      }
      const t = this.life[i] / this.maxLife[i];
      this.sizes[i] = this.baseSize[i] * (this.smoke[i] ? 1 + (1 - t) * 1.4 : 0.35 + t * 0.65);
      this.alphas[i] = t * t * (3 - 2 * t);
    }
    this.upload(moved);
    this.points.visible = this.activeCount > 0;
  }

  private upload(colors: boolean): void {
    this.geometry.setDrawRange(0, this.activeCount);
    for (const name of DYNAMIC_ATTRIBUTES) {
      if (name === 'color' && !colors) continue;
      const attribute = this.geometry.getAttribute(name) as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      if (this.activeCount > 0) {
        attribute.addUpdateRange(0, this.activeCount * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    }
  }

  setPreset(preset: PerformancePreset): void {
    this.scale = preset.particleScale;
    this.limit = Math.max(32, Math.round(this.capacity * this.scale));
    for (let i = this.limit; i < this.activeCount; i++) {
      this.life[i] = 0;
      this.positions[i * 3 + 1] = -9999;
    }
    this.activeCount = Math.min(this.activeCount, this.limit);
    this.upload(true);
    this.points.visible = this.activeCount > 0;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.sprite.dispose();
  }
}
