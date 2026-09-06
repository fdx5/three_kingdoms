import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TowerView } from '../src/view/views/TowerView';
import { TOWERS } from '../src/data/towers';
import type { AssetRegistry } from '../src/view/AssetRegistry';
import type { Terrain } from '../src/view/Terrain';
import { Tower } from '../src/sim/Tower';

describe('철질려 애니메이션 수명', () => {
  it('업그레이드 후에도 새 가시가 움직이고 감속 반응을 재생한다', () => {
    const models: THREE.Group[] = [];
    const assets = { getMesh: () => {
      const model = new THREE.Group();
      const spike = new THREE.Bone();
      spike.name = 'spike1';
      model.add(spike);
      model.animations = [
        new THREE.AnimationClip('idle', 1, [new THREE.NumberKeyframeTrack('spike1.rotation[y]', [0, 1], [0, 1])]),
        new THREE.AnimationClip('trigger', .5, [new THREE.NumberKeyframeTrack('spike1.position[y]', [0, .1, .5], [0, 5, 0])]),
      ];
      models.push(model);
      return model;
    } } as unknown as AssetRegistry;
    const terrain = { heightAt: () => 0 } as unknown as Terrain;
    const def = TOWERS.caltrop_camp;
    const tower = new Tower('trap', def, 0, 0);
    const view = new TowerView(def, 0, 0, 1, terrain, assets);
    try {
      for (let level = 1; level <= 5; level++) {
        view.setLevel(level);
        const spike = models.at(-1)!.getObjectByName('spike1')!;
        const before = spike.rotation.y;
        view.sync(tower, 0, .1);
        expect(spike.rotation.y).not.toBe(before);
        view.pulseAura();
        view.sync(tower, 0, .1);
        expect(spike.position.y).toBeCloseTo(5);
        view.sync(tower, 0, .5);
        expect(spike.position.y).toBeCloseTo(0);
      }
    } finally { view.dispose(); }
    const spike = models.at(-1)!.getObjectByName('spike1');
    expect(spike).toBeUndefined();
  });
});
