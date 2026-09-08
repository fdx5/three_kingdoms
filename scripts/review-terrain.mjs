/* global window, console, process */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const tag = process.env.REVIEW_TAG ?? 'terrain';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    // Chromium may deny the optional CPU pressure observer; unrelated to rendering.
    if (m.type() === 'error' && !m.text().includes('Permissions policy violation: compute-pressure')) errors.push(m.text());
  });
  const report = [];
  for (const level of (process.env.REVIEW_LEVELS ?? '1,4,6').split(',')) {
    await page.goto(`http://127.0.0.1:5178/?level=${level}&api=local`);
    await page.waitForFunction(() => !!window.game?.scene?.stage?.skyTexture, null, { timeout: 90000 });
    await page.evaluate(() => window.game.loop.stop());
    for (const preset of ['high', 'low']) {
      const stats = await page.evaluate(preset => {
        const g = window.game;
        g.applyPreset(preset);
        g.handle.renderer.setPixelRatio(1);
        g.scene.stage.resetView();
        g.scene.stage.update(0);
        g.handle.renderer.info.reset();
        g.render(1, 0);
        return { ...g.handle.renderer.info.render, ...g.handle.renderer.info.memory };
      }, preset);
      await page.screenshot({ path: `artifacts/${tag}-${level}-${preset}.png` });
      report.push({ level, preset, ...stats });
    }
    await page.evaluate(() => {
      const g = window.game;
      g.applyPreset('high');
      g.scene.stage.rotate(.35, -.18);
      g.scene.stage.setZoom(1.25);
      g.scene.stage.update(0);
      g.render(1, 0);
    });
    await page.screenshot({ path: `artifacts/${tag}-${level}-orbit.png` });
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    const g = window.game;
    g.applyPreset('low');
    g.scene.stage.resetView();
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => window.game.render(1, 0));
  await page.screenshot({ path: `artifacts/${tag}-mobile.png` });
  assert.deepEqual(errors, []);
  await writeFile(`artifacts/${tag}-metrics.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
