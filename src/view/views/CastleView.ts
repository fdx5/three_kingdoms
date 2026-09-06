import * as THREE from 'three';
import type { Castle } from '../../sim/Castle';
import type { AssetRegistry } from '../AssetRegistry';
import type { Terrain } from '../Terrain';
import type { EntityView, ViewState } from '../EntityView';
import type { PrimitiveSpec } from '../../types/primitives';
import { MAX_CASTLE_LEVEL } from '../../data/castle';

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


/**
 * 성. 피격 시 짧게 붉게 번쩍이고 살짝 흔들린다.
 * 체력 30% 이하부터 상시 경고 상태(은은한 붉은 발광).
 */
interface WeaponMount {
  pivot: THREE.Group;
  carriage: THREE.Group;
  muzzle: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  recoil: number;
}

export class CastleView implements EntityView<Castle> {
  readonly object3d = new THREE.Group();
  private model: THREE.Object3D;
  private bounds: THREE.Box3;
  private mats: THREE.MeshStandardMaterial[] = [];
  private baseEmissive: THREE.Color[] = [];
  private upgrades = new THREE.Group();
  private weapons: WeaponMount[] = [];
  private ownedMaterials: THREE.Material[] = [];
  private basePos = new THREE.Vector3();
  private flash = 0;
  private shake = 0;
  private warn = false;
  private level = 0;
  private target = new THREE.Vector3();

  constructor(x: number, z: number, terrain: Terrain, assets: AssetRegistry, modelId?: string,
    approach = { x: 1, z: 0 }) {
    const length = Math.hypot(approach.x, approach.z) || 1;
    this.basePos.set(x + approach.x / length * 46, terrain.heightAt(x, z), z + approach.z / length * 46);
    this.object3d.position.copy(this.basePos);
    this.object3d.rotation.y = Math.atan2(-approach.z, approach.x);
    this.model = assets.getMesh(modelId, CASTLE_PRIMITIVE);
    // Measure and raycast in castle-local space before mounting it in the world.
    this.model.updateMatrixWorld(true);
    this.bounds = new THREE.Box3().setFromObject(this.model);
    this.model.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const clone = (mat: THREE.Material) => {
        if (!(mat instanceof THREE.MeshStandardMaterial)) return mat;
        const owned = mat.clone();
        this.mats.push(owned); this.baseEmissive.push(owned.emissive.clone());
        return owned;
      };
      o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
      o.receiveShadow = true;
    });
    this.object3d.add(this.model, this.upgrades);
    this.upgrades.name = 'castle-weapons';
    this.setLevel(1);
  }

  mount(parent: THREE.Object3D): void { parent.add(this.object3d); }
  hit(): void { this.flash = this.shake = 1; }
  setWarning(on: boolean): void { this.warn = on; }

  private clearWeapons(): void {
    for (const mat of this.ownedMaterials) mat.dispose();
    this.ownedMaterials.length = 0;
    this.weapons.length = 0;
    this.upgrades.clear();
  }

  setLevel(level: number): void {
    level = Math.max(1, Math.min(MAX_CASTLE_LEVEL, Math.floor(level)));
    if (this.level === level) return;
    this.level = level;
    this.clearWeapons();
    const count = level === 1 ? 1 : level === 5 ? 4 : 2;
    const width = this.bounds.max.z - this.bounds.min.z;
    const centerZ = (this.bounds.min.z + this.bounds.max.z) / 2;
    const x = this.bounds.min.x + (this.bounds.max.x - this.bounds.min.x) * .22;
    this.object3d.updateWorldMatrix(true, true);
    for (let i = 0; i < count; i++) {
      // Keep paired batteries on the flanking towers, clear of the central gate roof.
      const side = i % 2 === 0 ? -1 : 1;
      const z = centerZ + (count === 1 ? 0 : side * width * (count === 4 ? .23 + Math.floor(i / 2) * .17 : .32));
      const origin = this.object3d.localToWorld(new THREE.Vector3(x, this.bounds.max.y + 10, z));
      const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0));
      const surface = ray.intersectObject(this.model, true)[0];
      const y = surface ? this.object3d.worldToLocal(surface.point.clone()).y : this.bounds.max.y * .7;
      const mount = new THREE.Group();
      mount.name = `castle-mount-${i}`;
      mount.position.set(x, y + 1, z);
      this.upgrades.add(mount);
      const part = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material,
        pos: [number, number, number], scale: [number, number, number]) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...pos); mesh.scale.set(...scale);
        mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
      };
      // Foundation and turntable visibly support every weapon on the model surface.
      part(mount, BOX, STONE, [0, 2, 0], [20, 4, 18]);
      part(mount, CYLINDER, IRON, [0, 5, 0], [7, 3, 7]);
      const pivot = new THREE.Group(); pivot.position.y = 9; mount.add(pivot);
      const carriage = new THREE.Group(); pivot.add(carriage);
      const glow = new THREE.MeshBasicMaterial({ color: level === 6 ? 0xff8a24 : 0xffd394,
        transparent: true, opacity: level === 6 ? .55 : 0, depthWrite: false });
      this.ownedMaterials.push(glow);
      const muzzle = new THREE.Mesh(SPHERE, glow);
      muzzle.name = `castle-muzzle-${i}`;
      muzzle.scale.setScalar(level === 6 ? 4 : 2.5);
      carriage.add(muzzle);
      if (level < 3) {
        part(carriage, BOX, WOOD, [-4, 0, 0], [24, 3, 5]);
        part(carriage, BOX, IRON, [-10, 2, 0], [2, 2, level === 1 ? 22 : 30]);
        for (const side of [-1, 1]) {
          const limb = part(carriage, BOX, WOOD, [-8, 2, side * 10], [3, 2, 12]);
          limb.rotation.y = side * .25;
          const string = part(carriage, BOX, STRING, [-3, 2, side * 6], [.5, .5, 14]);
          string.rotation.y = side * -.55;
        }
        part(carriage, BOX, IRON, [-9, 3, 0], [23, .8, .8]);
        muzzle.position.x = -21;
      } else {
        const grow = level === 4 ? 1.22 : level === 5 ? .95 : 1;
        part(carriage, BOX, WOOD, [0, -2, 0], [17, 4, 13]);
        const barrel = part(carriage, CYLINDER, level === 6 ? BRONZE : IRON,
          [-9, 3, 0], [5 * grow, 29 * grow, 5 * grow]);
        barrel.rotation.z = Math.PI / 2;
        const lip = part(carriage, TORUS, BRONZE, [-9 - 14.5 * grow, 3, 0], [5 * grow, 5 * grow, 5 * grow]);
        lip.rotation.y = Math.PI / 2;
        const bore = part(carriage, DISC, BLACK, [-9.1 - 14.5 * grow, 3, 0], [4 * grow, 4 * grow, 1]);
        bore.rotation.y = -Math.PI / 2;
        muzzle.position.set(-10 - 14.5 * grow, 3, 0);
        if (level === 4) {
          part(carriage, BOX, BRONZE, [2, 4, 0], [5, 13, 14]);
        }
        if (level === 6) {
          // Jaw, brow, horns and glowing eyes make a readable dragon head around the nozzle.
          part(carriage, BOX, BRONZE, [-12, 9, 0], [23, 5, 15]);
          part(carriage, BOX, BRONZE, [-14, -3, 0], [24, 4, 12]);
          for (const side of [-1, 1]) {
            const horn = part(carriage, CONE, BRONZE, [0, 16, side * 7], [2.5, 13, 2.5]);
            horn.rotation.z = -.35;
            part(carriage, SPHERE, glow, [-15, 10, side * 8], [2, 1.5, 1]);
          }
        }
      }
      this.weapons.push({ pivot, carriage, muzzle, recoil: 0 });
    }
  }

  /** Projectile and flash share the actual weapon socket, including terrain and castle rotation. */
  muzzle(index: number, out: THREE.Vector3): THREE.Vector3 {
    return this.weapons[index % this.weapons.length].muzzle.getWorldPosition(out);
  }

  fire(index: number, target: { x: number; z: number }): void {
    const weapon = this.weapons[index % this.weapons.length];
    this.target.set(target.x, this.basePos.y, target.z);
    weapon.pivot.parent!.worldToLocal(this.target);
    weapon.pivot.rotation.y = THREE.MathUtils.clamp(Math.atan2(this.target.z, -this.target.x), -.65, .65);
    weapon.recoil = 1;
  }

  flashMuzzle(): void { for (const weapon of this.weapons) weapon.recoil = 1; }

  sync(castle: Castle, _alpha: number, dt: number): void {
    this.setLevel(castle.level);
    for (const weapon of this.weapons) {
      weapon.recoil = Math.max(0, weapon.recoil - dt * 5);
      weapon.carriage.position.x = Math.sin(weapon.recoil * Math.PI) * (this.level < 3 ? 1.6 : 4);
      weapon.muzzle.material.opacity = this.level === 6 ? .55 + weapon.recoil * .45
        : this.level < 3 ? 0 : weapon.recoil;
      weapon.muzzle.scale.setScalar((this.level === 6 ? 4 : 2.5) * (1 + weapon.recoil));
    }
    this.shake = Math.max(0, this.shake - dt * 3.5);
    this.object3d.position.copy(this.basePos);
    if (this.shake > 0) {
      const a = this.shake ** 2 * 5;
      this.object3d.position.x += Math.sin(performance.now() * .05) * a;
      this.object3d.position.z += Math.cos(performance.now() * .07) * a;
    }
    this.flash = Math.max(0, this.flash - dt * 3);
    const pulse = this.warn ? .12 + Math.sin(performance.now() * .004) * .06 : 0;
    for (let i = 0; i < this.mats.length; i++) {
      this.mats[i].emissive.copy(this.baseEmissive[i]).lerp(RED, Math.max(this.flash * .7, pulse));
    }
  }

  playState(_state: ViewState): void {}
  dispose(): void {
    this.object3d.removeFromParent();
    this.clearWeapons();
    for (const material of this.mats) material.dispose();
    this.mats.length = this.baseEmissive.length = 0;
    this.object3d.clear();
  }
}

// Shared geometry and materials survive chapter changes; only per-castle glow and damage materials are owned.
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 12);
const CONE = new THREE.ConeGeometry(1, 1, 8);
const SPHERE = new THREE.SphereGeometry(1, 10, 8);
const TORUS = new THREE.TorusGeometry(1, .16, 6, 16);
const DISC = new THREE.CircleGeometry(1, 16);
const WOOD = new THREE.MeshStandardMaterial({ color: 0x513622, roughness: .8 });
const IRON = new THREE.MeshStandardMaterial({ color: 0x30353b, roughness: .35, metalness: .8 });
const BRONZE = new THREE.MeshStandardMaterial({ color: 0xb78336, roughness: .45, metalness: .7 });
const STONE = new THREE.MeshStandardMaterial({ color: 0x716b61, roughness: .9 });
const BLACK = new THREE.MeshBasicMaterial({ color: 0x100d0a });
const STRING = new THREE.MeshStandardMaterial({ color: 0xc8b28e, roughness: 1 });
const RED = new THREE.Color(0xff2a1a);
