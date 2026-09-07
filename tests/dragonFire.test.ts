import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TowerView } from '../src/view/views/TowerView';
import { Tower } from '../src/sim/Tower';
import { TOWERS } from '../src/data/towers';
import type { AssetRegistry } from '../src/view/AssetRegistry';
import type { Terrain } from '../src/view/Terrain';
import { createGroundFireAssets, GroundFireView } from '../src/view/views/GroundFireView';
import { FlameJetView, UnitBurnView } from '../src/view/vfx/DragonFireEffects';

let model: GLTF;
beforeAll(async () => {
  const io = new NodeIO();const doc = await io.read('public/assets/models/fire_tower.glb');
  for (const tex of doc.getRoot().listTextures()) tex.dispose();
  const bytes = await io.writeBinary(doc);
  model = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
});

describe('Dragon fire tower', () => {
  it('preserves mouth markers and animates exactly one additional head at each upgrade', () => {
    const assets = { getMesh: () => { const clone = model.scene.clone(true);clone.animations = model.animations;return clone; } } as unknown as AssetRegistry;
    const terrain = { heightAt: () => 0 } as unknown as Terrain;
    const def = TOWERS.fire_tower;
    expect(def.levels.every(l => l.view.modelId === 'fire_tower')).toBe(true);
    const tower = new Tower('dragon', def, 0, 0);
    const view = new TowerView(def, 0, 0, 1, terrain, assets);
    try {
      for (let level = 1; level <= 5; level++) {
        view.setLevel(level);view.sync(tower, 1, .4);
        const heads = Array.from({ length: 5 }, (_, i) => view.object3d.getObjectByName(`bow${i + 1}`)!);
        expect(heads.filter(h => h.visible && h.scale.x > .1)).toHaveLength(level);
        view.fire(Math.PI / 2, 0);
        const mouth = view.muzzleNode(0)!;
        expect(mouth).toBeTruthy();
        const before = mouth.getWorldPosition(new THREE.Vector3());
        expect(before.x).toBeGreaterThan(12); // The east-facing mouth stays outside the drum.
        view.sync(tower, 1, .1);
        expect(mouth.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeGreaterThan(.1);
        const jaw = mouth.parent!.children.find(c => c.name.endsWith('_jaw'))!;
        expect(jaw.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.1);
        view.sync(tower, 1, .7);
        expect(jaw.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.001);
      }
    } finally { view.dispose(); }
  });

  it('keeps scorch and embers on sloping ground while the fire spreads', () => {
    const assets = createGroundFireAssets();
    const height = (x: number, z: number) => x * .12 + z * .2;
    const view = new GroundFireView(assets, 30, 'flame', 3, height);
    try {
      for (const dt of [.1, .5]) {
        view.update(dt);view.object3d.updateMatrixWorld(true);
        const scorch = view.object3d.children[0] as THREE.Mesh;
        const p = scorch.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(scorch.matrixWorld);
          expect(v.y).toBeCloseTo(height(v.x, v.z) + .02, 4);
        }
      }
    } finally { view.dispose();assets.dispose(); }
  });

  it('animates transparent breath and clears burn state without destroying shared textures', () => {
    const assets = createGroundFireAssets(), camera = new THREE.PerspectiveCamera();
    camera.position.set(100, 80, 100);camera.lookAt(0, 0, 0);camera.updateMatrixWorld();
    const jet = new FlameJetView(assets), burn = new UnitBurnView(assets);
    const dispose = vi.spyOn(assets.maps.flame, 'dispose');
    for (const t of [0, .25, .8, 1]) {
      jet.update(new THREE.Vector3(0, 60, 0), new THREE.Vector3(90, 0, 0), t, .1, camera);
      for (const m of jet.object3d.children as THREE.InstancedMesh[]) {
        expect(Array.from(m.instanceMatrix.array).every(Number.isFinite)).toBe(true);
        expect((m.material as THREE.Material).depthWrite).toBe(false);
      }
    }
    burn.ignite();expect(burn.update(.1, camera)).toBeGreaterThan(0);
    expect(burn.update(1.2, camera)).toBe(0);expect(burn.object3d.visible).toBe(false);
    burn.ignite();burn.reset();expect(burn.object3d.visible).toBe(false);
    jet.dispose();burn.dispose();expect(dispose).not.toHaveBeenCalled();assets.dispose();
  });
});
