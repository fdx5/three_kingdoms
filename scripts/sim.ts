/**
 * npm run sim — 헤드리스 밸런스 러너.
 * three 없이 20웨이브를 끝까지 돌려 표를 출력한다.
 *
 *   npm run sim
 *   npm run sim -- --level 2
 *   npm run sim -- --level 2 --build archer --no-repair
 *
 * 옵션
 *   --level 1|2|<id>    돌릴 레벨 (기본 level01)
 *   --towers <n>        커버리지 좋은 자리부터 n개만 짓는다 (기본: 전부)
 *   --slots a,b,c       슬롯을 직접 지정 (레벨1은 slot_ 접두사 생략 가능)
 *   --build auto|archer|<id>,<id>,...
 *                       auto   = 좋은 자리에 궁노, 기병 직선에 철질려, 나머지에 벽력거
 *                       archer = 전부 궁노 망루 (속성을 무시했을 때를 재현)
 *                       또는 슬롯 순서대로 타워 id를 직접 나열
 *   --spots best|recommended
 *                       best        = 자유 배치에서 길을 고르게 덮는 자리를 스스로 고른다 (기본)
 *                       recommended = 레벨의 추천 자리 (자유 배치 이전 수치와 비교할 때)
 *   --upgrade greedy|none
 *   --no-repair         성벽 수리를 하지 않는다 (골드 소비처 효과 측정용)
 *   --cards greedy|boss|none
 *                       greedy = 쓸 만하면 바로, boss = 장수가 나왔을 때만 (기본 none)
 *   --seed <n>
 */
import { World } from '../src/sim/World';
import { getLevel, DEFAULT_LEVEL_ID, isTowerAvailable } from '../src/data/levels';
import { getTower, TOWERS } from '../src/data/towers';
import { getStratagem } from '../src/data/stratagems';
import { UNITS } from '../src/data/units';
import { BALANCE } from '../src/data/balance';
import { FIXED_DT } from '../src/core/Loop';
import { spotKey } from '../src/sim/Placement';

interface Args {
  level: string;
  towers: number;
  slots: string[] | null;
  /**
   * 어느 자리에 지을 것인가.
   *   best         자유 배치에서 길을 고르게 덮는 자리를 스스로 고른다 (기본값)
   *   recommended  레벨이 적어 둔 추천 자리 (자유 배치 이전의 실측치와 비교할 때)
   *
   * 기본값이 best 인 이유: 타워를 빈 땅 아무 데나 세우게 된 뒤로 "레벨이 정해 준
   * 자리에만 짓는 플레이"는 더 이상 기준이 아니다. 사람은 자리를 고르고,
   * 그 고름이 곧 이 게임의 실력이다. 조합(어느 타워를 몇 기)은 추천 자리 기준
   * 계획을 그대로 쓰므로, 두 모드의 차이는 오직 **자리**뿐이다.
   */
  spots: 'recommended' | 'best';
  build: string;
  upgrade: 'greedy' | 'none';
  repair: boolean;
  /** 대기 중이면 항상 조기 소집 (숙련자 플레이) */
  early: boolean;
  /** 도사를 우선 노리도록 타게팅을 strongest로 (레벨 2의 도사 대응) */
  focusHealer: boolean;
  /**
   * 계략 사용 방식.
   *   none   안 쓴다
   *   greedy 쓸 만한 상황이면 바로 쓴다 (헤픈 플레이 = 계략 값의 하한)
   *   boss   장수가 경로에 있을 때만 쓴다 (아껴 쓰는 플레이)
   */
  cards: 'greedy' | 'boss' | 'none';
  /**
   * 성문 강화 방식.
   *   none   안 올린다 (성문 강화의 값을 재는 대조군)
   *   greedy 살 수 있으면 바로 올린다
   *   after  타워를 다 세우고 남는 돈으로만 올린다 (사람이 하는 판단에 가깝다)
   */
  gate: 'greedy' | 'after' | 'none';
  seed: number;
}

const DEFAULTS: Args = {
  level: DEFAULT_LEVEL_ID,
  towers: 99,
  slots: null,
  spots: 'best',
  build: 'auto',
  upgrade: 'greedy',
  repair: true,
  early: false,
  focusHealer: false,
  cards: 'none',
  gate: 'after',
  seed: 1,
};

function parseArgs(argv: string[]): Args {
  const a: Args = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--level') { a.level = /^\d+$/.test(v) ? `level0${v}` : v; i++; }
    else if (k === '--towers') { a.towers = Number(v); i++; }
    else if (k === '--slots') { a.slots = v.split(','); i++; }
    else if (k === '--build') { a.build = v; i++; }
    else if (k === '--upgrade') { a.upgrade = v === 'none' ? 'none' : 'greedy'; i++; }
    else if (k === '--no-repair') { a.repair = false; }
    else if (k === '--early') { a.early = true; }
    else if (k === '--focus-healer') { a.focusHealer = true; }
    else if (k === '--cards') { a.cards = v === 'greedy' ? 'greedy' : v === 'boss' ? 'boss' : 'none'; i++; }
    else if (k === '--gate') { a.gate = v === 'greedy' ? 'greedy' : v === 'none' ? 'none' : 'after'; i++; }
    else if (k === '--no-gate') { a.gate = 'none'; }
    else if (k === '--spots') { a.spots = v === 'best' ? 'best' : 'recommended'; i++; }
    else if (k === '--seed') { a.seed = Number(v); i++; }
  }
  return a;
}

/** 추천 자리 id를 관대하게 해석한다 (레벨1의 'a' -> 'slot_a') */
function resolveSlotId(world: World, raw: string): string {
  const ids = world.level.buildSlots.map((s) => s.id);
  if (ids.includes(raw)) return raw;
  for (const id of ids) {
    if (id.endsWith(`_${raw}`)) return id;
  }
  return raw;
}

interface SpotRank {
  id: string;
  x: number;
  z: number;
  cover: number;
  /** 사거리 175(화포) 기준 커버리지. 사거리가 곧 성능인 자리를 가려낸다. */
  coverLong: number;
  /** 경로상 위치 (앞쪽일수록 작다) */
  along: number;
}

function rankOf(world: World, id: string, x: number, z: number): SpotRank {
  return {
    id,
    x,
    z,
    cover: world.path.lengthWithinRadius(x, z, 100),
    coverLong: world.path.lengthWithinRadius(x, z, 175),
    along: world.path.nearestDistance(x, z),
  };
}

/** 사거리 100 기준 커버리지가 큰 자리부터 = 좋은 자리부터 */
function rankRecommended(world: World): SpotRank[] {
  return world.level.buildSlots
    .map((s) => rankOf(world, s.id, s.x, s.z))
    .sort((p, q) => q.cover - p.cover || p.id.localeCompare(q.id));
}

/**
 * 자유 배치에서 "사람이 고를 만한 가장 좋은 자리들"을 뽑는다.
 *
 * 커버리지가 큰 자리부터 집으면 안 된다 — 경로가 가장 굽은 한 곳에 전부 몰려서,
 * 그 구간만 두껍고 나머지는 텅 빈 배치가 나온다(실측: 그렇게 뽑으면 2·3장이
 * 오히려 추천 자리보다 일찍 무너진다). 사람은 그렇게 짓지 않는다.
 *
 * 그래서 **아직 아무도 못 덮은 길을 가장 많이 덮는 자리**를 차례로 집는다
 * (탐욕적 집합 덮기). 앞의 타워가 이미 덮은 구간은 다음 자리를 고를 때
 * 값이 깎이므로, 자연히 경로를 따라 퍼진다.
 */
function rankBest(world: World, count: number): SpotRank[] {
  const step = 20;
  const range = 100;
  // 경로를 10유닛 간격으로 찍은 점들 — 이 점들을 덮는 문제로 바꾼다.
  const samples: { x: number; z: number }[] = [];
  for (let d = 0; d <= world.path.totalLength; d += 10) {
    const p = world.path.positionAt(d, { x: 0, z: 0 });
    samples.push({ x: p.x, z: p.z });
  }
  const covered = new Array<boolean>(samples.length).fill(false);

  const candidates: SpotRank[] = [];
  for (let x = step; x < BALANCE.mapWidth; x += step) {
    for (let z = step; z < BALANCE.mapDepth; z += step) {
      if (world.canBuildAt(x, z) !== 'ok') continue;
      const r = rankOf(world, `${x},${z}`, x, z);
      if (r.cover > 0) candidates.push(r);
    }
  }

  const picked: SpotRank[] = [];
  while (picked.length < count) {
    let best: SpotRank | null = null;
    let bestGain = 0;
    for (const c of candidates) {
      if (picked.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < BALANCE.placement.towerSpacing)) continue;
      let gain = 0;
      for (let i = 0; i < samples.length; i++) {
        if (covered[i]) continue;
        if (Math.hypot(samples[i].x - c.x, samples[i].z - c.z) <= range) gain++;
      }
      // 동률이면 커버리지가 큰 쪽, 그다음 id 순 — 결정론을 지킨다.
      if (gain > bestGain || (gain === bestGain && best && gain > 0 && c.cover > best.cover)) {
        bestGain = gain;
        best = c;
      }
    }
    if (!best || bestGain === 0) break;
    for (let i = 0; i < samples.length; i++) {
      if (!covered[i] && Math.hypot(samples[i].x - best.x, samples[i].z - best.z) <= range) covered[i] = true;
    }
    picked.push(best);
  }
  return picked;
}

/**
 * 자리별로 지을 타워를 정한다.
 * auto 전략: 커버리지가 높은 자리에는 궁노 망루(지속 피해),
 * 낮은 자리에는 벽력거와 철질려를 번갈아 — 나쁜 자리는 "오래 때리는" 값이 낮으므로
 * 한 방이 크거나(투석) 남을 돕는(감속) 타워가 맞다.
 */
const TOWER_ALIAS: Record<string, string> = {
  archer: 'archer_tower',
  bow: 'archer_tower',
  cat: 'catapult',
  catapult: 'catapult',
  caltrop: 'caltrop_camp',
  slow: 'caltrop_camp',
  fire: 'fire_tower',
  flame: 'fire_tower',
  cannon: 'cannon_tower',
  gun: 'cannon_tower',
};

function resolveTowerId(raw: string): string {
  return TOWER_ALIAS[raw] ?? raw;
}

function planBuilds(ranked: SpotRank[], build: string, levelId: string): Map<string, string> {
  const plan = new Map<string, string>();
  // 그 레벨에서 아직 해금되지 않은 타워는 계획에 넣지 않는다 —
  // 넣으면 World.build가 'locked'를 돌려주고 건설 큐가 그대로 막힌다.
  const available = new Set(
    Object.values(TOWERS)
      .filter((t) => isTowerAvailable(t.unlockedIn, levelId))
      .map((t) => t.id),
  );

  // 슬롯별 명시 지정:  --build s2_a=archer,s2_d=caltrop
  if (build.includes('=')) {
    for (const r of ranked) plan.set(r.id, 'archer_tower');
    for (const pair of build.split(',')) {
      const [slot, tower] = pair.split('=');
      const id = resolveTowerId(tower);
      if (available.has(id)) plan.set(slot, id);
    }
    return plan;
  }

  if (build !== 'auto' && build !== 'archer') {
    const ids = build.split(',').map(resolveTowerId).filter((id) => available.has(id));
    if (ids.length === 0) ids.push('archer_tower');
    ranked.forEach((r, i) => plan.set(r.id, ids[i % ids.length]));
    return plan;
  }
  if (build === 'archer' || !available.has('catapult')) {
    for (const r of ranked) plan.set(r.id, 'archer_tower');
    return plan;
  }

  // 커버리지가 높은 자리는 지속 피해(궁노)가 값을 한다.
  // 4장부터는 궁노 하나가 화공 망루로 바뀐다 — 등갑·백이 같은 원거리 저항 유닛이
  // 섞여 나오는 장에서 궁노만 늘어놓으면 좋은 자리가 오히려 손해가 되기 때문이다.
  /*
   * 300u 이상이 "좋은 자리"지만, 4장처럼 좋은 자리가 아예 없는 맵도 있다.
   * 그때도 상대적으로 나은 두 자리는 지속 피해가 맡아야 한다 —
   * 없으면 전 슬롯이 벽력거가 되어 사람이 하지 않을 배치를 재게 된다.
   */
  const good = ranked.filter((r) => r.cover >= 300);
  if (good.length < 2) {
    for (const r of ranked) {
      if (good.length >= 2) break;
      if (!good.includes(r)) good.push(r);
    }
  }
  good.forEach((r, i) => plan.set(r.id, i === 1 && available.has('fire_tower') ? 'fire_tower' : 'archer_tower'));

  /*
   * 나쁜 자리는 한 방이 크거나(벽력거·화포) 남을 돕는(철질려) 타워가 맞다.
   * 철질려는 하나만, 그리고 경로상 가장 앞쪽에 — 감속은 뒤쪽 타워에 시간을 벌어주는 것이라
   * 마지막 슬롯에 두면 아무도 그 효과를 쓰지 못한다.
   *
   * "커버리지가 낮다"에는 두 가지가 섞여 있다. 정말 경로에서 먼 자리와,
   * 사거리 100으로만 못 닿는 자리다. 후자(5장의 s5_d 같은)는 사거리 175짜리
   * 화포를 두면 좋은 자리로 바뀌므로, 사거리 175 커버리지가 큰 순서로 화포를 배정한다.
   */
  const poor = ranked.filter((r) => !good.includes(r)).sort((p, q) => p.along - q.along);
  const longRange = new Set(
    [...poor]
      .sort((p, q) => q.coverLong - p.coverLong)
      .slice(0, available.has('cannon_tower') ? Math.ceil(poor.length / 2) : 0)
      .map((r) => r.id),
  );
  poor.forEach((r, i) => {
    if (i === 0) return void plan.set(r.id, 'caltrop_camp');
    plan.set(r.id, longRange.has(r.id) ? 'cannon_tower' : 'catapult');
  });
  return plan;
}

export interface WaveRow {
  wave: number;
  enemies: number;
  minionHp: number;
  goldEnd: number;
  castleHp: number;
  leaks: number;
}

export interface SimResult {
  levelId: string;
  rows: WaveRow[];
  won: boolean;
  castleHp: number;
  castleMaxHp: number;
  leaks: number;
  kills: number;
  gold: number;
  goldEarned: number;
  repaired: number;
  towerLevels: Record<string, number>;
  towerKinds: Record<string, string>;
  elapsed: number;
  lastWave: number;
  /** 유닛별 누수 수 — 무엇이 뚫었는지가 밸런스 판단의 핵심이다 */
  leaksByUnit: Record<string, number>;
  /** 마지막 웨이브 스폰이 끝난 시점의 성 체력 (그 뒤 정리 구간에서 깎인 양을 보려고) */
  castleHpAtLastSpawn: number;
  /** 계략 id -> 사용 횟수 */
  cardsUsed: Record<string, number>;
  /** 계략에 쓴 총 골드 */
  goldOnCards: number;
  /** 끝났을 때의 성문 강화 단계 (1이면 한 번도 안 올렸다) */
  castleLevel: number;
  gateUpgrades: number;
  /** 성문 강화에 쓴 총 골드 */
  goldOnGate: number;
  /** 습격조에게 무너진 망루 수 — 공성전이 얼마나 세게 물렸는지의 척도다 */
  towersLost: number;
  /** 망루 수리 횟수와 거기 쓴 골드 */
  towerRepairs: number;
  goldOnTowerRepair: number;
  /** 망루가 받은 총 피해 */
  towerDamageTaken: number;
}

/** 다음 업그레이드를 살 돈. 수리와 계략은 이걸 남기고 남는 골드로만 쓴다. */
function upgradeReserve(world: World): number {
  const next = Math.min(
    ...[...world.towers.values()]
      .filter((t) => !t.isMaxLevel)
      .map((t) => t.nextUpgradeCost ?? Infinity),
    Infinity,
  );
  return Number.isFinite(next) ? next : 0;
}

/**
 * 계략을 쓸 만한 상황인가 — 지금 경로 위에 남은 적 체력의 합으로 잰다.
 *
 * "적 N기 이상"으로 두면 1파의 보병 9기에 화공을 던지고, 여포 한 기에는 안 쓴다.
 * 체력 합으로 재면 큰 웨이브와 장수 양쪽에 자연스럽게 걸린다.
 * 사람이 아껴 쓰는 것보다는 헤프므로, 여기서 나온 값은 계략의 하한이다.
 */
const MIN_FIELD_HP: Record<string, number> = {
  fire_storm: 900,
  ice_storm: 700,
  rally: 900,
};

/**
 * 이 비율 아래로 깎이면 고친다.
 *
 * 절반쯤에서 고치는 것이 값이 가장 싸다: 한 번 수리로 채울 수 있는 양이
 * 최대 체력의 절반(BALANCE.towerCombat.repairFraction)이라, 더 기다리면
 * 한 번으로 못 채우고 더 일찍 고치면 채울 자리가 없어 낭비된다.
 */
const TOWER_REPAIR_AT = 0.55;
/** 이 아래로는 예산을 깨고라도 고친다 — 여기서 더 맞으면 그냥 사라진다. */
const TOWER_REPAIR_URGENT = 0.25;

function liveEnemyHp(world: World): number {
  let sum = 0;
  for (const e of world.enemies) if (e.alive) sum += e.hp;
  return sum;
}

export function runSim(args: Partial<Args> = {}): SimResult {
  const a: Args = { ...DEFAULTS, ...args };
  const level = getLevel(a.level);
  const world = new World({ level, seed: a.seed });

  /*
   * 어디에 지을 것인가. 자유 배치가 된 뒤로도 기본값은 **추천 자리**다 —
   * 여섯 장의 밸런스 실측치가 전부 그 자리를 전제로 쌓여 있어서, 기본값을
   * 바꾸면 과거 수치와 비교할 수 없게 된다. `--spots best` 는 자유 배치에서
   * 최선을 다한 배치가 얼마나 더 센지를 재는 쪽이다.
   */
  const budget = Math.min(a.towers, world.maxTowers);
  const recommended = rankRecommended(world);
  // --slots 는 추천 자리를 이름으로 고르는 옵션이므로 그때는 자동 배치를 쓰지 않는다.
  const useBest = a.spots === 'best' && !a.slots;
  const ranked = useBest ? rankBest(world, budget) : recommended;
  const chosen = a.slots
    ? a.slots
        .map((raw) => resolveSlotId(world, raw))
        .map((id) => ranked.find((r) => r.id === id))
        .filter((r): r is SpotRank => !!r)
    : ranked.slice(0, budget);
  /*
   * 자유 배치(best)에서도 **조합은 추천 자리의 것을 그대로** 쓴다.
   *
   * planBuilds 는 "커버리지 300 이상이면 좋은 자리"라는 기준으로 타워 종류를 나눈다.
   * 자유 배치에서는 고른 자리가 전부 좋은 자리라 그 기준이 무너져 전 슬롯이 궁노가 되고,
   * 그러면 2·6장이 방패병·백이병에 뚫려 진다 — 그건 배치의 값이 아니라
   * "전부 궁노면 진다"는 원래의 교훈이다. 자리만 갈아 끼워야 배치의 값이 보인다.
   */
  const plan =
    useBest
      ? new Map(
          [...planBuilds(recommended, a.build, level.id).values()]
            .slice(0, ranked.length)
            .map((towerId, i) => [ranked[i].id, towerId] as const),
        )
      : planBuilds(ranked, a.build, level.id);

  const rows: WaveRow[] = [];
  let leaksAtWaveStart = 0;
  let repaired = 0;
  let towersLost = 0;
  let towerRepairs = 0;
  let goldOnTowerRepair = 0;
  let towerDamageTaken = 0;
  const leaksByUnit: Record<string, number> = {};
  let castleHpAtLastSpawn = level.castle.hp;

  world.bus.on('tower:destroyed', () => {
    towersLost++;
  });
  world.bus.on('tower:damaged', ({ amount }) => {
    towerDamageTaken += amount;
  });

  world.bus.on('enemy:leaked', ({ unitId }) => {
    leaksByUnit[unitId] = (leaksByUnit[unitId] ?? 0) + 1;
  });
  world.bus.on('wave:cleared', ({ index }) => {
    if (index === level.waves.length) castleHpAtLastSpawn = world.castle.hp;
  });

  // 웨이브별 "기본 보병"의 체력 — 레벨마다 기본 유닛이 다르다
  const baseUnitId = level.waves[0].spawns[0].unitId;

  world.bus.on('wave:cleared', (e) => {
    const wave = level.waves[e.index - 1];
    const minion = wave.spawns.find((s) => s.unitId === baseUnitId);
    const baseHp = UNITS[baseUnitId]?.hp ?? 0;
    rows.push({
      wave: e.index,
      enemies: wave.spawns.length,
      minionHp: Math.round(baseHp * (minion?.hpMul ?? 1)),
      goldEnd: world.economy.gold,
      castleHp: world.castle.hp,
      leaks: world.leaks - leaksAtWaveStart,
    });
    leaksAtWaveStart = world.leaks;
  });

  const buildQueue = [...chosen];

  /*
   * 무너진 망루는 다시 세운다.
   *
   * 공성전이 들어오기 전에는 이 줄이 필요 없었다 — 망루는 부서지지 않았고,
   * 건설 대기열은 판이 시작될 때 한 번 비면 끝이었다. 지금은 습격조가 망루를
   * 부수므로, 다시 세우지 않는 봇은 "한 번 뚫리면 빈손으로 남은 웨이브를 맞는"
   * 특이한 플레이가 된다. 사람은 누구도 그렇게 하지 않는다.
   *
   * 다시 세우면 레벨은 1부터다(투자액은 돌아오지 않는다). 그래서 이건 봇을
   * 강하게 만드는 장치가 아니라 **망루를 잃는 값을 제대로 재는** 장치다.
   */
  const spotBySlot = new Map<string, SpotRank>();
  for (const r of chosen) spotBySlot.set(spotKey(r.x, r.z), r);
  world.bus.on('tower:destroyed', ({ slotId }) => {
    const spot = spotBySlot.get(slotId);
    if (spot && !buildQueue.includes(spot)) buildQueue.push(spot);
  });

  const cardsUsed: Record<string, number> = {};
  let goldOnCards = 0;
  let gateUpgrades = 0;
  let goldOnGate = 0;

  /**
   * 타워의 자리 id(좌표) -> 계획상의 이름.
   *
   * 자유 배치에서 타워 id 는 좌표라 문자열 순서에 의미가 없다. 업그레이드 순서의
   * 동률은 예전처럼 **계획의 이름 순**으로 가른다 — 추천 자리를 쓰면 그 이름이
   * 곧 슬롯 id(s2_a, s2_b...)이므로, 여섯 장의 과거 실측치가 그대로 재현된다.
   */
  const planName = new Map<string, string>();
  for (const r of ranked) planName.set(spotKey(r.x, r.z), r.id);

  // 도사 대응: 궁노 망루를 strongest로 바꾸면 체력이 높은 도사·방패병을 먼저 노린다.
  if (a.focusHealer) {
    world.bus.on('tower:built', ({ slotId, towerId }) => {
      if (towerId === 'archer_tower') world.setTargeting(slotId, 'strongest');
    });
  }

  const maxSteps = Math.ceil((60 * 60) / FIXED_DT); // 60분 안전 상한
  let steps = 0;
  while (world.over === 'none' && steps < maxSteps) {
    // 1) 건설 — 계획된 타워를 살 수 있게 되면 짓는다
    while (buildQueue.length > 0) {
      const spot = buildQueue[0];
      const towerId = plan.get(spot.id) ?? 'archer_tower';
      if (!world.economy.canAfford(getTower(towerId).buildCost)) break;
      if (world.build(spot, towerId) !== 'ok') break;
      buildQueue.shift();
    }

    // 2) 업그레이드 — 가장 레벨이 낮은 타워부터 균등하게
    if (a.upgrade === 'greedy' && buildQueue.length === 0) {
      let progressed = true;
      while (progressed) {
        progressed = false;
        const towers = [...world.towers.values()]
          .filter((t) => !t.isMaxLevel)
          .sort(
            (p, q) =>
              p.level - q.level ||
              (planName.get(p.slotId) ?? p.slotId).localeCompare(planName.get(q.slotId) ?? q.slotId),
          );
        for (const t of towers) {
          const cost = t.nextUpgradeCost;
          if (cost !== null && world.economy.canAfford(cost) && world.upgrade(t.slotId) === 'ok') {
            progressed = true;
            break;
          }
        }
      }
    }

    // 2.5) 성문 강화 — 4장부터. 타워를 다 세운 뒤 남는 돈으로 올린다(기본 after).
    //      성문은 팔 수 없으므로 "타워보다 먼저 사면 손해"인지가 이 옵션으로 측정된다.
    if (a.gate !== 'none' && level.castleUpgrade) {
      const ready = a.gate === 'greedy' || buildQueue.length === 0;
      while (ready && world.castleUpgradeStatus() === 'ok') {
        const cost = world.castle.nextUpgradeCost ?? 0;
        // 타워 업그레이드 예산을 남기고도 살 수 있을 때만
        if (world.economy.gold < upgradeReserve(world) + cost) break;
        if (world.upgradeCastle() !== 'ok') break;
        gateUpgrades++;
        goldOnGate += cost;
      }
    }

    // 3) 성벽 수리 — 웨이브 사이에, 다음 업그레이드를 살 돈을 남기고도 여유가 있을 때.
    //    사람이 하는 판단을 흉내낸 것이다. "만렙이 된 뒤에만 수리"로 두면
    //    실제 플레이보다 훨씬 적게 고쳐서 수리의 값을 과소평가하게 된다.
    if (a.repair && buildQueue.length === 0) {
      const quote = world.repairQuote();
      if (quote && world.economy.gold >= upgradeReserve(world) + quote.cost) {
        repaired += world.repairCastle();
      }
    }

    /*
     * 3.5) 망루 수리 — 가장 많이 깎인 것부터.
     *
     * 순서가 중요하다. 이 단계는 건설·업그레이드·성문 강화 **다음**이고, 남는
     * 골드로만 한다. 반대로 두면(수리를 먼저) 4~6장에서 성문 강화가 영영 밀려
     * 그 장의 교훈("성문을 안 올리면 진다")이 수리 정책의 부작용으로 뒤집힌다.
     *
     * 무너지기 직전(urgentAt)만 예외다. 그때는 예산을 깨고 고친다 — 망루 하나를
     * 통째로 잃는 것은 업그레이드 한 번을 미루는 것과 비교가 안 되기 때문이다.
     */
    if (a.repair) {
      const hurt = [...world.towers.values()]
        .filter((t) => t.hpRatio <= TOWER_REPAIR_AT)
        .sort((p, q) => p.hpRatio - q.hpRatio || p.slotId.localeCompare(q.slotId));
      const gateCost = level.castleUpgrade ? world.castle.nextUpgradeCost ?? 0 : 0;
      for (const t of hurt) {
        if (world.repairTowerStatus(t.slotId) !== 'ok') continue;
        const cost = t.repairCost;
        const urgent = t.hpRatio <= TOWER_REPAIR_URGENT;
        const reserve = upgradeReserve(world) + gateCost;
        if (!urgent && world.economy.gold < reserve + cost) continue;
        if (world.repairTower(t.slotId) <= 0) continue;
        towerRepairs++;
        goldOnTowerRepair += cost;
      }
    }

    // 4) 계략 — 업그레이드 예산을 남기고, 쓸 만큼 적이 모였을 때만.
    //    "쿨다운이 돌면 무조건"으로 두면 1파에 매복을 던지는 식이라
    //    계략의 값이 아니라 낭비를 측정하게 된다. 사람이 하는 판단의 하한이다.
    // 아직 못 지은 슬롯이 있으면 계략을 사지 않는다.
    // 골드가 빠듯한 레벨(레벨 3)에서는 카드 한 장이 타워 한 기라, 이 순서를 지켜야
    // "계략이 손해"가 아니라 "계략은 남는 돈으로 쓰는 것"이 측정된다.
    if (a.cards !== 'none' && buildQueue.length === 0) {
      const reserve = upgradeReserve(world);
      const fieldHp = liveEnemyHp(world);
      // boss 정책은 장수(elite/boss)가 경로에 있을 때까지 아낀다
      const bossOnField = a.cards === 'boss' && world.enemies.some((e) => e.alive && e.kind !== 'minion');
      for (const st of world.stratagems) {
        if (a.cards === 'boss' && !bossOnField) break;
        if (world.stratagemStatus(st.id) !== 'ok') continue;
        if (world.economy.gold < reserve + st.cost) continue;
        if (a.cards === 'greedy' && fieldHp < MIN_FIELD_HP[st.effect.type]) continue;
        cardsUsed[st.id] = (cardsUsed[st.id] ?? 0) + 1;
        goldOnCards += st.cost;
        world.castStratagem(st.id);
      }
    }

    // 5) 조기 소집 — 남은 대기 시간만큼 골드를 즉시 받는다.
    //    웨이브가 겹치므로 공짜가 아니다: 처리 속도가 모자라면 그대로 누수가 된다.
    if (a.early) world.callWaveEarly();

    world.step(FIXED_DT);
    steps++;
  }

  const stats = world.stats();
  const towerKinds: Record<string, string> = {};
  for (const [id, t] of world.towers) towerKinds[id] = t.def.id;

  return {
    levelId: level.id,
    rows,
    won: world.over === 'won',
    castleHp: stats.castleHp,
    castleMaxHp: stats.castleMaxHp,
    leaks: stats.leaks,
    kills: stats.kills,
    gold: stats.goldLeft,
    goldEarned: stats.goldEarned,
    repaired,
    towerLevels: stats.towerLevels,
    towerKinds,
    elapsed: stats.elapsed,
    lastWave: world.waveRunner.displayIndex,
    leaksByUnit,
    castleHpAtLastSpawn,
    cardsUsed,
    goldOnCards,
    castleLevel: world.castle.level,
    gateUpgrades,
    goldOnGate,
    towersLost,
    towerRepairs,
    goldOnTowerRepair,
    towerDamageTaken: Math.round(towerDamageTaken),
  };
}

function pad(s: string | number, n: number): string {
  const str = String(s);
  return ' '.repeat(Math.max(0, n - str.length)) + str;
}

const TOWER_SHORT: Record<string, string> = {
  archer_tower: '궁노',
  catapult: '벽력',
  caltrop_camp: '질려',
  fire_tower: '화공',
  cannon_tower: '화포',
};

function main(): void {
  const a = parseArgs(process.argv.slice(2));
  const level = getLevel(a.level);
  const r = runSim(a);

  console.log('');
  console.log(`레벨: ${level.title}   (성 체력 ${level.castle.hp}, 시작골드 ${level.startGold})`);
  console.log(
    `전략: ${a.slots ? a.slots.join(',') : a.towers >= 90 ? '전 슬롯' : a.towers + '기'}` +
      ` / 배치 ${a.build} / 업그레이드 ${a.upgrade}` +
      ` / 수리 ${a.repair ? 'on' : 'off'} / 계략 ${a.cards}` +
      `${level.castleUpgrade ? ` / 성문 ${a.gate}` : ''} / seed ${a.seed}`,
  );
  console.log('');
  console.log('  웨이브  적수   보병HP     종료골드   성체력   누수');
  console.log('  ------  ----  --------  ---------  -------  ----');
  for (const row of r.rows) {
    console.log(
      `  ${pad(row.wave, 6)}  ${pad(row.enemies, 4)}  ${pad(row.minionHp, 8)}` +
        `  ${pad(row.goldEnd, 9)}  ${pad(row.castleHp, 7)}  ${pad(row.leaks, 4)}`,
    );
  }
  console.log('');
  const towers = Object.keys(r.towerLevels)
    .sort()
    .map((id) => {
      const short = TOWER_SHORT[r.towerKinds[id]] ?? r.towerKinds[id];
      return `${id.replace(/^s(lot)?2?_/, '')}:${short}${r.towerLevels[id]}`;
    })
    .join('  ');
  console.log(r.won ? '  === VICTORY ===' : `  === DEFEAT (제 ${r.lastWave}파) ===`);
  console.log(
    `  성 체력 ${r.castleHp}/${r.castleMaxHp}   누수 ${r.leaks}   처치 ${r.kills}` +
      `   남은 골드 ${r.gold}` +
      (r.repaired > 0 ? `   수리 ${r.repaired}HP` : ''),
  );
  console.log(`  타워 ${towers || '(없음)'}`);
  console.log(
    `  공성 망루 파괴 ${r.towersLost}   수리 ${r.towerRepairs}회 (${r.goldOnTowerRepair} G)` +
      `   망루가 받은 피해 ${r.towerDamageTaken}`,
  );
  if (r.goldOnCards > 0) {
    const used = Object.entries(r.cardsUsed)
      .map(([id, n]) => `${getStratagem(id).displayName} x${n}`)
      .join(', ');
    console.log(`  계략 ${used}   (${r.goldOnCards} G)`);
  }
  const leakDetail = Object.entries(r.leaksByUnit)
    .sort((p, q) => q[1] - p[1])
    .map(([id, n]) => `${UNITS[id]?.displayName ?? id} x${n}`)
    .join(', ');
  if (level.castleUpgrade) {
    console.log(`  성문 Lv${r.castleLevel} (강화 ${r.gateUpgrades}회, ${r.goldOnGate} G)`);
  }
  if (leakDetail) console.log(`  누수 내역 ${leakDetail}`);
  console.log(
    `  마지막 스폰 시점 성 체력 ${r.castleHpAtLastSpawn}` +
      ` -> 정리 구간에서 ${r.castleHpAtLastSpawn - r.castleHp} 손실`,
  );
  console.log(`  소요 시뮬 시간 ${r.elapsed.toFixed(1)}초`);
  console.log('');
}

// tsx로 직접 실행될 때만 표를 출력한다 (vitest에서 import될 때는 조용히).
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/sim.ts');
if (invokedDirectly) main();
