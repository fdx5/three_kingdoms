/**
 * 삼국지 TD 서버 — 토르소 DB 앞의 REST API + 빌드된 게임 정적 서빙.
 *
 *   npm run server     (로컬, .env 를 읽는다)
 *
 * 하나의 프로세스가 두 가지를 한다.
 *   /api/*   토르소 DB를 읽고 쓰는 REST API — TorsoGameStore 가 기대하는 그 모양
 *   그 외    dist/ 의 정적 파일 (없으면 빌드하라고 알려 준다)
 *
 * 왜 한 프로세스인가: 게임과 API 가 같은 오리진에 있으면 CORS 도, 배포도 하나로 끝난다.
 * render.com 에 서비스 하나만 올리면 된다. 그래도 다른 오리진에서 붙을 수 있게
 * CORS 는 열어 둔다(감출 것이 없는 공개 API 다).
 *
 * 비밀번호를 다루는 방식
 * --------------------
 * 저장된 해시는 **절대 응답에 실리지 않는다.** GET /accounts/:id 는 소금까지만 준다.
 * 브라우저가 그 소금으로 PBKDF2 를 돌려 해시를 만들어 POST /api/sessions 로 보내면,
 * 서버가 시간 일정 비교로 맞는지만 알려준다. 해시를 그대로 내려 주면 아이디만 알아도
 * 오프라인에서 사전 공격을 할 수 있다.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { Row } from '@libsql/client';
import { db, loadEnv } from './db';

loadEnv();

/*
 * 포트는 **반드시** 배포 환경이 준 것을 그대로 써야 한다.
 *
 * 예전에는 `Number(process.env.PORT ?? 8787)` 이었다. PORT 가 빈 문자열이면
 * Number('') 는 0 이고, listen(0) 은 "아무 빈 포트나" 라는 뜻이라 서버가 랜덤
 * 포트에 붙는다. render.com 은 자기가 지정한 포트만 훑으므로 그걸 못 찾고
 * `No open ports detected` 로 배포를 실패시킨다 — 로그에는 서버가 정상적으로
 * 떴다고 찍혀 있어서 원인이 안 보인다. PORT 가 'abc' 같은 값이면 NaN 인데,
 * 이것도 결국 0 으로 취급돼서 같은 일이 벌어진다.
 *
 * parseInt 로 읽고, 1..65535 를 벗어나면 기본값으로 물러선다.
 */
function readPort(): number {
  const raw = (process.env.PORT ?? '').trim();
  const n = Number.parseInt(raw, 10);
  if (Number.isInteger(n) && n > 0 && n <= 65535) return n;
  if (raw) console.warn(`[server] PORT 값이 이상하다(${JSON.stringify(raw)}). 8787 로 뜬다.`);
  return 8787;
}

const PORT = readPort();

/*
 * 0.0.0.0 에 명시적으로 붙는다. 인자를 안 주면 node 가 환경에 따라 IPv6 쪽으로만
 * 붙는 경우가 있는데, 컨테이너 밖(로드밸런서)에서는 그게 안 보인다.
 */
const HOST = process.env.HOST ?? '0.0.0.0';
const DIST = resolve(process.cwd(), 'dist');

/*
 * DB 연결은 **미루고, 실패해도 프로세스를 죽이지 않는다.**
 *
 * 예전에는 여기서 곧바로 db() 를 불렀다. 그러면 접속 정보가 없을 때 모듈을 읽는
 * 도중에 예외가 나서 프로세스가 통째로 죽고, 배포판(render.com)은 그걸 크래시
 * 루프로 본다 — 로그에는 스택만 남고 "환경변수를 안 넣었다"는 사실은 안 보인다.
 *
 * 이제는 서버가 뜬 채로 정적 파일을 계속 서빙하고, API 는 503 과 함께 무엇이
 * 없는지 말해 준다. /api/health 를 열어 보면 원인이 한 줄로 나온다.
 */
let dbError: string | null = null;
let cached: ReturnType<typeof db> | null = null;

function client(): ReturnType<typeof db> {
  if (cached) return cached;
  cached = db();
  return cached;
}

/** 연결이 되는지 한 번 확인해 둔다. 안 되면 이유를 들고 있는다. */
function checkDb(): void {
  try {
    client();
    dbError = null;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }
}
checkDb();

// ── 도메인 <-> 행 변환 ────────────────────────────────────────────────
//
// DB는 snake_case 정수, 게임은 camelCase 다. 그 사이의 번역은 여기 한 곳에만 있다.

const num = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string => String(v ?? '');

/** 비밀번호 해시는 뺀다 — 밖으로 나가면 안 되는 유일한 필드다. */
function toAccount(row: Row): Record<string, unknown> {
  return {
    id: str(row.id),
    displayName: str(row.display_name),
    passwordHash: '',
    passwordSalt: str(row.password_salt),
    createdAt: num(row.created_at),
    lastLoginAt: num(row.last_login_at),
  };
}

function toRecord(row: Row): Record<string, unknown> {
  return {
    id: str(row.id),
    accountId: str(row.account_id),
    levelId: str(row.level_id),
    levelTitle: str(row.level_title),
    won: num(row.won) === 1,
    stars: num(row.stars),
    wavesCleared: num(row.waves_cleared),
    totalWaves: num(row.total_waves),
    kills: num(row.kills),
    leaks: num(row.leaks),
    castleHp: num(row.castle_hp),
    castleMaxHp: num(row.castle_max_hp),
    castleLevel: num(row.castle_level),
    goldEarned: num(row.gold_earned),
    elapsed: num(row.elapsed),
    playedAt: num(row.played_at),
  };
}

function toGuestbook(row: Row): Record<string, unknown> {
  return {
    id: str(row.id),
    accountId: str(row.account_id),
    displayName: str(row.display_name),
    message: str(row.message),
    createdAt: num(row.created_at),
  };
}

/** 저장소가 부여하는 id. 시간 접두사가 있어 정렬해도 대충 시간순이 된다. */
function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 길이가 달라도 타이밍이 새지 않게 비교한다. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // 길이가 다르면 어차피 틀렸지만, 그래도 한 번은 비교해 걸리는 시간을 맞춘다
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

// ── HTTP 잡일 ─────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    // 이 API 로 오는 것 중 가장 큰 것이 방명록 한 줄이다. 그보다 크면 볼 것도 없다.
    if (size > 64 * 1024) throw new Error('본문이 너무 크다');
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

// ── 라우팅 ────────────────────────────────────────────────────────────

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const method = req.method ?? 'GET';

  /*
   * /health 는 **DB 상태와 무관하게 200 이다.**
   *
   * 이 경로는 render.com 헬스체크가 두드리는 곳이다. DB 가 없다고 503 을 주면
   * 배포가 통째로 실패하고 롤백된다 — 정적 파일이라도 서빙하며 살아 있자는 이
   * 파일의 설계와 정면으로 어긋난다. 그래서 "서버는 살아 있다"는 사실만 200 으로
   * 알리고, DB 가 어떤 상태인지는 본문의 ok/db/error 로 정직하게 말한다.
   */
  if (path === '/health') {
    if (dbError) {
      send(res, 200, { ok: false, db: 'unavailable', error: dbError, now: Date.now() });
      return true;
    }
    try {
      const r = await client().execute('SELECT COUNT(*) AS n FROM levels');
      send(res, 200, { ok: true, db: 'ok', levels: num(r.rows[0]?.n), now: Date.now() });
    } catch (err) {
      // 접속 정보는 있는데 실제로 못 붙는 경우 — 토큰 만료·DB 삭제 같은 것들
      send(res, 200, {
        ok: false,
        db: 'unreachable',
        error: err instanceof Error ? err.message : String(err),
        now: Date.now(),
      });
    }
    return true;
  }

  /*
   * 여기부터는 전부 DB 가 있어야 한다.
   *
   * 실패했더라도 **한 번 더 해 본다.** 기동 시점에 환경변수가 없었거나 토르소가
   * 잠깐 안 됐을 뿐일 수 있는데, 예전에는 그 결과를 영원히 들고 있어서 서버를
   * 재시작하기 전까지 API 가 계속 죽어 있었다. 붙게 되면 그 순간부터 산다.
   */
  if (dbError) {
    checkDb();
    if (dbError) {
      send(res, 503, { error: 'DB 를 쓸 수 없다', detail: dbError });
      return true;
    }
  }

  // ── 계정 ──
  if (path === '/accounts' && method === 'POST') {
    const b = await readJson(req);
    const id = String(b.id ?? '').toLowerCase();
    if (!/^[a-z0-9_-]{3,16}$/.test(id)) {
      send(res, 400, { error: 'bad id' });
      return true;
    }
    const now = Date.now();
    try {
      await client().execute({
        sql: `INSERT INTO accounts (id, display_name, password_hash, password_salt, created_at, last_login_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          String(b.displayName ?? id),
          String(b.passwordHash ?? ''),
          String(b.passwordSalt ?? ''),
          Number(b.createdAt ?? now),
          Number(b.lastLoginAt ?? now),
        ],
      });
    } catch (err) {
      // UNIQUE 위반 = 이미 있는 id. 오류가 아니라 "안 된다"는 대답이다.
      if (String(err).includes('UNIQUE')) {
        send(res, 409, { error: 'exists' });
        return true;
      }
      throw err;
    }
    const r = await client().execute({ sql: 'SELECT * FROM accounts WHERE id = ?', args: [id] });
    send(res, 201, toAccount(r.rows[0]));
    return true;
  }

  const accountMatch = /^\/accounts\/([^/]+)(\/progress)?$/.exec(path);
  if (accountMatch) {
    const id = decodeURIComponent(accountMatch[1]).toLowerCase();
    const isProgress = Boolean(accountMatch[2]);

    if (!isProgress && method === 'GET') {
      const r = await client().execute({ sql: 'SELECT * FROM accounts WHERE id = ?', args: [id] });
      if (r.rows.length === 0) {
        send(res, 404, { error: 'not found' });
        return true;
      }
      send(res, 200, toAccount(r.rows[0]));
      return true;
    }

    if (!isProgress && method === 'PATCH') {
      const b = await readJson(req);
      // 갱신을 허용하는 필드는 이 둘뿐이다. 해시·소금은 여기서 못 바꾼다.
      const sets: string[] = [];
      const args: (string | number)[] = [];
      if (b.lastLoginAt !== undefined) {
        sets.push('last_login_at = ?');
        args.push(Number(b.lastLoginAt));
      }
      if (b.displayName !== undefined) {
        sets.push('display_name = ?');
        args.push(String(b.displayName));
      }
      if (sets.length > 0) {
        args.push(id);
        await client().execute({ sql: `UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, args });
      }
      send(res, 204);
      return true;
    }

    if (isProgress && method === 'GET') {
      const r = await client().execute({
        sql: 'SELECT level_id, stars FROM progress WHERE account_id = ?',
        args: [id],
      });
      const stars: Record<string, number> = {};
      for (const row of r.rows) stars[str(row.level_id)] = num(row.stars);
      send(res, 200, { stars });
      return true;
    }

    if (isProgress && method === 'PUT') {
      const b = await readJson(req);
      const stars = (b.stars ?? {}) as Record<string, number>;
      const now = Date.now();
      /*
       * 통째로 지우고 다시 넣지 않는다. 진행도는 "더 높은 별만 남는다"가 규칙이라
       * upsert 에 그 규칙을 박아 둔다 — 오래된 화면이 낮은 값을 보내도 기록이 깎이지 않는다.
       */
      const stmts = Object.entries(stars)
        .filter(([, v]) => Number(v) >= 1 && Number(v) <= 3)
        .map(([levelId, v]) => ({
          sql: `INSERT INTO progress (account_id, level_id, stars, updated_at) VALUES (?, ?, ?, ?)
                ON CONFLICT (account_id, level_id) DO UPDATE SET
                  stars = MAX(stars, excluded.stars),
                  updated_at = excluded.updated_at`,
          args: [id, levelId, Number(v), now] as (string | number)[],
        }));
      if (stmts.length > 0) await client().batch(stmts, 'write');
      send(res, 204);
      return true;
    }
  }

  // ── 로그인 확인 ──
  //
  // 브라우저가 소금으로 만든 해시를 보내면 맞는지만 알려준다.
  if (path === '/sessions' && method === 'POST') {
    const b = await readJson(req);
    const id = String(b.id ?? '').toLowerCase();
    const hash = String(b.passwordHash ?? '');
    const r = await client().execute({
      sql: 'SELECT password_hash FROM accounts WHERE id = ?',
      args: [id],
    });
    const ok = r.rows.length > 0 && safeEqual(str(r.rows[0].password_hash), hash);
    send(res, ok ? 200 : 401, { ok });
    return true;
  }

  // ── 전적 ──
  if (path === '/records' && method === 'POST') {
    const b = await readJson(req);
    const id = newId('rec');
    await client().execute({
      sql: `INSERT INTO records (id, account_id, level_id, level_title, won, stars, waves_cleared,
              total_waves, kills, leaks, castle_hp, castle_max_hp, castle_level, gold_earned, elapsed, played_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        String(b.accountId ?? '').toLowerCase(),
        String(b.levelId ?? ''),
        String(b.levelTitle ?? ''),
        b.won ? 1 : 0,
        Number(b.stars ?? 0),
        Number(b.wavesCleared ?? 0),
        Number(b.totalWaves ?? 0),
        Number(b.kills ?? 0),
        Number(b.leaks ?? 0),
        Number(b.castleHp ?? 0),
        Number(b.castleMaxHp ?? 0),
        Number(b.castleLevel ?? 1),
        Number(b.goldEarned ?? 0),
        Number(b.elapsed ?? 0),
        Number(b.playedAt ?? Date.now()),
      ],
    });
    const r = await client().execute({ sql: 'SELECT * FROM records WHERE id = ?', args: [id] });
    send(res, 201, toRecord(r.rows[0]));
    return true;
  }

  if (path === '/records' && method === 'GET') {
    const accountId = url.searchParams.get('accountId');
    const limit = Math.min(200, Number(url.searchParams.get('limit') ?? 50));
    const r = accountId
      ? await client().execute({
          sql: 'SELECT * FROM records WHERE account_id = ? ORDER BY played_at DESC LIMIT ?',
          args: [accountId.toLowerCase(), limit],
        })
      : await client().execute({
          sql: 'SELECT * FROM records ORDER BY played_at DESC LIMIT ?',
          args: [limit],
        });
    send(res, 200, r.rows.map(toRecord));
    return true;
  }

  // ── 방명록 ──
  if (path === '/guestbook' && method === 'POST') {
    const b = await readJson(req);
    const message = String(b.message ?? '').trim().slice(0, 500);
    if (!message) {
      send(res, 400, { error: 'empty message' });
      return true;
    }
    const id = newId('gb');
    await client().execute({
      sql: `INSERT INTO guestbook (id, account_id, display_name, message, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        id,
        String(b.accountId ?? '').toLowerCase(),
        String(b.displayName ?? ''),
        message,
        Number(b.createdAt ?? Date.now()),
      ],
    });
    const r = await client().execute({ sql: 'SELECT * FROM guestbook WHERE id = ?', args: [id] });
    send(res, 201, toGuestbook(r.rows[0]));
    return true;
  }

  if (path === '/guestbook' && method === 'GET') {
    const limit = Math.min(200, Number(url.searchParams.get('limit') ?? 50));
    const r = await client().execute({
      sql: 'SELECT * FROM guestbook ORDER BY created_at DESC LIMIT ?',
      args: [limit],
    });
    send(res, 200, r.rows.map(toGuestbook));
    return true;
  }

  // ── 랭킹 (스키마의 뷰를 그대로 내보낸다) ──
  if (path === '/leaderboard' && method === 'GET') {
    const levelId = url.searchParams.get('levelId');
    const limit = Math.min(100, Number(url.searchParams.get('limit') ?? 20));
    const r = levelId
      ? await client().execute({
          sql: `SELECT * FROM v_level_best WHERE level_id = ?
                ORDER BY best_stars DESC, best_elapsed ASC LIMIT ?`,
          args: [levelId, limit],
        })
      : await client().execute({
          sql: `SELECT * FROM v_account_summary ORDER BY total_stars DESC, wins DESC LIMIT ?`,
          args: [limit],
        });
    send(res, 200, r.rows);
    return true;
  }

  // ── 참조 데이터 ──
  if (path === '/catalog' && method === 'GET') {
    const [levels, units, towers] = await Promise.all([
      client().execute('SELECT * FROM levels ORDER BY ordinal'),
      client().execute('SELECT * FROM units ORDER BY faction, hp'),
      client().execute('SELECT * FROM towers ORDER BY build_cost'),
    ]);
    send(res, 200, { levels: levels.rows, units: units.rows, towers: towers.rows });
    return true;
  }

  return false;
}

/** dist/ 의 정적 파일. 없으면 빌드하라고 알려 준다. */
function serveStatic(res: ServerResponse, pathname: string): void {
  if (!existsSync(DIST)) {
    res
      .writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      .end('dist/ 가 없다. npm run build 를 먼저 돌릴 것.');
    return;
  }
  const rel = normalize(decodeURIComponent(pathname)).split('..').join('');
  let file = join(DIST, rel);
  // SPA 라 없는 경로는 index.html 로 되돌린다
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    // 모델·텍스처는 파일명이 바뀌지 않으면 내용도 안 바뀐다. 하루면 충분하다.
    'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=86400',
  });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    api(req, res, url)
      .then((handled) => {
        if (!handled) send(res, 404, { error: `no route for ${req.method} ${url.pathname}` });
      })
      .catch((err: unknown) => {
        console.error('[api]', req.method, url.pathname, err);
        if (!res.headersSent) send(res, 500, { error: '서버 오류' });
      });
    return;
  }

  serveStatic(res, url.pathname);
});

/*
 * 바인딩 실패를 조용히 넘기지 않는다. 포트가 이미 잡혀 있거나 권한이 없으면
 * 여기서 이유를 찍고 죽는다 — 안 그러면 배포 로그에 아무것도 안 남는다.
 */
server.on('error', (err) => {
  console.error(`[server] ${HOST}:${PORT} 에 붙지 못했다 —`, err);
  process.exit(1);
});

/*
 * 요청 하나가 프로세스를 죽이지 못하게 한다.
 *
 * node 의 기본값은 잡히지 않은 예외가 나면 프로세스를 끝내는 것이다. 웹 서비스
 * 에서는 그게 곧 배포 중단이다 — 방명록 한 줄 때문에 게임 전체가 내려간다.
 * 여기서 로그만 남기고 계속 산다. 라우팅 단계의 오류는 이미 각자 500 으로
 * 처리되므로, 여기까지 오는 것은 그 바깥의 예상 못 한 것들이다.
 *
 * 상태가 깨진 채로 도는 것 아니냐 — 이 서버는 요청마다 독립적이고 공유 상태가
 * DB 연결 하나뿐이라(그것도 위에서 다시 붙는다) 그 위험이 거의 없다. 살아서
 * 정적 파일이라도 계속 주는 쪽이 낫다.
 */
process.on('uncaughtException', (err) => {
  console.error('[server] 잡히지 않은 예외 — 계속 산다:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] 처리되지 않은 거부 — 계속 산다:', reason);
});

/*
 * 종료 신호는 제대로 받는다. render.com 은 배포를 교체할 때 SIGTERM 을 보낸다.
 * 받는 중인 요청을 끝내고 닫으면 교체 순간에 끊기는 연결이 없다.
 */
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`[server] ${sig} — 받는 중인 요청을 끝내고 닫는다.`);
    server.close(() => process.exit(0));
    // 안 닫히는 연결이 있어도 10초 뒤에는 나간다. 배포가 이것 때문에 멈추면 안 된다.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

server.listen(PORT, HOST, () => {
  const addr = server.address();
  const bound = typeof addr === 'object' && addr ? addr.port : PORT;
  // 실제로 붙은 포트를 찍는다. 기대한 것과 다르면 여기서 바로 보인다.
  console.log(`[server] listening on ${HOST}:${bound}  (API: /api, 정적: ${DIST})`);
  console.log(
    `[server] dist ${existsSync(DIST) ? '있음' : '없음 — npm run build 필요'}, ` +
      `DB ${dbError ? `불가: ${dbError}` : '연결 준비됨'}`,
  );
});
