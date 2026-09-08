import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ContactOcclusion } from '../src/view/ContactOcclusion';

describe('Contact occlusion visibility', () => {
  it('excludes hit volumes, VFX and small foliage, and restores state even after a render error', () => {
    const pass = new ContactOcclusion();
    const make = (material: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(), material);
    const opaque = make(new THREE.MeshStandardMaterial());
    const hit = make(new THREE.MeshBasicMaterial({ visible: false }));
    const fire = make(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    const leaves = make(new THREE.MeshStandardMaterial()); leaves.userData.contactOcclusion = false;
    const hidden = make(new THREE.MeshStandardMaterial()); hidden.visible = false;
    pass.scene.add(opaque, hit, fire, leaves, hidden);
    const renderer = { shadowMap: { autoUpdate: true } } as THREE.WebGLRenderer;
    const target = new THREE.WebGLRenderTarget();
    const render = vi.spyOn(GTAOPass.prototype, 'render').mockImplementation(() => {
      expect(opaque.visible).toBe(true);
      expect([hit, fire, leaves, hidden].every(mesh => !mesh.visible)).toBe(true);
      expect(renderer.shadowMap.autoUpdate).toBe(false);
      throw new Error('render failed');
    });
    try {
      expect(() => pass.render(renderer, target, target, 0, false)).toThrow('render failed');
      expect([opaque, hit, fire, leaves].every(mesh => mesh.visible)).toBe(true);
      expect(hidden.visible).toBe(false);
      expect(renderer.shadowMap.autoUpdate).toBe(true);
    } finally {
      render.mockRestore(); pass.dispose(); target.dispose();
      for (const mesh of [opaque, hit, fire, leaves, hidden]) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
    }
  });
});
