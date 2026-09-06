import * as THREE from 'three';
import type { Castle } from '../../sim/Castle';
import type { AssetRegistry } from '../AssetRegistry';
import type { Terrain } from '../Terrain';
import type { EntityView, ViewState } from '../EntityView';
import type { PrimitiveSpec } from '../../types/primitives';
import { BALANCE } from '../../data/balance';

/** 호뢰관 — 성문 + 성벽 + 망루 두 채. 프리미티브 조합. */
const CASTLE_PRIMITIVE: PrimitiveSpec = {
  parts: [
    // 성벽 본체
    { shape: 'box', size: [46, 76, 150], offset: [0, 38, 0], color: '#7d7568', roughness: 0.95, tag: 'wall' },
    // 성문 (어두운 아치 대용)
    { shape: 'box', size: [8, 44, 46], offset: [-24, 22, 0], color: '#2e2519', roughness: 1, tag: 'gate' },
    // 총안(성가퀴)
    { shape: 'box', size: [52, 10, 158], offset: [0, 80, 0], color: '#8b8375', roughness: 0.95, tag: 'crenel' },
    // 좌우 망루
    { shape: 'cylinder', size: [17, 19, 40], offset: [0, 96, -62], color: '#6b4f32', roughness: 0.9, tag: 'towerL' },
    { shape: 'cone', size: [26, 18], offset: [0, 124, -62], color: '#7a2e2e', roughness: 0.85 },
    { shape: 'cylinder', size: [17, 19, 40], offset: [0, 96, 62], color: '#6b4f32', roughness: 0.9, tag: 'towerR' },
    { shape: 'cone', size: [26, 18], offset: [0, 124, 62], color: '#7a2e2e', roughness: 0.85 },
    // 한(漢) 깃발
    { shape: 'cylinder', size: [1.4, 1.4, 56], offset: [10, 112, 0], color: '#3a2c1e', roughness: 1 },
    { shape: 'plane', size: [30, 20], offset: [10, 130, 15], color: '#2f4f7a', roughness: 0.95, doubleSided: true, tag: 'flag' },
  ],
};

/**
 * 성문 강화가 보이게 하기
 * ----------------------
 * 단계가 올라도 성이 그대로면 2,720 G를 쓴 보람이 없다. 그래서 단계마다
 * 성벽 위에 실제 물건을 세운다 — 전부 성문 모델 위에 얹는 별도 그룹이라
 * GLTF 성을 써도 그대로 붙는다.
 *   Lv2  좌우 망루에 쇠뇌 거치대
 *   Lv3~5 좌우 포문. 레벨이 오르면 포신이 굵고 길어진다
 *   Lv6  좌우 화룡두(火龍頭) — 붉게 타오르는 용머리. 여기서 불이 나간다
 * 사격 순간에는 그 자리에서 포구 섬광이 터진다(flashMuzzle).
 */
const GATE_LEVEL_TIERS = { crossbow: 2, cannon: 3, dragon: 6 } as const;

/**
 * 성. 피격 시 짧게 붉게 번쩍이고 살짝 흔들린다.
 * 체력 30% 이하부터 상시 경고 상태(은은한 붉은 발광).
 */
export class CastleView implements EntityView<Castle> {
  readonly object3d = new THREE.Group();
  private mats: THREE.MeshStandardMaterial[] = [];
  private baseEmissive: THREE.Color[] = [];
  private flash = 0;
  private shake = 0;
  private warn = false;
  private basePos = new THREE.Vector3();
  /** 강화 단계마다 새로 세우는 물건들. 단계가 바뀌면 통째로 갈아 끼운다. */
  private upgrades = new THREE.Group();
  private muzzles: THREE.Mesh[] = [];
  private muzzleFlash = 0;
  private level = 0;

  constructor(x: number, z: number, terrain: Terrain, assets: AssetRegistry, modelId?: string) {
    const y = terrain.heightAt(x, z);
    // 경로 끝보다 조금 더 동쪽에 세워 적이 성벽에 부딪히는 것처럼 보이게 한다.
    this.basePos.set(x + 46, y, z);
    this.object3d.position.copy(this.basePos);

    const model = assets.getMesh(modelId, CASTLE_PRIMITIVE);
    this.object3d.add(model);
    this.object3d.add(this.upgrades);
    this.setLevel(1);

    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (Array.isArray(m.material) || !mat.isMeshStandardMaterial) return;
      const cloned = mat.clone();
      m.material = cloned;
      m.receiveShadow = true;
      this.mats.push(cloned);
      this.baseEmissive.push(cloned.emissive.clone());
    });
  }

  mount(parent: THREE.Object3D): void {
    parent.add(this.object3d);
  }

  hit(): void {
    this.flash = 1;
    this.shake = 1;
  }

  /**
   * 성문 강화 단계를 반영한다. 같은 단계면 아무 일도 하지 않는다 —
   * 매 프레임 불릴 수 있으므로 실제로 다시 만드는 건 단계가 바뀔 때뿐이다.
   */
  setLevel(level: number): void {
    if (level === this.level) return;
    this.level = level;
    this.upgrades.clear();
    this.muzzles.length = 0;

    const spread = BALANCE.castleCombat.muzzleSpread;
    // 성벽은 z축으로 뻗어 있고 적은 -x 쪽에서 온다. 포문은 그쪽을 향한다.
    for (const side of [-1, 1]) {
      const z = side * spread;

      if (level >= GATE_LEVEL_TIERS.dragon) {
        // 화룡두 — 벌어진 입에서 불이 나간다. 붉게 자체발광해서 멀리서도 보인다.
        const head = new THREE.Mesh(
          _dragonGeo,
          new THREE.MeshStandardMaterial({ color: 0x5a1f14, emissive: 0xff4a10, emissiveIntensity: 1.1, roughness: 0.5, metalness: 0.4 }),
        );
        head.position.set(-26, 104, z);
        head.rotation.z = Math.PI / 2;
        const maw = new THREE.Mesh(_mawGeo, new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.9 }));
        maw.position.set(-40, 104, z);
        this.muzzles.push(maw);
        this.upgrades.add(head, maw);
        continue;
      }

      if (level >= GATE_LEVEL_TIERS.cannon) {
        // 포신은 단계가 오를수록 굵고 길어진다 — Lv5의 4발 연사가 눈으로 구별된다.
        const grow = 1 + (level - GATE_LEVEL_TIERS.cannon) * 0.22;
        const barrel = new THREE.Mesh(_barrelGeo, _barrelMat);
        barrel.scale.set(grow, grow, grow);
        barrel.position.set(-30, 100, z);
        barrel.rotation.z = Math.PI / 2;
        const muzzle = new THREE.Mesh(_mawGeo, new THREE.MeshBasicMaterial({ color: 0xffb13b, transparent: true, opacity: 0 }));
        muzzle.position.set(-30 - 14 * grow, 100, z);
        this.muzzles.push(muzzle);
        this.upgrades.add(barrel, muzzle);
        continue;
      }

      if (level >= GATE_LEVEL_TIERS.crossbow) {
        // 쇠뇌 거치대 — 화살 4발 연사가 어디서 나가는지 보여준다
        const bed = new THREE.Mesh(_bedGeo, _bedMat);
        bed.position.set(-20, 92, z);
        const bow = new THREE.Mesh(_bowGeo, _bedMat);
        bow.position.set(-27, 95, z);
        bow.rotation.x = Math.PI / 2;
        this.upgrades.add(bed, bow);
      }
    }
  }

  /** 사격 순간의 포구 섬광. 강화 단계가 3 이상일 때만 눈에 띈다. */
  flashMuzzle(): void {
    this.muzzleFlash = 1;
  }

  setWarning(on: boolean): void {
    this.warn = on;
  }

  sync(_castle: Castle, _alpha: number, dt: number): void {
    this.setLevel(_castle.level);
    if (this.muzzleFlash > 0) {
      this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 6);
      for (const m of this.muzzles) {
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(this.level >= GATE_LEVEL_TIERS.dragon ? 0.9 : 0, this.muzzleFlash);
        m.scale.setScalar(1 + this.muzzleFlash * 1.4);
      }
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 3.5);
      const a = this.shake * this.shake * 5;
      this.object3d.position.set(
        this.basePos.x + Math.sin(performance.now() * 0.05) * a,
        this.basePos.y,
        this.basePos.z + Math.cos(performance.now() * 0.07) * a,
      );
    }
    if (this.flash > 0 || this.warn) {
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
      const warnPulse = this.warn ? 0.12 + Math.sin(performance.now() * 0.004) * 0.06 : 0;
      const k = Math.max(this.flash * 0.7, warnPulse);
      for (let i = 0; i < this.mats.length; i++) {
        this.mats[i].emissive.copy(this.baseEmissive[i]).lerp(_red, k);
      }
    }
  }

  playState(_state: ViewState): void {}

  dispose(): void {
    this.object3d.removeFromParent();
    for (const m of this.mats) m.dispose();
    this.mats.length = 0;
    // 강화 물건의 머티리얼은 인스턴스마다 새로 만든 것이라 여기서 버린다
    // (지오메트리와 _bedMat/_barrelMat 은 모듈 공유본이라 남긴다).
    this.upgrades.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material !== _bedMat && mesh.material !== _barrelMat) {
        (mesh.material as THREE.Material).dispose();
      }
    });
    this.muzzles.length = 0;
    this.object3d.clear();
  }
}

const _red = new THREE.Color(0xff2a1a);

// 강화 부속의 지오메트리/공용 머티리얼 — 성은 맵에 하나뿐이지만
// 레벨을 다시 만들 때마다 새로 할당하지 않도록 모듈 수준에 둔다.
const _bedGeo = new THREE.BoxGeometry(18, 5, 10);
const _bowGeo = new THREE.CylinderGeometry(0.9, 0.9, 22, 6);
const _bedMat = new THREE.MeshStandardMaterial({ color: 0x4a3622, roughness: 0.9 });
const _barrelGeo = new THREE.CylinderGeometry(5.2, 6.2, 30, 10);
const _barrelMat = new THREE.MeshStandardMaterial({ color: 0x33373c, roughness: 0.4, metalness: 0.8 });
const _dragonGeo = new THREE.ConeGeometry(9, 26, 7);
const _mawGeo = new THREE.SphereGeometry(6, 8, 6);
