import * as THREE from 'three';
import type { AssetRegistry } from './AssetRegistry';

export interface VegetationSite { x: number; y: number; z: number; angle: number; scale: number }
export const VEGETATION_MODEL_IDS = ['scenery_tree_small_02', 'scenery_pine_sapling_small'] as const;

/** Preserve authored branches, leaf UVs and PBR materials; batch each source primitive. */
export function vegetationMeshes(assets: AssetRegistry | undefined, id: string, sites: VegetationSite[], distant = false): THREE.InstancedMesh[] {
  const source = assets?.getModel(id)?.scene;
  if (!source || !sites.length) return [];
  source.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(source);
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  // Bound both height and width to keep the existing gameplay clearances.
  const factor = Math.min(46 / Math.max(size.y, .001), 44 / Math.max(size.x, size.z, .001));
  const normalise = new THREE.Matrix4().makeScale(factor, factor, factor)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
  const meshes: THREE.InstancedMesh[] = [];
  source.traverse(object => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    const geometry = object.geometry.clone().applyMatrix4(normalise.clone().multiply(object.matrixWorld));
    const material = object.material.clone() as THREE.MeshStandardMaterial;
    material.roughness = Math.max(.65, material.roughness);
    material.envMapIntensity = .8;
    const mesh = new THREE.InstancedMesh(geometry, material, sites.length);
    mesh.name = `vegetation-${id}-${meshes.length}`;
    mesh.userData.vegetationModel = id;
    if (id.includes('pine')) mesh.userData.treeSpecies = 'pine';
    mesh.userData.contactOcclusion = !/leav|twig/i.test(material.name);
    mesh.castShadow = !distant;
    mesh.receiveShadow = true;
    const transform = new THREE.Object3D();
    sites.forEach((site, i) => {
      transform.position.set(site.x, site.y - .5, site.z);
      transform.rotation.y = site.angle;
      transform.scale.set(site.scale * (.92 + i % 5 * .025), site.scale, site.scale);
      transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
      mesh.setColorAt(i, new THREE.Color().setScalar(.88 + (i % 7) * .02));
    });
    mesh.instanceMatrix.needsUpdate = true;
    meshes.push(mesh);
  });
  return meshes;
}
