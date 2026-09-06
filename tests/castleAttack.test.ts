import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/World';
import { LEVEL_01, LEVEL_02, LEVEL_ORDER } from '../src/data/levels';
import { BALANCE } from '../src/data/balance';
import { UNITS } from '../src/data/units';
import { FIXED_DT } from '../src/core/Loop';
import { buildMountClips, type MountStats } from '../scripts/rig-model';

/**
 * 성벽 타격 — 장수는 2초에 한 번, 잡몹은 16초에 한 번.
 * 모든 장에 같은 규칙이 적용된다 (레벨 데이터가 아니라 BALANCE 에 있다).
 */
describe('성벽 타격 주기', () => {
  it('장수는 2초, 잡몹은 16초 간격이다', () => {
    expect(BALANCE.castleCombat.bossAttackInterval).toBe(2);
    expect(BALANCE.castleCombat.enemyAttackInterval).toBe(16);
  });

  it('간격이 여덟 배 짧아진 만큼 한 대의 세기도 여덟 분의 일이다', () => {
    const cc = BALANCE.castleCombat;
    // 초당 피해가 예전과 같아야 앞 여섯 장의 밸런스가 유지된다
    const minionDps = cc.enemyStrikeDamageMul / cc.enemyAttackInterval;
    const bossDps = cc.bossStrikeDamageMul / cc.bossAttackInterval;
    expect(bossDps).toBeCloseTo(minionDps, 6);
  });

  it('주기는 레벨이 아니라 전역 상수다 — 모든 장에 같이 적용된다', () => {
    // 레벨 정의에 타격 주기를 덮어쓰는 필드가 없다는 것이 곧 "모든 장에 동일"이다
    for (const level of LEVEL_ORDER) {
      expect(Object.keys(level)).not.toContain('bossAttackInterval');
      expect(Object.keys(level)).not.toContain('enemyAttackInterval');
    }
  });

  /** 적 한 기를 성문 앞에 세워 두고 정해진 시간 동안 몇 번 때리는지 센다. */
  function strikesOf(unitId: string, seconds: number): { hits: number; damage: number } {
    const world = new World({ level: LEVEL_02, seed: 5 });
    // 웨이브를 기다리지 않고 직접 한 기만 세운다
    (world as unknown as { spawnEnemy: (s: unknown) => void }).spawnEnemy({
      unitId,
      at: 0,
      hpMul: 1000, // 맞아 죽지 않게 아주 두껍게 — 타격 횟수만 재는 것이 목적이다
      speedMul: 1,
    });
    const e = world.enemies[0];
    e.distance = world.path.totalLength;

    let hits = 0;
    let damage = 0;
    world.bus.on('enemy:castle-attack', ({ castleDamage }) => {
      hits++;
      damage += castleDamage;
    });
    for (let i = 0; i < seconds / FIXED_DT && world.over === 'none'; i++) world.step(FIXED_DT);
    return { hits, damage };
  }

  it('여포는 20초 동안 열 번 안팎으로 때린다 (2초에 한 번)', () => {
    const { hits } = strikesOf('lubu', 20.5);
    // 도착 직후 0.42초에 첫 타격, 그 뒤 2초마다
    expect(hits).toBeGreaterThanOrEqual(9);
    expect(hits).toBeLessThanOrEqual(11);
  });

  it('같은 20초 동안 보병은 두 번을 넘지 않는다', () => {
    const { hits } = strikesOf('xl_infantry', 20.5);
    expect(hits).toBeLessThanOrEqual(2);
  });

  it('장수 한 기가 20초 동안 주는 총 피해가 성을 무너뜨릴 정도는 아니다', () => {
    const { damage } = strikesOf('lubu', 20.5);
    // 2장 성 체력 600 기준 — 위협이되 도달만으로 끝나는 판정은 아니어야 한다
    expect(damage).toBeGreaterThan(0);
    expect(damage).toBeLessThan(LEVEL_02.castle.hp * 0.25);
  });

  it('중간보스(elite)도 장수와 같은 주기를 쓴다', () => {
    expect(UNITS.huaxiong.kind).toBe('elite');
    const { hits } = strikesOf('huaxiong', 10.5);
    expect(hits).toBeGreaterThanOrEqual(4);
  });

  it('1장 보병도 같은 규칙을 따른다 (장이 달라도 동일)', () => {
    const world = new World({ level: LEVEL_01, seed: 5 });
    (world as unknown as { spawnEnemy: (s: unknown) => void }).spawnEnemy({
      unitId: 'zhangjiao',
      at: 0,
      hpMul: 1000,
      speedMul: 1,
    });
    world.enemies[0].distance = world.path.totalLength;
    let hits = 0;
    world.bus.on('enemy:castle-attack', () => hits++);
    for (let i = 0; i < 10.5 / FIXED_DT && world.over === 'none'; i++) world.step(FIXED_DT);
    expect(hits).toBeGreaterThanOrEqual(4);
  });
});

/**
 * 여포의 방천화극 — 찌르기가 아니라 휘두르기여야 한다.
 * 리깅 결과를 직접 뜯어 "어깨·팔·몸통이 가로로 도는가"를 확인한다.
 */
describe('말 탄 장수의 휘두르기 리깅', () => {
  /** 리깅 파이프라인이 쓰는 것과 같은 모양의 가짜 측정값 */
  const stats: MountStats = {
    height: 1,
    minY: 0,
    body: [0, 0.4, 0],
    neck: [0, 0.6, 0.3],
    rider: [0, 0.7, 0],
    shoulderL: [-0.08, 0.76, 0],
    shoulderR: [0.08, 0.76, 0],
    riderArm: [0.12, 0.74, 0.1],
    feet: {
      frontL: { x: -0.1, z: 0.2, bottomY: 0 },
      frontR: { x: 0.1, z: 0.2, bottomY: 0 },
      backL: { x: -0.1, z: -0.2, bottomY: 0 },
      backR: { x: 0.1, z: -0.2, bottomY: 0 },
    },
  } as MountStats;

  const swingAxis: [number, number, number] = [1, 0, 0];
  const forward: [number, number, number] = [0, 0, 1];

  const clipsFor = (style: 'thrust' | 'swing') =>
    buildMountClips(stats, swingAxis, forward, 0.8, style);

  const attackOf = (style: 'thrust' | 'swing') => {
    const clip = clipsFor(style).find((c) => c.name === 'attack');
    if (!clip) throw new Error('attack 클립이 없다');
    return clip;
  };

  /** 쿼터니언 트랙에서 Y(요) 성분의 최대 크기 — 가로로 도는 정도 */
  const maxYaw = (values: number[]): number => {
    let m = 0;
    for (let i = 1; i < values.length; i += 4) m = Math.max(m, Math.abs(values[i]));
    return m;
  };

  it('휘두르기는 팔·어깨·몸통이 모두 가로로 돈다 (찌르기는 그렇지 않다)', () => {
    const swing = attackOf('swing');
    const thrust = attackOf('thrust');

    for (const bone of ['riderArm', 'shoulderL', 'shoulderR', 'rider']) {
      const s = swing.tracks.find((t) => t.bone === bone);
      const t = thrust.tracks.find((tr) => tr.bone === bone);
      expect(s, bone).toBeDefined();
      expect(t, bone).toBeDefined();
      // 찌르기는 한 축(앞뒤)만 돈다 — 그래서 머리로 들이받는 것처럼 보였다
      expect(maxYaw(t!.values), `thrust ${bone}`).toBeLessThan(1e-6);
      // 휘두르기는 가로 성분이 실제로 있다
      expect(maxYaw(s!.values), `swing ${bone}`).toBeGreaterThan(0.05);
    }
  });

  it('휘두르기는 팔을 찌르기보다 훨씬 크게 돌린다', () => {
    const armAngle = (style: 'thrust' | 'swing'): number => {
      const track = attackOf(style).tracks.find((t) => t.bone === 'riderArm')!;
      let m = 0;
      // w 성분이 작을수록 큰 회전이다 (w = cos(각/2))
      for (let i = 3; i < track.values.length; i += 4) m = Math.max(m, 1 - Math.abs(track.values[i]));
      return m;
    };
    expect(armAngle('swing')).toBeGreaterThan(armAngle('thrust') * 2);
  });

  it('휘두를 때 말 목은 건드리지 않는다 (그게 들이받는 것처럼 보인 원인이다)', () => {
    expect(attackOf('swing').tracks.some((t) => t.bone === 'neck')).toBe(false);
    expect(attackOf('thrust').tracks.some((t) => t.bone === 'neck')).toBe(true);
  });

  it('휘두르기는 몸통이 앞으로 나가는 양이 찌르기보다 작다', () => {
    const lunge = (style: 'thrust' | 'swing'): number => {
      const track = attackOf(style).tracks.find((t) => t.bone === 'body' && t.path === 'translation')!;
      let m = 0;
      for (let i = 2; i < track.values.length; i += 3) m = Math.max(m, Math.abs(track.values[i]));
      return m;
    };
    expect(lunge('swing')).toBeLessThan(lunge('thrust'));
  });

  it('걷기와 제자리 클립은 두 방식이 같다 (공격만 갈린다)', () => {
    for (const name of ['walk', 'idle']) {
      const a = clipsFor('thrust').find((c) => c.name === name)!;
      const b = clipsFor('swing').find((c) => c.name === name)!;
      expect(b.tracks.length).toBe(a.tracks.length);
    }
  });
});
