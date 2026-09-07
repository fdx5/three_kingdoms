import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** HDR highlights only; terrain stays readable. Owned by the renderer, not a level. */
export class BattlePostFx {
  private composer: EffectComposer;
  private scenePass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  private bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.24, 0.35, 1.25);
  private output = new OutputPass();
  private size = new THREE.Vector2();
  private width = 0;
  private height = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    target.samples = Math.min(4, renderer.capabilities.maxSamples);
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(1);
    this.composer.addPass(this.scenePass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, dt: number): void {
    this.renderer.getDrawingBufferSize(this.size);
    // Bound HDR buffers on high-DPI/4K screens without lowering the native canvas.
    const scale = Math.min(1, 1920 / this.size.x, 1200 / this.size.y);
    const width = Math.max(1, Math.round(this.size.x * scale));
    const height = Math.max(1, Math.round(this.size.y * scale));
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.composer.setSize(width, height);
      // Bloom starts at quarter resolution, independent of the sharp scene image.
      this.bloom.setSize(Math.max(64, width / 2), Math.max(64, height / 2));
    }
    this.scenePass.scene = scene;
    this.scenePass.camera = camera;
    this.composer.render(dt);
  }

  dispose(): void {
    this.scenePass.dispose();
    this.bloom.dispose();
    // r180 does not dispose this threshold material in UnrealBloomPass.dispose().
    this.bloom.materialHighPassFilter.dispose();
    this.output.dispose();
    this.composer.dispose();
  }
}
