/**
 * 이번 작업(4~6장 · 성문 강화 · 로그인)의 브라우저 확인.
 * 헤드리스 크롬으로 실제 부팅 경로를 한 번 돌린다. 일회성 점검용이라 npm 스크립트에 넣지 않는다.
 *
 *   npx tsx scripts/_verify.ts --url http://localhost:5173
 */
import { chromium, type Page } from 'playwright-core';

const BASE = (process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:5173'
).replace(/\/+$/, '');

let failed = 0;
function ok(msg: string): void {
  console.log(`[ok] ${msg}`);
}
function fail(msg: string): void {
  failed++;
  console.log(`[FAIL] ${msg}`);
}
function check(cond: boolean, msg: string): void {
  if (cond) ok(msg);
  else fail(msg);
}

async function boot(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 30000 });
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--disable-gpu-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // ── 1) 로그인 화면 ────────────────────────────────────────────────
  await boot(page, `${BASE}/?debug=1`);
  await page.waitForSelector('#login-screen', { timeout: 10000 });
  ok('첫 화면에 로그인이 떴다');
  check(await page.isVisible('#login-id'), '아이디 입력칸');
  check(await page.isVisible('#login-password'), '비밀번호 입력칸');
  check(!(await page.isVisible('#level-select')), '로그인 전에는 레벨 선택이 안 뜬다');

  // 짧은 비밀번호는 거부된다
  await page.fill('#login-id', 'testhero');
  await page.fill('#login-password', '12');
  await page.click('#login-screen button[type=submit]');
  await page.waitForTimeout(400);
  check(await page.isVisible('#login-screen'), '짧은 비밀번호는 통과하지 못한다');

  // 제대로 넣으면 계정이 만들어지고 레벨 선택으로 넘어간다
  await page.fill('#login-password', 'pw1234');
  await page.click('#login-screen button[type=submit]');
  await page.waitForSelector('#level-select', { timeout: 10000 });
  ok('가입 -> 레벨 선택으로 넘어갔다');

  const cards = await page.$$eval('#level-select .levelcard', (els) =>
    els.map((e) => ({
      title: e.querySelector('.levelcard__title')?.textContent ?? '',
      locked: e.classList.contains('levelcard--locked'),
    })),
  );
  check(cards.length === 6, `장이 6개다 (실제 ${cards.length})`);
  check(!cards[0].locked && cards.slice(1).every((c) => c.locked), '1장만 열려 있다');
  console.log('     ' + cards.map((c, i) => `${i + 1}:${c.title}${c.locked ? '🔒' : ''}`).join('  '));
  check(
    (await page.textContent('#level-select .accountbar__who'))?.includes('testhero') ?? false,
    '접속한 계정이 표시된다',
  );

  // ── 2) 비밀번호 없이는 못 들어온다 ────────────────────────────────
  await page.evaluate(() => localStorage.removeItem('samtd.session'));
  await boot(page, `${BASE}/?debug=1`);
  await page.waitForSelector('#login-screen');
  await page.fill('#login-id', 'testhero');
  await page.fill('#login-password', 'wrongpw');
  await page.click('#login-screen button[type=submit]');
  await page.waitForTimeout(500);
  check(await page.isVisible('#login-screen'), '비밀번호가 틀리면 못 들어온다');
  check(
    ((await page.textContent('.login__error')) ?? '').includes('비밀번호'),
    '왜 안 되는지 화면에 적힌다',
  );

  await page.fill('#login-password', 'pw1234');
  await page.click('#login-screen button[type=submit]');
  await page.waitForSelector('#level-select', { timeout: 10000 });
  ok('맞는 비밀번호로는 들어간다');

  // ── 3) 새로고침하면 로그인이 유지된다 ────────────────────────────
  await boot(page, `${BASE}/?debug=1`);
  await page.waitForSelector('#level-select', { timeout: 10000 });
  check(!(await page.isVisible('#login-screen')), '새로고침해도 다시 로그인하지 않는다');

  // ── 4) 1장을 깨면 2장이 열린다 ───────────────────────────────────
  await page.evaluate(() => {
    const g = (window as unknown as { game: { accounts: { recordClear: (a: string, b: number) => void } } }).game;
    g.accounts.recordClear('level01', 3);
  });
  await boot(page, `${BASE}/?debug=1`);
  await page.waitForSelector('#level-select', { timeout: 10000 });
  const after = await page.$$eval('#level-select .levelcard', (els) =>
    els.map((e) => e.classList.contains('levelcard--locked')),
  );
  check(!after[0] && !after[1] && after[2], '1장을 깬 뒤에는 2장까지 열린다');

  // ── 5) 4장 — 성문 강화 ───────────────────────────────────────────
  await boot(page, `${BASE}/?debug=1&level=4`);
  await page.waitForTimeout(1200);
  check(await page.isVisible('#upgrade-gate'), '4장에 성문 강화 버튼이 있다');

  const gate = async () =>
    page.evaluate(() => {
      const g = (window as unknown as {
        game: { world: { castle: { level: number; maxHp: number }; economy: { add: (n: number) => void } } };
      }).game;
      return { level: g.world.castle.level, maxHp: g.world.castle.maxHp };
    });

  const before = await gate();
  check(before.level === 1, `시작 단계가 1이다 (${before.level})`);

  await page.evaluate(() => {
    const g = (window as unknown as { game: { world: { economy: { add: (n: number) => void } } } }).game;
    g.world.economy.add(9999);
  });
  await page.waitForTimeout(300);
  const label = await page.textContent('#upgrade-gate');
  console.log(`     버튼: ${label?.replace(/\s+/g, ' ').trim()}`);

  for (let i = 0; i < 5; i++) {
    await page.click('#upgrade-gate');
    await page.waitForTimeout(250);
  }
  const grown = await gate();
  check(grown.level === 6, `버튼 다섯 번에 6단계가 된다 (${grown.level})`);
  check(grown.maxHp > before.maxHp, `최대 체력이 늘었다 (${before.maxHp} -> ${grown.maxHp})`);
  check(
    ((await page.textContent('#upgrade-gate')) ?? '').includes('최종'),
    '만렙이면 버튼이 "최종"으로 바뀐다',
  );

  /*
   * 성문이 실제로 쏘는지.
   *
   * 그냥 기다리면 안 된다. 첫 웨이브가 24초 뒤에 나오고 경로 2470u를 걷는 데 다시 40초가
   * 걸리는데, 헤드리스의 소프트웨어 렌더러는 실시간보다 느려서(35초 동안 시뮬 25초)
   * 속도를 3배로 올려도 적이 성문에 닿지 못한다.
   * 그래서 이미 걸어 나온 적들을 경로 끝 근처로 옮겨 놓고 본다 —
   * 시뮬이 실제로 도는지가 아니라 "성문이 사거리 안 적에게 쏘는지"를 확인하는 것이 목적이다.
   */
  const fired = await page.evaluate(async () => {
    const g = (window as unknown as {
      game: {
        loop: { setSpeed: (n: number) => void };
        world: { bus: { on: (k: string, f: (e: unknown) => void) => void }; leaks: number };
      };
    }).game;
    g.loop.setSpeed(3);
    let n = 0;
    g.world.bus.on('castle:fired', () => n++);
    const w = g.world as unknown as {
      path: { totalLength: number };
      enemies: { distance: number }[];
    };
    // 적이 나오기를 기다렸다가 전부 성문 앞으로 끌어다 놓는다
    for (let i = 0; i < 60 && w.enemies.length === 0; i++) await new Promise((r) => setTimeout(r, 500));
    for (const e of w.enemies) e.distance = w.path.totalLength - 120;
    await new Promise((r) => setTimeout(r, 4000));
    const st = g.world as unknown as { elapsed: number; enemies: unknown[]; leaks: number; kills: number };
    return { n, elapsed: Math.round(st.elapsed), live: st.enemies.length, leaks: st.leaks, kills: st.kills };
  });
  console.log(`     시뮬 ${fired.elapsed}초 · 적 ${fired.live}기 · 누수 ${fired.leaks} · 처치 ${fired.kills}`);
  check(fired.n > 0, `성문이 실제로 쏜다 (${fired.n}회)`);

  // ── 6) 5·6장이 열리고 새 타워가 목록에 있다 ──────────────────────
  for (const [lv, tower] of [
    [5, '화포 진지'],
    [6, '화포 진지'],
  ] as const) {
    await boot(page, `${BASE}/?debug=1&level=${lv}`);
    await page.waitForTimeout(900);
    const names = await page.evaluate(() => {
      const g = (window as unknown as { game: { buildableTowers?: () => { displayName: string }[] } }).game;
      return (
        (window as unknown as { game: { level: { title: string } } }).game.level.title +
        '|' +
        (g.buildableTowers ? g.buildableTowers().map((t) => t.displayName).join(',') : '')
      );
    });
    console.log(`     레벨${lv}: ${names}`);
    check(names.includes(tower), `${lv}장에서 ${tower}를 지을 수 있다`);
  }

  const real = errors.filter((e) => !/favicon|WebGPU|swiftshader/i.test(e));
  check(real.length === 0, `콘솔 에러 없음${real.length ? ` — ${real.slice(0, 3).join(' | ')}` : ''}`);

  await browser.close();
  console.log(failed === 0 ? '\n전부 통과' : `\n${failed}건 실패`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
