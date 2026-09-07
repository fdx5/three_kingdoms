/**
 * 수레 리깅 — 바퀴 달린 탈것에 뼈와 동작을 심는다 (목우유마·공성 목우).
 *
 *   npx tsx scripts/rig-cart.ts <in.glb> <out.glb> [--height 26] [--forward -90]
 *
 * 왜 rig-model 이 아니라 따로인가
 * -----------------------------
 * rig-model 은 **걷는 것** 전용이다. 골반과 두 다리를 찾아 가위질을 만들고,
 * 발이 땅에 붙도록 골반 높이를 프레임마다 밀어 올린다. 수레에는 그 전제가 없다 —
 * 다리가 아니라 바퀴가 돌고, 몸통은 통째로 굳어 있어야 한다.
 * 사람 뼈대를 억지로 씌우면 짐칸이 골반·가슴으로 갈려 걸을 때 수레가 휜다.
 *
 * 결과물
 * ------
 *   뼈    cart              틀·짐칸·소머리·다리 (움직이지 않는다)
 *         wheelL / wheelR   바퀴 하나씩. 축(X) 둘레로 돈다
 *   클립  idle              멈춰 선 수레 — 바퀴를 바인드 자세로 되돌린다
 *         walk              바퀴가 한 클립에 정확히 한 바퀴 구른다
 *         attack            성문을 들이받고 뒤로 튕긴다
 *
 * 바퀴가 미끄러지지 않는 이유
 * -------------------------
 * EnemyView 는 walk 을 `유닛 속도 / 50` 배속으로 돌린다. 그래서 클립 한 번에
 * 한 바퀴를 돌리면 **한 바퀴에 나아가는 거리는 속도와 무관하게 `50 x 클립 길이`** 다
 * (배속이 빠를수록 클립이 빨리 끝나므로 정확히 상쇄된다).
 * 그 거리를 바퀴 둘레와 같게 두면 어떤 속도에서도 구르는 대로 나아간다 —
 * 감속에 걸려 느려져도, 성문 앞에서 멈춰도 바퀴가 헛돌지 않는다.
 *
 *     클립 길이 = 2 x PI x 바퀴 반지름(world) / 50
 *
 * 바퀴 반지름은 **화면에서의** 크기라 units.ts 의 scale 이 곱해진 값이다.
 * 목우유마(1.45)와 공성 목우(1.5)가 같은 모델을 쓰므로 그 사이값으로 굽는다 —
 * 어긋남은 2% 로, 한 바퀴에 1u 도 안 된다.
 */
import { NodeIO, type Accessor, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Vec3 = [number, number, number];

export interface CartRigOptions {
  /** 완성 높이(world unit). units.ts 의 scale 이 여기에 곱해진다 */
  targetHeight: number;
  /** 모델이 바라보는 방향(도). +Z 가 정면이면 0 */
  forwardDeg: number;
  /**
   * 바퀴가 굴러갈 때의 화면 배율 — units.ts 의 scale.
   * 클립 길이(= 한 바퀴)를 정하는 데만 쓴다. 위 주석 참조.
   */
  unitScale: number;
  /**
   * 바퀴를 찾을 좌우 끝 대역 (폭 대비 비율).
   *
   * 바퀴는 수레에서 가장 바깥이다 — 축 밖으로 나온 바퀴통까지 들어오도록 넉넉히 잡되,
   * 짐칸 옆판까지 물면 짐칸이 통째로 돌아간다. 실측(목우유마): 0.18 에서
   * 바퀴 두 개가 각각 1,900여 정점, 짐칸은 한 정점도 딸려오지 않는다.
   */
  wheelBand?: number;
  /**
   * 원 중심에서 이 배율 밖의 정점은 바퀴가 아니라 틀로 본다.
   * 대역 안에는 바퀴만 있는 것이 아니라 수레 바닥판의 끝단도 들어온다.
   */
  wheelRadiusPad?: number;
  /** 성문을 들이받는 클립 길이(초). BALANCE.fx.castleAttackDuration 과 맞춘다 */
  attackDuration?: number;
}

// ── 최소한의 선형대수 ────────────────────────────────────────────────

/** X 축 둘레 회전 쿼터니언 (바퀴가 구르는 축) */
function quatX(a: number): number[] {
  return [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
}

/** Z 축 둘레 회전 쿼터니언 (수레가 좌우로 기우뚱하는 축) */
function quatZ(a: number): number[] {
  return [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
}

function floatAccessor(doc: Document, data: Float32Array, type: 'SCALAR' | 'VEC3' | 'VEC4'): Accessor {
  return doc
    .createAccessor()
    .setType(type)
    .setArray(data as Float32Array<ArrayBuffer>)
    .setBuffer(doc.getRoot().listBuffers()[0]);
}

interface TrackSpec {
  bone: string;
  path: 'rotation' | 'translation';
  times: number[];
  values: number[];
}

interface Wheel {
  name: string;
  /** 바퀴 중심 (축 방향 X 는 정점 평균, YZ 는 원 맞춤) */
  center: Vec3;
  /** 테두리 반지름 — 이 값이 굴림 거리를 정한다 */
  radius: number;
  members: number[];
}

/** 세 점의 외접원 — 거의 한 줄로 늘어선 세 점이면 null */
function circumcircle(
  ay: number, az: number, by: number, bz: number, cy: number, cz: number,
): { cy: number; cz: number; r: number } | null {
  const d = 2 * (ay * (bz - cz) + by * (cz - az) + cy * (az - bz));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = ay * ay + az * az;
  const b2 = by * by + bz * bz;
  const c2 = cy * cy + cz * cz;
  const uy = (a2 * (bz - cz) + b2 * (cz - az) + c2 * (az - bz)) / d;
  const uz = (a2 * (cy - by) + b2 * (ay - cy) + c2 * (by - ay)) / d;
  return { cy: uy, cz: uz, r: Math.hypot(ay - uy, az - uz) };
}

/**
 * (y, z) 평면에서 바퀴 테두리 원을 찾는다 — RANSAC.
 *
 * 최소제곱으로 한 번에 맞추면 안 된다. 바퀴 정점은 테두리에만 있는 게 아니라
 * 바큇살과 바퀴통에 몰려 있고, 대역 안에는 수레 바닥판 끝단도 섞여 있다.
 * 그 전부를 같은 무게로 맞추면 중심이 안쪽으로 끌려간다 — 실측으로 좌우 바퀴의
 * 중심이 반지름의 20%(모델 단위 0.085)만큼 어긋났고, 그 중심으로 돌리면
 * 바퀴가 축에서 벗어나 파도치듯 흔들린다.
 *
 * 세 점을 뽑아 외접원을 만들고 테두리에 붙은 정점(내점)을 세는 편이 정확하다.
 * 테두리는 완전한 원이라 표가 몰리고, 바큇살·바닥판은 표를 나눠 갖지 못한다.
 */
function fitWheel(
  P: Float32Array,
  idx: number[],
  seed: number,
): { cy: number; cz: number; radius: number; inliers: number; err: number } {
  let ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (const i of idx) {
    ymin = Math.min(ymin, P[i * 3 + 1]); ymax = Math.max(ymax, P[i * 3 + 1]);
    zmin = Math.min(zmin, P[i * 3 + 2]); zmax = Math.max(zmax, P[i * 3 + 2]);
  }
  const spread = Math.max(ymax - ymin, zmax - zmin);
  const tol = spread * 0.02;

  // 결정론 난수 — 같은 모델을 다시 구우면 같은 결과가 나와야 한다
  let s = seed >>> 0 || 1;
  const rnd = (): number => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const pick = (): number => idx[Math.floor(rnd() * idx.length) % idx.length];

  let best = { cy: 0, cz: 0, r: 0, votes: -1 };
  for (let it = 0; it < 4000; it++) {
    const a = pick(), b = pick(), c = pick();
    const circ = circumcircle(
      P[a * 3 + 1], P[a * 3 + 2], P[b * 3 + 1], P[b * 3 + 2], P[c * 3 + 1], P[c * 3 + 2],
    );
    // 대역 크기를 벗어나는 원은 세 점이 거의 일직선일 때 나오는 헛것이다
    if (!circ || circ.r < spread * 0.2 || circ.r > spread * 0.75) continue;
    let votes = 0;
    for (const i of idx) {
      if (Math.abs(Math.hypot(P[i * 3 + 1] - circ.cy, P[i * 3 + 2] - circ.cz) - circ.r) <= tol) votes++;
    }
    if (votes > best.votes) best = { cy: circ.cy, cz: circ.cz, r: circ.r, votes };
  }
  if (best.votes < 0) throw new Error('바퀴 테두리를 찾지 못했다');

  // 내점만으로 중심을 다듬는다 (기하 평균 반복 — 테두리에만 맞춘다)
  let { cy, cz, r } = best;
  for (let it = 0; it < 30; it++) {
    const ring = idx.filter((i) => Math.abs(Math.hypot(P[i * 3 + 1] - cy, P[i * 3 + 2] - cz) - r) <= tol * 1.5);
    if (ring.length < 20) break;
    let gy = 0, gz = 0, sr = 0;
    for (const i of ring) sr += Math.hypot(P[i * 3 + 1] - cy, P[i * 3 + 2] - cz);
    r = sr / ring.length;
    for (const i of ring) {
      const dy = P[i * 3 + 1] - cy;
      const dz = P[i * 3 + 2] - cz;
      const d = Math.hypot(dy, dz) || 1e-9;
      gy += (dy / d) * (d - r);
      gz += (dz / d) * (d - r);
    }
    cy += gy / ring.length;
    cz += gz / ring.length;
  }
  const ring = idx.filter((i) => Math.abs(Math.hypot(P[i * 3 + 1] - cy, P[i * 3 + 2] - cz) - r) <= tol * 1.5);
  const err = Math.sqrt(
    ring.reduce((acc, i) => acc + (Math.hypot(P[i * 3 + 1] - cy, P[i * 3 + 2] - cz) - r) ** 2, 0) / ring.length,
  );
  return { cy, cz, radius: r, inliers: ring.length, err };
}

export async function rigCart(input: string, output: string, opts: CartRigOptions): Promise<void> {
  const band = opts.wheelBand ?? 0.18;
  const pad = opts.wheelRadiusPad ?? 1.06;
  const attackDuration = opts.attackDuration ?? 0.75;

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(input);
  const root = doc.getRoot();
  const mesh = root.listMeshes()[0];
  const prim = mesh?.listPrimitives()[0];
  if (!prim) throw new Error('메시를 찾지 못했다');

  const posAcc = prim.getAttribute('POSITION')!;
  const n = posAcc.getCount();
  const P = new Float32Array(n * 3);
  const el = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    posAcc.getElement(i, el);
    P[i * 3] = el[0];
    P[i * 3 + 1] = el[1];
    P[i * 3 + 2] = el[2];
  }

  // ── 1. 정면을 +Z 로 돌린다 ──
  //
  // 매니페스트의 rotY 로 미루지 않고 여기서 굽는다. 클립이 "앞으로 들이받는다"를
  // 로컬 +Z 로 만들기 때문에, 모델과 클립의 앞이 어긋나면 옆으로 들이받는다.
  const th = (-opts.forwardDeg * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const rotY = (x: number, z: number): [number, number] => [x * cos + z * sin, -x * sin + z * cos];
  for (let i = 0; i < n; i++) {
    const [x, z] = rotY(P[i * 3], P[i * 3 + 2]);
    P[i * 3] = x;
    P[i * 3 + 2] = z;
  }
  const nrmAcc = prim.getAttribute('NORMAL');
  if (nrmAcc) {
    for (let i = 0; i < n; i++) {
      const e = nrmAcc.getElement(i, [0, 0, 0]);
      const [x, z] = rotY(e[0], e[2]);
      nrmAcc.setElement(i, [x, e[1], z]);
    }
  }

  // ── 2. 크기와 접지 ──
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], P[i * 3 + k]);
      max[k] = Math.max(max[k], P[i * 3 + k]);
    }
  }
  const scale = opts.targetHeight / (max[1] - min[1]);
  for (let i = 0; i < n; i++) {
    P[i * 3] *= scale;
    P[i * 3 + 1] = (P[i * 3 + 1] - min[1]) * scale;
    P[i * 3 + 2] *= scale;
  }
  const width = (max[0] - min[0]) * scale;
  const length = (max[2] - min[2]) * scale;
  console.log(
    `[cart] 크기 ${(max[1] - min[1]).toFixed(3)} -> ${opts.targetHeight}u (배율 ${scale.toFixed(2)})` +
      `  폭 ${width.toFixed(1)}u  길이 ${length.toFixed(1)}u`,
  );

  // ── 3. 바퀴 찾기 ──
  //
  // 바퀴는 축(X) 양 끝이다. 대역 안의 정점에 원을 맞춰 중심과 테두리 반지름을 얻고,
  // 그 원 밖(수레 바닥판 끝단)은 다시 틀로 돌려보낸다.
  const halfW = width / 2;
  const bands: { name: string; idx: number[]; fit: ReturnType<typeof fitWheel> }[] = [];
  for (const [k, [name, side]] of ([['wheelL', -1], ['wheelR', 1]] as const).entries()) {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = P[i * 3];
      if (side < 0 ? x < -halfW + width * band : x > halfW - width * band) idx.push(i);
    }
    if (idx.length < 50) throw new Error(`${name} 대역에 정점이 ${idx.length}개뿐이다 — wheel-band 를 넓힐 것`);
    const fit = fitWheel(P, idx, 1013 + k);
    console.log(
      `[cart] ${name} 테두리  중심(y ${fit.cy.toFixed(1)}, z ${fit.cz.toFixed(1)})  반지름 ${fit.radius.toFixed(1)}u` +
        `  테두리 정점 ${fit.inliers}  오차 ${fit.err.toFixed(2)}u`,
    );
    bands.push({ name, idx, fit });
  }

  /*
   * 두 바퀴는 하나의 축에 꿰여 있다 — 중심의 높이(y)와 앞뒤(z)가 같아야 한다.
   * 좌우를 따로 맞추면 감면이 깎아 낸 만큼(실측 반지름의 3%) 어긋나고,
   * 그 상태로 돌리면 한쪽이 땅을 파고 다른 쪽이 뜬다. 평균으로 축을 통일한다.
   */
  const axleY = (bands[0].fit.cy + bands[1].fit.cy) / 2;
  const axleZ = (bands[0].fit.cz + bands[1].fit.cz) / 2;
  const radius = (bands[0].fit.radius + bands[1].fit.radius) / 2;
  const drift = Math.hypot(bands[0].fit.cy - bands[1].fit.cy, bands[0].fit.cz - bands[1].fit.cz);
  console.log(
    `[cart] 축 (y ${axleY.toFixed(1)}, z ${axleZ.toFixed(1)})  반지름 ${radius.toFixed(1)}u` +
      `  좌우 어긋남 ${drift.toFixed(2)}u (반지름의 ${((drift / radius) * 100).toFixed(0)}%)`,
  );
  if (drift > radius * 0.15) {
    console.warn('[cart] 좌우 바퀴 중심이 너무 어긋난다 — wheel-band 를 다시 볼 것');
  }

  const wheels: Wheel[] = bands.map((b) => {
    const members = b.idx.filter(
      (i) => Math.hypot(P[i * 3 + 2] - axleZ, P[i * 3 + 1] - axleY) <= radius * pad,
    );
    let sx = 0;
    for (const i of members) sx += P[i * 3];
    return { name: b.name, center: [sx / members.length, axleY, axleZ] as Vec3, radius, members };
  });
  for (const [i, w] of wheels.entries()) {
    console.log(`[cart] ${w.name}  x ${w.center[0].toFixed(1)}u  정점 ${w.members.length}/${bands[i].idx.length}`);
  }

  /*
   * 바퀴가 돌 때 가장 낮아지는 점으로 다시 접지한다.
   *
   * 바인드 자세의 최저점만 보면 안 된다 — 테두리가 완전한 원이 아니라
   * (감면이 살을 깎는다) 도는 동안 몇 u 씩 더 내려간다. 그만큼 띄우지 않으면
   * 구를 때마다 바퀴가 길에 잠긴다.
   */
  let lowest = 0;
  for (const w of wheels) {
    let far = 0;
    for (const i of w.members) far = Math.max(far, Math.hypot(P[i * 3 + 2] - w.center[2], P[i * 3 + 1] - w.center[1]));
    lowest = Math.min(lowest, w.center[1] - far);
  }
  if (lowest < 0) {
    console.log(`[cart] 바퀴가 구르면 ${(-lowest).toFixed(2)}u 만큼 더 내려간다 — 그만큼 띄운다`);
    for (let i = 0; i < n; i++) P[i * 3 + 1] -= lowest;
    for (const w of wheels) w.center[1] -= lowest;
  }

  // ── 4. 뼈와 가중치 ──
  const bones: { name: string; head: Vec3 }[] = [
    { name: 'cart', head: [0, 0, 0] },
    ...wheels.map((w) => ({ name: w.name, head: w.center })),
  ];
  const joints = new Uint16Array(n * 4) as Uint16Array<ArrayBuffer>;
  const weights = new Float32Array(n * 4) as Float32Array<ArrayBuffer>;
  const owner = new Int32Array(n); // 0 = cart
  for (const [k, w] of wheels.entries()) for (const i of w.members) owner[i] = k + 1;
  const owned = new Array<number>(bones.length).fill(0);
  for (let i = 0; i < n; i++) {
    joints[i * 4] = owner[i];
    weights[i * 4] = 1;
    owned[owner[i]]++;
  }
  console.log(`[cart] 가중치 — 틀 ${owned[0]}, ${wheels.map((w, i) => `${w.name} ${owned[i + 1]}`).join(', ')}`);

  for (let i = 0; i < n; i++) posAcc.setElement(i, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
  prim.setAttribute('JOINTS_0', floatAccessor(doc, new Float32Array(joints), 'VEC4').setArray(joints));
  prim.setAttribute('WEIGHTS_0', floatAccessor(doc, weights, 'VEC4'));

  const nodeOf = new Map<string, Node>();
  const cartNode = doc.createNode('cart').setTranslation([0, 0, 0]);
  nodeOf.set('cart', cartNode);
  for (const w of wheels) {
    const nd = doc.createNode(w.name).setTranslation(w.center);
    cartNode.addChild(nd);
    nodeOf.set(w.name, nd);
  }

  // 바인드 포즈에 회전·스케일이 없으므로 역바인드는 -월드위치 평행이동이다
  const ibm = new Float32Array(bones.length * 16) as Float32Array<ArrayBuffer>;
  bones.forEach((b, i) => {
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.head[0], -b.head[1], -b.head[2], 1], i * 16);
  });
  const skin = doc
    .createSkin('cart_skin')
    .setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(root.listBuffers()[0]));
  for (const b of bones) skin.addJoint(nodeOf.get(b.name)!);
  skin.setSkeleton(cartNode);

  root.listScenes()[0].addChild(cartNode);
  let meshNode: Node | null = null;
  for (const nd of root.listNodes()) if (nd.getMesh() === mesh) meshNode = nd;
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
        doc.createAnimationChannel().setTargetNode(nodeOf.get(t.bone)!).setTargetPath(t.path).setSampler(sampler),
      );
    }
    console.log(`[cart] 클립 "${name}" 트랙 ${tracks.length}`);
  };

  /*
   * walk — 한 클립에 정확히 한 바퀴.
   *
   * 90도씩 다섯 점만 찍는다. 쿼터니언은 프레임 사이를 slerp 로 잇는데,
   * 180도를 한 번에 넘기면 어느 쪽으로 도는지 정해지지 않아 뒤로 굴러갈 수 있다.
   * 90도면 방향이 확정되고 등속이라 바퀴가 튀지 않는다.
   *
   * +X 축 둘레 양의 회전이 앞(+Z)으로 구르는 방향이다 — 바퀴 꼭대기가 +Z 로 간다.
   */
  const rWorld = ((wheels[0].radius + wheels[1].radius) / 2) * opts.unitScale;
  const walkDur = (2 * Math.PI * rWorld) / 50;
  console.log(
    `[cart] 바퀴 반지름 화면 ${rWorld.toFixed(1)}u (scale ${opts.unitScale}) -> 둘레 ${(2 * Math.PI * rWorld).toFixed(1)}u` +
      `  walk 길이 ${walkDur.toFixed(2)}초`,
  );

  const walkTracks: TrackSpec[] = [];
  const K = 4;
  const rollTimes: number[] = [];
  const rollValues: number[] = [];
  for (let k = 0; k <= K; k++) {
    rollTimes.push((walkDur * k) / K);
    rollValues.push(...quatX((Math.PI * 2 * k) / K));
  }
  for (const w of wheels) walkTracks.push({ bone: w.name, path: 'rotation', times: rollTimes, values: rollValues });

  /*
   * 굴러가는 수레의 덜컹거림 — 한 바퀴에 두 번 위아래로 튀고 좌우로 기우뚱한다.
   *
   * 바퀴만 돌리면 짐칸이 자로 잰 듯 미끄러져서 굴러가는 것으로 안 읽힌다.
   * 진폭은 높이의 0.8% 다. 이보다 크면 부서진 수레처럼 덜컹거린다.
   * 아래로는 내리지 않는다(0 ~ +bump) — 접지 아래로 내려가면 바퀴가 길에 잠긴다.
   */
  const bump = opts.targetHeight * 0.008;
  const bTimes: number[] = [];
  const bTrans: number[] = [];
  const bRot: number[] = [];
  const B = 8;
  for (let k = 0; k <= B; k++) {
    const u = k / B;
    bTimes.push(walkDur * u);
    bTrans.push(0, bump * (1 - Math.cos(u * Math.PI * 4)) * 0.5, 0);
    bRot.push(...quatZ(Math.sin(u * Math.PI * 2) * 0.012));
  }
  walkTracks.push({ bone: 'cart', path: 'translation', times: bTimes, values: bTrans });
  walkTracks.push({ bone: 'cart', path: 'rotation', times: bTimes, values: bRot });
  addClip('walk', walkTracks);

  /*
   * idle — 멈춰 선 수레.
   *
   * 바퀴 트랙을 빼면 walk 에서 멈춘 각도가 그대로 남아 기울어진 채로 굳는다.
   * 그래서 바인드 자세(회전 없음)를 명시적으로 한 번 찍어 되돌린다.
   * 짐칸은 아주 얕게 삐걱인다 — 완전히 굳어 있으면 화면에서 죽은 물건이 된다.
   */
  const idleTracks: TrackSpec[] = wheels.map((w) => ({
    bone: w.name,
    path: 'rotation' as const,
    times: [0, 2],
    values: [...quatX(0), ...quatX(0)],
  }));
  idleTracks.push({
    bone: 'cart',
    path: 'rotation',
    times: [0, 1, 2],
    values: [...quatZ(0), ...quatZ(0.006), ...quatZ(0)],
  });
  addClip('idle', idleTracks);

  /*
   * attack — 성문을 들이받는다.
   *
   * 사람은 무기를 내지르지만 수레는 제 몸이 무기다. 뒤로 살짝 물러났다가
   * 앞으로 밀고 들어가 부딪히고 튕겨 나온다. 부딪히는 순간은 클립의 53% —
   * BALANCE.fx.castleAttackImpactAt 이 그 지점에서 불꽃을 터뜨린다.
   * 바퀴도 같이 앞으로 굴렀다가 충돌 뒤 뒤로 튄다. 몸만 움직이면 얼음판에서
   * 밀린 것처럼 보인다.
   */
  const D = attackDuration;
  const lunge = opts.targetHeight * 0.22;
  const atkTimes = [0, D * 0.28, D * 0.53, D * 0.72, D];
  const push = [0, -lunge * 0.25, lunge, lunge * 0.35, 0];
  const attackTracks: TrackSpec[] = [
    { bone: 'cart', path: 'translation', times: atkTimes, values: push.flatMap((z) => [0, 0, z]) },
    {
      bone: 'cart',
      path: 'rotation',
      times: atkTimes,
      // 부딪히는 순간 앞이 들린다 (X 축 둘레로 뒤로 젖힌다)
      values: [0, -0.05, 0.09, 0.03, 0].flatMap((a) => quatX(a)),
    },
  ];
  for (const w of wheels) {
    attackTracks.push({
      bone: w.name,
      path: 'rotation',
      times: atkTimes,
      values: [0, -0.5, 1.9, 1.5, 0].flatMap((a) => quatX(a)),
    });
  }
  addClip('attack', attackTracks);

  mkdirSync(dirname(output), { recursive: true });
  await io.write(output, doc);
  console.log(`[cart] 저장: ${output} (${(statSync(output).size / 1048576).toFixed(2)} MB)`);
}

// ── CLI ───────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href &&
  argv.length >= 2 &&
  !argv[0].startsWith('--')
) {
  const flag = (name: string, def: number): number => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? Number(argv[i + 1]) : def;
  };
  await rigCart(argv[0], argv[1], {
    targetHeight: flag('height', 26),
    forwardDeg: flag('forward', 0),
    unitScale: flag('unit-scale', 1.475),
    wheelBand: flag('wheel-band', 0.18),
  });
}
