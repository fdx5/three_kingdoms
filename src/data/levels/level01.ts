import type { LevelDef } from '../../types/level';
import { generateWaves, waveLabel } from '../waves';

/**
 * 레벨 1 — 황건적의 난.
 *
 * 경로 설계 의도
 * ---------------
 * 24x14 격자(1200 x 700 u) 위를 서에서 동으로 가로지르며 3번의 헤어핀(U턴)을 만든다.
 * 헤어핀의 두 평행 구간 간격은 120u — 사거리 100의 타워를 그 사이에 놓으면
 * 양쪽 구간과 연결부(cap)를 동시에 덮는다. 이게 "좋은 자리"의 정의다.
 * 총 길이는 아래 tests/level01.test.ts 에서 1800~2200u 범위로 검증한다.
 *
 * 큰 꺾임(90도) 지점: (150,350) (150,170) (270,170) (270,350) (490,350) (490,540)
 *                    (610,540) (610,350) (800,350) (800,170) (920,170) (920,350)
 * → 12회. 요구치(최소 4회)를 크게 넘는다.
 */
const PATH: [number, number][] = [
  [0, 350],     // 서쪽 관문 — 적 진입
  [150, 350],
  [150, 170],   // ┐ 헤어핀 1
  [270, 170],   // │
  [270, 350],   // ┘
  [490, 350],
  [490, 540],   // ┐ 헤어핀 2 (남쪽)
  [610, 540],   // │
  [610, 350],   // ┘
  [800, 350],
  [800, 170],   // ┐ 헤어핀 3
  [920, 170],   // │
  [920, 350],   // ┘
  [1090, 350],  // 호뢰관 — 성
];

/**
 * 건설 슬롯 5개. 사거리 100u 기준으로 각 슬롯이 덮는 경로 길이는
 * tests/level01.test.ts 가 실제로 계산해 출력한다. 아래 주석은 그 계산의 요약이다.
 *
 * slot_a  헤어핀 1 안쪽  ≈ 400u  (좌 140 + 우 140 + cap 120)   ★ 좋은 자리
 * slot_b  헤어핀 2 안쪽  ≈ 400u  (좌 140 + 우 140 + cap 120)   ★ 좋은 자리
 * slot_c  헤어핀 3 안쪽  ≈ 400u  (좌 140 + 우 140 + cap 120)   ★ 좋은 자리
 * slot_d  직선 구간 옆   ≈ 143u  (z=350 직선만 덮는다)          — 나쁜 자리
 * slot_e  종점 직선 옆   ≈ 132u  (성 앞 직선만 덮는다)          — 나쁜 자리
 *
 * 좋은 자리와 나쁜 자리의 차이가 약 3배다. 배치 판단에 의미가 생긴다.
 */
const BUILD_SLOTS = [
  { id: 'slot_a', x: 210, z: 238 },
  { id: 'slot_b', x: 550, z: 472 },
  { id: 'slot_c', x: 860, z: 238 },
  { id: 'slot_d', x: 380, z: 420 },
  { id: 'slot_e', x: 1000, z: 425 },
];

export const LEVEL_01: LevelDef = {
  id: 'level01',
  title: '황건적의 난 — 호뢰관 방어',

  castle: { id: 'hulao_gate', hp: 1000 },
  startGold: 250,

  path: PATH,
  buildSlots: BUILD_SLOTS,

  waves: generateWaves({
    count: 12,
    unitId: 'yt_infantry',
    baseCount: 12,
    countStep: 3,
    /*
     * 0.20 -> 0.26. 앞선 값에서는 최적 플레이가 12파를 무손실(1000/1000, 누수 0)로
     * 끝냈다 — 첫 장이 배우는 장인 것과 별개로, 아무 일도 일어나지 않는 장이었다.
     * 0.26 이면 같은 최적 플레이가 992/1000 에 누수 2 로 끝나고, 손이 느리면 그대로 깎인다.
     * 위로는 여유가 없다: 0.27 에서 모퉁이 3기 방어가 무너지고(그 장의 교훈이 사라진다)
     * 0.30 이면 전 슬롯 만렙도 성이 3분의 1로 준다. 손대려면 0.01 씩 움직일 것.
     */
    /*
     * 0.26 -> 0.245. 타워 업그레이드 곡선을 눕히면서(difficulty.towerLevelFalloff)
     * 이 장의 교훈("업그레이드를 하면 나쁜 배치로도 이긴다")이 깨졌다 —
     * 모퉁이 3기가 12파에서 무너졌다. 전역 가산치(+0.005)를 더하면 실효 0.25 로,
     * 조이기 전(0.26)보다 한 걸음만 무르다. 1장은 배우는 장이라 여기서 막히면 안 된다.
     */
    hpGrowth: 0.245,
    speedGrowth: 0.02,
    spawnInterval: (n) => Math.max(0.4, 1.1 - 0.03 * n),
    formationColumns: 3,
    laneSpacing: 24,
    patterns: {
      3: { countMul: 1.45, hpMul: 0.8, groupSize: 9, intraInterval: 0.18, groupGap: 2.2 },
      5: { countMul: 0.8, speedMul: 1.5, groupSize: 6, intraInterval: 0.12, groupGap: 1.7 },
      6: { countMul: 0.85, hpMul: 1.15, groupSize: 8, intraInterval: 0.22, groupGap: 2.4 },
      8: { countMul: 1.25, groupSize: 12, intraInterval: 0.13, groupGap: 2.1 },
      10: { countMul: 0.78, hpMul: 1.45, speedMul: 0.88, groupSize: 7, intraInterval: 0.3, groupGap: 2.8 },
      11: { countMul: 1.6, hpMul: 0.82, groupSize: 14, intraInterval: 0.1, groupGap: 1.8 },
      12: { countMul: 1.15, hpMul: 1.15, groupSize: 10, intraInterval: 0.16, groupGap: 2.0 },
    },
    inserts: {
      6: [{ unitId: 'yt_captain', atRatio: 0.5, hpMul: 2 }],
      12: [{ unitId: 'zhangjiao', atRatio: 0.5, hpMul: 3 }],
    },
    banner: (n, isBoss) => {
      if (n === 3) return `제 ${waveLabel(n)}파 — 황건의 인해전술`;
      if (n === 5) return `제 ${waveLabel(n)}파 — 기습 돌격`;
      if (n === 6) return `제 ${waveLabel(n)}파 — 황건적 두목`;
      if (n === 8) return `제 ${waveLabel(n)}파 — 파상 공세`;
      if (n === 10) return `제 ${waveLabel(n)}파 — 결사대`;
      if (n === 11) return `제 ${waveLabel(n)}파 — 최후의 인해전술`;
      if (n === 12) return `제 ${waveLabel(n)}파 — 장각`;
      return isBoss ? `제 ${waveLabel(n)}파 — 적장 출현` : `제 ${waveLabel(n)}파`;
    },
    reward: () => 0,
  }),

  environment: {
    skyColor: '#b9c6d4',
    groundColor: '#6f6244',
    lowColor: '#5d4c34',
    highColor: '#8f8358',
    fogColor: '#c3cbd4',
    terrainTexture: 'ground_dry',
    terrainRelief: 3.3,
    biome: 'drylands',
    // 배경음: https://youtu.be/zYY4gbajgKY
    bgmYoutubeId: 'zYY4gbajgKY',
  },
};
