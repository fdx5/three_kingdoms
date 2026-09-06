import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createGroundFireAssets, GroundFireView } from '../src/view/views/GroundFireView';

describe('Ground fire lifecycle', () => {
  it.each(['stone', 'flame'] as const)('keeps %s residues after flames stop, then finishes without resetting on repeated removal', (source) => {
    const assets = createGroundFireAssets();
    const view = new GroundFireView(assets, 30, source, 1);
    view.update(1);
    view.extinguish();
    view.update(.4);
    const flames = view.object3d.children.find(c => c instanceof THREE.InstancedMesh)!;
    expect(flames.visible).toBe(false);
    expect(view.finished).toBe(false);
    expect((view.object3d.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>).material.opacity).toBeGreaterThan(0);
    view.extinguish();
    view.update(2.1);
    expect(view.finished).toBe(true);
    view.dispose();
    assets.dispose();
  });

  it('varies patches between impacts and turns them toward the camera', () => {
    const assets = createGroundFireAssets();
    const a = new GroundFireView(assets, 30, 'arrow', 1);
    const b = new GroundFireView(assets, 30, 'arrow', 2);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 100, 100);
    const matrix = (v: GroundFireView) => Array.from((v.object3d.children.find(c => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh).instanceMatrix.array);
    a.update(1, camera); b.update(1, camera);
    const before = matrix(a);
    expect(matrix(b)).not.toEqual(before);
    camera.position.set(100, 100, 0);
    a.update(0, camera);
    expect(matrix(a)).not.toEqual(before);
    expect(matrix(a).every(Number.isFinite)).toBe(true);
    a.dispose(); b.dispose(); assets.dispose();
  });

  it('releases per-impact materials without disposing assets shared by other fires', () => {
    const assets = createGroundFireAssets();
    const view = new GroundFireView(assets, 30, 'shell');
    const root = new THREE.Group(); root.add(view.object3d);
    const sharedDispose = vi.spyOn(assets.quad, 'dispose');
    const textureDispose = vi.spyOn(assets.maps.flame, 'dispose');
    const material = (view.object3d.children[0] as THREE.Mesh).material as THREE.Material;
    const materialDispose = vi.spyOn(material, 'dispose');
    view.dispose();
    expect(root.children).toHaveLength(0);
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(sharedDispose).not.toHaveBeenCalled();
    expect(textureDispose).not.toHaveBeenCalled();
    assets.dispose();
    expect(sharedDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
  });
});
