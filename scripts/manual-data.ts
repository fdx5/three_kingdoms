/**
 * 설명서용 데이터 추출.
 * 밸런스 수치는 데이터 파일이 유일한 출처다 — 설명서에 손으로 옮겨 적으면
 * 반드시 어긋난다. 여기서 뽑아 그대로 쓴다.
 */
import { writeFileSync } from 'node:fs';
import { LEVEL_ORDER } from '../src/data/levels';
import { UNIT_LIST, UNITS } from '../src/data/units';
import { TOWER_LIST } from '../src/data/towers';
import { STRATAGEM_LIST } from '../src/data/stratagems';
import { CASTLE_LEVELS } from '../src/data/castle';
import { BALANCE } from '../src/data/balance';

const levels = LEVEL_ORDER.map((l) => {
  const roster = new Map<string, number>();
  for (const w of l.waves) for (const s of w.spawns) roster.set(s.unitId, (roster.get(s.unitId) ?? 0) + 1);
  const totalSpawns = [...roster.values()].reduce((a, b) => a + b, 0);
  return {
    id: l.id,
    title: l.title,
    castleHp: l.castle.hp,
    startGold: l.startGold,
    allowRepair: !!l.allowRepair,
    castleUpgrade: !!l.castleUpgrade,
    stratagems: l.stratagems ?? [],
    waveInterval: l.waveInterval ?? BALANCE.waveInterval,
    firstWaveDelay: l.firstWaveDelay ?? BALANCE.firstWaveDelay,
    earlyCallBonusPerSecond: l.earlyCallBonusPerSecond ?? BALANCE.earlyCallBonusPerSecond,
    stars: l.stars ?? BALANCE.stars,
    // 세울 수 있는 망루의 수. 자유 배치라 자리는 자유고, 레벨이 정하는 것은 이 수다.
    slots: l.maxTowers ?? l.buildSlots.length,
    waves: l.waves.length,
    bossWaves: l.waves.filter((w) => w.isBossWave).map((w) => ({ index: w.index, banner: w.banner })),
    totalSpawns,
    roster: [...roster.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, count, name: UNITS[id]?.displayName ?? id, kind: UNITS[id]?.kind })),
    path: l.path,
    buildSlots: l.buildSlots,
    environment: l.environment,
    totalReward: l.waves.reduce((s, w) => s + (w.reward ?? 0), 0),
    /* 이 장에서 적을 전부 잡으면 들어오는 골드. 웨이브 보상이 대부분 0이라
       실제 수입은 이쪽과 조기 소집이 만든다 — 설명서에는 이 값이 더 쓸모 있다. */
    killGold: [...roster.entries()].reduce((s, [id, c]) => s + (UNITS[id]?.goldOnKill ?? 0) * c, 0),
    /* 이 장에서 처음 나오는 적 */
    debuts: [...roster.keys()].filter((id) => {
      for (const prev of LEVEL_ORDER) {
        if (prev.id === l.id) break;
        if (prev.waves.some((w) => w.spawns.some((sp) => sp.unitId === id))) return false;
      }
      return true;
    }),
  };
});

/** 이 유닛이 처음 등장하는 장 */
const firstSeen: Record<string, string> = {};
for (const l of LEVEL_ORDER)
  for (const w of l.waves)
    for (const s of w.spawns) if (!firstSeen[s.unitId]) firstSeen[s.unitId] = l.id;

const units = UNIT_LIST.map((u) => ({
  id: u.id,
  name: u.displayName,
  faction: u.faction,
  kind: u.kind,
  hp: u.hp,
  speed: u.speed,
  goldOnKill: u.goldOnKill,
  castleDamage: u.castleDamage,
  scale: u.scale,
  modelId: u.view.modelId,
  traits: u.traits ?? null,
  firstSeen: firstSeen[u.id] ?? null,
}));

const towers = TOWER_LIST.map((t) => ({
  id: t.id,
  name: t.displayName,
  description: t.description,
  buildCost: t.buildCost,
  sellRatio: t.sellRatio,
  kind: t.kind,
  damageKind: t.damageKind,
  targeting: t.targeting,
  effect: t.effect ?? null,
  ignite: t.ignite ?? null,
  unlockedIn: t.unlockedIn ?? null,
  modelId: t.levels[0].view.modelId,
  levels: t.levels.map((lv, i) => ({
    level: i + 1,
    arrows: lv.arrows,
    damagePerArrow: lv.damagePerArrow,
    fireInterval: lv.fireInterval,
    range: lv.range,
    upgradeCost: lv.upgradeCost,
    dps: +((lv.arrows * lv.damagePerArrow) / lv.fireInterval).toFixed(1),
    modelId: lv.view.modelId,
  })),
  totalCost: t.buildCost + t.levels.reduce((s, lv) => s + (lv.upgradeCost ?? 0), 0),
}));

const stratagems = STRATAGEM_LIST.map((s) => ({
  id: s.id, name: s.displayName, glyph: s.glyph, description: s.description,
  cost: s.cost, cooldown: s.cooldown, effect: s.effect, unlockedIn: s.unlockedIn ?? null,
}));

const castle = CASTLE_LEVELS.map((c) => ({
  level: c.level, title: c.title, description: c.description,
  upgradeCost: c.upgradeCost, hpBonus: c.hpBonus,
  weapon: c.weapon,
  dps: +((c.weapon.shots * c.weapon.damagePerShot) / c.weapon.fireInterval).toFixed(1),
}));

writeFileSync(
  'manual/data.json',
  JSON.stringify({ levels, units, towers, stratagems, castle, balance: BALANCE }, null, 2),
);
console.log(`levels=${levels.length} units=${units.length} towers=${towers.length} stratagems=${stratagems.length} castle=${castle.length}`);
