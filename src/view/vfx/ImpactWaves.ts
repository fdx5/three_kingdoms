import * as THREE from 'three';
import type { PerformancePreset } from '../../data/balance';

const CAPACITY = 32;

/** Expanding dust/heat fronts, batched into one draw with no per-impact allocation. */
export class ImpactWaves {
  readonly mesh: THREE.InstancedMesh;
  private geometry = new THREE.PlaneGeometry(2, 2);
  private opacity = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  private material = new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  private life = new Float32Array(CAPACITY);
  private duration = new Float32Array(CAPACITY);
  private radius = new Float32Array(CAPACITY);
  private positions = new Float32Array(CAPACITY * 3);
  private transform = new THREE.Object3D();
  private color = new THREE.Color();
  private cursor = 0;
  private limit = CAPACITY;
  private dirty = false;

  constructor(preset: PerformancePreset) {
    this.opacity.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('impactAlpha', this.opacity);
    this.material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>',
        '#include <common>\nattribute float impactAlpha; varying float vImpactAlpha; varying vec2 vImpactUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvImpactAlpha = impactAlpha; vImpactUv = uv;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
        '#include <common>\nvarying float vImpactAlpha; varying vec2 vImpactUv;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float r = length(vImpactUv * 2.0 - 1.0);
          float ring = smoothstep(0.55, 0.78, r) * (1.0 - smoothstep(0.82, 1.0, r));
          float angle = atan(vImpactUv.y - 0.5, vImpactUv.x - 0.5);
          float wisps = 0.72 + 0.28 * sin(angle * 13.0 + r * 22.0);
          diffuseColor.a *= ring * wisps * vImpactAlpha;
        `);
    };
    this.material.customProgramCacheKey = () => 'impact-waves-v1';
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.transform.rotation.x = -Math.PI / 2;
    this.setPreset(preset);
  }

  emit(x: number, y: number, z: number, radius: number, hot = false): void {
    const i = this.cursor++ % this.limit;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.radius[i] = Math.max(8, Math.min(140, radius));
    this.life[i] = this.duration[i] = hot ? 0.48 : 0.62;
    this.mesh.setColorAt(i, this.color.set(hot ? 0xffaf56 : 0xc6b18a));
    this.mesh.instanceColor!.needsUpdate = true;
    this.writeTransform(i, 0);
    this.dirty = true;
    this.mesh.visible = true;
  }

  private writeTransform(i: number, t: number): void {
    this.transform.position.fromArray(this.positions, i * 3);
    this.transform.scale.setScalar(this.radius[i] * (0.18 + 0.95 * (1 - (1 - t) ** 3)));
    this.transform.updateMatrix();
    this.mesh.setMatrixAt(i, this.transform.matrix);
    this.opacity.setX(i, (1 - t) ** 2 * 0.65);
  }

  update(dt: number): void {
    if (!this.mesh.visible) return;
    let alive = false;
    for (let i = 0; i < CAPACITY; i++) {
      if (this.life[i] <= 0) continue;
      if (dt > 0) {
        this.life[i] = Math.max(0, this.life[i] - dt);
        this.writeTransform(i, 1 - this.life[i] / this.duration[i]);
        this.dirty = true;
      }
      alive ||= this.life[i] > 0;
    }
    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.opacity.needsUpdate = true;
      this.dirty = false;
    }
    this.mesh.visible = alive;
  }

  setPreset(preset: PerformancePreset): void {
    this.limit = Math.max(4, Math.round(CAPACITY * preset.particleScale));
    for (let i = this.limit; i < CAPACITY; i++) {
      this.life[i] = 0;
      this.opacity.setX(i, 0);
    }
    this.mesh.count = this.limit;
    this.dirty = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
