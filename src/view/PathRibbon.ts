import * as THREE from 'three';
import { roadSurface } from './RoadSurface';
import { groundMaterialDetail } from './GroundMaterial';
import type { Path } from '../sim/Path';
import type { Terrain } from './Terrain';
import type { AssetRegistry } from './AssetRegistry';

export const RIBBON_WIDTH = 88;
/** 지형보다 살짝 위에 놓아 z-fighting을 막는다 */
/**
 * 길 리본이 지형 위로 뜨는 높이. 지형과 z-fighting 하지 않으려고 띄운다.
 * 길 위를 걷는 것(적)은 이 높이를 함께 써야 발이 길에 닿는다.
 */
export const RIBBON_LIFT = 0.6;
const ARROW_SPACING = 150;

/**
 * 경로를 따라가는 평평한 흙길 리본. TubeGeometry가 아니라 직접 스트립을 만든다
 * (튜브는 부감 뷰에서 두께가 보여 길처럼 읽히지 않는다).
 * 모퉁이에서는 두 세그먼트의 방향을 평균낸 법선을 써서 폭이 좁아지지 않게 한다.
 */
export class PathRibbon {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshStandardMaterial;
  private arrows: THREE.Mesh | null = null;
  private arrowMat: THREE.MeshBasicMaterial | null = null;
  private details: THREE.Object3D[] = [];
  private ownedTextures: THREE.Texture[] = [];

  constructor(
    private readonly path: Path,
    terrain: Terrain,
    assets: AssetRegistry,
  ) {
    const pts = path.points;
    const n = pts.length;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // 각 폴리라인 정점에서의 좌/우 오프셋 방향 (미터 법선)
    const half = RIBBON_WIDTH / 2;
    let travelled = 0;

    for (let i = 0; i < n; i++) {
      const [x, z] = pts[i];

      // 들어오는/나가는 방향
      let inx = 0;
      let inz = 0;
      let outx = 0;
      let outz = 0;
      if (i > 0) {
        inx = x - pts[i - 1][0];
        inz = z - pts[i - 1][1];
        const l = Math.hypot(inx, inz);
        inx /= l;
        inz /= l;
      }
      if (i < n - 1) {
        outx = pts[i + 1][0] - x;
        outz = pts[i + 1][1] - z;
        const l = Math.hypot(outx, outz);
        outx /= l;
        outz /= l;
      }
      if (i === 0) {
        inx = outx;
        inz = outz;
      }
      if (i === n - 1) {
        outx = inx;
        outz = inz;
      }

      // 미터 법선: 두 방향의 법선을 평균내고 1/cos 로 늘려 폭을 보존한다.
      const nAx = inz;
      const nAz = -inx;
      const nBx = outz;
      const nBz = -outx;
      let mx = nAx + nBx;
      let mz = nAz + nBz;
      const ml = Math.hypot(mx, mz);
      if (ml < 1e-6) {
        mx = nAx;
        mz = nAz;
      } else {
        mx /= ml;
        mz /= ml;
      }
      const cos = mx * nAx + mz * nAz;
      const scale = cos > 0.2 ? 1 / cos : 1;
      const ox = mx * half * scale;
      const oz = mz * half * scale;

      if (i > 0) travelled += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      const v = travelled / RIBBON_WIDTH;

      const yL = terrain.heightAt(x + ox, z + oz) + RIBBON_LIFT;
      const yR = terrain.heightAt(x - ox, z - oz) + RIBBON_LIFT;

      positions.push(x + ox, yL, z + oz);
      positions.push(x - ox, yR, z - oz);
      uvs.push(0, v, 1, v);

      if (i < n - 1) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    this.geometry = roadSurface(positions, uvs, terrain);

    const tex = assets.getTexture('path_dirt')?.clone() ?? null;
    if (tex) this.ownedTextures.push(tex);
    const normal = assets.getTexture('path_dirt_normal')?.clone() ?? null;
    const roughness = assets.getTexture('path_dirt_roughness')?.clone() ?? null;
    if (normal) this.ownedTextures.push(normal);
    if (roughness) this.ownedTextures.push(roughness);
    this.material = new THREE.MeshStandardMaterial({
      color: terrain.landscape === 'floodplain' ? 0x879695 : terrain.landscape === 'loess' ? 0xe0bd87 : terrain.landscape === 'lakeside' ? 0xb5af8c : tex ? 0xd3c4a5 : 0x8c7350,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      map: tex,
      normalMap: normal,
      normalScale: new THREE.Vector2(.95, .95),
      roughnessMap: roughness,
      roughness: 0.94,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    if (tex) {
      tex.repeat.set(1, 1); // UV를 이미 경로 길이 비례로 만들었다
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    }
    for (const roadTex of this.ownedTextures) {
      roadTex.anisotropy = 16;
      roadTex.repeat.set(1, 1);
      roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
      roadTex.needsUpdate = true;
    }

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.visible = !terrain.hasIntegratedRoad;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    this.buildRoadDetails(terrain);

    this.buildArrows(terrain);
  }

  setSurfaceQuality(high: boolean): void { groundMaterialDetail(this.material, high); }

  private buildRoadDetails(terrain: Terrain): void {
    const stoneCount = Math.max(12, Math.floor(this.path.totalLength / 9));
    const stones = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(2.4, 0),
      new THREE.MeshStandardMaterial({ color: 0x766a58, roughness: 0.96, flatShading: true }),
      stoneCount,
    );
    stones.castShadow = true;
    stones.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < stoneCount; i++) {
      const random = (salt: number) => { const n = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return n - Math.floor(n); };
      const d = 8 + random(1) * (this.path.totalLength - 16);
      const at = { x: 0, z: 0 }, dir = { x: 0, z: 0 };
      this.path.positionAt(d, at);
      this.path.directionAt(d, dir);
      const side = i % 2 === 0 ? -1 : 1;
      const offset = side * (RIBBON_WIDTH * (.38 + random(2) * .28));
      const x = at.x - dir.z * offset, z = at.z + dir.x * offset;
      position.set(x, terrain.heightAt(x, z) + 1.3, z);
      quaternion.setFromAxisAngle(up, i * 2.399);
      const s = .25 + Math.pow(random(3), 2) * 1.1;
      scale.set(s, s * 0.55, s * 1.25);
      matrix.compose(position, quaternion, scale);
      stones.setMatrixAt(i, matrix);
      stones.setColorAt(i, new THREE.Color().setScalar(0.7 + s * 0.23));
    }
    stones.instanceMatrix.needsUpdate = true;
    this.group.add(stones);
    this.details.push(stones);

  }

  private buildArrows(terrain: Terrain): void {
    const count = Math.floor(this.path.totalLength / ARROW_SPACING);
    if (count <= 0) return;

    const positions: number[] = [];
    const indices: number[] = [];
    const pos = { x: 0, z: 0 };
    const dir = { x: 0, z: 0 };
    let vi = 0;

    for (let i = 1; i <= count; i++) {
      const d = i * ARROW_SPACING;
      this.path.positionAt(d, pos);
      this.path.directionAt(d, dir);
      const px = -dir.z;
      const pz = dir.x;
      const y = terrain.heightAt(pos.x, pos.z) + RIBBON_LIFT + 0.4;

      const L = 13;
      const W = 9;
      // 삼각형 하나 = 화살촉
      positions.push(pos.x + dir.x * L, y, pos.z + dir.z * L);
      positions.push(pos.x - dir.x * 4 + px * W, y, pos.z - dir.z * 4 + pz * W);
      positions.push(pos.x - dir.x * 4 - px * W, y, pos.z - dir.z * 4 - pz * W);
      indices.push(vi, vi + 1, vi + 2);
      vi += 3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    this.arrowMat = new THREE.MeshBasicMaterial({
      color: 0xffe9a8,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.arrows = new THREE.Mesh(geo, this.arrowMat);
    this.arrows.renderOrder = 2;
    this.group.add(this.arrows);
  }

  /** 첫 웨이브가 시작되면 화살표를 흐리게 (완전히 지우지는 않는다) */
  setArrowsHighlighted(on: boolean): void {
    if (this.arrowMat) this.arrowMat.opacity = on ? 0.75 : 0.16;
  }

  dispose(): void {
    for (const texture of this.ownedTextures) texture.dispose();
    for (const d of this.details) {
      if (d instanceof THREE.Mesh || d instanceof THREE.Line) d.geometry.dispose();
      if (d instanceof THREE.InstancedMesh) d.dispose();
      const mat = (d as THREE.Mesh).material;
      if (mat && !Array.isArray(mat)) mat.dispose();
    }
    this.geometry.dispose();
    this.material.dispose();
    this.arrows?.geometry.dispose();
    this.arrowMat?.dispose();
    this.group.clear();
  }
}
