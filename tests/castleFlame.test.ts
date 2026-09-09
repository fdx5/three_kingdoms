import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/World';
import { LEVEL_01 } from '../src/data/levels/level01';
import { FIXED_DT } from '../src/core/Loop';
import { SHU_UNITS } from '../src/data/unitsShu';
import { BALANCE } from '../src/data/balance';

/**
 * 제갈량의 화염 — 성문을 때리는 대신 태운다.
 *
 * 한 방이 그 자리에서 들어가지 않고 불로 옮겨 붙어 시간에 걸쳐 깎는다.
 * 여기가 무너지면 최종보스가 "가끔 한 대 치는 적"으로 돌아간다.
 */
function burningWorld(): World {
  return new World({
    level: {
      ...LEVEL_01,
      waves: [{
        index: 1,
        spawns: [{ unitId: 'zhugeliang', at: 0, hpMul: 1, speedMul: 1 }],
        banner: '성벽 화염 시험',
      }],
    },
    seed: 1,
  });
}

describe('성벽 화염', () => {
  it('제갈량은 특성으로 이 동작을 켠다 — 다른 적은 그대로 즉발이다', () => {
    expect(SHU_UNITS.zhugeliang.traits?.castleFlame).toBeDefined();
    for (const u of Object.values(SHU_UNITS)) {
      if (u.id !== 'zhugeliang') expect(u.traits?.castleFlame).toBeUndefined();
    }
  });

  it('때리는 순간에는 성이 깎이지 않는다 — 그 한 방이 통째로 불이 된다', () => {
    const w = burningWorld();
    const strikes: number[] = [];
    let ignitions = 0;
    w.bus.on('enemy:castle-attack', ({ castleDamage }) => strikes.push(castleDamage));
    w.bus.on('castle:ignited', () => ignitions++);

    w.callWaveEarly();
    for (let i = 0; i < 60 * 200 && w.over === 'none' && ignitions < 2; i++) w.step(FIXED_DT);

    expect(ignitions).toBeGreaterThanOrEqual(1);
    expect(strikes.length).toBeGreaterThanOrEqual(1);
    // 부채질은 보이되(이벤트는 난다) 그 자리에서 깎이지는 않는다
    expect(strikes.every((d) => d === 0)).toBe(true);
  });

  it('불이 붙어 있는 동안 계속 깎인다 — 때리지 않는 프레임에도', () => {
    const w = burningWorld();
    let burning = false;
    let ticksWhileBurning = 0;
    let struckThisFrame = false;
    w.bus.on('castle:ignited', () => { burning = true; });
    w.bus.on('castle:burn-ended', () => { burning = false; });
    w.bus.on('enemy:castle-attack', () => { struckThisFrame = true; });
    w.bus.on('castle:damaged', ({ amount }) => {
      // 타는 중이고 이 프레임에 때린 것도 아닌데 깎였다 = 불이 한 일이다
      if (burning && !struckThisFrame && amount > 0) ticksWhileBurning++;
    });

    w.callWaveEarly();
    for (let i = 0; i < 60 * 200 && w.over === 'none'; i++) {
      struckThisFrame = false;
      w.step(FIXED_DT);
    }
    expect(ticksWhileBurning).toBeGreaterThan(3);
  });

  it('연달아 맞으면 남은 불에 더해진다 — 덮어쓰면 촘촘히 맞을수록 덜 아파진다', () => {
    const w = burningWorld();
    const dps: number[] = [];
    w.bus.on('castle:ignited', (e) => dps.push(e.dps));

    w.callWaveEarly();
    for (let i = 0; i < 60 * 200 && w.over === 'none' && dps.length < 2; i++) w.step(FIXED_DT);

    expect(dps.length).toBeGreaterThanOrEqual(2);
    /*
     * 장수는 2초마다 때리고 불은 1.6초를 간다. 두 번째 화염이 올 때는 이미 다
     * 탄 뒤라 남은 것이 없어야 정상이다 — 그래서 두 값이 같다. 이 검사는
     * "두 번째가 첫 번째보다 **약해지지 않는다**"를 지킨다. 덮어쓰기로 되돌리면
     * 간격이 좁아졌을 때 여기가 먼저 깨진다.
     */
    expect(dps[1]).toBeGreaterThanOrEqual(dps[0] - 1e-6);
    // 한 방(=castleDamage × 장수 배율)에 damageMul 을 곱한 것이 duration 에 걸쳐 들어간다.
    // 값은 유닛 정의에서 읽는다 — 밸런스를 손볼 때마다 테스트가 깨지면 안 된다.
    const boss = SHU_UNITS.zhugeliang;
    const flame = boss.traits!.castleFlame!;
    // castleDamage 는 Enemy.init 에서 difficulty.unitDamageMul 이 곱해진 뒤 쓰인다 —
    // "유닛의 공격력"은 성문이든 망루든 한 값이고, 그 값이 여기 불의 총량이 된다.
    const attack = boss.castleDamage * BALANCE.difficulty.unitDamageMul;
    const strike = Math.max(1, Math.round(attack * BALANCE.castleCombat.bossStrikeDamageMul));
    expect(dps[0]).toBeCloseTo((strike * flame.damageMul) / flame.duration, 5);
  });

  it('불은 스스로 꺼진다 — 켜 두고 잊으면 성이 조용히 사라진다', () => {
    const w = burningWorld();
    let ended = 0;
    w.bus.on('castle:burn-ended', () => ended++);
    w.callWaveEarly();
    for (let i = 0; i < 60 * 200 && w.over === 'none'; i++) w.step(FIXED_DT);
    expect(ended).toBeGreaterThanOrEqual(1);
  });
});
