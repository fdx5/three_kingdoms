/**
 * 활 망루 리깅 — 탑 위의 쇠뇌마다 뼈를 심고 시위를 걸 자리를 표시한다.
 *
 *   npx tsx scripts/rig-tower.ts <in.glb> <out.glb> [옵션]
 *
 *   --kind bows|catapult|cannons
 *                       망루(쇠뇌 4+1) · 투석기(팔 1개) · 포대(대포 N문) (기본 bows)
 *   --bow-y <0~1>       이 높이(전체 높이 비율) 위를 쇠뇌/팔/대포로 본다 (기본 0.76)
 *   --height <u>        완성 높이(world unit) (기본 62)
 *   --bows <n>          내보낼 쇠뇌/대포 수. 모델에 있는 것보다 많으면 복제한다 (기본 5)
 *   --debug bows|tower  그 부분만 내보낸다 (임계값을 눈으로 맞출 때)
 *
 *   cannons 전용
 *   --deck-top <0~1>    이 높이 위는 정자·지붕·깃발이다 (대포 탐지에서 뺀다)
 *   --protrude-r <0~1>  데크 반경 대비 이 비율 밖 = 난간을 넘은 포신 (방향 찾기)
 *   --cannon-r <0~1>    데크 반경 대비 이 비율 밖 = 대포의 몸 (부채꼴로 가져오기)
 *   --gap-deg <도>      각도 히스토그램에서 이만큼 비면 다른 대포로 나눈다
 *   --sector-pad <도>   찾은 방향의 좌우로 이만큼 넓혀 대포를 통째로 가져온다
 *   --barrel-lift <0~1> 난간 밖 포신은 천장을 이만큼 넘어도 가져온다
 *
 * 왜 따로 만들었나
 * ---------------
 * `rig-model.ts` 는 사람 형상 전용이다(골반·다리·팔). 망루는 뼈 구조도 목적도 달라서
 * 억지로 합치면 양쪽 다 망가진다. 대신 두 스크립트가 같은 규약을 공유한다 —
 * 크기와 접지를 모델에 굽고, 결과만 public/assets/models/ 로 낸다.
 *
 * 결과물
 * ------
 *   뼈       tower                  탑 몸체 (움직이지 않는다)
 *            bow1..bowN             쇠뇌/대포 하나씩 — 숨기기와 발사 반동
 *            bow1_nock..bowN_nock   투사체가 떠나는 점 (활은 시위, 대포는 포구)
 *   빈 노드  bowN_tipA / bowN_tipB  활 양끝. 뷰가 이 셋을 이어 시위를 그린다.
 *                                   대포는 시위가 없으므로 이 둘을 만들지 않는다 —
 *                                   TowerView 가 없으면 선을 그리지 않는다.
 *   클립     shoot1..shootN         발사한 쇠뇌/대포의 것만 재생한다
 *
 * 레벨이 오를 때마다 쇠뇌를 하나씩 보여주는 것은 뷰가 `bowN` 뼈의 스케일로 한다
 * (0에 가까우면 그 정점들이 한 점으로 모여 사라진다). 메시를 쪼개지 않아
 * 드로우콜이 늘지 않고, 텍스처도 원본 하나를 그대로 쓴다.
 */
import { NodeIO, type Accessor, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

type Vec3 = [number, number, number];

/**
 * 건물 종류.
 *   bows      네 귀퉁이에 쇠뇌가 달린 망루 — 레벨마다 하나씩 보여준다
 *   catapult  팔 하나가 돌아가는 투석기 — 팔이 젖혀졌다 튕긴다
 *   cannons   둥근 데크에 대포가 둘러선 포대 — 레벨마다 한 문씩 늘어난다
 */
export type TowerKind = 'bows' | 'catapult' | 'cannons';

export interface TowerRigOptions {
  kind: TowerKind;
  bowY: number;
  targetHeight: number;
  bowCount: number;
  debug: 'none' | 'bows' | 'tower';
  /**
   * cannons 전용 — 이 높이 비율 위는 정자·지붕·깃발이라 대포 탐지에서 뺀다.
   * 대포는 데크 바닥(bowY)과 이 값 사이에만 있다.
   */
  deckTop?: number;
  /**
   * cannons 전용 — 데크 반경 대비 이 비율 밖을 대포의 몸으로 본다(2단계).
   * 데크 한가운데를 걸러내는 값이다.
   */
  cannonRadius?: number;
  /**
   * cannons 전용 — 데크 반경 대비 이 비율 밖은 난간을 넘은 포신이다(1단계).
   * 대포가 몇 시 방향에 있는지를 이걸로 찾는다.
   */
  protrudeRadius?: number;
  /** cannons 전용 — 각도 히스토그램에서 이 각도만큼 비면 다른 대포로 나눈다 */
  gapDeg?: number;
  /** cannons 전용 — 찾은 방향의 좌우로 이만큼 더 넓혀 대포를 통째로 가져온다 */
  sectorPadDeg?: number;
  /**
   * cannons 전용 — 난간 밖으로 나간 포신은 천장(deckTop)을 이 비율만큼 넘어도 가져온다.
   * 포신 끝이 처마 높이까지 들려 있어도 잘리지 않게 하는 값이다.
   */
  barrelLift?: number;
}

interface Mesh {
  pos: number[];
  nor: number[];
  uv: number[];
  idx: number[];
}

function readMesh(doc: Document): Mesh {
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const posA = prim.getAttribute('POSITION')!;
  const norA = prim.getAttribute('NORMAL');
  const uvA = prim.getAttribute('TEXCOORD_0');
  const idxA = prim.getIndices()!;
  const n = posA.getCount();

  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const t3 = [0, 0, 0];
  const t2 = [0, 0];
  for (let i = 0; i < n; i++) {
    posA.getElement(i, t3);
    pos.push(t3[0], t3[1], t3[2]);
    if (norA) {
      norA.getElement(i, t3);
      nor.push(t3[0], t3[1], t3[2]);
    } else nor.push(0, 1, 0);
    if (uvA) {
      uvA.getElement(i, t2);
      uv.push(t2[0], t2[1]);
    } else uv.push(0, 0);
  }
  const idx: number[] = [];
  for (let i = 0; i < idxA.getCount(); i++) idx.push(idxA.getScalar(i));
  return { pos, nor, uv, idx };
}

interface Bounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
}

function bounds(pos: number[]): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max, center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
}

/**
 * 삼각형을 무게중심 높이로 갈라 부위 번호를 매긴다.
 *   0        탑 몸체
 *   1..4     네 귀퉁이의 쇠뇌 (XZ 사분면)
 * 정점이 아니라 삼각형 단위로 갈라야 경계에서 면이 찢어지지 않는다.
 */
function classify(m: Mesh, b: Bounds, bowYAbs: number): Uint8Array {
  const tris = m.idx.length / 3;
  const part = new Uint8Array(tris);
  for (let t = 0; t < tris; t++) {
    const a = m.idx[t * 3];
    const c = m.idx[t * 3 + 1];
    const d = m.idx[t * 3 + 2];
    const y = (m.pos[a * 3 + 1] + m.pos[c * 3 + 1] + m.pos[d * 3 + 1]) / 3;
    if (y < bowYAbs) continue;
    const x = (m.pos[a * 3] + m.pos[c * 3] + m.pos[d * 3]) / 3 - b.center[0];
    const z = (m.pos[a * 3 + 2] + m.pos[c * 3 + 2] + m.pos[d * 3 + 2]) / 3 - b.center[2];
    part[t] = 1 + (x >= 0 ? 1 : 0) + (z >= 0 ? 2 : 0);
  }
  return part;
}

/**
 * 포대: 둥근 데크에 둘러선 대포를 한 문씩 떼어낸다.
 *
 * 활 망루는 쇠뇌가 네 귀퉁이에 있어서 XZ 사분면으로 갈리지만(classify), 데크가
 * 둥글면 대포가 몇 시 방향에 몇 문 서 있는지 알 수 없다. 그렇다고 높이와 반경만으로
 * 가를 수도 없다 — 대포의 포가는 정자 벽과 같은 반경대에 있다.
 *
 * 그래서 두 단계로 나눈다.
 *
 *   1) 방향 찾기 — 데크에서 **난간 밖으로 튀어나온** 것은 포신뿐이다.
 *      protrudeR 밖의 삼각형만 모아 1도 히스토그램을 만들고 gapDeg 만큼
 *      비는 곳에서 끊으면, 끊긴 덩어리 하나가 대포 한 문의 방향이 된다.
 *   2) 통째로 가져오기 — 그 방향의 부채꼴(양옆 padDeg)을 통째로 대포로 삼는다.
 *      포가와 바퀴는 난간 안쪽에 있어 1단계에 안 걸리지만 같은 부채꼴에는 들어온다.
 *
 * 정자가 딸려오지 않는 것은 정자가 대포와 **다른 방향**에 있기 때문이다(실측:
 * 대포 16·89·146도, 정자 180~280도). 대포 사이의 데크는 이 높이대가 통째로 비어
 * 있어서(실측) 부채꼴을 넉넉히 잡아도 난간 말고는 딸려올 것이 없다.
 *
 *   높이   deckYAbs..topYAbs   그 위는 정자 지붕과 깃발, 그 아래는 데크 바닥이다
 *   반경   claimR 밖           데크 한가운데를 뺀다
 */
function classifyCannons(
  m: Mesh,
  b: Bounds,
  deckYAbs: number,
  topYAbs: number,
  lift: number,
  /** 방향을 찾을 때만 쓰는 바닥 — 이 아래의 난간 밖 삼각형은 세지 않는다 */
  aimYAbs: number,
  protrudeR: number,
  claimR: number,
  gapDeg: number,
  padDeg: number,
): { part: Uint8Array; count: number } {
  const tris = m.idx.length / 3;
  const part = new Uint8Array(tris);
  const cen = (t: number, k: number): number =>
    (m.pos[m.idx[t * 3] * 3 + k] + m.pos[m.idx[t * 3 + 1] * 3 + k] + m.pos[m.idx[t * 3 + 2] * 3 + k]) / 3;
  /*
   * 대포일 수 있는 삼각형인가.
   *
   * 천장을 하나로 두면 포신 끝이 잘린다 — 포구가 살짝 들려 있어 정자 처마 높이까지
   * 올라간다. 그래도 안전한 이유는 난간(protrudeR) 밖으로 나간 것은 포신뿐이기
   * 때문이다. 정자는 거기까지 못 나온다. 그래서 밖이면 천장을 lift 만큼 봐준다.
   *
   * 반대로 바닥은 봐주지 않는다. 데크 바닥 아래까지 훑으면 난간의 선 면과 바닥의
   * 단차가 통째로 딸려와 대포가 데크를 한 아름 끌어안고 돈다(실제로 그랬다).
   * 바퀴 아랫부분이 조금 잘리지만 데크에 가려 보이지 않는다.
   */
  const deg = new Int16Array(tris).fill(-1);
  const hist = new Int32Array(360);
  for (let t = 0; t < tris; t++) {
    const y = cen(t, 1);
    const x = cen(t, 0) - b.center[0];
    const z = cen(t, 2) - b.center[2];
    const r = Math.hypot(x, z);
    if (r < claimR) continue;
    const outside = r >= protrudeR;
    if (y > (outside ? topYAbs + lift : topYAbs)) continue;
    if (y < deckYAbs) continue;
    const d = Math.floor(((Math.atan2(z, x) * 180) / Math.PI + 360) % 360) % 360;
    deg[t] = d;
    /*
     * 1단계 히스토그램에는 난간 밖으로 나간 것 중 **높은 것만** 넣는다.
     * 포신은 데크 바닥에 붙어 있지 않다. 바닥 언저리까지 세면 데크 바닥의
     * 단차가 통째로 세어져 없는 대포가 하나 더 생긴다(실제로 그랬다 — 4문).
     */
    if (outside && y >= aimYAbs) hist[d]++;
  }

  // 빈 칸이 gapDeg 이상 이어지는 곳에서 끊는다. 0도를 넘어가도 이어지도록 원형으로 돈다.
  const occupied = (d: number): boolean => hist[((d % 360) + 360) % 360] > 0;
  let start = -1;
  for (let d = 0; d < 360; d++) {
    // 앞쪽 gapDeg 가 통째로 비어 있으면 여기가 덩어리의 시작이다
    let clear = occupied(d);
    for (let k = 1; k <= gapDeg && clear; k++) clear = !occupied(d - k);
    if (clear) {
      start = d;
      break;
    }
  }
  if (start < 0) return { part, count: 0 };

  const clusters: { from: number; to: number; tris: number }[] = [];
  let cur: { from: number; to: number; tris: number } | null = null;
  for (let i = 0; i < 360; i++) {
    const d = (start + i) % 360;
    if (hist[d] > 0) {
      if (!cur) cur = { from: d, to: d, tris: 0 };
      cur.to = d;
      cur.tris += hist[d];
      continue;
    }
    if (!cur) continue;
    // 이 빈칸이 gapDeg 만큼 이어지는지 본다. 아니면 같은 덩어리 안의 작은 틈이다.
    let gap = 0;
    while (gap < gapDeg && !occupied(d + gap)) gap++;
    if (gap >= gapDeg) {
      clusters.push(cur);
      cur = null;
    }
  }
  if (cur) clusters.push(cur);

  const biggest = clusters.reduce((a, c) => Math.max(a, c.tris), 0);
  const kept = clusters
    .filter((c) => c.tris >= biggest * 0.25)
    // 각도 순으로 고정한다 — 같은 입력이면 늘 같은 bow 번호가 나와야 한다
    .sort((a, b2) => a.from - b2.from);

  /*
   * 2단계 — 부채꼴을 통째로 가져온다.
   * 부채꼴이 겹치면 중심이 가까운 쪽이 가져간다. 대포가 서로 붙어 있어도
   * 경계에서 한 문이 다른 문의 바퀴를 물고 가지 않게 하는 안전장치다.
   */
  const span = (c: { from: number; to: number }): number => (((c.to - c.from) % 360) + 360) % 360;
  const mid = kept.map((c) => (c.from + span(c) / 2) % 360);
  const half = kept.map((c) => span(c) / 2 + padDeg);
  const diff = (a: number, b2: number): number => {
    const d = Math.abs(a - b2) % 360;
    return d > 180 ? 360 - d : d;
  };
  for (let t = 0; t < tris; t++) {
    if (deg[t] < 0) continue;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < kept.length; i++) {
      const d = diff(deg[t], mid[i]);
      if (d <= half[i] && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) part[t] = best + 1;
  }

  const counts = new Array(kept.length).fill(0);
  for (let t = 0; t < tris; t++) if (part[t] > 0) counts[part[t] - 1]++;
  console.log(
    `[tower] 튀어나온 덩어리 ${clusters.length}개 -> 대포 ${kept.length}문: ` +
      kept
        .map((c, i) => `${c.from}~${c.to}도 -> 부채꼴 ±${half[i].toFixed(0)}도(${counts[i]}삼각형)`)
        .join(', '),
  );
  return { part, count: kept.length };
}

/**
 * 투석기: 던지는 팔만 떼어낸다.
 *
 * 1) 기준 높이 위는 전부 팔이다 (팔은 틀보다 위에 있다)
 * 2) 그 아래라도 **팔 끝 바로 밑에 매달린 것**은 팔에 딸려 간다.
 *    균형추 상자가 그렇다 — 팔이 젖혀지는데 상자만 공중에 남으면 이상하다.
 *    탄약 더미(낮고 팔 끝에서 멀다)는 이 조건에 걸리지 않아 틀에 남는다.
 */
function classifyCatapult(m: Mesh, b: Bounds, armYAbs: number): Uint8Array {
  const tris = m.idx.length / 3;
  const part = new Uint8Array(tris);
  const cen = (t: number, k: number): number =>
    (m.pos[m.idx[t * 3] * 3 + k] + m.pos[m.idx[t * 3 + 1] * 3 + k] + m.pos[m.idx[t * 3 + 2] * 3 + k]) / 3;

  // 1단계 — 높이로 팔 씨앗을 잡는다
  let zMin = Infinity;
  let zMax = -Infinity;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (let t = 0; t < tris; t++) {
    if (cen(t, 1) < armYAbs) continue;
    part[t] = 1;
    const z = cen(t, 2);
    const x = cen(t, 0);
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
  }
  if (!Number.isFinite(zMin)) return part;

  /*
   * 2단계 — **균형추 쪽** 끝에 매달린 것만 팔에 붙인다.
   *
   * 양쪽 끝에 다 적용하면 던지는 쪽 끝 근처에 있는 탄약 더미까지 딸려가
   * 팔이 젖혀질 때 돌 하나가 공중에 떠서 날아다닌다(실제로 그랬다).
   * 던지는 쪽 끝의 돌은 이미 1단계에서 높이로 잡히므로 여기서 다시 볼 필요가 없다.
   */
  // 틀의 꼭대기 = 팔이 얹힌 축. 균형추는 축에서 가까운 쪽(짧은 팔)에 달린다.
  let apexY = -Infinity;
  let apexZ = 0;
  for (let t = 0; t < tris; t++) {
    if (part[t] === 1) continue;
    const y = cen(t, 1);
    if (y > apexY) {
      apexY = y;
      apexZ = cen(t, 2);
    }
  }
  const shortZ = Math.abs(zMin - apexZ) <= Math.abs(zMax - apexZ) ? zMin : zMax;
  const hangR = (zMax - zMin) * 0.16;
  const deckY = b.min[1] + (b.max[1] - b.min[1]) * 0.4; // 이보다 낮으면 수레·바닥이다
  const endX = (xMin + xMax) / 2;
  for (let t = 0; t < tris; t++) {
    if (part[t] === 1) continue;
    if (cen(t, 1) < deckY) continue;
    if (Math.hypot(cen(t, 0) - endX, cen(t, 2) - shortZ) <= hangR) part[t] = 1;
  }
  return part;
}

interface BowInfo {
  verts: number[];
  pivot: Vec3;
  /** 탑 중심에서 바깥으로 = 쏘는 방향 (수평) */
  shaft: Vec3;
  tipA: Vec3;
  tipB: Vec3;
  /** 시위 중앙 (양끝의 중점) */
  nock: Vec3;
  /** 활 폭 — 시위 당기는 거리를 여기서 정한다 */
  span: number;
}

/**
 * 쇠뇌 하나의 기하 정보를 뽑는다.
 *
 * 쏘는 방향은 탑 중심에서 이 쇠뇌로 향하는 수평 방향이다 (네 귀퉁이에서 바깥을 본다).
 * 활 양끝은 그 방향에 수직인 축에서 가장 멀리 나간 두 점이고,
 * 시위는 그 둘을 잇는 선이므로 중점이 곧 시위를 거는 자리다.
 */
function analyzeBow(pos: number[], verts: number[], towerCenter: Vec3): BowInfo {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const i of verts) {
    cx += pos[i * 3];
    cy += pos[i * 3 + 1];
    cz += pos[i * 3 + 2];
  }
  const n = Math.max(1, verts.length);
  const pivot: Vec3 = [cx / n, cy / n, cz / n];

  const sx = pivot[0] - towerCenter[0];
  const sz = pivot[2] - towerCenter[2];
  const sl = Math.hypot(sx, sz) || 1;
  const shaft: Vec3 = [sx / sl, 0, sz / sl];
  const limbX = -shaft[2];
  const limbZ = shaft[0];

  let maxP = -Infinity;
  let minP = Infinity;
  let tipA: Vec3 = pivot;
  let tipB: Vec3 = pivot;
  for (const i of verts) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const p = (x - pivot[0]) * limbX + (z - pivot[2]) * limbZ;
    if (p > maxP) {
      maxP = p;
      tipA = [x, y, z];
    }
    if (p < minP) {
      minP = p;
      tipB = [x, y, z];
    }
  }
  const nock: Vec3 = [(tipA[0] + tipB[0]) / 2, (tipA[1] + tipB[1]) / 2, (tipA[2] + tipB[2]) / 2];
  return { verts, pivot, shaft, tipA, tipB, nock, span: Math.max(1e-4, maxP - minP) };
}

/** 대포 한 문 */
interface CannonInfo {
  verts: number[];
  /** 포가(砲架)의 회전 중심. 조준할 때 이 점을 축으로 돈다 */
  pivot: Vec3;
  /** 쏘는 방향 (수평, 탑 중심에서 바깥) */
  shaft: Vec3;
  /** 포구 — 포신에서 가장 앞으로 나간 점. 여기서 포탄과 화염이 떠난다 */
  muzzle: Vec3;
  /** 포신 길이 — 반동 거리를 여기서 정한다 */
  length: number;
  /** 이 대포가 데크의 몇 시 방향에 서 있는가 (라디안) */
  angle: number;
}

/**
 * 대포 한 문의 기하 정보를 뽑는다.
 *
 * 쇠뇌와 다른 점은 **포구**다. 활은 시위(양끝의 중점)에서 화살이 떠나지만
 * 대포는 포신 맨 앞에서 포탄이 나간다. 그래서 바깥 방향으로 가장 멀리 나간
 * 점을 찾아 그 자리를 포구로 삼는다 — 화염과 연기도 여기서 뿜는다.
 *
 * 회전축은 포신 앞끝이 아니라 포가 쪽이어야 한다. 무게중심을 쓰면 포신이
 * 길수록 축이 앞으로 쏠려서, 조준할 때 대포가 제자리에서 도는 게 아니라
 * 데크 위를 미끄러지는 것처럼 보인다. 그래서 축을 뒤쪽으로 조금 물린다.
 */
function analyzeCannon(pos: number[], verts: number[], towerCenter: Vec3): CannonInfo {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const i of verts) {
    cx += pos[i * 3];
    cy += pos[i * 3 + 1];
    cz += pos[i * 3 + 2];
  }
  const n = Math.max(1, verts.length);
  const centroid: Vec3 = [cx / n, cy / n, cz / n];

  const sx = centroid[0] - towerCenter[0];
  const sz = centroid[2] - towerCenter[2];
  const sl = Math.hypot(sx, sz) || 1;
  const shaft: Vec3 = [sx / sl, 0, sz / sl];

  // 쏘는 방향으로 가장 앞선 점(포구)과 가장 뒤진 점(포미)
  let maxF = -Infinity;
  let minF = Infinity;
  let muzzle: Vec3 = centroid;
  for (const i of verts) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const f = (x - centroid[0]) * shaft[0] + (z - centroid[2]) * shaft[2];
    if (f > maxF) {
      maxF = f;
      muzzle = [x, y, z];
    }
    if (f < minF) minF = f;
  }
  const length = Math.max(1e-4, maxF - minF);
  // 축은 무게중심에서 포미 쪽으로 길이의 20% — 포가가 놓인 자리에 가깝다
  const pivot: Vec3 = [
    centroid[0] - shaft[0] * length * 0.2,
    centroid[1],
    centroid[2] - shaft[2] * length * 0.2,
  ];
  return { verts, pivot, shaft, muzzle, length, angle: Math.atan2(sz, sx) };
}

// ── glTF 조립 ─────────────────────────────────────────────────────────

function accessor(
  doc: Document,
  data: Float32Array | Uint32Array | Uint16Array | Uint8Array,
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4',
  normalized = false,
): Accessor {
  const acc = doc
    .createAccessor()
    .setType(type)
    .setArray(data as Float32Array<ArrayBuffer>)
    .setBuffer(doc.getRoot().listBuffers()[0]);
  if (normalized) acc.setNormalized(true);
  return acc;
}

/**
 * 인덱스는 정점이 65,536개 미만이면 16비트로 충분하다.
 * 32비트로 쓰면 성벽 하나에 수백 KB가 그냥 늘어난다.
 */
function indexArray(idx: number[], vertexCount: number): Uint16Array | Uint32Array {
  return vertexCount < 65536 ? new Uint16Array(idx) : new Uint32Array(idx);
}

/**
 * 뼈 번호는 열 몇 개뿐이라 8비트면 되고, 가중치는 전부 0 아니면 1이라
 * 정규화된 8비트로 충분하다. float32 로 쓰면 이 둘만으로 800KB가 넘는다.
 */
function skinAttributes(
  vcount: number,
  boneOf: (i: number) => number,
): { joints: Uint8Array; weights: Uint8Array } {
  const joints = new Uint8Array(vcount * 4);
  const weights = new Uint8Array(vcount * 4);
  for (let i = 0; i < vcount; i++) {
    joints[i * 4] = boneOf(i);
    weights[i * 4] = 255; // 정규화하면 1.0
  }
  return { joints, weights };
}

/** 평행이동만 있는 역바인드 행렬 (열우선) */
function ibmOf(p: Vec3): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1];
}

export async function rigTower(input: string, output: string, opts: TowerRigOptions): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(input);
  const m = readMesh(doc);
  const b = bounds(m.pos);
  const height = b.max[1] - b.min[1];
  const bowYAbs = b.min[1] + height * opts.bowY;
  console.log(
    `[tower] bbox Y ${b.min[1].toFixed(3)}..${b.max[1].toFixed(3)}` +
      `  중심XZ (${b.center[0].toFixed(3)}, ${b.center[2].toFixed(3)})` +
      `  쇠뇌 경계 Y ${bowYAbs.toFixed(3)}`,
  );

  let cannonCount = 0;
  let part: Uint8Array;
  if (opts.kind === 'catapult') {
    part = classifyCatapult(m, b, bowYAbs);
  } else if (opts.kind === 'cannons') {
    const topYAbs = b.min[1] + height * (opts.deckTop ?? 0.78);
    /*
     * 기준 반경은 **데크의 반경**이지 모델 전체의 최대 반경이 아니다.
     * 바닥에 깔린 지형 슬래브가 데크보다 넓어서, 전체 최대 반경으로 재면
     * 임계값이 통째로 밀려 포신 끝만 잡힌다(실제로 그랬다: 대포 한 문 80삼각형).
     */
    let deckR = 0;
    for (let i = 0; i < m.pos.length; i += 3) {
      const y = m.pos[i + 1];
      if (y < bowYAbs || y > topYAbs) continue;
      deckR = Math.max(deckR, Math.hypot(m.pos[i] - b.center[0], m.pos[i + 2] - b.center[2]));
    }
    const protrudeR = deckR * (opts.protrudeRadius ?? 0.88);
    const claimR = deckR * (opts.cannonRadius ?? 0.4);
    console.log(
      `[tower] 대포 탐지 Y ${bowYAbs.toFixed(3)}..${topYAbs.toFixed(3)}` +
        `  데크 반경 ${deckR.toFixed(3)}` +
        `  -> 방향은 ${protrudeR.toFixed(3)} 밖, 부채꼴은 ${claimR.toFixed(3)} 밖`,
    );
    const found = classifyCannons(
      m,
      b,
      bowYAbs,
      topYAbs,
      height * (opts.barrelLift ?? 0.05),
      // 방향 찾기는 데크 위쪽 70% 만 본다 — 포신은 바닥에 붙어 있지 않다
      bowYAbs + (topYAbs - bowYAbs) * 0.3,
      protrudeR,
      claimR,
      opts.gapDeg ?? 12,
      opts.sectorPadDeg ?? 10,
    );
    part = found.part;
    cannonCount = found.count;
    if (cannonCount === 0) throw new Error('대포를 찾지 못했다 — --bow-y / --cannon-r 을 조정할 것');
  } else {
    part = classify(m, b, bowYAbs);
  }

  if (opts.debug !== 'none') {
    const keep = (p: number): boolean => (opts.debug === 'bows' ? p > 0 : p === 0);
    const out: number[] = [];
    for (let t = 0; t < part.length; t++) {
      if (!keep(part[t])) continue;
      out.push(m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2]);
    }
    doc.getRoot().listMeshes()[0].listPrimitives()[0].setIndices(accessor(doc, new Uint32Array(out), 'SCALAR'));
    mkdirSync(dirname(output), { recursive: true });
    await io.write(output, doc);
    console.log(`[tower] 디버그(${opts.debug}) 저장: ${output}`);
    return;
  }

  if (opts.kind === 'catapult') {
    await buildCatapult(io, doc, m, b, part, opts, output);
    return;
  }
  if (opts.kind === 'cannons') {
    await buildCannons(io, doc, m, b, part, cannonCount, opts, output);
    return;
  }

  /*
   * 삼각형 단위로 정점을 새로 만든다.
   *
   * 한 정점이 탑 삼각형과 쇠뇌 삼각형에 함께 쓰이면, 쇠뇌를 숨길 때(뼈 스케일 0)
   * 그 정점만 한 점으로 빨려 들어가 **가시 모양으로 늘어난 삼각형**이 남는다.
   * 경계 정점을 부위별로 복제해 각 삼각형의 세 정점이 같은 부위에 속하게 한다.
   */
  const posOut: number[] = [];
  const norOut: number[] = [];
  const uvOut: number[] = [];
  const idxOut: number[] = [];
  const partOut: number[] = [];
  const remap = new Map<string, number>();

  const emit = (src: number, p: number): number => {
    const key = `${src}:${p}`;
    const found = remap.get(key);
    if (found !== undefined) return found;
    const ni = posOut.length / 3;
    posOut.push(m.pos[src * 3], m.pos[src * 3 + 1], m.pos[src * 3 + 2]);
    norOut.push(m.nor[src * 3], m.nor[src * 3 + 1], m.nor[src * 3 + 2]);
    uvOut.push(m.uv[src * 2], m.uv[src * 2 + 1]);
    partOut.push(p);
    remap.set(key, ni);
    return ni;
  };

  for (let t = 0; t < part.length; t++) {
    const p = part[t];
    idxOut.push(emit(m.idx[t * 3], p), emit(m.idx[t * 3 + 1], p), emit(m.idx[t * 3 + 2], p));
  }

  const grouped: number[][] = [[], [], [], []];
  for (let i = 0; i < partOut.length; i++) {
    if (partOut[i] > 0) grouped[partOut[i] - 1].push(i);
  }
  const bows = grouped.map((v) => analyzeBow(posOut, v, b.center));
  bows.forEach((bw, i) =>
    console.log(
      `[tower] bow${i + 1} 정점 ${String(bw.verts.length).padStart(4)}` +
        `  중심(${bw.pivot.map((v) => v.toFixed(3)).join(', ')})` +
        `  폭 ${bw.span.toFixed(3)}  방향(${bw.shaft[0].toFixed(2)}, ${bw.shaft[2].toFixed(2)})`,
    ),
  );

  // ── 모자란 쇠뇌는 복제한다 (레벨 5 = 활 5개, 모델에는 4개뿐) ──────
  const extra = Math.max(0, opts.bowCount - bows.length);
  for (let e = 0; e < extra; e++) {
    const srcIndex = e % 4;
    const src = bows[srcIndex];
    const newPart = 5 + e;
    const map = new Map<number, number>();
    for (const i of src.verts) {
      map.set(i, posOut.length / 3);
      posOut.push(posOut[i * 3], posOut[i * 3 + 1], posOut[i * 3 + 2]);
      norOut.push(norOut[i * 3], norOut[i * 3 + 1], norOut[i * 3 + 2]);
      uvOut.push(uvOut[i * 2], uvOut[i * 2 + 1]);
      partOut.push(newPart);
    }
    const triCount = idxOut.length / 3;
    for (let t = 0; t < triCount; t++) {
      const a = map.get(idxOut[t * 3]);
      const c = map.get(idxOut[t * 3 + 1]);
      const d = map.get(idxOut[t * 3 + 2]);
      if (a === undefined || c === undefined || d === undefined) continue;
      idxOut.push(a, c, d);
    }
    bows.push({ ...src, verts: [...map.values()] });
  }

  const bowCount = bows.length;

  // ── 뼈 ───────────────────────────────────────────────────────────
  const boneNames = ['tower'];
  const bonePos: Vec3[] = [b.center];
  for (let i = 0; i < bowCount; i++) {
    boneNames.push(`bow${i + 1}`, `bow${i + 1}_nock`);
    bonePos.push(bows[i].pivot, bows[i].nock);
  }
  const boneIndex = new Map(boneNames.map((n, i) => [n, i]));

  const vcount = posOut.length / 3;
  const { joints, weights } = skinAttributes(vcount, (i) => {
    const p = partOut[i] ?? 0;
    return p === 0 ? 0 : (boneIndex.get(`bow${p}`) ?? 0);
  });
  console.log(`[tower] 쇠뇌 ${bowCount}개 (원본 4 + 복제 ${extra}), 뼈 ${boneNames.length}개, 정점 ${vcount}`);

  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  prim.setAttribute('POSITION', accessor(doc, new Float32Array(posOut), 'VEC3'));
  prim.setAttribute('NORMAL', accessor(doc, new Float32Array(norOut), 'VEC3'));
  prim.setAttribute('TEXCOORD_0', accessor(doc, new Float32Array(uvOut), 'VEC2'));
  prim.setIndices(accessor(doc, indexArray(idxOut, vcount), 'SCALAR'));
  prim.setAttribute('JOINTS_0', accessor(doc, joints, 'VEC4'));
  prim.setAttribute('WEIGHTS_0', accessor(doc, weights, 'VEC4', true));

  // ── 노드 트리 ────────────────────────────────────────────────────
  const nodes = new Map<string, Node>();
  for (const n of boneNames) nodes.set(n, doc.createNode(n));
  const towerNode = nodes.get('tower')!;
  towerNode.setTranslation(b.center);

  /** 5번째 쇠뇌는 탑 가운데에 세운다 (네 귀퉁이는 이미 찼다) */
  const relocate = (i: number, bw: BowInfo): Vec3 =>
    i < 4 ? [0, 0, 0] : [b.center[0] - bw.pivot[0], 0, b.center[2] - bw.pivot[2]];

  for (let i = 0; i < bowCount; i++) {
    const bw = bows[i];
    const off = relocate(i, bw);
    const bowNode = nodes.get(`bow${i + 1}`)!;
    bowNode.setTranslation([
      bw.pivot[0] - b.center[0] + off[0],
      bw.pivot[1] - b.center[1],
      bw.pivot[2] - b.center[2] + off[2],
    ]);
    towerNode.addChild(bowNode);

    const nockNode = nodes.get(`bow${i + 1}_nock`)!;
    nockNode.setTranslation([
      bw.nock[0] - bw.pivot[0],
      bw.nock[1] - bw.pivot[1],
      bw.nock[2] - bw.pivot[2],
    ]);
    bowNode.addChild(nockNode);

    // 활 양끝 표식 — 뷰가 tipA -> nock -> tipB 로 시위를 그린다
    for (const [suffix, tip] of [
      ['tipA', bw.tipA],
      ['tipB', bw.tipB],
    ] as [string, Vec3][]) {
      bowNode.addChild(
        doc
          .createNode(`bow${i + 1}_${suffix}`)
          .setTranslation([tip[0] - bw.pivot[0], tip[1] - bw.pivot[1], tip[2] - bw.pivot[2]]),
      );
    }
  }

  const ibm = new Float32Array(boneNames.length * 16) as Float32Array<ArrayBuffer>;
  for (let i = 0; i < boneNames.length; i++) ibm.set(ibmOf(bonePos[i]), i * 16);
  const skin = doc.createSkin('tower_skin').setInverseBindMatrices(accessor(doc, ibm, 'MAT4'));
  for (const n of boneNames) skin.addJoint(nodes.get(n)!);
  skin.setSkeleton(towerNode);

  const scene = doc.getRoot().listScenes()[0];
  let meshNode: Node | null = null;
  for (const nd of doc.getRoot().listNodes()) {
    if (nd.getMesh()) meshNode = nd;
  }
  if (!meshNode) throw new Error('메시 노드를 찾지 못했다');
  (meshNode as Node).setSkin(skin);

  // ── 발사 클립 ────────────────────────────────────────────────────
  //
  // 쇠뇌는 쏜 뒤에 다시 당겨 놓고 기다린다. 그래서 시간 순서가
  // "당겨진 상태 -> 튕겨 나감 -> 천천히 다시 당김" 이다.
  // 뷰가 마지막 프레임에서 멈추게 재생하므로 대기 중에는 늘 장전된 모습이다.
  //
  // glTF 의 translation 채널은 노드 위치를 **교체**한다. 그래서 값은 전부
  // 그 노드의 로컬 좌표계 절대값이어야 한다 — 오프셋으로 두면 노드가 원점으로 순간이동한다.
  for (let i = 0; i < bowCount; i++) {
    const bw = bows[i];
    const anim = doc.createAnimation(`shoot${i + 1}`);
    const draw = bw.span * 0.4;
    const recoil = bw.span * 0.08;

    const add = (nodeName: string, times: number[], amounts: number[], dist: number): void => {
      const node = nodes.get(nodeName)!;
      const base = node.getTranslation();
      const values: number[] = [];
      for (const k of amounts) {
        values.push(base[0] - bw.shaft[0] * dist * k, base[1], base[2] - bw.shaft[2] * dist * k);
      }
      const sampler = doc
        .createAnimationSampler()
        .setInput(accessor(doc, new Float32Array(times), 'SCALAR'))
        .setOutput(accessor(doc, new Float32Array(values), 'VEC3'))
        .setInterpolation('LINEAR');
      anim.addSampler(sampler);
      anim.addChannel(
        doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler),
      );
    };

    // 시위: 당겨진 상태(1) -> 놓는다(0) -> 살짝 튕김 -> 다시 당김(1)
    add(`bow${i + 1}_nock`, [0, 0.05, 0.13, 0.5], [1, 0, 0.12, 1], draw);
    // 몸통: 쏘는 반대쪽으로 밀렸다가 제자리
    add(`bow${i + 1}`, [0, 0.05, 0.24, 0.5], [0, 1, 0.3, 0], recoil);
  }

  // ── 크기와 접지를 굽는다 ─────────────────────────────────────────
  const scale = opts.targetHeight / height;
  const stand = doc
    .createNode('stand')
    .setScale([scale, scale, scale])
    .setTranslation([0, -b.min[1] * scale, 0]);
  stand.addChild(towerNode);
  scene.addChild(stand);
  console.log(`[tower] 높이 ${height.toFixed(3)} -> ${opts.targetHeight}u  스케일 ${scale.toFixed(2)}`);

  mkdirSync(dirname(output), { recursive: true });
  await io.write(output, doc);
  console.log(`[tower] 저장: ${output} (${(statSync(output).size / 1024 / 1024).toFixed(2)} MB)`);
}

/**
 * 포대 조립 — 데크에 둘러선 대포마다 뼈를 심고, 모자란 문수는 복제해 채운다.
 *
 * 활 망루의 복제와 다른 점은 **돌려서 놓는다**는 것이다. 쇠뇌는 네 귀퉁이라
 * 다섯 번째를 가운데 세우면 됐지만(relocate), 데크가 둥근 포대에서 가운데는
 * 정자가 차지하고 있다. 그래서 복제본은 빈 방향으로 **회전 이동**시킨다 —
 * 정점과 노멀을 탑 중심의 Y축 둘레로 돌려 굽는다. 그러면 원본과 같은 모양의
 * 대포가 다른 시각 방향에서 바깥을 보고 서 있게 된다.
 *
 * 자리는 `bowCount` 문이 고르게 둘러서는 링을 먼저 그리고(원본 1번 각도에서 시작해
 * 360/N 간격), 원본들을 가장 가까운 자리에 붙인 뒤 남는 자리에 복제본을 넣는다.
 * 원본은 제자리에 그대로 둔다 — 억지로 링에 맞추면 원본 세 문이 미묘하게 어긋난다.
 *
 * 결과 뼈는 활 망루와 같은 이름을 쓴다(bowN / bowN_nock). TowerView 가 레벨만큼만
 * 보여주고 쏜 것만 돌리는 코드를 그대로 재사용하기 위해서다. 다만 시위가 없으므로
 * bowN_tipA/tipB 는 만들지 않는다 — 뷰는 그 둘이 없으면 시위 선을 그리지 않는다.
 */
async function buildCannons(
  io: NodeIO,
  doc: Document,
  m: Mesh,
  b: Bounds,
  part: Uint8Array,
  nativeCount: number,
  opts: TowerRigOptions,
  output: string,
): Promise<void> {
  /*
   * 부위별로 정점을 새로 만든다. 한 정점이 데크 삼각형과 대포 삼각형에 함께 쓰이면
   * 그 대포를 숨길 때(뼈 스케일 0) 그 정점만 한 점으로 빨려 들어가 가시가 남는다.
   */
  const posOut: number[] = [];
  const norOut: number[] = [];
  const uvOut: number[] = [];
  const idxOut: number[] = [];
  const partOut: number[] = [];
  const remap = new Map<string, number>();
  const emit = (src: number, p: number): number => {
    const key = `${src}:${p}`;
    const found = remap.get(key);
    if (found !== undefined) return found;
    const ni = posOut.length / 3;
    posOut.push(m.pos[src * 3], m.pos[src * 3 + 1], m.pos[src * 3 + 2]);
    norOut.push(m.nor[src * 3], m.nor[src * 3 + 1], m.nor[src * 3 + 2]);
    uvOut.push(m.uv[src * 2], m.uv[src * 2 + 1]);
    partOut.push(p);
    remap.set(key, ni);
    return ni;
  };
  for (let t = 0; t < part.length; t++) {
    const p = part[t];
    idxOut.push(emit(m.idx[t * 3], p), emit(m.idx[t * 3 + 1], p), emit(m.idx[t * 3 + 2], p));
  }

  const grouped: number[][] = Array.from({ length: nativeCount }, () => []);
  for (let i = 0; i < partOut.length; i++) {
    if (partOut[i] > 0) grouped[partOut[i] - 1].push(i);
  }
  const cannons = grouped.map((v) => analyzeCannon(posOut, v, b.center));
  cannons.forEach((c, i) =>
    console.log(
      `[tower] cannon${i + 1} 정점 ${String(c.verts.length).padStart(4)}` +
        `  ${((c.angle * 180) / Math.PI).toFixed(0).padStart(4)}도` +
        `  축(${c.pivot.map((v) => v.toFixed(3)).join(', ')})` +
        `  포구(${c.muzzle.map((v) => v.toFixed(3)).join(', ')})  길이 ${c.length.toFixed(3)}`,
    ),
  );

  // ── 모자란 문수를 복제로 채운다 ────────────────────────────────────
  //
  // 고르게 둘러서는 자리를 원본 1번 각도에서부터 그린다. 원본들을 가장 가까운
  // 자리에 붙이고(그 자리는 이미 찼다), 남은 자리에 원본 1번을 돌려 복제한다.
  const total = Math.max(nativeCount, opts.bowCount);
  const step = (Math.PI * 2) / total;
  const slotTaken = new Array<boolean>(total).fill(false);
  for (const c of cannons) {
    const raw = Math.round((c.angle - cannons[0].angle) / step);
    let s = ((raw % total) + total) % total;
    // 이미 찬 자리면 비어 있는 다음 자리로 민다 (원본이 몰려 있을 때의 안전장치)
    for (let k = 0; k < total && slotTaken[s]; k++) s = (s + 1) % total;
    slotTaken[s] = true;
  }

  const src = cannons[0];
  for (let s = 0; s < total && cannons.length < total; s++) {
    if (slotTaken[s]) continue;
    slotTaken[s] = true;
    const delta = cannons[0].angle + s * step - src.angle;
    const cos = Math.cos(delta);
    const sin = Math.sin(delta);
    // XZ 평면에서 탑 중심 둘레로 돈다. 각도가 atan2(z, x) 이므로 회전도 그 축에 맞춘다.
    const spin = (p: Vec3): Vec3 => {
      const x = p[0] - b.center[0];
      const z = p[2] - b.center[2];
      return [b.center[0] + x * cos - z * sin, p[1], b.center[2] + x * sin + z * cos];
    };
    const map = new Map<number, number>();
    for (const i of src.verts) {
      map.set(i, posOut.length / 3);
      const p = spin([posOut[i * 3], posOut[i * 3 + 1], posOut[i * 3 + 2]]);
      posOut.push(p[0], p[1], p[2]);
      // 노멀은 방향이라 중심 이동 없이 돌린다
      const nx = norOut[i * 3];
      const nz = norOut[i * 3 + 2];
      norOut.push(nx * cos - nz * sin, norOut[i * 3 + 1], nx * sin + nz * cos);
      uvOut.push(uvOut[i * 2], uvOut[i * 2 + 1]);
      partOut.push(cannons.length + 1);
    }
    const triCount = idxOut.length / 3;
    for (let t = 0; t < triCount; t++) {
      const a = map.get(idxOut[t * 3]);
      const c = map.get(idxOut[t * 3 + 1]);
      const d = map.get(idxOut[t * 3 + 2]);
      if (a === undefined || c === undefined || d === undefined) continue;
      idxOut.push(a, c, d);
    }
    cannons.push({
      verts: [...map.values()],
      pivot: spin(src.pivot),
      muzzle: spin(src.muzzle),
      shaft: [src.shaft[0] * cos - src.shaft[2] * sin, 0, src.shaft[0] * sin + src.shaft[2] * cos],
      length: src.length,
      angle: src.angle + delta,
    });
    console.log(`[tower] cannon${cannons.length} 복제 -> ${(((src.angle + delta) * 180) / Math.PI).toFixed(0)}도`);
  }

  const count = cannons.length;

  // ── 뼈 ─────────────────────────────────────────────────────────────
  const boneNames = ['tower'];
  const bonePos: Vec3[] = [b.center];
  for (let i = 0; i < count; i++) {
    boneNames.push(`bow${i + 1}`, `bow${i + 1}_nock`);
    bonePos.push(cannons[i].pivot, cannons[i].muzzle);
  }
  const boneIndex = new Map(boneNames.map((n, i) => [n, i]));

  const vcount = posOut.length / 3;
  const { joints, weights } = skinAttributes(vcount, (i) => {
    const p = partOut[i] ?? 0;
    return p === 0 ? 0 : (boneIndex.get(`bow${p}`) ?? 0);
  });
  console.log(
    `[tower] 대포 ${count}문 (원본 ${nativeCount} + 복제 ${count - nativeCount}), ` +
      `뼈 ${boneNames.length}개, 정점 ${vcount}`,
  );

  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  prim.setAttribute('POSITION', accessor(doc, new Float32Array(posOut), 'VEC3'));
  prim.setAttribute('NORMAL', accessor(doc, new Float32Array(norOut), 'VEC3'));
  prim.setAttribute('TEXCOORD_0', accessor(doc, new Float32Array(uvOut), 'VEC2'));
  prim.setIndices(accessor(doc, indexArray(idxOut, vcount), 'SCALAR'));
  prim.setAttribute('JOINTS_0', accessor(doc, joints, 'VEC4'));
  prim.setAttribute('WEIGHTS_0', accessor(doc, weights, 'VEC4', true));

  // ── 노드 트리 ──────────────────────────────────────────────────────
  const nodes = new Map<string, Node>();
  for (const n of boneNames) nodes.set(n, doc.createNode(n));
  const towerNode = nodes.get('tower')!;
  towerNode.setTranslation(b.center);

  for (let i = 0; i < count; i++) {
    const c = cannons[i];
    const bowNode = nodes.get(`bow${i + 1}`)!;
    bowNode.setTranslation([
      c.pivot[0] - b.center[0],
      c.pivot[1] - b.center[1],
      c.pivot[2] - b.center[2],
    ]);
    towerNode.addChild(bowNode);

    // 포구 — 투사체와 포연이 떠나는 자리. 이름은 활과 같은 규약을 쓴다.
    const muzzleNode = nodes.get(`bow${i + 1}_nock`)!;
    muzzleNode.setTranslation([
      c.muzzle[0] - c.pivot[0],
      c.muzzle[1] - c.pivot[1],
      c.muzzle[2] - c.pivot[2],
    ]);
    bowNode.addChild(muzzleNode);
  }

  const ibm = new Float32Array(boneNames.length * 16) as Float32Array<ArrayBuffer>;
  for (let i = 0; i < boneNames.length; i++) ibm.set(ibmOf(bonePos[i]), i * 16);
  const skin = doc.createSkin('cannon_skin').setInverseBindMatrices(accessor(doc, ibm, 'MAT4'));
  for (const n of boneNames) skin.addJoint(nodes.get(n)!);
  skin.setSkeleton(towerNode);

  const scene = doc.getRoot().listScenes()[0];
  let meshNode: Node | null = null;
  for (const nd of doc.getRoot().listNodes()) if (nd.getMesh()) meshNode = nd;
  if (!meshNode) throw new Error('메시 노드를 찾지 못했다');
  (meshNode as Node).setSkin(skin);

  /*
   * 발사 클립 — 포신이 뒤로 튀었다가 천천히 제자리로 돌아온다.
   *
   * 시뮬은 발사하는 순간 투사체를 만든다. 그래서 반동도 그 순간부터여야 한다 —
   * 앞에 준비 동작을 두면 포탄이 먼저 나가고 대포가 뒤늦게 움찔한다.
   * 튀는 데 0.06초, 돌아오는 데 0.44초. 대포는 되돌아오는 게 느려야 무겁게 보인다.
   */
  for (let i = 0; i < count; i++) {
    const c = cannons[i];
    const recoil = c.length * 0.16;
    const node = nodes.get(`bow${i + 1}`)!;
    const base = node.getTranslation();
    const values: number[] = [];
    for (const k of [0, 1, 0.28, 0]) {
      values.push(base[0] - c.shaft[0] * recoil * k, base[1], base[2] - c.shaft[2] * recoil * k);
    }
    const anim = doc.createAnimation(`shoot${i + 1}`);
    const sampler = doc
      .createAnimationSampler()
      .setInput(accessor(doc, new Float32Array([0, 0.06, 0.22, 0.5]), 'SCALAR'))
      .setOutput(accessor(doc, new Float32Array(values), 'VEC3'))
      .setInterpolation('LINEAR');
    anim.addSampler(sampler);
    anim.addChannel(
      doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler),
    );
  }

  // ── 크기와 접지를 굽는다 ───────────────────────────────────────────
  const height = b.max[1] - b.min[1];
  const scale = opts.targetHeight / height;
  const stand = doc
    .createNode('stand')
    .setScale([scale, scale, scale])
    .setTranslation([0, -b.min[1] * scale, 0]);
  stand.addChild(towerNode);
  scene.addChild(stand);
  console.log(`[tower] 높이 ${height.toFixed(3)} -> ${opts.targetHeight}u  스케일 ${scale.toFixed(2)}`);

  mkdirSync(dirname(output), { recursive: true });
  await io.write(output, doc);
  console.log(`[tower] 저장: ${output} (${(statSync(output).size / 1024 / 1024).toFixed(2)} MB)`);
}

/**
 * 투석기 조립.
 *
 * 뼈 구조를 두 겹으로 나눈다.
 *   bow1       조준 회전(yaw) — TowerView 가 목표를 향해 돌린다
 *   bow1_arm   던지는 각도(pitch) — shoot1 클립이 젖혔다 튕긴다
 *   bow1_nock  돌이 놓이는 자리 — 여기서 투사체가 떠난다
 *
 * 두 겹인 이유는 뷰가 매 프레임 `bow1.rotation.y` 를 덮어쓰기 때문이다.
 * 한 노드에 조준과 발사를 같이 걸면 클립이 지워진다.
 */
async function buildCatapult(
  io: NodeIO,
  doc: Document,
  m: Mesh,
  b: Bounds,
  part: Uint8Array,
  opts: TowerRigOptions,
  output: string,
): Promise<void> {
  // 부위별로 정점을 새로 만든다 (경계 정점이 늘어나 가시가 되는 것을 막는다)
  const posOut: number[] = [];
  const norOut: number[] = [];
  const uvOut: number[] = [];
  const idxOut: number[] = [];
  const partOut: number[] = [];
  const remap = new Map<string, number>();
  const emit = (src: number, p: number): number => {
    const key = `${src}:${p}`;
    const found = remap.get(key);
    if (found !== undefined) return found;
    const ni = posOut.length / 3;
    posOut.push(m.pos[src * 3], m.pos[src * 3 + 1], m.pos[src * 3 + 2]);
    norOut.push(m.nor[src * 3], m.nor[src * 3 + 1], m.nor[src * 3 + 2]);
    uvOut.push(m.uv[src * 2], m.uv[src * 2 + 1]);
    partOut.push(p);
    remap.set(key, ni);
    return ni;
  };
  for (let t = 0; t < part.length; t++) {
    const p = part[t];
    idxOut.push(emit(m.idx[t * 3], p), emit(m.idx[t * 3 + 1], p), emit(m.idx[t * 3 + 2], p));
  }

  // 팔의 범위와 축
  const arm: number[] = [];
  for (let i = 0; i < partOut.length; i++) if (partOut[i] === 1) arm.push(i);
  if (arm.length === 0) throw new Error('팔을 찾지 못했다 — --bow-y 를 조정할 것');

  let zMin = Infinity;
  let zMax = -Infinity;
  let armLowY = Infinity;
  let armHighY = -Infinity;
  let sx = 0;
  for (const i of arm) {
    const z = posOut[i * 3 + 2];
    const y = posOut[i * 3 + 1];
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
    if (y < armLowY) armLowY = y;
    if (y > armHighY) armHighY = y;
    sx += posOut[i * 3];
  }
  const armX = sx / arm.length;

  // 틀의 꼭대기 = 팔이 얹힌 축. 팔을 뺀 부분에서 가장 높은 곳이다.
  let apexY = -Infinity;
  let apexZ = 0;
  for (let i = 0; i < partOut.length; i++) {
    if (partOut[i] !== 0) continue;
    const y = posOut[i * 3 + 1];
    if (y > apexY) {
      apexY = y;
      apexZ = posOut[i * 3 + 2];
    }
  }
  const pivot: Vec3 = [armX, apexY, apexZ];

  // 돌이 놓이는 쪽 = 축에서 더 먼 끝 (긴 팔). 반대쪽이 균형추다.
  const farZ = Math.abs(zMax - apexZ) >= Math.abs(zMin - apexZ) ? zMax : zMin;
  const stone: Vec3 = [armX, armHighY, farZ];
  console.log(
    `[tower] 팔 정점 ${arm.length}  Z ${zMin.toFixed(3)}..${zMax.toFixed(3)}` +
      `  축(${pivot.map((v) => v.toFixed(3)).join(', ')})  돌(${stone.map((v) => v.toFixed(3)).join(', ')})`,
  );

  const boneNames = ['tower', 'bow1', 'bow1_arm', 'bow1_nock'];
  const bonePos: Vec3[] = [b.center, pivot, pivot, stone];
  const vcount = posOut.length / 3;
  // 팔 -> bow1_arm(2번 뼈), 나머지 -> tower(0번)
  const { joints, weights } = skinAttributes(vcount, (i) => (partOut[i] === 1 ? 2 : 0));

  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  prim.setAttribute('POSITION', accessor(doc, new Float32Array(posOut), 'VEC3'));
  prim.setAttribute('NORMAL', accessor(doc, new Float32Array(norOut), 'VEC3'));
  prim.setAttribute('TEXCOORD_0', accessor(doc, new Float32Array(uvOut), 'VEC2'));
  prim.setIndices(accessor(doc, indexArray(idxOut, vcount), 'SCALAR'));
  prim.setAttribute('JOINTS_0', accessor(doc, joints, 'VEC4'));
  prim.setAttribute('WEIGHTS_0', accessor(doc, weights, 'VEC4', true));

  const nodes = new Map<string, Node>();
  for (const n of boneNames) nodes.set(n, doc.createNode(n));
  const tower = nodes.get('tower')!;
  const yaw = nodes.get('bow1')!;
  const pitch = nodes.get('bow1_arm')!;
  const nock = nodes.get('bow1_nock')!;

  tower.setTranslation(b.center);
  yaw.setTranslation([pivot[0] - b.center[0], pivot[1] - b.center[1], pivot[2] - b.center[2]]);
  pitch.setTranslation([0, 0, 0]);
  nock.setTranslation([stone[0] - pivot[0], stone[1] - pivot[1], stone[2] - pivot[2]]);
  tower.addChild(yaw);
  yaw.addChild(pitch);
  pitch.addChild(nock);

  const ibm = new Float32Array(boneNames.length * 16) as Float32Array<ArrayBuffer>;
  for (let i = 0; i < boneNames.length; i++) ibm.set(ibmOf(bonePos[i]), i * 16);
  const skin = doc.createSkin('catapult_skin').setInverseBindMatrices(accessor(doc, ibm, 'MAT4'));
  for (const n of boneNames) skin.addJoint(nodes.get(n)!);
  skin.setSkeleton(tower);

  const scene = doc.getRoot().listScenes()[0];
  let meshNode: Node | null = null;
  for (const nd of doc.getRoot().listNodes()) if (nd.getMesh()) meshNode = nd;
  if (!meshNode) throw new Error('메시 노드를 찾지 못했다');
  (meshNode as Node).setSkin(skin);

  /*
   * 발사 클립 — 팔이 뒤로 젖혀졌다가 앞으로 튕긴다.
   *
   * 회전축은 팔 방향(Z)에 수직인 수평축(X)이다. 돌이 있는 쪽이 +Z 면
   * 양의 회전이 그 끝을 아래로 내리므로, 던지려면 부호를 뒤집어야 한다.
   * 그래서 돌이 어느 쪽에 있는지로 방향을 정한다.
   */
  const dir = farZ >= apexZ ? -1 : 1;
  const anim = doc.createAnimation('shoot1');
  /*
   * 시뮬은 발사하는 순간 투사체를 만든다. 그래서 클립도 그 순간에 **바로 던져야** 한다.
   * 앞에 젖히는 동작을 두면 돌이 먼저 날아가고 팔이 뒤늦게 따라가는 것처럼 보인다.
   * 던지고(0.07s) -> 반동으로 뒤로 젖혀졌다가(0.3s) -> 제자리로 돌아와 다음 발을 기다린다.
   */
  const times = [0, 0.07, 0.3, 0.7];
  const angles = [0, 1.15 * dir, -0.35 * dir, 0];
  const values: number[] = [];
  for (const a of angles) {
    const s2 = Math.sin(a / 2);
    values.push(s2, 0, 0, Math.cos(a / 2)); // X축 회전 쿼터니언
  }
  const sampler = doc
    .createAnimationSampler()
    .setInput(accessor(doc, new Float32Array(times), 'SCALAR'))
    .setOutput(accessor(doc, new Float32Array(values), 'VEC4'))
    .setInterpolation('LINEAR');
  anim.addSampler(sampler);
  anim.addChannel(
    doc.createAnimationChannel().setTargetNode(pitch).setTargetPath('rotation').setSampler(sampler),
  );

  const height = b.max[1] - b.min[1];
  const scale = opts.targetHeight / height;
  const stand = doc
    .createNode('stand')
    .setScale([scale, scale, scale])
    .setTranslation([0, -b.min[1] * scale, 0]);
  stand.addChild(tower);
  scene.addChild(stand);
  console.log(`[tower] 높이 ${height.toFixed(3)} -> ${opts.targetHeight}u  스케일 ${scale.toFixed(2)}`);

  mkdirSync(dirname(output), { recursive: true });
  await io.write(output, doc);
  console.log(`[tower] 저장: ${output} (${(statSync(output).size / 1024 / 1024).toFixed(2)} MB)`);
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/rig-tower.ts');
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name: string, d: number): number => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : d;
  };
  const str = (name: string, d: string): string => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : d;
  };
  const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  const kind = str('kind', 'bows');
  await rigTower(positional[0], positional[1], {
    kind: kind === 'catapult' || kind === 'cannons' ? kind : 'bows',
    bowY: flag('bow-y', 0.76),
    targetHeight: flag('height', 62),
    bowCount: flag('bows', 5),
    debug: str('debug', 'none') as TowerRigOptions['debug'],
    deckTop: flag('deck-top', 0.78),
    cannonRadius: flag('cannon-r', 0.4),
    protrudeRadius: flag('protrude-r', 0.88),
    gapDeg: flag('gap-deg', 12),
    sectorPadDeg: flag('sector-pad', 10),
    barrelLift: flag('barrel-lift', 0.05),
  });
}
