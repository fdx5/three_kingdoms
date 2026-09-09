import * as THREE from 'three';

/** Continuous timber fibres and mortar staining at world scale, shared by batched props. */
export function weatheredMaterial(material: THREE.MeshStandardMaterial, kind: 'timber' | 'plaster'): void {
  material.customProgramCacheKey = () => `weathered-${kind}-v1`;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 weatherPosition;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vec4 weatherWorld = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        weatherWorld = instanceMatrix * weatherWorld;
      #endif
      weatherPosition = (modelMatrix * weatherWorld).xyz;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 weatherPosition;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec3 p = weatherPosition;
      float wear = sin(p.x * .32 + sin(p.z * .21)) * sin(p.y * .28 + p.z * .17);
      ${kind === 'timber' ? `
        float fibre = sin(p.x * 6.0 + p.z * 3.7 + sin(p.y * .21 + p.z * .08) * 2.8);
        float fine = sin(p.x * 17.0 + p.z * 11.0 + sin(p.y * .4));
        diffuseColor.rgb *= .86 + wear * .12 + fibre * .09 + fine * .025;
      ` : `
        float grit = sin(p.x * 8.7 + p.y * 9.3) * sin(p.z * 7.1 - p.y * 6.0);
        diffuseColor.rgb *= .94 + wear * .055 + grit * .018;
      `}
    `);
  };
}
