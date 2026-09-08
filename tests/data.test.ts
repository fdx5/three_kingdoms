import { describe, it, expect } from 'vitest';
import { UNIT_LIST, UNITS } from '../src/data/units';
import { TOWER_LIST, TOWERS, towerDps, totalInvestedFor } from '../src/data/towers';
import { LEVEL_01 } from '../src/data/levels/level01';
import { generateWaves } from '../src/data/waves';
import { BALANCE } from '../src/data/balance';
import { Path } from '../src/sim/Path';

describe('데이터 무결성', () => {
  it('모든 UnitDef id가 유일하고 키와 일치한다', () => {
    const ids = UNIT_LIST.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [key, def] of Object.entries(UNITS)) expect(def.id).toBe(key);
  });

  it('모든 TowerDef id가 유일하고 키와 일치한다', () => {
    const ids = TOWER_LIST.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [key, def] of Object.entries(TOWERS)) expect(def.id).toBe(key);
  });

  it('궁노 망루는 레벨 5까지 있고 레벨 1의 업그레이드 비용은 null이다', () => {
    const t = TOWERS.archer_tower;
    expect(t.levels).toHaveLength(5);
    expect(t.levels[0].upgradeCost).toBeNull();
    for (let i = 1; i < 5; i++) expect(t.levels[i].upgradeCost).toBeGreaterThan(0);
  });

  it('레벨 표가 전제 블록의 확정 수치와 일치한다', () => {
    const lv = TOWERS.archer_tower.levels;
    expect(lv.map((l) => l.arrows)).toEqual([1, 2, 3, 4, 5]);
    // 표에 적힌 값은 그대로고, 난이도 손잡이(towerDamageMul)가 곱해져서 나온다.
    const table = [10, 13, 17, 22, 28];
    const mul = BALANCE.difficulty.towerDamageMul;
    expect(lv.map((l) => l.damagePerArrow)).toEqual(
      table.map((d) => Math.max(1, Math.round(d * mul))),
    );
    expect(lv.map((l) => l.fireInterval)).toEqual([1.0, 0.95, 0.9, 0.85, 0.8]);
    expect(lv.map((l) => l.range)).toEqual([100, 100, 100, 100, 100]);
    expect(lv.map((l) => l.upgradeCost)).toEqual([null, 100, 150, 200, 250]);
  });

  it('DPS가 레벨마다 단조 증가한다', () => {
    const t = TOWERS.archer_tower;
    for (let i = 1; i < t.levels.length; i++) {
      expect(towerDps(t, i)).toBeGreaterThan(towerDps(t, i - 1));
    }
  });

  it('만렙 총 투자액은 800G이고 판매 환급은 70%다', () => {
    const t = TOWERS.archer_tower;
    expect(totalInvestedFor(t, 5)).toBe(800);
    expect(Math.floor(totalInvestedFor(t, 5) * t.sellRatio)).toBe(560);
  });

  it('보스 유닛 스탯이 확정 수치와 일치한다', () => {
    expect(UNITS.yt_infantry.hp).toBe(20);
    expect(UNITS.yt_captain.hp).toBe(500);
    expect(UNITS.yt_captain.scale).toBe(2.0);
    expect(UNITS.zhangjiao.hp).toBe(1000);
  });
});

describe('웨이브 생성기', () => {
  it('공식대로 수·성장률·간격을 만든다', () => {
    const waves = generateWaves({
      count: 3,
      unitId: 'yt_infantry',
      baseCount: 10,
      countStep: 2,
      hpGrowth: 0.14,
      speedGrowth: 0.02,
      spawnInterval: () => 1,
    });
    expect(waves).toHaveLength(3);
    expect(waves[0].spawns).toHaveLength(10);
    expect(waves[1].spawns).toHaveLength(12);
    expect(waves[2].spawns).toHaveLength(14);
    // 각 장의 성장률에 전역 가산치가 더해진 값이 실제 기울기다.
    const growth = 0.14 + BALANCE.difficulty.hpGrowthBonus;
    expect(waves[2].spawns[0].hpMul).toBeCloseTo((1 + growth) ** 2, 6);
    expect(waves[2].spawns[0].speedMul).toBeCloseTo(1.02 ** 2, 6);
  });

  it('inserts로 들어간 보스는 성장 배율을 받지 않는다', () => {
    const waves = generateWaves({
      count: 10,
      unitId: 'yt_infantry',
      baseCount: 10,
      countStep: 2,
      hpGrowth: 0.14,
      speedGrowth: 0.02,
      spawnInterval: () => 1,
      inserts: { 10: [{ unitId: 'yt_captain', atRatio: 0.5 }] },
    });
    const boss = waves[9].spawns.find((s) => s.unitId === 'yt_captain');
    expect(boss).toBeDefined();
    expect(boss!.hpMul).toBe(1);
    expect(boss!.speedMul).toBe(1);
  });

  it('스폰이 시간순으로 정렬되어 있다', () => {
    for (const w of LEVEL_01.waves) {
      for (let i = 1; i < w.spawns.length; i++) {
        expect(w.spawns[i].at).toBeGreaterThanOrEqual(w.spawns[i - 1].at);
      }
    }
  });

  it('레벨 웨이브는 한 행이 동시에, 서로 겹치지 않는 간격으로 나온다', () => {
    const rank = BALANCE.difficulty.rank;
    // 레벨 1은 3열을 적었고 rank.columnsMul 이 그것을 넓힌다 — 한 행이 통째로 같이 나온다.
    const columns = Math.min(rank.maxColumns, 3 * rank.columnsMul);
    const firstRow = LEVEL_01.waves[0].spawns.slice(0, columns);
    expect(firstRow).toHaveLength(columns);
    expect(new Set(firstRow.map((s) => s.at)).size).toBe(1);
    const lanes = firstRow.map((s) => s.laneOffset!).sort((a, b) => a - b);
    for (let i = 1; i < lanes.length; i++) {
      // 흔들림(±2)을 빼고도 최소 간격은 지킨다 — 이 아래로 좁아지면 대열이 뭉개진다
      expect(lanes[i] - lanes[i - 1]).toBeGreaterThan(rank.minSpacing - 4);
    }
    // 길(88u = 반폭 44u) 밖으로 나가지 않는다. 흔들림이 붙으므로 여유를 둔다.
    for (const lane of lanes) expect(Math.abs(lane)).toBeLessThanOrEqual(rank.maxHalfWidth + 4);
  });

  it('묶음 스폰은 부대 안에서 빠르게 나오고 부대 사이에 숨을 둔다', () => {
    const [wave] = generateWaves({
      count: 1,
      unitId: 'yt_infantry',
      baseCount: 6,
      countStep: 0,
      hpGrowth: 0,
      speedGrowth: 0,
      spawnInterval: () => 1,
      patterns: { 1: { groupSize: 3, intraInterval: 0.1, groupGap: 2 } },
    });
    // 열을 지정하지 않은(1열) 웨이브는 넓히지 않는다. 간격만 난이도 손잡이가 줄인다.
    const si = BALANCE.difficulty.spawnIntervalMul;
    const gg = BALANCE.difficulty.groupGapMul;
    const intra = 0.1 * si;
    const gap = 2 * gg;
    const times = wave.spawns.map((s) => s.at);
    const span = 2 * intra + gap;
    [0, intra, 2 * intra, span, span + intra, span + 2 * intra].forEach((expected, i) =>
      expect(times[i]).toBeCloseTo(expected),
    );
  });
});

describe('레벨 1', () => {
  it('웨이브가 12개다', () => {
    expect(LEVEL_01.waves).toHaveLength(12);
  });

  it('특수 물량전을 포함해 총 보병이 372기다', () => {
    const total = LEVEL_01.waves
      .flatMap((w) => w.spawns)
      .filter((s) => s.unitId === 'yt_infantry').length;
    expect(total).toBe(372);
  });

  it('6웨이브 중간보스는 체력 2배, 12웨이브 최종보스는 3배다', () => {
    const captains = LEVEL_01.waves[5].spawns.filter((s) => s.unitId === 'yt_captain');
    const jiao = LEVEL_01.waves[11].spawns.filter((s) => s.unitId === 'zhangjiao');
    expect(captains).toHaveLength(1);
    expect(jiao).toHaveLength(1);
    expect(captains[0].hpMul).toBe(2);
    expect(jiao[0].hpMul).toBe(3);
    // 다른 웨이브에는 보스가 없다
    for (let i = 0; i < 12; i++) {
      if (i === 5 || i === 11) continue;
      expect(LEVEL_01.waves[i].spawns.every((s) => s.unitId === 'yt_infantry')).toBe(true);
    }
  });

  it('경로 총 길이가 1800~2200u 범위다', () => {
    const path = new Path(LEVEL_01.path);
    expect(path.totalLength).toBeGreaterThanOrEqual(1800);
    expect(path.totalLength).toBeLessThanOrEqual(2200);
  });

  it('경로가 맵(1200x700) 안에 있다', () => {
    for (const [x, z] of LEVEL_01.path) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1200);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(700);
    }
  });

  it('경로가 최소 4번 크게 꺾인다', () => {
    const pts = LEVEL_01.path;
    let turns = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const ax = pts[i][0] - pts[i - 1][0];
      const az = pts[i][1] - pts[i - 1][1];
      const bx = pts[i + 1][0] - pts[i][0];
      const bz = pts[i + 1][1] - pts[i][1];
      const la = Math.hypot(ax, az);
      const lb = Math.hypot(bx, bz);
      const cos = (ax * bx + az * bz) / (la * lb);
      if (cos < Math.cos((60 * Math.PI) / 180)) turns++;
    }
    expect(turns).toBeGreaterThanOrEqual(4);
  });

  it('건설 슬롯 5개 중 최소 3개가 사거리 100으로 경로 300u 이상을 덮는다', () => {
    const path = new Path(LEVEL_01.path);
    const coverage = LEVEL_01.buildSlots.map((s) => ({
      id: s.id,
      cover: Math.round(path.lengthWithinRadius(s.x, s.z, 100)),
    }));
    // 계산 결과를 남긴다 — 맵을 고치면 여기서 바로 보인다.
    console.log(
      '  슬롯별 경로 커버리지(사거리 100):',
      coverage.map((c) => `${c.id}=${c.cover}u`).join('  '),
    );
    expect(LEVEL_01.buildSlots).toHaveLength(5);
    expect(coverage.filter((c) => c.cover >= 300).length).toBeGreaterThanOrEqual(3);
  });

  it('건설 슬롯이 두 배로 넓어진 경로 위(리본 폭 88u 안)에 놓이지 않는다', () => {
    const path = new Path(LEVEL_01.path);
    for (const s of LEVEL_01.buildSlots) {
      expect(path.lengthWithinRadius(s.x, s.z, 45)).toBe(0);
    }
  });

  it('시작 골드 250, 성 체력 1000', () => {
    expect(LEVEL_01.startGold).toBe(250);
    expect(LEVEL_01.castle.hp).toBe(1000);
  });
});
