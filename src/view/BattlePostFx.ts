import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { ContactOcclusion } from './ContactOcclusion';

/** HDR highlights only; terrain stays readable. Owned by the renderer, not a level. */
export class BattlePostFx {
  private composer: EffectComposer;
  private scenePass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  private contact = new ContactOcclusion();
  private bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.15, 0.35, 1.25);
  private output = new OutputPass();
  private finish = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, texel: { value: new THREE.Vector2(1, 1) } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 texel; varying vec2 vUv;
      void main() {
        vec3 color = texture2D(tDiffuse, vUv).rgb;
        vec3 blur = (texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb
          + texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb
          + texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb
          + texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb) * .25;
        // Bounded sharpening restores fine roofs and foliage after MSAA without halos.
        color += clamp((color - blur) * .22, vec3(-.025), vec3(.025));
        float luma = dot(color, vec3(.2126, .7152, .0722));
        color = mix(vec3(luma), color, .96);
        color += vec3(-.008, .002, .012) * (1.0 - smoothstep(.15, .6, luma));
        vec2 frame = vUv * 2.0 - 1.0;
        color *= 1.0 - .045 * pow(dot(frame, frame) * .5, 2.0);
        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
      }`,
  });
  private size = new THREE.Vector2();
  private width = 0;
  private height = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    target.samples = Math.min(4, renderer.capabilities.maxSamples);
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(1);
    this.composer.addPass(this.scenePass);
    this.composer.addPass(this.contact);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.finish);
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
      this.finish.uniforms.texel.value.set(1 / width, 1 / height);
      // Half-resolution contact shadows, capped independently of display DPR.
      this.contact.setSize(Math.min(960, Math.round(width / 2)), Math.min(600, Math.round(height / 2)));
      // Bloom starts at quarter resolution, independent of the sharp scene image.
      this.bloom.setSize(Math.max(64, width / 2), Math.max(64, height / 2));
    }
    this.scenePass.scene = scene;
    this.scenePass.camera = camera;
    this.contact.scene = scene;
    this.contact.camera = camera;
    this.composer.render(dt);
  }

  dispose(): void {
    this.scenePass.dispose();
    this.contact.dispose();
    this.bloom.dispose();
    // r180 does not dispose this threshold material in UnrealBloomPass.dispose().
    this.bloom.materialHighPassFilter.dispose();
    this.output.dispose();
    this.finish.dispose();
    this.composer.dispose();
  }
}
