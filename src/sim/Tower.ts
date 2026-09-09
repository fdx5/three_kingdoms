import type { TowerDef, TargetingMode, TowerLevelDef } from '../types/towers';
import type { Enemy } from './Enemy';
import { BALANCE } from '../data/balance';

/**
 * 이 망루의 최대 체력. 건설비 x 종류 x 레벨, 셋의 곱이다.
 *
 * 표에 체력을 적지 않고 값에서 끌어내는 이유는 TowerDef.toughness 주석에 있다 —
 * 요약하면 "비싼 것이 단단하다"가 규칙이어야 설명이 필요 없기 때문이다.
 *
 * 레벨은 **투자 총액이 아니라 지수**로 얹는다. 총액에 비례시켜 봤더니 1레벨에서
 * 5레벨로 가며 투자가 여덟 배가 되어 체력도 여덟 배가 됐고, 그러면 다 올린 망루는
 * 무엇으로도 부술 수 없는 물건이 된다(실측: 여섯 장 전부 최저 체력 90% 아래로 내려간
 * 망루가 없었다 — 공성전이 그림으로만 남는다). levelHpMul 1.35 면 5레벨이 1레벨의
 * 3.3배로, 업그레이드가 분명히 단단해지되 여전히 부술 수 있는 크기에 머문다.
 */
export function towerMaxHp(def: TowerDef, level: number): number {
  const tc = BALANCE.towerCombat;
  const base = def.buildCost * tc.hpPerGold * (def.toughness ?? 1);
  return Math.max(tc.minHp, Math.round(base * Math.pow(tc.levelHpMul, level - 1)));
}

/**
 * 타워. 사거리 내 적을 targeting 규칙으로 정렬하고,
 * 레벨 수만큼의 화살을 "서로 다른 적"에게 배정한다.
 *
 * 이제 맞기도 한다 — 습격조가 둘러싸고 때리면 체력이 깎이고 0이 되면 무너진다.
 * 둘러싼 자리(siegeSlots)를 타워가 들고 있는 이유: "몇 명까지 붙을 수 있는가"는
 * 타워 둘레의 성질이지 적의 성질이 아니고, 타워가 사라질 때 한 번에 풀려야 한다.
 */
export class Tower {
  /** 1-base 레벨 (1..5) */
  level = 1;
  cooldown = 0;
  totalInvested = 0;
  targeting: TargetingMode;

  /** 뷰가 참조하는 마지막 발사 방향 (라디안) */
  lastFireAngle = 0;

  hp: number;
  maxHp: number;
  /** 다음 수리까지 남은 시간(초) */
  repairCooldown = 0;

  /**
   * 망루를 둘러싼 자리들. 값은 그 자리를 차지한 적의 id, 0이면 빈자리다.
   *
   * 인덱스가 곧 위치다: 앞의 `slots` 개가 **때리는 안쪽 고리**이고, 그 뒤는
   * 자리가 나기를 기다리는 바깥 고리들이다 (BALANCE.towerCombat.reserveRings).
   * 두 고리를 한 배열로 두는 이유는 자리 이동이 인덱스 교체 한 번으로 끝나기
   * 때문이다 — 기다리던 적이 앞으로 나서는 것이 곧 "낮은 인덱스로 옮긴다"다.
   */
  readonly siegeSlots: number[];

  constructor(
    readonly slotId: string,
    readonly def: TowerDef,
    readonly x: number,
    readonly z: number,
  ) {
    this.targeting = def.targeting;
    this.totalInvested = def.buildCost;
    this.maxHp = towerMaxHp(def, 1);
    this.hp = this.maxHp;
    const tc = BALANCE.towerCombat;
    this.siegeSlots = new Array(tc.slots * (1 + tc.reserveRings)).fill(0);
  }

  get hpRatio(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }
  get destroyed(): boolean {
    return this.hp <= 0;
  }
  get missingHp(): number {
    return this.maxHp - this.hp;
  }

  /** 실제로 깎인 양을 돌려준다 (남은 체력보다 큰 피해는 잘린다) */
  takeDamage(amount: number): number {
    const applied = Math.min(this.hp, Math.max(0, amount));
    this.hp -= applied;
    return applied;
  }

  /** 이 망루를 한 번 고치는 값. 되돌리는 데 부은 돈의 절반이 든다. */
  get repairCost(): number {
    return Math.ceil(this.totalInvested * BALANCE.towerCombat.repairCostRatio);
  }

  /** 한 번 수리로 회복할 양. 부족분이 더 적으면 그만큼만. */
  get repairAmount(): number {
    return Math.min(this.missingHp, Math.round(this.maxHp * BALANCE.towerCombat.repairFraction));
  }

  /** 비용 검증은 World가 한다. 여기서는 상태만 올린다. 실제 회복량을 돌려준다. */
  repair(): number {
    const healed = this.repairAmount;
    this.hp += healed;
    this.repairCooldown = BALANCE.towerCombat.repairCooldownSec;
    return healed;
  }

  /** 이 자리에 선 적이 실제로 망루를 때리는가 (안쪽 고리인가) */
  static isAssaultSlot(index: number): boolean {
    return index >= 0 && index < BALANCE.towerCombat.slots;
  }

  /**
   * 이 적이 설 자리를 잡는다. 자리가 없으면 -1.
   *
   * 안쪽 고리를 먼저 채우고, 같은 고리 안에서는 **다가오는 방향에 가장 가까운
   * 각도**를 준다 — 그래야 달려드는 길이 서로 엇갈리지 않는다.
   */
  claimSiegeSlot(enemyId: number, fromX: number, fromZ: number): number {
    const best = this.pickSlot(fromX, fromZ, this.siegeSlots.length);
    if (best >= 0) this.siegeSlots[best] = enemyId;
    return best;
  }

  /**
   * 안쪽 고리에 빈자리가 났으면 그 자리로 옮긴다. 옮겼으면 새 인덱스, 아니면 -1.
   * 바깥에서 기다리던 적이 앞으로 나서는 순간이 이것이다.
   */
  promoteSiegeSlot(enemyId: number, current: number, fromX: number, fromZ: number): number {
    if (Tower.isAssaultSlot(current)) return -1;
    const next = this.pickSlot(fromX, fromZ, BALANCE.towerCombat.slots);
    if (next < 0) return -1;
    this.releaseSiegeSlot(current, enemyId);
    this.siegeSlots[next] = enemyId;
    return next;
  }

  /** limit 미만의 인덱스 중 빈자리 하나. 없으면 -1. */
  private pickSlot(fromX: number, fromZ: number, limit: number): number {
    const n = Math.min(limit, this.siegeSlots.length);
    const approach = Math.atan2(fromX - this.x, fromZ - this.z);
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < n; i++) {
      if (this.siegeSlots[i] !== 0) continue;
      const angle = this.slotAngle(i);
      const diff = Math.abs(Math.atan2(Math.sin(angle - approach), Math.cos(angle - approach)));
      // 고리가 먼저, 그 안에서 각도. 동률은 낮은 인덱스가 이긴다(결정론).
      const ring = Math.floor(i / BALANCE.towerCombat.slots);
      const score = ring * 100 + diff - i * 1e-6;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  releaseSiegeSlot(index: number, enemyId: number): void {
    if (index < 0 || index >= this.siegeSlots.length) return;
    if (this.siegeSlots[index] === enemyId) this.siegeSlots[index] = 0;
  }

  /** 고리마다 반 칸씩 어긋나게 둔다 — 뒷줄이 앞줄 뒤에 정확히 겹치지 않게. */
  private slotAngle(index: number): number {
    const per = BALANCE.towerCombat.slots;
    const ring = Math.floor(index / per);
    return ((index % per) + ring * 0.5) / per * Math.PI * 2;
  }

  /** 이 자리에 선 적이 서 있어야 할 좌표 */
  siegePoint(index: number, out: { x: number; z: number }): { x: number; z: number } {
    const tc = BALANCE.towerCombat;
    const ring = Math.floor(index / tc.slots);
    const angle = this.slotAngle(index);
    const r = tc.surroundRadius + ring * tc.ringSpacing;
    out.x = this.x + Math.sin(angle) * r;
    out.z = this.z + Math.cos(angle) * r;
    return out;
  }

  get siegeSlotsFree(): boolean {
    for (let i = 0; i < this.siegeSlots.length; i++) if (this.siegeSlots[i] === 0) return true;
    return false;
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

  /**
   * 비용 검증은 World가 한다. 여기서는 상태만 올린다.
   *
   * 늘어난 최대 체력만큼 지금 체력도 같이 올린다. 비율을 유지하면(예: 반쯤 부서진
   * 망루를 올렸더니 절반이 그대로) 업그레이드가 공짜 수리가 되고, 반대로 그냥 두면
   * 강화한 순간 체력바가 뚝 떨어져 보인다. 늘어난 만큼만 더하면 **부서진 양은
   * 그대로 남고 새로 쌓은 부분만 멀쩡하다** — 그게 눈에 맞는 그림이다.
   */
  applyUpgrade(cost: number): void {
    this.level++;
    this.totalInvested += cost;
    this.cooldown = 0;
    const nextMax = towerMaxHp(this.def, this.level);
    this.hp += nextMax - this.maxHp;
    this.maxHp = nextMax;
  }

  /**
   * 사거리 내 후보에서 targeting 규칙으로 정렬한 목표 목록을 out에 채운다.
   * candidates는 SpatialGrid가 준 "가능성 있는" 적들이다 — 여기서 정확한 거리 검사를 한다.
   *
   * **나를 때리는 놈이 먼저다.** 타게팅 설정보다 위에 있는 규칙이다.
   *
   * 왜 규칙으로 못 박는가: 습격조는 길을 벗어나는 순간 distance 가 멈춘다.
   * 'first'(경로를 가장 많이 지난 적)로 정렬하면 그 자리에 얼어붙은 습격조가
   * 영원히 꼴찌가 되어, 망루는 자기를 부수는 적을 놔두고 지나가는 적만 쏘다가
   * 무너진다(실측: 3장에서 7파까지 망루 전부가 1레벨에 묶이고 누수 80).
   * 사람이 보기에도 이쪽이 당연하다 — 코앞에서 도끼로 기둥을 찍는 적을 두고
   * 멀리를 쏘는 망루는 고장 난 것으로 보인다.
   *
   * 화살 절반만 발밑에 쓰고 나머지로 길을 덮게도 해 봤다. 화력 배분으로는
   * 더 그럴듯하지만 여섯 장의 밸런스가 그 위에서 성립하지 않았다 — 2·3장의
   * 권장 조합이 지고 4장은 성문 없이도 이겼다. 이 게임의 여섯 장은 "망루는
   * 자기를 지킨다"를 전제로 맞춰져 있다.
   *
   * 두 무리 각각은 여전히 고른 타게팅으로 정렬된다. 설정이 무시되는 것이 아니라
   * "먼저 볼 무리"가 하나 생기는 것이다.
   */
  acquire(candidates: readonly Enemy[], out: Enemy[]): Enemy[] {
    out.length = 0;
    const r2 = this.range * this.range;
    let sieging = 0;
    for (let i = 0; i < candidates.length; i++) {
      const e = candidates[i];
      if (!e.alive) continue;
      // 후보는 이미 월드 좌표가 필요하다 — World가 캐시한 좌표를 넘긴다.
      const dx = e.worldX - this.x;
      const dz = e.worldZ - this.z;
      if (dx * dx + dz * dz > r2) continue;
      // 나를 노리는 적을 앞으로 모은다 (스왑 한 번 — 배열을 새로 만들지 않는다)
      if (e.targetSlotId === this.slotId) {
        out.push(out[sieging] ?? e);
        out[sieging++] = e;
      } else {
        out.push(e);
      }
    }
    if (sieging === 0) {
      sortByTargeting(out, this.targeting, this.x, this.z);
      return out;
    }

    const rest = out.splice(sieging);
    out.length = sieging;
    sortByTargeting(out, this.targeting, this.x, this.z);
    sortByTargeting(rest, this.targeting, this.x, this.z);
    for (let i = 0; i < rest.length; i++) out.push(rest[i]);
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
