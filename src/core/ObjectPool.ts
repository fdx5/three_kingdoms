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
    /*
     * 미리 만든 것도 **반납된 상태**로 넣는다.
     *
     * 예전에는 factory() 결과를 그대로 free 에 쌓았다. 그래서 미리 만든 항목만
     * reset 을 한 번도 거치지 않은 채 대기했고, 반납된 항목과 상태가 달랐다.
     * 뷰에서는 그 차이가 그대로 화면에 나왔다 — 투사체 뷰의 reset 이
     * setVisible(false) 인데, 미리 만든 64개는 그 호출을 못 받아 씬에 붙은 채
     * **보이는 상태로 남아 매 프레임 그려졌다**(메시 320개, 드로우콜의 26%).
     * 쓰이지 않는 화살과 불꽃이 어딘가에서 계속 렌더되고 있었던 것이다.
     *
     * EnemyView 쪽은 팩토리 안에서 손으로 visible=false 를 해 두어 이 구멍을
     * 피하고 있었다. 그 방어가 필요했다는 것 자체가 여기가 틀렸다는 신호다.
     */
    for (let i = 0; i < prealloc; i++) {
      const item = factory();
      reset(item);
      this.free.push(item);
    }
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
