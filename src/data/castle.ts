import type { CastleLevelDef } from '../types/castle';

/**
 * 성문 강화 표 — 성은 맞기만 하는 벽이 아니라 여섯 단계로 자라는 마지막 타워다.
 *
 * 왜 성문에 무기를 두는가
 * ----------------------
 * 이 게임의 실패는 늘 "마지막 직선을 못 막았다"의 형태로 온다. 그런데 그 자리는
 * 슬롯이 하나뿐이라 타워로는 더 두껍게 만들 수 없었다. 성문 강화는 바로 그
 * 마지막 한 겹을 플레이어가 직접 살 수 있게 하는 소비처다 —
 * 성벽 수리가 "이미 난 피해를 되돌리는 값"이라면, 이쪽은 "피해가 나지 않게 하는 값"이다.
 *
 * 단계 (사양 그대로)
 * ------------------
 *   Lv1  활 2발 연사          — 성의 기본 상태. 앞 세 장의 성이 이것이다.
 *   Lv2  활 4발 연사          — 같은 화살을 두 배로. 무리를 흩는다.
 *   Lv3  대포 2발             — 지면을 강타해 터지고, 그 자리에 불이 남는다.
 *   Lv4  대포 2발 (증강)      — 폭발이 넓어지고 지면의 불이 더 오래 탄다.
 *   Lv5  대포 4발             — 발수가 두 배, 지면 지속 피해가 확연히 크다.
 *   Lv6  화룡구 — 양방향 화염 — 좌우 망루가 목표 하나를 양쪽에서 태운다.
 *
 * 단계가 내려가는 일은 없다
 * ---------------------------
 * 무기가 바뀌는 단계(2->3, 5->6)에서 초당 피해가 앞 단계보다 낮으면,
 * 돈을 쓰고도 단일 목표를 더 늦게 죽이게 된다 — 강화가 함정이 된다.
 * 그래서 발수·피해·간격은 늘 앞 단계보다 높은 초당 피해가 나오게 잡았고,
 * tests/castle 이 그것을 매 단계 검사한다. 폭발과 지면 화염은 그 위에 얹히는 덤이다.
 *
 * 값의 감각
 * ---------
 * 성문 하나를 6까지 올리는 데 4,200 G가 든다. 만렙 화포 진지(1,590 G) 두 기
 * 하고도 남는 값이다 — 성문 강화가 항상 이득이면 타워를 지을 이유가 사라지므로,
 * "슬롯이 모자란 마지막 구간을 살 때만" 이득이 되도록 잡았다.
 * 대신 성문은 팔 수 없고 옮길 수도 없다. 사거리 안에 들어온 적만 때린다.
 */
export const CASTLE_LEVELS: CastleLevelDef[] = [
  {
    level: 1,
    title: '성가퀴',
    description: '성문 위 궁수가 화살 2발을 연사한다.',
    upgradeCost: null,
    hpBonus: 0,
    weapon: {
      kind: 'arrow',
      shots: 2,
      damagePerShot: 10,
      fireInterval: 0.5,
      // 앞 세 장의 성은 성문에 달라붙은 적만 때렸다. 그 감각을 그대로 둔다.
      range: 130,
      projectileSpeed: 300,
      projectileArcHeight: 18,
      splashRadius: 0,
      splashFalloff: 0,
      fireSource: 'arrow',
      dualMuzzle: false,
    },
  },
  {
    level: 2,
    title: '연노 성가퀴',
    description: '쇠뇌를 걸어 화살 4발을 연사한다. 사거리도 조금 는다.',
    upgradeCost: 300,
    hpBonus: 50,
    weapon: {
      kind: 'arrow',
      shots: 4,
      damagePerShot: 10,
      fireInterval: 0.5,
      range: 165,
      projectileSpeed: 320,
      projectileArcHeight: 18,
      splashRadius: 0,
      splashFalloff: 0,
      fireSource: 'arrow',
      dualMuzzle: true,
    },
  },
  {
    level: 3,
    title: '포문',
    description: '대포 2발. 지면을 강타해 터지고 그 자리에 불이 남는다.',
    upgradeCost: 520,
    hpBonus: 70,
    weapon: {
      kind: 'cannon',
      shots: 2,
      damagePerShot: 55,
      fireInterval: 1.25,
      range: 195,
      projectileSpeed: 260,
      projectileArcHeight: 46,
      // 화살과 달리 빗나가도 터진다 — 뭉쳐 오는 마지막 직선의 답이다.
      splashRadius: 72,
      splashFalloff: 0.5,
      ignite: { radius: 60, dps: 12, duration: 4.0 },
      fireSource: 'shell',
      dualMuzzle: true,
    },
  },
  {
    level: 4,
    title: '중포문',
    description: '같은 2발이지만 폭발이 넓고 지면의 불이 더 오래 탄다.',
    upgradeCost: 780,
    hpBonus: 90,
    weapon: {
      kind: 'cannon',
      shots: 2,
      damagePerShot: 72,
      fireInterval: 1.2,
      range: 215,
      projectileSpeed: 270,
      projectileArcHeight: 46,
      splashRadius: 86,
      splashFalloff: 0.45,
      ignite: { radius: 72, dps: 18, duration: 5.0 },
      fireSource: 'shell',
      dualMuzzle: true,
    },
  },
  {
    level: 5,
    title: '연환포대',
    description: '대포 4발 연사. 지면에 남는 불이 확연히 크고 오래간다.',
    upgradeCost: 1100,
    hpBonus: 110,
    weapon: {
      kind: 'cannon',
      shots: 4,
      damagePerShot: 48,
      fireInterval: 1.15,
      range: 235,
      projectileSpeed: 280,
      projectileArcHeight: 44,
      splashRadius: 96,
      splashFalloff: 0.42,
      // 4발이 흩어져 떨어지고 각각 불을 남기므로, 마지막 직선이 통째로 불바다가 된다.
      ignite: { radius: 84, dps: 26, duration: 6.5 },
      fireSource: 'shell',
      dualMuzzle: true,
    },
  },
  {
    level: 6,
    title: '화룡구',
    description: '좌우 망루가 목표 하나를 양쪽에서 태운다. 닿으면 크게 무너진다.',
    upgradeCost: 1500,
    hpBonus: 140,
    weapon: {
      kind: 'flame',
      // 2발 = 좌 망루 한 줄기 + 우 망루 한 줄기. 이 둘이 목표에서 만난다.
      shots: 2,
      damagePerShot: 112,
      fireInterval: 0.9,
      range: 260,
      // 불줄기는 포물선을 그리지 않는다 — 곧게 뻗어 목표를 감싼다.
      projectileSpeed: 420,
      projectileArcHeight: 6,
      splashRadius: 66,
      splashFalloff: 0.3,
      ignite: { radius: 92, dps: 44, duration: 7.5 },
      fireSource: 'flame',
      dualMuzzle: true,
    },
  },
];

export const MAX_CASTLE_LEVEL = CASTLE_LEVELS.length;

export function castleLevelDef(level: number): CastleLevelDef {
  const i = Math.min(CASTLE_LEVELS.length, Math.max(1, level)) - 1;
  return CASTLE_LEVELS[i];
}

/** level 1..n 까지 올리는 데 든 총 골드 */
export function castleUpgradeTotal(level: number): number {
  let sum = 0;
  for (let i = 1; i < Math.min(level, CASTLE_LEVELS.length); i++) {
    sum += CASTLE_LEVELS[i].upgradeCost ?? 0;
  }
  return sum;
}

/** level 1..n 까지 올렸을 때 더해진 최대 체력 총합 */
export function castleHpBonusTotal(level: number): number {
  let sum = 0;
  for (let i = 1; i < Math.min(level, CASTLE_LEVELS.length); i++) {
    sum += CASTLE_LEVELS[i].hpBonus;
  }
  return sum;
}
