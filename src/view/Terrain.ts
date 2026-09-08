import * as THREE from 'three';
import { BALANCE, type PerformancePreset } from '../data/balance';
import type { LevelEnvironment } from '../types/level';
import type { Path } from '../sim/Path';
import { Rng } from '../core/Rng';
import type { AssetRegistry } from './AssetRegistry';
import { settlementMeshes, type SettlementSite, type HouseKind } from './BattlefieldProps';
import { foliageGeometry, grassGeometry, rockGeometry, treeTrunkGeometry } from './NaturalGeometry';
import { ChapterLandscape, chapterHeight, chapterSites } from './ChapterLandscape';
import { scenerySurface } from './ScenerySurfaces';
import { groundMaterialDetail, type GroundCover } from './GroundMaterial';
import { battlefieldHeight, surroundingHeight } from './Landform';
import { treeSpeciesMeshes, type TreeSite, type TreeSpecies } from './TreeSpecies';

/**
 * 160×96 높이 격자와 연속된 외곽 능선으로 구성한 전장.
 * 경로와 건설 기반은 평탄하게 유지하고, 경사면의 암석층과 음영은 생성 시 굽는다.
 */
export class Terrain {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private geometry: THREE.PlaneGeometry;
  private material: THREE.MeshStandardMaterial;
  private decor: THREE.InstancedMesh[] = [];
  private decorKey = '';
  private skirt: THREE.Mesh | null = null;
  private ownedTextures: THREE.Texture[] = [];
  private surfaces: { bark: ReturnType<typeof scenerySurface>; stone: ReturnType<typeof scenerySurface> } | null = null;
  private chapter: ChapterLandscape | null = null;
  private groundCover?: GroundCover;
  get landscape(): LevelEnvironment['landscape'] { return this.env.landscape; }
  private readonly reserved: readonly { x: number; z: number }[];

  /** 높이 조회용 격자 (x, z -> y) */
  private heights: Float32Array;
  private readonly segX = 160;
  private readonly segZ = 96;

  constructor(
    private readonly path: Path,
    private readonly env: LevelEnvironment,
    private readonly assets?: AssetRegistry,
    seed = 1337,
    reserved: readonly { x: number; z: number }[] = [],
  ) {
    this.reserved = reserved;
    const w = BALANCE.mapWidth;
    const d = BALANCE.mapDepth;
    this.geometry = new THREE.PlaneGeometry(w, d, this.segX, this.segZ);
    this.geometry.rotateX(-Math.PI / 2);

    const rng = new Rng(seed);
    // 값 노이즈용 저해상도 격자
    const nW = 10;
    const nH = 7;
    const noise = new Float32Array(nW * nH);
    for (let i = 0; i < noise.length; i++) noise[i] = rng.next();

    const sample = (u: number, v: number): number => {
      const fx = u * (nW - 1);
      const fz = v * (nH - 1);
      const x0 = Math.floor(fx);
      const z0 = Math.floor(fz);
      const x1 = Math.min(nW - 1, x0 + 1);
      const z1 = Math.min(nH - 1, z0 + 1);
      const tx = fx - x0;
      const tz = fz - z0;
      // smoothstep 보간 — 선형이면 격자무늬가 보인다
      const sx = tx * tx * (3 - 2 * tx);
      const sz = tz * tz * (3 - 2 * tz);
      const a = noise[z0 * nW + x0] * (1 - sx) + noise[z0 * nW + x1] * sx;
      const b = noise[z1 * nW + x0] * (1 - sx) + noise[z1 * nW + x1] * sx;
      return a * (1 - sz) + b * sz;
    };

    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    this.heights = new Float32Array(pos.count);

    const low = new THREE.Color(env.lowColor).lerp(new THREE.Color(0xffffff), 0.72);
    const high = new THREE.Color(env.highColor).lerp(new THREE.Color(0xffffff), 0.68);
    const tmp = new THREE.Color();

    const maxAmp = 55 * (env.terrainRelief ?? 1);
    // 경로에서 이 거리 안쪽은 완전히 평탄, 바깥으로 부드럽게 올라간다
    const flatRadius = 44;
    const blendRadius = 108;

    for (let i = 0; i < pos.count; i++) {
      // 지오메트리는 맵 중앙 기준. 월드 좌표로 옮긴다.
      const wx = pos.getX(i) + BALANCE.mapWidth / 2;
      const wz = pos.getZ(i) + BALANCE.mapDepth / 2;

      const u = wx / BALANCE.mapWidth;
      const v = wz / BALANCE.mapDepth;
      const detail = sample((u * 2.31 + 0.17) % 1, (v * 2.17 + 0.31) % 1);
      const micro = Math.sin(wx * 0.047 + Math.cos(wz * 0.031)) * 0.5 + 0.5;
      let h = battlefieldHeight(env, wx, wz);

      // 경로 근처 마스킹
      const dist = distanceToPath(this.path, wx, wz);
      if (dist < flatRadius) h = 0;
      else if (dist < blendRadius) {
        const t = (dist - flatRadius) / (blendRadius - flatRadius);
        h *= t * t * (3 - 2 * t);
      }

      if (env.landscape) {
        const clearance = Math.min(dist, ...reserved.map(p => Math.hypot(wx - p.x, wz - p.z)));
        h = chapterHeight(env.landscape, wx, wz, h, clearance);
      }
      // Keep building foundations level while the surrounding banks rise.
      const slotDistance = reserved.reduce((best, p) => Math.min(best, Math.hypot(wx - p.x, wz - p.z)), Infinity);
      h *= THREE.MathUtils.smoothstep(slotDistance, 48, 95);

      pos.setY(i, h);
      this.heights[i] = h;

      const altitude = THREE.MathUtils.clamp(h / maxAmp, 0, 1);
      tmp.copy(low).lerp(high, altitude);
      // Fine colour breakup gives the ground a natural, non-plastic surface from gameplay distance.
      const mottling = (detail - 0.5) * 0.21 + (micro - 0.5) * 0.045;
      const soil = 1 - THREE.MathUtils.smoothstep(dist, 44, 86);
      tmp.lerp(new THREE.Color(0xb6a482), soil * 0.32);
      tmp.offsetHSL(mottling * 0.12, mottling * 0.18, mottling);
      if (env.landscape === 'loess') tmp.lerp(new THREE.Color(0xb29a70), .45 + .1 * Math.sin(h * .45));
      else if (env.landscape && h < 2) tmp.lerp(new THREE.Color(env.landscape === 'lakeside' ? 0x64765b : 0x666c64), .48);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }

    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.computeVertexNormals();
    shadeRelief(this.geometry, env);

    const texId = env.terrainTexture;
    const albedo = assets?.getTexture(texId)?.clone() ?? null;
    const normal = assets?.getTexture(texId ? `${texId}_normal` : undefined)?.clone() ?? null;
    const roughness = assets?.getTexture(texId ? `${texId}_roughness` : undefined)?.clone() ?? null;
    const coverMap = assets?.getTexture('ground_forest');
    const coverNormal = assets?.getTexture('ground_forest_normal');
    const coverRoughness = assets?.getTexture('ground_forest_roughness');
    if (texId !== 'ground_forest' && env.landscape !== 'loess' && coverMap && coverNormal && coverRoughness) {
      this.groundCover = { map: coverMap, normal: coverNormal, roughness: coverRoughness, amount: texId === 'ground_rocky' ? .28 : .58 };
    }
    for (const tex of [albedo, normal, roughness]) {
      if (!tex) continue;
      this.ownedTextures.push(tex);
      const tileSize = texId === 'ground_rocky' ? 220 : 115;
      tex.repeat.set(w / tileSize, d / tileSize);
      tex.anisotropy = 16;
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    }
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: albedo,
      normalMap: normal,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughnessMap: roughness,
      roughness: 0.92,
      metalness: 0,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.set(BALANCE.mapWidth / 2, 0, BALANCE.mapDepth / 2);
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    this.buildSkirt();
  }

  /**
   * 플레이 평면 바깥으로 뻗는 큰 바닥판.
   * 이게 없으면 1200x700 평면의 가장자리가 그대로 보여서
   * "허공에 뜬 판때기" 처럼 읽힌다. 산맥 실루엣까지 땅이 이어져야 한다.
   */
  private buildSkirt(): void {
    // Concentric rings share the exact battlefield boundary. A single continuous
    // surface avoids overlapping apron/skirt triangles and visible rectangular seams.
    const border: number[] = [];
    const stride = this.segX + 1;
    for (let x = 0; x < this.segX; x++) border.push(x);
    for (let z = 0; z < this.segZ; z++) border.push(z * stride + this.segX);
    for (let x = this.segX; x > 0; x--) border.push(this.segZ * stride + x);
    for (let z = this.segZ; z > 0; z--) border.push(z * stride);
    const source = this.geometry.getAttribute('position');
    const sourceColor = this.geometry.getAttribute('color');
    const rings = 48;
    const positions: number[] = [], colors: number[] = [], uv: number[] = [], indices: number[] = [];
    const low = new THREE.Color(this.env.lowColor).lerp(new THREE.Color(0xffffff), .72);
    const high = new THREE.Color(this.env.highColor).lerp(new THREE.Color(0xffffff), .68);
    const color = new THREE.Color();
    border.forEach((vertex, i) => {
      const x = source.getX(vertex), z = source.getZ(vertex);
      for (let ring = 0; ring <= rings; ring++) {
        // More vertices at the playable edge, progressively coarser in the distance.
        const t = Math.pow(ring / rings, 1.35);
        const px = x * (1 + 2.4 * t), pz = z * (1 + 2.8 * t);
        const blend = THREE.MathUtils.smoothstep(Math.hypot(px - x, pz - z), 0, 210);
        const y = THREE.MathUtils.lerp(source.getY(vertex), surroundingHeight(this.env, px + BALANCE.mapWidth / 2, pz + BALANCE.mapDepth / 2), blend);
        positions.push(px, y, pz);
        uv.push(px / BALANCE.mapWidth + .5, .5 - pz / BALANCE.mapDepth);
        color.copy(low).lerp(high, THREE.MathUtils.clamp(y / 100, 0, 1));
        color.multiplyScalar(.78 + landformNoise(px, pz) * .3);
        colors.push(color.r, color.g, color.b);
        if (ring < rings) {
          const a = i * (rings + 1) + ring;
          const b = ((i + 1) % border.length) * (rings + 1) + ring;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(indices); geo.computeVertexNormals();
    shadeRelief(geo, this.env);
    // Blend the exact edge colour into the mineral palette of the foothills.
    const shaded = geo.getAttribute('color');
    border.forEach((vertex, i) => {
      for (let ring = 0; ring < 8; ring++) {
        const index = i * (rings + 1) + ring;
        color.fromBufferAttribute(sourceColor, vertex).lerp(new THREE.Color().fromBufferAttribute(shaded, index), ring / 8);
        shaded.setXYZ(index, color.r, color.g, color.b);
      }
    });
    this.skirt = new THREE.Mesh(geo, this.material.clone());
    this.skirt.position.copy(this.mesh.position);
    this.skirt.receiveShadow = true;
    this.group.add(this.skirt);
  }

  /** Same radial blend as the skirt, so scenery follows the new transition banks. */
  private outerHeight(x: number, z: number): number {
    const t = Math.max(0, (Math.abs(x) / (BALANCE.mapWidth / 2) - 1) / 2.4,
      (Math.abs(z) / (BALANCE.mapDepth / 2) - 1) / 2.8);
    const bx = x / (1 + 2.4 * t), bz = z / (1 + 2.8 * t);
    const blend = THREE.MathUtils.smoothstep(Math.hypot(x - bx, z - bz), 0, 210);
    return THREE.MathUtils.lerp(this.heightAt(bx + BALANCE.mapWidth / 2, bz + BALANCE.mapDepth / 2), surroundingHeight(this.env, x + BALANCE.mapWidth / 2, z + BALANCE.mapDepth / 2), blend);
  }

  /** Rebuild batched scenery only when the quality preset or seed changes. */
  buildDecor(preset: PerformancePreset, seed = 20240): void {
    groundMaterialDetail(this.material, preset.postFx, this.groundCover);
    if (this.skirt) groundMaterialDetail(this.skirt.material as THREE.MeshStandardMaterial, preset.postFx, this.groundCover);
    const key = `${preset.decorScale}:${preset.shadows}:${seed}`;
    if (key === this.decorKey) return;
    this.clearDecor();
    this.decorKey = key;
    const rng = new Rng(seed);

    const sites: SettlementSite[] = [];
    const landmarks = chapterSites(this.env.landscape);
    const houseKinds: HouseKind[] = this.env.landscape === 'loess' ? ['storehouse', 'granary', 'thatch', 'tile']
      : this.env.landscape === 'lakeside' ? ['thatch', 'pavilion', 'tile', 'granary']
      : this.env.landscape === 'floodplain' ? ['granary', 'thatch', 'storehouse', 'pavilion']
      : this.env.biome === 'highlands' ? ['tile', 'storehouse', 'pavilion', 'thatch']
      : ['thatch', 'tile', 'granary', 'pavilion', 'storehouse'];
    for (let attempt = 0; attempt < 700 && sites.length < Math.round((this.env.landscape ? 5 : 9) * preset.decorScale); attempt++) {
      const x = rng.range(65, BALANCE.mapWidth - 65), z = rng.range(50, BALANCE.mapDepth - 50);
      if (this.heightAt(x, z) < 0 || distanceToPath(this.path, x, z) < 90 || this.reserved.some(p => Math.hypot(x - p.x, z - p.z) < 92)
        || sites.some(p => Math.hypot(x - p.x, z - p.z) < 100)
        || landmarks.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 90)) continue;
      const heights = [-34, 0, 34].flatMap(dx => [-30, 0, 30].map(dz => this.heightAt(x + dx, z + dz)));
      if (Math.min(...heights) < 0 || Math.max(...heights) - Math.min(...heights) > 6) continue;
      sites.push({ x, y: Math.max(...heights), z, angle: rng.range(-0.35, 0.35), kind: houseKinds[sites.length % houseKinds.length] });
    }
    // Satellite hamlets sit beside the battlefield, with open frontage and small yards.
    // Keep them away from the foreground camera and the entry/castle approaches.
    const outerHouseCount = Math.max(4, Math.round(10 * preset.decorScale));
    for (let i = 0; i < outerHouseCount; i++) {
      const cluster = i % 3, row = Math.floor(i / 3);
      const cx = cluster === 0 ? 290 + row * 75 : cluster === 1 ? 880 + row * 70 : 1300 + row % 2 * 65;
      const cz = cluster === 0 ? -100 - row % 2 * 60 : cluster === 1 ? -95 - row % 2 * 70 : 100 + row * 80;
      // Search for a gentle shoulder instead of putting houses on tall concrete-looking stilts.
      search: for (const dx of [0, 60, -60, 120, -120, 180, -180]) for (const dz of [0, -60, 60, -120, 120]) {
        const x = cx + dx, z = cz + dz;
        if (x > -60 && x < BALANCE.mapWidth + 60 && z > -60 && z < BALANCE.mapDepth + 60) continue;
        if (sites.some(site => Math.hypot(x - site.x, z - site.z) < 78)) continue;
        const heights = [-38, 0, 38].flatMap(ox => [-35, 0, 35].map(oz =>
          this.outerHeight(x + ox - BALANCE.mapWidth / 2, z + oz - BALANCE.mapDepth / 2)));
        const y = Math.max(...heights), variation = y - Math.min(...heights);
        if (variation > 6) continue;
        sites.push({ x, y, z, foundationDepth: variation + 4,
          angle: cluster === 2 ? -.65 : .2, kind: houseKinds[i % houseKinds.length] });
        break search;
      }
    }
    const architecture = settlementMeshes(sites, this.assets);
    const trees = Math.round((this.env.landscape === 'loess' ? 34 : this.env.landscape === 'floodplain' ? 52 : this.env.landscape === 'lakeside' ? 100 : 190) * preset.decorScale);
    const rocks = Math.round(120 * preset.decorScale);
    const flags = Math.round(22 * preset.decorScale);
    const grasses = Math.round((this.env.landscape ? 900 : 1700) * preset.decorScale);

    const trunkGeo = treeTrunkGeometry();
    const crownGeo = foliageGeometry(13, 19, preset.postFx ? 180 : 100);
    const crownSmallGeo = foliageGeometry(9, 31, preset.postFx ? 120 : 64);
    const rockGeo = rockGeometry();
    const poleGeo = new THREE.CylinderGeometry(1, 1, 52, 4);
    const bannerGeo = new THREE.PlaneGeometry(16, 26, 12, 8);
    const grassGeo = grassGeometry();
    const cloth = bannerGeo.getAttribute('position');
    for (let i = 0; i < cloth.count; i++) {
      const t = (cloth.getX(i) + 8) / 16;
      cloth.setZ(i, Math.sin(t * 7 + cloth.getY(i) * 0.13) * 2.4 * t);
    }
    bannerGeo.computeVertexNormals();

    if (!this.surfaces) {
      this.surfaces = { bark: scenerySurface('bark', this.assets), stone: scenerySurface('stone', this.assets) };
      for (const set of Object.values(this.surfaces)) this.ownedTextures.push(...Object.values(set).filter((t): t is THREE.Texture => t !== null));
    }
    const trunkMat = new THREE.MeshStandardMaterial({ ...this.surfaces.bark, roughness: 1, normalScale: new THREE.Vector2(.7, .7) });
    const treeColor = this.env.biome === 'drylands' ? 0x818054 : this.env.biome === 'highlands' ? 0x657b67 : 0x728658;
    const crownMat = new THREE.MeshStandardMaterial({ color: treeColor, roughness: 0.9, vertexColors: true, side: THREE.DoubleSide });
    const crownSmallMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(treeColor).multiplyScalar(1.14), roughness: 0.9, vertexColors: true, side: THREE.DoubleSide });
    const rockMat = new THREE.MeshStandardMaterial({ ...this.surfaces.stone, color: this.env.landscape === 'loess' ? 0xc5ad88 : 0xffffff,
      normalScale: new THREE.Vector2(.9, .9), roughness: .94 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 1 });
    // 한(漢)군 깃발 — 방어측 진영색
    const bannerMat = new THREE.MeshStandardMaterial({
      color: this.env.landscape === 'loess' ? 0x874a35 : this.env.landscape === 'lakeside' ? 0x345c53 : 0x2f4f7a,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x9b9f65, roughness: 1, vertexColors: true, side: THREE.DoubleSide });

    const trunkIM = new THREE.InstancedMesh(trunkGeo, trunkMat, trees);
    const crownIM = new THREE.InstancedMesh(crownGeo, crownMat, trees);
    const crownSmallIM = new THREE.InstancedMesh(crownSmallGeo, crownSmallMat, trees * 2);
    const rockIM = new THREE.InstancedMesh(rockGeo, rockMat, rocks);
    const poleIM = new THREE.InstancedMesh(poleGeo, poleMat, flags);
    const bannerIM = new THREE.InstancedMesh(bannerGeo, bannerMat, flags);
    const grassIM = new THREE.InstancedMesh(grassGeo, grassMat, grasses);
    // Tiny leaves/grass contribute little at half-resolution; trunks anchor the canopy.
    for (const mesh of [crownIM, crownSmallIM, grassIM]) mesh.userData.contactOcclusion = false;
    trunkIM.castShadow = crownIM.castShadow = crownSmallIM.castShadow = rockIM.castShadow = true;
    trunkIM.receiveShadow = crownIM.receiveShadow = crownSmallIM.receiveShadow = rockIM.receiveShadow = true;
    poleIM.castShadow = bannerIM.castShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();

    let placed = 0;
    let guard = 0;
    const speciesSites: TreeSite[] = [];
    while (placed + speciesSites.length < trees && guard++ < trees * 40) {
      const x = rng.range(8, BALANCE.mapWidth - 8);
      const z = rng.range(8, BALANCE.mapDepth - 8);
      // 경로/슬롯 위에는 두지 않는다
      if (landmarks.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 70)) continue;
      if (this.env.landscape && this.heightAt(x, z) < 1) continue;
      if (distanceToPath(this.path, x, z) < 70) continue;
      if (this.reserved.some(slot => Math.hypot(x - slot.x, z - slot.z) < 76) || sites.some(site => Math.hypot(x - site.x, z - site.z) < 43)) continue;
      const y = this.heightAt(x, z);
      const s = rng.range(0.7, 1.5);
      if ((placed + speciesSites.length) % 3 === 0) {
        const choices: TreeSpecies[] = this.env.biome === 'highlands' || this.env.biome === 'drylands' ? ['pine']
          : this.env.landscape ? ['willow', 'bamboo'] : ['pine', 'bamboo', 'willow'];
        speciesSites.push({ x, y, z, scale: s, angle: rng.range(0, Math.PI * 2), species: choices[speciesSites.length % choices.length] });
        continue;
      }
      q.setFromAxisAngle(_up, rng.range(0, Math.PI * 2));
      scl.set(s, s, s);
      pos.set(x, y + 8 * s, z);
      m.compose(pos, q, scl);
      trunkIM.setMatrixAt(placed, m);
      pos.set(x, y + 26 * s, z);
      m.compose(pos, q, scl);
      crownIM.setMatrixAt(placed, m);
      crownIM.setColorAt(placed, new THREE.Color().setHSL(rng.range(0.20, 0.29), 0.17, rng.range(0.65, 0.9)));
      const lean = rng.range(-5, 5);
      pos.set(x + lean, y + 34 * s, z + rng.range(-4, 4));
      scl.set(s * 0.78, s * 0.72, s * 0.78);
      m.compose(pos, q, scl);
      crownSmallIM.setMatrixAt(placed * 2, m);
      pos.set(x - lean * 0.8, y + 25 * s, z + rng.range(-5, 5));
      scl.set(s * 0.7, s * 0.62, s * 0.7);
      m.compose(pos, q, scl);
      crownSmallIM.setMatrixAt(placed * 2 + 1, m);
      placed++;
    }
    trunkIM.count = placed;
    crownIM.count = placed;
    crownSmallIM.count = placed * 2;

    let rplaced = 0;
    guard = 0;
    while (rplaced < rocks && guard++ < rocks * 40) {
      const x = rng.range(8, BALANCE.mapWidth - 8);
      const z = rng.range(8, BALANCE.mapDepth - 8);
      if (landmarks.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 65)) continue;
      if (this.env.landscape && this.heightAt(x, z) < 0) continue;
      if (distanceToPath(this.path, x, z) < 46) continue;
      if (this.reserved.some(slot => Math.hypot(x - slot.x, z - slot.z) < 49) || sites.some(site => Math.hypot(x - site.x, z - site.z) < 43)) continue;
      const y = this.heightAt(x, z);
      const bank = y > 12 && distanceToPath(this.path, x, z) > 85
        && this.reserved.every(slot => Math.hypot(x - slot.x, z - slot.z) > 85);
      // Occasional larger embedded rocks reveal the scale of the banks without
      // adding meshes or filling the road with visual obstacles.
      const s = bank && rplaced % 4 === 0 ? rng.range(2.2, 3.8) : rng.range(0.5, 1.4);
      q.setFromAxisAngle(_up, rng.range(0, Math.PI * 2));
      scl.set(s, s * 0.65, s);
      pos.set(x, y + 1, z);
      m.compose(pos, q, scl);
      rockIM.setMatrixAt(rplaced, m);
      rplaced++;
    }
    rockIM.count = rplaced;

    // 깃발은 경로에서 조금 더 가까이(진영 느낌) 두되 리본 위는 피한다.
    let fplaced = 0;
    guard = 0;
    while (fplaced < flags && guard++ < flags * 60) {
      const x = rng.range(40, BALANCE.mapWidth - 40);
      const z = rng.range(40, BALANCE.mapDepth - 40);
      if (landmarks.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 65)) continue;
      if (this.env.landscape && this.heightAt(x, z) < 0) continue;
      const d = distanceToPath(this.path, x, z);
      if (d < 62 || d > 150) continue;
      if (this.reserved.some(slot => Math.hypot(x - slot.x, z - slot.z) < 49) || sites.some(site => Math.hypot(x - site.x, z - site.z) < 43)) continue;
      const y = this.heightAt(x, z);
      const rot = rng.range(0, Math.PI * 2);
      q.setFromAxisAngle(_up, rot);
      scl.set(1, 1, 1);
      pos.set(x, y + 26, z);
      m.compose(pos, q, scl);
      poleIM.setMatrixAt(fplaced, m);
      // 깃발 천은 장대 옆에 붙는다
      pos.set(x + Math.cos(rot) * 8, y + 38, z + Math.sin(rot) * 8);
      m.compose(pos, q, scl);
      bannerIM.setMatrixAt(fplaced, m);
      fplaced++;
    }
    poleIM.count = fplaced;
    bannerIM.count = fplaced;

    let gplaced = 0;
    guard = 0;
    while (gplaced < grasses && guard++ < grasses * 25) {
      const x = rng.range(8, BALANCE.mapWidth - 8);
      const z = rng.range(8, BALANCE.mapDepth - 8);
      if (this.env.landscape && this.heightAt(x, z) < 0) continue;
      const roadDist = distanceToPath(this.path, x, z);
      if (roadDist < 62 || roadDist > 260) continue;
      if (this.reserved.some(slot => Math.hypot(x - slot.x, z - slot.z) < 49) || sites.some(site => Math.hypot(x - site.x, z - site.z) < 43)) continue;
      const y = this.heightAt(x, z);
      const s = rng.range(0.45, 1.15);
      q.setFromAxisAngle(_up, rng.range(0, Math.PI * 2));
      scl.set(s, s, s);
      pos.set(x, y + 5.5 * s, z);
      m.compose(pos, q, scl);
      grassIM.setMatrixAt(gplaced++, m);
    }
    grassIM.count = gplaced;

    // Low-cost silhouette forest on the outer terrain keeps every orbit angle populated.
    const outerTrees = Math.round((this.env.landscape === 'loess' ? 140 : this.env.landscape === 'floodplain' ? 240 : 680) * preset.decorScale);
    const outerTrunks = new THREE.InstancedMesh(trunkGeo.clone(), trunkMat.clone(), outerTrees);
    const outerCrowns = new THREE.InstancedMesh(foliageGeometry(14, 53, preset.postFx ? 128 : 64), crownMat.clone(), outerTrees);
    outerCrowns.userData.contactOcclusion = false;
    let oplaced = 0;
    guard = 0;
    while (oplaced < outerTrees && guard++ < outerTrees * 30) {
      const x = rng.range(-900, BALANCE.mapWidth + 900);
      const z = rng.range(-650, BALANCE.mapDepth + 650);
      if (x > -80 && x < BALANCE.mapWidth + 80 && z > -80 && z < BALANCE.mapDepth + 80) continue;
      const lx = x - BALANCE.mapWidth / 2;
      const lz = z - BALANCE.mapDepth / 2;
      // Shared relief function prevents trees floating above the surrounding hills.
      const y = this.outerHeight(lx, lz) - 1.8;
      if (landformNoise(lx * 1.7, lz * 1.7) < 0.38) continue;
      const s = rng.range(.9, z > BALANCE.mapDepth ? 1.45 : 2.1);
      q.setFromAxisAngle(_up, rng.range(0, Math.PI * 2));
      scl.set(s, s, s);
      pos.set(x, y + 8 * s, z); m.compose(pos, q, scl); outerTrunks.setMatrixAt(oplaced, m);
      pos.set(x, y + 27 * s, z); m.compose(pos, q, scl); outerCrowns.setMatrixAt(oplaced, m);
      outerCrowns.setColorAt(oplaced, new THREE.Color().setHSL(rng.range(0.21, 0.29), 0.16, rng.range(0.52, 0.86)));
      oplaced++;
    }
    outerTrunks.count = outerCrowns.count = oplaced;
    outerTrunks.instanceMatrix.needsUpdate = outerCrowns.instanceMatrix.needsUpdate = true;
    // Distant forest receives light but does not fill the battlefield shadow atlas.
    outerTrunks.castShadow = outerCrowns.castShadow = false;
    outerCrowns.receiveShadow = true;

    const outcrops = new THREE.InstancedMesh(rockGeo.clone(), rockMat.clone(), Math.round(160 * preset.decorScale));
    for (let i = 0; i < outcrops.count; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const x = BALANCE.mapWidth / 2 + Math.cos(angle) * rng.range(820, 1450);
      const z = BALANCE.mapDepth / 2 + Math.sin(angle) * rng.range(610, 1020);
      const y = this.outerHeight(x - BALANCE.mapWidth / 2, z - BALANCE.mapDepth / 2);
      const size = rng.range(1.3, z > BALANCE.mapDepth ? 2.8 : 4.2);
      pos.set(x, y - 3, z);
      q.setFromAxisAngle(_up, angle);
      scl.set(size * 1.7, size, size);
      m.compose(pos, q, scl);
      outcrops.setMatrixAt(i, m);
      outcrops.setColorAt(i, new THREE.Color().setScalar(rng.range(0.65, 1)));
    }
    outcrops.castShadow = preset.shadows;
    outcrops.receiveShadow = true;
    this.decor.push(outcrops);

    trunkIM.instanceMatrix.needsUpdate = true;
    crownIM.instanceMatrix.needsUpdate = true;
    crownSmallIM.instanceMatrix.needsUpdate = true;
    rockIM.instanceMatrix.needsUpdate = true;
    poleIM.instanceMatrix.needsUpdate = true;
    bannerIM.instanceMatrix.needsUpdate = true;
    grassIM.instanceMatrix.needsUpdate = true;

    this.decor.push(...architecture, ...treeSpeciesMeshes(speciesSites, this.surfaces.bark, preset.postFx),
      trunkIM, crownIM, crownSmallIM, rockIM, poleIM, bannerIM, grassIM, outerTrunks, outerCrowns);
    for (const d of this.decor) this.group.add(d);
    if (this.env.landscape) {
      this.chapter = new ChapterLandscape(this.env.landscape, this,
        (x, z) => Math.min(distanceToPath(this.path, x, z), ...this.reserved.map(p => Math.hypot(x - p.x, z - p.z))), preset.decorScale);
      this.group.add(this.chapter.group);
    }
  }

  update(dt: number): void { this.chapter?.update(dt); }

  private clearDecor(): void {
    this.decorKey = '';
    this.chapter?.dispose(); this.chapter = null;
    for (const d of this.decor) {
      this.group.remove(d);
      d.geometry.dispose();
      (d.material as THREE.Material).dispose();
      d.dispose();
    }
    this.decor.length = 0;
  }

  /** 지형 높이 조회 (쌍선형 보간). 경로 주변은 0이다. */
  heightAt(x: number, z: number): number {
    const u = THREE.MathUtils.clamp(x / BALANCE.mapWidth, 0, 1) * this.segX;
    const v = THREE.MathUtils.clamp(z / BALANCE.mapDepth, 0, 1) * this.segZ;
    const x0 = Math.floor(u);
    const z0 = Math.floor(v);
    const x1 = Math.min(this.segX, x0 + 1);
    const z1 = Math.min(this.segZ, z0 + 1);
    const tx = u - x0;
    const tz = v - z0;
    const w = this.segX + 1;
    const h00 = this.heights[z0 * w + x0];
    const h10 = this.heights[z0 * w + x1];
    const h01 = this.heights[z1 * w + x0];
    const h11 = this.heights[z1 * w + x1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  dispose(): void {
    this.clearDecor();
    if (this.skirt) {
      this.skirt.geometry.dispose();
      (this.skirt.material as THREE.Material).dispose();
      this.group.remove(this.skirt);
      this.skirt = null;
    }
    this.geometry.dispose();
    this.material.dispose();
    this.ownedTextures.forEach(texture => texture.dispose());
    this.group.clear();
  }
}

const _up = new THREE.Vector3(0, 1, 0);

/** Broad, non-periodic-looking relief assembled from incommensurate wavelengths. */
function landformNoise(x: number, z: number): number {
  const a = Math.sin(x * 0.0047 + Math.cos(z * 0.0031) * 1.73);
  const b = Math.sin(x * 0.0083 - z * 0.0059 + 1.17);
  const c = Math.cos(x * 0.0021 + z * 0.0097 - 0.63);
  const d = Math.sin(Math.hypot(x + 430, z - 270) * 0.0061);
  return THREE.MathUtils.clamp(0.5 + a * 0.21 + b * 0.14 + c * 0.1 + d * 0.07, 0, 1);
}

/** 점에서 폴리라인까지의 최단 거리 */
export function distanceToPath(path: Path, x: number, z: number): number {
  let best = Infinity;
  const pts = path.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len2 = dx * dx + dz * dz;
    let t = ((x - x0) * dx + (z - z0) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = x0 + dx * t;
    const pz = z0 + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) best = d;
  }
  return best;
}

/** Bake mineral strata and broad cavity shade once; no extra texture or render pass. */
function shadeRelief(geometry: THREE.BufferGeometry, env: LevelEnvironment): void {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const colors = geometry.getAttribute('color');
  const color = new THREE.Color();
  const rock = new THREE.Color(env.landscape === 'loess' ? 0x997351 : 0x738079);
  const moss = new THREE.Color(env.biome === 'drylands' ? 0xb0a17a : 0x84956d).lerp(new THREE.Color(0xffffff), .58);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i), y = positions.getY(i);
    const slope = 1 - Math.max(0, normals.getY(i));
    color.fromBufferAttribute(colors, i);
    color.multiply(moss);
    color.lerp(rock, THREE.MathUtils.smoothstep(slope, .08, .48) * .72);
    const strata = Math.sin(y * .26 + Math.sin(x * .012 + z * .009) * 1.8);
    color.multiplyScalar(1 + strata * Math.min(.10, slope * .4));
    // Shallow concavities retain depth even when real-time shadows are disabled.
    const stride = geometry instanceof THREE.PlaneGeometry ? geometry.parameters.widthSegments + 1 : 0;
    if (stride && i >= stride && i + stride < positions.count && i % stride > 0 && i % stride < stride - 1) {
      const cavity = (positions.getY(i - 1) + positions.getY(i + 1) + positions.getY(i - stride) + positions.getY(i + stride)) * .25 - y;
      color.multiplyScalar(1 - THREE.MathUtils.clamp(cavity * .055, 0, .20));
    }
    colors.setXYZ(i, color.r, color.g, color.b);
  }
}
