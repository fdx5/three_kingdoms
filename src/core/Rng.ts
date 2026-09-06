/**
 * 시드 기반 결정론 난수 (mulberry32).
 * 시뮬 안에서 Math.random 사용 금지 — 같은 시드 + 같은 입력이면 결과가 동일해야 한다.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // 0 시드가 죽지 않도록 살짝 흩뜨린다.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** [min, max] 정수 */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /** 상태를 복제해 분기 (결정론 유지) */
  fork(): Rng {
    const r = new Rng(this.state);
    return r;
  }
}
