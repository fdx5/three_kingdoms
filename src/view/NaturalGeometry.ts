import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/Rng';

/** Solid folded leaves retain their silhouette and shadows at every camera angle. */
export function foliageGeometry(radius: number, seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const vertices: number[] = [], colors: number[] = [];
  const color = new THREE.Color();
  for (let i = 0; i < 260; i++) {
    const az = rng.range(0, Math.PI * 2), el = rng.range(-1, 1);
    const r = radius * Math.cbrt(rng.range(0.15, 1));
    const center = new THREE.Vector3(Math.cos(az) * Math.sqrt(1 - el * el) * r, el * r * 0.82, Math.sin(az) * Math.sqrt(1 - el * el) * r);
    const length = rng.range(1.8, 3.5), width = length * 0.44;
    const rotation = new THREE.Euler(rng.range(-1, 1), az, rng.range(-0.7, 0.7));
    const points = [[-length, 0, 0], [0, 0.4, -width], [length, 0, 0], [0, 0.4, width], [0, 0.85, 0]];
    const transformed = points.map(p => new THREE.Vector3(...p as [number, number, number]).applyEuler(rotation).add(center));
    color.setHSL(rng.range(0.20, 0.27), rng.range(0.15, 0.34), rng.range(0.40, 0.69));
    for (const index of [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]) {
      vertices.push(...transformed[index].toArray()); colors.push(color.r, color.g, color.b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function grassGeometry(): THREE.BufferGeometry {
  const rng = new Rng(471);
  const positions: number[] = [], colors: number[] = [];
  for (let blade = 0; blade < 12; blade++) {
    const angle = rng.range(0, Math.PI * 2), h = rng.range(4, 11);
    const x = rng.range(-3, 3), z = rng.range(-3, 3), w = rng.range(0.3, 0.7);
    const dx = Math.cos(angle), dz = Math.sin(angle), bend = rng.range(1, 4);
    const points = [[x - dx * w, -5.5, z - dz * w], [x + dx * w, -5.5, z + dz * w],
      [x + dz * bend + dx * w * 0.4, h * 0.6 - 5.5, z - dx * bend + dz * w * 0.4],
      [x + dz * bend - dx * w * 0.4, h * 0.6 - 5.5, z - dx * bend - dz * w * 0.4],
      [x + dz * bend * 1.8, h - 5.5, z - dx * bend * 1.8]];
    for (const index of [0, 1, 2, 0, 2, 3, 3, 2, 4]) {
      positions.push(...points[index]);
      const light = index < 2 ? 0.48 : index === 4 ? 1 : 0.8;
      colors.push(light, light, light * 0.78);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function treeTrunkGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(1.3, 3, 23, 9).translate(0, 3.5, 0)];
  for (let i = 0; i < 5; i++) {
    parts.push(new THREE.CylinderGeometry(0.25, 1, 13, 6).rotateZ(0.65 + i * 0.1).translate(-3.5, 13, 0).rotateY(i * 2.4));
  }
  const geometry = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  return geometry;
}

export function rockGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(6, 16, 12);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const distortion = 1 + Math.sin(x * 1.3 + z * 0.7) * 0.12 + Math.cos(y * 1.7 - x) * 0.09;
    p.setXYZ(i, x * distortion, y * distortion, z * distortion);
  }
  geo.computeVertexNormals();
  return geo;
}
