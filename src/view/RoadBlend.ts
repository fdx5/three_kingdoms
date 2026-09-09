import * as THREE from 'three';
import { BALANCE } from '../data/balance';
import type { Path } from '../sim/Path';

export interface RoadBlend {
  field: THREE.DataTexture;
  map: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  tint: THREE.Color;
  vegetation: THREE.Color;
  wetness: number;
  rain: number;
}

/** World-space distance, not ribbon UVs: corners and shoulders share one opaque ground. */
export function roadDistanceField(path: Path): THREE.DataTexture {
  const width = 600, height = 350;
  const data = new Uint8Array(width * height);
  data.fill(255);
  for (let segment = 1; segment < path.points.length; segment++) {
    const [ax, az] = path.points[segment - 1], [bx, bz] = path.points[segment];
    const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
    const minX = Math.max(0, Math.floor((Math.min(ax, bx) - 128) / 2));
    const maxX = Math.min(width - 1, Math.ceil((Math.max(ax, bx) + 128) / 2));
    const minZ = Math.max(0, Math.floor((Math.min(az, bz) - 128) / 2));
    const maxZ = Math.min(height - 1, Math.ceil((Math.max(az, bz) + 128) / 2));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const wx = (x + .5) * BALANCE.mapWidth / width, wz = (z + .5) * BALANCE.mapDepth / height;
      const t = THREE.MathUtils.clamp(((wx - ax) * dx + (wz - az) * dz) / length2, 0, 1);
      const distance = Math.hypot(wx - ax - t * dx, wz - az - t * dz);
      const index = z * width + x;
      data[index] = Math.min(data[index], Math.round(Math.min(1, distance / 128) * 255));
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

type Shader = Parameters<THREE.MeshStandardMaterial['onBeforeCompile']>[0];

export function blendRoad(shader: Shader, road: RoadBlend): void {
  Object.assign(shader.uniforms, {
    roadField: { value: road.field }, roadMap: { value: road.map },
    roadNormal: { value: road.normal }, roadRoughness: { value: road.roughness },
    roadTint: { value: road.tint }, vegetationTint: { value: road.vegetation },
    landscapeWetness: { value: road.wetness },
    landscapeRain: { value: road.rain },
  });
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 landscapePosition; varying float landscapeHeight;');
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
    '#include <begin_vertex>\nlandscapePosition = (modelMatrix * vec4(position, 1.0)).xz; landscapeHeight = position.y;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
    #include <common>
    varying vec2 landscapePosition;
    varying float landscapeHeight;
    uniform float landscapeWetness;
    uniform float landscapeRain;
    uniform sampler2D roadField, roadMap, roadNormal, roadRoughness;
    uniform vec3 roadTint, vegetationTint;
    float landscapeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float landscapeNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(landscapeHash(i), landscapeHash(i + vec2(1,0)), f.x),
        mix(landscapeHash(i + vec2(0,1)), landscapeHash(i + vec2(1,1)), f.x), f.y);
    }
  `);
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
    #include <color_fragment>
    vec2 roadUv = landscapePosition * vec2(1.0, -1.0) / 88.0;
    vec2 fieldUv = landscapePosition / vec2(${BALANCE.mapWidth.toFixed(1)}, ${BALANCE.mapDepth.toFixed(1)});
    float roadDistance = texture2D(roadField, clamp(fieldUv, 0.0, 1.0)).r * 128.0;
    // Fade at the battlefield edge, so the surrounding apron never repeats the road.
    vec2 outside = max(-landscapePosition, landscapePosition - vec2(${BALANCE.mapWidth.toFixed(1)}, ${BALANCE.mapDepth.toFixed(1)}));
    roadDistance += max(0.0, max(outside.x, outside.y));
    float broad = landscapeNoise(landscapePosition * .018);
    float grain = landscapeNoise(landscapePosition * .27);
    float erosion = (landscapeNoise(landscapePosition * .075) - .5) * 12.0 + (grain - .5) * 5.0;
    float roadWeight = 1.0 - smoothstep(29.0, 53.0, roadDistance + erosion);
    float rut = exp(-pow((roadDistance - 17.0 - (broad - .5) * 3.0) / 2.5, 2.0));
    vec3 roadSample = texture2D(roadMap, roadUv).rgb;
    float roadLuma = dot(roadSample, vec3(.2126,.7152,.0722));
    vec3 roadAlbedo = mix(roadSample, vec3(roadLuma), .42) * roadTint * 1.18;
    roadAlbedo *= 1.04 - rut * .16 + (broad - .5) * .12;
    // Broad meadow patches and dark root soil give the eye quiet, readable masses.
    float meadow = (.48 + smoothstep(.23, .72, broad) * .52) * smoothstep(36.0, 68.0, roadDistance);
    float groundLuma = dot(diffuseColor.rgb, vec3(.2126,.7152,.0722));
    vec3 meadowColor = vegetationTint * (groundLuma * 2.2 + .025);
    diffuseColor.rgb = mix(diffuseColor.rgb, meadowColor, meadow * .28);
    diffuseColor.rgb = mix(diffuseColor.rgb, roadAlbedo, roadWeight);
    float damp = landscapeWetness * (1.0 - smoothstep(-.8, 4.0, landscapeHeight + broad * 1.5))
      * smoothstep(52.0, 72.0, roadDistance);
    diffuseColor.rgb *= 1.0 - damp * .32;
    diffuseColor.rgb *= 1.0 - landscapeRain * ${BALANCE.fx.weather.wetDarkening};
  `);
  // Preserve the same ground tangent basis for both materials; their UV axes agree.
  const normalChunk = THREE.ShaderChunk.normal_fragment_maps.replace(
    'texture2D( normalMap, vNormalMapUv ).xyz',
    'mix(texture2D(normalMap, vNormalMapUv).xyz, texture2D(roadNormal, roadUv).xyz, roadWeight)');
  shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', normalChunk);
  shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
    #include <roughnessmap_fragment>
    roughnessFactor = mix(roughnessFactor, max(.72, texture2D(roadRoughness, roadUv).g), roadWeight);
    roughnessFactor = mix(roughnessFactor, .46, damp);
    roughnessFactor = mix(roughnessFactor, ${BALANCE.fx.weather.wetRoughness}, landscapeRain);
  `);
}
