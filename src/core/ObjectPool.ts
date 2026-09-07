/**
 * 오브젝트 풀. 웨이브당 수백 발의 투사체가 GC 압력을 만들면 안 된다.
 */
export class ObjectPool<T> {
  private free: T[] = [];
  private liveCount = 0;

  constructor(
    private readonly factory: () => T,
    private readonly reset: (item: T) => void,
    prealloc = 0,
  ) {
    for (let i = 0; i < prealloc; i++) this.free.push(factory());
  }

  acquire(): T {
    this.liveCount++;
    const item = this.free.pop();
    if (item !== undefined) return item;
    return this.factory();
  }

  release(item: T): void {
    this.reset(item);
    this.free.push(item);
    this.liveCount--;
  }

  get live(): number {
    return this.liveCount;
  }
  get pooled(): number {
    return this.free.length;
  }
  clear(dispose?: (item: T) => void): void {
    if (dispose) for (const item of this.free) dispose(item);
    this.free.length = 0;
    this.liveCount = 0;
  }
}
