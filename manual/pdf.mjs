/** 조판한 HTML을 A4 PDF로 굽는다. */
import { chromium } from 'playwright-core';

const URL = process.env.MANUAL_URL ?? 'http://localhost:5173/manual/manual.html';
const OUT = process.argv[2] ?? '삼국지_Last_Stand_설명서.pdf';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[error]', e.message));
page.on('requestfailed', (r) => console.log('[404]', r.url()));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 120000 });
// 웹폰트가 다 앉기 전에 인쇄하면 줄바꿈이 어긋난다.
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);

const pages = await page.evaluate(() => document.querySelectorAll('.page').length);
await page.pdf({
  path: OUT,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});
console.log(`${OUT} — ${pages}쪽`);
await browser.close();
