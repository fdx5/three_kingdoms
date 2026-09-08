import * as THREE from 'three';

export interface GroundCover { map: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture; amount: number }

/** Blend two decorrelated texture samples, keeping colour/normal/roughness aligned.
 * Shared UV derivatives preserve crisp mip selection at the blend boundaries.
 * No displacement, screen buffer or additional draw call is required.
 */
export function groundMaterialDetail(material: THREE.MeshStandardMaterial, enabled: boolean, cover?: GroundCover): void {
  if (material.userData.groundDetail === enabled) return;
  material.userData.groundDetail = enabled;
  material.customProgramCacheKey = () => `ground-detail-v2-${enabled}-${!!cover}`;
  material.onBeforeCompile = shader => {
    if (!enabled) return;
    if (cover) {
      shader.uniforms.groundCoverMap = { value: cover.map };
      shader.uniforms.groundCoverNormal = { value: cover.normal };
      shader.uniforms.groundCoverRoughness = { value: cover.roughness };
      shader.uniforms.groundCoverAmount = { value: cover.amount };
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      ${cover ? `
        uniform sampler2D groundCoverMap, groundCoverNormal, groundCoverRoughness;
        uniform float groundCoverAmount;
        float groundCoverWeight(vec2 uv) {
          float coverage = sin(uv.x * .72 + sin(uv.y * .43)) * .55
            + sin(uv.y * .94 - uv.x * .28) * .45;
          return smoothstep(-.15, .65, coverage) * groundCoverAmount;
        }
      ` : ''}
      vec4 groundSample(sampler2D surfaceMap, vec2 uv) {
        float field = sin(dot(uv, vec2(.31, .27))) * 1.7
          + sin(dot(uv, vec2(-.19, .43)) + 1.8) * 1.3;
        float cell = floor(field);
        vec2 a = fract(sin(vec2(cell, cell + 11.0) * vec2(12.9898, 78.233)) * 43758.5453);
        vec2 b = fract(sin(vec2(cell + 1.0, cell + 12.0) * vec2(12.9898, 78.233)) * 43758.5453);
        vec2 dx = dFdx(uv), dy = dFdy(uv);
        return mix(textureGrad(surfaceMap, uv + a, dx, dy), textureGrad(surfaceMap, uv + b, dx, dy),
          smoothstep(.15, .85, fract(field)));
      }
    `);
    for (const name of ['map_fragment', 'normal_fragment_maps', 'roughnessmap_fragment'] as const) {
      const chunk = THREE.ShaderChunk[name].replace(/texture2D\( (map|normalMap|roughnessMap), (vMapUv|vNormalMapUv|vRoughnessMapUv) \)/g,
        (_match, sampler: string, uv: string) => {
          const base = `groundSample(${sampler}, ${uv})`;
          if (!cover) return base;
          const layer = sampler === 'map' ? 'groundCoverMap' : sampler === 'normalMap' ? 'groundCoverNormal' : 'groundCoverRoughness';
          return `mix(${base}, groundSample(${layer}, ${uv} * .73 + vec2(.23, .51)), groundCoverWeight(${uv}))`;
        });
      shader.fragmentShader = shader.fragmentShader.replace(`#include <${name}>`, chunk);
    }
  };
  material.needsUpdate = true;
}
