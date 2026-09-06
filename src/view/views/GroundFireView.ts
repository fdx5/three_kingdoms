import * as THREE from 'three';
import type { FireSource } from '../../types/towers';
import { fireTexture } from '../vfx/FireTextures';
import { Rng } from '../../core/Rng';

export interface GroundFireAssets {
  quad: THREE.PlaneGeometry;
  rock: THREE.DodecahedronGeometry;
  maps: Record<'flame' | 'smoke' | 'scorch' | 'coals' | 'spark', THREE.DataTexture>;
  dispose: () => void;
}
const STYLE = {
  arrow: { strength: .64, flames: 10, embers: 8, smoke: 3, debris: 0 },
  flame: { strength: .86, flames: 18, embers: 14, smoke: 5, debris: 0 },
  stone: { strength: 1.08, flames: 22, embers: 20, smoke: 6, debris: 8 },
  shell: { strength: 1.2, flames: 26, embers: 26, smoke: 7, debris: 12 },
};

/** Wind-driven textured fire, soft smoke and irregular glowing coals, with bounded draw calls. */
export class GroundFireView {
  readonly object3d = new THREE.Group();
  private flames: THREE.InstancedMesh;
  private sparks: THREE.InstancedMesh;
  private smoke: THREE.Mesh[] = [];
  private scorch: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private coals: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private debris: THREE.InstancedMesh | null = null;
  private patches: { x: number; z: number; width: number; height: number; phase: number }[] = [];
  private elapsed = 0;
  private cooling = -1;
  private strength: number;
  private phase: number;
  private matrix = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private flameEuler = new THREE.Euler();
  private scale = new THREE.Vector3();
  private cameraPosition = new THREE.Vector3();
  private cameraRotation = new THREE.Quaternion();

  constructor(assets: GroundFireAssets, private radius: number, source: FireSource, seed = 1) {
    const style = STYLE[source];
    this.strength = style.strength;
    const rng = new Rng(seed * 1741 + 71);
    this.phase = rng.range(0, Math.PI * 2);
    const material = (map: THREE.Texture, opacity: number, additive = false) => new THREE.MeshBasicMaterial({
      map, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: !additive,
    });
    this.scorch = new THREE.Mesh(assets.quad, material(assets.maps.scorch, .83));
    this.coals = new THREE.Mesh(assets.quad, material(assets.maps.coals, .8, true));
    for (const mesh of [this.scorch, this.coals]) {
      mesh.rotation.set(-Math.PI / 2, 0, this.phase);
      mesh.scale.set(radius * 2.16, radius * 1.92, 1);
      this.object3d.add(mesh);
    }
    this.scorch.position.y = .02;
    this.coals.position.y = .08;
    this.flames = new THREE.InstancedMesh(assets.quad, material(assets.maps.flame, .93, true), style.flames);
    this.sparks = new THREE.InstancedMesh(assets.quad, material(assets.maps.spark, .9, true), style.embers);
    this.flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flames.frustumCulled = this.sparks.frustumCulled = false;
    this.object3d.add(this.flames, this.sparks);
    for (let i = 0; i < style.flames; i++) {
      const angle = rng.range(0, Math.PI * 2), spread = Math.sqrt(rng.next()) * radius * .78;
      this.patches.push({ x: Math.cos(angle) * spread, z: Math.sin(angle) * spread,
        width: radius * rng.range(.25, .42), height: radius * rng.range(.5, 1.1) * style.strength,
        phase: rng.range(0, Math.PI * 2) });
    }
    for (let i = 0; i < style.smoke; i++) {
      const puff = new THREE.Mesh(assets.quad, material(assets.maps.smoke, .15));
      (puff.material as THREE.MeshBasicMaterial).color.set(i % 2 ? 0x77746d : 0x464540);
      puff.userData.phase = i / style.smoke;
      this.smoke.push(puff); this.object3d.add(puff);
    }
    if (style.debris) {
      this.debris = new THREE.InstancedMesh(assets.rock, new THREE.MeshStandardMaterial({ color: 0x28211a, roughness: 1 }), style.debris);
      this.debris.receiveShadow = true;
      for (let i = 0; i < style.debris; i++) {
        const angle = rng.range(0, Math.PI * 2), spread = radius * rng.range(.1, .72);
        const size = radius * rng.range(.035, .105);
        this.position.set(Math.cos(angle) * spread, size * .25, Math.sin(angle) * spread);
        this.scale.set(size * 1.4, size * .65, size);
        this.rotation.setFromAxisAngle(UP, angle);
        this.matrix.compose(this.position, this.rotation, this.scale); this.debris.setMatrixAt(i, this.matrix);
      }
      this.object3d.add(this.debris);
    }
    this.update(0);
  }

  extinguish(): void { if (this.cooling < 0) this.cooling = 0; }
  get finished(): boolean { return this.cooling >= 2.4; }

  update(dt: number, camera?: THREE.Camera): void {
    this.elapsed += dt;
    if (this.cooling >= 0) this.cooling += dt;
    const burn = this.cooling < 0 ? 1 : Math.max(0, 1 - this.cooling / .3);
    const afterglow = this.cooling < 0 ? 1 : Math.max(0, 1 - this.cooling / .75);
    const residue = this.cooling < 0 ? 1 : Math.max(0, 1 - this.cooling / 2.4);
    const spread = .3 + .7 * (1 - Math.exp(-this.elapsed * 9));
    this.scorch.material.opacity = .83 * residue;
    this.coals.material.opacity = (.65 + .15 * Math.sin(this.elapsed * 7 + this.phase)) * afterglow;
    if (this.debris) {
      const mat = this.debris.material as THREE.MeshStandardMaterial;
      if (this.cooling >= 0) { mat.transparent = true; mat.opacity = residue; }
    }
    let yaw = this.phase;
    if (camera) {
      camera.getWorldPosition(this.cameraPosition); camera.getWorldQuaternion(this.cameraRotation);
      yaw = Math.atan2(this.cameraPosition.x - this.object3d.position.x, this.cameraPosition.z - this.object3d.position.z);
    }
    this.flames.visible = burn > 0;
    for (let i = 0; i < this.patches.length; i++) {
      const p = this.patches[i], time = this.elapsed;
      const flicker = Math.sin(time * 11 + p.phase) * .15 + Math.sin(time * 19.7 + p.phase * 2) * .09;
      const height = p.height * (1 + flicker) * spread * burn;
      const gust = Math.sin(time * 2.3 + p.phase) * .13;
      this.position.set(p.x * spread + gust * height * .2, height * .47 + .3, p.z * spread);
      this.rotation.setFromEuler(this.flameEuler.set(0, yaw, -gust - .07));
      this.scale.set(p.width * (1 - flicker * .6) * spread * burn, height, 1);
      this.matrix.compose(this.position, this.rotation, this.scale); this.flames.setMatrixAt(i, this.matrix);
    }
    this.flames.instanceMatrix.needsUpdate = true;
    this.sparks.visible = afterglow > 0;
    for (let i = 0; i < this.sparks.count; i++) {
      const t = (this.elapsed * (.42 + (i % 5) * .07) + i * .618 + this.phase) % 1;
      const angle = i * 2.399 + this.phase, drift = this.radius * t * .65;
      this.position.set(Math.cos(angle) * this.radius * .55 + drift,
        2 + t * this.radius * (1.2 + this.strength), Math.sin(angle) * this.radius * .5 + drift * .27);
      if (camera) this.rotation.copy(this.cameraRotation);
      const size = (1 - t) * Math.sin(Math.PI * t) * afterglow * (1.8 + this.strength);
      this.scale.set(size, size * (1.4 + i % 3), 1);
      this.matrix.compose(this.position, this.rotation, this.scale); this.sparks.setMatrixAt(i, this.matrix);
    }
    this.sparks.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.smoke.length; i++) {
      const puff = this.smoke[i];
      const t = (this.elapsed * .28 + puff.userData.phase) % 1;
      const angle = i * 2.399 + this.phase;
      const size = this.radius * (.48 + t * 1.45) * this.strength;
      puff.position.set(Math.cos(angle) * this.radius * .35 + t * this.radius * .9,
        this.radius * (.3 + t * 1.8), Math.sin(angle) * this.radius * .3 + t * this.radius * .23);
      if (camera) puff.quaternion.copy(this.cameraRotation);
      puff.rotateZ(Math.sin(this.elapsed * .2 + i) * .18);
      puff.scale.set(size, size * 1.2, 1);
      (puff.material as THREE.MeshBasicMaterial).opacity = Math.sin(Math.PI * t) * .24 * residue * spread;
    }
  }

  dispose(): void {
    this.object3d.removeFromParent();
    this.object3d.traverse(o => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    this.object3d.clear();
  }
}

export function createGroundFireAssets(): GroundFireAssets {
  const quad = new THREE.PlaneGeometry(1, 1);
  const rock = new THREE.DodecahedronGeometry(1, 0);
  const maps = { flame: fireTexture('flame'), smoke: fireTexture('smoke'), scorch: fireTexture('scorch'), coals: fireTexture('coals'), spark: fireTexture('spark') };
  return { quad, rock, maps, dispose: () => { quad.dispose(); rock.dispose(); Object.values(maps).forEach(t => t.dispose()); } };
}
const UP = new THREE.Vector3(0, 1, 0);
