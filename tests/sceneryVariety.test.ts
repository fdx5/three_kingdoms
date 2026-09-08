import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LEVELS } from '../src/data/levels';
import { Terrain, distanceToPath } from '../src/view/Terrain';
import { Path } from '../src/sim/Path';
import { BALANCE } from '../src/data/balance';

describe('Chapter settlements and trees', () => {
  for (const level of Object.values(LEVELS)) it(`${level.id}: keeps distinct buildings and trees on safe ground across quality changes`, () => {
    const path = new Path(level.path);
    const terrain = new Terrain(path, level.environment, undefined, 1337, level.buildSlots);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    for (const preset of [BALANCE.presets.high, BALANCE.presets.low]) {
      terrain.buildDecor(preset);
      const houses = terrain.group.children.filter(o => o.name.startsWith('settlement-')) as THREE.InstancedMesh[];
      const species = terrain.group.children.filter(o => o.name.startsWith('trees-')) as THREE.InstancedMesh[];
      expect(new Set(houses.map(o => o.userData.houseKind).filter(Boolean)).size).toBeGreaterThanOrEqual(3);
      expect(new Set(species.map(o => o.userData.treeSpecies)).size).toBeGreaterThanOrEqual(1);
      for (const mesh of [...houses, ...species]) {
        const vertices = mesh.geometry.getAttribute('position');
        for (let i = 0; i < vertices.count; i++) {
          expect(Number.isFinite(vertices.getX(i) + vertices.getY(i) + vertices.getZ(i))).toBe(true);
        }
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
          expect(distanceToPath(path, position.x, position.z)).toBeGreaterThan(65);
          expect(level.buildSlots.every(slot => Math.hypot(position.x - slot.x, position.z - slot.z) > 70)).toBe(true);
        }
      }
    }
    terrain.dispose();
    expect(terrain.group.children).toHaveLength(0);
  });
});
