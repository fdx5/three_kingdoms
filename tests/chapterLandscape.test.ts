import { describe, it, expect } from 'vitest';
import { LEVEL_04 } from '../src/data/levels/level04';
import { LEVEL_05 } from '../src/data/levels/level05';
import { LEVEL_06 } from '../src/data/levels/level06';
import { Path } from '../src/sim/Path';
import { Terrain } from '../src/view/Terrain';
import { BALANCE } from '../src/data/balance';

describe('Chapter landscapes', () => {
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
