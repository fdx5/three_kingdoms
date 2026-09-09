import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { rainRipplesGLSL } from './vfx/RainRipples';
import { BALANCE } from '../data/balance';

/** One shared planar reflection for all pools at the same waterline. */
export class WaterReflection extends Reflector {
  declare material: THREE.ShaderMaterial;
  constructor(surface: THREE.BufferGeometry, time: { value: number }, rain = false) {
    const geometry = surface.clone().translate(0, 1.1, 0).rotateX(Math.PI / 2);
    super(geometry, { textureWidth: 768, textureHeight: 512, multisample: 0, clipBias: .002 });
    this.rotation.x = -Math.PI / 2;
    this.position.y = -1.06;
    this.name = 'chapter-water-reflection';
    this.renderOrder = 1;
    this.material.transparent = true;
    this.material.depthWrite = false;
    this.material.uniforms.waterTime = time;
    this.material.vertexShader = this.material.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float waterDepth; varying float depth; varying vec3 worldPosition;`)
      .replace('void main() {', `void main() {
        depth = waterDepth; worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`);
    this.material.fragmentShader = this.material.fragmentShader
      .replace('uniform vec3 color;', 'uniform vec3 color; uniform float waterTime; varying float depth; varying vec3 worldPosition;')
      .replace('vec4 base = texture2DProj( tDiffuse, vUv );', `
        if (depth < .15) discard;
        vec2 ripple = vec2(sin(worldPosition.z * .11 + waterTime * .8),
          cos(worldPosition.x * .09 - waterTime * .6)) * .0012;
        vec4 base = texture2D(tDiffuse, vUv.xy / vUv.w + ripple);
      `)
      .replace('gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );', `
        vec3 viewDirection = normalize(cameraPosition - worldPosition);
        float fresnel = .08 + .7 * pow(1.0 - max(viewDirection.y, 0.0), 4.0);
        gl_FragColor = vec4(base.rgb, fresnel * smoothstep(.15, 3.5, depth));
      `);
    const renderReflection = this.onBeforeRender;
    if (rain) this.material.fragmentShader = this.material.fragmentShader
      .replace('void main() {', rainRipplesGLSL + '\nvoid main() {')
      .replace('vec4 base = texture2D', `ripple += rainRing(worldPosition.xz, waterTime) * ${BALANCE.fx.weather.rippleStrength} * .01;\nvec4 base = texture2D`);
    this.onBeforeRender = (renderer, scene, camera, ...rest) => {
      // Helpers and transparent water must not appear in the reflection capture.
      const hidden: THREE.Object3D[] = [];
      const visible = this.visible;
      const target = renderer.getRenderTarget();
      const shadows = renderer.shadowMap.autoUpdate, xr = renderer.xr.enabled;
      scene.traverseVisible(object => {
        if (!(object instanceof THREE.Mesh) || object === this) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.every(m => m.side !== THREE.BackSide && (m.transparent || !m.depthWrite || !m.visible))) {
          hidden.push(object); object.visible = false;
        }
      });
      try { renderReflection.call(this, renderer, scene, camera, ...rest); }
      finally {
        for (const object of hidden) object.visible = true;
        this.visible = visible;
        renderer.shadowMap.autoUpdate = shadows; renderer.xr.enabled = xr;
        if (renderer.getRenderTarget() !== target) renderer.setRenderTarget(target);
      }
    };
  }
}
