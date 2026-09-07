import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export interface CastleWeapon {
  pivot: THREE.Group;
  elevation: THREE.Group;
  carriage: THREE.Group;
  muzzle: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  string: THREE.Group | null;
  bolt: THREE.Group | null;
  recoil: number;
}

const BOX = new RoundedBoxGeometry(1, 1, 1, 2, .055);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 20);
const SPHERE = new THREE.SphereGeometry(1, 16, 10);
const RING = new THREE.TorusGeometry(1, .13, 8, 24);
const DISC = new THREE.CircleGeometry(1, 24);
const CONE = new THREE.ConeGeometry(1, 1, 12);
const BARREL = new THREE.LatheGeometry([
  [3.25, 5], [3.25, 0], [4.55, 0], [4.8, .8], [4.8, 1.8],
  [4.15, 2.4], [3.8, 5], [4.2, 18], [5.1, 23], [5.1, 25], [4.6, 27], [2.2, 29], [0, 29],
].map(([x, y]) => new THREE.Vector2(x, y)), 28);
const IRON = new THREE.MeshStandardMaterial({ color: 0x424746, roughness: .63, metalness: .65 });
const EDGE = new THREE.MeshStandardMaterial({ color: 0x9b8050, roughness: .57, metalness: .65 });
const WOOD = new THREE.MeshStandardMaterial({ color: 0x66513b, roughness: .92 });
const STONE = new THREE.MeshStandardMaterial({ color: 0x968c76, roughness: 1 });
const CORD = new THREE.MeshStandardMaterial({ color: 0xb6a582, roughness: 1 });
const BLACK = new THREE.MeshBasicMaterial({ color: 0x100e0b });

// Small reusable surface maps keep new fittings from looking like flat plastic.
function surfaceMap(grain: boolean): THREE.DataTexture {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const noise = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    const value = 175 + (noise - Math.floor(noise)) * 55
      + (grain ? Math.sin(y * 1.7 + Math.sin(x * .15) * .6) * 22 : 0);
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}
WOOD.map = surfaceMap(true);
IRON.map = EDGE.map = STONE.map = surfaceMap(false);

function part(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material,
  pos: [number, number, number], scale: [number, number, number]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...pos); mesh.scale.set(...scale);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function beam(parent: THREE.Object3D, a: number[], b: number[], thickness: number, material: THREE.Material) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  const mesh = part(parent, BOX, material, start.add(end).multiplyScalar(.5).toArray(), [thickness, delta.length(), thickness]);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return mesh;
}

/** A wall-anchored fighting platform; the rear plate sinks into the masonry. */
export function buildCastleEmplacement(root: THREE.Group, twin: boolean): void {
  const half = twin ? 15 : 11;
  part(root, BOX, IRON, [-2, -1, 0], [5, 22, half * 2]);
  // Dressed stone corbels transfer the overhanging deck into the wall.
  part(root, BOX, STONE, [-10, -12, 0], [26, 3, half * 2 + 5]);
  part(root, BOX, EDGE, [-22, -11, 0], [2, 2, half * 2 + 5]);
  for (const side of [-1, 1]) {
    const z = side * (half - 2);
    part(root, BOX, STONE, [-3, -19, z], [8, 14, 5]);
    beam(root, [-2, -24, z], [-21, -12, z], 3, IRON);
    part(root, BOX, EDGE, [-5, 0, side * half], [2, 23, 1.2]);
    for (const y of [-8, 0, 8]) part(root, SPHERE, EDGE, [-5, y, z], [.8, .8, .8]);
    // Low side guards leave the muzzle and its traverse unobstructed.
    part(root, BOX, IRON, [-13, -7, side * half], [20, 6, 1.5]);
  }
}

/** Shared meshes form a coherent siege machine, with separate traverse and recoil joints. */
export function buildCastleWeapon(root: THREE.Group, level: number, index: number,
  ownedMaterials: THREE.Material[], lateral = 0): CastleWeapon {
  const pivot = new THREE.Group();
  pivot.position.set(-15, -4, lateral); root.add(pivot);
  const compact = level === 5 ? .72 : level === 1 ? .8 : 1;
  pivot.scale.setScalar(compact);
  part(pivot, CYLINDER, IRON, [0, -5, 0], [6.5, 2, 6.5]);
  part(pivot, CYLINDER, EDGE, [0, -3.5, 0], [5.5, 1, 5.5]);
  for (const side of [-1, 1]) {
    part(pivot, BOX, WOOD, [0, 0, side * 6], [14, 8, 3]);
    part(pivot, BOX, IRON, [1, 0, side * 7.6], [2.5, 8.5, .8]);
    const pin = part(pivot, CYLINDER, EDGE, [0, 3, side * 8], [2, 1.3, 2]);
    pin.rotation.x = Math.PI / 2;
  }
  const elevation = new THREE.Group(); elevation.position.y = 3; pivot.add(elevation);
  const carriage = new THREE.Group(); elevation.add(carriage);
  const glow = new THREE.MeshBasicMaterial({color: 0xffb65b, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false});
  ownedMaterials.push(glow);
  const muzzle = new THREE.Mesh(SPHERE, glow);
  muzzle.name = `castle-muzzle-${index}`; muzzle.scale.set(4, 2.5, 2.5); carriage.add(muzzle);
  let string: THREE.Group | null = null;
  let bolt: THREE.Group | null = null;
  if (level < 3) {
    part(carriage, BOX, WOOD, [-7, 0, 0], [30, 3.5, 5]);
    for (const z of [-2.5, 2.5]) part(carriage, BOX, EDGE, [-7, 1.5, z], [29, .7, .6]);
    for (const x of [-16, -3, 5]) part(carriage, BOX, IRON, [x, 0, 0], [1.5, 4, 5.7]);
    for (const side of [-1, 1]) {
      // Laminated, swept bow limbs instead of a straight block across the stock.
      const points = [[-15, 1, 0], [-16, 1.5, side * 6], [-14, 2, side * 13], [-10, 2, side * 19]];
      for (let i = 1; i < points.length; i++) {
        beam(carriage, points[i - 1], points[i], 2, WOOD);
        beam(carriage, points[i - 1].map((v, j) => j === 1 ? v + 1 : v),
          points[i].map((v, j) => j === 1 ? v + 1 : v), .6, IRON);
      }
      // Winch and winding handles make the repeating mechanism readable.
      const axle = part(carriage, CYLINDER, EDGE, [4, 1, side * 4], [1.5, 4, 1.5]); axle.rotation.x = Math.PI / 2;
      beam(carriage, [4, 1, side * 6], [4, 5, side * 6], 1, IRON);
    }
    string = new THREE.Group(); carriage.add(string);
    beam(string, [-10, 2, -19], [1, 2, 0], .35, CORD);
    beam(string, [1, 2, 0], [-10, 2, 19], .35, CORD);
    if (level === 2) {
      part(carriage, BOX, WOOD, [-2, 5, 0], [10, 5, 5.5]);
      for (const z of [-3, 3]) part(carriage, BOX, IRON, [-2, 5, z], [10, 5.5, .7]);
      for (const y of [4, 5.5, 7]) part(carriage, BOX, CORD, [-3, y, 0], [12, .55, .55]);
    }
    bolt = new THREE.Group(); carriage.add(bolt);
    part(bolt, BOX, CORD, [-12, 2.6, 0], [24, .6, .6]);
    const tip = part(bolt, CONE, IRON, [-25, 2.6, 0], [1, 3, 1]); tip.rotation.z = Math.PI / 2;
    muzzle.position.set(-27, 2.6, 0);
  } else {
    const barrel = new THREE.Group(); carriage.add(barrel);
    if (level === 4) barrel.scale.set(1.12, 1.12, 1.12);
    const body = part(barrel, BARREL, level === 6 ? EDGE : IRON, [-27, 0, 0], [1, 1, 1]);
    body.rotation.z = -Math.PI / 2;
    for (const x of [-25, -8, -3]) {
      const band = part(barrel, RING, EDGE, [x, 0, 0], [4.8, 4.8, 4.8]); band.rotation.y = Math.PI / 2;
    }
    const bore = part(barrel, DISC, BLACK, [-22, 0, 0], [3.3, 3.3, 1]); bore.rotation.y = -Math.PI / 2;
    part(barrel, SPHERE, EDGE, [4, 0, 0], [2.4, 2, 2]);
    part(barrel, BOX, EDGE, [-6, 4.5, 0], [2, 1, 1.5]);
    for (const z of [-4, 4]) part(carriage, BOX, WOOD, [-4, -5, z], [23, 2, 2]);
    muzzle.position.set(level === 4 ? -31 : -28, 0, 0);
    if (level === 6) {
      // Cast bronze dragon: cheek plates, swept horns, brows and an open jaw.
      for (const side of [-1, 1]) {
        part(carriage, SPHERE, EDGE, [-15, 1, side * 4], [10, 5.5, 3]);
        beam(carriage, [-22, 5, side * 3], [-12, 7, side * 5], 2.3, IRON);
        const horn = part(carriage, CONE, EDGE, [-5, 9, side * 6], [1.5, 11, 1.5]); horn.rotation.z = -.7;
        for (let i = 0; i < 3; i++) {
          const scale = part(carriage, CONE, EDGE, [-3 + i * 4, 4, side * 4], [2, 5, 2]); scale.rotation.z = -1;
        }
        const eyes = new THREE.MeshBasicMaterial({ color: 0xff681f }); ownedMaterials.push(eyes);
        part(carriage, SPHERE, eyes, [-19, 5, side * 5.4], [1.4, 1, .8]);
        for (const x of [-24, -20]) {
          const tooth = part(carriage, CONE, EDGE, [x, -1, side * 4], [.7, 2.5, .7]); tooth.rotation.z = Math.PI;
        }
      }
      part(carriage, SPHERE, EDGE, [-20, -4.5, 0], [9, 1.5, 5.5]);
      part(carriage, BOX, IRON, [-23, -2.5, 0], [8, 1, 6]);
    }
  }
  return {pivot, elevation, carriage, muzzle, string, bolt, recoil: 0};
}
