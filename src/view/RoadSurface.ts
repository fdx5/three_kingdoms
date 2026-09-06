import * as THREE from 'three';
import type { Terrain } from './Terrain';

export const ROAD_COLUMNS = 25;

/** Subdivide the existing miter outline without changing the simulation route. */
export function roadSurface(outline: number[], uv: number[], terrain: Terrain): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
  const columns = ROAD_COLUMNS;
  let row = 0;
  for (let segment = 0; segment < outline.length / 6 - 1; segment++) {
    const a = segment * 6, b = a + 6;
    const steps = Math.max(1, Math.ceil(Math.hypot(outline[b] - outline[a], outline[b + 2] - outline[a + 2]) / 7));
    for (let step = 0; step <= steps; step++) {
      if (segment > 0 && step === 0) continue;
      const t = step / steps;
      const lx = THREE.MathUtils.lerp(outline[a], outline[b], t);
      const lz = THREE.MathUtils.lerp(outline[a + 2], outline[b + 2], t);
      const rx = THREE.MathUtils.lerp(outline[a + 3], outline[b + 3], t);
      const rz = THREE.MathUtils.lerp(outline[a + 5], outline[b + 5], t);
      const v = THREE.MathUtils.lerp(uv[segment * 4 + 1], uv[(segment + 1) * 4 + 1], t);
      for (let col = 0; col < columns; col++) {
        const cross = col / (columns - 1), offset = (cross - 0.5) * 1.22 + 0.5;
        const x = THREE.MathUtils.lerp(lx, rx, offset), z = THREE.MathUtils.lerp(lz, rz, offset);
        const edge = Math.abs(cross - 0.5) * 2;
        const rut = Math.exp(-Math.pow((Math.abs(cross - 0.5) - 0.19) / 0.055, 2));
        const breakup = Math.sin(x * 0.21 + Math.sin(z * 0.17)) * 0.035;
        const wear = Math.sin(v * 2.3 + cross * 8) * Math.sin(v * 0.71 - cross * 13);
        const shade = 1 - rut * (0.18 + wear * 0.07) - edge * edge * 0.14 + breakup + wear * 0.045;
        const alpha = col === 0 || col === columns - 1 ? 0 : 1 - THREE.MathUtils.smoothstep(edge + breakup * 1.8, 0.72, 1);
        positions.push(x, terrain.heightAt(x, z) + 0.6 + (1 - edge) * 0.15 - rut * 0.13, z);
        uvs.push(offset * 1.5, v * 1.5);
        colors.push(shade, shade * 0.97, shade * 0.9, alpha);
        if (row > 0 && col > 0) {
          const i = row * columns + col;
          indices.push(i - columns - 1, i - columns, i - 1, i - columns, i, i - 1);
        }
      }
      row++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
