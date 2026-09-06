import { createClient, type Client } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 토르소(libSQL) 연결.
 *
 * 접속 정보는 코드에 없고 환경변수에만 있다.
 *   TURSO_DATABASE_URL   libsql://... (또는 로컬 파일이면 file:local.db)
 *   TURSO_AUTH_TOKEN     rw 토큰
 *
 * 로컬에서는 .env 를 읽고, 배포(render.com)에서는 대시보드의 환경변수를 읽는다.
 * .env 는 절대 커밋하지 않는다 — .env.example 이 그 자리를 대신한다.
 */

/** .env 를 process.env 에 채운다. 이미 있는 값은 덮어쓰지 않는다(배포 환경이 우선). */
export function loadEnv(file = '.env'): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // 따옴표로 감싼 값 허용 — 토큰에 특수문자가 있어도 안전하게 붙여 넣을 수 있다
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

let client: Client | null = null;

export function db(): Client {
  if (client) return client;
  loadEnv();
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    throw new Error(
      'TURSO_DATABASE_URL 이 없다. .env 를 만들거나(.env.example 참고) 배포 환경변수에 넣을 것.',
    );
  }
  // 로컬 파일(file:...)로 붙을 때는 토큰이 없어도 된다 — 테스트용 경로다.
  client = createClient(url.startsWith('file:') ? { url } : { url, authToken });
  return client;
}

/** 접속 정보를 로그에 찍을 때 토큰이 새지 않게 가린다. */
export function describeTarget(): string {
  loadEnv();
  const url = process.env.TURSO_DATABASE_URL ?? '(없음)';
  const token = process.env.TURSO_AUTH_TOKEN;
  return `${url} (토큰 ${token ? `${token.slice(0, 8)}…${token.length}자` : '없음'})`;
}
