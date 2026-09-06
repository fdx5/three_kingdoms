import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/World';
import { Enemy } from '../src/sim/Enemy';
import { LEVEL_01, LEVEL_02, LEVEL_ORDER } from '../src/data/levels';
import { UNITS } from '../src/data/units';

const DT = 1 / 60;
function battlefield() {
  const world = new World({ level: { ...LEVEL_02, firstWaveDelay: 9999 }, seed: 1 });
  world.economy.add(10000);
  return world;
}
function enemy(world: World, id = 1) {
  const e = new Enemy(); e.init(id, UNITS.yt_infantry, 100, 1);
  e.traits = undefined; e.speed = 2; e.distance = 30; e.worldX = 30; e.worldZ = 0;
  world.enemies.push(e); return e;
}
function advance(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds / DT); i++) world.step(DT);
}

describe('battlefield storms', () => {
  it('unlocks both storms in every chapter from 2, and removes ambush', () => {
    expect(new World({ level: LEVEL_01, seed: 1 }).stratagems).toHaveLength(0);
    for (const level of LEVEL_ORDER.slice(1)) {
      const w = new World({ level, seed: 1 });
      expect(w.stratagems.map(s => s.id)).toEqual(expect.arrayContaining(['fire_attack', 'ice_storm']));
      expect(w.stratagemStatus('ambush')).toBe('disabled');
    }
  });
  it('deals exactly 600 fire damage over 10 seconds, then stops', () => {
    const w = battlefield(), e = enemy(w), hp = e.hp;
    expect(w.castStratagem('fire_attack')).toBe(1);
    expect(e.hp).toBe(hp);
    advance(w, 5); expect(hp - e.hp).toBeCloseTo(300);
    advance(w, 5); expect(hp - e.hp).toBeCloseTo(600);
    expect(w.fireStormRemaining).toBe(0);
    advance(w, 1); expect(hp - e.hp).toBeCloseTo(600);
  });
  it('uses fire resistance and affects reinforcements only for the remaining storm', () => {
    const w = battlefield(), a = enemy(w);
    a.traits = { fireResist: 0.5 };
    const hp = a.hp;
    w.castStratagem('fire_attack'); advance(w, 5);
    const b = enemy(w, 2), laterHp = b.hp;
    advance(w, 5);
    expect(hp - a.hp).toBeCloseTo(300);
    expect(laterHp - b.hp).toBeCloseTo(300);
  });
  it('freezes movement and castle attacks, ignores slow immunity, then releases', () => {
    const w = battlefield(), e = enemy(w);
    e.traits = { slowImmune: true };
    const start = e.distance;
    w.castStratagem('ice_storm');
    advance(w, 5); expect(e.distance).toBe(start);
    e.atCastle = true; e.castleAttackCooldown = 0;
    const castleHp = w.castle.hp;
    advance(w, 5); expect(w.castle.hp).toBe(castleHp);
    expect(e.freezeTimer).toBeLessThan(1e-8);
    e.atCastle = false; advance(w, 0.1);
    expect(e.distance).toBeGreaterThan(start);
  });
  it('allows simultaneous fire and ice, rejects recast without charging again', () => {
    const w = battlefield(), e = enemy(w), hp = e.hp;
    w.castStratagem('fire_attack'); w.castStratagem('ice_storm');
    const gold = w.economy.gold;
    expect(w.castStratagem('fire_attack')).toBe(0);
    expect(w.economy.gold).toBe(gold);
    advance(w, 1); expect(e.effectiveSpeed).toBe(0); expect(e.hp).toBeLessThan(hp);
  });
  it('freezes later spawns for the remaining duration and suspends healing auras', () => {
    const w = battlefield(), source = enemy(w), target = enemy(w, 2);
    source.traits = { healAura: { radius: 5000, hps: 100 } };
    target.hp -= 500;
    const hp = target.hp;
    w.castStratagem('ice_storm'); advance(w, 5);
    expect(target.hp).toBe(hp);
    const newcomer = enemy(w, 3), distance = newcomer.distance;
    advance(w, 5);
    expect(newcomer.distance).toBe(distance);
    expect(newcomer.freezeTimer).toBeLessThan(1e-8);
    advance(w, 0.1);
    expect(newcomer.distance).toBeGreaterThan(distance);
    expect(target.hp).toBeGreaterThan(hp);
  });
  it('clears freeze on pool reset and initialization', () => {
    const w = battlefield(), e = enemy(w);
    e.freezeTimer = 10; e.reset(); expect(e.freezeTimer).toBe(0);
    e.freezeTimer = 10; e.init(2, UNITS.yt_infantry, 1, 1); expect(e.freezeTimer).toBe(0);
  });
});
