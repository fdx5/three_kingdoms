import type { WaveDef, WaveSpawn } from '../types/level';
import { BALANCE } from './balance';

export interface WaveInsert {
  unitId: string;
  /** 0~1. 그 웨이브 스폰 구간의 어느 시점에 끼워 넣을지 */
  atRatio: number;
  /**
   * 보스 원본 스탯에 적용할 개별 배율. 웨이브 성장률과는 중복되지 않는다.
   * 그 위에 전역 BALANCE.difficulty.bossHpMul 이 Enemy.init 에서 다시 곱해진다.
   */
  hpMul?: number;
  speedMul?: number;
}

/**
 * 웨이브 구성 요소. from 웨이브부터 등장하며, weight 비율로 자리를 나눠 갖는다.
 * 예) 보병 weight 10 + 기병 weight 3 이면 13기 중 10:3 으로 섞인다.
 */
export interface MixEntry {
  unitId: string;
  /** 이 유닛이 처음 등장하는 웨이브 (1-base) */
  from: number;
  /** 비율 가중치 */
  weight: number;
  /** 이 웨이브를 넘으면 더 이상 나오지 않는다 (선택) */
  until?: number;
}

/**
 * 특정 웨이브의 연출과 난이도를 바꾸는 변주.
 * groupSize가 있으면 적을 일정한 부대로 묶고, 부대 사이에 groupGap만큼 숨을 둔다.
 */
export interface WavePattern {
  /** 기본 병력 수에 곱하는 값. 최소 1기는 유지한다. */
  countMul?: number;
  /** 해당 웨이브에 추가로 곱할 체력/속도 배율. */
  hpMul?: number;
  speedMul?: number;
  /** 한 부대에 들어가는 적 수. 없으면 기존처럼 균일하게 출현한다. */
  groupSize?: number;
  /** 부대 안에서 적이 나오는 간격. 없으면 기본 spawnInterval을 쓴다. */
  intraInterval?: number;
  /** 한 부대의 마지막 적과 다음 부대의 첫 적 사이 간격(초). */
  groupGap?: number;
  /** 이 웨이브에서만 사용하는 적 조합. 방패진·기병대 같은 테마를 만든다. */
  mix?: MixEntry[];
  /** 한 행에 나란히 서는 열 수. */
  columns?: number;
  /** 열 사이 좌우 간격(world unit). */
  laneSpacing?: number;
}

export interface GenerateWavesParams {
  /** 웨이브 수 */
  count: number;
  /** 기본 유닛 id. mix를 주면 무시된다. */
  unitId?: string;
  /** 여러 유닛을 섞을 때. unitId 대신 쓴다. */
  mix?: MixEntry[];
  /** 1웨이브 보병 수 */
  baseCount: number;
  /** 웨이브마다 늘어나는 보병 수 */
  countStep: number;
  /**
   * 웨이브당 HP 성장률 (0.14 = x1.14 누적).
   * 여기에 BALANCE.difficulty.hpGrowthBonus 가 **더해진** 값이 실제 기울기다.
   */
  hpGrowth: number;
  /**
   * 체력 배율이 앞 웨이브보다 낮아지지 않게 한다.
   *
   * 성장률은 누적이라 원래 단조 증가지만, `patterns[n].hpMul`이 1보다 작으면
   * 그 웨이브만 앞 웨이브보다 물러진다. 한 판을 통째로 보면 이게 눈에 띈다 —
   * 특히 마지막 파가 그 앞 파보다 약하면 "끝이 쉬워졌다"로 읽힌다
   * (실제로 3·5·6장의 15파가 14파보다 낮았다).
   *
   * 이 옵션을 켜면 체력 배율은 웨이브마다 최소한 `hpGrowth`만큼은 오른다.
   * 변주는 그 위로 **더 어렵게만** 밀 수 있고, 아래로는 내리지 못한다.
   * 물량을 줄이는 `countMul`이나 대형 변주는 그대로 듣는다.
   */
  hpRatchet?: boolean;
  /** 웨이브당 속도 성장률 */
  speedGrowth: number;
  /** n(1-base)을 받아 스폰 간격(초)을 돌려준다 */
  spawnInterval: (n: number) => number;
  /** { 웨이브번호(1-base): [{unitId, atRatio}] } */
  inserts?: Record<number, WaveInsert[]>;
  /** 웨이브별 병력/속도/대형 변주. */
  patterns?: Record<number, WavePattern>;
  /** 일반 웨이브의 기본 횡대 열 수와 간격. */
  formationColumns?: number;
  laneSpacing?: number;
  /** 배너 문구 생성기 */
  banner?: (n: number, isBoss: boolean) => string;
  /** 웨이브 클리어 보너스 */
  reward?: (n: number) => number;
}

const HANJA = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function waveLabel(n: number): string {
  if (n <= 10) return HANJA[n];
  if (n < 20) return `十${HANJA[n - 10]}`;
  if (n === 20) return '二十';
  return String(n);
}

/**
 * 웨이브 생성기 — 하드코딩 금지.
 * inserts로 지정된 유닛은 hpMul/speedMul을 적용하지 않고 원본 스탯으로 넣는다.
 * (보스를 성장시키면 20웨이브에서 HP 16000이 된다.)
 */
/**
 * n번째 웨이브의 minionCount 자리를 mix 비율대로 나눠 유닛 id 배열을 만든다.
 *
 * 난수를 쓰지 않는다 — 시뮬이 결정론이어야 하므로 배분도 결정론이어야 한다.
 * "가장 뒤처진 유닛을 다음에 낸다"(stride 스케줄링)로 골고루 섞으면,
 * 같은 종류가 몰려 나와 특정 구간만 뚫리는 일이 없다.
 */
export function composeWave(mix: readonly MixEntry[], n: number, minionCount: number): string[] {
  const active = mix.filter((m) => n >= m.from && (m.until === undefined || n <= m.until));
  if (active.length === 0) return [];

  const totalWeight = active.reduce((sum, m) => sum + m.weight, 0);
  // progress[i] = 지금까지 낸 수 / 이 유닛이 가져야 할 몫
  const emitted = new Array<number>(active.length).fill(0);
  const out: string[] = [];

  for (let k = 0; k < minionCount; k++) {
    let best = 0;
    let bestDeficit = -Infinity;
    for (let i = 0; i < active.length; i++) {
      const share = active[i].weight / totalWeight;
      // 이상적으로 지금쯤 나왔어야 할 수 - 실제로 낸 수
      const deficit = (k + 1) * share - emitted[i];
      // 동점이면 mix에 먼저 적힌 쪽 (결정론)
      if (deficit > bestDeficit + 1e-9) {
        bestDeficit = deficit;
        best = i;
      }
    }
    emitted[best]++;
    out.push(active[best].unitId);
  }
  return out;
}

export function generateWaves(params: GenerateWavesParams): WaveDef[] {
  const waves: WaveDef[] = [];
  const mix: MixEntry[] = params.mix ?? [{ unitId: params.unitId!, from: 1, weight: 1 }];
  if (!params.mix && !params.unitId) throw new Error('generateWaves needs unitId or mix');

  /** 래칫이 켜져 있을 때 앞 웨이브가 가졌던 체력 배율 */
  let prevHpMul = 0;

  for (let n = 1; n <= params.count; n++) {
    const pattern = params.patterns?.[n];
    const baseMinionCount = params.baseCount + params.countStep * (n - 1);
    const minionCount = Math.max(1, Math.round(baseMinionCount * (pattern?.countMul ?? 1)));
    /*
     * 각 장이 정한 성장률에 전역 가산치를 얹는다 — 표는 그대로 두고 기울기만 세운다.
     * 1파는 어느 장이든 그대로고(성장률은 n-1 제곱이므로), 뒤로 갈수록 벌어진다.
     * 왜 여기인가: 이 값이 웨이브 번호를 아는 유일한 자리다. Enemy.init 은 스폰이
     * 건네준 hpMul 만 볼 뿐 몇 파째인지 모른다. [[BALANCE.difficulty.hpGrowthBonus]]
     */
    const growth = params.hpGrowth + BALANCE.difficulty.hpGrowthBonus;
    const rawHpMul = Math.pow(1 + growth, n - 1) * (pattern?.hpMul ?? 1);
    // 래칫: 앞 웨이브보다 최소 한 걸음(growth)은 올라간다. 같은 자리에 머무는 파가 없다.
    const floor = prevHpMul * (1 + growth);
    const hpMul = params.hpRatchet ? Math.max(rawHpMul, floor) : rawHpMul;
    prevHpMul = hpMul;
    const speedMul = Math.pow(1 + params.speedGrowth, n - 1) * (pattern?.speedMul ?? 1);
    /*
     * 스폰 간격에 전역 배율을 곱한다 — 웨이브가 길게 늘어지지 않고 한꺼번에 쏟아진다.
     * 웨이브 사이 간격(waveInterval)은 그대로이므로, 늘어나는 것은 총 시간이 아니라
     * "동시에 경로 위에 서 있는 적의 수"다. 타워가 한 기씩 처리하던 대열이
     * 한 덩어리로 밀려오면 같은 화력으로도 앞줄만 깎다가 뒷줄을 통과시킨다.
     */
    const interval = params.spawnInterval(n) * BALANCE.difficulty.spawnIntervalMul;
    // 횡대를 넓힌다. 열이 늘어난 만큼 간격을 좁혀 길 폭(±maxHalfWidth) 안에 넣되,
    // minSpacing 아래로는 좁히지 않는다 — 그보다 좁으면 적끼리 겹쳐 대열로 읽히지 않는다.
    const rank = BALANCE.difficulty.rank;
    const baseColumns = Math.max(1, Math.floor(pattern?.columns ?? params.formationColumns ?? 1));
    const rawSpacing = pattern?.laneSpacing ?? params.laneSpacing ?? 14;
    const fitColumns = Math.floor((rank.maxHalfWidth * 2) / rank.minSpacing) + 1;
    const maxColumns = Math.max(1, Math.min(rank.maxColumns, fitColumns));
    // 한 줄(1열)을 지정한 웨이브는 그대로 둔다 — 일부러 외줄로 세운 대열까지 벌리지 않는다.
    const columns = baseColumns === 1
      ? 1
      : Math.min(maxColumns, Math.max(1, Math.round(baseColumns * rank.columnsMul)));
    const laneSpacing = columns > 1
      ? Math.min(rawSpacing, Math.max(rank.minSpacing, (rank.maxHalfWidth * 2) / (columns - 1)))
      : rawSpacing;

    const spawnAt = (i: number): number => {
      const groupSize = pattern?.groupSize
        ? Math.max(1, Math.floor(pattern.groupSize))
        : minionCount;
      const intra = pattern?.intraInterval !== undefined
        ? pattern.intraInterval * BALANCE.difficulty.spawnIntervalMul
        : interval;
      const gap = pattern?.groupGap !== undefined
        ? pattern.groupGap * BALANCE.difficulty.groupGapMul
        : interval;
      const group = Math.floor(i / groupSize);
      const within = i % groupSize;
      const row = Math.floor(within / columns);
      const rowsPerGroup = Math.ceil(groupSize / columns);
      // A rank spawns at once; advance by the equivalent old per-unit cadence
      // so formations improve readability without silently tripling DPS pressure.
      const rowInterval = intra * columns;
      /*
       * 횡대를 넓히면 한 부대의 행 수가 줄어 부대가 그만큼 빨리 끝난다.
       * 그 줄어든 시간을 부대 사이 숨에 돌려주어 **웨이브의 총 길이를 넓히기 전과 같게**
       * 유지한다. 넓힌 횡대는 대열의 모양만 바꾸고, 밀도를 정하는 것은
       * spawnIntervalMul / groupGapMul 두 값 하나뿐이어야 하기 때문이다 —
       * 안 그러면 열 수를 바꿀 때마다 웨이브가 몰래 짧아진다(실측: 6장이 그래서 13파에서 무너졌다).
       */
      const baseRows = Math.ceil(groupSize / baseColumns);
      const gapAdjust = Math.max(0, (baseRows - 1) * baseColumns - (rowsPerGroup - 1) * columns) * intra;
      return group * ((rowsPerGroup - 1) * rowInterval + gap + gapAdjust) + row * rowInterval;
    };

    const laneAt = (i: number): number => {
      const groupSize = pattern?.groupSize
        ? Math.max(1, Math.floor(pattern.groupSize))
        : minionCount;
      const within = i % groupSize;
      const rowStart = i - (within % columns);
      const remainingInGroup = groupSize - (within - (within % columns));
      const remainingTotal = minionCount - rowStart;
      const rowCount = Math.min(columns, remainingInGroup, remainingTotal);
      const column = within % columns;
      const base = (column - (rowCount - 1) / 2) * laneSpacing;
      const noise = ((((i + 1) * 73 + n * 41) % 101) / 100 - 0.5) * Math.min(4, laneSpacing * 0.18);
      return base + noise;
    };

    const composition = composeWave(pattern?.mix ?? mix, n, minionCount);
    const spawns: WaveSpawn[] = [];
    for (let i = 0; i < composition.length; i++) {
      spawns.push({ unitId: composition[i], at: spawnAt(i), hpMul, speedMul, laneOffset: laneAt(i) });
    }

    const inserts = params.inserts?.[n] ?? [];
    const spanEnd = composition.length > 0 ? spawnAt(composition.length - 1) : 0;
    const insertIds = new Set(inserts.map((ins) => ins.unitId));
    for (const ins of inserts) {
      // 보스는 원본 스탯 그대로 (hpMul/speedMul = 1)
      spawns.push({
        unitId: ins.unitId,
        at: spanEnd * ins.atRatio,
        hpMul: ins.hpMul ?? 1,
        speedMul: ins.speedMul ?? 1,
        laneOffset: 0,
      });
    }

    // 시간순 정렬. 동시각이면 삽입 유닛(보스)이 먼저 나와 눈에 띄게 한다.
    spawns.sort((a, b) => a.at - b.at || (insertIds.has(a.unitId) ? -1 : insertIds.has(b.unitId) ? 1 : 0));

    const isBossWave = inserts.length > 0;
    const banner = params.banner
      ? params.banner(n, isBossWave)
      : `제 ${waveLabel(n)}파`;

    waves.push({
      index: n,
      spawns,
      banner,
      isBossWave,
      reward: params.reward?.(n) ?? 0,
    });
  }

  return waves;
}

export { waveLabel };
