import type { LevelDef } from '../../types/level';
import { generateWaves, waveLabel } from '../waves';

/**
 * 레벨 6 — 오장원. 제갈량의 북벌군을 오장원에서 막는다. 마지막 장.
 *
 * 앞의 다섯 장이 낸 문제가 여기서 한꺼번에 온다.
 *   저항        2장의 방패병 — 답은 공성 피해
 *   물량과 속도  3장의 하북군 — 답은 감속과 분산
 *   화공        4장의 등갑 — 답은 불
 *   화염 저항    5장의 수군 — 답은 포탄
 * 레벨 6이 가르치는 것은 **전부 쓴다**이다. 타워 다섯 종류와 성문 여섯 단계,
 * 그리고 계략 셋이 모두 있어야 마지막 웨이브를 넘긴다.
 *
 * 왜 마지막 장에 새 규칙을 넣지 않는가
 * ------------------------------------
 * 여기서 새 속성을 하나 더 만들면 그건 "여섯 번째 교훈"이지 결승이 아니다.
 * 마지막 장의 일은 앞의 다섯을 동시에 묻는 것이고, 그래서 이 장의 새 것은
 * 오직 규모다 — 슬롯 8개, 성문 6단계, 그리고 체력 9,000의 제갈량.
 *
 * 촉 북벌군
 * ---------
 *   연노병     속도 62 · 저항 20%. 얇지만 끝없이 온다
 *   백이병     화살 45% + 화염 45% 차단. 2장 방패병의 후예
 *   목우유마   감속 면역 + 주변 초당 46 회복. 앞에서 끊지 않으면 대열이 안 준다
 *   강유       10파. 돌진 + 전군 가속
 *   제갈량     15파. 팔진도 — 저항 두 겹 + 회복 + 가속을 동시에 두른다
 *
 * 경로 설계
 * ---------
 * 헤어핀 넷과 성 앞 직선 250u. 총 길이 2750u, 큰 꺾임 10회.
 * 좋은 자리 4 : 나쁜 자리 4로, 8개를 전부 채워도 종류를 잘못 고르면 무너진다.
 */
const PATH: [number, number][] = [
  [0, 60], // 북서쪽 사곡에서 내려온다
  [300, 60],
  [300, 240], // ┐ 헤어핀 A
  [80, 240], // │
  [80, 440], // ┘
  [380, 440], // ┐ 헤어핀 B
  [380, 640], // │
  [640, 640], // ┘
  [640, 300], // ┐ 헤어핀 C (북으로 크게 되꺾는다)
  [880, 300], // │
  [880, 560], // ┘
  [1130, 560], // ── 성 앞 직선 250u
];

/**
 * 건설 슬롯 8개 (tests/level06 에서 커버리지를 실제로 계산해 검증한다).
 *
 * s6_a  헤어핀 A 안쪽    280u  ★
 * s6_b  헤어핀 A 바깥    283u  ★
 * s6_c  헤어핀 B 안쪽    281u  ★
 * s6_d  헤어핀 C 안쪽    277u  ★
 * s6_e  중앙 공터        160u
 * s6_f  진입 직선 옆     174u
 * s6_g  성 앞 직선 옆    120u  — 마지막 방어선
 * s6_h  헤어핀 B 바깥     57u  — 이 장에서 가장 나쁜 자리
 */
const BUILD_SLOTS = [
  { id: 's6_a', x: 240, z: 180 },
  { id: 's6_b', x: 148, z: 370 },
  { id: 's6_c', x: 450, z: 580 },
  { id: 's6_d', x: 830, z: 380 },
  { id: 's6_e', x: 580, z: 470 },
  { id: 's6_f', x: 150, z: 150 },
  { id: 's6_g', x: 1010, z: 480 },
  { id: 's6_h', x: 820, z: 610 },
];

export const LEVEL_06: LevelDef = {
  id: 'level06',
  title: '오장원 — 마지막 북벌',

  castle: { id: 'wuzhangyuan_gate', hp: 900 },

  /**
   * 시작 골드 700. 슬롯이 여덟이라 많아 보이지만, 권장 조합을 다 세우는 데는
   * 이 장 전체의 처치 골드가 거의 다 들어간다 — 마지막 장은 아껴 쓰는 장이다.
   */
  startGold: 1100,

  waveInterval: 20,
  firstWaveDelay: 28,
  earlyCallBonusPerSecond: 7,

  allowRepair: true,
  castleUpgrade: true,
  stratagems: ['ice_storm', 'fire_attack', 'reinforcements'],

  /** 마지막 장은 누수를 전제로 한다. 3별은 "제갈량을 성문 앞에서 끊었다"는 뜻이다. */
  stars: { three: 0.55, two: 0.18 },

  path: PATH,
  buildSlots: BUILD_SLOTS,

  waves: generateWaves({
    count: 15,
    /*
     * 물량은 3장을 기준으로 장마다 1.5배씩 붙는다 — 3장 x1, 4장 x1.5,
     * 5장 x2.25, 6장 x3.4. 뒤로 갈수록 "같은 답을 더 크게" 요구하는 것이
     * 이 게임의 후반이고, 그 크기를 여기 두 값이 정한다.
     */
    /*
     * 마지막 장인데 최종 웨이브가 68기로 4·5장(85기)보다 **적었다.** 규모가
     * 이 장의 유일한 새 것이라고 적어 놓고 정작 규모가 앞 장보다 작았던 것이다.
     * 이제 237기로, 4장(135)의 1.8배·5장(188)의 1.3배다.
     */
    baseCount: 41,
    countStep: 14,
    /*
     * 물량만 늘리면 "같은 적이 많이" 온다. 한 마리도 같이 두꺼워져야 후반이 무겁다.
     *
     * 0.10 -> 0.140. 이 값은 벼랑 위에 있다 — 0.135 면 성이 20 밖에 안 깎이고,
     * 0.145 면 13파에서 무너진다. 0.140 에서 성 1174/1360, 누수 119 로 끝난다
     * (바꾸기 전에는 1330/1360, 누수 26 이었다). 손대려면 0.005 씩 움직이고
     * tests/level0456.test.ts 의 출력으로 확인할 것.
     */
    hpGrowth: 0.140,
    speedGrowth: 0.014,
    spawnInterval: (n) => Math.max(0.28, 0.85 - 0.026 * n),
    formationColumns: 5,
    laneSpacing: 20,

    /**
     * 연노병 10 : 백이병 5 : 목우유마 1.
     * 목우가 하나뿐인 것은 3장의 기수와 같은 이유다 — 회복 오라는 겹치지 않는다.
     * 대신 감속이 안 통하고 체력이 640이라 "지금 저걸 끊을 수 있나"가 매번 문제가 된다.
     */
    mix: [
      { unitId: 'sh_repeater', from: 1, weight: 10 },
      { unitId: 'sh_chainmail', from: 3, weight: 5 },
      { unitId: 'sh_supply', from: 6, weight: 1 },
      // 기병 계보의 끝. 5장(비중 5)보다 늘어나고 3파부터 일찍 온다
      { unitId: 'sh_cavalry', from: 3, weight: 7 },
    ],

    patterns: {
      2: { countMul: 1.3, hpMul: 0.88, groupSize: 12, intraInterval: 0.08, groupGap: 1.7 },
      // 백이진 — 2장의 방패진을 그대로 다시 낸다. 이번엔 불도 통하지 않는다.
      4: {
        countMul: 0.9, hpMul: 1.12, groupSize: 10, intraInterval: 0.18, groupGap: 2.5,
        mix: [{ unitId: 'sh_chainmail', from: 1, weight: 7 }, { unitId: 'sh_repeater', from: 1, weight: 3 }],
      },
      6: {
        countMul: 1.1, groupSize: 10, intraInterval: 0.12, groupGap: 2.1,
        mix: [
          { unitId: 'sh_supply', from: 1, weight: 2 },
          { unitId: 'sh_repeater', from: 1, weight: 6 },
          { unitId: 'sh_chainmail', from: 1, weight: 2 },
        ],
      },
      8: { countMul: 1.55, hpMul: 0.84, speedMul: 1.1, groupSize: 16, intraInterval: 0.06, groupGap: 1.5 },
      10: { countMul: 0.85, hpMul: 1.2, groupSize: 9, intraInterval: 0.2, groupGap: 2.8 },
      12: {
        countMul: 1.2, speedMul: 1.2, groupSize: 12, intraInterval: 0.08, groupGap: 1.8,
        mix: [
          { unitId: 'sh_supply', from: 1, weight: 2 },
          { unitId: 'sh_chainmail', from: 1, weight: 4 },
          { unitId: 'sh_repeater', from: 1, weight: 4 },
        ],
      },
      13: { countMul: 1.35, hpMul: 0.95, groupSize: 14, intraInterval: 0.07, groupGap: 1.6 },
      14: { countMul: 0.9, hpMul: 1.35, speedMul: 0.9, groupSize: 9, intraInterval: 0.26, groupGap: 3.0 },
      /**
       * 마지막 웨이브. 병력 수를 1.4배로 부풀리고 그 한가운데에 제갈량을 넣는다.
       * 제갈량의 회복 오라(반경 210 · 초당 90)가 이 대열을 통째로 덮으므로,
       * 앞줄부터 지우려 들면 영영 줄지 않는다 — 먼저 본체를 끊어야 한다.
       */
      15: { countMul: 1.4, hpMul: 1.08, groupSize: 14, intraInterval: 0.08, groupGap: 1.7 },
    },

    inserts: {
      10: [{ unitId: 'jiangwei', atRatio: 0.5, hpMul: 1 }],
      15: [{ unitId: 'zhugeliang', atRatio: 0.35, hpMul: 1 }],
    },

    banner: (n, isBoss) => {
      if (n === 2) return `제 ${waveLabel(n)}파 — 연노 제일진`;
      if (n === 4) return `제 ${waveLabel(n)}파 — 백이진`;
      if (n === 6) return `제 ${waveLabel(n)}파 — 목우유마 보급대`;
      if (n === 8) return `제 ${waveLabel(n)}파 — 북벌 대열`;
      if (n === 10) return `제 ${waveLabel(n)}파 — 강유`;
      if (n === 12) return `제 ${waveLabel(n)}파 — 촉 정예군`;
      if (n === 14) return `제 ${waveLabel(n)}파 — 오장원 결사대`;
      if (n === 15) return `제 ${waveLabel(n)}파 — 제갈량`;
      return isBoss ? `제 ${waveLabel(n)}파 — 적장 출현` : `제 ${waveLabel(n)}파`;
    },
    reward: () => 0,
  }),

  environment: {
    landscape: 'loess',
    // 가을 위수 강가의 마른 들 — 이 게임의 마지막 색은 저물녘이다
    skyColor: '#c8b39a',
    groundColor: '#7a7050',
    lowColor: '#5f5638',
    highColor: '#a09363',
    fogColor: '#d3c1a8',
    terrainTexture: 'ground_dry',
    terrainRelief: 4.0,
    biome: 'drylands',
    bgmYoutubeId: '6Keux8E6GVw',
  },
};
