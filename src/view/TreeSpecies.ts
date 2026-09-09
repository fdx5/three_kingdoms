import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { foliageGeometry } from './NaturalGeometry';

export type TreeSpecies = 'pine' | 'willow' | 'bamboo';
export interface TreeSite { x: number; y: number; z: number; scale: number; angle: number; species: TreeSpecies }

/** Three readable silhouettes, instanced in two batches per species. Base is y=0. */
export function treeSpeciesMeshes(sites: TreeSite[], bark: THREE.MeshStandardMaterialParameters, high: boolean): THREE.InstancedMesh[] {
  return (['pine', 'willow', 'bamboo'] as const).flatMap(species => {
    const members = sites.filter(site => site.species === species);
    if (!members.length) return [];
    const stems: THREE.BufferGeometry[] = [], leaves: THREE.BufferGeometry[] = [];
    const stem = (x: number, z: number, height: number, radius: number) => {
      stems.push(new THREE.CylinderGeometry(radius * .48, radius, height, 7, 3).translate(x, height / 2, z));
    };
    const crown = (radius: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, seed: number) => {
      leaves.push(foliageGeometry(radius, seed, high ? 100 : 52).scale(sx, sy, sz).translate(x, y, z));
    };
    if (species === 'pine') {
      stem(0, 0, 42, 2.1);
      for (let tier = 0; tier < 5; tier++) {
        const radius = 13 - tier * 2.1, y = 19 + tier * 5;
        crown(radius, Math.sin(tier * 2) * 1.8, y, 0, 1, .34, 1, 820 + tier);
        for (let branch = 0; branch < 3; branch++) {
          const angle = branch * Math.PI * 2 / 3 + tier;
          const geo = new THREE.CylinderGeometry(.15, .65, radius, 5)
            .rotateZ(-Math.PI / 2).translate(radius / 2, y - 1.5, 0).rotateY(angle);
          stems.push(geo);
        }
      }
    } else if (species === 'willow') {
      stem(0, 0, 25, 2.8);
      crown(14, 0, 28, 0, 1.2, .48, 1, 912);
      for (let i = 0; i < 10; i++) {
        const angle = i * Math.PI * 2 / 10;
        const x = Math.cos(angle) * 12, z = Math.sin(angle) * 10;
        crown(7, x, 19 + Math.sin(i) * 2, z, .35, 1.4, .32, 930 + i);
        stems.push(new THREE.CylinderGeometry(.2, .65, 14, 5)
          .rotateZ(-Math.PI / 2).translate(7, 25, 0).rotateY(angle));
      }
    } else {
      for (let i = 0; i < 7; i++) {
        const x = Math.sin(i * 2.4) * 5, z = Math.cos(i * 2.4) * 5, height = 27 + i % 3 * 5;
        stem(x, z, height, .7);
        for (let y = 4; y < height; y += 5) stems.push(new THREE.CylinderGeometry(.85, .85, .6, 6).translate(x, y, z));
        crown(6, x + 3, height - 3, z, 1, .25, .6, 1020 + i);
        crown(5, x - 3, height - 10, z, 1, .25, .6, 1050 + i);
      }
    }
    const materials = [
      new THREE.MeshStandardMaterial({ ...bark, color: species === 'bamboo' ? 0x8b9d59 : 0xffffff, roughness: .94 }),
      new THREE.MeshStandardMaterial({ color: species === 'pine' ? 0x596955 : species === 'willow' ? 0x7e8b68 : 0x6a7a59,
        vertexColors: true, roughness: .92, side: THREE.DoubleSide }),
    ];
    return [stems, leaves].map((parts, index) => {
      const geometry = mergeGeometries(parts);
      parts.forEach(part => part.dispose());
      const mesh = new THREE.InstancedMesh(geometry, materials[index], members.length);
      mesh.name = `trees-${species}-${index}`;
      mesh.userData.treeSpecies = species;
      if (index === 1) mesh.userData.contactOcclusion = false;
      const transform = new THREE.Object3D();
      members.forEach((site, i) => {
        transform.position.set(site.x, site.y - .6, site.z);
        transform.rotation.y = site.angle;
        transform.scale.setScalar(site.scale);
        transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
        mesh.setColorAt(i, new THREE.Color().setScalar(.85 + i % 4 * .05));
      });
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      return mesh;
    });
  });
}
