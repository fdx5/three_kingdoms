/** 골드. 모든 변동은 reason을 남긴다 — HUD 코인 연출과 통계가 이걸 쓴다. */
export class Economy {
  private _gold: number;
  private _earned = 0;

  constructor(startGold: number) {
    this._gold = startGold;
  }

  get gold(): number {
    return this._gold;
  }
  get earned(): number {
    return this._earned;
  }

  add(amount: number): number {
    this._gold += amount;
    if (amount > 0) this._earned += amount;
    return this._gold;
  }

  canAfford(amount: number): boolean {
    return this._gold >= amount;
  }

  trySpend(amount: number): boolean {
    if (this._gold < amount) return false;
    this._gold -= amount;
    return true;
  }
}
