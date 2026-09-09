import type { PrimitiveSpec } from './primitives';

export type TargetingMode = 'first' | 'last' | 'strongest' | 'closest';

/**
 * 타워의 동작 방식.
 * projectile — 사거리 내 적에게 화살/돌을 쏜다 (궁노 망루, 투석기)
 * aura       — 투사체 없이 사거리 안 적에게 지속 효과를 건다 (함정)
 */
export type TowerKind = 'projectile' | 'aura';

/**
 * 피해 종류.
 *   ranged 방패병의 rangedResist를 받는다 (화살)
 *   siege  저항을 받지 않는다 (돌·포탄)
 *   fire   fireResist / fireVuln 을 받는다 (화염). 젖은 적에게 막히고 마른 적에게 두 배다.
 */
export type DamageKind = 'ranged' | 'siege' | 'fire';

/** 지면에 남는 불의 출처. 뷰가 이 값으로 불의 크기와 연출을 고른다. */
export type FireSource = 'arrow' | 'stone' | 'flame' | 'shell';

export type TowerEffect =
  | { type: 'splash'; params: { radius: number; falloff: number } }
  | { type: 'slow'; params: { speedMul: number; duration: number } };

/**
 * 착탄 지점에 불을 남기는 규칙.
 *
 * 없으면 BALANCE.fire 의 기본값을 쓴다 — 궁노 망루와 벽력거는 3레벨부터
 * 무기가 달아올라 불을 남긴다(기존 동작). 화공 망루처럼 불이 곧 정체성인
 * 타워는 여기에 자기 값을 적어 1레벨부터, 더 크게 태운다.
 */
export interface IgniteDef {
  /** 이 레벨부터 불이 붙는다 */
  fromLevel: number;
  radius: number;
  dps: number;
  duration: number;
  /** 레벨이 1 오를 때마다 dps에 곱해지는 값. 없으면 1 (레벨과 무관). */
  dpsPerLevel?: number;
  source: FireSource;
}

export interface TowerLevelDef {
  /**
   * 한 번 발사에 나가는 발사체 수. 서로 다른 적을 노린다.
   * aura 타워에서는 "동시에 거는 대상 수"를 뜻한다.
   */
  arrows: number;
  damagePerArrow: number;
  /** 초 */
  fireInterval: number;
  /** world unit */
  range: number;
  /** level 1은 null (건설비로 대신한다) */
  upgradeCost: number | null;
  view: { primitive: PrimitiveSpec; modelId?: string };
}

export interface ProjectileDef {
  /** world unit / sec */
  speed: number;
  /** 포물선 최고점 높이 (u) */
  arcHeight: number;
  modelId?: string;
}

export interface TowerDef {
  id: string;
  displayName: string;
  /** 한 줄 설명 — 건설 패널에서 무엇에 강한지 알려준다 */
  description: string;
  buildCost: number;
  /** 판매 환급률 (0~1) */
  sellRatio: number;
  kind: TowerKind;
  /** 화살이 받는 피해 종류. aura 타워는 무시된다. */
  damageKind: DamageKind;
  targeting: TargetingMode;
  projectile: ProjectileDef;
  /** 길이 5 */
  levels: TowerLevelDef[];
  /** splash / slow. 없으면 단일 대상 직접 피해다. */
  effect?: TowerEffect;
  /** 착탄 지점에 남기는 불. 없으면 BALANCE.fire 기본값(3레벨부터). */
  ignite?: IgniteDef;
  /**
   * 포구 연출 — 쏜 그 무기의 주둥이에서 터지는 섬광과 화약 연기.
   *
   * 던지는 무기(궁노의 화살, 벽력거의 돌)에는 없다. 화약을 터뜨려 밀어내는
   * 무기만 갖는다. 뷰는 `TowerView.muzzle()` 이 알려준 자리에서 이걸 뿜으므로,
   * 다섯 문 중 **실제로 쏜 그 문**에서만 불이 인다.
   */
  muzzleBlast?: {
    /** 포구 화염의 크기 배수 */
    flash: number;
    /** 뒤따라 번지는 화약 연기의 크기 배수 */
    smoke: number;
    /** 발사할 때 화면이 흔들리는 정도 (BALANCE.fx 기준값에 곱해진다). 없으면 흔들지 않는다 */
    shake?: number;
  };
  /**
   * 얼마나 단단한가 — 체력 배수. 없으면 1.
   *
   * 체력 자체는 표에 적지 않는다. 투자한 골드에 비례하고(BALANCE.towerCombat.hpPerGold)
   * 여기서 종류의 차이만 얹는다: 돌과 쇠로 쌓은 화포 진지는 두껍고, 땅에 깐
   * 철질려 진지는 애초에 부술 것이 별로 없다. 값과 단단함을 따로 적으면
   * "왜 더 비싼 게 더 잘 부서지나"를 설명할 수 없게 된다.
   */
  toughness?: number;
  /** 이 타워를 쓸 수 있게 되는 레벨 id. 없으면 처음부터 사용 가능. */
  unlockedIn?: string;
}
