import * as THREE from 'three';

function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const hash = (a: number, b: number) => {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const sx = x - ix, sy = y - iy;
  const u = sx * sx * (3 - 2 * sx), v = sy * sy * (3 - 2 * sy);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u),
    THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v);
}
function fbm(x: number, y: number): number {
  return noise(x, y) * .55 + noise(x * 2.1, y * 2.1) * .28 + noise(x * 4.3, y * 4.3) * .17;
}

/** Soft alpha textures generated once; no DOM, external downloads or custom shader dependency. */
export function fireTexture(kind: 'flame' | 'smoke' | 'scorch' | 'coals' | 'spark'): THREE.DataTexture {
  const width = 128, height = kind === 'flame' ? 256 : 128;
  const pixels = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const x = (i + .5) / width * 2 - 1, y = (j + .5) / height;
    const n = fbm(x * 7 + 17, y * 9 + 3);
    let r = 1, g = 1, b = 1, alpha = 0;
    if (kind === 'flame') {
      const curl = Math.sin(y * 9 + n * 3) * y * .21;
      const taper = Math.pow(1 - y, .75) * (.57 + n * .35);
      const body = 1 - Math.abs(x - curl) / Math.max(.01, taper);
      alpha = THREE.MathUtils.smoothstep(body + (n - .5) * .65, .04, .42)
        * THREE.MathUtils.smoothstep(y, 0, .045) * (1 - THREE.MathUtils.smoothstep(y, .75, 1));
      const core = Math.exp(-Math.pow((x - curl) / .29, 2)) * Math.pow(1 - y, 1.6);
      r = 1; g = .17 + core * .81 + (1 - y) * .12; b = .015 + core * .43;
      alpha *= .72 + n * .28;
    } else {
      const z = y * 2 - 1, radius = Math.hypot(x, z);
      const edge = 1 - THREE.MathUtils.smoothstep(radius + (n - .5) * .32, .5, .97);
      if (kind === 'smoke') {
        alpha = edge * (.25 + n * .6);
        r = g = b = .58 + n * .3;
      } else if (kind === 'scorch') {
        alpha = edge * (.38 + n * .62);
        r = .055 + n * .045; g = .035 + n * .025; b = .022 + n * .018;
      } else if (kind === 'coals') {
        const cracks = 1 - THREE.MathUtils.smoothstep(Math.abs(noise(x * 27 + 41, z * 27) - .51), .025, .11);
        alpha = edge * cracks * THREE.MathUtils.smoothstep(n, .35, .65) * .75;
        r = 1; g = .12 + n * .34; b = .01;
      } else {
        alpha = Math.pow(Math.max(0, 1 - radius), 2.8);
        r = 1; g = .74; b = .23;
      }
    }
    const index = (j * width + i) * 4;
    pixels[index] = Math.min(255, r * 255); pixels[index + 1] = Math.min(255, g * 255);
    pixels[index + 2] = Math.min(255, b * 255); pixels[index + 3] = Math.min(255, alpha * 255);
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}
