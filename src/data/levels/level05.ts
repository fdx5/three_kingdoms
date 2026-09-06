import type { LevelDef } from '../../types/level';
import { generateWaves, waveLabel } from '../waves';

/**
 * 레벨 5 — 번성 공방전. 관우의 형주군을 번성에서 막는다.
 *
 * 관우는 한수를 터뜨려 우금의 칠군을 물에 잠기게 했다(수엄칠군).
 * 그래서 이 장의 적은 전부 **젖어 있다** — 4장에서 배운 화공이 통하지 않는다.
 * 레벨 5가 가르치는 것은 **답은 하나가 아니다**: 불이 막히면 포탄으로 뚫는다.
 *
 * 새로 열리는 것
 * -------------
 *   화포 진지   포탄이 지면을 강타해 크게 터지고 불구덩이를 남긴다. 사거리 175~210.
 *
 * 왜 화포가 필요한가 — 슬롯이 그렇게 생겼다
 * -----------------------------------------
 * 이 장의 경로는 길고 넓게 벌어져 있어서, 슬롯 여섯 중 하나(s5_d)는
 * **사거리 100으로는 경로를 아예 못 닿는다**(0u). 그런데 사거리 150이면 511u,
 * 화포의 175면 그보다 더 덮는다. 궁노 망루를 거기 지으면 돈만 버리는 자리다.
 * "사거리가 곧 성능"이라는 축을 처음으로 정면에 세우는 장이다.
 *
 * 형주군이 내는 문제
 * -----------------
 *   형주 수군   화염 80% 차단 — 화공 망루가 거의 아무 일도 못 한다
 *   대도수      화살 50% + 화염 55% 차단. 남는 답은 공성 피해 하나
 *   공성 목우   감속 면역 + 체력 520 + 성 피해 60. 성문 사거리로 미리 깎아야 한다
 *   관우        화염 75% 차단 + 돌진 + 전군 가속. 이 게임에서 가장 단단한 적
 *
 * 경로 설계
 * ---------
 * 긴 직선 넷(460u · 240u · 300u · 480u)과 헤어핀 셋. 총 길이 2950u —
 * 여섯 장 중 가장 길다. 길다는 것은 곧 사거리 긴 타워가 값을 한다는 뜻이다.
 */
const PATH: [number, number][] = [
  [0, 620], // 남서쪽 한수 나루에서 올라온다
  [240, 620],
  [240, 420], // ┐ 헤어핀 A
  [60, 420], // │
  [60, 180], // ┘
  [520, 180], // ── 북쪽 직선 460u
  [520, 420],
  [760, 420], // ── 중앙 직선 240u
  [760, 120], // ┐ 북으로 되꺾는다
  [1000, 120], // │
  [1000, 600], // ┘ ── 성 앞 세로 직선 480u
  [1130, 600],
];

/**
 * 건설 슬롯 6개. 사거리별 커버리지가 슬롯마다 완전히 다르다 —
 * 이 표가 곧 이 장의 문제지다 (tests/level05 에서 실제로 계산해 검증한다).
 *
 *          사거리100   사거리150
 * s5_a       230u        562u    헤어핀 A 안쪽 — 어느 타워든 값을 한다
 * s5_b       283u        413u    헤어핀 A 바깥 ★
 * s5_c       278u        394u    북쪽 직선 옆 ★
 * s5_d         0u        511u    ← 궁노를 지으면 아무것도 못 맞힌다. 화포의 자리
 * s5_e       120u        244u    성 앞 — 마지막 방어선
 * s5_f        87u        240u    성 앞 세로 직선 옆 — 나쁜 자리
 */
const BUILD_SLOTS = [
  { id: 's5_a', x: 170, z: 530 },
  { id: 's5_b', x: 128, z: 352 },
  { id: 's5_c', x: 470, z: 250 },
  { id: 's5_d', x: 620, z: 300 }, // 사거리 100으로는 못 닿는 자리
  { id: 's5_e', x: 920, z: 540 },
  { id: 's5_f', x: 1090, z: 400 },
];

export const LEVEL_05: LevelDef = {
  id: 'level05',
  title: '번성 공방전 — 한수 범람',

  castle: { id: 'fancheng_gate', hp: 800 },

  /**
   * 시작 골드 600 — 화포 한 기(300 G)와 궁노 한 기를 세우고 시작할 수 있다.
   * 화포가 이 장의 답인데 첫 다섯 웨이브를 버틴 뒤에야 살 수 있으면
   * "답을 알았을 때는 이미 늦은" 장이 된다.
   */
  startGold: 700,

  waveInterval: 19,
  firstWaveDelay: 26,
  earlyCallBonusPerSecond: 6,

  allowRepair: true,
  castleUpgrade: true,

  /**
   * 계략을 다시 연다. 4장에서 성문 강화를 배웠으므로 소비처가 둘이어도 헷갈리지 않고,
   * 관우(체력 5200 · 화염 75% 차단)에게는 화공 계략이 여전히 유효한 답이다 —
   * 계략의 화공은 공성 피해라 화염 저항을 받지 않는다.
   */
  stratagems: ['ice_storm', 'fire_attack', 'reinforcements'],

  stars: { three: 0.58, two: 0.2 },

  path: PATH,
  buildSlots: BUILD_SLOTS,

  waves: generateWaves({
    count: 15,
    baseCount: 15,
    countStep: 5,
    hpGrowth: 0.145,
    speedGrowth: 0.012,
    spawnInterval: (n) => Math.max(0.34, 0.92 - 0.026 * n),
    formationColumns: 4,
    laneSpacing: 20,

    /**
     * 수군이 기본이고 대도수가 4파부터, 목우가 7파부터 섞인다.
     * 목우 비중이 1인 이유는 하나여도 충분하기 때문이다 —
     * 체력 520에 성 피해 60이라 한 기만 새어도 성 체력의 7.5%가 날아간다.
     */
    mix: [
      { unitId: 'jz_marine', from: 1, weight: 10 },
      { unitId: 'jz_halberd', from: 4, weight: 5 },
      { unitId: 'jz_oxcart', from: 7, weight: 1 },
    ],

    patterns: {
      3: { countMul: 1.35, hpMul: 0.85, groupSize: 12, intraInterval: 0.09, groupGap: 1.8 },
      // 대도수 밀집 — 화살도 불도 반쯤 흘리는 벽이 처음으로 온다
      4: {
        countMul: 0.9, hpMul: 1.1, groupSize: 8, intraInterval: 0.2, groupGap: 2.6,
        mix: [{ unitId: 'jz_halberd', from: 1, weight: 6 }, { unitId: 'jz_marine', from: 1, weight: 4 }],
      },
      6: { countMul: 1.15, speedMul: 1.12, groupSize: 11, intraInterval: 0.1, groupGap: 1.9 },
      // 목우 행렬 — 감속이 통하지 않는 수레 셋이 나란히 굴러온다
      7: {
        countMul: 0.7, hpMul: 1.05, groupSize: 6, intraInterval: 0.3, groupGap: 3.2,
        mix: [{ unitId: 'jz_oxcart', from: 1, weight: 3 }, { unitId: 'jz_marine', from: 1, weight: 7 }],
      },
      9: { countMul: 0.85, hpMul: 1.18, groupSize: 9, intraInterval: 0.2, groupGap: 2.7 },
      11: { countMul: 1.5, hpMul: 0.86, groupSize: 15, intraInterval: 0.07, groupGap: 1.6 },
      13: {
        countMul: 1.1, speedMul: 1.15, groupSize: 10, intraInterval: 0.1, groupGap: 2.0,
        mix: [
          { unitId: 'jz_halberd', from: 1, weight: 5 },
          { unitId: 'jz_oxcart', from: 1, weight: 1 },
          { unitId: 'jz_marine', from: 1, weight: 4 },
        ],
      },
      14: { countMul: 0.85, hpMul: 1.3, speedMul: 0.9, groupSize: 8, intraInterval: 0.25, groupGap: 3.0 },
      15: { countMul: 1.25, hpMul: 1.08, groupSize: 12, intraInterval: 0.09, groupGap: 1.8 },
    },

    inserts: {
      9: [{ unitId: 'guanping', atRatio: 0.55, hpMul: 1 }],
      15: [{ unitId: 'guanyu', atRatio: 0.4, hpMul: 1 }],
    },

    banner: (n, isBoss) => {
      if (n === 3) return `제 ${waveLabel(n)}파 — 물길을 따라`;
      if (n === 4) return `제 ${waveLabel(n)}파 — 대도수 밀집대형`;
      if (n === 7) return `제 ${waveLabel(n)}파 — 목우 행렬`;
      if (n === 9) return `제 ${waveLabel(n)}파 — 관평`;
      if (n === 11) return `제 ${waveLabel(n)}파 — 범람`;
      if (n === 13) return `제 ${waveLabel(n)}파 — 형주 공성대`;
      if (n === 14) return `제 ${waveLabel(n)}파 — 형주 결사대`;
      if (n === 15) return `제 ${waveLabel(n)}파 — 관우`;
      return isBoss ? `제 ${waveLabel(n)}파 — 적장 출현` : `제 ${waveLabel(n)}파`;
    },
    reward: () => 0,
  }),

  environment: {
    landscape: 'floodplain',
    // 물에 잠긴 들판 — 잿빛 하늘과 진흙
    skyColor: '#9fa8ad',
    groundColor: '#5a5f4e',
    lowColor: '#454a3c',
    highColor: '#7c8163',
    fogColor: '#aab3b8',
    terrainTexture: 'ground_rocky',
    terrainRelief: 2.2,
    biome: 'woodland',
    bgmYoutubeId: 'deyim16dRzE',
  },
};
