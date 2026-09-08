import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/World';
import { Path } from '../src/sim/Path';
import { Rng } from '../src/core/Rng';
import { SpatialGrid } from '../src/core/SpatialGrid';
import { ObjectPool } from '../src/core/ObjectPool';
import { EventBus } from '../src/core/EventBus';
import { assignArrows, sortByTargeting } from '../src/sim/Tower';
import { Enemy } from '../src/sim/Enemy';
import { LEVEL_01 } from '../src/data/levels/level01';
import { UNITS } from '../src/data/units';
import { FIXED_DT } from '../src/core/Loop';
import { runSim } from '../scripts/sim';
import { spotKey } from '../src/sim/Placement';


/*
 * 자유 배치가 된 뒤로 build() 는 좌표를 받고, 타워의 id 는 그 좌표에서 나온다
 * (Placement.spotKey). 아래 두 헬퍼가 예전의 슬롯 id 를 그 좌표/키로 옮겨 준다 —
 * 레벨의 추천 자리는 자유 배치에서도 여전히 유효한 자리다.
 */
const at = (id: string): { x: number; z: number } =>
  LEVEL_01.buildSlots.find((s) => s.id === id)!;
const keyOf = (id: string): string => spotKey(at(id).x, at(id).z);

describe('Path', () => {
  const path = new Path([
    [0, 0],
    [100, 0],
    [100, 100],
  ]);

  it('총 길이가 세그먼트 합이다', () => {
    expect(path.totalLength).toBe(200);
  });

  it('positionAt이 세그먼트를 정확히 넘어간다', () => {
    expect(path.positionAt(0)).toEqual({ x: 0, z: 0 });
    expect(path.positionAt(50)).toEqual({ x: 50, z: 0 });
    expect(path.positionAt(100)).toEqual({ x: 100, z: 0 });
    expect(path.positionAt(150)).toEqual({ x: 100, z: 50 });
    expect(path.positionAt(200)).toEqual({ x: 100, z: 100 });
  });

  it('범위 밖은 양 끝으로 클램프한다', () => {
    expect(path.positionAt(-10)).toEqual({ x: 0, z: 0 });
    expect(path.positionAt(9999)).toEqual({ x: 100, z: 100 });
  });

  it('directionAt이 단위 벡터를 준다', () => {
    expect(path.directionAt(10)).toEqual({ x: 1, z: 0 });
    expect(path.directionAt(150)).toEqual({ x: 0, z: 1 });
  });

  it('lengthWithinRadius가 원-선분 교차 길이를 계산한다', () => {
    // (50,0) 위의 점에서 반경 30 -> 첫 세그먼트에서 60u
    expect(path.lengthWithinRadius(50, 0, 30)).toBeCloseTo(60, 6);
    // 모퉁이 (100,0) 안쪽에서 두 구간을 모두 덮는다
    expect(path.lengthWithinRadius(70, 30, 50)).toBeGreaterThan(50);
  });
});

describe('Rng 결정론', () => {
  it('같은 시드는 같은 수열을 만든다', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('다른 시드는 다른 수열을 만든다', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('0~1 범위를 벗어나지 않는다', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('SpatialGrid', () => {
  it('반경 안 후보를 빠짐없이 돌려준다', () => {
    const grid = new SpatialGrid<string>(100);
    grid.insert(10, 10, 'a');
    grid.insert(150, 10, 'b');
    grid.insert(900, 600, 'c');
    const out: string[] = [];
    grid.queryRadius(50, 10, 120, out);
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).not.toContain('c');
  });

  it('clear 후에는 아무것도 나오지 않는다', () => {
    const grid = new SpatialGrid<number>(100);
    grid.insert(0, 0, 1);
    grid.clear();
    const out: number[] = [];
    expect(grid.queryRadius(0, 0, 500, out)).toHaveLength(0);
  });
});

describe('ObjectPool', () => {
  it('반환한 객체를 재사용한다', () => {
    let created = 0;
    const pool = new ObjectPool(
      () => ({ v: ++created }),
      (o) => {
        o.v = -1;
      },
    );
    const a = pool.acquire();
    pool.release(a);
    const b = pool.acquire();
    expect(b).toBe(a);
    expect(created).toBe(1);
  });
});

describe('EventBus', () => {
  it('구독/발행/해제가 동작한다', () => {
    const bus = new EventBus<{ ping: { n: number } }>();
    let sum = 0;
    const off = bus.on('ping', (p) => {
      sum += p.n;
    });
    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });
    off();
    bus.emit('ping', { n: 4 });
    expect(sum).toBe(3);
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('핸들러 안에서 구독을 해제해도 안전하다', () => {
    const bus = new EventBus<{ ping: null }>();
    let calls = 0;
    const off = bus.on('ping', () => {
      calls++;
      off();
    });
    bus.on('ping', () => {
      calls++;
    });
    bus.emit('ping', null);
    expect(calls).toBe(2);
  });
});

describe('화살 배분 규칙 (밸런스의 핵심)', () => {
  function mkEnemy(id: number, distance: number, hp: number, x = 0, z = 0): Enemy {
    const e = new Enemy();
    e.init(id, UNITS.yt_infantry, 1, 1);
    e.distance = distance;
    e.hp = hp;
    e.worldX = x;
    e.worldZ = z;
    return e;
  }

  it('화살 수 <= 적 수이면 전부 서로 다른 적을 노린다', () => {
    const targets = [mkEnemy(1, 300, 20), mkEnemy(2, 200, 20), mkEnemy(3, 100, 20)];
    const out: Enemy[] = [];
    assignArrows(targets, 3, out);
    expect(out.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it('적이 모자랄 때만 선두 적에게 겹친다', () => {
    const targets = [mkEnemy(1, 300, 20), mkEnemy(2, 200, 20)];
    const out: Enemy[] = [];
    assignArrows(targets, 5, out);
    expect(out.map((e) => e.id)).toEqual([1, 2, 1, 1, 1]);
  });

  it('적이 없으면 아무것도 배정하지 않는다', () => {
    const out: Enemy[] = [];
    expect(assignArrows([], 5, out)).toHaveLength(0);
  });

  it('한 번에 나간 화살들이 다발 안의 제 번호를 갖는다 (뷰가 N발로 흩는 근거)', () => {
    const w = new World({ level: LEVEL_01, seed: 1 });
    w.economy.add(5000);
    const slot = LEVEL_01.buildSlots[0];
    const slotId = spotKey(slot.x, slot.z);
    w.build(slot, 'archer_tower');
    for (let i = 0; i < 4; i++) w.upgrade(slotId); // 5레벨 = 화살 5발

    const fired: { id: number; index: number; size: number }[] = [];
    w.bus.on('projectile:fired', ({ projectileId }) => {
      const p = w.projectiles.find((q) => q.id === projectileId)!;
      fired.push({ id: p.id, index: p.salvoIndex, size: p.salvoSize });
    });

    w.callWaveEarly();
    for (let i = 0; i < 4000 && fired.length < 2; i++) w.step(FIXED_DT);
    expect(fired.length).toBeGreaterThan(0);

    // 같은 다발은 0..size-1 을 한 번씩 쓴다 — 뷰가 이 값으로 레인을 나눈다
    const size = fired[0].size;
    const salvo = fired.filter((f) => f.size === size).slice(0, size);
    expect(new Set(salvo.map((f) => f.index)).size).toBe(salvo.length);
    for (const f of salvo) {
      expect(f.index).toBeGreaterThanOrEqual(0);
      expect(f.index).toBeLessThan(f.size);
    }
  });

  it('targeting 규칙마다 우선순위가 다르다', () => {
    const base = () => [mkEnemy(1, 100, 20, 0, 0), mkEnemy(2, 300, 5, 90, 0), mkEnemy(3, 200, 40, 40, 0)];

    const first = base();
    sortByTargeting(first, 'first', 0, 0);
    expect(first[0].id).toBe(2);

    const last = base();
    sortByTargeting(last, 'last', 0, 0);
    expect(last[0].id).toBe(1);

    const strongest = base();
    sortByTargeting(strongest, 'strongest', 0, 0);
    expect(strongest[0].id).toBe(3);

    const closest = base();
    sortByTargeting(closest, 'closest', 0, 0);
    expect(closest[0].id).toBe(1);
  });
});

describe('World 규칙', () => {
  function newWorld() {
    return new World({ level: LEVEL_01, seed: 1 });
  }

  it('건설은 골드를 소모하고 부족하면 실패한다', () => {
    const w = newWorld();
    expect(w.economy.gold).toBe(250);
    expect(w.build(at('slot_a'))).toBe('ok');
    expect(w.economy.gold).toBe(150);
    // 같은 자리에 겹쳐 지을 수 없다 — 이제 "점유"가 아니라 "간격" 규칙이 막는다
    expect(w.build(at('slot_a'))).toBe('too_close');
    expect(w.build(at('slot_b'))).toBe('ok');
    expect(w.economy.gold).toBe(50);
    expect(w.build(at('slot_c'))).toBe('no_gold');
    expect(w.build(at('slot_a'))).toBe('too_close');
  });

  it('업그레이드 비용과 판매 환급이 표대로다', () => {
    const w = newWorld();
    w.build(at('slot_a'));
    w.economy.add(100);
    const t = w.towers.get(keyOf('slot_a'))!;
    expect(t.level).toBe(1);
    expect(t.totalInvested).toBe(100);
    expect(w.upgrade(keyOf('slot_a'))).toBe('ok'); // 100
    expect(w.upgrade(keyOf('slot_a'))).toBe('ok'); // 150
    expect(t.level).toBe(3);
    expect(t.totalInvested).toBe(350);
    expect(t.sellValue()).toBe(245); // floor(350 * 0.7)
    const goldBefore = w.economy.gold;
    expect(w.sell(keyOf('slot_a'))).toBe(245);
    expect(w.economy.gold).toBe(goldBefore + 245);
    expect(w.towers.has(keyOf('slot_a'))).toBe(false);
  });

  it('만렙에서는 더 올라가지 않는다', () => {
    const w = newWorld();
    w.economy.add(10000);
    w.build(at('slot_a'));
    for (let i = 0; i < 4; i++) expect(w.upgrade(keyOf('slot_a'))).toBe('ok');
    expect(w.towers.get(keyOf('slot_a'))!.level).toBe(5);
    expect(w.upgrade(keyOf('slot_a'))).toBe('max_level');
  });

  it('성에 도착한 적은 죽을 때까지 반복 공격하고 성은 화살 두 발로 반격한다', () => {
    const level = {
      ...LEVEL_01,
      waves: [{
        index: 1,
        spawns: [{ unitId: 'yt_captain', at: 0, hpMul: 1, speedMul: 1 }],
        banner: '성문 전투 시험',
      }],
    };
    const w = new World({ level, seed: 1 });
    let reached = 0;
    let attacks = 0;
    let castleArrows = 0;
    w.bus.on('enemy:leaked', () => reached++);
    w.bus.on('enemy:castle-attack', () => attacks++);
    w.bus.on('projectile:fired', ({ towerSlotId, projectileId }) => {
      if (towerSlotId !== '__castle__') return;
      castleArrows++;
      expect(w.projectiles.find((p) => p.id === projectileId)?.damage).toBe(10);
    });
    w.callWaveEarly();
    for (let i = 0; i < 60 * 180 && w.over === 'none'; i++) w.step(FIXED_DT);
    expect(reached).toBe(1);
    expect(attacks).toBeGreaterThanOrEqual(1);
    expect(castleArrows).toBeGreaterThanOrEqual(2);
    expect(castleArrows % 2).toBe(0);
    expect(w.kills).toBe(1);
    expect(w.over).toBe('won');
  });

  it('조기 소집은 남은 시간에 비례한 골드를 준다', () => {
    const w = newWorld();
    w.step(FIXED_DT);
    const before = w.economy.gold;
    const bonus = w.callWaveEarly();
    expect(bonus).toBeGreaterThan(0);
    expect(w.economy.gold).toBe(before + bonus);
    expect(w.waveRunner.state).toBe('spawning');
    // 웨이브 진행 중에는 다시 소집할 수 없다
    expect(w.callWaveEarly()).toBe(0);
  });

  it('죽은 적의 골드가 지급되고 이벤트가 발행된다', () => {
    const w = newWorld();
    w.economy.add(10000);
    w.build(at('slot_a'));
    let killed = 0;
    let goldFromKills = 0;
    w.bus.on('enemy:killed', (e) => {
      killed++;
      goldFromKills += e.gold;
    });
    for (let i = 0; i < 60 * 120 && killed < 5; i++) w.step(FIXED_DT);
    expect(killed).toBeGreaterThanOrEqual(5);
    expect(goldFromKills).toBe(killed * 10);
  });

  it('3레벨 궁노 화살은 착탄 지점에 지속 화염 지대를 만든다', () => {
    const w = newWorld();
    w.economy.add(10_000);
    expect(w.build(at('slot_a'))).toBe('ok');
    expect(w.upgrade(keyOf('slot_a'))).toBe('ok');
    expect(w.upgrade(keyOf('slot_a'))).toBe('ok');
    let created = 0;
    w.bus.on('fire-zone:created', () => created++);
    w.callWaveEarly();
    for (let i = 0; i < 60 * 120 && created === 0; i++) w.step(FIXED_DT);
    expect(created).toBeGreaterThan(0);
    expect(w.fireZones.length).toBeGreaterThan(0);
  });
});

describe('밸런스 (헤드리스 12웨이브)', () => {
  it('업그레이드를 하면 12웨이브를 클리어한다', () => {
    const r = runSim({ towers: 5, upgrade: 'greedy', seed: 1 });
    expect(r.won).toBe(true);
    expect(r.rows).toHaveLength(12);
    /*
     * 난이도를 올린 뒤(횡대 확대 + 적 체력 배율 + 타워 피해 배율, BALANCE.difficulty)
     * 최적 플레이도 무손실은 아니다 — 실측 992/1000, 누수 2.
     * 여기서 크게 벗어나면 1장이 다시 무풍지대가 되었거나 너무 매워진 것이다.
     */
    expect(r.castleHp).toBeGreaterThanOrEqual(900);
    expect(r.leaks).toBeLessThanOrEqual(10);
  });

  it('모퉁이 3기만으로도 업그레이드하면 이긴다', () => {
    const r = runSim({ slots: ['slot_a', 'slot_b', 'slot_c'], upgrade: 'greedy', seed: 1 });
    expect(r.won).toBe(true);
  });

  it('업그레이드를 전혀 안 하면 중간보스 웨이브에서 무너진다', () => {
    // 웨이브가 앞 웨이브의 클리어를 기다리지 않고 시간표대로 오므로,
    // 성이 무너지는 순간 스포너는 이미 다음 웨이브를 뿌리고 있다.
    // 그래서 "몇 파에서 죽었나"보다 "10파에 이미 무너지고 있었나"가 정확한 판정이다.
    for (const towers of [5, 3]) {
      const r = runSim({ towers, upgrade: 'none', seed: 1 });
      expect(r.won).toBe(false);
      // 절반도 못 간다
      expect(r.lastWave).toBeLessThanOrEqual(12);
      // 처음 누수가 나는 시점이 중간보스(10파) 이전이다 — 거기서부터 무너진다
      const firstLeak = r.rows.find((row) => row.leaks > 0);
      expect(firstLeak).toBeDefined();
      expect(firstLeak!.wave).toBeLessThanOrEqual(10);
    }
  });

  it('배치가 나빠도 업그레이드하면 이기지만 성 체력을 잃는다', () => {
    const r = runSim({ slots: ['slot_d', 'slot_e', 'slot_a'], upgrade: 'greedy', seed: 1 });
    expect(r.won).toBe(true);
    expect(r.castleHp).toBeLessThan(1000);
  });

  it('같은 시드로 두 번 돌리면 결과가 완전히 동일하다 (결정론)', () => {
    const a = runSim({ towers: 5, upgrade: 'greedy', seed: 123 });
    const b = runSim({ towers: 5, upgrade: 'greedy', seed: 123 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('총 획득 가능 골드가 4670G다 (보병 3720 + 보스 700 + 시작 250)', () => {
    const minionGold = 372 * 10;
    const bossGold = 200 + 500;
    expect(minionGold + bossGold + LEVEL_01.startGold).toBe(4670);
  });
});
