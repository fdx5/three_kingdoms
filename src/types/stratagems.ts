/**
 * 계략 — 일회성 골드 소비처.
 *
 * 타워가 "미리 놓는 답"이라면 계략은 "그 순간에 쓰는 답"이다.
 * 성벽 수리가 웨이브 사이의 소비처라면, 계략은 웨이브 한복판의 소비처다.
 * 둘 다 있어야 남는 골드가 죽은 자원이 되지 않는다.
 */

export type StratagemEffect =
  /** 화공 — 폭풍이 지속되는 동안 모든 적에게 화염 지속 피해 */
  | { type: 'fire_storm'; params: { dps: number; duration: number } }
  /** 얼음폭풍 — 감속 면역과 무관하게 이동·공격·오라 정지 */
  | { type: 'ice_storm'; params: { duration: number } }
  /** 원군 — 일정 시간 모든 타워의 피해량 증폭 */
  | { type: 'rally'; params: { damageMul: number; duration: number } };

export interface StratagemDef {
  id: string;
  displayName: string;
  /** 버튼에 쓰는 한 글자 (에셋이 없어도 읽힌다) */
  glyph: string;
  description: string;
  cost: number;
  /** 재사용 대기 시간(초). 이게 없으면 골드가 있는 한 연타할 수 있다. */
  cooldown: number;
  effect: StratagemEffect;
  /** 이 레벨부터 쓸 수 있다. 없으면 처음부터 (단, 레벨이 stratagems 목록에 넣어야 보인다) */
  unlockedIn?: string;
}

/** 계략 버튼이 지금 왜 눌리지 않는가 */
export type StratagemStatus = 'ok' | 'disabled' | 'cooldown' | 'no_gold' | 'no_target';
