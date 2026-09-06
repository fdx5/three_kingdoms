import type { TowerDef, TargetingMode, TowerLevelDef } from '../types/towers';
import type { Enemy } from './Enemy';

/**
 * 타워. 사거리 내 적을 targeting 규칙으로 정렬하고,
 * 레벨 수만큼의 화살을 "서로 다른 적"에게 배정한다.
 */
export class Tower {
  /** 1-base 레벨 (1..5) */
  level = 1;
  cooldown = 0;
  totalInvested = 0;
  targeting: TargetingMode;

  /** 뷰가 참조하는 마지막 발사 방향 (라디안) */
  lastFireAngle = 0;

  constructor(
    readonly slotId: string,
    readonly def: TowerDef,
    readonly x: number,
    readonly z: number,
  ) {
    this.targeting = def.targeting;
    this.totalInvested = def.buildCost;
  }

  get levelDef(): TowerLevelDef {
    return this.def.levels[this.level - 1];
  }
  get maxLevel(): number {
    return this.def.levels.length;
  }
  get isMaxLevel(): boolean {
    return this.level >= this.maxLevel;
  }
  get range(): number {
    return this.levelDef.range;
  }
  get nextUpgradeCost(): number | null {
    if (this.isMaxLevel) return null;
    return this.def.levels[this.level].upgradeCost;
  }

  sellValue(): number {
    // 350 * 0.7 은 부동소수점에서 244.99999999999997 이다.
    // 엡실론 없이 floor하면 환급이 1G씩 새어나간다.
    return Math.floor(this.totalInvested * this.def.sellRatio + 1e-9);
  }

  /** 비용 검증은 World가 한다. 여기서는 상태만 올린다. */
  applyUpgrade(cost: number): void {
    this.level++;
    this.totalInvested += cost;
    this.cooldown = 0;
  }

  /**
   * 사거리 내 후보에서 targeting 규칙으로 정렬한 목표 목록을 out에 채운다.
   * candidates는 SpatialGrid가 준 "가능성 있는" 적들이다 — 여기서 정확한 거리 검사를 한다.
   */
  acquire(candidates: readonly Enemy[], out: Enemy[]): Enemy[] {
    out.length = 0;
    const r2 = this.range * this.range;
    for (let i = 0; i < candidates.length; i++) {
      const e = candidates[i];
      if (!e.alive) continue;
      // 후보는 이미 월드 좌표가 필요하다 — World가 캐시한 좌표를 넘긴다.
      const dx = e.worldX - this.x;
      const dz = e.worldZ - this.z;
      if (dx * dx + dz * dz <= r2) out.push(e);
    }
    sortByTargeting(out, this.targeting, this.x, this.z);
    return out;
  }
}

/** 사거리 내 적 정렬. 첫 원소가 최우선 목표다. */
export function sortByTargeting(list: Enemy[], mode: TargetingMode, tx: number, tz: number): void {
  switch (mode) {
    case 'first':
      // 경로를 가장 많이 지난 적
      list.sort((a, b) => b.distance - a.distance || a.id - b.id);
      break;
    case 'last':
      list.sort((a, b) => a.distance - b.distance || a.id - b.id);
      break;
    case 'strongest':
      list.sort((a, b) => b.hp - a.hp || b.distance - a.distance || a.id - b.id);
      break;
    case 'closest':
      list.sort((a, b) => {
        const da = (a.worldX - tx) ** 2 + (a.worldZ - tz) ** 2;
        const db = (b.worldX - tx) ** 2 + (b.worldZ - tz) ** 2;
        return da - db || a.id - b.id;
      });
      break;
  }
}

/**
 * N발의 화살을 목표에 배정한다 — 이건 밸런스의 핵심이다.
 * i번째 화살의 목표 = T[i]. T의 길이를 넘으면 T[0].
 * 즉 서로 다른 적에게 분산하고, 적이 모자랄 때만 선두 적에게 겹친다.
 * 한 마리에 몰아 쏘면 HP 20 보병에게 화살 5발이 낭비되어 업그레이드가 체감되지 않는다.
 */
export function assignArrows(targets: readonly Enemy[], arrows: number, out: Enemy[]): Enemy[] {
  out.length = 0;
  if (targets.length === 0) return out;
  for (let i = 0; i < arrows; i++) {
    out.push(i < targets.length ? targets[i] : targets[0]);
  }
  return out;
}
