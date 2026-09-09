import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/Rng';

/** Solid folded leaves retain their silhouette and shadows at every camera angle. */
export function foliageGeometry(radius: number, seed: number, leafCount = 260): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const vertices: number[] = [], colors: number[] = [], normals: number[] = [];
  const color = new THREE.Color();
  for (let i = 0; i < leafCount; i++) {
    const az = rng.range(0, Math.PI * 2), el = rng.range(-1, 1);
    const r = radius * Math.cbrt(rng.range(0.32, 1));
    const center = new THREE.Vector3(Math.cos(az) * Math.sqrt(1 - el * el) * r, el * r * 0.82, Math.sin(az) * Math.sqrt(1 - el * el) * r);
    // Three small curved leaflets replace the oversized flat flakes. Bent canopy
    // normals retain the tree's volume instead of lighting every leaf as a separate card.
    for (let leaf = 0; leaf < 3; leaf++) {
      const length = rng.range(1.1, 2.5) * Math.cbrt(260 / leafCount), width = length * .42;
      const rotation = new THREE.Euler(rng.range(-.9, .9), az + leaf * 2.1, rng.range(-.6, .6));
      const origin = center.clone().add(new THREE.Vector3(Math.cos(leaf * 2.1 + az) * 1.9, leaf * .5, Math.sin(leaf * 2.1 + az) * 1.9));
      const points = [[-length, 0, 0], [0, .12, -width], [length, -.12, 0], [0, .12, width], [0, .35, 0]];
      const transformed = points.map(p => new THREE.Vector3(...p as [number, number, number]).applyEuler(rotation).add(origin));
      color.setHSL(rng.range(.21, .27), rng.range(.16, .28), rng.range(.62, .8));
      const depthShade = .55 + .45 * THREE.MathUtils.clamp((center.y / radius + 1) * .5, 0, 1);
      const leafNormal = new THREE.Vector3(0, 1, 0).applyEuler(rotation);
      for (const index of [0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0]) {
        const p = transformed[index];
        const normal = new THREE.Vector3(p.x, p.y * .8 + radius * .35, p.z).normalize().lerp(leafNormal, .3).normalize();
        const shade = depthShade * (index === 4 ? 1.02 : .97);
        vertices.push(...p.toArray()); normals.push(...normal.toArray());
        colors.push(color.r * shade, color.g * shade, color.b * shade);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
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
  const trunk = new THREE.CylinderGeometry(1.1, 2.8, 23, 12, 6).translate(0, 3.5, 0);
  const positions = trunk.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const angle = Math.atan2(z, x), t = (y + 8) / 23;
    const roots = 1 + Math.pow(1 - t, 3) * (.25 + .2 * Math.cos(angle * 5));
    positions.setXYZ(i, x * roots + Math.sin(t * 2.4) * .8, y, z * roots + t * t * .7);
  }
  trunk.computeVertexNormals();
  const parts: THREE.BufferGeometry[] = [trunk];
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
    const distortion = 1 + Math.sin(x * .65 + z * .4) * .13 + Math.cos(y * .8 - x * .35) * .10;
    // Broad fracture planes, a weathered top and a buried base replace lumpy spheres.
    const rx = x * distortion, rz = z * distortion;
    const ry = Math.min(y * distortion, 4.2 + x * .17 - z * .12);
    p.setXYZ(i, Math.min(rx, 5.1 - y * .13), Math.max(-4.5, ry), Math.max(rz, -5.2 + x * .12));
  }
  geo.computeVertexNormals();
  const normals = geo.getAttribute('normal');
  const colors: number[] = [];
  const tint = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const grain = Math.sin(x * 1.7 + z * 2.3) * Math.cos(y * 2.1 - z);
    const moss = THREE.MathUtils.smoothstep(normals.getY(i), .35, .9)
      * THREE.MathUtils.smoothstep(Math.sin(x * .8 + z * .9), -.25, .8);
    tint.set(0xd4d1c7).lerp(new THREE.Color(0x78805c), moss * .58);
    tint.multiplyScalar((.68 + THREE.MathUtils.smoothstep(y, -4.5, 3) * .3) * (1 + grain * .07));
    colors.push(tint.r, tint.g, tint.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}
