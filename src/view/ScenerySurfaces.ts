import * as THREE from 'three';
import type { AssetRegistry } from './AssetRegistry';

/** Photographic PBR textures, cloned once and shared by every scenery instance. */
export function scenerySurface(kind: 'bark' | 'stone', assets?: AssetRegistry) {
  const texture = (suffix: string) => {
    const t = assets?.getTexture(`scenery_${kind}${suffix}`)?.clone() ?? null;
    if (t) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.repeat.set(kind === 'bark' ? 1 : 1.5, kind === 'bark' ? 2 : 1);
      t.needsUpdate = true;
    }
    return t;
  };
  return { map: texture(''), normalMap: texture('_normal'), roughnessMap: texture('_roughness') };
}
