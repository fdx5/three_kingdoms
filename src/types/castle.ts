import type { FireSource } from './towers';

/**
 * 성문이 무엇으로 반격하는가.
 *   arrow  성가퀴의 궁수 — 화살 여러 발을 연사한다 (ranged)
 *   cannon 포문 — 포탄이 지면을 강타해 터지고 불을 남긴다 (siege)
 *   flame  화룡구 — 좌우 망루에서 목표를 향해 양쪽에서 불을 뿜는다 (fire)
 */
export type CastleWeaponKind = 'arrow' | 'cannon' | 'flame';

export interface CastleWeaponDef {
  kind: CastleWeaponKind;
  /** 한 번에 나가는 발수. 이 값이 곧 "몇 발 연사인가"다. */
  shots: number;
  damagePerShot: number;
  /** 초 */
  fireInterval: number;
  /** 성문에서 이 거리 안의 적을 때린다 */
  range: number;
  projectileSpeed: number;
  projectileArcHeight: number;
  /** 착탄 폭발 반경. 0이면 단일 대상. */
  splashRadius: number;
  splashFalloff: number;
  /** 착탄 지점에 남는 불. 없으면 불이 붙지 않는다. */
  ignite?: { radius: number; dps: number; duration: number };
  /** 투사체가 남기는 불의 종류 (뷰 연출용) */
  fireSource: FireSource;
  /**
   * 발사구를 좌우 망루로 나눌 것인가.
   * true면 홀짝으로 좌·우 망루가 번갈아 쏘고, 화룡구는 두 발이 동시에
   * 양쪽에서 목표를 향해 날아간다 — "양방향에서 불이 닿는다".
   */
  dualMuzzle: boolean;
}

export interface CastleLevelDef {
  /** 1-base */
  level: number;
  /** 성문 패널에 뜨는 이름 */
  title: string;
  /** 한 줄 설명 */
  description: string;
  /** 레벨 1은 null (성의 기본 상태다) */
  upgradeCost: number | null;
  /** 이 레벨이 되는 순간 최대 체력에 더해지는 값 (즉시 그만큼 회복도 된다) */
  hpBonus: number;
  weapon: CastleWeaponDef;
}
