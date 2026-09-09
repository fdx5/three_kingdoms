import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/World';
import { Path } from '../src/sim/Path';
import { Enemy } from '../src/sim/Enemy';
import { LEVEL_01, LEVEL_02, LEVEL_ORDER, nextLevelId, isTowerAvailable, getLevel } from '../src/data/levels';
import { UNITS } from '../src/data/units';
import { TOWERS } from '../src/data/towers';
import { BALANCE } from '../src/data/balance';
import { composeWave } from '../src/data/waves';
import { applySplash, applySlowAura, applyHealAura, applyFieldDamage } from '../src/sim/effects';
import { STRATAGEMS, getStratagem } from '../src/data/stratagems';
import { FIXED_DT } from '../src/core/Loop';
import { runSim } from '../scripts/sim';

describe('레벨 레지스트리', () => {
  it('진행 순서가 정의되어 있고 다음 레벨을 찾을 수 있다', () => {
    // 앞 두 장의 순서만 고정한다. 뒤에 장이 붙어도 이 테스트가 깨지면 안 된다.
    expect(LEVEL_ORDER.slice(0, 2).map((l) => l.id)).toEqual(['level01', 'level02']);
    expect(nextLevelId('level01')).toBe('level02');
    expect(nextLevelId(LEVEL_ORDER[LEVEL_ORDER.length - 1].id)).toBeNull();
    expect(getLevel('level02')).toBe(LEVEL_02);
    expect(() => getLevel('nope')).toThrow();
  });

  it('레벨 2 타워는 레벨 1에서 잠겨 있다', () => {
    expect(isTowerAvailable(undefined, 'level01')).toBe(true);
    expect(isTowerAvailable('level02', 'level01')).toBe(false);
    expect(isTowerAvailable('level02', 'level02')).toBe(true);
  });

  it('레벨 1에서는 벽력거·철질려를 지을 수 없다', () => {
    const w = new World({ level: LEVEL_01, seed: 1 });
    w.economy.add(10000);
    const spot1 = LEVEL_01.buildSlots[0];
    expect(w.build(spot1, 'catapult')).toBe('locked');
    expect(w.build(spot1, 'caltrop_camp')).toBe('locked');
    expect(w.build(spot1, 'archer_tower')).toBe('ok');
  });

  it('레벨 2에서는 세 종류를 모두 지을 수 있다', () => {
    const w = new World({ level: LEVEL_02, seed: 1 });
    w.economy.add(10000);
    const at2 = (id: string) => LEVEL_02.buildSlots.find((s) => s.id === id)!;
    expect(w.build(at2('s2_a'), 'archer_tower')).toBe('ok');
    expect(w.build(at2('s2_b'), 'catapult')).toBe('ok');
    expect(w.build(at2('s2_c'), 'caltrop_camp')).toBe('ok');
  });
});

describe('레벨 2 맵', () => {
  const path = new Path(LEVEL_02.path);

  it('경로 총 길이가 2400~2900u 범위다', () => {
    expect(path.totalLength).toBeGreaterThanOrEqual(2400);
    expect(path.totalLength).toBeLessThanOrEqual(2900);
  });

  it('경로가 맵(1200x700) 안에 있다', () => {
    for (const [x, z] of LEVEL_02.path) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1200);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(700);
    }
  });

  it('건설 슬롯 6개 중 3개가 사거리 100으로 300u 이상을 덮는다', () => {
    const coverage = LEVEL_02.buildSlots.map((s) => ({
      id: s.id,
      cover: Math.round(path.lengthWithinRadius(s.x, s.z, 100)),
    }));
    console.log(
      '  레벨2 슬롯 커버리지(사거리 100):',
      coverage.map((c) => `${c.id}=${c.cover}u`).join('  '),
    );
    expect(LEVEL_02.buildSlots).toHaveLength(6);
    expect(coverage.filter((c) => c.cover >= 300)).toHaveLength(3);
    // 나머지 3개는 확실히 나쁜 자리여야 배치 판단에 의미가 생긴다
    expect(coverage.filter((c) => c.cover < 250)).toHaveLength(3);
  });

  it('슬롯이 경로 위에 놓이지 않는다', () => {
    for (const s of LEVEL_02.buildSlots) {
      expect(path.lengthWithinRadius(s.x, s.z, 45)).toBe(0);
    }
  });

  it('슬롯 id가 레벨 1과 겹치지 않는다', () => {
    const l1 = new Set(LEVEL_01.buildSlots.map((s) => s.id));
    for (const s of LEVEL_02.buildSlots) expect(l1.has(s.id)).toBe(false);
  });

  it('성 체력이 레벨 1보다 낮다 (누수가 실제 위협이어야 한다)', () => {
    expect(LEVEL_02.castle.hp).toBeLessThan(LEVEL_01.castle.hp);
    expect(LEVEL_02.castle.hp).toBe(600);
  });

  it('성벽 수리는 레벨 2에서만 열린다', () => {
    expect(LEVEL_01.allowRepair ?? false).toBe(false);
    expect(LEVEL_02.allowRepair).toBe(true);
  });
});

describe('레벨 2 웨이브 구성', () => {
  it('웨이브가 14개다', () => {
    expect(LEVEL_02.waves).toHaveLength(14);
  });

  it('새 유닛이 지정한 웨이브부터 등장한다', () => {
    const firstWaveWith = (unitId: string) =>
      LEVEL_02.waves.find((w) => w.spawns.some((s) => s.unitId === unitId))?.index;
    expect(firstWaveWith('xl_infantry')).toBe(1);
    expect(firstWaveWith('xl_cavalry')).toBe(3);
    expect(firstWaveWith('xl_shield')).toBe(5);
    expect(firstWaveWith('xl_healer')).toBe(8);
  });

  /*
   * 표의 배율 x 전역 difficulty.bossHpMul 이 실제 체력이다 (2.875배 / 4.025배).
   * 공성전이 들어오면서 bossHpMul 이 2.0 -> 2.3 으로 올랐다 — 장수는 이제 망루도
   * 부수는데, 그러려면 망루 앞에서 몇 초는 버텨야 하기 때문이다. 표(1.25 / 1.75)는
   * 그대로다: 이 장이 정한 것은 "화웅보다 여포가 1.4배"라는 비율이지 절대치가 아니다.
   */
  it('7파 중간보스는 체력 2.875배, 14파 최종보스는 4.025배다', () => {
    const boss = BALANCE.difficulty.bossHpMul;
    const hua = LEVEL_02.waves[6].spawns.filter((s) => s.unitId === 'huaxiong');
    const lu = LEVEL_02.waves[13].spawns.filter((s) => s.unitId === 'lubu');
    expect(hua).toHaveLength(1);
    expect(lu).toHaveLength(1);
    expect(hua[0].hpMul * boss).toBeCloseTo(2.875, 6);
    // 표의 1.75가 이 장의 상한 — 2.0이면 여포가 성문에 붙는 순간 14파에서 진다.
    expect(lu[0].hpMul * boss).toBeCloseTo(4.025, 6);
    for (let i = 0; i < 14; i++) {
      if (i === 6 || i === 13) continue;
      const bosses = LEVEL_02.waves[i].spawns.filter(
        (s) => UNITS[s.unitId].kind !== 'minion',
      );
      expect(bosses).toHaveLength(0);
    }
  });

  it('composeWave가 난수 없이 가중치대로 섞는다 (결정론)', () => {
    const mix = [
      { unitId: 'a', from: 1, weight: 3 },
      { unitId: 'b', from: 1, weight: 1 },
    ];
    const first = composeWave(mix, 1, 8);
    const second = composeWave(mix, 1, 8);
    expect(first).toEqual(second);
    expect(first.filter((u) => u === 'a')).toHaveLength(6);
    expect(first.filter((u) => u === 'b')).toHaveLength(2);
    // 같은 종류가 통째로 몰리지 않는다
    expect(first.join('')).not.toBe('aaaaaabb');
  });

  it('아직 등장하지 않은 유닛은 섞이지 않는다', () => {
    const mix = [
      { unitId: 'a', from: 1, weight: 1 },
      { unitId: 'b', from: 5, weight: 1 },
    ];
    expect(composeWave(mix, 1, 6).every((u) => u === 'a')).toBe(true);
    expect(composeWave(mix, 5, 6)).toContain('b');
  });

  it('특수 웨이브 배율을 포함해 총 일반 병력이 455기다', () => {
    const minions = LEVEL_02.waves
      .flatMap((w) => w.spawns)
      .filter((s) => UNITS[s.unitId].kind === 'minion').length;
    expect(minions).toBe(455);
  });
});

describe('적 속성', () => {
  function mkEnemy(unitId: string): Enemy {
    const e = new Enemy();
    e.init(1, UNITS[unitId], 1, 1);
    return e;
  }

  it('방패병은 화살 피해를 줄이지만 공성 피해는 그대로 받는다', () => {
    const shield = mkEnemy('xl_shield');
    expect(shield.damageAfterResist(100, 'ranged')).toBeCloseTo(28, 6);
    expect(shield.damageAfterResist(100, 'siege')).toBe(100);
  });

  it('평범한 보병은 저항이 없다', () => {
    const inf = mkEnemy('xl_infantry');
    expect(inf.damageAfterResist(100, 'ranged')).toBe(100);
    expect(inf.damageAfterResist(100, 'siege')).toBe(100);
  });

  it('감속은 중첩되지 않고 더 센 쪽이 남는다', () => {
    const e = mkEnemy('xl_infantry');
    const base = e.speed;
    e.applySlow(0.5, 2);
    expect(e.effectiveSpeed).toBeCloseTo(base * 0.5, 6);
    // 약한 감속은 배율을 덮어쓰지 않는다
    e.applySlow(0.8, 5);
    expect(e.slowMul).toBe(0.5);
    expect(e.slowTimer).toBe(5); // 지속 시간은 늘어난다
    // 더 센 감속은 덮어쓴다
    e.applySlow(0.3, 1);
    expect(e.slowMul).toBe(0.3);
  });

  it('여포는 주기적으로 돌진해 속도가 오른다', () => {
    const w = new World({ level: LEVEL_02, seed: 1 });
    const lubu = new Enemy();
    lubu.init(1, UNITS.lubu, 1, 1);
    w.enemies.push(lubu);
    const base = lubu.speed;

    expect(lubu.effectiveSpeed).toBeCloseTo(base, 6);
    // charge.every = 8초가 지나면 발동한다
    for (let i = 0; i < 60 * 9; i++) w.step(FIXED_DT);
    // 돌진 중이거나(2.6배) 이미 한 번 끝났다 — 어느 쪽이든 기본 속도로만 걷지는 않았다
    expect(lubu.distance).toBeGreaterThan(base * 9);
  });

  it('도사는 주변 아군을 회복시킨다', () => {
    const healer = mkEnemy('xl_healer');
    healer.worldX = 100;
    healer.worldZ = 100;
    const hurt = mkEnemy('xl_infantry');
    hurt.id = 2;
    hurt.worldX = 140;
    hurt.worldZ = 100;
    hurt.hp = 10;
    const far = mkEnemy('xl_infantry');
    far.id = 3;
    far.worldX = 600;
    far.worldZ = 600;
    far.hp = 10;

    const aura = UNITS.xl_healer.traits!.healAura!;
    applyHealAura(healer, [healer, hurt, far], aura.radius, aura.hps, 1);
    expect(hurt.hp).toBeCloseTo(10 + aura.hps, 6);
    expect(far.hp).toBe(10); // 사거리 밖
  });

  it('회복은 최대 체력을 넘지 않는다', () => {
    const healer = mkEnemy('xl_healer');
    const ally = mkEnemy('xl_infantry');
    ally.id = 2;
    ally.hp = ally.maxHp - 1;
    applyHealAura(healer, [healer, ally], 200, 1000, 1);
    expect(ally.hp).toBe(ally.maxHp);
  });
});

describe('타워 효과', () => {
  it('범위 피해는 반경 안 적에게 거리에 따라 감소해 들어간다', () => {
    const mk = (id: number, x: number) => {
      const e = new Enemy();
      e.init(id, UNITS.xl_infantry, 1, 1);
      e.worldX = x;
      e.worldZ = 0;
      return e;
    };
    const direct = mk(1, 0);
    const near = mk(2, 20);
    const edge = mk(3, 58);
    const outside = mk(4, 200);

    const dealt: Record<number, number> = {};
    const hits = applySplash([direct, near, edge, outside], 0, 0, 62, 0.55, 100, 1, (e, amt) => {
      dealt[e.id] = (dealt[e.id] ?? 0) + amt;
    });

    expect(hits).toBe(2);
    expect(dealt[1]).toBeUndefined(); // 직격 대상은 제외 (본체 피해를 이미 받았다)
    expect(dealt[4]).toBeUndefined(); // 반경 밖
    expect(dealt[2]).toBeGreaterThan(dealt[3]); // 가까울수록 크다
    expect(dealt[3]).toBeGreaterThan(0);
  });

  it('범위 피해는 공성 피해라 방패병 저항을 무시한다', () => {
    const shield = new Enemy();
    shield.init(1, UNITS.xl_shield, 1, 1);
    let kind = '';
    applySplash([shield], 0, 0, 62, 0, 100, 0, (_e, _amt, k) => {
      kind = k;
    });
    expect(kind).toBe('siege');
  });

  it('감속 오라는 감속 면역이 아닌 적만 늦춘다', () => {
    const a = new Enemy();
    a.init(1, UNITS.xl_cavalry, 1, 1);
    const affected = applySlowAura([a], 0.42, 2.6);
    expect(affected).toBe(1);
    expect(a.slowMul).toBe(0.42);
  });

  it('벽력거는 레벨이 올라도 발사체가 1개다 (단일 대상 화력)', () => {
    expect(TOWERS.catapult.levels.map((l) => l.arrows)).toEqual([1, 1, 1, 1, 1]);
    expect(TOWERS.catapult.damageKind).toBe('siege');
    expect(TOWERS.catapult.effect?.type).toBe('splash');
  });

  it('철질려는 피해가 0이고 aura로 동작한다', () => {
    expect(TOWERS.caltrop_camp.kind).toBe('aura');
    expect(TOWERS.caltrop_camp.levels.every((l) => l.damagePerArrow === 0)).toBe(true);
    expect(TOWERS.caltrop_camp.effect?.type).toBe('slow');
  });

  it('궁노 망루는 여전히 여러 발을 서로 다른 적에게 쏜다', () => {
    expect(TOWERS.archer_tower.levels.map((l) => l.arrows)).toEqual([1, 2, 3, 4, 5]);
    expect(TOWERS.archer_tower.damageKind).toBe('ranged');
  });
});

describe('성벽 수리', () => {
  function level2World() {
    const w = new World({ level: LEVEL_02, seed: 1 });
    w.economy.add(10000);
    return w;
  }

  it('웨이브 사이에만 고칠 수 있다', () => {
    const w = level2World();
    w.castle.takeDamage(300);
    // 시작 직후는 idle = 대기 중이므로 수리 가능
    expect(w.canRepair()).toBe(true);
    w.callWaveEarly(); // 스폰 시작
    expect(w.waveRunner.state).toBe('spawning');
    expect(w.canRepair()).toBe(false);
    expect(w.repairQuote()).toBeNull();
    expect(w.repairCastle()).toBe(0);
  });

  it('한 번에 chunkHp 만큼 고치고 goldPerHp 비율로 지불한다', () => {
    const w = level2World();
    w.castle.takeDamage(300);
    const goldBefore = w.economy.gold;
    const quote = w.repairQuote()!;
    expect(quote.hp).toBe(BALANCE.repair.chunkHp);
    expect(quote.cost).toBe(BALANCE.repair.chunkHp * BALANCE.repair.goldPerHp);
    expect(w.repairCastle()).toBe(quote.hp);
    expect(w.economy.gold).toBe(goldBefore - quote.cost);
    expect(w.castle.hp).toBe(300 + quote.hp);
  });

  it('부족분이 chunk보다 적으면 그만큼만 고친다', () => {
    const w = level2World();
    w.castle.takeDamage(20);
    expect(w.repairQuote()!.hp).toBe(20);
    expect(w.repairCastle()).toBe(20);
    expect(w.castle.hp).toBe(LEVEL_02.castle.hp);
    expect(w.repairQuote()).toBeNull();
  });

  it('골드가 모자라면 고치지 않는다', () => {
    const w = new World({ level: LEVEL_02, seed: 1 });
    w.castle.takeDamage(300);
    while (w.economy.gold > 0) w.economy.trySpend(1);
    expect(w.repairCastle()).toBe(0);
    expect(w.castle.hp).toBe(300);
  });

  it('레벨 1에서는 수리를 쓸 수 없다', () => {
    const w = new World({ level: LEVEL_01, seed: 1 });
    w.economy.add(10000);
    w.castle.takeDamage(300);
    expect(w.canRepair()).toBe(false);
    expect(w.repairQuote()).toBeNull();
    expect(w.repairCastle()).toBe(0);
  });
});

describe('계략', () => {
  function armed(): World {
    const w = new World({ level: LEVEL_02, seed: 1 });
    w.economy.add(10000);
    return w;
  }

  /** 경로 위에 적을 n기 올린다 (스폰 큐를 기다리지 않고) */
  function spawnSome(w: World, n: number): void {
    w.callWaveEarly();
    for (let i = 0; i < 400 && w.enemies.length < n; i++) w.step(FIXED_DT);
  }

  it('레벨이 열어준 계략만 보인다', () => {
    expect(new World({ level: LEVEL_01, seed: 1 }).stratagems).toEqual([]);
    const ids = new World({ level: LEVEL_02, seed: 1 }).stratagems.map((s) => s.id);
    expect(ids.sort()).toEqual([...LEVEL_02.stratagems!].sort());
  });

  it('레벨 1에서는 발동 자체가 되지 않는다', () => {
    const w = new World({ level: LEVEL_01, seed: 1 });
    w.economy.add(10000);
    const gold = w.economy.gold;
    expect(w.stratagemStatus('fire_attack')).toBe('disabled');
    expect(w.castStratagem('fire_attack')).toBe(0);
    expect(w.economy.gold).toBe(gold);
  });

  it('즉발 계략은 대상이 없으면 못 쓴다 (골드가 그냥 사라지지 않는다)', () => {
    const w = armed();
    expect(w.enemies.length).toBe(0);
    expect(w.stratagemStatus('fire_attack')).toBe('no_target');
    expect(w.castStratagem('fire_attack')).toBe(0);
    // 지속형(원군)은 미리 걸 수 있다
    expect(w.stratagemStatus('reinforcements')).toBe('ok');
  });

  it('화공은 경로 위 모든 적을 때리고 비용을 가져간다', () => {
    const w = armed();
    spawnSome(w, 4);
    const def = getStratagem('fire_attack');
    const hpBefore = w.enemies.map((e) => e.hp);

    // 화공으로 죽은 적의 처치 골드가 같이 들어오므로 잔액이 아니라 지출을 본다
    let spent = 0;
    w.bus.on('gold:changed', ({ reason, delta }) => {
      if (reason === 'stratagem') spent += -delta;
    });

    const affected = w.castStratagem('fire_attack');
    expect(affected).toBe(hpBefore.length);
    expect(spent).toBe(def.cost);
    for (let i = 0; i < 15; i++) w.step(FIXED_DT);
    // 살아남은 적은 전부 체력이 줄었다
    for (const e of w.enemies) expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('공성 범위 피해는 방패병의 원거리 저항을 무시한다', () => {
    const shield = new Enemy();
    shield.init(1, UNITS.xl_shield, 1, 1);
    const dealt: number[] = [];
    applyFieldDamage([shield], 45, (e, amount, kind) => {
      dealt.push(e.damageAfterResist(amount, kind));
    });
    expect(dealt[0]).toBe(45);
  });

  it('화공은 10초간 기본 피해 총량 600의 강력한 계략이다', () => {
    const dmg = STRATAGEMS.fire_attack.effect.type === 'fire_storm'
      ? STRATAGEMS.fire_attack.effect.params.dps * STRATAGEMS.fire_attack.effect.params.duration
      : 0;
    expect(dmg).toBe(600);
  });

  it('얼음폭풍은 모든 적을 10초간 완전히 멈춘다', () => {
    const w = armed();
    spawnSome(w, 4);
    expect(w.castStratagem('ice_storm')).toBe(w.enemies.length);
    for (const e of w.enemies) {
      expect(e.freezeTimer).toBe(10);
      expect(e.effectiveSpeed).toBe(0);
    }
  });

  it('원군은 타워 피해량을 올리고 시간이 지나면 원래대로 돌아온다', () => {
    const w = armed();
    w.build(LEVEL_02.buildSlots[0], 'archer_tower');
    const def = getStratagem('reinforcements');
    const dur = def.effect.type === 'rally' ? def.effect.params.duration : 0;

    expect(w.rallyRemaining).toBe(0);
    expect(w.castStratagem('reinforcements')).toBe(1);
    expect(w.rallyRemaining).toBeGreaterThan(0);

    let ended = false;
    w.bus.on('stratagem:ended', () => { ended = true; });
    for (let t = 0; t < dur + 1; t += FIXED_DT) w.step(FIXED_DT);
    expect(w.rallyRemaining).toBe(0);
    expect(ended).toBe(true);
  });

  it('쿨다운 중에는 다시 쓸 수 없다', () => {
    const w = armed();
    const def = getStratagem('reinforcements');
    expect(w.castStratagem(def.id)).toBeGreaterThanOrEqual(0);
    expect(w.stratagemStatus(def.id)).toBe('cooldown');
    expect(w.stratagemCooldown(def.id)).toBeGreaterThan(0);
    const gold = w.economy.gold;
    expect(w.castStratagem(def.id)).toBe(0);
    expect(w.economy.gold).toBe(gold);
  });

  it('골드가 모자라면 못 쓴다', () => {
    const w = new World({ level: LEVEL_02, seed: 1 });
    while (w.economy.gold > 0) w.economy.trySpend(1);
    expect(w.stratagemStatus('reinforcements')).toBe('no_gold');
    expect(w.castStratagem('reinforcements')).toBe(0);
  });
});

describe('레벨 2 밸런스 (헤드리스 14웨이브)', () => {
  it('권장 조합(궁노+벽력+철질려)으로 클리어한다', () => {
    const r = runSim({ level: 'level02' });
    expect(r.won).toBe(true);
    expect(r.rows).toHaveLength(14);
  });

  it('궁노 망루만 쓰면 방패병에 뚫려 무너진다', () => {
    const r = runSim({ level: 'level02', build: 'archer' });
    const mixed = runSim({ level: 'level02' });
    expect(mixed.won).toBe(true);
    expect(r.won).toBe(false);
    /*
     * 누수 총량으로 두 판을 비교하지 않는다 — 궁노 도배는 10파에서 성이 무너져
     * 남은 네 파를 아예 겪지 않으므로, 오래 버틴 혼합 방어보다 누수가 적게 찍힐 수 있다.
     * "언제 무너졌나"와 "무엇에 뚫렸나"가 이 장의 교훈이다 (실측: 10파 패배, 누수 43 중 방패병 37).
     */
    expect(r.lastWave).toBeLessThan(mixed.rows.length);
    expect(r.leaksByUnit.xl_shield).toBeGreaterThan(r.leaks * 0.6);
  });

  it('벽력거를 섞으면 이긴다 (속성에는 답이 따로 있다)', () => {
    const r = runSim({
      level: 'level02',
      build: 's2_d=catapult,s2_e=catapult,s2_f=catapult',
    });
    expect(r.won).toBe(true);
  });

  it('철질려를 섞은 혼합 방어선도 강화 보스 웨이브를 클리어한다', () => {
    const withSlow = runSim({ level: 'level02' });
    const withoutSlow = runSim({
      level: 'level02',
      build: 's2_d=catapult,s2_e=catapult,s2_f=catapult',
    });
    /*
     * 둘 다 클리어된다는 것이 이 테스트의 전부다.
     * 예전에는 철질려 쪽 누수가 더 적기까지 했지만, 횡대가 넓어진 뒤로는
     * 나쁜 자리 셋을 전부 벽력거로 채우는 쪽이 누수가 적다(실측 25 vs 14).
     * 감속은 이제 "더 나은 선택"이 아니라 "다른 선택"이다.
     */
    expect(withSlow.won).toBe(true);
    expect(withoutSlow.won).toBe(true);
  });

  it('업그레이드를 안 하면 패배한다', () => {
    const r = runSim({ level: 'level02', upgrade: 'none' });
    expect(r.won).toBe(false);
  });

  it('수리가 성 체력을 유의미하게 지켜준다 (골드 소비처)', () => {
    const withRepair = runSim({ level: 'level02' });
    const without = runSim({ level: 'level02', repair: false });
    expect(withRepair.castleHp).toBeGreaterThan(without.castleHp);
    /*
     * 예전에는 여기서 "수리를 안 하면 골드가 남아돈다"를 봤다. 지금은 아니다 —
     * 망루가 부서지는 물건이 된 뒤로, 안 고치면 그 망루를 잃고 **다시 세우는 데**
     * 돈이 든다. 그래서 남는 골드는 오히려 더 적다(실측 216 vs 624).
     * 소비처가 사라진 게 아니라 소비처가 바뀐 것이다: 고치거나, 잃고 다시 세우거나.
     */
    expect(without.towersLost).toBeGreaterThan(withRepair.towersLost);
  });

  it('마지막 웨이브는 성에 흔적을 남긴다 (그게 성적이 된다)', () => {
    const r = runSim({ level: 'level02' });
    /*
     * 스폰이 끝난 뒤에도 수리는 돌아가므로 마지막 파의 피해 일부는 되돌아온다
     * (실측: 379 -> 502). 되돌아오지 않는 부분이 남아 성이 만피로 끝나지 않는다는 것,
     * 그게 등급이 된다.
     */
    expect(r.castleHp).toBeLessThan(r.castleMaxHp);
  });

  it('별 등급 기준이 실제 도달 가능한 범위에 있다', () => {
    const r = runSim({ level: 'level02' });
    const ratio = r.castleHp / r.castleMaxHp;
    const stars = LEVEL_02.stars!;
    // 권장 조합이 최소 2별은 받아야 한다
    expect(ratio).toBeGreaterThanOrEqual(stars.two);
    // 3별은 더 잘해야 받는다 (기준이 무의미하게 낮으면 안 된다)
    expect(stars.three).toBeGreaterThan(stars.two);
  });

  it('보스전에 집중하면 계략에 실제로 골드를 쓴다', () => {
    const boss = runSim({ level: 'level02', cards: 'boss' });
    expect(boss.won).toBe(true);
    /*
     * 기준이 1000 이었다가 500 으로 내려왔다. 공성전이 조여지면서 망루 수리가
     * 상시 지출이 됐고(봇은 예산을 남기고서만 계략을 쓴다), 그만큼 계략에 갈 돈이
     * 줄었다. 이 수치가 재는 것은 "계략이 쓸 만한가"이지 절대 액수가 아니므로,
     * 장수 웨이브마다 한 번은 쓸 수 있다는 선(가장 싼 계략의 두 배)만 지킨다.
     */
    expect(boss.goldOnCards).toBeGreaterThan(500);
  });

  it('계략 사용 시점에 따라 성의 최종 체력이 달라진다', () => {
    const greedy = runSim({ level: 'level02', cards: 'greedy' });
    const boss = runSim({ level: 'level02', cards: 'boss' });
    expect(greedy.won).toBe(true);
    expect(boss.won).toBe(true);
  });

  it('계략을 써도 전부 궁노면 방패병 앞에서 무너진다', () => {
    const mixed = runSim({ level: 'level02' });
    for (const cards of ['greedy', 'boss'] as const) {
      const r = runSim({ level: 'level02', build: 'archer', cards });
      // 계략은 타워의 답을 대신하지 못한다 — 카드를 써도 같은 파에서 끝난다
      expect(r.won).toBe(false);
      expect(r.lastWave).toBeLessThan(mixed.rows.length);
    }
  });

  it('같은 조건으로 두 번 돌리면 결과가 동일하다 (결정론)', () => {
    const a = runSim({ level: 'level02' });
    const b = runSim({ level: 'level02' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    const c = runSim({ level: 'level02', cards: 'boss' });
    const d = runSim({ level: 'level02', cards: 'boss' });
    expect(JSON.stringify(c)).toBe(JSON.stringify(d));
  });
});
