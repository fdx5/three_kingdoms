import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
mkdirSync('manual/preview', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 800, height: 1120 } });
page.on('pageerror', (e) => console.log('[error]', e.message));
page.on('requestfailed', (r) => console.log('[404]', r.url().split('/').pop()));
await page.goto('http://localhost:5173/manual/manual.html', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1000);
const els = await page.$$('.page');
const want = process.argv.slice(2).map(Number);
for (const i of want) {
  await els[i - 1].screenshot({ path: `manual/preview/p${String(i).padStart(2, '0')}.png` });
}
console.log(`총 ${els.length}쪽`);
await browser.close();
