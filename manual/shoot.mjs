/** 설명서용 인물·타워 사진을 굽는다. */
import { chromium } from 'playwright-core';
/* global console, window, process */
import { mkdirSync, readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('manual/data.json', 'utf8'));
mkdirSync('manual/img', { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 720 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[error]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto('http://localhost:5173/manual/portrait.html');
await page.waitForFunction(() => window.ready, null, { timeout: 120000 });

const canvas = await page.$('canvas');
const shot = (path) => canvas.screenshot({ path, omitBackground: true });

for (const u of data.units) {
  await page.evaluate(([id]) => window.shotUnit(id), [u.id]);
  await shot(`manual/img/unit-${u.id}.png`);
  process.stdout.write(`.`);
}
console.log(' units done');

for (const t of data.towers) {
  for (const level of [1, 3, 5]) {
    await page.evaluate(([id, lv]) => window.shotTower(id, lv), [t.id, level]);
    await shot(`manual/img/tower-${t.id}-${level}.png`);
    process.stdout.write('.');
  }
}
console.log(' towers done');

for (const c of data.castle) {
  await page.evaluate(([lv]) => window.shotCastle(lv), [c.level]);
  await shot(`manual/img/castle-${c.level}.png`);
  process.stdout.write('.');
}
console.log(' castle done');
await browser.close();
