/**
 * 토르소 DB에 스키마를 적용한다.
 *
 *   npm run db:migrate
 *
 * db/schema.sql 을 문장 단위로 쪼개 순서대로 실행한다. 전부 IF NOT EXISTS 라
 * 여러 번 돌려도 같은 결과가 된다(멱등). 스키마를 고쳤으면 다시 돌리면 된다.
 *
 * 왜 libsql 의 executeMultiple 을 안 쓰는가: 어느 문장에서 깨졌는지 알려주지 않는다.
 * 스키마가 길어질수록 그게 곧 디버깅 시간이라 직접 쪼갠다.
 */
import { readFileSync } from 'node:fs';
import { db, describeTarget } from '../server/db';

/** `--;` 로 끝나는 주석과 빈 줄을 걷어내고 세미콜론으로 나눈다. */
function statements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) =>
      s
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((s) => s.length > 0);
}

const sql = readFileSync('db/schema.sql', 'utf8');
const stmts = statements(sql);
console.log(`[db] 대상: ${describeTarget()}`);
console.log(`[db] 문장 ${stmts.length}개 적용`);

const client = db();
for (const [i, stmt] of stmts.entries()) {
  const head = stmt.replace(/\s+/g, ' ').slice(0, 68);
  try {
    await client.execute(stmt);
    console.log(`  ${String(i + 1).padStart(2)}. ok   ${head}`);
  } catch (err) {
    console.error(`  ${String(i + 1).padStart(2)}. FAIL ${head}`);
    throw err;
  }
}

const tables = await client.execute(
  `SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
);
console.log('[db] 현재 객체:');
for (const row of tables.rows) console.log(`  ${String(row.type).padEnd(5)} ${String(row.name)}`);
