import type { WaveDef, WaveSpawn } from '../types/level';

/**
 * 웨이브 상태.
 *   idle      첫 웨이브 대기
 *   spawning  스폰 큐 소비 중
 *   waiting   다음 웨이브까지 카운트다운 (앞 웨이브의 적이 아직 살아있어도 무방)
 *   draining  마지막 웨이브까지 다 내보냈고 남은 적을 정리하는 중
 *   finished  전부 끝
 */
export type WaveState = 'idle' | 'spawning' | 'waiting' | 'draining' | 'finished';

export interface WaveRunnerCallbacks {
  spawn: (spawn: WaveSpawn) => void;
  onWaveStarted: (wave: WaveDef, total: number) => void;
  onWaveCleared: (wave: WaveDef, reward: number) => void;
  onCountdown: (nextIndex: number, remaining: number, total: number) => void;
  onAllWavesCleared: () => void;
  /** 필드에 살아있는 적이 있는지 */
  hasLiveEnemies: () => boolean;
}

/**
 * 웨이브 진행.
 *
 * 웨이브는 "앞 웨이브를 다 잡았는가"가 아니라 시간표대로 온다.
 * 스폰이 끝나면 곧바로 다음 웨이브 카운트다운이 시작되고, 0이 되면
 * 앞 웨이브의 적이 아직 경로 위에 있어도 다음 웨이브가 들어온다.
 * 그래서 처리 속도가 모자라면 적이 누적되고, 그게 곧 압박이 된다.
 *
 * 마지막 웨이브만 예외다 — 다 내보낸 뒤 남은 적을 전부 정리해야(draining) 승리한다.
 */
export class WaveRunner {
  state: WaveState = 'idle';
  /** 0-base 인덱스. -1 = 아직 첫 웨이브 전 */
  currentIndex = -1;
  /** 현재 웨이브 시작 후 경과 시간 */
  waveTime = 0;
  /** 다음 웨이브까지 남은 대기 시간 */
  countdown: number;
  /** 이번 대기의 총 길이 (조기 소집 보너스 계산용) */
  countdownTotal: number;

  private queue: WaveSpawn[] = [];
  private queueIndex = 0;
  /** 스폰까지 끝난 웨이브 수 */
  private clearedCount = 0;

  constructor(
    private readonly waves: readonly WaveDef[],
    private readonly cb: WaveRunnerCallbacks,
    firstWaveDelay: number,
    private readonly waveInterval: number,
    private readonly earlyCallBonusPerSecond: number,
  ) {
    this.countdown = firstWaveDelay;
    this.countdownTotal = firstWaveDelay;
  }

  get totalWaves(): number {
    return this.waves.length;
  }
  /** 1-base 표시용 웨이브 번호 */
  get displayIndex(): number {
    return Math.max(1, this.currentIndex + 1);
  }
  get wavesCleared(): number {
    return this.state === 'finished' ? this.waves.length : this.clearedCount;
  }
  /** 지금 다음 웨이브를 당겨 부를 수 있는가 */
  get isWaiting(): boolean {
    return this.state === 'idle' || this.state === 'waiting';
  }
  get allWavesStarted(): boolean {
    return this.currentIndex >= this.waves.length - 1;
  }

  /** 조기 소집 시 지급될 보너스 골드 */
  earlyCallBonus(): number {
    if (!this.isWaiting || this.allWavesStarted) return 0;
    return Math.max(0, Math.floor(this.countdown * this.earlyCallBonusPerSecond));
  }

  /** 남은 대기시간을 0으로 만들고 즉시 다음 웨이브를 시작한다. 지급 골드를 반환. */
  callWaveEarly(): number {
    if (!this.isWaiting || this.allWavesStarted) return 0;
    const bonus = this.earlyCallBonus();
    this.countdown = 0;
    this.startNextWave();
    return bonus;
  }

  private startNextWave(): void {
    this.currentIndex++;
    const wave = this.waves[this.currentIndex];
    this.waveTime = 0;
    this.queue = wave.spawns;
    this.queueIndex = 0;
    this.state = 'spawning';
    this.cb.onWaveStarted(wave, this.waves.length);
  }

  /** 스폰이 끝났을 때 — 적이 남아 있어도 다음 웨이브 시계는 바로 돈다 */
  private finishSpawning(): void {
    const wave = this.waves[this.currentIndex];
    this.clearedCount = this.currentIndex + 1;
    this.cb.onWaveCleared(wave, wave.reward ?? 0);

    if (this.allWavesStarted) {
      this.state = 'draining';
      return;
    }
    this.state = 'waiting';
    this.countdown = this.waveInterval;
    this.countdownTotal = this.waveInterval;
  }

  step(dt: number): void {
    switch (this.state) {
      case 'idle':
      case 'waiting': {
        this.countdown -= dt;
        this.cb.onCountdown(this.currentIndex + 2, Math.max(0, this.countdown), this.countdownTotal);
        if (this.countdown <= 0) this.startNextWave();
        return;
      }

      case 'spawning': {
        this.waveTime += dt;
        while (this.queueIndex < this.queue.length && this.queue[this.queueIndex].at <= this.waveTime) {
          this.cb.spawn(this.queue[this.queueIndex]);
          this.queueIndex++;
        }
        if (this.queueIndex >= this.queue.length) this.finishSpawning();
        return;
      }

      case 'draining': {
        this.waveTime += dt;
        // 마지막 웨이브까지 다 내보냈다. 남은 적을 전부 정리해야 승리다.
        if (!this.cb.hasLiveEnemies()) {
          this.state = 'finished';
          this.cb.onAllWavesCleared();
        }
        return;
      }

      case 'finished':
        return;
    }
  }
}
