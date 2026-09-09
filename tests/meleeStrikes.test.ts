import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BALANCE } from '../src/data/balance';
import { MeleeStrikes } from '../src/view/vfx/MeleeStrikes';
import { ParticleSystem } from '../src/view/vfx/Particles';

describe('Melee contact effects', () => {
  it('bounds dense combat, survives quality changes, and clears expired strikes', () => {
    const fx = new MeleeStrikes(BALANCE.presets.high), camera = new THREE.Camera();
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 200; i++) fx.emit(i, 70, 30, 1, 0, i % 2 ? 'ys_spear' : 'xl_infantry', 1);
    fx.update(.03, camera);
    expect(fx.group.visible).toBe(true);
    expect(fx.group.children).toHaveLength(3);
    for (const preset of [BALANCE.presets.low, BALANCE.presets.high]) {
      fx.setPreset(preset); fx.update(.02, camera);
      for (const child of fx.group.children) {
        const mesh = child as THREE.InstancedMesh;
        expect(mesh.count).toBe(48);
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          expect(matrix.elements.every(Number.isFinite)).toBe(true);
        }
      }
    }
    fx.update(1, camera); expect(fx.group.visible).toBe(false);
    fx.dispose(); expect(fx.group.children).toHaveLength(0);
  });

  it('impact chips travel outward from the struck surface', () => {
    const particles = new ParticleSystem(BALANCE.presets.high);
    particles.emit('stone_chip', 0, 20, 0, 1, 1, 0);
    particles.update(.05);
    const positions = particles.points.geometry.getAttribute('position');
    for (let i = 0; i < particles.points.geometry.drawRange.count; i++) expect(positions.getX(i)).toBeGreaterThan(0);
    particles.dispose();
  });
});
