import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { ParticleSystem } from '../src/view/vfx/Particles';
import { ImpactWaves } from '../src/view/vfx/ImpactWaves';

describe('bounded combat effects', () => {
  it('compacts expired particles without losing surviving colors or positions', () => {
    const particles = new ParticleSystem(BALANCE.presets.high);
    particles.emit('hit_spark', 10, 20, 30);
    particles.emit('ground_smoke', 400, 20, 500);
    particles.update(0.4);
    const geometry = particles.points.geometry;
    expect(geometry.drawRange.count).toBe(14);
    for (let i = 0; i < geometry.drawRange.count; i++) {
      expect(geometry.getAttribute('position').getX(i)).toBeGreaterThan(350);
      expect(geometry.getAttribute('color').getX(i)).toBeCloseTo(geometry.getAttribute('color').getX(0));
    }
    particles.update(2);
    expect(geometry.drawRange.count).toBe(0);
    expect(particles.points.visible).toBe(false);
    particles.dispose();
  });

  it('changes live budgets in both directions without reallocating GPU buffers', () => {
    const particles = new ParticleSystem(BALANCE.presets.low);
    const position = particles.points.geometry.getAttribute('position');
    particles.setPreset(BALANCE.presets.high);
    for (let i = 0; i < 100; i++) particles.emit('ground_smoke', i, 20, 30);
    expect(particles.points.geometry.drawRange.count).toBe(BALANCE.maxParticles);
    particles.setPreset(BALANCE.presets.low);
    expect(particles.points.geometry.drawRange.count).toBe(180);
    expect(particles.points.geometry.getAttribute('position')).toBe(position);
    particles.update(0);
    expect(particles.points.geometry.drawRange.count).toBe(180);
    particles.update(2);
    expect(particles.points.visible).toBe(false);
    particles.dispose();
  });

  it('bounds impacts, freezes on pause, fades completely and recycles slots', () => {
    const waves = new ImpactWaves(BALANCE.presets.high);
    for (let i = 0; i < 100; i++) waves.emit(i, 2, 40, 60, true);
    waves.update(0.1);
    expect(waves.mesh.count).toBe(32);
    const alpha = waves.mesh.geometry.getAttribute('impactAlpha');
    const before = alpha.getX(0);
    waves.update(0);
    expect(alpha.getX(0)).toBe(before);
    waves.update(1);
    expect(waves.mesh.visible).toBe(false);
    for (let i = 0; i < 32; i++) expect(alpha.getX(i)).toBe(0);
    waves.setPreset(BALANCE.presets.low);
    waves.emit(100, 2, 100, 50);
    waves.update(0);
    expect(waves.mesh.count).toBe(10);
    expect(waves.mesh.visible).toBe(true);
    waves.dispose();
  });
});
