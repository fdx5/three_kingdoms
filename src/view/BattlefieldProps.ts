import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AssetRegistry } from './AssetRegistry';

export type HouseKind = 'tile' | 'thatch' | 'granary' | 'pavilion' | 'storehouse';
export interface SettlementSite { x: number; y: number; z: number; angle: number; kind?: HouseKind; foundationDepth?: number }

/** Batch architecture by material: settlement complexity does not multiply draw calls. */
export function settlementMeshes(sites: SettlementSite[], assets?: AssetRegistry): THREE.InstancedMesh[] {
  return (['tile', 'thatch', 'granary', 'pavilion', 'storehouse'] as const)
    .flatMap(kind => settlementBatch(sites.filter(site => (site.kind ?? 'tile') === kind), kind, assets));
}

function settlementBatch(sites: SettlementSite[], kind: HouseKind, assets?: AssetRegistry): THREE.InstancedMesh[] {
  if (!sites.length) return [];
  const straw = kind === 'thatch' || kind === 'granary';
  const open = kind === 'pavilion';
  const raised = kind === 'granary' ? 8 : 0;
  const timber: THREE.BufferGeometry[] = [], plaster: THREE.BufferGeometry[] = [];
  const stone: THREE.BufferGeometry[] = [], tiles: THREE.BufferGeometry[] = [];
  const box = (parts: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number) => {
    parts.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  };
  // Deep plinths meet small slope variations around the selected flat footprint.
  box(stone, 49, 9, 37, 0, -3, 0);
  box(stone, 18, 1.5, 7, 0, -0.5, 21);
  if (!open) box(plaster, 40, 21 - raised, 27, 0, 12 + raised / 2, 0);
  else box(plaster, 36, 2, 23, 0, 3, 0);
  for (const x of [-21, 21]) for (const z of [-15, 15]) box(timber, 2.3, 27, 2.3, x, 14, z);
  for (const z of [-15, 15]) {
    box(timber, 46, 2.5, 2.5, 0, 24, z);
    box(timber, 44, 1.5, 1.5, 0, 5, z);
  }
  if (!open) box(timber, kind === 'storehouse' ? 17 : 9, 16 - raised, 1.6, 0, 9.5 + raised / 2, 14.3);
  for (const x of open ? [] : [-13, 13]) {
    box(timber, 7.5, 8.5, 1.4, x, 15, 14.3);
    for (let j = -2; j <= 2; j++) box(plaster, 0.35, 6.5, 0.35, x + j * 1.1, 15, 15.2);
    box(plaster, 6, 0.4, 0.35, x, 15, 15.2);
  }
  if (kind === 'granary') {
    for (const x of [-16, 16]) for (const z of [-10, 10]) box(timber, 3, 10, 3, x, 5, z);
    for (let step = 0; step < 4; step++) box(timber, 10, 2, 3, 0, step * 2, 24 - step * 3);
  }
  if (open) {
    for (const z of [-14, 14]) box(timber, 36, 2, 2, 0, 11, z);
    box(timber, 2, 2, 28, -20, 11, 0);
    box(timber, 18, 2, 10, 0, 10, 0);
  }
  // Household details give buildings a use and a readable front, not just a roof colour.
  if (kind === 'thatch' || kind === 'tile') {
    for (let k = 0; k < 6; k++) box(timber, 1.2, 8, 1.2, -23 + k * 4, 3, 26);
    box(timber, 23, 1, 1, -13, 5, 26);
    const pot = new THREE.SphereGeometry(3.5, 10, 6).scale(1, 1.3, 1).translate(21, 3, 22);
    plaster.push(pot);
  } else if (kind === 'storehouse' || kind === 'granary') {
    for (let k = 0; k < 3; k++) {
      box(timber, 6, 5 + k % 2 * 3, 6, -16 + k * 7, 3, 24);
      box(stone, 6.3, .7, 6.3, -16 + k * 7, 4, 24);
    }
  }
  // Separate curved tile courses, with raised eaves and a capped ridge.
  for (const side of [-1, 1]) for (let course = 0; course < 23; course++) {
    const vertices: number[] = [], indices: number[] = [], uv: number[] = [];
    const x = (course - 11) * 2.3;
    for (let step = 0; step <= 12; step++) {
      const t = step / 12;
      const z = side * t * 23;
      const y = straw ? 39 - 15 * t - 1.4 * t * t : 37 - 20 * t + 10 * t * t * t;
      for (const edge of [-1, 0, 1]) {
        vertices.push(x + edge * 1.13, y + (edge === 0 ? 0.48 : 0), z);
        uv.push((x + edge * 1.13 + 27) / 27, t);
      }
      if (step > 0) for (let j = 0; j < 2; j++) {
        const a = (step - 1) * 3 + j;
        indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(indices); geo.computeVertexNormals(); tiles.push(geo);
  }
  // Match attributes before merging roof tiles and ridge geometry.
  const ridge = new THREE.CylinderGeometry(1.2, 1.2, 57, 8).rotateZ(Math.PI / 2).translate(0, straw ? 39.4 : 37.4, 0);
  tiles.push(ridge);
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x4b3020, roughness: 0.88 }),
    new THREE.MeshStandardMaterial({ color: kind === 'granary' ? 0x957653 : straw ? 0xb6a07a : 0xb8ad8c, roughness: 0.97 }),
    new THREE.MeshStandardMaterial({ color: 0x77756b, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: straw ? 0xc6b18a : kind === 'pavilion' ? 0x50695c : 0x424f50,
      map: straw ? assets?.getTexture('scenery_thatch') ?? null : null,
      normalMap: straw ? assets?.getTexture('scenery_thatch_normal') ?? null : null,
      normalScale: new THREE.Vector2(.65, .65), roughness: straw ? .98 : .78, side: THREE.DoubleSide }),
  ];
  const transform = new THREE.Object3D();
  const meshes = [timber, plaster, stone, tiles].map((parts, index) => {
    const geo = mergeGeometries(parts);
    parts.forEach(part => part.dispose());
    const mesh = new THREE.InstancedMesh(geo, materials[index], sites.length);
    mesh.name = `settlement-${kind}-${index}`;
    mesh.userData.houseKind = kind;
    sites.forEach((site, i) => {
      transform.position.set(site.x, site.y + 1.5, site.z);
      transform.rotation.y = site.angle;
      transform.scale.set(kind === 'storehouse' ? 1.2 : kind === 'pavilion' ? .8 : 1, kind === 'thatch' ? .83 : 1, 1);
      transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
      mesh.setColorAt(i, new THREE.Color().setScalar(0.85 + (i % 4) * 0.06));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  });
  const foundations = new THREE.InstancedMesh(new THREE.BoxGeometry(49, 1, 37), materials[2].clone(), sites.length);
  foundations.name = `settlement-${kind}-foundation`;
  sites.forEach((site, i) => {
    const depth = site.foundationDepth ?? 9;
    transform.position.set(site.x, site.y + 1 - depth / 2, site.z);
    transform.rotation.y = site.angle;
    transform.scale.set(kind === 'storehouse' ? 1.2 : kind === 'pavilion' ? .8 : 1, depth, 1);
    transform.updateMatrix(); foundations.setMatrixAt(i, transform.matrix);
  });
  foundations.castShadow = foundations.receiveShadow = true;
  foundations.instanceMatrix.needsUpdate = true;
  return [...meshes, foundations];
}
