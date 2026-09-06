import * as THREE from 'three';
import type { World } from '../../sim/World';
import type { Terrain } from '../Terrain';
import type { PerformancePreset } from '../../data/balance';
import { Rng } from '../../core/Rng';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Bounded GPU instance pools: hundreds of missiles, without hundreds of draw calls. */
export class StratagemStorm {
  readonly group = new THREE.Group();
  private rain: { body: THREE.InstancedMesh; trail: THREE.InstancedMesh; impact: THREE.InstancedMesh; ice: boolean }[] = [];
  private shells: THREE.InstancedMesh;
  private samples: { x: number; z: number; y: number; phase: number; speed: number }[] = [];
  private matrix = new THREE.Matrix4();
  private rotation = new THREE.Quaternion();
  private position = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private clock = 0;
  private lastElapsed = 0;
  private title: HTMLDivElement;
  private count = 360;

  constructor(private world: World, private terrain: Terrain, preset: PerformancePreset) {
    const rng = new Rng(98217);
    const p = { x: 0, z: 0 }, d = { x: 0, z: 0 };
    for (let i = 0; i < 360; i++) {
      const distance = rng.range(0, world.path.totalLength);
      world.path.positionAt(distance, p); world.path.directionAt(distance, d);
      const offset = rng.range(-39, 39);
      const x = p.x - d.z * offset, z = p.z + d.x * offset;
      this.samples.push({ x, z, y: terrain.heightAt(x, z) + 1.1, phase: rng.next(), speed: rng.range(0.8, 1.25) });
    }
    for (const ice of [false, true]) {
      const shaft = new THREE.CylinderGeometry(0.65, 0.65, 30, 4);
      const tip = new THREE.ConeGeometry(2.3, 8, 4);
      tip.rotateZ(Math.PI); tip.translate(0, -18, 0);
      const feathers = new THREE.BoxGeometry(5, 7, 0.5); feathers.translate(0, 11, 0);
      const geometry = ice ? new THREE.ConeGeometry(3.3, 30, 5) : mergeGeometries([shaft, tip, feathers])!;
      shaft.dispose(); tip.dispose(); feathers.dispose();
      if (ice) geometry.rotateZ(Math.PI);
      const body = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({
        color: ice ? 0xc8f2ff : 0x472313, metalness: ice ? 0.2 : 0, roughness: ice ? 0.15 : 0.8,
        emissive: ice ? 0x247bad : 0x6d2305, emissiveIntensity: ice ? 0.7 : 0.45,
      }), 360);
      const trail = new THREE.InstancedMesh(new THREE.ConeGeometry(ice ? 2.4 : 3.5, 45, 5), new THREE.MeshBasicMaterial({
        color: ice ? 0x8bdcff : 0xffaa33, transparent: true, opacity: ice ? 0.27 : 0.7,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }), 360);
      const impact = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.12, 4, 18), new THREE.MeshBasicMaterial({
        color: ice ? 0xb4ebff : 0xff631b, transparent: true, opacity: 0.48,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }), 360);
      for (const mesh of [body, trail, impact]) {
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false; mesh.visible = false; this.group.add(mesh);
      }
      this.rain.push({ body, trail, impact, ice });
    }
    this.shells = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshPhysicalMaterial({
      color: 0xa9e8ff, emissive: 0x185675, emissiveIntensity: 0.6, metalness: 0.12,
      roughness: 0.14, transparent: true, opacity: 0.32, depthWrite: false, flatShading: true,
      clearcoat: 1,
    }), 512);
    this.shells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shells.frustumCulled = false;
    this.shells.count = 0;
    this.group.add(this.shells);
    this.title = document.createElement('div');
    this.title.className = 'storm-title';
    this.title.setAttribute('aria-hidden', 'true');
    document.body.append(this.title);
    void document.fonts.load('100px "Storm Brush"');
    this.applyPreset(preset);
  }

  applyPreset(preset: PerformancePreset): void {
    this.count = Math.round(180 + 180 * preset.particleScale);
  }

  cast(ice: boolean): void {
    this.title.className = `storm-title ${ice ? 'storm-title--ice' : 'storm-title--fire'}`;
    const glyph = document.createElement('strong');
    glyph.textContent = ice ? '冰暴' : '火攻';
    const subtitle = document.createElement('span');
    subtitle.textContent = ice ? '얼음폭풍 · 천지를 얼리다' : '화공 · 불화살이 하늘을 덮다';
    this.title.replaceChildren(glyph, subtitle);
    this.title.getAnimations().forEach(animation => animation.cancel());
    this.title.animate([
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1.5) rotate(-5deg)', filter: 'blur(12px)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1) rotate(-5deg)', filter: 'blur(0px)', offset: 0.16 },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1.035) rotate(-5deg)', filter: 'blur(0px)', offset: 0.62 },
      { opacity: 0, transform: 'translate(-50%, -58%) scale(1.12) rotate(-5deg)', filter: 'blur(6px)' },
    ], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 900 : 1900, fill: 'none' });
  }

  update(): void {
    // The same game clock drives damage, freeze, rain, pause and speed changes.
    this.clock += Math.max(0, this.world.elapsed - this.lastElapsed);
    this.lastElapsed = this.world.elapsed;
    for (const layer of this.rain) {
      const remaining = layer.ice ? this.world.iceStormRemaining : this.world.fireStormRemaining;
      const active = remaining > 0 && this.world.over === 'none';
      for (const mesh of [layer.body, layer.trail, layer.impact]) { mesh.visible = active; mesh.count = this.count; }
      if (!active) continue;
      const age = 10 - remaining;
      for (let i = 0; i < this.count; i++) {
        const s = this.samples[i];
        const phase = (age * s.speed * 1.5 + s.phase) % 1;
        const height = (1 - phase) * 570;
        const lean = layer.ice ? 0.07 : 0.22;
        this.rotation.setFromAxisAngle(Z_AXIS, -Math.atan(lean));
        this.position.set(s.x - height * lean, s.y + height + 15, s.z);
        this.scale.set(1, 1, 1);
        this.matrix.compose(this.position, this.rotation, this.scale); layer.body.setMatrixAt(i, this.matrix);
        this.position.y += 30; this.position.x -= 30 * lean;
        this.scale.setScalar(layer.ice ? 0.8 : 0.7 + Math.sin(i + this.clock * 30) * 0.2);
        this.matrix.compose(this.position, this.rotation, this.scale); layer.trail.setMatrixAt(i, this.matrix);
        const ripple = ((phase + 0.08) % 1);
        const radius = 1 + ripple * 13;
        this.position.set(s.x, s.y, s.z);
        this.rotation.setFromAxisAngle(X_AXIS, -Math.PI / 2);
        this.scale.set(radius, radius, Math.max(0.01, 1 - ripple * 2));
        if (ripple > 0.5) this.scale.setScalar(0);
        this.matrix.compose(this.position, this.rotation, this.scale); layer.impact.setMatrixAt(i, this.matrix);
      }
      for (const mesh of [layer.body, layer.trail, layer.impact]) mesh.instanceMatrix.needsUpdate = true;
    }
    let index = 0;
    for (const enemy of this.world.enemies) {
      if (!enemy.alive || enemy.freezeTimer <= 0 || index === 512) continue;
      this.position.set(enemy.worldX, this.terrain.heightAt(enemy.worldX, enemy.worldZ) + 22 * enemy.scale, enemy.worldZ);
      this.rotation.setFromAxisAngle(Y_AXIS, enemy.id * 2.39);
      this.scale.set(16 * enemy.scale, 30 * enemy.scale, 15 * enemy.scale);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.shells.setMatrixAt(index++, this.matrix);
    }
    this.shells.count = index;
    this.shells.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.title.getAnimations().forEach(a => a.cancel());
    this.title.remove();
    for (const child of this.group.children) {
      const mesh = child as THREE.InstancedMesh;
      mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose();
    }
    this.group.clear();
  }
}
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
