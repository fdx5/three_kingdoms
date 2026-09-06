import { describe, it, expect } from 'vitest';
import { Path } from '../src/sim/Path';
import {
  LEVEL_01,
  LEVEL_02,
  LEVEL_03,
  LEVEL_04,
  LEVEL_05,
  LEVEL_06,
  LEVEL_ORDER,
  nextLevelId,
  isTowerAvailable,
} from '../src/data/levels';
import { BALANCE } from '../src/data/balance';
import { TOWERS } from '../src/data/towers';
import { UNITS } from '../src/data/units';
import { MAX_CASTLE_LEVEL } from '../src/data/castle';
import { runSim } from '../scripts/sim';
import type { LevelDef } from '../src/types/level';

const NEW_LEVELS: LevelDef[] = [LEVEL_04, LEVEL_05, LEVEL_06];

describe('레지스트리 — 여섯 장이 순서대로 이어진다', () => {
  it('진행 순서가 1 -> 6 이다', () => {
    expect(LEVEL_ORDER.map((l) => l.id)).toEqual([
      'level01',
      'level02',
      'level03',
      'level04',
      'level05',
      'level06',
    ]);
    expect(nextLevelId('level03')).toBe('level04');
    expect(nextLevelId('level04')).toBe('level05');
    expect(nextLevelId('level05')).toBe('level06');
    expect(nextLevelId('level06')).toBeNull();
  });

  it('새 타워는 해당 장부터 열리고 그 전에는 못 짓는다', () => {
    expect(TOWERS.fire_tower.unlockedIn).toBe('level04');
    expect(TOWERS.cannon_tower.unlockedIn).toBe('level05');
    expect(isTowerAvailable('level04', 'level03')).toBe(false);
    expect(isTowerAvailable('level04', 'level04')).toBe(true);
    expect(isTowerAvailable('level04', 'level06')).toBe(true);
    expect(isTowerAvailable('level05', 'level04')).toBe(false);
    expect(isTowerAvailable('level05', 'level05')).toBe(true);
  });

  it('성문 강화는 4장부터만 열린다 — 앞 세 장의 교훈을 흐리지 않으려고', () => {
    expect(LEVEL_01.castleUpgrade).toBeFalsy();
    expect(LEVEL_02.castleUpgrade).toBeFalsy();
    expect(LEVEL_03.castleUpgrade).toBeFalsy();
    for (const l of NEW_LEVELS) expect(l.castleUpgrade).toBe(true);
  });

  it('슬롯 id가 여섯 장에 걸쳐 유일하다', () => {
    const ids = LEVEL_ORDER.flatMap((l) => l.buildSlots.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('새 장은 저마다 다른 성 id를 쓴다 (성문 모델을 장별로 갈아 끼울 수 있게)', () => {
    // 1·2장은 둘 다 호뢰관이라 같은 id를 쓴다 — 그건 원래 그런 것이고,
    // 새로 붙는 장은 서로도, 앞 장과도 겹치지 않아야 한다.
    const ids = LEVEL_ORDER.map((l) => l.castle.id);
    const fresh = NEW_LEVELS.map((l) => l.castle.id);
    expect(new Set(fresh).size).toBe(fresh.length);
    for (const id of fresh) expect(ids.filter((x) => x === id)).toHaveLength(1);
  });
});

describe.each(NEW_LEVELS.map((l) => [l.title, l] as const))('%s — 맵', (_title, level) => {
  const path = new Path(level.path);

  it('경로가 맵(1200x700) 안에 있다', () => {
    for (const [x, z] of level.path) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(BALANCE.mapWidth);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(BALANCE.mapDepth);
    }
  });

  it('경로 총 길이가 2400~3100u 범위다', () => {
    expect(path.totalLength).toBeGreaterThanOrEqual(2400);
    expect(path.totalLength).toBeLessThanOrEqual(3100);
  });

  it('슬롯이 경로 위에 놓이지 않는다', () => {
    for (const s of level.buildSlots) {
      expect(path.lengthWithinRadius(s.x, s.z, 45)).toBe(0);
    }
  });

  it('15개 웨이브이고 중간보스·최종보스가 한 기씩 들어 있다', () => {
    expect(level.waves).toHaveLength(15);
    const bossWaves = level.waves.filter((w) => w.isBossWave);
    expect(bossWaves).toHaveLength(2);
    // 최종 보스는 마지막 웨이브에
    expect(level.waves[14].isBossWave).toBe(true);
  });

  it('웨이브에 등장하는 유닛이 전부 UNITS에 있다', () => {
    for (const wave of level.waves) {
      for (const s of wave.spawns) expect(UNITS[s.unitId], s.unitId).toBeDefined();
    }
  });
});

describe('레벨 4 — 성문이 답이 되도록 슬롯이 모자라다', () => {
  const path = new Path(LEVEL_04.path);

  it('슬롯 5개이고 그중 어느 자리도 사거리 100으로 300u를 넘지 못한다', () => {
    const cover = LEVEL_04.buildSlots.map((s) => ({
      id: s.id,
      cover: Math.round(path.lengthWithinRadius(s.x, s.z, 100)),
    }));
    console.log('  레벨4 슬롯 커버리지(사거리 100):', cover.map((c) => `${c.id}=${c.cover}u`).join('  '));
    expect(LEVEL_04.buildSlots).toHaveLength(5);
    // 레벨 3의 최고 자리(409u)와 비교하면 전부 "나쁜 자리"다. 그게 이 장의 설계다.
    expect(cover.every((c) => c.cover < 300)).toBe(true);
    expect(cover.filter((c) => c.cover >= 250)).toHaveLength(3);
  });

  it('등갑병은 화살을 튕기지만 불에는 배로 탄다 (화공 망루의 존재 이유)', () => {
    const t = UNITS.wu_rattan.traits!;
    expect(t.rangedResist).toBeGreaterThanOrEqual(0.6);
    expect(t.fireVuln).toBeGreaterThan(1.5);
  });

  it('야습대는 감속 면역이라 철질려로 묶을 수 없다', () => {
    expect(UNITS.wu_raider.traits?.slowImmune).toBe(true);
  });

  it('손권은 전군을 회복시킨다 — 먼저 끊지 않으면 앞줄이 안 죽는다', () => {
    expect(UNITS.sunquan.traits?.healAura?.hps).toBeGreaterThan(0);
    expect(UNITS.sunquan.kind).toBe('boss');
  });
});

describe('레벨 5 — 불이 막히면 포탄으로 뚫는다', () => {
  const path = new Path(LEVEL_05.path);

  it('사거리 100으로는 경로에 닿지도 못하는 자리가 있다 (화포의 자리)', () => {
    const rows = LEVEL_05.buildSlots.map((s) => ({
      id: s.id,
      short: Math.round(path.lengthWithinRadius(s.x, s.z, 100)),
      long: Math.round(path.lengthWithinRadius(s.x, s.z, 175)),
    }));
    console.log('  레벨5 슬롯:', rows.map((r) => `${r.id}=${r.short}/${r.long}u`).join('  '));
    const dead = rows.filter((r) => r.short === 0);
    expect(dead.length).toBeGreaterThanOrEqual(1);
    // 궁노(100)로는 0u인데 화포(175)로는 크게 덮는다 — "사거리가 곧 성능"인 자리다
    for (const r of dead) expect(r.long).toBeGreaterThan(300);
  });

  it('화포는 궁노·벽력거보다 사거리가 길다', () => {
    const range = (id: string) => TOWERS[id].levels[0].range;
    expect(range('cannon_tower')).toBeGreaterThan(range('catapult'));
    expect(range('catapult')).toBeGreaterThan(range('archer_tower'));
  });

  it('형주군은 젖어 있다 — 화염이 대부분 꺼진다', () => {
    expect(UNITS.jz_marine.traits?.fireResist).toBeGreaterThanOrEqual(0.7);
    expect(UNITS.guanyu.traits?.fireResist).toBeGreaterThanOrEqual(0.7);
    // 그래서 공성 피해(화포)가 답이다 — 공성은 어떤 저항도 받지 않는다
    expect(TOWERS.cannon_tower.damageKind).toBe('siege');
  });
});

describe('레벨 6 — 앞의 다섯을 한꺼번에 묻는다', () => {
  it('슬롯 8개, 좋은 자리 4 : 나쁜 자리 4', () => {
    const path = new Path(LEVEL_06.path);
    const cover = LEVEL_06.buildSlots.map((s) => Math.round(path.lengthWithinRadius(s.x, s.z, 100)));
    console.log('  레벨6 슬롯 커버리지:', cover.join(' / '));
    expect(LEVEL_06.buildSlots).toHaveLength(8);
    expect(cover.filter((c) => c >= 250)).toHaveLength(4);
    expect(cover.filter((c) => c < 200)).toHaveLength(4);
  });

  it('제갈량은 저항 두 겹과 오라 두 개를 동시에 두른다', () => {
    const t = UNITS.zhugeliang.traits!;
    expect(t.rangedResist).toBeGreaterThan(0.4);
    expect(t.fireResist).toBeGreaterThan(0.4);
    expect(t.healAura).toBeDefined();
    expect(t.speedAura).toBeDefined();
    // 감속은 통한다 — 철질려로 묶어 화포 사거리에 두는 것이 정답이라
    expect(t.slowImmune).toBeFalsy();
    expect(UNITS.zhugeliang.hp).toBeGreaterThan(UNITS.lubu.hp);
  });

  it('마지막 장이라 다섯 종류의 타워를 전부 지을 수 있다', () => {
    const usable = Object.values(TOWERS).filter((t) => isTowerAvailable(t.unlockedIn, 'level06'));
    expect(usable).toHaveLength(5);
  });
});

/**
 * 헤드리스 밸런스 — "이 장이 가르치는 것"이 실제로 성립하는지 실측한다.
 *   4장  성문을 안 올리면 진다 (슬롯만으로는 성 앞을 못 막는다)
 *   5장  성문 없이도 이길 수는 있지만 성이 3분의 1로 깎인다 — 여기 필수는 화포다
 *   6장  성문을 안 올리면 진다 (앞의 다섯을 다 써야 넘어간다)
 * 세 장 공통: 전부 궁노로 도배하면 진다.
 */
describe('레벨 4~6 밸런스 (헤드리스 15웨이브)', () => {
  it('레벨 4~6은 전달받은 YouTube 배경음을 사용한다', () => {
    expect(LEVEL_ORDER.slice(3).map((level) => level.environment.bgmYoutubeId)).toEqual([
      'nzo4fB3uKi0',
      'deyim16dRzE',
      '6Keux8E6GVw',
    ]);
  });
  const run = (level: number, gate: 'after' | 'none', build = 'auto') =>
    runSim({
      level: `level0${level}`,
      towers: 99,
      slots: null,
      build,
      upgrade: 'greedy',
      repair: true,
      early: false,
      focusHealer: false,
      cards: 'none',
      gate,
      seed: 1,
    });

  it.each([4, 5, 6])('레벨 %i — 권장 조합 + 성문 강화로 클리어한다', (n) => {
    const r = run(n, 'after');
    console.log(
      `  레벨${n} 권장: ${r.won ? '승리' : `제 ${r.lastWave}파 패배`} ` +
        `성 ${r.castleHp}/${r.castleMaxHp} 누수 ${r.leaks} 성문 Lv${r.castleLevel}`,
    );
    expect(r.won).toBe(true);
    expect(r.castleLevel).toBeGreaterThan(1);
  }, 30_000);

  /**
   * 4장과 6장은 성문이 **필수**다 — 슬롯만으로는 성 앞을 못 막게 설계했다.
   * 5장은 다르다. 거기서 필수인 것은 화포이고 성문은 "있으면 훨씬 편한" 쪽이라,
   * 같은 잣대를 들이대면 그 장의 교훈을 잘못 적는 셈이 된다.
   */
  it.each([4, 6])('레벨 %i — 성문을 안 올리면 같은 타워로도 진다', (n) => {
    const withGate = run(n, 'after');
    const without = run(n, 'none');
    console.log(
      `  레벨${n} 성문 O: ${withGate.won ? '승리' : `제 ${withGate.lastWave}파 패배`}  ` +
        `X: ${without.won ? '승리' : `제 ${without.lastWave}파 패배`}`,
    );
    // 같은 배치·같은 업그레이드 정책이다. 달라지는 것은 성문뿐이다.
    expect(without.towerKinds).toEqual(withGate.towerKinds);
    expect(withGate.won).toBe(true);
    expect(without.won).toBe(false);
  }, 60_000);

  it('레벨 5 — 성문 없이도 이길 수는 있지만 성이 훨씬 더 깎인다', () => {
    const withGate = run(5, 'after');
    const without = run(5, 'none');
    console.log(
      `  레벨5 성문 O: 성 ${withGate.castleHp}/${withGate.castleMaxHp} 누수 ${withGate.leaks}  ` +
        `X: 성 ${without.castleHp}/${without.castleMaxHp} 누수 ${without.leaks}`,
    );
    expect(without.towerKinds).toEqual(withGate.towerKinds);
    // 성문이 없으면 마지막 직선이 얇아져 그만큼 성으로 옮겨 붙는다
    expect(without.castleHp).toBeLessThan(withGate.castleHp * 0.75);
  }, 60_000);

  it.each([4, 5, 6])('레벨 %i — 전부 궁노로는 진다 (속성에 답이 따로 있다)', (n) => {
    const r = run(n, 'after', 'archer');
    console.log(`  레벨${n} 궁노 도배: ${r.won ? '승리' : `제 ${r.lastWave}파 패배`} 누수 ${r.leaks}`);
    expect(r.won).toBe(false);
  }, 45_000);

  it('같은 조건으로 두 번 돌리면 결과가 동일하다 (결정론)', () => {
    const a = run(6, 'after');
    const b = run(6, 'after');
    expect(b.castleHp).toBe(a.castleHp);
    expect(b.leaks).toBe(a.leaks);
    expect(b.kills).toBe(a.kills);
    expect(b.castleLevel).toBe(a.castleLevel);
  }, 30_000);

  it('성문은 여섯 단계를 넘지 않는다', () => {
    for (const n of [4, 5, 6]) {
      expect(run(n, 'after').castleLevel).toBeLessThanOrEqual(MAX_CASTLE_LEVEL);
    }
  }, 45_000);
});
