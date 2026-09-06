/**
 * 고정 타임스텝 루프. accumulator 방식.
 * setSpeed(1|2|3)은 프레임당 시뮬 스텝 "횟수"를 바꾼다 — dt를 늘리지 않는다.
 * dt를 늘리면 투사체가 적을 관통한다.
 */
export const FIXED_DT = 1 / 60;

export interface LoopCallbacks {
  step: (dt: number) => void;
  render: (alpha: number, frameDt: number) => void;
}

export class Loop {
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;
  private speed = 1;
  private paused = false;

  /** 프레임 지연 시 최대 캐치업 스텝 (나선형 지연 방지) */
  readonly maxCatchupSteps = 5;

  constructor(private readonly cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    const tick = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      // 탭 전환 등으로 긴 공백이 생기면 0.25초로 잘라낸다.
      const frameDt = Math.min((now - this.lastTime) / 1000, 0.25);
      this.lastTime = now;

      if (!this.paused) {
        this.accumulator += frameDt;
        let steps = 0;
        const maxSteps = this.maxCatchupSteps * this.speed;
        while (this.accumulator >= FIXED_DT && steps < maxSteps) {
          // 배속은 한 번의 accumulator 소비마다 speed번 step을 돈다.
          for (let s = 0; s < this.speed; s++) this.cb.step(FIXED_DT);
          this.accumulator -= FIXED_DT;
          steps += this.speed;
        }
        if (steps >= maxSteps) this.accumulator = 0; // 따라잡기 포기
      }

      const alpha = this.paused ? 1 : this.accumulator / FIXED_DT;
      this.cb.render(alpha, frameDt);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(1, Math.floor(speed));
  }
  getSpeed(): number {
    return this.speed;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.accumulator = 0;
  }
  isPaused(): boolean {
    return this.paused;
  }
}
