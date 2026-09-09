/* global window, process, console */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
const report = [];
try {
  for (const level of (process.env.REVIEW_LEVELS ?? '1,2,3,4,5,6').split(',')) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${process.env.REVIEW_URL ?? 'http://localhost:5178'}/?level=${level}&api=local`);
    await page.waitForFunction(() => !!window.game?.scene, null, { timeout: 60000 });
    await page.waitForFunction(() => !!window.game.scene.stage.skyTexture);
    await page.evaluate(() => { window.game.loop.stop(); window.game.autoTuned = true; });
    for (const quality of (process.env.REVIEW_QUALITY ?? 'high,medium,low').split(',')) {
      const metrics = await page.evaluate(quality => {
        const g = window.game;
        g.applyPreset(quality); g.render(1, 1 / 60);
        const vegetation = g.scene.terrain.group.children.filter(o => o.userData.vegetationModel && o.count > 0);
        if (!vegetation.length || !g.assets.getModel('scenery_pine_sapling_small')) throw new Error('Authored vegetation failed to load');
        return { calls: g.handle.renderer.info.render.calls, triangles: g.handle.renderer.info.render.triangles,
          textures: g.handle.renderer.info.memory.textures,
          vegetationModels: [...new Set(vegetation.map(o => o.userData.vegetationModel))] };
      }, quality);
      await page.screenshot({ path: `artifacts/landscape-${process.env.REVIEW_TAG ?? 'after'}-${level}-${quality}.png` });
      report.push({ level, quality, ...metrics, errors: [...errors] });
      if (quality === 'high') {
        await page.evaluate(() => { window.game.scene.stage.setZoom(.68); window.game.render(1, 1 / 60); });
        await page.screenshot({ path: `artifacts/landscape-${process.env.REVIEW_TAG ?? 'after'}-${level}-close.png` });
        await page.evaluate(() => { window.game.scene.stage.setZoom(1); window.game.render(1, 1 / 60); });
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Chapter ${level}: shaders rendered without browser errors`);
    await page.close();
  }
  await writeFile(`artifacts/landscape-${process.env.REVIEW_TAG ?? 'after'}-report.json`, JSON.stringify(report, null, 2));
} finally { await browser.close(); }
