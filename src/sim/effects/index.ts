import type { Enemy } from '../Enemy';
import type { DamageKind, TowerEffect } from '../../types/towers';

/**
 * 타워 효과. 새 타워 종류를 추가할 때 여기에 함수 하나만 더하면 된다
 * (docs/EXTENDING.md "새 타워 종류 추가" 참고).
 *
 * 모든 함수는 순수하다 — three도 EventBus도 모른다.
 * 부작용은 Enemy의 상태 필드를 바꾸는 것뿐이고, 이벤트는 World가 발행한다.
 */

/** damage 콜백은 World가 준다 (이벤트 발행과 사망 판정을 World가 소유하기 때문) */
export type DamageFn = (enemy: Enemy, amount: number, kind: DamageKind) => void;

/**
 * 착탄 지점 주변에 범위 피해.
 * 중심에서 멀어질수록 falloff 만큼 줄어든다 (0 = 감소 없음, 1 = 가장자리에서 0).
 * 직격 대상은 이미 본체 피해를 받았으므로 제외한다.
 */
export function applySplash(
  enemies: readonly Enemy[],
  x: number,
  z: number,
  radius: number,
  falloff: number,
  damage: number,
  directTargetId: number,
  damageFn: DamageFn,
  kind: DamageKind = 'siege',
): number {
  const r2 = radius * radius;
  let hits = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive || e.id === directTargetId) continue;
    const dx = e.worldX - x;
    const dz = e.worldZ - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    const t = Math.sqrt(d2) / radius;
    const scaled = damage * (1 - falloff * t);
    if (scaled <= 0) continue;
    damageFn(e, scaled, kind);
    hits++;
  }
  return hits;
}

/** 사거리 안 적들을 감속시킨다. 감속은 중첩되지 않고 더 센 쪽이 남는다. */
export function applySlowAura(
  targets: readonly Enemy[],
  speedMul: number,
  duration: number,
): number {
  let affected = 0;
  for (let i = 0; i < targets.length; i++) {
    const e = targets[i];
    if (!e.alive || e.traits?.slowImmune) continue;
    e.applySlow(speedMul, duration);
    affected++;
  }
  return affected;
}

/**
 * 기수의 가속 오라. 반경 안 아군(자신 제외)을 speedMul배로 만든다.
 *
 * duration은 짧게(한 스텝보다 조금 길게) 주고 매 스텝 다시 건다 —
 * 기수가 죽거나 반경을 벗어나면 그 즉시 풀려야 "기수를 끊으면 느려진다"가 성립한다.
 */
export function applySpeedAura(
  source: Enemy,
  enemies: readonly Enemy[],
  radius: number,
  speedMul: number,
  duration: number,
): number {
  const r2 = radius * radius;
  let affected = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive || e.id === source.id) continue;
    const dx = e.worldX - source.worldX;
    const dz = e.worldZ - source.worldZ;
    if (dx * dx + dz * dz > r2) continue;
    e.applyHaste(speedMul, duration);
    affected++;
  }
  return affected;
}

/** 도사의 회복 오라. 주변 아군(자신 포함하지 않음)을 초당 hps 만큼 회복시킨다. */
export function applyHealAura(
  healer: Enemy,
  enemies: readonly Enemy[],
  radius: number,
  hps: number,
  dt: number,
): number {
  const r2 = radius * radius;
  const amount = hps * dt;
  let healed = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive || e.id === healer.id || e.hp >= e.maxHp) continue;
    const dx = e.worldX - healer.worldX;
    const dz = e.worldZ - healer.worldZ;
    if (dx * dx + dz * dz > r2) continue;
    e.hp = Math.min(e.maxHp, e.hp + amount);
    healed++;
  }
  return healed;
}

/**
 * 계략 "화공" — 경로 위 모든 적에게 공성 피해.
 *
 * 공성 피해라 방패병의 원거리 저항을 무시한다. 그래도 방패병을 한 방에 죽이지는
 * 못하게 값을 잡아야 한다 — 계략이 벽력거를 대신하면 레벨 2의 교훈이 사라진다.
 */
export function applyFieldDamage(
  enemies: readonly Enemy[],
  damage: number,
  damageFn: DamageFn,
): number {
  let hits = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    damageFn(e, damage, 'siege');
    hits++;
  }
  return hits;
}

/** 효과 종류별 사거리 여유 — 범위 피해는 사거리 밖 적도 맞을 수 있다 */
export function effectExtraRadius(effect: TowerEffect | undefined): number {
  return effect?.type === 'splash' ? effect.params.radius : 0;
}
