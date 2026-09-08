import { MathUtils } from 'three';
import type { LevelEnvironment } from '../types/level';

// Elongated overlapping hills describe a landform, rather than raising every map edge.
// x, z, height, length, width, angle (world units / radians).
type Ridge = readonly [number, number, number, number, number, number];
type Theme = 'drylands' | 'highlands' | 'woodland' | 'lakeside' | 'floodplain' | 'loess';
const RIDGES: Record<Theme, readonly Ridge[]> = {
  drylands: [[400, 100, 38, 230, 105, -.2], [730, 250, 29, 180, 100, .7],
    [210, 570, 24, 220, 125, -.4], [1010, 570, 32, 240, 115, .25]],
  highlands: [[820, 145, 65, 300, 145, -.28], [1110, 350, 46, 220, 115, .85],
    [120, 540, 35, 210, 100, -.7], [540, 190, 26, 160, 100, .5]],
  woodland: [[820, 220, 42, 310, 170, .25], [115, 35, 24, 230, 110, -.2],
    [70, 585, 21, 200, 100, .6], [1020, 485, 24, 210, 110, -.4]],
  lakeside: [[170, 75, 34, 230, 120, .35], [700, 120, 38, 210, 120, -.5],
    [1110, 480, 29, 220, 125, .7], [250, 500, 18, 200, 100, -.3]],
  floodplain: [[250, 30, 30, 290, 125, -.12], [1150, 280, 34, 245, 135, 1.3],
    [100, 425, 19, 200, 85, .8], [620, 355, 18, 220, 95, -.15]],
  loess: [[470, 110, 47, 245, 155, -.25], [1040, 190, 55, 260, 145, .3],
    [160, 530, 29, 200, 130, -.6], [1030, 575, 30, 230, 115, .1]],
};

function theme(env: LevelEnvironment): Theme { return env.landscape ?? env.biome ?? 'drylands'; }

function ridgeHeight(x: number, z: number, ridge: Ridge): number {
  const [cx, cz, height, length, width, angle] = ridge;
  const dx = x - cx, dz = z - cz;
  const along = (dx * Math.cos(angle) + dz * Math.sin(angle)) / length;
  const across = (-dx * Math.sin(angle) + dz * Math.cos(angle)) / width;
  return height * Math.exp(-(along * along + across * across) * 1.6);
}

/** Broad contours, a secondary shoulder and subtle continuous erosion. */
export function battlefieldHeight(env: LevelEnvironment, x: number, z: number): number {
  const ridges = RIDGES[theme(env)];
  let strongest = 0, sum = 0;
  for (const ridge of ridges) {
    const h = ridgeHeight(x, z, ridge);
    strongest = Math.max(strongest, h); sum += h;
  }
  const erosion = Math.sin(x * .018 + Math.sin(z * .012) * 2) * 1.7
    + Math.sin(z * .025 - x * .009) * 1.2;
  return Math.max(0, (3 + strongest * .78 + sum * .22 + erosion) * (env.terrainRelief ?? 1));
}

/** Open saddles between distant ridges; lower foreground preserves the camera's view. */
export function surroundingHeight(env: LevelEnvironment, x: number, z: number): number {
  const key = theme(env);
  const phase = Object.keys(RIDGES).indexOf(key) * .47;
  const back = ridgeHeight(x, z, [180 + phase * 90, -220, 105, 480, 190, -.25])
    + ridgeHeight(x, z, [1000, -300 - phase * 40, 135, 440, 240, .4]);
  const sides = ridgeHeight(x, z, [-280, 230, 72, 380, 210, 1.1])
    + ridgeHeight(x, z, [1460, 270, 85, 420, 220, -.8]);
  const foreground = ridgeHeight(x, z, [160, 1050, 28, 490, 240, -.2])
    + ridgeHeight(x, z, [1150, 1180, 35, 430, 270, .3]);
  const wet = key === 'floodplain' ? .65 : key === 'lakeside' ? .8 : 1;
  const texture = .92 + .08 * Math.sin(x * .012 + Math.sin(z * .009));
  const frontMask = 1 - MathUtils.smoothstep(z, 520, 850) * .65;
  // Echo the chapter's stronger relief in the skyline without raising the foreground as much.
  const relief = 1 + ((env.terrainRelief ?? 1) - 1) * .4;
  return (back * relief + sides * frontMask * relief + foreground) * texture * wet;
}
