import type { GameEvents } from '../types/events';

type Handler<T> = (payload: T) => void;

/**
 * 타입 안전한 이벤트 버스. 이벤트명 -> 페이로드 타입 맵으로 강제한다.
 * subscribe는 해제 함수를 반환한다 — 뷰의 dispose에서 반드시 호출할 것.
 */
export class EventBus<E extends object = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(name: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as Handler<never>);
    return () => {
      set!.delete(handler as Handler<never>);
    };
  }

  once<K extends keyof E>(name: K, handler: Handler<E[K]>): () => void {
    const off = this.on(name, (p) => {
      off();
      handler(p);
    });
    return off;
  }

  emit<K extends keyof E>(name: K, payload: E[K]): void {
    const set = this.handlers.get(name);
    if (!set || set.size === 0) return;
    // 핸들러가 구독을 해제할 수 있으므로 복사본을 순회한다.
    for (const h of Array.from(set)) (h as Handler<E[K]>)(payload);
  }

  offAll(name?: keyof E): void {
    if (name === undefined) this.handlers.clear();
    else this.handlers.delete(name);
  }

  listenerCount(name: keyof E): number {
    return this.handlers.get(name)?.size ?? 0;
  }
}

/** 구독 해제 함수를 모아 한 번에 끊는 헬퍼. 뷰/HUD의 dispose에서 쓴다. */
export class Subscriptions {
  private offs: (() => void)[] = [];
  add(off: () => void): void {
    this.offs.push(off);
  }
  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
  get size(): number {
    return this.offs.length;
  }
}
