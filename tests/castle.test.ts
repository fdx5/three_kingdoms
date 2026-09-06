import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/World';
import { Castle } from '../src/sim/Castle';
import { CASTLE_LEVELS, MAX_CASTLE_LEVEL, castleUpgradeTotal, castleHpBonusTotal } from '../src/data/castle';
import { LEVEL_01, LEVEL_04 } from '../src/data/levels';
import { FIXED_DT } from '../src/core/Loop';

/**
 * 성문 강화 — 사양이 곧 이 테스트다.
 *   Lv1 활 2발 / Lv2 활 4발 / Lv3 대포 2발(+폭발+지면 화염) /
 *   Lv4 대포 2발 증강 / Lv5 대포 4발(지면 화염 더 큼) / Lv6 양방향 화염
 */
describe('성문 강화 표', () => {
  it('여섯 단계이고 레벨 1만 비용이 null이다', () => {
    expect(CASTLE_LEVELS).toHaveLength(6);
    expect(MAX_CASTLE_LEVEL).toBe(6);
    expect(CASTLE_LEVELS[0].upgradeCost).toBeNull();
    for (let i = 1; i < CASTLE_LEVELS.length; i++) {
      expect(CASTLE_LEVELS[i].upgradeCost).toBeGreaterThan(0);
      expect(CASTLE_LEVELS[i].level).toBe(i + 1);
    }
  });

  it('사양대로 무기와 발수가 바뀐다', () => {
    const w = CASTLE_LEVELS.map((l) => l.weapon);
    expect(w.map((x) => x.kind)).toEqual(['arrow', 'arrow', 'cannon', 'cannon', 'cannon', 'flame']);
    // 활 2발 -> 활 4발 -> 대포 2발 -> 대포 2발 -> 대포 4발 -> 양방향 화염 2줄기
    expect(w.map((x) => x.shots)).toEqual([2, 4, 2, 2, 4, 2]);
  });

  it('레벨 3부터 착탄이 터지고 지면에 불이 남는다', () => {
    const w = CASTLE_LEVELS.map((l) => l.weapon);
    // 화살 단계에는 폭발도 불도 없다
    expect(w[0].splashRadius).toBe(0);
    expect(w[0].ignite).toBeUndefined();
    expect(w[1].ignite).toBeUndefined();
    for (let i = 2; i < 6; i++) {
      expect(w[i].splashRadius).toBeGreaterThan(0);
      expect(w[i].ignite).toBeDefined();
    }
  });

  it('레벨 5의 지면 지속 피해가 레벨 3·4보다 확실히 크다', () => {
    const dps = (i: number) => CASTLE_LEVELS[i].weapon.ignite!.dps;
    expect(dps(4)).toBeGreaterThan(dps(3));
    expect(dps(3)).toBeGreaterThan(dps(2));
    // "더 크다"가 눈에 보여야 하므로 두 배 이상으로 잡았다
    expect(dps(4)).toBeGreaterThanOrEqual(dps(2) * 2);
  });

  it('레벨 6은 화염 피해이고 양쪽 포문에서 나가며 불이 가장 세다', () => {
    const w = CASTLE_LEVELS[5].weapon;
    expect(w.kind).toBe('flame');
    expect(w.dualMuzzle).toBe(true);
    expect(w.fireSource).toBe('flame');
    // 닿으면 큰 피해 — 한 발이 앞 단계 대포 한 발보다 확실히 세다
    expect(w.damagePerShot).toBeGreaterThan(CASTLE_LEVELS[4].weapon.damagePerShot * 1.5);
    expect(w.ignite!.dps).toBeGreaterThan(CASTLE_LEVELS[4].weapon.ignite!.dps);
    expect(w.range).toBe(Math.max(...CASTLE_LEVELS.map((l) => l.weapon.range)));
  });

  it('사거리와 발사 화력이 단계마다 물러서지 않는다', () => {
    for (let i = 1; i < CASTLE_LEVELS.length; i++) {
      expect(CASTLE_LEVELS[i].weapon.range).toBeGreaterThanOrEqual(CASTLE_LEVELS[i - 1].weapon.range);
      const dps = (n: number) =>
        (CASTLE_LEVELS[n].weapon.shots * CASTLE_LEVELS[n].weapon.damagePerShot) /
        CASTLE_LEVELS[n].weapon.fireInterval;
      expect(dps(i)).toBeGreaterThan(dps(i - 1));
    }
  });

  it('총 비용과 총 체력 보너스가 표와 맞는다', () => {
    const cost = CASTLE_LEVELS.slice(1).reduce((s, l) => s + (l.upgradeCost ?? 0), 0);
    const hp = CASTLE_LEVELS.slice(1).reduce((s, l) => s + l.hpBonus, 0);
    expect(castleUpgradeTotal(6)).toBe(cost);
    expect(castleHpBonusTotal(6)).toBe(hp);
    expect(castleUpgradeTotal(1)).toBe(0);
  });
});

describe('Castle 상태', () => {
  it('강화하면 최대 체력이 늘고 늘어난 만큼 즉시 채워진다', () => {
    const c = new Castle('t', 500);
    c.takeDamage(200); // 300 / 500
    const bonus = CASTLE_LEVELS[1].hpBonus;
    c.applyUpgrade();
    expect(c.level).toBe(2);
    expect(c.maxHp).toBe(500 + bonus);
    // 늘어난 만큼만 채운다 — 이미 난 구멍은 그대로다
    expect(c.hp).toBe(300 + bonus);
  });

  it('만렙에서는 더 올라가지 않는다', () => {
    const c = new Castle('t', 500);
    for (let i = 0; i < 10; i++) c.applyUpgrade();
    expect(c.level).toBe(MAX_CASTLE_LEVEL);
    expect(c.nextUpgradeCost).toBeNull();
    expect(c.nextLevelDef).toBeNull();
  });
});

describe('World — 성문 강화 규칙', () => {
  it('허용하지 않는 레벨에서는 아무리 골드가 많아도 못 올린다', () => {
    const w = new World({ level: LEVEL_01 });
    w.economy.add(99_999);
    expect(LEVEL_01.castleUpgrade).toBeFalsy();
    expect(w.castleUpgradeStatus()).toBe('disabled');
    expect(w.upgradeCastle()).toBe('no_tower');
    expect(w.castle.level).toBe(1);
    expect(w.castleUpgradeQuote()).toBeNull();
  });

  it('골드가 모자라면 no_gold, 충분하면 올라가고 그만큼 지불한다', () => {
    const w = new World({ level: LEVEL_04 });
    const cost = w.castle.nextUpgradeCost!;
    // 딱 1 G 모자라게 맞춘다
    w.economy.trySpend(w.economy.gold);
    w.economy.add(cost - 1);
    expect(w.castleUpgradeStatus()).toBe('no_gold');

    w.economy.add(1);
    const before = w.economy.gold;
    expect(w.upgradeCastle()).toBe('ok');
    expect(w.castle.level).toBe(2);
    expect(w.economy.gold).toBe(before - cost);
  });

  it('여섯 단계까지 올리면 max_level이 된다', () => {
    const w = new World({ level: LEVEL_04 });
    w.economy.add(99_999);
    for (let i = 1; i < MAX_CASTLE_LEVEL; i++) expect(w.upgradeCastle()).toBe('ok');
    expect(w.castle.level).toBe(MAX_CASTLE_LEVEL);
    expect(w.castleUpgradeStatus()).toBe('max_level');
    expect(w.upgradeCastle()).toBe('max_level');
  });

  it('강화 이벤트가 새 단계의 무기를 알려준다', () => {
    const w = new World({ level: LEVEL_04 });
    w.economy.add(99_999);
    const seen: { level: number; kind: string; shots: number }[] = [];
    w.bus.on('castle:upgraded', ({ level, weaponKind, shots }) =>
      seen.push({ level, kind: weaponKind, shots }),
    );
    for (let i = 1; i < MAX_CASTLE_LEVEL; i++) w.upgradeCastle();
    expect(seen.map((s) => s.kind)).toEqual(['arrow', 'cannon', 'cannon', 'cannon', 'flame']);
    expect(seen.map((s) => s.shots)).toEqual([4, 2, 2, 4, 2]);
  });

  it('타워 없이 성문만으로도 강화하면 성문 앞이 뚫리지 않는다', () => {
    /*
     * 무엇으로 재는가가 중요하다.
     *   발사 수  — 강한 성문은 적을 먼저 지워 쏠 대상이 사라진다. 오히려 줄어든다.
     *   처치 수  — 사거리 안에 들어온 적을 전부 잡으면 그 위로는 늘지 않는다(포화).
     *   누수 수  — 이것만이 "성문이 막았는가"를 그대로 나타낸다.
     * 실측(레벨 4, 타워 0기, 120초):
     *   Lv1 누수 35 / 성 547  · Lv2 누수 33 · Lv3~6 누수 0 / 성 만피
     */
    const run = (castleLevel: number) => {
      const w = new World({ level: LEVEL_04, seed: 7 });
      w.economy.add(99_999);
      for (let i = 1; i < castleLevel; i++) w.upgradeCastle();
      // 타워는 한 기도 짓지 않는다 — 성문만의 값을 재는 것이 목적이다
      for (let i = 0; i < 120 / FIXED_DT; i++) w.step(FIXED_DT);
      return { leaks: w.leaks, kills: w.kills, hpRatio: w.castle.hpRatio };
    };

    const lv1 = run(1);
    const lv6 = run(6);
    expect(lv1.leaks).toBeGreaterThan(10);
    expect(lv6.leaks).toBe(0);
    expect(lv6.kills).toBeGreaterThan(lv1.kills);
    expect(lv1.hpRatio).toBeLessThan(1);
    expect(lv6.hpRatio).toBe(1);
  });

  it('레벨 6의 두 줄기는 성문 좌우 서로 다른 자리에서 떠난다', () => {
    const w = new World({ level: LEVEL_04, seed: 7 });
    w.economy.add(99_999);
    for (let i = 1; i < MAX_CASTLE_LEVEL; i++) w.upgradeCastle();

    const origins: { x: number; z: number }[] = [];
    w.bus.on('projectile:fired', ({ towerSlotId, from }) => {
      if (towerSlotId === '__castle__') origins.push({ x: from.x, z: from.z });
    });
    for (let i = 0; i < 90 / FIXED_DT && origins.length < 2; i++) w.step(FIXED_DT);

    expect(origins.length).toBeGreaterThanOrEqual(2);
    const [a, b] = origins;
    // 양방향 — 두 발이 같은 지점에서 나가면 "양쪽에서 온다"가 성립하지 않는다
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(50);
  });
});
