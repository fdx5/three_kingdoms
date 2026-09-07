import * as THREE from 'three';
import type { GroundFireAssets } from '../views/GroundFireView';

/** Reusable transparent particle sheets; no opaque flame volumes. */
function sheet(assets: GroundFireAssets, map: 'flame' | 'spark' | 'smoke', count: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(assets.quad, new THREE.MeshBasicMaterial({
    map: assets.maps[map], transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: map === 'smoke' ? THREE.NormalBlending : THREE.AdditiveBlending,
    opacity: map === 'smoke' ? .19 : .72, toneMapped: false,
    color: map === 'smoke' ? 0x595049 : 0xffffff,
  }), count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  return mesh;
}

/** A pulsed breath stretches from the articulated mouth toward the actual impact point. */
export class FlameJetView {
  readonly object3d = new THREE.Group();
  private flame: THREE.InstancedMesh;
  private sparks: THREE.InstancedMesh;
  private transform = new THREE.Object3D();
  private direction = new THREE.Vector3();
  private cameraRotation = new THREE.Quaternion();
  private cameraInverse = new THREE.Quaternion();
  private age = 0;
  constructor(assets: GroundFireAssets) {
    this.flame = sheet(assets, 'flame', 32);
    this.sparks = sheet(assets, 'spark', 14);
    this.object3d.add(this.flame, this.sparks);
  }
  reset(): void { this.age = 0; }
  update(origin: THREE.Vector3, target: THREE.Vector3, progress: number, dt: number, camera: THREE.Camera): void {
    this.age += dt;
    camera.getWorldQuaternion(this.cameraRotation);
    this.cameraInverse.copy(this.cameraRotation).invert();
    this.direction.subVectors(target, origin).applyQuaternion(this.cameraInverse);
    const rotation = Math.atan2(-this.direction.x, this.direction.y);
    // Release the mouth before impact, so the tail visibly follows the flame front.
    const tail = Math.max(0, progress - .7) / .3;
    for (const mesh of [this.flame, this.sparks]) {
      for (let i = 0; i < mesh.count; i++) {
        const fraction = (i + .5) / mesh.count;
        const u = tail + Math.max(0, progress - tail) * fraction;
        const phase = i * 2.399 + this.age * 24;
        const spread = 1 + u * 6;
        this.transform.position.lerpVectors(origin, target, u);
        this.transform.position.x += Math.sin(phase) * spread * .32;
        this.transform.position.z += Math.cos(phase * 1.17) * spread * .32;
        this.transform.position.y += Math.sin(Math.PI * u) * 7 + Math.sin(phase * .7) * spread * .25;
        this.transform.quaternion.copy(this.cameraRotation);
        this.transform.rotateZ(rotation + Math.sin(phase) * .15);
        const envelope = Math.min(1, progress * 12) * Math.min(1, (1 - progress) * 12);
        const size = spread * envelope * (1 + Math.sin(phase) * .2);
        if (mesh === this.flame) this.transform.scale.set(size * 1.8, size * 3.2 + 3 * envelope, 1);
        else {
          this.transform.position.y += fraction * 6;
          this.transform.scale.set(.65 * envelope, (1 + fraction * 2) * envelope, 1);
        }
        this.transform.updateMatrix();mesh.setMatrixAt(i, this.transform.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
  dispose(): void {
    this.object3d.removeFromParent();
    for (const m of [this.flame, this.sparks]) { (m.material as THREE.Material).dispose();m.dispose(); }
    this.object3d.clear();
  }
}

/** Damage-driven burning follows the animated body, including its fall on death. */
export class UnitBurnView {
  readonly object3d = new THREE.Group();
  private flame: THREE.InstancedMesh;
  private sparks: THREE.InstancedMesh;
  private smoke: THREE.InstancedMesh;
  private transform = new THREE.Object3D();
  private cameraRotation = new THREE.Quaternion();
  private inverse = new THREE.Quaternion();
  private age = 0;
  private remaining = 0;
  constructor(assets: GroundFireAssets) {
    this.flame = sheet(assets, 'flame', 12);
    (this.flame.material as THREE.MeshBasicMaterial).opacity = .42;
    this.sparks = sheet(assets, 'spark', 8);
    this.smoke = sheet(assets, 'smoke', 3);
    this.object3d.add(this.flame, this.sparks, this.smoke);
    this.object3d.visible = false;
  }
  ignite(): void { this.remaining = 1.1;this.object3d.visible = true; }
  reset(): void { this.remaining = 0;this.object3d.visible = false; }
  update(dt: number, camera: THREE.Camera): number {
    this.remaining = Math.max(0, this.remaining - dt);this.age += dt;
    this.object3d.visible = this.remaining > 0;
    if (!this.object3d.visible) return 0;
    const heat = Math.min(1, Math.max(0, (this.remaining - .5) / .3));
    this.object3d.getWorldQuaternion(this.inverse).invert();
    camera.getWorldQuaternion(this.cameraRotation).premultiply(this.inverse);
    for (const mesh of [this.flame, this.sparks, this.smoke]) {
      for (let i = 0; i < mesh.count; i++) {
        const phase = i * 2.399;
        const t = (this.age * (mesh === this.smoke ? .6 : 1.5) + i * .618) % 1;
        const radius = mesh === this.flame ? 4.2 : 5 + t * 4;
        this.transform.position.set(Math.cos(phase) * radius, 5 + (i % 4) * 5 + t * 12, Math.sin(phase) * radius);
        this.transform.quaternion.copy(this.cameraRotation);
        this.transform.rotateZ(Math.sin(this.age * 5 + phase) * .18);
        const fade = Math.sin(Math.PI * t);
        if (mesh === this.flame) this.transform.scale.set((3 + fade * 3) * heat, (6 + fade * 8) * heat, 1);
        else if (mesh === this.sparks) this.transform.scale.set(.7 * heat * fade, 2.4 * heat * fade, 1);
        else { this.transform.position.y += t * 17;this.transform.scale.setScalar((9 + t * 13) * fade * Math.min(1, this.remaining * 2)); }
        this.transform.updateMatrix();mesh.setMatrixAt(i, this.transform.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    return heat;
  }
  dispose(): void {
    this.object3d.removeFromParent();
    for (const m of [this.flame, this.sparks, this.smoke]) { (m.material as THREE.Material).dispose();m.dispose(); }
    this.object3d.clear();
  }
}
