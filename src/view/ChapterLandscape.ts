import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LevelEnvironment } from '../types/level';
import { Rng } from '../core/Rng';
import type { Terrain } from './Terrain';
import { weatheredMaterial } from './WeatheredMaterial';
import { WaterReflection } from './WaterReflection';
import { BALANCE } from '../data/balance';
import { rainRipplesGLSL } from './vfx/RainRipples';

type Theme = NonNullable<LevelEnvironment['landscape']>;
export function chapterSites(theme?: Theme): number[][] {
  return theme === 'lakeside' ? [[432, 290], [1030, 270]]
    : theme === 'floodplain' ? [[410, 550], [810, 625], [1090, 200]]
    : theme === 'loess' ? [[470, 180], [1080, 200], [1080, 650], [40, 590]] : [];
}
// Hand-placed landforms establish a composition; fine shoreline noise breaks symmetry.
const BASINS: Record<Theme, readonly number[][]> = {
  lakeside: [[420, 270, 130, 150], [1000, 230, 170, 200], [460, 625, 300, 65]],
  floodplain: [[380, 515, 275, 170], [790, 605, 280, 80], [870, 42, 260, 34], [700, 220, 160, 110]],
  loess: [],
};

export function basinDepth(theme: Theme, x: number, z: number): number {
  let depth = 0;
  for (const [cx, cz, rx, rz] of BASINS[theme]) {
    const ripple = Math.sin(x * .031 + Math.sin(z * .021)) * .085 + Math.sin(z * .047) * .045;
    const r = Math.hypot((x - cx) / rx, (z - cz) / rz) + ripple;
    depth = Math.max(depth, 1 - THREE.MathUtils.smoothstep(r, .62, 1));
  }
  return depth;
}

export function chapterHeight(theme: Theme, x: number, z: number, base: number, clearance: number): number {
  const safe = THREE.MathUtils.smoothstep(clearance, 62, 95);
  if (theme !== 'loess') {
    const depth = basinDepth(theme, x, z) * safe;
    // Preserve dry shoulders above the water instead of flattening every bank.
    return THREE.MathUtils.lerp(base * (theme === 'lakeside' ? .95 : .8), -9, depth);
  }
  // Broad loess shelves with rounded 10u scarps, softened by the underlying slope.
  const terrace = Math.floor(base / 10) * 10 + THREE.MathUtils.smoothstep(base % 10, 2, 8) * 10;
  return THREE.MathUtils.lerp(base, terrace, safe * .75);
}

/** Chapter-specific water, reeds, wharves, ruins and military architecture, batched by material. */
export class ChapterLandscape {
  readonly group = new THREE.Group();
  private textures: THREE.Texture[] = [];
  private water: THREE.MeshStandardMaterial | null = null;
  private time = 0;
  private waterTime = { value: 0 };
  private reflection: WaterReflection | null = null;

  constructor(private theme: Theme, private terrain: Terrain, private clear: (x: number, z: number) => number, scale: number,
    private stoneSurface: THREE.MeshStandardMaterialParameters = {}, private rain = false) {
    this.group.name = `landscape-${theme}`;
    if (theme !== 'loess') this.buildWater(scale >= 1);
    this.buildProps(scale);
  }

  private buildWater(reflections: boolean): void {
    const positions: number[] = [], colors: number[] = [], uv: number[] = [], indices: number[] = [], depths: number[] = [];
    const nx = 160, nz = 94, waterline = -1.1;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = i * 1200 / nx, z = j * 700 / nz;
      const depth = waterline - this.terrain.heightAt(x, z);
      depths.push(Math.max(0, depth));
      positions.push(x, waterline, z); uv.push(x / 70, z / 70);
      const color = new THREE.Color(this.theme === 'lakeside' ? 0x6c8170 : 0x7c8277)
        .lerp(new THREE.Color(this.theme === 'lakeside' ? 0x254a4e : 0x3d5155), THREE.MathUtils.smoothstep(depth, 0, 9));
      colors.push(color.r, color.g, color.b, THREE.MathUtils.smoothstep(depth, 0, 2.8) * .94);
      if (j > 0 && i > 0) {
        const a = j * (nx + 1) + i;
        indices.push(a - nx - 2, a - 1, a - nx - 1, a - nx - 1, a - 1, a);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('waterDepth', new THREE.Float32BufferAttribute(depths, 1));
    geo.setIndex(indices); geo.computeVertexNormals();
    // Tileable wave normals create moving highlights without another render pass.
    const size = 128, pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2, k = (y * size + x) * 4;
      pixels[k] = 128 + 22 * Math.cos(u * 3 + v * 2) + 13 * Math.sin(u * 7 - v * 4);
      pixels[k + 1] = 128 + 25 * Math.sin(v * 4 + u * 2) + 9 * Math.cos(u * 5 - v * 7);
      pixels[k + 2] = 245; pixels[k + 3] = 255;
    }
    const normal = new THREE.DataTexture(pixels, size, size);
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    normal.magFilter = normal.minFilter = THREE.LinearFilter; normal.needsUpdate = true;
    this.textures.push(normal);
    this.water = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false,
      roughness: .19, metalness: 0, envMapIntensity: 1.6, normalMap: normal, normalScale: new THREE.Vector2(.3, .3), side: THREE.DoubleSide });
    this.water.onBeforeCompile = shader => {
      shader.uniforms.waterTime = this.waterTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float waterDepth; varying float vWaterDepth;');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterDepth = waterDepth;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float waterTime; varying float vWaterDepth;');
      if (this.rain) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + rainRipplesGLSL);
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
          #include <color_fragment>
          diffuseColor.rgb += rainRing(vNormalMapUv * 70.0, waterTime) * ${BALANCE.fx.weather.rippleStrength};`);
      }
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace('texture2D( normalMap, vNormalMapUv ).xyz', `
          (texture2D(normalMap, vNormalMapUv * .53 + vec2(waterTime * .009, -waterTime * .006)).xyz
          + texture2D(normalMap, vNormalMapUv * 1.17 + vec2(-waterTime * .012, waterTime * .008)).xyz) * .5`));
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float shore = (1.0 - smoothstep(.3, 3.5, vWaterDepth));
        float foam = smoothstep(.78, .97, sin(vNormalMapUv.x * 18.0 + sin(vNormalMapUv.y * 13.0) + waterTime * .7));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.47, .52, .45), shore * foam * .22);
      `);
    };
    this.water.customProgramCacheKey = () => `water-crossflow-rain-${this.rain}`;
    const mesh = new THREE.Mesh(geo, this.water); mesh.name = 'chapter-water'; mesh.renderOrder = 1;
    this.group.add(mesh);
    if (reflections) {
      this.reflection = new WaterReflection(geo, this.waterTime, this.rain);
      this.group.add(this.reflection);
    }
  }

  private buildProps(scale: number): void {
    const rng = new Rng(this.theme === 'loess' ? 604 : this.theme === 'lakeside' ? 404 : 504);
    const batches = new Map<string, THREE.BufferGeometry[]>();
    const materials: Record<string, THREE.MeshStandardMaterial> = {
      timber: new THREE.MeshStandardMaterial({ color: 0x514031, roughness: .93 }),
      stone: new THREE.MeshStandardMaterial({ ...this.stoneSurface, color: this.theme === 'loess' ? 0xa58c66 : 0x78807c, roughness: .93 }),
      cloth: new THREE.MeshStandardMaterial({ color: this.theme === 'loess' ? 0x9b5136 : 0x657c74, roughness: .88, side: THREE.DoubleSide }),
      reed: new THREE.MeshStandardMaterial({ color: this.theme === 'lakeside' ? 0x899257 : 0x838370, roughness: 1, side: THREE.DoubleSide }),
      tips: new THREE.MeshStandardMaterial({ color: 0xc8b48a, roughness: 1 }),
    };
    weatheredMaterial(materials.timber, 'timber');
    const add = (kind: string, geo: THREE.BufferGeometry) => {
      const parts = batches.get(kind) ?? []; parts.push(geo); batches.set(kind, parts);
    };
    const box = (kind: string, x: number, y: number, z: number, w: number, h: number, d: number, angle = 0) => {
      add(kind, new THREE.BoxGeometry(w, h, d).rotateY(angle).translate(x, y, z));
    };
    // Wharves and flooded foundations / terraced fortified camps occupy deliberate clearings.
    const sites = chapterSites(this.theme);
    for (const [x, z] of sites) {
      if (this.clear(x, z) < 85) continue;
      const y = this.terrain.heightAt(x, z);
      if (this.theme === 'lakeside') {
        const deck = Math.max(y + 3, 3);
        for (let k = -7; k <= 7; k++) box('timber', x, deck, z + k * 4.1, 38, 1.7, 3.6);
        // A narrow piled approach connects each wharf to the nearest dry bank.
        let reach = 160, direction = 0;
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
          for (let d = 35; d < reach; d += 5) {
            const px = x + Math.cos(angle) * d, pz = z + Math.sin(angle) * d;
            if (this.terrain.heightAt(px, pz) > 1 && this.clear(px, pz) > 65) { reach = d; direction = angle; break; }
          }
        }
        for (let d = 0; d <= reach; d += 4.1) {
          const px = x + Math.cos(direction) * d, pz = z + Math.sin(direction) * d;
          box('timber', px, deck, pz, 3.6, 1.7, 15, -direction);
          if (Math.round(d / 4.1) % 5 === 0) for (const side of [-1, 1]) {
            box('timber', px - Math.sin(direction) * 7 * side, deck - 4, pz + Math.cos(direction) * 7 * side, 1.6, 16, 1.6);
          }
        }
        for (const dx of [-17, 17]) for (const dz of [-25, 0, 25]) {
          box('timber', x + dx, deck - 2, z + dz, 2.2, 18, 2.2);
          box('tips', x + dx, deck + 5, z + dz, 2.6, 1.2, 2.6);
        }
        // Moored hull with raised gunwales and cross benches.
        const bx = x + 34, by = -.3;
        box('timber', bx, by, z, 13, 2.8, 38);
        for (const dx of [-7, 7]) box('timber', bx + dx, by + 3, z, 1.7, 6, 40);
        for (const dz of [-12, 0, 12]) box('timber', bx, by + 4, z + dz, 13, 1.2, 3);
      } else if (this.theme === 'floodplain') {
        const floor = Math.max(y, -3);
        for (let row = 0; row < 4; row++) for (let k = 0; k < 8 - row; k++) {
          box('stone', x - 28 + k * 8 + (row % 2) * 3, floor + row * 5 + 2.5, z - 20, 7.5, 4.6, 8);
        }
        for (const dx of [-27, 27]) box('timber', x + dx, floor + 13, z + 16, 3, 28, 3, .16);
        box('timber', x, floor + 26, z + 16, 58, 3, 4, -.07);
        for (let k = 0; k < 6; k++) box('timber', x + rng.range(-30, 30), -.1, z + rng.range(23, 45), 2, 1, rng.range(12, 25), rng.range(-1, 1));
      } else {
        for (let row = 0; row < 4; row++) for (let k = -5; k <= 5; k++) {
          const xx = x + k * 9 + (row % 2) * 4;
          const yy = this.terrain.heightAt(xx, z - 29);
          box('stone', xx, yy + 3 + row * 5.5, z - 29, 8.5, 5, 12);
          if (row === 3 && k % 2 === 0) box('stone', xx, yy + 30, z - 29, 8.5, 9, 12);
        }
        for (const dx of [-23, 23]) {
          const ty = this.terrain.heightAt(x + dx, z + 10);
          const tent = new THREE.ConeGeometry(20, 27, 4, 1, true).rotateY(Math.PI / 4).scale(1, 1, 1.5).translate(x + dx, ty + 14, z + 10);
          add('cloth', tent);
          box('timber', x + dx, ty + 15, z + 10, 2, 34, 2);
        }
        for (let k = 0; k < 5; k++) box('timber', x - 20 + k * 9, y + 4, z + 48, 7, 8, 7);
      }
    }
    // Reeds follow the irregular shoreline instead of being scattered across roads.
    const count = Math.round((this.theme === 'loess' ? 200 : 950) * scale);
    for (let attempt = 0, placed = 0; attempt < count * 25 && placed < count; attempt++) {
      const x = rng.range(10, 1190), z = rng.range(10, 690);
      if (this.clear(x, z) < 68) continue;
      const y = this.terrain.heightAt(x, z);
      if (this.theme !== 'loess' && (y < -2.5 || y > 2 || basinDepth(this.theme, x, z) < .15)) continue;
      if (this.theme === 'loess' && y < 12) continue;
      const h = rng.range(7, this.theme === 'loess' ? 14 : 23), angle = rng.range(0, Math.PI * 2);
      const stem = new THREE.CylinderGeometry(.22, .4, h, 3).rotateZ(.14).rotateY(angle).translate(x, y + h / 2, z);
      add('reed', stem);
      add('tips', new THREE.CylinderGeometry(.8, .5, 3.8, 4).rotateZ(.14).rotateY(angle).translate(x - Math.cos(angle) * h * .07, y + h, z));
      for (const side of [-1, 1]) {
        add('reed', new THREE.PlaneGeometry(1.7, h * .6).rotateZ(side * .48).rotateY(angle).translate(x, y + h * .48, z));
      }
      placed++;
    }
    for (const [kind, material] of Object.entries(materials)) {
      const parts = batches.get(kind);
      if (!parts?.length) { material.dispose(); continue; }
      const geo = mergeGeometries(parts); parts.forEach(p => p.dispose());
      const mesh = new THREE.Mesh(geo, material); mesh.name = `chapter-${kind}`;
      mesh.castShadow = kind !== 'reed' && kind !== 'tips'; mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.waterTime.value = this.time;
  }

  dispose(): void {
    if (this.reflection) {
      this.reflection.removeFromParent(); this.reflection.geometry.dispose(); this.reflection.dispose(); this.reflection = null;
    }
    this.group.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    this.textures.forEach(t => t.dispose()); this.group.removeFromParent(); this.group.clear();
  }
}
