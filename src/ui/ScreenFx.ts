import { el, prefersReducedMotion } from './dom';
import { BALANCE } from '../data/balance';
import { ObjectPool } from '../core/ObjectPool';

interface Coin {
  node: HTMLElement;
  t: number;
  delay: number;
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
  onArrive: () => void;
  arrived: boolean;
}

interface DamageNumber {
  node: HTMLElement;
  t: number;
  x: number;
  y: number;
}

interface HealthBar {
  node: HTMLElement;
  fill: HTMLElement;
  visible: number;
  ratio: number;
  always: boolean;
}

/**
 * 화면 좌표계 연출 레이어 — 코인 비행, 피해 숫자, 적 체력바, 붉은 비네트.
 * 전부 DOM이고 전부 풀링한다. 한 웨이브에 48개가 동시에 날 수 있다.
 */
export class ScreenFx {
  private coins: Coin[] = [];
  private numbers: DamageNumber[] = [];
  private bars = new Map<number, HealthBar>();
  private vignette: HTMLElement;
  private coinPool: ObjectPool<HTMLElement>;
  private numberPool: ObjectPool<HTMLElement>;
  private barPool: ObjectPool<HTMLElement>;
  private vignetteT = 0;
  private reduced = prefersReducedMotion();
  private pendingCoinDelay = 0;
  private lastCoinTime = 0;

  /** 설정: 피해 숫자 표시 on/off */
  showDamageNumbers = true;

  constructor(private readonly layer: HTMLElement) {
    this.vignette = el('div', { class: 'vignette' });
    layer.append(this.vignette);

    this.coinPool = new ObjectPool<HTMLElement>(
      () => {
        const n = el('div', { class: 'coin' });
        n.style.display = 'none';
        this.layer.append(n);
        return n;
      },
      (n) => {
        n.style.display = 'none';
        n.className = 'coin';
      },
      24,
    );

    this.numberPool = new ObjectPool<HTMLElement>(
      () => {
        const n = el('div', { class: 'dmgnum' });
        n.style.display = 'none';
        this.layer.append(n);
        return n;
      },
      (n) => {
        n.style.display = 'none';
        n.className = 'dmgnum';
      },
      32,
    );

    this.barPool = new ObjectPool<HTMLElement>(
      () => {
        const n = el('div', { class: 'hpbar' }, [el('div', { class: 'hpbar__fill' })]);
        n.style.display = 'none';
        this.layer.append(n);
        return n;
      },
      (n) => {
        n.style.display = 'none';
        n.className = 'hpbar';
      },
      24,
    );
  }

  // ── 코인 ────────────────────────────────────────────────────────────

  /**
   * 적이 죽은 화면 좌표에서 상단 골드 표시까지 베지어로 날린다.
   * 여러 개가 동시에 죽으면 20ms씩 시차를 둬서 흐름이 보이게 한다.
   * 도착하는 순간 onArrive가 호출되고, 그때 골드 숫자가 오른다.
   */
  flyCoin(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    onArrive: () => void,
    big = false,
  ): void {
    if (this.reduced) {
      // 접근성: 즉시 전환
      onArrive();
      return;
    }

    const now = performance.now();
    if (now - this.lastCoinTime > 120) this.pendingCoinDelay = 0;
    this.lastCoinTime = now;
    const delay = this.pendingCoinDelay;
    this.pendingCoinDelay += BALANCE.fx.coinStaggerMs / 1000;

    const node = this.coinPool.acquire();
    node.className = big ? 'coin coin--boss' : 'coin';
    node.style.display = 'block';
    node.style.opacity = '0';
    node.style.transform = `translate(${fromX}px, ${fromY}px)`;

    // 제어점: 출발점에서 위로 크게 튀었다가 목표로 빨려 들어간다
    const cx = fromX + (toX - fromX) * 0.35;
    const cy = Math.min(fromY, toY) - 120 - Math.random() * 60;

    this.coins.push({ node, t: 0, delay, x0: fromX, y0: fromY, cx, cy, x1: toX, y1: toY, onArrive, arrived: false });
  }

  /** 보스 처치는 코인 여러 개 + 더 크게 */
  flyCoinBurst(fromX: number, fromY: number, toX: number, toY: number, count: number, onArrive: () => void): void {
    for (let i = 0; i < count; i++) {
      const jx = fromX + (Math.random() - 0.5) * 60;
      const jy = fromY + (Math.random() - 0.5) * 40;
      this.flyCoin(jx, jy, toX, toY, i === count - 1 ? onArrive : () => {}, true);
    }
  }

  // ── 피해 숫자 ──────────────────────────────────────────────────────

  showDamage(x: number, y: number, amount: number, big = false, fire = false): void {
    if (!this.showDamageNumbers || this.reduced) return;
    const displayAmount = Math.max(1, Math.round(amount));
    const node = this.numberPool.acquire();
    node.className = big ? 'dmgnum dmgnum--crit' : 'dmgnum';
    if (fire) node.classList.add('dmgnum--fire');
    node.textContent = String(displayAmount);
    node.style.display = 'block';
    this.numbers.push({ node, t: 0, x: x + (Math.random() - 0.5) * 16, y });
  }

  // ── 적 체력바 ──────────────────────────────────────────────────────

  /** 평소 숨김. 피해를 받으면 2초간 표시. 보스는 always=true로 상시 표시. */
  setHealth(enemyId: number, ratio: number, always: boolean): void {
    let bar = this.bars.get(enemyId);
    if (!bar) {
      const node = this.barPool.acquire();
      node.style.display = 'block';
      bar = {
        node,
        fill: node.firstElementChild as HTMLElement,
        visible: always ? Infinity : BALANCE.fx.healthBarVisibleAfterHit,
        ratio,
        always,
      };
      this.bars.set(enemyId, bar);
    }
    bar.ratio = ratio;
    bar.always = always;
    if (!always) bar.visible = BALANCE.fx.healthBarVisibleAfterHit;
    bar.fill.style.transform = `scaleX(${Math.max(0, ratio)})`;
    bar.node.classList.toggle('hpbar--low', ratio < 0.35);
  }

  positionHealth(enemyId: number, x: number, y: number): void {
    const bar = this.bars.get(enemyId);
    if (!bar) return;
    bar.node.style.transform = `translate(${x}px, ${y}px)`;
  }

  removeHealth(enemyId: number): void {
    const bar = this.bars.get(enemyId);
    if (!bar) return;
    this.bars.delete(enemyId);
    this.barPool.release(bar.node);
  }

  hasHealth(enemyId: number): boolean {
    return this.bars.has(enemyId);
  }

  // ── 비네트 ─────────────────────────────────────────────────────────

  flashVignette(): void {
    this.vignette.classList.add('show');
    this.vignetteT = 0.3;
  }

  // ── 프레임 갱신 ────────────────────────────────────────────────────

  update(dt: number): void {
    this.updateCoins(dt);
    this.updateNumbers(dt);
    this.updateBars(dt);

    if (this.vignetteT > 0) {
      this.vignetteT -= dt;
      if (this.vignetteT <= 0) this.vignette.classList.remove('show');
    }
  }

  private updateCoins(dt: number): void {
    const dur = BALANCE.fx.coinFlightDuration;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      if (c.delay > 0) {
        c.delay -= dt;
        continue;
      }
      c.t += dt;
      const k = Math.min(1, c.t / dur);
      // 2차 베지어
      const u = 1 - k;
      const x = u * u * c.x0 + 2 * u * k * c.cx + k * k * c.x1;
      const y = u * u * c.y0 + 2 * u * k * c.cy + k * k * c.y1;
      const scale = 0.6 + Math.sin(k * Math.PI) * 0.5;
      c.node.style.opacity = k > 0.9 ? String((1 - k) * 10) : '1';
      c.node.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;

      if (k >= 1) {
        if (!c.arrived) {
          c.arrived = true;
          c.onArrive();
        }
        this.coins.splice(i, 1);
        this.coinPool.release(c.node);
      }
    }
  }

  private updateNumbers(dt: number): void {
    const dur = BALANCE.fx.damageNumberDuration;
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.t += dt;
      const k = Math.min(1, n.t / dur);
      n.node.style.transform = `translate(${n.x}px, ${n.y - k * 42}px)`;
      n.node.style.opacity = String(1 - k * k);
      if (k >= 1) {
        this.numbers.splice(i, 1);
        this.numberPool.release(n.node);
      }
    }
  }

  private updateBars(dt: number): void {
    for (const [id, bar] of this.bars) {
      if (bar.always) continue;
      bar.visible -= dt;
      if (bar.visible <= 0) {
        this.bars.delete(id);
        this.barPool.release(bar.node);
      }
    }
  }

  /** 재시작 시 전부 정리 */
  clear(): void {
    for (const c of this.coins) this.coinPool.release(c.node);
    for (const n of this.numbers) this.numberPool.release(n.node);
    for (const [, b] of this.bars) this.barPool.release(b.node);
    this.coins.length = 0;
    this.numbers.length = 0;
    this.bars.clear();
    this.vignette.classList.remove('show');
    this.pendingCoinDelay = 0;
  }

  dispose(): void {
    this.clear();
    this.layer.replaceChildren();
    this.coinPool.clear();
    this.numberPool.clear();
    this.barPool.clear();
  }
}
