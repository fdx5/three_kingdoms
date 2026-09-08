import type { LevelDef } from '../../types/level';
import { generateWaves, waveLabel } from '../waves';

/**
 * 레벨 2 — 동탁 토벌전. 호뢰관 앞.
 *
 * 레벨 1이 가르친 것은 "업그레이드" 하나였다.
 * 레벨 2가 가르치는 것은 "속성에는 답이 따로 있다"다.
 *   방패병(원거리 저항 60%) -> 벽력거의 공성 피해
 *   철기(속도 112)          -> 철질려 진지의 감속
 *   종군 도사(주변 회복)     -> 타게팅을 바꿔 먼저 끊기
 *   여포(8초마다 돌진)       -> 감속으로 묶어두기
 *
 * 그래서 성 체력을 1000 -> 600으로 낮췄다. 레벨 1에서는 누수 50기를 허용했지만
 * 여기서는 보병 기준 33기다. 누수가 실제 위협이 되어야 답을 찾을 이유가 생긴다.
 *
 * 경로 설계
 * ---------
 * 헤어핀 3개(A·B·C)와 그 사이를 잇는 긴 직선 두 개.
 * 긴 직선(z=370의 490u, z=610의 650u)은 철기가 전속력으로 달리는 구간이라
 * 여기를 감속으로 묶느냐가 방어선의 성패를 가른다.
 * 총 길이 2640u, 90도 꺾임 11회.
 */
const PATH: [number, number][] = [
  [120, 0], // 북쪽에서 내려온다 (레벨 1과 진입 방향이 다르다)
  [120, 130],
  [300, 130],
  [300, 40], // ┐ 헤어핀 A
  [410, 40], // │
  [410, 250], // ┘
  [210, 250], // ┐ 헤어핀 B (서쪽으로 되돌아온다)
  [210, 370], // │
  [700, 370], // ┘ ── 기병 직선 490u ──
  [700, 490],
  [480, 490], // ┐ 헤어핀 C
  [480, 610], // │
  [1130, 610], // ┘ ── 성 앞 직선 650u ──
];

/**
 * 건설 슬롯 6개. 사거리 100 기준 커버리지는 tests/level02 에서 실제로 계산해 검증한다.
 *
 * s2_a  헤어핀 A 안쪽   377u   ★ 좋은 자리
 * s2_b  헤어핀 B 안쪽   430u   ★ 좋은 자리
 * s2_c  헤어핀 C 안쪽   430u   ★ 좋은 자리
 * s2_d  기병 직선 옆    143u   — 나쁜 자리지만 철기 구간이라 철질려의 값이 다르다
 * s2_e  성 앞 직선 옆   143u   — 마지막 방어선
 * s2_f  꺾임 바깥       160u   — 애매한 자리
 *
 * 좋은 자리 3 : 나쁜 자리 3. 타워 종류가 셋이므로 "어디에 무엇을"이 둘 다 문제가 된다.
 */
const BUILD_SLOTS = [
  { id: 's2_a', x: 350, z: 120 },
  { id: 's2_b', x: 285, z: 318 },
  { id: 's2_c', x: 555, z: 558 },
  { id: 's2_d', x: 600, z: 300 },
  { id: 's2_e', x: 850, z: 540 },
  { id: 's2_f', x: 768, z: 430 },
];

export const LEVEL_02: LevelDef = {
  id: 'level02',
  title: '동탁 토벌전 — 호뢰관 앞',

  castle: { id: 'hulao_gate', hp: 600 },
  startGold: 300,

  /**
   * 웨이브가 끝나기를 기다리지 않고 시간표대로 오므로, 이 간격이 곧 압박의 세기다.
   * 레벨 1의 12초를 그대로 쓰면 후반에 웨이브 3개가 동시에 경로 위에 올라가
   * 최선의 플레이도 성 체력 24%로 끝난다(실측). 18초가 적정선이었다.
   */
  waveInterval: 18,
  firstWaveDelay: 24,

  /** 성벽 수리 해금 — 웨이브 사이의 골드 소비처 */
  allowRepair: true,

  /**
   * 계략 해금 — 웨이브 한복판의 골드 소비처.
   * 수리만으로는 잉여 골드 3,000 G가 다 흡수되지 않았다(실측).
   * 세 장 모두 타워를 대신하지 못하는 선에서 값을 잡았다 —
   * 전부 궁노 + 계략 남용으로도 여전히 져야 한다(tests/level02).
   */
  stratagems: ['ice_storm', 'fire_attack', 'reinforcements'],

  /**
   * 레벨 1은 무손실(100%)이 3별이었다. 여기서는 누수가 전제라 기준이 다르다.
   *
   * 실측(헤드리스 기준, 전 슬롯 만렙 + 수리):
   *   궁노만            패배
   *   궁노+벽력         292/600 (49%)  누수 13
   *   궁노+벽력+질려    288/600 (48%)  누수 11
   * 마지막 웨이브의 피해는 쿨다운 때문에 일부만 만회되므로,
   * 여포와 방패병을 얼마나 끊어냈는지가 그대로 등급이 된다.
   */
  stars: { three: 0.6, two: 0.35 },

  path: PATH,
  buildSlots: BUILD_SLOTS,

  waves: generateWaves({
    count: 14,
    baseCount: 11,
    countStep: 3,
    /*
     * 0.10 -> 0.115. 전역 난이도(BALANCE.difficulty)만으로는 이 장의 성적이
     * 592/600 에서 거의 움직이지 않았다 — 누수는 늘었는데 수리가 전부 되돌렸다.
     * 0.115 에서 502/600, 누수 25 로 끝난다. 0.13 은 11파에서 무너진다.
     *
     * 0.115 -> 0.110. 전역 가산치(difficulty.hpGrowthBonus = 0.005)에 자리를
     * 내준 것이지 물러진 것이 아니다 — 실제 기울기는 그대로 0.115 다.
     * 이 장에는 위로 갈 여유가 없다: 0.120(= 0.115 + 가산치)이면 12파에서 무너진다.
     * 이 장의 상향은 물량이 아니라 아래 inserts 의 장수 쪽으로 갔다.
     */
    hpGrowth: 0.110,
    speedGrowth: 0.015,
    spawnInterval: (n) => Math.max(0.38, 1.05 - 0.03 * n),
    formationColumns: 4,
    laneSpacing: 20,

    /**
     * 구성은 웨이브가 갈수록 복잡해진다.
     * 4파 철기, 7파 방패병, 11파 도사 — 새 속성이 하나씩 얹히며
     * 그때마다 "지금 방어선으로는 왜 안 되는지"를 한 종류씩 알려준다.
     */
    mix: [
      { unitId: 'xl_infantry', from: 1, weight: 10 },
      { unitId: 'xl_cavalry', from: 3, weight: 4 },
      { unitId: 'xl_shield', from: 5, weight: 5 },
      { unitId: 'xl_healer', from: 8, weight: 1 },
    ],

    patterns: {
      3: {
        countMul: 0.9, speedMul: 1.35, groupSize: 7, intraInterval: 0.1, groupGap: 2.1,
        mix: [{ unitId: 'xl_cavalry', from: 1, weight: 3 }, { unitId: 'xl_infantry', from: 1, weight: 2 }],
      },
      5: {
        countMul: 0.9, hpMul: 1.08, groupSize: 8, intraInterval: 0.2, groupGap: 2.6,
        mix: [{ unitId: 'xl_shield', from: 1, weight: 3 }, { unitId: 'xl_infantry', from: 1, weight: 2 }],
      },
      7: { countMul: 0.82, hpMul: 1.08, groupSize: 9, intraInterval: 0.18, groupGap: 2.5 },
      8: {
        countMul: 1.1, groupSize: 10, intraInterval: 0.14, groupGap: 2.4,
        mix: [
          { unitId: 'xl_shield', from: 1, weight: 5 },
          { unitId: 'xl_healer', from: 1, weight: 1 },
          { unitId: 'xl_infantry', from: 1, weight: 4 },
        ],
      },
      10: { countMul: 1.45, hpMul: 0.86, groupSize: 13, intraInterval: 0.09, groupGap: 1.8 },
      12: {
        countMul: 1.15, speedMul: 1.18, groupSize: 10, intraInterval: 0.11, groupGap: 2.0,
        mix: [
          { unitId: 'xl_cavalry', from: 1, weight: 4 },
          { unitId: 'xl_shield', from: 1, weight: 4 },
          { unitId: 'xl_healer', from: 1, weight: 1 },
        ],
      },
      14: { countMul: 1.2, hpMul: 1.05, groupSize: 12, intraInterval: 0.12, groupGap: 2.1 },
    },

    /*
     * 장수 배율은 전역 difficulty.bossHpMul(x2)이 다시 곱해진 값이 실제 체력이다.
     * 화웅 1.25 -> 실질 2.5배, 여포 1.75 -> 실질 3.5배 (예전 2배·3배).
     *
     * 표의 숫자를 내리고도 장수가 세진다. 여기서 2·3 을 그대로 두면 실질 4·6배가
     * 되는데, 그러면 여포가 성문에 붙는 순간 끝난다 — 누수 25기짜리 멀쩡한 방어를
     * 하고도 14파에서 성이 0 이 된다(실측). 3.5배가 이 장이 답할 수 있는 상한이다.
     */
    inserts: {
      7: [{ unitId: 'huaxiong', atRatio: 0.55, hpMul: 1.25 }],
      14: [{ unitId: 'lubu', atRatio: 0.5, hpMul: 1.75 }],
    },

    banner: (n, isBoss) => {
      if (n === 3) return `제 ${waveLabel(n)}파 — 서량 철기 돌격`;
      if (n === 5) return `제 ${waveLabel(n)}파 — 방패진`;
      if (n === 7) return `제 ${waveLabel(n)}파 — 화웅`;
      if (n === 8) return `제 ${waveLabel(n)}파 — 도사 호위대`;
      if (n === 10) return `제 ${waveLabel(n)}파 — 서량의 인해전술`;
      if (n === 12) return `제 ${waveLabel(n)}파 — 철기와 방패의 협공`;
      if (n === 14) return `제 ${waveLabel(n)}파 — 여포`;
      return isBoss ? `제 ${waveLabel(n)}파 — 적장 출현` : `제 ${waveLabel(n)}파`;
    },
    reward: (n) => (n === 5 || n === 10 ? 100 : 0),
  }),

  environment: {
    // 레벨 1의 마른 황토에서 서늘한 관문 앞 산지로
    skyColor: '#9aa8bb',
    groundColor: '#5d6350',
    lowColor: '#4a4b3e',
    highColor: '#7d7f61',
      fogColor: '#aab4c2',
      terrainTexture: 'ground_rocky',
      terrainRelief: 3.3,
      biome: 'highlands',
    // 배경음: https://youtu.be/9KxUmZ4v2HI
    bgmYoutubeId: '9KxUmZ4v2HI',
  },
};
