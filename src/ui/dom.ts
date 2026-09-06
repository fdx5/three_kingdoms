/** 작은 DOM 헬퍼. 프레임워크 없이 HUD를 만들기 위한 최소 도구. */

type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

export function svg(tag: string, attrs: Attrs = {}, children: Node[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    node.setAttribute(k, String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

/** 클릭/탭 핸들러. pointer 이벤트 대신 click을 써서 키보드 접근성을 공짜로 얻는다. */
export function onTap(node: HTMLElement, fn: (e: Event) => void): () => void {
  const handler = (e: Event) => {
    e.stopPropagation();
    fn(e);
  };
  node.addEventListener('click', handler);
  return () => node.removeEventListener('click', handler);
}

export function setPressed(node: HTMLElement, pressed: boolean): void {
  node.setAttribute('aria-pressed', pressed ? 'true' : 'false');
}

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const isTouchDevice = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** 0.4초 카운트업 (easeOutQuad) */
export class CountUp {
  private current = 0;
  private target = 0;
  private from = 0;
  private t = 0;
  private duration: number;

  constructor(initial: number, duration: number) {
    this.current = this.target = this.from = initial;
    this.duration = duration;
  }

  set(value: number, instant = false): void {
    if (instant || this.duration <= 0) {
      this.current = this.from = this.target = value;
      this.t = this.duration;
      return;
    }
    this.from = this.current;
    this.target = value;
    this.t = 0;
  }

  update(dt: number): number {
    if (this.t >= this.duration) return this.current;
    this.t = Math.min(this.duration, this.t + dt);
    const k = this.t / this.duration;
    const eased = 1 - (1 - k) * (1 - k); // easeOutQuad
    this.current = this.from + (this.target - this.from) * eased;
    return this.current;
  }

  get value(): number {
    return this.current;
  }
  get isDone(): boolean {
    return this.t >= this.duration;
  }
}

export function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
