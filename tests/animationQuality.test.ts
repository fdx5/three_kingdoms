import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EnemyView } from '../src/view/views/EnemyView';
import { Enemy } from '../src/sim/Enemy';
import { Path } from '../src/sim/Path';
import { UNITS } from '../src/data/units';
import { AssetRegistry } from '../src/view/AssetRegistry';
import type { Terrain } from '../src/view/Terrain';
import { ParticleSystem } from '../src/view/vfx/Particles';
import { BALANCE } from '../src/data/balance';
import { ObjectPool } from '../src/core/ObjectPool';

const terrain = { heightAt: () => 0 } as unknown as Terrain;
function fixture(model?: THREE.Object3D) {
  const assets = new AssetRegistry();
  if (model) vi.spyOn(assets, 'getMesh').mockReturnValue(model);
  const path = new Path([[0, 0], [100, 0], [100, 100]]);
  const enemy = new Enemy();
  enemy.init(1, UNITS.yt_infantry, 1, 1, 0);
  const view = new EnemyView(UNITS.yt_infantry, path, terrain, assets);
  return { view, enemy, assets };
}

describe('Animation quality and resource lifetime', () => {
  it('attacking feet recover the full walking height and reset on reuse', () => {
    const model = new THREE.Group();
    const feet = ['footL', 'footR'].map(name => {
      const foot = new THREE.Bone(); foot.name = name; model.add(foot); return foot;
    });
    model.animations = ['walk', 'attack'].map(name => new THREE.AnimationClip(name, 1, feet.map(foot =>
      new THREE.VectorKeyframeTrack(`${foot.name}.position`, [0, 1],
        name === 'walk' ? [0, 4, 0, 0, 4, 0] : [0, 2, 0, 0, 2, 0]))));
    const { view, enemy, assets } = fixture(model);
    const footHeight = () => feet[0].getWorldPosition(new THREE.Vector3()).y - view.object3d.position.y;
    for (let i = 0; i < 60; i++) view.sync(enemy, 1, 1 / 60);
    const walkingHeight = footHeight();
    view.startSiegeAttack(2);
    for (let i = 0; i < 180; i++) view.sync(enemy, 1, 1 / 60);
    expect(footHeight()).toBeCloseTo(walkingHeight, 2);
    view.stopSiegeAttack();
    expect(model.position.y).toBe(0);
    view.resetForReuse();
    expect(model.position.y).toBe(0);
    view.dispose(); assets.dispose();
  });

  it('a newly spawned frozen unit evaluates its initial animation pose', () => {
    const model = new THREE.Group();
    model.animations = [new THREE.AnimationClip('walk', 1, [
      new THREE.VectorKeyframeTrack('.position', [0, .5, 1], [0, 0, 0, 0, 4, 0, 0, 0, 0]),
    ])];
    const { view, enemy, assets } = fixture(model);
    enemy.freezeTimer = 1;
    view.sync(enemy, 1, 1 / 60);
    expect(model.position.y).toBeGreaterThan(0);
    view.dispose(); assets.dispose();
  });

  it('untracked upper-body bones never accumulate procedural rotation', () => {
    const model = new THREE.Group();
    const chest = new THREE.Bone(); chest.name = 'chest'; model.add(chest);
    model.animations = [new THREE.AnimationClip('walk', 1.35, [
      new THREE.VectorKeyframeTrack('.position', [0, 1.35], [0, 0, 0, 0, 0, 0]),
    ])];
    const { view, enemy, assets } = fixture(model);
    let peak = 0;
    for (let i = 0; i < 1800; i++) {
      view.sync(enemy, 1, 1 / 60);
      peak = Math.max(peak, Math.abs(chest.rotation.y));
    }
    expect(peak).toBeGreaterThan(.001);
    expect(peak).toBeLessThan(.02);
    const frozen = chest.quaternion.clone();
    enemy.freezeTimer = 1;
    for (let i = 0; i < 20; i++) view.sync(enemy, 1, 1 / 60);
    expect(chest.quaternion.angleTo(frozen)).toBeLessThan(.00001);
    view.dispose(); assets.dispose();
  });

  it('fallback attack thrusts in local forward and rests between strikes', () => {
    const { view, enemy, assets } = fixture();
    const model = view.object3d.children[0];
    view.startCastleAttack(16);
    view.sync(enemy, 1, .375);
    expect(model.position.x).toBe(0);
    expect(model.position.z).toBeGreaterThan(8);
    view.sync(enemy, 1, 1);
    expect(model.position.length()).toBe(0);
    view.dispose(); assets.dispose();
  });

  it('pooled enemies retain translucent materials and emission settings', () => {
    const model = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ opacity: .45, transparent: true, depthWrite: false, emissiveIntensity: .3 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [material, material]); model.add(mesh);
    const { view, enemy, assets } = fixture(model);
    view.hit(); view.startCastleAttack(2); view.sync(enemy, 1, 1);
    expect((mesh.material[0] as THREE.MeshStandardMaterial).emissiveIntensity).toBeCloseTo(.3);
    view.startDeath(); view.sync(enemy, 1, .5); view.resetForReuse();
    for (const mat of mesh.material) {
      expect(mat.opacity).toBe(.45); expect(mat.transparent).toBe(true); expect(mat.depthWrite).toBe(false);
    }
    expect(material.opacity).toBe(.45);
    view.dispose(); assets.dispose(); material.dispose(); mesh.geometry.dispose();
  });

  it('smoke expands and fades without additional draws or idle uploads', () => {
    const ps = new ParticleSystem(BALANCE.presets.high);
    const geometry = ps.points.geometry;
    expect(ps.points.visible).toBe(false);
    ps.emit('ground_smoke', 10, 10, 10);
    const size = geometry.getAttribute('particleSize');
    const initial = size.getX(0);
    ps.update(.2);
    expect(size.getX(0)).toBeGreaterThan(initial);
    expect(geometry.getAttribute('particleAlpha').getX(0)).toBeLessThan(1);
    ps.update(2);
    expect(ps.points.visible).toBe(false);
    const version = (size as THREE.BufferAttribute).version;
    ps.update(.1);
    expect((size as THREE.BufferAttribute).version).toBe(version);
    ps.dispose();
  });

  it('clearing a pool disposes free objects exactly once', () => {
    const dispose = vi.fn();
    const pool = new ObjectPool(() => ({}), () => {}, 3);
    const live = pool.acquire();
    pool.release(live);
    pool.clear(dispose); pool.clear(dispose);
    expect(dispose).toHaveBeenCalledTimes(3);
  });
});
