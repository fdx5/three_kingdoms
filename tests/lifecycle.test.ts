/**
 * 수명 주기 테스트 — Phase 6 최종 점검 항목의 자동화.
 * 20웨이브를 돌려도 풀이 무한히 늘지 않고, 구독이 전부 해제되는지 본다.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/World';
import { LEVEL_01 } from '../src/data/levels/level01';
import { EventBus, Subscriptions } from '../src/core/EventBus';
import { FIXED_DT } from '../src/core/Loop';
import { BALANCE } from '../src/data/balance';
import { runSim } from '../scripts/sim';

describe('풀링 / 메모리', () => {
  it('20웨이브를 끝까지 돌려도 살아있는 엔티티 배열이 무한히 늘지 않는다', () => {
    const world = new World({ level: LEVEL_01, seed: 1 });
    world.economy.add(100000);
    for (const s of LEVEL_01.buildSlots) world.build(s.id);
    for (const s of LEVEL_01.buildSlots) for (let i = 0; i < 4; i++) world.upgrade(s.id);

    let peakEnemies = 0;
    let peakProjectiles = 0;
    let steps = 0;
    while (world.over === 'none' && steps < 60 * 60 * 30) {
      world.step(FIXED_DT);
      peakEnemies = Math.max(peakEnemies, world.liveEnemyCount);
      peakProjectiles = Math.max(peakProjectiles, world.liveProjectileCount);
      steps++;
    }

    expect(world.over).toBe('won');
    // 20웨이브 최대 동시 적 수는 스폰 간격과 처치 속도로 제한된다.
    // 총 582기를 다 던져도 동시 생존이 200을 넘으면 어딘가에서 회수가 안 되고 있는 것이다.
    expect(peakEnemies).toBeLessThan(200);
    expect(peakProjectiles).toBeLessThanOrEqual(BALANCE.maxProjectiles);
    // 끝나고 나면 전부 비어 있어야 한다
    expect(world.liveEnemyCount).toBe(0);
  });

  it('투사체가 상한을 넘지 않는다', () => {
    const world = new World({ level: LEVEL_01, seed: 7 });
    world.economy.add(100000);
    for (const s of LEVEL_01.buildSlots) world.build(s.id);
    for (const s of LEVEL_01.buildSlots) for (let i = 0; i < 4; i++) world.upgrade(s.id);
    for (let i = 0; i < 60 * 600; i++) {
      world.step(FIXED_DT);
      expect(world.liveProjectileCount).toBeLessThanOrEqual(BALANCE.maxProjectiles);
      if (world.over !== 'none') break;
    }
  });

  it('죽은 적을 노리던 투사체는 목표를 잃고 정리된다', () => {
    const world = new World({ level: LEVEL_01, seed: 3 });
    world.economy.add(100000);
    world.build('slot_a');
    for (let i = 0; i < 4; i++) world.upgrade('slot_a');

    for (let i = 0; i < 60 * 200; i++) {
      world.step(FIXED_DT);
      // 살아있는 적 id 집합
      const ids = new Set(world.enemies.map((e) => e.id));
      for (const p of world.projectiles) {
        // targetId가 0이 아니라면 반드시 살아있는 적이어야 한다
        if (p.targetId !== 0) expect(ids.has(p.targetId)).toBe(true);
      }
      if (world.waveRunner.displayIndex >= 3) break;
    }
  });
});

describe('구독 해제', () => {
  it('Subscriptions.dispose가 모든 리스너를 끊는다', () => {
    const bus = new EventBus<{ a: null; b: null }>();
    const subs = new Subscriptions();
    subs.add(bus.on('a', () => {}));
    subs.add(bus.on('a', () => {}));
    subs.add(bus.on('b', () => {}));
    expect(bus.listenerCount('a')).toBe(2);
    expect(bus.listenerCount('b')).toBe(1);
    subs.dispose();
    expect(bus.listenerCount('a')).toBe(0);
    expect(bus.listenerCount('b')).toBe(0);
    expect(subs.size).toBe(0);
  });

  it('offAll이 버스를 완전히 비운다 (재시작 경로)', () => {
    const world = new World({ level: LEVEL_01, seed: 1 });
    world.bus.on('enemy:killed', () => {});
    world.bus.on('wave:started', () => {});
    expect(world.bus.listenerCount('enemy:killed')).toBe(1);
    world.bus.offAll();
    expect(world.bus.listenerCount('enemy:killed')).toBe(0);
    expect(world.bus.listenerCount('wave:started')).toBe(0);
  });
});

describe('재시작', () => {
  it('새 World는 완전히 초기 상태다', () => {
    const first = new World({ level: LEVEL_01, seed: 1 });
    for (let i = 0; i < 60 * 120; i++) first.step(FIXED_DT);
    expect(first.elapsed).toBeGreaterThan(0);

    const second = new World({ level: LEVEL_01, seed: 1 });
    expect(second.elapsed).toBe(0);
    expect(second.kills).toBe(0);
    expect(second.leaks).toBe(0);
    expect(second.economy.gold).toBe(LEVEL_01.startGold);
    expect(second.castle.hp).toBe(LEVEL_01.castle.hp);
    expect(second.towers.size).toBe(0);
    expect(second.waveRunner.state).toBe('idle');
  });

  it('두 번 이어서 돌려도 결과가 같다 (전역 상태 오염 없음)', () => {
    const a = runSim({ towers: 5, upgrade: 'greedy', seed: 42 });
    const b = runSim({ towers: 5, upgrade: 'greedy', seed: 42 });
    expect(a.castleHp).toBe(b.castleHp);
    expect(a.kills).toBe(b.kills);
    expect(a.gold).toBe(b.gold);
  });
});
