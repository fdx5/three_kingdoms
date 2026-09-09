import * as THREE from 'three';
import type { PerformancePreset } from '../../data/balance';

const CAPACITY = 48;
const SPEARS = new Set(['ys_spear', 'wu_marine', 'jz_marine', 'jiangwei', 'lubu']);
interface Strike { age: number; duration: number; x: number; y: number; z: number; yaw: number; size: number; thrust: boolean }

/** Short weapon silhouettes and contact flashes, with a fixed pool and three draws. */
export class MeleeStrikes {
  readonly group = new THREE.Group();
  private slash: THREE.InstancedMesh;
  private thrust: THREE.InstancedMesh;
  private flash: THREE.InstancedMesh;
  private slots: Strike[] = Array.from({ length: CAPACITY }, () => ({ age: 1, duration: .24,
    x: 0, y: 0, z: 0, yaw: 0, size: 1, thrust: false }));
  private limit = CAPACITY;
  private cursor = 0;
  private transform = new THREE.Object3D();
  private color = new THREE.Color();
  private cameraRotation = new THREE.Quaternion();

  constructor(preset: PerformancePreset) {
    const material = () => new THREE.MeshBasicMaterial({ color: 0xffffff,
      transparent: true, opacity: .75, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    // A tapered crescent leaves a readable leading edge instead of a complete glowing ring.
    const positions: number[] = [], indices: number[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, angle = -1.25 + t * 2.5;
      const width = .02 + .16 * Math.sin(t * Math.PI);
      for (const radius of [1 - width, 1]) positions.push(Math.sin(angle) * radius, Math.cos(angle) * radius - .65, 0);
      if (i) { const a = (i - 1) * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const crescent = new THREE.BufferGeometry();
    crescent.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); crescent.setIndex(indices);
    const diamond = new THREE.BufferGeometry();
    diamond.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 0, -.12, 0, 0, 0, -1, 0, .12, 0, 0], 3));
    diamond.setIndex([0, 1, 2, 0, 2, 3]);
    this.slash = new THREE.InstancedMesh(crescent, material(), CAPACITY);
    this.thrust = new THREE.InstancedMesh(diamond, material(), CAPACITY);
    this.flash = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 4), material(), CAPACITY);
    for (const mesh of [this.slash, this.thrust, this.flash]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.name = 'melee-strike';
      this.group.add(mesh);
    }
    this.setPreset(preset);
    this.update(0, new THREE.Camera());
  }

  emit(x: number, y: number, z: number, dx: number, dz: number, unitId: string, scale: number): void {
    const slot = this.slots[this.cursor++ % this.limit];
    Object.assign(slot, { age: 0, duration: scale > 1.4 ? .28 : .21, x, y, z,
      yaw: Math.atan2(dx, dz), size: Math.min(2.2, scale), thrust: SPEARS.has(unitId) });
    this.group.visible = true;
  }

  setPreset(preset: PerformancePreset): void {
    this.limit = Math.max(12, Math.round(CAPACITY * Math.min(1, preset.particleScale)));
    for (let i = this.limit; i < CAPACITY; i++) this.slots[i].age = 1;
  }

  update(dt: number, camera: THREE.Camera): void {
    if (!this.group.visible) return;
    camera.getWorldQuaternion(this.cameraRotation);
    let active = 0;
    for (let i = 0; i < CAPACITY; i++) {
      const s = this.slots[i]; s.age += dt;
      const alive = i < this.limit && s.age < s.duration;
      const t = Math.min(1, s.age / s.duration), fade = alive ? (1 - t) ** 2 : 0;
      if (alive) active++;
      for (let kind = 0; kind < 2; kind++) {
        const mesh = kind === 0 ? this.slash : this.thrust;
        const selected = kind === 0 ? !s.thrust : s.thrust;
        const size = alive && selected ? s.size * (14 + t * 8) : 0;
        this.transform.position.set(s.x, s.y, s.z);
        this.transform.rotation.set(s.thrust ? Math.PI / 2 : -.2, s.yaw, s.thrust ? 0 : -.65 + t * .6, 'YXZ');
        this.transform.scale.set(size, size, size);
        this.transform.updateMatrix(); mesh.setMatrixAt(i, this.transform.matrix);
        this.color.setHex(s.thrust ? 0xbdeaff : 0xffdf9a).multiplyScalar(fade);
        mesh.setColorAt(i, this.color);
      }
      this.transform.position.set(s.x, s.y, s.z);
      this.transform.quaternion.copy(this.cameraRotation);
      this.transform.scale.setScalar(alive ? s.size * 5 * Math.max(0, 1 - t * 3) : 0);
      this.transform.updateMatrix(); this.flash.setMatrixAt(i, this.transform.matrix);
      this.flash.setColorAt(i, this.color.setHex(0xfff4d6).multiplyScalar(fade));
    }
    this.group.visible = active > 0;
    for (const mesh of [this.slash, this.thrust, this.flash]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of [this.slash, this.thrust, this.flash]) {
      mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose();
    }
    this.group.clear();
  }
}
