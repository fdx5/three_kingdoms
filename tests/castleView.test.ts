import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { CastleView } from '../src/view/views/CastleView';
import { AssetRegistry } from '../src/view/AssetRegistry';
import type { Terrain } from '../src/view/Terrain';
import type { Castle } from '../src/sim/Castle';
import { LEVEL_04 } from '../src/data/levels/level04';
import { LEVEL_05 } from '../src/data/levels/level05';
import { LEVEL_06 } from '../src/data/levels/level06';

describe('Castle model and weapon sockets', () => {
  it('registers the castle GLB for every late chapter', () => {
    const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8'));
    for (const level of [LEVEL_04, LEVEL_05, LEVEL_06]) {
      const model = manifest.models[level.castle.id];
      expect(model).toEqual(manifest.models.hulao_gate);
      expect(existsSync(`public/assets/${model.url}`)).toBe(true);
    }
  });

  it('replaces baked barrels without changing the cached model or wall geometry', () => {
    const assets = new AssetRegistry();
    const source = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 180), material);
    wall.position.set(40, 50, 0); wall.name = 'wall'; source.add(wall);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), material);
    barrel.position.set(-20, 80, -33); barrel.name = 'baked-barrel'; source.add(barrel);
    vi.spyOn(assets, 'getModel').mockReturnValue({scene: source, animations: [], entry: {url: 'models/castle.glb'}});
    vi.spyOn(assets, 'getMesh').mockImplementation(() => source.clone(true));
    const view = new CastleView(0, 0, {heightAt: () => 0} as unknown as Terrain, assets, 'hulao_gate');
    const replaced = view.object3d.getObjectByName('baked-barrel') as THREE.Mesh;
    expect(replaced.geometry).not.toBe(barrel.geometry);
    expect(replaced.geometry.getIndex()!.count).toBe(0);
    expect(barrel.geometry.getIndex()!.count).toBe(36);
    expect((view.object3d.getObjectByName('wall') as THREE.Mesh).geometry).toBe(wall.geometry);
    const disposed = vi.spyOn(replaced.geometry, 'dispose');
    view.dispose(); expect(disposed).toHaveBeenCalledOnce();
    wall.geometry.dispose(); barrel.geometry.dispose(); material.dispose();
  });

  it('anchors batteries in the front wall and keeps sockets aligned after rotation and recoil', () => {
    const assets = new AssetRegistry();
    const material = new THREE.MeshStandardMaterial();
    const geometry = new THREE.BoxGeometry(150, 100, 180);
    vi.spyOn(assets, 'getMesh').mockImplementation(() => {
      const model = new THREE.Mesh(geometry, material);
      model.position.y = 50;
      return model;
    });
    const terrain = { heightAt: () => 7 } as unknown as Terrain;
    const view = new CastleView(200, 300, terrain, assets, 'hefei_gate', { x: 0, z: 1 });
    const parent = new THREE.Group(); view.mount(parent);
    for (const [level, count] of [[1, 1], [2, 2], [3, 2], [4, 2], [5, 4], [6, 2]]) {
      view.setLevel(level);
      const mounts = view.object3d.getObjectByName('castle-weapons')!;
      expect(mounts.children).toHaveLength(Math.min(count, 2));
      for (const mount of mounts.children) {
        expect(mount.position.x).toBeCloseTo(-74);
        expect(mount.position.y).toBeCloseTo(64);
      }
      const sockets = new Set(Array.from({length: count}, (_, i) => view.muzzleNode(i)));
      expect(sockets.size).toBe(count);
      const socket = view.muzzle(0, new THREE.Vector3());
      expect(socket.y).toBeGreaterThan(60);
      const muzzle = view.object3d.getObjectByName('castle-muzzle-0') as THREE.Mesh;
      const disposed = vi.spyOn(muzzle.material as THREE.Material, 'dispose');
      view.setLevel(level);
      expect(view.object3d.getObjectByName('castle-muzzle-0')).toBe(muzzle);
      view.fire(0, { x: 200, z: 0 });
      const firingPosition = view.muzzle(0, new THREE.Vector3());
      const direction = new THREE.Vector3(-1, 0, 0).transformDirection(muzzle.matrixWorld);
      const targetDirection = new THREE.Vector3(200, 7, 0).sub(firingPosition).normalize();
      expect(direction.dot(targetDirection)).toBeGreaterThan(.98);
      const foundation = mounts.children[0].position.clone();
      view.sync({ level } as Castle, 1, .1);
      expect(mounts.children[0].position.equals(foundation)).toBe(true);
      expect(muzzle.parent!.position.x).toBeGreaterThan(0);
      expect(view.muzzle(0, new THREE.Vector3()).toArray().every(Number.isFinite)).toBe(true);
      view.sync({ level } as Castle, 1, 1);
      expect(muzzle.parent!.position.x).toBe(0);
      if (level < 6) view.setLevel(level + 1); else view.dispose();
      expect(disposed).toHaveBeenCalledOnce();
    }
    geometry.dispose(); material.dispose();
  });
});
