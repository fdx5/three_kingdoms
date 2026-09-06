import { CASTLE_LEVELS, MAX_CASTLE_LEVEL, castleLevelDef } from '../data/castle';
import type { CastleLevelDef } from '../types/castle';

/**
 * 성(관문). 체력 0 이하가 되면 패배.
 *
 * 성은 맞기만 하는 벽이 아니라 여섯 단계로 자라는 마지막 타워다 —
 * 무엇으로 반격하는지는 [[CASTLE_LEVELS]] 가 정하고, 실제 사격은 World가 한다.
 */
export class Castle {
  private _maxHp: number;
  private _hp: number;
  /** 1-base 성문 강화 단계 (1..6) */
  private _level = 1;

  constructor(
    readonly id: string,
    maxHp: number,
  ) {
    this._maxHp = maxHp;
    this._hp = maxHp;
  }

  get hp(): number {
    return this._hp;
  }
  get maxHp(): number {
    return this._maxHp;
  }
  get hpRatio(): number {
    return this._hp / this._maxHp;
  }
  get destroyed(): boolean {
    return this._hp <= 0;
  }

  get level(): number {
    return this._level;
  }
  get maxLevel(): number {
    return MAX_CASTLE_LEVEL;
  }
  get isMaxLevel(): boolean {
    return this._level >= MAX_CASTLE_LEVEL;
  }
  get levelDef(): CastleLevelDef {
    return castleLevelDef(this._level);
  }
  /** 다음 단계 비용. 만렙이면 null. */
  get nextUpgradeCost(): number | null {
    if (this.isMaxLevel) return null;
    return CASTLE_LEVELS[this._level].upgradeCost;
  }
  /** 다음 단계 정의 (HUD가 "무엇이 되는지" 미리 보여준다). 만렙이면 null. */
  get nextLevelDef(): CastleLevelDef | null {
    return this.isMaxLevel ? null : CASTLE_LEVELS[this._level];
  }

  /**
   * 비용 검증은 World가 한다. 여기서는 단계와 체력만 올린다.
   * 늘어난 최대 체력은 그만큼 즉시 회복된다 — 성벽을 두껍게 쌓은 것이지
   * 이미 난 구멍을 메운 것이 아니므로, 비율이 아니라 증가분만 채운다.
   */
  applyUpgrade(): CastleLevelDef {
    if (this.isMaxLevel) return this.levelDef;
    const next = CASTLE_LEVELS[this._level];
    this._level = next.level;
    if (next.hpBonus > 0) {
      this._maxHp += next.hpBonus;
      this._hp = Math.min(this._maxHp, this._hp + next.hpBonus);
    }
    return next;
  }

  /** 실제로 깎인 양을 반환 */
  takeDamage(amount: number): number {
    const before = this._hp;
    this._hp = Math.max(0, this._hp - amount);
    return before - this._hp;
  }

  /** 실제로 회복된 양을 반환. 최대 체력을 넘지 않는다. */
  repair(amount: number): number {
    if (this._hp <= 0) return 0; // 이미 무너진 성은 고칠 수 없다
    const before = this._hp;
    this._hp = Math.min(this._maxHp, this._hp + amount);
    return this._hp - before;
  }

  get missingHp(): number {
    return this._maxHp - this._hp;
  }
}
