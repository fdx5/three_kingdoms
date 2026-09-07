import type { LevelDef } from '../../types/level';
import { generateWaves, waveLabel } from '../waves';

/**
 * 레벨 3 — 관도대전. 원소의 하북군을 관도 나루에서 막는다.
 *
 * 레벨 1은 업그레이드를, 레벨 2는 타워 종류를 가르쳤다.
 * 레벨 3이 가르치는 것은 **시간**이다.
 *
 * 처치 골드만으로는 슬롯 일곱을 채울 수 없게 만들어 두었다(실측).
 * 모자란 돈은 조기 소집으로 앞당겨 벌어야 한다 — 남은 대기 시간 1초당 10 G다.
 * 웨이브를 당기면 앞 웨이브와 겹쳐서 오므로, 그건 공짜 돈이 아니라
 * "지금 방어선이 이만큼은 감당한다"는 판단에 거는 돈이다.
 *
 * 하북군은 개별로는 서량군보다 약하다. 대신 수가 많고, 기수가 붙으면 빨라진다.
 * 그래서 이 레벨의 실패는 "못 뚫었다"가 아니라 "늦었다"의 형태로 온다.
 *
 * 경로 설계
 * ---------
 * 헤어핀 셋(A·B·C)과 성 앞 직선 하나. 총 길이 2850u.
 * 헤어핀마다 좋은 자리가 하나씩 나오고 나머지는 전부 나쁜 자리다 —
 * 여기서는 거리가 아니라 웨이브가 겹치는 정도가 압박을 만든다.
 */
const PATH: [number, number][] = [
  [0, 200], // 서쪽 나루에서 들어온다
  [300, 200],
  [300, 80], // ┐ 헤어핀 A
  [420, 80], // │
  [420, 340], // ┘
  [170, 340], // ┐ 헤어핀 B (서쪽으로 되돌아온다)
  [170, 460], // │
  [640, 460], // ┘ ── 직선 470u
  [640, 580], // ┐ 헤어핀 C (다시 서쪽으로)
  [380, 580], // │
  [380, 660], // ┘
  [1130, 660], // ── 성 앞 직선 750u
];

/**
 * 건설 슬롯 7개. 커버리지는 tests/level03 에서 실제로 계산해 검증한다.
 *
 * 좋은 자리 3 : 나쁜 자리 4. 레벨 2보다 슬롯이 하나 많지만 좋은 자리는 그대로다 —
 * 늘어난 것은 "돈을 더 써야 하는 자리"지 "더 편해지는 자리"가 아니다.
 */
const BUILD_SLOTS = [
  { id: 's3_a', x: 368, z: 145 }, // 헤어핀 A 안쪽   409u  ★
  { id: 's3_b', x: 295, z: 408 }, // 헤어핀 B 안쪽   320u  ★
  { id: 's3_c', x: 510, z: 528 }, // 헤어핀 C 안쪽   320u  ★
  { id: 's3_d', x: 708, z: 580 }, // C 바깥 꺾임     240u  — 애매한 자리
  { id: 's3_e', x: 250, z: 528 }, // 헤어핀 C 서쪽   160u  — 나쁜 자리
  { id: 's3_f', x: 150, z: 120 }, // 진입 직선 옆    120u  — 나쁜 자리
  { id: 's3_g', x: 900, z: 590 }, // 성 앞 직선 옆   143u  — 마지막 방어선
];

export const LEVEL_03: LevelDef = {
  id: 'level03',
  stratagems: ['fire_attack', 'ice_storm'],
  title: '관도대전 — 관도 나루',

  castle: { id: 'guandu_camp', hp: 500 },

  /**
   * 초반 골드 400 — 세 장 중 가장 많다.
   *
   * 원래는 225로 두어 "첫 타워 하나를 짓고 나면 남는 게 없다"를 강제했다.
   * 지금은 시작하자마자 방어선의 뼈대(궁노 + 벽력거)를 세울 수 있다.
   * 이 레벨의 압박은 여전히 조기 소집에 있다 — 시작 골드로는 권장 조합의
   * 일부만 서고, 나머지는 대기 시간을 앞당겨 벌어야 한다(계수가 앞 레벨의 두 배 이상).
   */
  startGold: 400,

  waveInterval: 15,
  firstWaveDelay: 22,

  /**
   * 조기 소집 1초당 10 G. 레벨 1·2의 4 G와 비교하면 두 배 반이다.
   * 15초 간격을 통째로 당기면 150 G — 타워 한 기 값의 절반이 넘는다.
   * 이 수치가 곧 레벨 3의 교훈이다: 시간을 돈으로 바꿀 수 있다.
   */
  earlyCallBonusPerSecond: 10,

  /**
   * 성벽 수리는 열되 계략은 열지 않는다.
   *
   * 레벨 2는 "남는 돈을 어디에 쓰나"였고 계략이 그 답이었다.
   * 레벨 3은 정반대로 "돈이 모자란다"가 문제라, 여기에 소비처를 더 두면
   * 카드 한 장이 곧 타워 한 기가 되어 함정이 된다(실측: 계략을 쓰면 236 -> 66).
   * 수리는 남는 돈이 아니라 급할 때 성 체력으로 바꾸는 밸브라 성격이 다르다.
   */
  allowRepair: true,

  /** 누수가 전제인 레벨. 기준은 레벨 2와 같은 자리에 둔다. */
  stars: { three: 0.55, two: 0.18 },

  path: PATH,
  buildSlots: BUILD_SLOTS,

  waves: generateWaves({
    count: 15,
    baseCount: 13,
    countStep: 3,
    hpGrowth: 0.0882,
    // 변주가 웨이브를 앞 웨이브보다 물러지게 만들지 않는다. [[hpRatchet]]
    hpRatchet: true,
    speedGrowth: 0.012,
    spawnInterval: (n) => Math.max(0.3, 0.85 - 0.025 * n),
    formationColumns: 4,
    laneSpacing: 20,

    /**
     * 5파 창병, 8파 기수. 기수가 붙는 8파부터 "왜 갑자기 빨리 오지"가 시작된다.
     * 기수 비중이 낮은 이유는 하나면 충분하기 때문이다 — 오라는 겹치지 않는다.
     *
     * 창병 비중(10:7 = 전체 스폰의 35%)은 시작 골드 400과 짝이다.
     * 원거리 저항 30%인 창병이 이 레벨의 시험 문제이고, 궁노 도배를 벌하는 유일한 장치다.
     * 4였을 때(26%) 실측하면 궁노만 지어도 성 310/500 으로 클리어했고,
     * 오히려 권장 조합(213)보다 잘 나왔다 — 시험 문제가 사라진 셈이었다.
     * 7이면 궁노 단일 방어는 누수 45로 무너지고(창병 38 / 보병 4),
     * 혼합 방어는 250/500 으로 이긴다.
     */
    mix: [
      { unitId: 'ys_infantry', from: 1, weight: 10 },
      { unitId: 'ys_spear', from: 4, weight: 7 },
      { unitId: 'ys_banner', from: 6, weight: 1 },
    ],

    patterns: {
      3: { countMul: 1.5, hpMul: 0.78, groupSize: 12, intraInterval: 0.08, groupGap: 1.7 },
      4: {
        countMul: 0.88, hpMul: 1.08, groupSize: 8, intraInterval: 0.18, groupGap: 2.5,
        mix: [{ unitId: 'ys_spear', from: 1, weight: 3 }, { unitId: 'ys_infantry', from: 1, weight: 2 }],
      },
      6: {
        countMul: 1.05, speedMul: 1.15, groupSize: 10, intraInterval: 0.12, groupGap: 2.1,
        mix: [
          { unitId: 'ys_banner', from: 1, weight: 1 },
          { unitId: 'ys_infantry', from: 1, weight: 7 },
          { unitId: 'ys_spear', from: 1, weight: 3 },
        ],
      },
      8: { countMul: 0.85, hpMul: 1.1, groupSize: 9, intraInterval: 0.17, groupGap: 2.6 },
      10: { countMul: 1.55, hpMul: 0.82, groupSize: 15, intraInterval: 0.07, groupGap: 1.6 },
      12: {
        countMul: 1.18, speedMul: 1.22, groupSize: 11, intraInterval: 0.09, groupGap: 1.8,
        mix: [
          { unitId: 'ys_banner', from: 1, weight: 2 },
          { unitId: 'ys_spear', from: 1, weight: 5 },
          { unitId: 'ys_infantry', from: 1, weight: 5 },
        ],
      },
      14: { countMul: 0.8, hpMul: 1.25, speedMul: 0.9, groupSize: 8, intraInterval: 0.24, groupGap: 2.8 },
      15: { countMul: 1.25, hpMul: 1.05, groupSize: 13, intraInterval: 0.09, groupGap: 1.7 },
    },

    inserts: {
      8: [{ unitId: 'yanliang', atRatio: 0.55, hpMul: 2 }],
      15: [{ unitId: 'yuanshao', atRatio: 0.45, hpMul: 3 }],
    },

    banner: (n, isBoss) => {
      if (n === 3) return `제 ${waveLabel(n)}파 — 하북의 인해전술`;
      if (n === 4) return `제 ${waveLabel(n)}파 — 창병 밀집대형`;
      if (n === 6) return `제 ${waveLabel(n)}파 — 기수가 섰다`;
      if (n === 8) return `제 ${waveLabel(n)}파 — 안량`;
      if (n === 10) return `제 ${waveLabel(n)}파 — 파상 공세`;
      if (n === 12) return `제 ${waveLabel(n)}파 — 기수 돌격대`;
      if (n === 14) return `제 ${waveLabel(n)}파 — 하북 결사대`;
      if (n === 15) return `제 ${waveLabel(n)}파 — 원소`;
      return isBoss ? `제 ${waveLabel(n)}파 — 적장 출현` : `제 ${waveLabel(n)}파`;
    },
    reward: () => 0,
  }),

  environment: {
    // 서늘한 관문에서 강가 갈대밭으로
    skyColor: '#b9c3cc',
    groundColor: '#6b7358',
    lowColor: '#565c46',
    highColor: '#8d9169',
      fogColor: '#c3ccd4',
      terrainTexture: 'ground_forest',
      terrainRelief: 3.5,
      biome: 'woodland',
    // 배경음: https://youtube.com/shorts/Z-HHzu3rhj8
    bgmYoutubeId: 'Z-HHzu3rhj8',
  },
};
