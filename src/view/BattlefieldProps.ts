import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface SettlementSite { x: number; y: number; z: number; angle: number }

/** Batch architecture by material: settlement complexity does not multiply draw calls. */
export function settlementMeshes(sites: SettlementSite[]): THREE.InstancedMesh[] {
  if (!sites.length) return [];
  const timber: THREE.BufferGeometry[] = [], plaster: THREE.BufferGeometry[] = [];
  const stone: THREE.BufferGeometry[] = [], tiles: THREE.BufferGeometry[] = [];
  const box = (parts: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number) => {
    parts.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  };
  box(stone, 49, 3, 37, 0, 0, 0);
  box(stone, 18, 1.5, 7, 0, -0.5, 21);
  box(plaster, 40, 21, 27, 0, 12, 0);
  for (const x of [-21, 21]) for (const z of [-15, 15]) box(timber, 2.3, 27, 2.3, x, 14, z);
  for (const z of [-15, 15]) {
    box(timber, 46, 2.5, 2.5, 0, 24, z);
    box(timber, 44, 1.5, 1.5, 0, 5, z);
  }
  box(timber, 9, 16, 1.6, 0, 9.5, 14.3);
  for (const x of [-13, 13]) {
    box(timber, 7.5, 8.5, 1.4, x, 15, 14.3);
    for (let j = -2; j <= 2; j++) box(plaster, 0.35, 6.5, 0.35, x + j * 1.1, 15, 15.2);
    box(plaster, 6, 0.4, 0.35, x, 15, 15.2);
  }
  // Separate curved tile courses, with raised eaves and a capped ridge.
  for (const side of [-1, 1]) for (let course = 0; course < 23; course++) {
    const vertices: number[] = [], indices: number[] = [];
    const x = (course - 11) * 2.3;
    for (let step = 0; step <= 12; step++) {
      const t = step / 12;
      const z = side * t * 23;
      const y = 37 - 20 * t + 10 * t * t * t;
      for (const edge of [-1, 0, 1]) vertices.push(x + edge * 1.13, y + (edge === 0 ? 0.48 : 0), z);
      if (step > 0) for (let j = 0; j < 2; j++) {
        const a = (step - 1) * 3 + j;
        indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices); geo.computeVertexNormals(); tiles.push(geo);
  }
  // Match attributes before merging roof tiles and ridge geometry.
  const ridge = new THREE.CylinderGeometry(1.2, 1.2, 57, 8).rotateZ(Math.PI / 2).translate(0, 37.4, 0);
  ridge.deleteAttribute('uv'); tiles.push(ridge);
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x4b3020, roughness: 0.88 }),
    new THREE.MeshStandardMaterial({ color: 0xb8ad8c, roughness: 0.97 }),
    new THREE.MeshStandardMaterial({ color: 0x77756b, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: 0x424f50, roughness: 0.78, side: THREE.DoubleSide }),
  ];
  const transform = new THREE.Object3D();
  return [timber, plaster, stone, tiles].map((parts, index) => {
    const geo = mergeGeometries(parts);
    parts.forEach(part => part.dispose());
    const mesh = new THREE.InstancedMesh(geo, materials[index], sites.length);
    sites.forEach((site, i) => {
      transform.position.set(site.x, site.y + 1.5, site.z);
      transform.rotation.y = site.angle;
      transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
      mesh.setColorAt(i, new THREE.Color().setScalar(0.85 + (i % 4) * 0.06));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  });
}
