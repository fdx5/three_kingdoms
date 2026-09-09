import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

/** Contact shade belongs to opaque surfaces, never to invisible hit volumes or VFX. */
export class ContactOcclusion extends GTAOPass {
  private hidden: THREE.Object3D[] = [];

  constructor() {
    super(new THREE.Scene(), new THREE.PerspectiveCamera(), 1, 1);
    this.blendIntensity = .5;
    this.updateGtaoMaterial({ radius: 8, thickness: 2, distanceFallOff: .9, samples: 12, screenSpaceRadius: false });
    this.updatePdMaterial({ radius: 3, samples: 8, rings: 2 });
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, dt: number, maskActive: boolean): void {
    const excluded = (m: THREE.Material) => !m.visible || m.transparent || !m.depthWrite;
    this.scene.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.userData.contactOcclusion === false || (Array.isArray(object.material) ? object.material.every(excluded) : excluded(object.material))) {
        this.hidden.push(object);
        object.visible = false;
      }
    });
    const autoShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    try {
      super.render(renderer, writeBuffer, readBuffer, dt, maskActive);
    } finally {
      renderer.shadowMap.autoUpdate = autoShadow;
      for (const object of this.hidden) object.visible = true;
      this.hidden.length = 0;
    }
  }

  override dispose(): void {
    super.dispose();
    // Three r180's pass omits these two owned materials in its dispose method.
    this.gtaoMaterial.dispose();
    this.blendMaterial.dispose();
  }
}
