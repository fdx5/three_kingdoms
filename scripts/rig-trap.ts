/**
 * 지면 함정 리깅 — 바닥에 까는 원반형 진지(철질려)에 뼈와 동작을 심는다.
 *
 *   npx tsx scripts/rig-trap.ts <in.glb> <out.glb> [--diameter 52] [--spike-top 0.57]
 *
 * 왜 rig-tower 가 아니라 따로인가
 * -----------------------------
 * rig-tower 는 **쏘는 건물** 전용이다. 쇠뇌·투석기·대포 모두 `bowN` 뼈와
 * `shootN` 클립이라는 같은 규약 위에 서 있고, 뷰도 발사 시점에 그 클립을 튼다.
 * 철질려는 투사체가 없다 — 밟은 적을 늦출 뿐이라 발사라는 사건 자체가 없다.
 * 억지로 끼우면 쓰지도 않을 쇠뇌 뼈가 생기고 규약만 헷갈려진다.
 *
 * 결과물
 * ------
 *   뼈     tower           석반 (움직이지 않는다)
 *          spike1..spikeN  마름쇠 하나씩
 *   클립   idle            제자리에서 천천히 도는 마름쇠 (반복)
 *          trigger         밟혔을 때 한 번 솟았다 가라앉는다 (1회)
 *
 * 동작을 이렇게 정한 이유
 * --------------------
 * 이 진지는 걷지도 쏘지도 않는다. 화면에서 "살아 있다"를 알릴 방법이 마름쇠뿐이다.
 *   idle    여덟 개가 **서로 다른 위상**으로 천천히 돈다. 같은 위상으로 돌리면
 *           원반 전체가 도는 것처럼 보여서 함정이 아니라 회전판이 된다.
 *   trigger 적이 걸린 순간 가시가 솟구친다. 게임에서 이 진지의 존재 이유가
 *           "밟으면 느려진다"이므로, 그 순간이 눈에 보여야 한다.
 */
import { NodeIO, type Accessor, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Vec3 = [number, number, number];

export interface TrapRigOptions {
  /** 완성된 원반의 지름(world unit) */
  diameter: number;
  /**
   * 석반 윗면의 높이 — 모델 두께 대비 비율. 이보다 위로 솟은 것을 마름쇠로 본다.
   *
   * 너무 낮으면 석반의 무늬 띠까지 딸려 와 무리가 잘게 갈라지고(실측: 0.19 로
   * 두었더니 88개가 나왔다), 너무 높으면 가시 끝만 잡혀 뿌리가 석반에 남는다.
   * 실측(철질려): 0.57 에서 정확히 여덟 개가 나온다.
   *
   * 기준은 **정규화 뒤의 두께**다 — 0 이 바닥, 1 이 가장 높은 가시 끝이다.
   */
  spikeTop: number;
}

// ── 선형대수 (이 파일에서만 쓰는 최소한) ─────────────────────────────

const nrm = (v: Vec3): Vec3 => {
  const L = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / L, v[1] / L, v[2] / L];
};

const mul3 = (M: number[], v: Vec3): Vec3 => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
  M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
  M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
];

/**
 * 가장 얇은 주축 = 원반의 법선.
 *
 * 이미지에서 생성한 모델은 그림의 원근을 그대로 굽는다 — 철질려는 법선이 Y축에서
 * 40.5도 기울어 있었다. 그대로 두면 바닥에 비스듬히 박힌다.
 */
function discNormal(P: Float32Array, n: number): { center: Vec3; up: Vec3 } {
  const c: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    c[0] += P[i * 3];
    c[1] += P[i * 3 + 1];
    c[2] += P[i * 3 + 2];
  }
  c[0] /= n;
  c[1] /= n;
  c[2] /= n;

  const cov = new Array<number>(9).fill(0);
  for (let i = 0; i < n; i++) {
    const v = [P[i * 3] - c[0], P[i * 3 + 1] - c[1], P[i * 3 + 2] - c[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a * 3 + b] += v[a] * v[b];
  }

  const power = (M: number[]): { e: Vec3; lam: number } => {
    let e: Vec3 = nrm([0.3, 0.9, 0.2]);
    for (let i = 0; i < 300; i++) e = nrm(mul3(M, e));
    const Me = mul3(M, e);
    return { e, lam: e[0] * Me[0] + e[1] * Me[1] + e[2] * Me[2] };
  };
  const deflate = (M: number[], top: { e: Vec3; lam: number }): number[] => {
    const D = M.slice();
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) D[a * 3 + b] -= top.lam * top.e[a] * top.e[b];
    return D;
  };

  const a1 = power(cov);
  const a2 = power(deflate(cov, a1));
  const a3 = power(deflate(deflate(cov, a1), a2));
  const up = a3.e[1] < 0 ? ([-a3.e[0], -a3.e[1], -a3.e[2]] as Vec3) : a3.e;
  return { center: c, up };
}

/** up 을 +Y 로 보내는 최소 회전 (로드리게스) */
function uprightMatrix(up: Vec3): number[] {
  const t: Vec3 = [0, 1, 0];
  const v: Vec3 = [
    up[1] * t[2] - up[2] * t[1],
    up[2] * t[0] - up[0] * t[2],
    up[0] * t[1] - up[1] * t[0],
  ];
  const s = Math.hypot(v[0], v[1], v[2]);
  const dot = up[0] * t[0] + up[1] * t[1] + up[2] * t[2];
  const K = [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0];
  const K2 = [...Array<number>(9)].map((_, i) => {
    const r = (i / 3) | 0;
    const c = i % 3;
    return K[r * 3] * K[c] + K[r * 3 + 1] * K[3 + c] + K[r * 3 + 2] * K[6 + c];
  });
  const f = s < 1e-9 ? 0 : (1 - dot) / (s * s);
  return [...Array<number>(9)].map((_, i) => (i % 4 === 0 ? 1 : 0) + K[i] + K2[i] * f);
}

interface Spike {
  /** 회전 중심 = 마름쇠 뿌리 (석반 윗면 높이) */
  center: Vec3;
  members: number[];
  /** 무리의 XZ 반경 — 가중치를 구울 때 이 안쪽만 가져간다 */
  radius: number;
}

/**
 * 솟은 정점을 XZ 평면에서 무리 짓는다.
 *
 * 각도 히스토그램으로도 해 봤는데 마름쇠가 고르게 놓여 있지 않아 칸이 붙어
 * 버렸다(실측: 이웃 사이 각도가 29~115도로 들쭉날쭉했다). 평면 거리로 묶는
 * 편이 배치에 무관하게 맞는다.
 */
function findSpikes(P: Float32Array, n: number, top: number, spikeTop: number): Spike[] {
  const thr = top * spikeTop;
  let R = 0;
  for (let i = 0; i < n; i++) R = Math.max(R, Math.hypot(P[i * 3], P[i * 3 + 2]));
  const lim = R * 0.12;

  const raw: { x: number; z: number; n: number; members: number[] }[] = [];
  for (let i = 0; i < n; i++) {
    if (P[i * 3 + 1] <= thr) continue;
    const x = P[i * 3];
    const z = P[i * 3 + 2];
    let hit = raw.find((g) => Math.hypot(x - g.x / g.n, z - g.z / g.n) < lim);
    if (!hit) {
      hit = { x: 0, z: 0, n: 0, members: [] };
      raw.push(hit);
    }
    hit.x += x;
    hit.z += z;
    hit.n++;
    hit.members.push(i);
  }

  return raw
    .filter((g) => g.n >= 8)
    .map((g) => {
      const cx = g.x / g.n;
      const cz = g.z / g.n;
      let rad = 0;
      for (const i of g.members) rad = Math.max(rad, Math.hypot(P[i * 3] - cx, P[i * 3 + 2] - cz));
      // 뿌리는 임계선 아래에 있다 — 반경을 조금 넓혀 그것까지 데려간다
      return { center: [cx, thr, cz] as Vec3, members: g.members, radius: rad * 1.25 };
    })
    .sort((a, b) => Math.atan2(a.center[2], a.center[0]) - Math.atan2(b.center[2], b.center[0]));
}

// ── glTF 잡일 ─────────────────────────────────────────────────────────

function floatAccessor(
  doc: Document,
  data: number[] | Float32Array,
  type: 'SCALAR' | 'VEC3' | 'VEC4',
): Accessor {
  const array = data instanceof Float32Array ? data : new Float32Array(data);
  return doc
    .createAccessor()
    .setType(type)
    .setArray(array as Float32Array<ArrayBuffer>)
    .setBuffer(doc.getRoot().listBuffers()[0]);
}

/** Y축 회전 -> 쿼터니언 */
function quatY(a: number): number[] {
  return [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
}

interface TrackSpec {
  bone: string;
  path: 'rotation' | 'translation';
  times: number[];
  values: number[];
}

export async function rigTrap(input: string, output: string, opts: TrapRigOptions): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(input);
  const root = doc.getRoot();
  const mesh = root.listMeshes()[0];
  const prim = mesh?.listPrimitives()[0];
  if (!prim) throw new Error('메시를 찾지 못했다');

  const posAcc = prim.getAttribute('POSITION')!;
  const n = posAcc.getCount();
  const P = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const e = posAcc.getElement(i, [0, 0, 0]);
    P[i * 3] = e[0];
    P[i * 3 + 1] = e[1];
    P[i * 3 + 2] = e[2];
  }

  // ── 1. 세우기 ──
  const { center, up } = discNormal(P, n);
  const Rm = uprightMatrix(up);
  const tiltDeg = (Math.acos(Math.min(1, up[1])) * 180) / Math.PI;
  console.log(
    `[trap] 원반 법선 (${up.map((v) => v.toFixed(3)).join(', ')}) — ${tiltDeg.toFixed(1)}도 기울었다. 세운다.`,
  );
  for (let i = 0; i < n; i++) {
    const q = mul3(Rm, [P[i * 3] - center[0], P[i * 3 + 1] - center[1], P[i * 3 + 2] - center[2]]);
    P[i * 3] = q[0];
    P[i * 3 + 1] = q[1];
    P[i * 3 + 2] = q[2];
  }
  const nrmAcc = prim.getAttribute('NORMAL');
  if (nrmAcc) {
    for (let i = 0; i < n; i++) {
      nrmAcc.setElement(i, mul3(Rm, nrmAcc.getElement(i, [0, 0, 0]) as Vec3));
    }
  }

  // ── 2. 크기와 접지 ──
  let minY = Infinity;
  let maxY = -Infinity;
  let radius = 0;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, P[i * 3 + 1]);
    maxY = Math.max(maxY, P[i * 3 + 1]);
    radius = Math.max(radius, Math.hypot(P[i * 3], P[i * 3 + 2]));
  }
  const scale = opts.diameter / (radius * 2);
  for (let i = 0; i < n; i++) {
    P[i * 3] *= scale;
    P[i * 3 + 1] = (P[i * 3 + 1] - minY) * scale;
    P[i * 3 + 2] *= scale;
  }
  const height = (maxY - minY) * scale;
  console.log(
    `[trap] 지름 ${(radius * 2).toFixed(3)} -> ${opts.diameter}u (배율 ${scale.toFixed(2)}), 두께 ${height.toFixed(1)}u`,
  );

  // ── 3. 마름쇠 찾기 ──
  const spikes = findSpikes(P, n, height, opts.spikeTop);
  if (spikes.length === 0) throw new Error('마름쇠를 하나도 못 찾았다 — spike-top 을 조정할 것');
  console.log(`[trap] 마름쇠 ${spikes.length}개`);
  for (const [i, s] of spikes.entries()) {
    const ang = ((Math.atan2(s.center[2], s.center[0]) * 180) / Math.PI + 360) % 360;
    console.log(
      `[trap]   spike${i + 1}  중심(${s.center[0].toFixed(1)}, ${s.center[2].toFixed(1)})` +
        `  축거리 ${Math.hypot(s.center[0], s.center[2]).toFixed(1)}  각 ${ang.toFixed(0)}도` +
        `  정점 ${s.members.length}`,
    );
  }

  // ── 4. 뼈와 가중치 ──
  const bones: { name: string; head: Vec3 }[] = [
    { name: 'tower', head: [0, 0, 0] },
    ...spikes.map((s, i) => ({ name: `spike${i + 1}`, head: s.center })),
  ];
  const joints = new Uint16Array(n * 4);
  const weights = new Float32Array(n * 4);
  const owned = new Array<number>(bones.length).fill(0);
  for (let i = 0; i < n; i++) {
    let bi = 0;
    let best = Infinity;
    for (const [k, s] of spikes.entries()) {
      const d = Math.hypot(P[i * 3] - s.center[0], P[i * 3 + 2] - s.center[2]);
      // 뿌리까지 데려가려고 임계선보다 살짝 아래(92%)부터 가져간다
      if (d < s.radius && P[i * 3 + 1] > s.center[1] * 0.92 && d < best) {
        best = d;
        bi = k + 1;
      }
    }
    joints[i * 4] = bi;
    weights[i * 4] = 1;
    owned[bi]++;
  }
  console.log(`[trap] 가중치 — 석반 ${owned[0]}, 마름쇠 ${owned.slice(1).join('/')}`);

  for (let i = 0; i < n; i++) posAcc.setElement(i, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
  prim.setAttribute('JOINTS_0', floatAccessor(doc, new Float32Array(joints), 'VEC4').setArray(joints));
  prim.setAttribute('WEIGHTS_0', floatAccessor(doc, weights, 'VEC4'));

  const nodeOf = new Map<string, Node>();
  const towerNode = doc.createNode('tower').setTranslation([0, 0, 0]);
  nodeOf.set('tower', towerNode);
  for (const b of bones.slice(1)) {
    const nd = doc.createNode(b.name).setTranslation(b.head);
    towerNode.addChild(nd);
    nodeOf.set(b.name, nd);
  }

  // 바인드 포즈에 회전·스케일이 없으므로 역바인드는 -월드위치 평행이동이다
  const ibm = new Float32Array(bones.length * 16) as Float32Array<ArrayBuffer>;
  bones.forEach((b, i) => {
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.head[0], -b.head[1], -b.head[2], 1], i * 16);
  });
  const skin = doc
    .createSkin('trap_skin')
    .setInverseBindMatrices(
      doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(root.listBuffers()[0]),
    );
  for (const b of bones) skin.addJoint(nodeOf.get(b.name)!);
  skin.setSkeleton(towerNode);

  root.listScenes()[0].addChild(towerNode);
  let meshNode: Node | null = null;
  root.listNodes().forEach((nd) => {
    if (nd.getMesh() === mesh) meshNode = nd;
  });
  if (!meshNode) throw new Error('메시 노드를 찾지 못했다');
  (meshNode as Node).setSkin(skin);

  // ── 5. 클립 ──
  const addClip = (name: string, tracks: TrackSpec[]): void => {
    const anim = doc.createAnimation(name);
    for (const t of tracks) {
      const sampler = doc
        .createAnimationSampler()
        .setInput(floatAccessor(doc, new Float32Array(t.times), 'SCALAR'))
        .setOutput(floatAccessor(doc, new Float32Array(t.values), t.path === 'rotation' ? 'VEC4' : 'VEC3'))
        .setInterpolation('LINEAR');
      anim.addSampler(sampler);
      anim.addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(nodeOf.get(t.bone)!)
          .setTargetPath(t.path)
          .setSampler(sampler),
      );
    }
    console.log(`[trap] 클립 "${name}" 트랙 ${tracks.length}`);
  };

  /*
   * idle — 6초에 한 바퀴. 이보다 빠르면 팽이처럼 보이고, 느리면 멈춘 줄 안다.
   * 위상을 어긋나게 주고 이웃끼리 반대로 돌린다 — 톱니처럼 물린 인상이 난다.
   * 같은 위상·같은 방향이면 원반이 통째로 도는 것처럼 보여서 함정이 아니라
   * 회전판이 된다.
   */
  const IDLE = 6.0;
  const bob = height * 0.05;
  const idleTracks: TrackSpec[] = [];
  spikes.forEach((s, i) => {
    const phase = (i / spikes.length) * Math.PI * 2;
    const spin = i % 2 === 0 ? 1 : -1;
    const K = 8;
    const times: number[] = [];
    const rot: number[] = [];
    const tr: number[] = [];
    for (let k = 0; k <= K; k++) {
      const u = k / K;
      times.push(IDLE * u);
      rot.push(...quatY(spin * u * Math.PI * 2));
      tr.push(s.center[0], s.center[1] + Math.sin(phase + u * Math.PI * 2) * bob, s.center[2]);
    }
    idleTracks.push({ bone: `spike${i + 1}`, path: 'rotation', times, values: rot });
    idleTracks.push({ bone: `spike${i + 1}`, path: 'translation', times, values: tr });
  });
  addClip('idle', idleTracks);

  /*
   * trigger — 밟힌 순간 가시가 솟구쳤다 가라앉는다.
   *
   * 올라가는 데 0.1초, 내려오는 데 0.45초. 올라가는 쪽이 빨라야 "튀어나왔다"로
   * 읽힌다. 네 개씩 0.02초를 밀어 물결처럼 번지게 했다 — 여덟이 동시에 솟으면
   * 원반이 한 번 부풀었다 꺼지는 것처럼 보인다.
   * 솟는 동안 반 바퀴 비틀어 준다. 위아래만 움직이면 엘리베이터처럼 보인다.
   */
  const jab = height * 0.55;
  const triggerTracks: TrackSpec[] = [];
  spikes.forEach((s, i) => {
    const lag = (i % 4) * 0.02;
    const times = [0, lag + 0.1, lag + 0.28, lag + 0.55];
    const lift = [0, jab, jab * 0.25, 0];
    const turn = [0, 0.5, 0.8, 1.0];
    triggerTracks.push({
      bone: `spike${i + 1}`,
      path: 'translation',
      times,
      values: lift.flatMap((y) => [s.center[0], s.center[1] + y, s.center[2]]),
    });
    triggerTracks.push({
      bone: `spike${i + 1}`,
      path: 'rotation',
      times,
      values: turn.flatMap((u) => quatY(u * Math.PI)),
    });
  });
  addClip('trigger', triggerTracks);

  mkdirSync(dirname(output), { recursive: true });
  await io.write(output, doc);
  console.log(`[trap] 저장: ${output} (${(statSync(output).size / 1048576).toFixed(2)} MB)`);
}

// ── CLI ───────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && argv.length >= 2 && !argv[0].startsWith('--')) {
  const flag = (name: string, def: number): number => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? Number(argv[i + 1]) : def;
  };
  await rigTrap(argv[0], argv[1], {
    diameter: flag('diameter', 52),
    spikeTop: flag('spike-top', 0.57),
  });
}
