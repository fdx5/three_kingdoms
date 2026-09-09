import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { vegetationMeshes } from '../src/view/VegetationModels';
import type { AssetRegistry } from '../src/view/AssetRegistry';

describe('authored scenery placement', () => {
  it('normalises an off-centre model without moving its source or sharing disposable geometry', () => {
    const scene = new THREE.Group();
    const source = new THREE.Mesh(new THREE.BoxGeometry(12, 30, 9), new THREE.MeshStandardMaterial());
    source.position.set(17, 22, -8); scene.add(source);
    const assets = { getModel: () => ({ scene }) } as unknown as AssetRegistry;
    const [mesh] = vegetationMeshes(assets, 'tree', [{ x: 300, y: 15, z: 200, angle: 0, scale: 1 }]);
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox!;
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeLessThanOrEqual(46.001);
    expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
    expect(mesh.geometry).not.toBe(source.geometry);
    expect(mesh.material).not.toBe(source.material);
    expect(source.position.toArray()).toEqual([17, 22, -8]);
    mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose();
    source.geometry.dispose(); source.material.dispose();
  });
  it('leaves procedural fallback available when assets are missing', () => {
    expect(vegetationMeshes(undefined, 'tree', [{ x: 0, y: 0, z: 0, angle: 0, scale: 1 }])).toEqual([]);
  });
});
