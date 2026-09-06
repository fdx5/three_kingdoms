/**
 * DB 점검 — 지금 무엇이 들어 있는지 한 화면으로 본다.
 *
 *   npm run db:check
 *   npm run db:check -- --purge apitest      그 계정과 딸린 기록을 지운다
 *
 * 콘솔 인코딩 때문에 curl 로는 한글이 깨져 보인다. 실제로 무엇이 저장됐는지는
 * 이걸로 확인한다.
 */
import { db, describeTarget } from '../server/db';

const client = db();
const purge = process.argv.includes('--purge') ? process.argv[process.argv.indexOf('--purge') + 1] : null;

if (purge) {
  // ON DELETE CASCADE 가 진행도·전적·방명록을 같이 지운다
  const r = await client.execute({ sql: 'DELETE FROM accounts WHERE id = ?', args: [purge] });
  console.log(`[db] 계정 '${purge}' 삭제: ${r.rowsAffected}행 (딸린 기록은 CASCADE)`);
}

console.log(`[db] ${describeTarget()}\n`);
for (const t of ['accounts', 'progress', 'records', 'guestbook', 'levels', 'units', 'towers']) {
  const r = await client.execute(`SELECT COUNT(*) AS n FROM ${t}`);
  console.log(`  ${t.padEnd(10)} ${String(r.rows[0].n).padStart(4)}행`);
}

const recs = await client.execute(
  `SELECT r.played_at, r.account_id, r.level_title, r.won, r.stars, r.kills, r.elapsed
   FROM records r ORDER BY r.played_at DESC LIMIT 5`,
);
if (recs.rows.length > 0) {
  console.log('\n최근 전적:');
  for (const r of recs.rows) {
    console.log(
      `  ${new Date(Number(r.played_at)).toISOString().slice(0, 16)} ${String(r.account_id).padEnd(10)} ` +
        `${String(r.level_title).padEnd(22)} ${Number(r.won) ? '승' : '패'} ★${r.stars} ` +
        `처치 ${r.kills} ${Math.round(Number(r.elapsed))}초`,
    );
  }
}

const gb = await client.execute('SELECT display_name, message FROM guestbook ORDER BY created_at DESC LIMIT 5');
if (gb.rows.length > 0) {
  console.log('\n방명록:');
  for (const r of gb.rows) console.log(`  ${String(r.display_name)}: ${String(r.message)}`);
}
