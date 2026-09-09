/* global window, process, console */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [], report = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${process.env.REVIEW_URL ?? 'http://localhost:5178'}/?level=4&api=local`);
  await page.waitForFunction(() => !!window.game?.scene, null, { timeout: 60000 });
  await page.evaluate(() => { window.game.loop.stop(); window.game.autoTuned = true; });
  // Warm the renderer's persistent geometry caches before comparing level lifetimes.
  await page.evaluate(() => {
    for (const quality of ['high', 'medium', 'low']) { window.game.applyPreset(quality); window.game.render(1, 1 / 60); }
    window.game.restart();
  });
  for (let restart = 0; restart < 3; restart++) {
    if (restart) await page.evaluate(() => window.game.restart());
    await page.waitForFunction(() => !!window.game.scene.stage.skyTexture);
    for (const quality of ['high', 'medium', 'high', 'low']) {
      const result = await page.evaluate(quality => {
        const g = window.game; g.applyPreset(quality);
        g.render(1, 1 / 60); g.render(1, 1 / 60);
        const reflection = g.scene.terrain.group.getObjectByName('chapter-water-reflection');
        return { quality, reflection: !!reflection, reflectorVisible: reflection?.visible,
          targetRestored: g.handle.renderer.getRenderTarget() === null,
          shadowsRestored: g.handle.renderer.shadowMap.autoUpdate,
          textures: g.handle.renderer.info.memory.textures,
          geometries: g.handle.renderer.info.memory.geometries };
      }, quality);
      assert.equal(result.reflection, quality === 'high');
      if (quality === 'high') assert.equal(result.reflectorVisible, true);
      assert.ok(result.targetRestored && result.shadowsRestored);
      report.push({ restart, ...result });
    }
  }
  for (const quality of ['high', 'medium', 'low']) {
    const samples = report.filter(r => r.quality === quality);
    assert.ok(samples.at(-1).textures <= samples[0].textures, JSON.stringify(samples));
    assert.ok(samples.at(-1).geometries <= samples[0].geometries, JSON.stringify(samples));
  }
  assert.deepEqual(errors, []);
  await writeFile('artifacts/water-lifecycle-report.json', JSON.stringify(report, null, 2));
  console.log('Water reflection: visibility, render state, 12 quality transitions and 3 lifetimes passed.');
} finally { await browser.close(); }
