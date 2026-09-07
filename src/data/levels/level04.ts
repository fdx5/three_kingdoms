import type { LevelDef } from '../../types/level';
import { generateWaves, waveLabel } from '../waves';

/**
 * 레벨 4 — 합비 공방전. 손권의 강동군을 합비성에서 막는다.
 *
 * 앞 세 장이 가르친 것은 전부 타워였다 — 업그레이드(1장), 조합(2장), 시간(3장).
 * 레벨 4가 가르치는 것은 **성문**이다.
 *
 * 방법은 슬롯을 줄이는 것 하나다. 이 장의 건설 슬롯은 다섯 개뿐이고,
 * 그중 가장 좋은 자리도 278u밖에 덮지 못한다(3장의 최고 자리는 409u였다).
 * 타워만으로는 마지막 직선을 막을 수 없게 만들어 두었다 —
 * 모자란 한 겹은 성문을 강화해서 사야 한다. 성문은 팔 수도 옮길 수도 없는
 * 대신, 슬롯이 없는 자리에 방어선을 하나 더 세우는 유일한 방법이다.
 *
 * 새로 열리는 것
 * -------------
 *   화공 망루   불덩이를 던져 지면을 태운다. 등갑병의 답이다.
 *   성문 강화   1~6단계. 활 2발 -> 활 4발 -> 대포 2발 -> ... -> 양방향 화염
 *
 * 강동군이 내는 문제
 * -----------------
 *   등갑병   화살을 65% 튕기지만 불에는 2.2배로 탄다 — 궁노 도배를 벌한다
 *   야습대   감속 면역 + 속도 118. 철질려로 묶을 수 없으니 사거리로 잡아야 한다
 *   손권     전군 회복 오라. 먼저 끊지 않으면 마지막 대열이 줄지 않는다
 *
 * 경로 설계
 * ---------
 * 헤어핀 둘과 큰 U자 하나, 그리고 성 앞 직선 310u. 총 길이 2470u.
 * 성 앞 직선을 덮는 슬롯은 단 하나(167u)뿐이다 — 여기가 이 장의 시험 문제다.
 */
const PATH: [number, number][] = [
  [0, 120], // 서쪽 소요진에서 들어온다
  [280, 120],
  [280, 300], // ┐ 헤어핀 A
  [120, 300], // │
  [120, 470], // ┘
  [560, 470], // ── 남쪽 직선 440u
  [560, 180], // ┐ 북으로 되꺾는다
  [820, 180], // │
  [820, 560], // ┘ 다시 남으로
  [1130, 560], // ── 성 앞 직선 310u
];

/**
 * 건설 슬롯 5개. 좋은 자리가 없다 — 이게 이 장의 설계다.
 *
 * s4_a  헤어핀 A 안쪽    271u   가장 좋은 자리인데도 3장의 나쁜 자리 수준이다
 * s4_b  헤어핀 A 바깥    278u
 * s4_c  북쪽 꺾임 안쪽   274u
 * s4_d  중앙 공터        161u   — 나쁜 자리
 * s4_e  성 앞 직선 옆    167u   — 마지막 방어선. 여기 하나로는 못 막는다
 *
 * 다섯을 전부 만렙으로 올려도 성 앞 직선에서 새는 양이 남는다.
 * 그 차이를 메우는 것이 성문 강화다(실측: 성문 1단계 고정이면 12파에서 무너진다).
 */
const BUILD_SLOTS = [
  { id: 's4_a', x: 232, z: 252 },
  { id: 's4_b', x: 188, z: 420 },
  { id: 's4_c', x: 770, z: 232 },
  { id: 's4_d', x: 620, z: 400 },
  { id: 's4_e', x: 940, z: 505 },
];

export const LEVEL_04: LevelDef = {
  id: 'level04',
  stratagems: ['fire_attack', 'ice_storm'],
  title: '합비 공방전 — 소요진',

  castle: { id: 'hefei_gate', hp: 700 },

  /**
   * 시작 골드 450. 3장보다 많지만 슬롯이 둘 적으므로 타워에 다 쓰면 안 된다 —
   * 성문 2단계(240 G)를 첫 다섯 웨이브 안에 살 수 있는 액수로 잡았다.
   */
  startGold: 420,

  waveInterval: 17,
  firstWaveDelay: 24,

  /** 3장의 절반. 이 장의 수입은 조기 소집이 아니라 처치 골드다. */
  earlyCallBonusPerSecond: 5,

  allowRepair: true,

  /**
   * 성문 강화 해금. 이 장이 존재하는 이유다.
   *
   * 계략은 열지 않는다 — 남는 골드가 갈 곳이 둘이면 어느 쪽도 충분히 사지 못하고,
   * 이 장이 가르쳐야 할 것은 "성문도 무기다" 하나이기 때문이다. [[CASTLE_LEVELS]]
   */
  castleUpgrade: true,

  /** 성 앞 직선이 얇은 장이라 누수를 전제로 기준을 낮춰 잡는다. */
  stars: { three: 0.6, two: 0.22 },

  path: PATH,
  buildSlots: BUILD_SLOTS,

  waves: generateWaves({
    count: 15,
    /*
     * 물량은 3장을 기준으로 장마다 1.5배씩 붙는다 — 3장 x1, 4장 x1.5,
     * 5장 x2.25, 6장 x3.4. 뒤로 갈수록 "같은 답을 더 크게" 요구하는 것이
     * 이 게임의 후반이고, 그 크기를 여기 두 값이 정한다.
     */
    baseCount: 23,
    countStep: 8,
    hpGrowth: 0.19,
    speedGrowth: 0.013,
    spawnInterval: (n) => Math.max(0.32, 0.9 - 0.026 * n),
    formationColumns: 4,
    laneSpacing: 20,

    /**
     * 등갑병 비중(10:6 = 전체의 33%)이 이 장의 시험 문제다.
     * 궁노만으로는 저항 65%에 막혀 대열이 통과하고, 화공 망루 한 기만 있어도
     * 같은 대열이 지나가는 동안 통째로 탄다(fireVuln 2.2).
     * 야습대는 6파부터 — 감속이 통하지 않는다는 것을 그때 알게 된다.
     */
    mix: [
      { unitId: 'wu_marine', from: 1, weight: 10 },
      { unitId: 'wu_rattan', from: 3, weight: 6 },
      { unitId: 'wu_raider', from: 6, weight: 3 },
      // 기병은 5파부터. 이 장에서 처음 나오는 말 탄 적이다
      { unitId: 'wu_cavalry', from: 5, weight: 3 },
    ],

    patterns: {
      3: {
        countMul: 1.1, hpMul: 0.9, groupSize: 10, intraInterval: 0.12, groupGap: 1.9,
        mix: [{ unitId: 'wu_rattan', from: 1, weight: 4 }, { unitId: 'wu_marine', from: 1, weight: 6 }],
      },
      5: { countMul: 0.9, hpMul: 1.12, groupSize: 8, intraInterval: 0.2, groupGap: 2.6 },
      6: {
        countMul: 1.2, speedMul: 1.1, groupSize: 12, intraInterval: 0.08, groupGap: 1.7,
        mix: [{ unitId: 'wu_raider', from: 1, weight: 5 }, { unitId: 'wu_marine', from: 1, weight: 5 }],
      },
      // 등갑진 — 화공 망루가 없으면 여기서 처음으로 크게 샌다
      8: {
        countMul: 0.95, hpMul: 1.15, groupSize: 8, intraInterval: 0.22, groupGap: 2.8,
        mix: [{ unitId: 'wu_rattan', from: 1, weight: 7 }, { unitId: 'wu_marine', from: 1, weight: 3 }],
      },
      9: { countMul: 0.85, hpMul: 1.1, groupSize: 9, intraInterval: 0.18, groupGap: 2.5 },
      11: { countMul: 1.45, hpMul: 0.85, groupSize: 14, intraInterval: 0.07, groupGap: 1.6 },
      12: {
        countMul: 1.15, speedMul: 1.18, groupSize: 11, intraInterval: 0.09, groupGap: 1.8,
        mix: [
          { unitId: 'wu_raider', from: 1, weight: 5 },
          { unitId: 'wu_rattan', from: 1, weight: 3 },
          { unitId: 'wu_marine', from: 1, weight: 4 },
        ],
      },
      14: { countMul: 0.85, hpMul: 1.28, speedMul: 0.92, groupSize: 8, intraInterval: 0.24, groupGap: 2.9 },
      15: { countMul: 1.3, hpMul: 1.06, groupSize: 13, intraInterval: 0.08, groupGap: 1.7 },
    },

    inserts: {
      9: [{ unitId: 'ganning', atRatio: 0.55, hpMul: 1 }],
      15: [{ unitId: 'sunquan', atRatio: 0.4, hpMul: 1 }],
    },

    banner: (n, isBoss) => {
      if (n === 3) return `제 ${waveLabel(n)}파 — 등갑진`;
      if (n === 6) return `제 ${waveLabel(n)}파 — 야습`;
      if (n === 8) return `제 ${waveLabel(n)}파 — 등갑 밀집대형`;
      if (n === 9) return `제 ${waveLabel(n)}파 — 감녕`;
      if (n === 11) return `제 ${waveLabel(n)}파 — 강동의 파도`;
      if (n === 12) return `제 ${waveLabel(n)}파 — 백기 돌격`;
      if (n === 14) return `제 ${waveLabel(n)}파 — 강동 결사대`;
      if (n === 15) return `제 ${waveLabel(n)}파 — 손권`;
      return isBoss ? `제 ${waveLabel(n)}파 — 적장 출현` : `제 ${waveLabel(n)}파`;
    },
    reward: () => 0,
  }),

  environment: {
    landscape: 'lakeside',
    // 소호(巢湖) 물가의 갈대밭 — 습하고 푸르다
    skyColor: '#a9bcc4',
    groundColor: '#5e7059',
    lowColor: '#48573f',
    highColor: '#87956a',
    fogColor: '#b6c8ce',
    terrainTexture: 'ground_forest',
    terrainRelief: 3.0,
    biome: 'woodland',
    bgmYoutubeId: 'nzo4fB3uKi0',
  },
};
