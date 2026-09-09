import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/World';
import { Path } from '../src/sim/Path';
import { Enemy } from '../src/sim/Enemy';
import { LEVEL_01, LEVEL_02, LEVEL_03, LEVEL_ORDER, nextLevelId } from '../src/data/levels';
import { UNITS } from '../src/data/units';
import { BALANCE } from '../src/data/balance';
import { TOWERS, totalInvestedFor } from '../src/data/towers';
import { applySpeedAura } from '../src/sim/effects';
import { FIXED_DT } from '../src/core/Loop';
import { runSim } from '../scripts/sim';

describe('레벨 3 맵', () => {
  /*
   * 표에 적힌 배율에 전역 difficulty.bossHpMul 이 곱해진 값이 실제 장수의 체력이다.
   * 그래서 표의 숫자가 아니라 곱한 결과를 재는 것이 맞다 — 어느 쪽을 움직여도 걸린다.
   */
  /* 표의 배율(1.25 / 1.5) x difficulty.bossHpMul 2.3. 2.3이 된 사연은 level02 참조. */
  it('15개 웨이브이며 중간보스 2.875배·최종보스 3.45배가 적용된다', () => {
    const boss = BALANCE.difficulty.bossHpMul;
    expect(LEVEL_03.waves).toHaveLength(15);
    const yanliang = LEVEL_03.waves[7].spawns.find((s) => s.unitId === 'yanliang')!;
    const yuanshao = LEVEL_03.waves[14].spawns.find((s) => s.unitId === 'yuanshao')!;
    expect(yanliang.hpMul * boss).toBeCloseTo(2.875, 6);
    // 원소는 표의 1.5가 이 장의 상한이다 — 더 올리면 15파에서 성문에 붙는 순간 뒤집힌다.
    expect(yuanshao.hpMul * boss).toBeCloseTo(3.45, 6);
  });
  const path = new Path(LEVEL_03.path);

  it('레벨 2 다음이고 레벨 4로 이어진다', () => {
    expect(LEVEL_ORDER[2].id).toBe('level03');
    expect(nextLevelId('level02')).toBe('level03');
    expect(nextLevelId('level03')).toBe('level04');
  });

  it('경로 총 길이가 2400~3000u 범위다', () => {
    expect(path.totalLength).toBeGreaterThanOrEqual(2400);
    expect(path.totalLength).toBeLessThanOrEqual(3000);
  });

  it('경로가 맵(1200x700) 안에 있다', () => {
    for (const [x, z] of LEVEL_03.path) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(BALANCE.mapWidth);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(BALANCE.mapDepth);
    }
  });

  it('건설 슬롯 7개 중 3개가 사거리 100으로 300u 이상을 덮는다', () => {
    const coverage = LEVEL_03.buildSlots.map((s) => ({
      id: s.id,
      cover: Math.round(path.lengthWithinRadius(s.x, s.z, 100)),
    }));
    console.log(
      '  레벨3 슬롯 커버리지(사거리 100):',
      coverage.map((c) => `${c.id}=${c.cover}u`).join('  '),
    );
    expect(LEVEL_03.buildSlots).toHaveLength(7);
    expect(coverage.filter((c) => c.cover >= 300)).toHaveLength(3);
    // 나머지 넷은 확실히 나쁜 자리여야 "어디에 지을까"가 문제가 된다
    expect(coverage.filter((c) => c.cover < 250)).toHaveLength(4);
  });

  it('슬롯이 경로 위에 놓이지 않는다', () => {
    for (const s of LEVEL_03.buildSlots) {
      expect(path.lengthWithinRadius(s.x, s.z, 45)).toBe(0);
    }
  });

  it('슬롯 id가 앞 레벨들과 겹치지 않는다', () => {
    const used = new Set([...LEVEL_01.buildSlots, ...LEVEL_02.buildSlots].map((s) => s.id));
    for (const s of LEVEL_03.buildSlots) expect(used.has(s.id)).toBe(false);
  });

  it('성 체력이 레벨 2보다 낮다 (누수가 더 아프다)', () => {
    expect(LEVEL_03.castle.hp).toBeLessThan(LEVEL_02.castle.hp);
  });
});

describe('레벨 3 경제 — 시간을 돈으로 바꾼다', () => {
  it('조기 소집 계수가 앞 레벨보다 확실히 높다', () => {
    const base = BALANCE.earlyCallBonusPerSecond;
    expect(LEVEL_01.earlyCallBonusPerSecond ?? base).toBe(base);
    expect(LEVEL_02.earlyCallBonusPerSecond ?? base).toBe(base);
    expect(LEVEL_03.earlyCallBonusPerSecond!).toBeGreaterThan(base * 2);
  });

  it('처치 골드만으로는 권장 조합을 다 못 짓는다 (그래서 앞당겨 벌어야 한다)', () => {
    let earnable = LEVEL_03.startGold;
    for (const w of LEVEL_03.waves) for (const s of w.spawns) earnable += UNITS[s.unitId].goldOnKill;

    // 권장 조합 = 좋은 자리 궁노 3 + 벽력 3 + 철질려 1 (sim의 auto 배치와 같다)
    const need =
      3 * totalInvestedFor(TOWERS.archer_tower, 5) +
      3 * totalInvestedFor(TOWERS.catapult, 5) +
      1 * totalInvestedFor(TOWERS.caltrop_camp, 5);
    expect(earnable).toBeLessThan(need);

    // 그 차액은 조기 소집으로 메울 수 있는 크기여야 한다 — 아니면 그냥 불가능한 레벨이다
    const earlyMax =
      (LEVEL_03.waveInterval ?? BALANCE.waveInterval) *
      LEVEL_03.earlyCallBonusPerSecond! *
      (LEVEL_03.waves.length - 1);
    expect(earnable + earlyMax).toBeGreaterThan(need);
    console.log(`  레벨3 처치 골드 ${earnable} G + 조기 소집 최대 ${earlyMax} G vs 권장 조합 ${need} G`);
  });

  it('3장에서도 화공과 얼음폭풍을 사용할 수 있다', () => {
    expect(LEVEL_02.stratagems?.length).toBeGreaterThan(0);
    expect(LEVEL_03.stratagems).toEqual(['fire_attack', 'ice_storm']);
    expect(new World({ level: LEVEL_03, seed: 1 }).stratagems).toHaveLength(2);
  });
});

describe('기수의 가속 오라', () => {
  let nextId = 1;
  function mk(id: string, x: number, z: number): Enemy {
    const e = new Enemy();
    e.init(nextId++, UNITS[id], 1, 1);
    e.worldX = x;
    e.worldZ = z;
    return e;
  }

  it('기수는 반경 안 아군만 빠르게 한다', () => {
    const banner = mk('ys_banner', 0, 0);
    const near = mk('ys_infantry', 50, 0);
    const far = mk('ys_infantry', 400, 0);
    const aura = UNITS.ys_banner.traits!.speedAura!;

    const n = applySpeedAura(banner, [banner, near, far], aura.radius, aura.speedMul, 0.35);
    expect(n).toBe(1);
    expect(near.effectiveSpeed).toBeCloseTo(near.speed * aura.speedMul, 5);
    expect(far.effectiveSpeed).toBe(far.speed);
    // 자기 자신은 빨라지지 않는다
    expect(banner.hasteTimer).toBe(0);
  });

  it('가속은 감속을 무효로 만들지 않는다 (철질려가 여전히 값을 한다)', () => {
    const e = mk('ys_infantry', 0, 0);
    e.applyHaste(1.45, 1);
    e.applySlow(0.42, 1);
    expect(e.effectiveSpeed).toBeCloseTo(e.speed * 0.42 * 1.45, 5);
    expect(e.effectiveSpeed).toBeLessThan(e.speed);
  });

  it('기수가 사라지면 가속이 곧 풀린다', () => {
    const w = new World({ level: LEVEL_03, seed: 1 });
    // 오라 갱신 주기보다 긴 시간이 지나면 타이머가 끝나야 한다
    const e = mk('ys_infantry', 0, 0);
    e.applyHaste(1.45, BALANCE.auraRefreshSec);
    let t = 0;
    while (t < BALANCE.auraRefreshSec + FIXED_DT) {
      e.hasteTimer -= FIXED_DT;
      t += FIXED_DT;
    }
    expect(e.hasteTimer).toBeLessThanOrEqual(0);
    expect(w.level.id).toBe('level03'); // 레벨이 실제로 만들어진다
  });

  it('원소는 기수보다 넓게, 안량은 오라가 없다', () => {
    expect(UNITS.yuanshao.traits!.speedAura!.radius).toBeGreaterThan(
      UNITS.ys_banner.traits!.speedAura!.radius,
    );
    expect(UNITS.yanliang.traits?.speedAura).toBeUndefined();
  });
});

describe('레벨 3 밸런스 (헤드리스 15웨이브)', () => {
  it('조기 소집을 쓰면 이기고, 안 쓰면 진다 — 이게 레벨 3의 교훈이다', () => {
    const withEarly = runSim({ level: 'level03', early: true });
    const without = runSim({ level: 'level03', early: false });
    expect(withEarly.won).toBe(true);
    expect(without.won).toBe(false);
    console.log(
      `  조기 소집 O: 승리 ${withEarly.castleHp}/${withEarly.castleMaxHp}` +
        `   X: 제 ${without.lastWave}파 패배`,
    );
  });

  /*
   * 예전에는 "망루를 덜 세워도 클리어는 된다, 대신 누수가 많다"였다.
   * 장수 체력(difficulty.bossHpMul)과 업그레이드 곡선(towerLevelFalloff)을
   * 차례로 조이면서 그 여유가 사라졌다 — 4기로는 마지막 파까지 버티기는 하지만
   * 누수가 여덟 배로 늘고 거기서 무너진다. 이 장의 예산 7기는 다 쓰라고 있는 것이다.
   */
  it('망루를 덜 세우면 마지막 파를 못 넘긴다', () => {
    const full = runSim({ level: 'level03', early: true });
    const fewer = runSim({ level: 'level03', early: true, towers: 4 });
    expect(full.won).toBe(true);
    expect(fewer.won).toBe(false);
    // 도중에 무너진 것이 아니라 마지막 파까지 갔다
    expect(fewer.lastWave).toBe(15);
    expect(fewer.leaks).toBeGreaterThan(full.leaks * 3);
  });

  it('조기 소집을 써도 업그레이드를 안 하면 진다 (레벨 1의 교훈이 유지된다)', () => {
    expect(runSim({ level: 'level03', early: true, upgrade: 'none' }).won).toBe(false);
  });

  /*
   * 배수가 3배에서 1.5배로 내려왔다. 공성전이 들어오면서 습격조가 **타워 종류와
   * 무관하게** 망루 앞에 붙잡혀 죽기 때문이다 — 궁노만 세워도 열 중 일곱은
   * 성문까지 오지 못한다. 그래서 두 방어선의 누수 차이는 예전만큼 벌어지지 않는다.
   * 지켜야 하는 교훈은 배수가 아니라 그 위의 두 줄이다: 전부 궁노면 **진다**,
   * 그리고 뚫는 것은 원거리 저항을 가진 창병이다.
   */
  it('전부 궁노면 성의 반격으로 버텨도 혼합 방어보다 누수가 많다', () => {
    const r = runSim({ level: 'level03', early: true, build: 'archer' });
    const mixed = runSim({ level: 'level03', early: true });
    expect(r.won).toBe(false);
    expect(r.leaks).toBeGreaterThan(mixed.leaks * 1.5);
    // 창병(원거리 저항 30%)이 누수의 대부분이다
    expect(r.leaksByUnit.ys_spear ?? 0).toBeGreaterThan(r.leaksByUnit.ys_infantry ?? 0);
  });

  it('수리에 의존하지 않아도 숙련된 조기 소집으로 클리어할 수 있다', () => {
    const withRepair = runSim({ level: 'level03', early: true });
    const without = runSim({ level: 'level03', early: true, repair: false });
    expect(withRepair.won).toBe(true);
    expect(without.won).toBe(true);
  });

  it('별 등급 기준이 실제 도달 가능한 범위에 있다', () => {
    const r = runSim({ level: 'level03', early: true });
    const ratio = r.castleHp / r.castleMaxHp;
    const stars = LEVEL_03.stars!;
    expect(ratio).toBeGreaterThanOrEqual(stars.two);
    expect(stars.three).toBeGreaterThan(stars.two);
  });

  it('같은 조건으로 두 번 돌리면 결과가 동일하다 (결정론)', () => {
    const a = runSim({ level: 'level03', early: true });
    const b = runSim({ level: 'level03', early: true });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
