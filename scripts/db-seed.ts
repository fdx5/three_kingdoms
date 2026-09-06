/**
 * 참조 데이터 적재 — 레벨·유닛·타워를 게임 코드에서 읽어 그대로 DB에 넣는다.
 *
 *   npm run db:seed
 *
 * 왜 넣는가: 전적(records)만으로는 "무엇에게 뚫렸는지"를 해석할 수 없다.
 * DB가 등갑병이 화살을 65% 튕긴다는 걸 알아야 랭킹·통계를 SQL로 짤 수 있다.
 *
 * 멱등하다. 매번 지우고 다시 넣으므로 게임 데이터를 고친 뒤 다시 돌리면
 * DB가 코드를 따라온다. 계정·전적 테이블은 건드리지 않는다.
 */
import { db, describeTarget } from '../server/db';
import { BALANCE } from '../src/data/balance';
import { LEVEL_ORDER } from '../src/data/levels';
import { UNITS } from '../src/data/units';
import { TOWERS } from '../src/data/towers';
import { Path } from '../src/sim/Path';

const client = db();
console.log(`[seed] 대상: ${describeTarget()}`);

// ── 레벨 ──────────────────────────────────────────────────────────────
//
// 경로 길이와 슬롯 수는 저장된 값이 아니라 **계산해서** 넣는다. 레벨 파일에는
// 좌표만 있고 길이는 Path 가 만든다 — DB에도 같은 값이 들어가야 "이 장이 얼마나
// 긴가"를 SQL 로 물을 수 있다.
const levelRows = LEVEL_ORDER.map((level, i) => {
  // 별 기준을 안 적은 장은 BALANCE 기본값을 쓴다 — DB에는 실제로 적용되는 값이 들어가야 한다
  const stars = level.stars ?? BALANCE.stars;
  return {
    id: level.id,
    ordinal: i + 1,
    title: level.title,
    castle_id: level.castle.id,
    castle_hp: level.castle.hp,
    start_gold: level.startGold,
    wave_count: level.waves.length,
    three_star: stars.three,
    two_star: stars.two,
    path_length: Math.round(new Path(level.path).totalLength * 10) / 10,
    slot_count: level.buildSlots.length,
    stratagems: JSON.stringify(level.stratagems ?? []),
    castle_upgrade: level.castleUpgrade ? 1 : 0,
  };
});

// ── 유닛 ──────────────────────────────────────────────────────────────
const unitRows = Object.values(UNITS).map((u) => ({
  id: u.id,
  display_name: u.displayName,
  faction: u.faction,
  kind: u.kind,
  hp: u.hp,
  speed: u.speed,
  gold_on_kill: u.goldOnKill,
  castle_damage: u.castleDamage,
  scale: u.scale,
  model_id: u.view.modelId ?? null,
  traits: JSON.stringify(u.traits ?? {}),
}));

// ── 타워 ──────────────────────────────────────────────────────────────
//
// 레벨 표는 JSON 으로 통째로 넣는다. 다섯 줄짜리 표를 다시 정규화하면
// 조회할 때마다 조인이 붙는데, 이 표를 개별 행으로 물을 일이 없다.
const towerRows = Object.values(TOWERS).map((t) => ({
  id: t.id,
  display_name: t.displayName,
  description: t.description,
  build_cost: t.buildCost,
  kind: t.kind,
  damage_kind: t.damageKind,
  targeting: t.targeting,
  unlocked_in: t.unlockedIn ?? null,
  levels: JSON.stringify(
    t.levels.map((lv, i) => ({
      level: i + 1,
      arrows: lv.arrows,
      damagePerArrow: lv.damagePerArrow,
      fireInterval: lv.fireInterval,
      range: lv.range,
      upgradeCost: lv.upgradeCost,
    })),
  ),
}));

async function replace(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const holders = cols.map(() => '?').join(', ');
  // 지우고 넣는 것을 한 배치로 보낸다 — 중간에 끊겨 테이블이 빈 채로 남지 않게.
  await client.batch(
    [
      { sql: `DELETE FROM ${table}`, args: [] },
      ...rows.map((row) => ({
        sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${holders})`,
        args: cols.map((c) => row[c] as never),
      })),
    ],
    'write',
  );
  console.log(`[seed] ${table.padEnd(7)} ${String(rows.length).padStart(3)}행`);
}

await replace('levels', levelRows);
await replace('units', unitRows);
await replace('towers', towerRows);

const check = await client.execute(`
  SELECT l.ordinal, l.id, l.title, l.wave_count, l.slot_count,
         CAST(l.path_length AS INTEGER) AS len,
         (SELECT COUNT(*) FROM towers t WHERE t.unlocked_in = l.id) AS new_towers
  FROM levels l ORDER BY l.ordinal
`);
console.log('\n장  id        제목                          웨이브 슬롯  경로   신규타워');
for (const r of check.rows) {
  console.log(
    `${String(r.ordinal).padStart(2)}  ${String(r.id).padEnd(9)} ${String(r.title).padEnd(24)} ` +
      `${String(r.wave_count).padStart(4)} ${String(r.slot_count).padStart(4)} ${String(r.len).padStart(6)}u ` +
      `${String(r.new_towers).padStart(4)}`,
  );
}
const byFaction = await client.execute(
  `SELECT faction, COUNT(*) n, SUM(kind != 'minion') bosses FROM units GROUP BY faction ORDER BY faction`,
);
console.log('\n진영별 유닛:');
for (const r of byFaction.rows) {
  console.log(`  ${String(r.faction).padEnd(9)} ${String(r.n).padStart(2)}종 (장수 ${String(r.bosses)})`);
}
