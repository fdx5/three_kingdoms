/**
 * 배포본이 실제로 부팅되는지 본다.
 *
 * `npm run deploy:check` 는 "새 커밋이 떴다"까지만 말해 준다. 번들이 부팅 중에
 * 죽으면 헬스 체크는 초록인데 화면은 로딩에서 멈춘다 — 실제로 그런 배포가 나갔다:
 *   [boot] 시작 실패: TypeError: this.ribbon.setSurfaceQuality is not a function
 *
 * 그래서 진짜 브라우저로 열어 콘솔 오류와 첫 화면을 확인한다.
 *
 *   npm run check:live
 *   npm run check:live -- --url http://localhost:5178
 */
import { chromium } from 'playwright-core';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const url = (arg('--url') ?? 'https://three-kingdoms-cmus.onrender.com').replace(/\/+$/, '');

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));

let failed = false;
try {
  await page.goto(`${url}/`, { waitUntil: 'load', timeout: 60000 });
  // 첫 화면(로그인)이 뜰 때까지. 부팅이 죽으면 로딩 화면이 그대로 남는다.
  await page.waitForSelector('#login-screen, #level-select', { timeout: 45000 });

  const state = await page.evaluate(() => ({
    loading: !!document.getElementById('loading'),
    menu: !!document.getElementById('login-screen') || !!document.getElementById('level-select'),
  }));
  if (state.loading || !state.menu) {
    console.error('[check:live] 첫 화면이 뜨지 않았다 (로딩에서 멈춤)');
    failed = true;
  }
} catch (err) {
  console.error(`[check:live] 첫 화면을 기다리다 실패: ${(err as Error).message.split('\n')[0]}`);
  failed = true;
}

if (errors.length > 0) {
  console.error(`[check:live] 콘솔 오류 ${errors.length}건:`);
  for (const e of errors.slice(0, 5)) console.error(`  ${e}`);
  failed = true;
}

const health = await page.evaluate(async (base) => {
  try {
    return await (await fetch(`${base}/api/health`)).json();
  } catch {
    return null;
  }
}, url);

await browser.close();

if (failed) {
  process.exitCode = 1;
} else {
  const commit = (health as { commit?: string } | null)?.commit ?? '?';
  console.log(`[check:live] ${url} 부팅 정상 — 첫 화면 표시, 콘솔 오류 없음 (배포 ${commit})`);
}
