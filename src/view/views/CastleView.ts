import * as THREE from 'three';
import type { Castle } from '../../sim/Castle';
import type { AssetRegistry } from '../AssetRegistry';
import type { Terrain } from '../Terrain';
import type { EntityView, ViewState } from '../EntityView';
import type { PrimitiveSpec } from '../../types/primitives';
import { MAX_CASTLE_LEVEL } from '../../data/castle';
import { buildCastleEmplacement, buildCastleWeapon, type CastleWeapon } from './CastleWeapon';

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

export class CastleView implements EntityView<Castle> {
  readonly object3d = new THREE.Group();
  private model: THREE.Object3D;
  private bounds: THREE.Box3;
  private mats: THREE.MeshStandardMaterial[] = [];
  private baseEmissive: THREE.Color[] = [];
  private upgrades = new THREE.Group();
  private weapons: CastleWeapon[] = [];
  private authoredPorts: boolean;
  private ownedMaterials: THREE.Material[] = [];
  private ownedGeometry: THREE.BufferGeometry[] = [];
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
    this.authoredPorts = assets.getModel(modelId)?.entry.url === 'models/castle.glb';
    // Measure and raycast in castle-local space before mounting it in the world.
    this.model.updateMatrixWorld(true);
    this.bounds = new THREE.Box3().setFromObject(this.model);
    if (this.authoredPorts) this.removeDecorativeBarrels();
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

  /** Replace only the baked, immobile barrels at the GLB's authored sockets.
   * Clone indices so the cached castle asset and other chapter instances stay intact. */
  private removeDecorativeBarrels(): void {
    const vertex = new THREE.Vector3();
    this.model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      const positions = geometry.getAttribute('position');
      if (!positions) return;
      const masked = new Uint8Array(positions.count);
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        masked[i] = Number(vertex.x < -13 && vertex.y > 72 && vertex.y < 89
          && (Math.abs(vertex.z + 33) < 8 || Math.abs(vertex.z - 60) < 8));
      }
      const indices = geometry.getIndex();
      const count = indices?.count ?? positions.count;
      const groups = geometry.groups.length ? geometry.groups : [{start: 0, count, materialIndex: 0}];
      const kept: number[] = [];
      const newGroups: {start: number; count: number; materialIndex?: number}[] = [];
      for (const group of groups) {
        const start = kept.length;
        for (let i = group.start; i < group.start + group.count; i += 3) {
          const a = indices?.getX(i) ?? i, b = indices?.getX(i + 1) ?? i + 1, c = indices?.getX(i + 2) ?? i + 2;
          if (!masked[a] && !masked[b] && !masked[c]) kept.push(a, b, c);
        }
        newGroups.push({start, count: kept.length - start, materialIndex: group.materialIndex});
      }
      if (kept.length === count) return;
      const replacement = geometry.clone(); replacement.setIndex(kept); replacement.clearGroups();
      for (const group of newGroups) replacement.addGroup(group.start, group.count, group.materialIndex);
      object.geometry = replacement; this.ownedGeometry.push(replacement);
    });
  }
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
    const height = this.bounds.max.y - this.bounds.min.y;
    const centerZ = this.authoredPorts ? 13.5 : (this.bounds.min.z + this.bounds.max.z) / 2;
    const stations: THREE.Group[] = [];
    this.object3d.updateWorldMatrix(true, true);
    for (let i = 0; i < Math.min(count, 2); i++) {
      // Match the shipped GLB's two embrasures, not its asymmetric ramp/roof bounds.
      const z = count === 1 ? centerZ : this.authoredPorts ? [-33, 60][i]
        : centerZ + (i === 0 ? -1 : 1) * width * .28;
      const y = this.authoredPorts ? (count === 1 ? 89 : 80) : this.bounds.min.y + height * .64;
      const origin = this.object3d.localToWorld(new THREE.Vector3(this.bounds.min.x - 10, y - 10, z));
      const direction = new THREE.Vector3(1, 0, 0).transformDirection(this.object3d.matrixWorld);
      const surface = new THREE.Raycaster(origin, direction).intersectObject(this.model, true)[0];
      const x = surface ? this.object3d.worldToLocal(surface.point.clone()).x : this.bounds.min.x;
      const mount = new THREE.Group();
      mount.name = `castle-mount-${i}`;
      mount.position.set(x + 1, y, z);
      this.upgrades.add(mount);
      buildCastleEmplacement(mount, level === 5);
      stations.push(mount);
    }
    for (let i = 0; i < count; i++) {
      const lateral = level === 5 ? (i < 2 ? -6 : 6) : 0;
      this.weapons.push(buildCastleWeapon(stations[i % stations.length], level, i, this.ownedMaterials, lateral));
    }
  }

  /** Projectile and flash share the actual weapon socket, including terrain and castle rotation. */
  muzzle(index: number, out: THREE.Vector3): THREE.Vector3 {
    return this.weapons[index % this.weapons.length].muzzle.getWorldPosition(out);
  }

  muzzleNode(index: number): THREE.Object3D {
    return this.weapons[index % this.weapons.length].muzzle;
  }

  fire(index: number, target: { x: number; z: number }): void {
    const weapon = this.weapons[index % this.weapons.length];
    this.target.set(target.x, this.basePos.y, target.z);
    weapon.pivot.parent!.worldToLocal(this.target);
    this.target.sub(weapon.pivot.position);
    weapon.pivot.rotation.y = THREE.MathUtils.clamp(Math.atan2(this.target.z, -this.target.x), -1.05, 1.05);
    const distance = Math.hypot(this.target.x, this.target.z);
    weapon.elevation.rotation.z = THREE.MathUtils.clamp(Math.atan2(-this.target.y, distance), -.15, 1.15);
    weapon.recoil = 1;
  }

  flashMuzzle(): void { for (const weapon of this.weapons) weapon.recoil = 1; }

  sync(castle: Castle, _alpha: number, dt: number): void {
    this.setLevel(castle.level);
    for (const weapon of this.weapons) {
      weapon.recoil = Math.max(0, weapon.recoil - dt * 5);
      weapon.carriage.position.x = Math.sin(weapon.recoil * Math.PI) * (this.level < 3 ? 1.6 : 4);
      if (weapon.string) weapon.string.scale.x = 1 + Math.sin(weapon.recoil * Math.PI) * .45;
      if (weapon.bolt) weapon.bolt.visible = weapon.recoil < .25;
      weapon.muzzle.material.opacity = this.level < 3 ? 0 : weapon.recoil ** 3;
      weapon.muzzle.scale.set(4 + weapon.recoil * 7, 2 + weapon.recoil * 2, 2 + weapon.recoil * 2);
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
    for (const geometry of this.ownedGeometry) geometry.dispose();
    this.ownedGeometry.length = 0;
    this.mats.length = this.baseEmissive.length = 0;
    this.object3d.clear();
  }
}

const RED = new THREE.Color(0xff2a1a);
