import { describe, it, expect } from 'vitest';
import { LEVEL_04 } from '../src/data/levels/level04';
import { LEVEL_05 } from '../src/data/levels/level05';
import { LEVEL_06 } from '../src/data/levels/level06';
import { Path } from '../src/sim/Path';
import { Terrain } from '../src/view/Terrain';
import { BALANCE } from '../src/data/balance';
import { LEVEL_01 } from '../src/data/levels/level01';
import { LEVEL_02 } from '../src/data/levels/level02';
import { LEVEL_03 } from '../src/data/levels/level03';
import * as THREE from 'three';

describe('Chapter landscapes', () => {
  for (const level of [LEVEL_01, LEVEL_02, LEVEL_03, LEVEL_04, LEVEL_05, LEVEL_06]) {
    it(`${level.id}: elevated terrain preserves the road and full building footprint`, () => {
      const path = new Path(level.path);
      const terrain = new Terrain(path, level.environment, undefined, 1337, level.buildSlots);
      const p = { x: 0, z: 0 };
      for (let d = 0; d <= path.totalLength; d += 10) {
        path.positionAt(d, p);
        expect(Math.abs(terrain.heightAt(p.x, p.z))).toBeLessThan(.1);
      }
      for (const slot of level.buildSlots) for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        expect(Math.abs(terrain.heightAt(slot.x + Math.cos(a) * 32, slot.z + Math.sin(a) * 32))).toBeLessThan(.1);
      }
      // From shallow, rotated views, terrain must not hide the building markers.
      terrain.group.updateMatrixWorld(true);
      for (const yaw of [-Math.PI / 3, 0, Math.PI / 3]) {
        const origin = new THREE.Vector3(600 + Math.sin(yaw) * 1500, 800, 350 + Math.cos(yaw) * 1500);
        for (const slot of level.buildSlots) {
          const target = new THREE.Vector3(slot.x, 8, slot.z);
          const ray = new THREE.Raycaster(origin, target.clone().sub(origin).normalize(), 0, origin.distanceTo(target) - .1);
          expect(ray.intersectObject(terrain.group, true), `terrain obscures ${slot.id} at yaw ${yaw}`).toHaveLength(0);
        }
      }
      terrain.dispose();
    });
  }
  for (const level of [LEVEL_04, LEVEL_05, LEVEL_06]) {
    it(`${level.id}: keeps roads dry and flat, provides chapter scenery, releases it on preset rebuild`, () => {
      const path = new Path(level.path);
      const terrain = new Terrain(path, level.environment, undefined, 1337, level.buildSlots);
      const p = { x: 0, z: 0 };
      for (let d = 0; d <= path.totalLength; d += 12) {
        path.positionAt(d, p);
        expect(Math.abs(terrain.heightAt(p.x, p.z))).toBeLessThan(.1);
      }
      for (const slot of level.buildSlots) expect(terrain.heightAt(slot.x, slot.z)).toBeGreaterThanOrEqual(0);
      terrain.buildDecor(BALANCE.presets.low);
      const old = terrain.group.children.find(c => c.name.startsWith('landscape-'))!;
      expect(old).toBeDefined();
      expect(!!old.getObjectByName('chapter-water')).toBe(level.id !== 'level06');
      terrain.buildDecor(BALANCE.presets.low);
      expect(old.parent).toBe(terrain.group);
      terrain.buildDecor(BALANCE.presets.medium);
      expect(old.parent).toBeNull();
      expect(old.children).toHaveLength(0);
      expect(terrain.group.children.filter(c => c.name.startsWith('landscape-'))).toHaveLength(1);
      terrain.dispose();
      expect(terrain.group.children).toHaveLength(0);
    });
  }
});
