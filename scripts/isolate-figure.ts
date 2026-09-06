/**
 * 한 메시 안에 인물이 둘 이상 들어 있는 원본에서 하나만 남긴다.
 *
 *   npx tsx scripts/isolate-figure.ts <in.glb> <out.glb> --keep min --axis auto
 *
 * 왜 필요한가
 * ----------
 * `img/xl_healer.glb` 처럼 생성형 3D 원본은 인물 둘을 나란히 세워 한 덩어리로 준다.
 * 그대로 리깅하면 뼈대가 두 사람 사이의 허공에 놓여 팔다리가 엉뚱하게 움직인다.
 *
 * 연결 요소(connected component)로는 못 가른다 — 이런 원본은 표면이 수십 개
 * 조각으로 쪼개져 있어서(실측: 12,000 삼각형에 조각 57개) 조각 하나가 사람 하나가
 * 아니다. 대신 **두 덩어리로 나눈다(2-means)**. 각 삼각형은 더 가까운 사람에게 간다.
 *
 * 평면 하나로 자르는 방법도 써 봤지만 안 된다. 두 사람이 비스듬히 서 있으면
 * 버릴 사람의 봉이 자르는 평면 반대쪽에 남아, 게임에서 지팡이 하나가 발밑에
 * 따로 떠다니며 다리를 따라 흔들렸다. 소지품은 주인 쪽에 붙어야 한다.
 *
 * 자른 뒤에는 남은 인물의 XZ 중심을 원점으로 옮긴다. 이걸 빼먹으면 게임에서
 * 유닛이 자기 위치가 아니라 옆으로 비켜서서 걷는다.
 */
import { NodeIO, type Accessor, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export interface IsolateOptions {
  /** 인물이 갈리는 축. 'auto' 면 골이 더 뚜렷한 축을 고른다 */
  axis?: 'x' | 'z' | 'auto';
  /** 자른 뒤 남길 쪽 */
  keep: 'min' | 'max';
  /** 남은 인물의 XZ 중심을 원점으로 옮긴다 */
  recenter?: boolean;
  /**
   * 잘라낸 인물을 Y축으로 돌린다 (도).
   *
   * 원본의 두 인물은 서로 다른 쪽을 보고 서 있는 경우가 많다. 리깅 파이프라인은
   * 모델이 +Z 를 보고 있다고 가정하므로(다른 모델도 전부 그렇다), 옆을 본 채로
   * 두면 다리가 진행 방향이 아니라 옆으로 흔들린다.
   */
  rotateYDeg?: number;
}

interface Cluster {
  /** 두 인물의 XZ 중심 */
  centers: [number, number][];
  /** 두 중심을 가장 잘 가르는 축 (0=X, 2=Z) */
  axis: number;
  /** 중심 사이 거리 */
  spread: number;
}

/**
 * XZ 평면에서 정점을 두 덩어리로 나눈다.
 * 시작점을 X 최소/최대로 고정해 결과가 매번 같다 (파이프라인은 재현 가능해야 한다).
 */
function cluster2(P: Float32Array, n: number): Cluster {
  let c0: [number, number] = [Infinity, 0];
  let c1: [number, number] = [-Infinity, 0];
  for (let i = 0; i < n; i++) {
    if (P[i * 3] < c0[0]) c0 = [P[i * 3], P[i * 3 + 2]];
    if (P[i * 3] > c1[0]) c1 = [P[i * 3], P[i * 3 + 2]];
  }
  for (let iter = 0; iter < 40; iter++) {
    let ax = 0, az = 0, an = 0, bx = 0, bz = 0, bn = 0;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3];
      const z = P[i * 3 + 2];
      if ((x - c0[0]) ** 2 + (z - c0[1]) ** 2 < (x - c1[0]) ** 2 + (z - c1[1]) ** 2) {
        ax += x; az += z; an++;
      } else {
        bx += x; bz += z; bn++;
      }
    }
    if (an) c0 = [ax / an, az / an];
    if (bn) c1 = [bx / bn, bz / bn];
  }
  const dx = Math.abs(c0[0] - c1[0]);
  const dz = Math.abs(c0[1] - c1[1]);
  return { centers: [c0, c1], axis: dx >= dz ? 0 : 2, spread: Math.hypot(c0[0] - c1[0], c0[1] - c1[1]) };
}

/** 정점 하나를 옮겨 담는다 (속성 종류를 가리지 않는다) */
function copyVertices(prim: Primitive, keepIdx: number[], make: (data: Float32Array, type: string) => Accessor): void {
  for (const name of prim.listSemantics()) {
    const acc = prim.getAttribute(name)!;
    const type = acc.getType();
    const size = acc.getElementSize();
    const out = new Float32Array(keepIdx.length * size);
    const el = new Array<number>(size).fill(0);
    keepIdx.forEach((old, i) => {
      acc.getElement(old, el);
      out.set(el, i * size);
    });
    prim.setAttribute(name, make(out, type));
  }
}

export async function isolateFigure(input: string, output: string, opts: IsolateOptions): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(input);
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const make = (data: Float32Array, type: string): Accessor =>
    doc.createAccessor().setType(type as 'VEC3').setArray(new Float32Array(data)).setBuffer(buffer);

  const meshes = root.listMeshes();
  if (meshes.length !== 1) throw new Error(`메시가 1개여야 한다 (지금 ${meshes.length}개)`);
  const prims = meshes[0].listPrimitives();

  // 축 선택은 메시 전체를 보고 한 번만 한다 (프리미티브마다 다르면 안 된다)
  const first = prims[0].getAttribute('POSITION')!;
  const nAll = first.getCount();
  const P = new Float32Array(nAll * 3);
  const el = [0, 0, 0];
  for (let i = 0; i < nAll; i++) {
    first.getElement(i, el);
    P.set(el, i * 3);
  }

  const groups = cluster2(P, nAll);
  const axis = opts.axis === 'x' ? 0 : opts.axis === 'z' ? 2 : groups.axis;
  const key = axis === 0 ? 0 : 1;
  // keep 은 "가르는 축에서 어느 쪽"이라는 뜻이다
  const keepFirst = opts.keep === 'min'
    ? groups.centers[0][key] <= groups.centers[1][key]
    : groups.centers[0][key] >= groups.centers[1][key];
  const mine = groups.centers[keepFirst ? 0 : 1];
  const other = groups.centers[keepFirst ? 1 : 0];
  console.log(
    `[isolate] ${'XYZ'[axis]}축 기준 ${opts.keep} 쪽을 남긴다 — ` +
      `중심 (${mine[0].toFixed(3)}, ${mine[1].toFixed(3)}) / 버릴 쪽 (${other[0].toFixed(3)}, ${other[1].toFixed(3)})` +
      `  거리 ${groups.spread.toFixed(3)}`,
  );
  const mineIsCloser = (x: number, z: number): boolean =>
    (x - mine[0]) ** 2 + (z - mine[1]) ** 2 <= (x - other[0]) ** 2 + (z - other[1]) ** 2;

  let keptTris = 0;
  let droppedTris = 0;
  for (const prim of prims) {
    const pos = prim.getAttribute('POSITION')!;
    const idx = prim.getIndices();
    const n = pos.getCount();
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.getElement(i, el);
      pts.set(el, i * 3);
    }
    const triCount = idx ? idx.getCount() / 3 : n / 3;
    const tri = (t: number, k: number): number => (idx ? idx.getScalar(t * 3 + k) : t * 3 + k);

    const used = new Int32Array(n).fill(-1);
    const keptTriangles: number[] = [];
    for (let t = 0; t < triCount; t++) {
      const a = tri(t, 0);
      const b = tri(t, 1);
      const c = tri(t, 2);
      // 삼각형은 중심이 어느 사람에게 더 가까운지로 간다 — 봉·소매도 주인을 따라간다
      const mx = (pts[a * 3] + pts[b * 3] + pts[c * 3]) / 3;
      const mz = (pts[a * 3 + 2] + pts[b * 3 + 2] + pts[c * 3 + 2]) / 3;
      const keep = mineIsCloser(mx, mz);
      if (!keep) {
        droppedTris++;
        continue;
      }
      keptTris++;
      keptTriangles.push(a, b, c);
      used[a] = used[b] = used[c] = 0;
    }

    const keepIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (used[i] === 0) {
        used[i] = keepIdx.length;
        keepIdx.push(i);
      }
    }
    copyVertices(prim, keepIdx, make);
    const newIdx = new Uint32Array(keptTriangles.length);
    for (let i = 0; i < keptTriangles.length; i++) newIdx[i] = used[keptTriangles[i]];
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(newIdx).setBuffer(buffer));
  }
  console.log(`[isolate] 삼각형 ${keptTris.toLocaleString()} 남김 / ${droppedTris.toLocaleString()} 버림`);

  if (opts.recenter !== false) {
    // 중앙값으로 옮긴다. 봉이나 소매처럼 한쪽으로 튀어나온 부분이 있어도
    // bbox 중심과 달리 몸통을 원점에 둔다.
    const pos = prims[0].getAttribute('POSITION')!;
    const n = pos.getCount();
    const xs = new Float64Array(n);
    const zs = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      pos.getElement(i, el);
      xs[i] = el[0];
      zs[i] = el[2];
    }
    xs.sort();
    zs.sort();
    const cx = xs[Math.floor(n / 2)];
    const cz = zs[Math.floor(n / 2)];
    for (const prim of prims) {
      const acc = prim.getAttribute('POSITION')!;
      const arr = acc.getArray() as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] -= cx;
        arr[i + 2] -= cz;
      }
      acc.setArray(new Float32Array(arr));
    }
    console.log(`[isolate] XZ 중심 이동 (${cx.toFixed(3)}, ${cz.toFixed(3)}) -> 원점`);
  }

  if (opts.rotateYDeg) {
    const a = (opts.rotateYDeg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // 위치와 법선을 같이 돌린다. 법선을 빼먹으면 조명이 뒤집혀 얼굴이 그늘진다.
    for (const prim of prims) {
      for (const name of ['POSITION', 'NORMAL']) {
        const acc = prim.getAttribute(name);
        if (!acc) continue;
        const arr = acc.getArray() as Float32Array;
        for (let i = 0; i < arr.length; i += 3) {
          const x = arr[i];
          const z = arr[i + 2];
          arr[i] = x * cos + z * sin;
          arr[i + 2] = -x * sin + z * cos;
        }
        acc.setArray(new Float32Array(arr));
      }
    }
    console.log(`[isolate] Y축 ${opts.rotateYDeg}도 회전 — 정면을 +Z 로 맞춘다`);
  }

  await doc.transform(prune());
  mkdirSync(dirname(output), { recursive: true });
  await io.write(output, doc);
  console.log(`[isolate] 저장: ${output} (${(statSync(output).size / 1024 / 1024).toFixed(2)} MB)`);
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/isolate-figure.ts');
if (isMain) {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  await isolateFigure(positional[0], positional[1], {
    axis: (flag('axis') as 'x' | 'z' | 'auto') ?? 'auto',
    keep: (flag('keep') as 'min' | 'max') ?? 'min',
  });
}
