import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/World';
import { Tower, towerMaxHp } from '../src/sim/Tower';
import { Enemy } from '../src/sim/Enemy';
import { LEVEL_01, LEVEL_02 } from '../src/data/levels';
import { TOWERS, getTower } from '../src/data/towers';
import { BALANCE } from '../src/data/balance';
import { UNITS } from '../src/data/units';
import { FIXED_DT } from '../src/core/Loop';

/**
 * 공성전 — 적이 망루를 부순다.
 *
 * 여기서 지키는 것은 규칙이지 수치가 아니다. 밸런스 숫자(피해 배율·체력 계수)는
 * 손볼 때마다 바뀌므로 BALANCE 에서 읽어 쓴다. 깨지면 안 되는 것은
 * "일곱은 망루로 셋은 성문으로", "0이 되면 무너진다", "무너지면 자리가 풀린다"
 * 같은, 이 기능이 무엇인가를 정하는 문장들이다.
 */

/** 망루 하나를 세우고 그 앞에 적을 원하는 수만큼 붙여 둔 판을 만든다. */
function siegeWorld(opts: { towerId?: string; unitId?: string; count?: number } = {}) {
  const world = new World({ level: LEVEL_02, seed: 7 });
  world.economy.add(100000);
  const spot = LEVEL_02.buildSlots[0];
  expect(world.build(spot, opts.towerId ?? 'archer_tower')).toBe('ok');
  const tower = [...world.towers.values()][0];

  /*
   * 망루 옆의 길 위에 적을 세운다.
   *
   * 월드 좌표를 직접 넣으면 안 된다 — 길 위에 있는 적의 위치는 distance 에서
   * 파생되므로 다음 스텝에 경로 시작점으로 되돌아간다(World.moveEnemies).
   * 진실의 출처에 값을 넣어야 한다.
   */
  const onPath = world.path.nearestDistance(tower.x, tower.z);
  const attach = (n: number): Enemy[] => {
    const made: Enemy[] = [];
    for (let i = 0; i < n; i++) {
      (world as unknown as { spawnEnemy: (s: unknown) => void }).spawnEnemy({
        unitId: opts.unitId ?? 'xl_infantry',
        at: 0,
        hpMul: 500, // 맞아 죽지 않게 — 재는 것은 망루가 받는 피해다
        speedMul: 1,
      });
      const e = world.enemies[world.enemies.length - 1];
      e.role = 'raider';
      e.distance = onPath;
      e.prevDistance = onPath;
      made.push(e);
    }
    return made;
  };
  return { world, tower, attach, onPath };
}

function run(world: World, seconds: number): void {
  for (let i = 0; i < seconds / FIXED_DT && world.over === 'none'; i++) world.step(FIXED_DT);
}

describe('망루 체력', () => {
  it('건설비와 종류와 레벨이 정한다 — 표에 따로 적지 않는다', () => {
    const archer = towerMaxHp(TOWERS.archer_tower, 1);
    const cannon = towerMaxHp(TOWERS.cannon_tower, 1);
    // 화포 진지는 세 배 비싸고 더 단단하다 (buildCost 300 vs 100, toughness 1.3 vs 1)
    expect(cannon).toBeGreaterThan(archer * 3);
    // 철질려는 값이 싸지만 부술 것이 없어 가장 질기다 (toughness 2.2)
    expect(TOWERS.caltrop_camp.toughness!).toBeGreaterThan(TOWERS.archer_tower.toughness!);
  });

  it('레벨이 오르면 체력도 오르되 투자 총액에 비례하지는 않는다', () => {
    const lv1 = towerMaxHp(TOWERS.archer_tower, 1);
    const lv5 = towerMaxHp(TOWERS.archer_tower, 5);
    expect(lv5).toBeGreaterThan(lv1);
    /*
     * 1->5레벨 투자는 여덟 배(100 -> 800)지만 체력은 그만큼 늘면 안 된다.
     * 비례시키면 다 올린 망루를 무엇으로도 못 부숴 공성전이 그림으로만 남는다.
     */
    expect(lv5 / lv1).toBeLessThan(5);
    // 반올림이 섞이므로 소수 둘째 자리까지만 본다
    expect(lv5 / lv1).toBeCloseTo(Math.pow(BALANCE.towerCombat.levelHpMul, 4), 2);
  });

  it('업그레이드는 부서진 양을 그대로 두고 늘어난 만큼만 채운다', () => {
    const world = new World({ level: LEVEL_02, seed: 1 });
    world.economy.add(100000);
    world.build(LEVEL_02.buildSlots[0], 'archer_tower');
    const tower = [...world.towers.values()][0];
    const lost = 200;
    tower.takeDamage(lost);
    const beforeMax = tower.maxHp;
    world.upgrade(tower.slotId);
    expect(tower.maxHp).toBeGreaterThan(beforeMax);
    // 잃은 양은 그대로다 — 강화가 공짜 수리가 되면 안 된다
    expect(tower.maxHp - tower.hp).toBeCloseTo(lost, 5);
  });
});

describe('습격조와 돌파조', () => {
  it('열 중 일곱이 망루를 노린다 (BALANCE.towerCombat.raiderRatio)', () => {
    const world = new World({ level: LEVEL_01, seed: 3 });
    // 200기를 스폰해 비율을 잰다. 난수는 시드에서 나오므로 결과는 늘 같다.
    for (let i = 0; i < 200; i++) {
      (world as unknown as { spawnEnemy: (s: unknown) => void }).spawnEnemy({
        unitId: 'yt_infantry',
        at: 0,
        hpMul: 1,
        speedMul: 1,
      });
    }
    const raiders = world.enemies.filter((e) => e.role === 'raider').length;
    const ratio = raiders / world.enemies.length;
    expect(ratio).toBeGreaterThan(BALANCE.towerCombat.raiderRatio - 0.1);
    expect(ratio).toBeLessThan(BALANCE.towerCombat.raiderRatio + 0.1);
  });

  it('같은 시드는 같은 역할 배분을 낸다 (결정론)', () => {
    const roles = (): string[] => {
      const w = new World({ level: LEVEL_01, seed: 11 });
      for (let i = 0; i < 40; i++) {
        (w as unknown as { spawnEnemy: (s: unknown) => void }).spawnEnemy({
          unitId: 'yt_infantry', at: 0, hpMul: 1, speedMul: 1,
        });
      }
      return w.enemies.map((e) => e.role);
    };
    expect(roles()).toEqual(roles());
  });

  it('망루가 하나도 없으면 습격조도 그냥 성문으로 간다', () => {
    const world = new World({ level: LEVEL_02, seed: 5 });
    (world as unknown as { spawnEnemy: (s: unknown) => void }).spawnEnemy({
      unitId: 'xl_infantry', at: 0, hpMul: 100, speedMul: 1,
    });
    const e = world.enemies[0];
    e.role = 'raider';
    run(world, 5);
    expect(e.detached).toBe(false);
    expect(e.distance).toBeGreaterThan(0);
  });
});

describe('포위와 타격', () => {
  it('습격조가 길을 벗어나 망루에 붙는다', () => {
    const { world, attach } = siegeWorld();
    const [e] = attach(1);
    run(world, 4);
    expect(e.detached).toBe(true);
    expect(['approach', 'assault']).toContain(e.siege);
    expect(e.targetSlotId).not.toBeNull();
  });

  it('붙은 적이 주기마다 망루를 깎는다', () => {
    const { world, tower, attach } = siegeWorld();
    attach(1);
    const full = tower.maxHp;
    run(world, 12);
    expect(tower.hp).toBeLessThan(full);
  });

  it('안쪽 고리만 때린다 — 바깥 고리는 자리가 날 때까지 기다린다', () => {
    const tc = BALANCE.towerCombat;
    const { world, tower, attach } = siegeWorld();
    // 안쪽 자리보다 훨씬 많이 붙인다
    attach(tc.slots * 2);
    run(world, 4);
    const striking = world.enemies.filter((e) => e.siege === 'assault' && Tower.isAssaultSlot(e.siegeSlotIndex));
    const waiting = world.enemies.filter((e) => e.siege === 'assault' && !Tower.isAssaultSlot(e.siegeSlotIndex));
    expect(striking.length).toBeLessThanOrEqual(tc.slots);
    expect(waiting.length).toBeGreaterThan(0);
    // 자리는 겹치지 않는다
    const taken = tower.siegeSlots.filter((v) => v !== 0);
    expect(new Set(taken).size).toBe(taken.length);
  });

  it('한 망루에 매달릴 수 있는 시간에 상한이 있다 — 그 뒤엔 돌파조가 된다', () => {
    const { world, attach } = siegeWorld();
    const [e] = attach(1);
    run(world, 4);
    expect(e.siege).toBe('assault');
    // 상한 + 복귀 시간만큼 더 굴린다
    run(world, BALANCE.towerCombat.assaultSeconds + 8);
    expect(e.role).toBe('runner');
    expect(e.detached).toBe(false);
    expect(e.siege).toBe('none');
  });

  it('길로 돌아갈 때 지나온 거리보다 뒤로 밀리지 않는다', () => {
    const { world, attach } = siegeWorld();
    const [e] = attach(1);
    run(world, 4);
    const atSiege = e.distance;
    run(world, BALANCE.towerCombat.assaultSeconds + 8);
    expect(e.distance).toBeGreaterThanOrEqual(atSiege);
  });

  it('장수는 잡몹보다 자주, 더 세게 친다', () => {
    const minion = new Enemy();
    const boss = new Enemy();
    minion.init(1, UNITS.xl_infantry, 1, 1, 0, 'raider');
    boss.init(2, UNITS.lubu, 1, 1, 0, 'raider');
    expect(boss.towerStrikeInterval).toBeLessThan(minion.towerStrikeInterval);
    const minionDps = minion.towerStrikeDamage / minion.towerStrikeInterval;
    const bossDps = boss.towerStrikeDamage / boss.towerStrikeInterval;
    expect(bossDps).toBeGreaterThan(minionDps * 3);
  });

  it('유닛의 공격력에 difficulty.unitDamageMul 이 한 번만 곱해진다', () => {
    const e = new Enemy();
    e.init(1, UNITS.xl_infantry, 1, 1, 0, 'runner');
    expect(e.castleDamage).toBeCloseTo(
      UNITS.xl_infantry.castleDamage * BALANCE.difficulty.unitDamageMul,
      6,
    );
  });
});

describe('망루가 무너진다', () => {
  it('체력이 0이 되면 판에서 사라지고 이벤트가 난다', () => {
    const { world, tower, attach } = siegeWorld({ unitId: 'lubu' });
    let destroyed: { slotId: string; lostGold: number } | null = null;
    world.bus.on('tower:destroyed', (e) => {
      destroyed = { slotId: e.slotId, lostGold: e.lostGold };
    });
    tower.hp = 1;
    // 실제 경로로 부순다 — 장수를 붙여 때리게 한다
    attach(1);
    run(world, 10);

    expect(world.towers.has(tower.slotId)).toBe(false);
    expect(destroyed).not.toBeNull();
    expect(destroyed!.slotId).toBe(tower.slotId);
    // 되찾은 골드는 없다 — 그게 이 규칙의 값이다
    expect(destroyed!.lostGold).toBe(getTower('archer_tower').buildCost);
  });

  it('무너지면 둘러싸던 적들이 풀려 다시 길로 간다', () => {
    const { world, tower, attach } = siegeWorld();
    const attackers = attach(4);
    run(world, 4);
    expect(attackers.some((e) => e.targetSlotId === tower.slotId)).toBe(true);

    tower.hp = 0;
    run(world, FIXED_DT * 2);
    expect(world.towers.has(tower.slotId)).toBe(false);
    for (const e of attackers) {
      expect(e.targetSlotId).toBeNull();
      expect(e.siege === 'return' || e.siege === 'none').toBe(true);
    }
  });

  it('무너진 자리에는 다시 지을 수 있다', () => {
    const { world, tower } = siegeWorld();
    const before = world.towerCount;
    tower.hp = 0;
    run(world, FIXED_DT * 2);
    expect(world.towerCount).toBe(before - 1);
    expect(world.canBuildAt(tower.x, tower.z)).toBe('ok');
  });

  it('팔아도 둘러싸던 적이 풀린다 — 없는 자리를 계속 때리면 안 된다', () => {
    const { world, tower, attach } = siegeWorld();
    const attackers = attach(3);
    run(world, 4);
    world.sell(tower.slotId);
    for (const e of attackers) expect(e.targetSlotId).toBeNull();
  });
});

describe('망루 수리', () => {
  it('총 투자액의 절반을 내고 최대 체력의 절반을 채운다', () => {
    const world = new World({ level: LEVEL_02, seed: 1 });
    world.economy.add(100000);
    world.build(LEVEL_02.buildSlots[0], 'archer_tower');
    const tower = [...world.towers.values()][0];
    tower.hp = 1;

    const cost = tower.repairCost;
    expect(cost).toBe(Math.ceil(tower.totalInvested * BALANCE.towerCombat.repairCostRatio));
    const gold = world.economy.gold;
    const healed = world.repairTower(tower.slotId);
    expect(healed).toBe(Math.round(tower.maxHp * BALANCE.towerCombat.repairFraction));
    expect(world.economy.gold).toBe(gold - cost);
  });

  it('부족분이 회복량보다 적으면 그만큼만 채운다 (넘치지 않는다)', () => {
    const world = new World({ level: LEVEL_02, seed: 1 });
    world.economy.add(100000);
    world.build(LEVEL_02.buildSlots[0], 'archer_tower');
    const tower = [...world.towers.values()][0];
    tower.takeDamage(10);
    world.repairTower(tower.slotId);
    expect(tower.hp).toBe(tower.maxHp);
  });

  it('골드가 모자라면 못 고친다', () => {
    const world = new World({ level: LEVEL_02, seed: 1 });
    world.economy.add(100000);
    world.build(LEVEL_02.buildSlots[0], 'archer_tower');
    const tower = [...world.towers.values()][0];
    tower.hp = 1;
    // 딱 1골드 모자라게 만든다
    world.economy.trySpend(world.economy.gold - (tower.repairCost - 1));
    expect(world.repairTowerStatus(tower.slotId)).toBe('no_gold');
    expect(world.repairTower(tower.slotId)).toBe(0);
    expect(tower.hp).toBe(1);
  });

  it('멀쩡한 망루는 고칠 것이 없다', () => {
    const world = new World({ level: LEVEL_02, seed: 1 });
    world.economy.add(100000);
    world.build(LEVEL_02.buildSlots[0], 'archer_tower');
    const tower = [...world.towers.values()][0];
    expect(world.repairTowerStatus(tower.slotId)).toBe('full');
    expect(world.repairTowerQuote(tower.slotId)).toBeNull();
  });

  it('연달아 고칠 수는 없다 — 쿨다운이 있다', () => {
    const world = new World({ level: LEVEL_02, seed: 1 });
    world.economy.add(100000);
    world.build(LEVEL_02.buildSlots[0], 'archer_tower');
    const tower = [...world.towers.values()][0];
    tower.hp = 1;
    expect(world.repairTower(tower.slotId)).toBeGreaterThan(0);
    tower.hp = 1;
    expect(world.repairTowerStatus(tower.slotId)).toBe('cooldown');
    run(world, BALANCE.towerCombat.repairCooldownSec + 0.5);
    expect(world.repairTowerStatus(tower.slotId)).toBe('ok');
  });

  it('없는 망루는 고칠 수 없다', () => {
    const world = new World({ level: LEVEL_02, seed: 1 });
    expect(world.repairTowerStatus('없는자리')).toBe('no_tower');
    expect(world.repairTower('없는자리')).toBe(0);
  });
});

describe('망루는 자기를 때리는 적을 먼저 쏜다', () => {
  it('타게팅 설정보다 위에 있는 규칙이다', () => {
    const world = new World({ level: LEVEL_02, seed: 1 });
    world.economy.add(100000);
    world.build(LEVEL_02.buildSlots[0], 'archer_tower');
    const tower = [...world.towers.values()][0];
    tower.targeting = 'first';

    const make = (id: number, distance: number, sieging: boolean): Enemy => {
      const e = new Enemy();
      e.init(id, UNITS.xl_infantry, 1, 1, 0, 'raider');
      e.worldX = tower.x + 10;
      e.worldZ = tower.z + 10;
      e.distance = distance;
      if (sieging) e.targetSlotId = tower.slotId;
      return e;
    };
    // 경로를 훨씬 많이 지난 적(앞선 적)과, 그보다 뒤처졌지만 망루를 때리는 적
    const ahead = make(1, 900, false);
    const besieger = make(2, 10, true);

    const out: Enemy[] = [];
    tower.acquire([ahead, besieger], out);
    expect(out[0]).toBe(besieger);
    expect(out[1]).toBe(ahead);
  });
});
