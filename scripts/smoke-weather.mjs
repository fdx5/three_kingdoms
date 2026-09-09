/* global window, console, process, performance */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
const report = [];
try {
  for (const level of (process.env.WEATHER_LEVELS ?? '5,3,4,2,6,1').split(',')) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${process.env.REVIEW_URL ?? 'http://localhost:5178'}/?level=${level}&api=local`);
    await page.waitForFunction(() => !!window.game?.scene?.stage.skyTexture, null, { timeout: 60000 });
    await page.evaluate(() => {
      const g = window.game; g.loop.stop(); g.autoTuned = true;
      for (let i = 0; i < 12; i++) g.world.spawnEnemy({ unitId: 'yt_infantry', hpMul: 1, speedMul: 1 });
      g.world.enemies.forEach((e, i) => { e.prevDistance = e.distance = 120 + i * 100; e.hp *= .7; });
    });
    const snapshots = [];
    for (let pass = 0; pass < 2; pass++) for (const quality of ['high', 'medium', 'low']) {
      const result = await page.evaluate(({ quality, pass }) => {
        const g = window.game, w = g.scene.weather, renderer = g.handle.renderer;
        g.applyPreset(quality);
        for (let i = 0; i < 30; i++) g.render(1, 1 / 30);
        const calls = renderer.info.render.calls;
        w.group.visible = false; g.render(1, 0);
        const without = renderer.info.render.calls;
        w.group.visible = true; g.render(1, 0);
        let timing;
        if (quality === 'low' && pass === 1) {
          const samples = [[], []], gl = renderer.getContext();
          for (let i = 0; i < 24; i++) {
            w.group.visible = i % 2 === 0;
            const start = performance.now(); g.render(1, 1 / 60); gl.finish();
            samples[i % 2].push(performance.now() - start);
          }
          const median = a => a.sort((a, b) => a - b)[Math.floor(a.length / 2)];
          timing = { weatherMs: median(samples[0]), hiddenMs: median(samples[1]) };
          w.group.visible = true;
        }
        return { quality, calls, extraCalls: calls - without, count: w.mesh?.count ?? 0,
          textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, timing };
      }, { quality, pass });
      assert.equal(result.extraCalls, quality === 'low' ? 0 : 1);
      if (quality === 'low') assert.equal(result.count, 0);
      if (pass) {
        const previous = snapshots.find(s => s.quality === quality);
        assert.equal(result.textures, previous.textures, 'weather texture leak');
        assert.equal(result.geometries, previous.geometries, 'weather geometry leak');
      } else await page.screenshot({ path: `artifacts/weather-${level}-${quality}.png` });
      snapshots.push(result);
    }
    if (level === '5') {
      const eventCheck = await page.evaluate(() => {
        const g = window.game, w = g.scene.weather;
        g.applyPreset('high'); let thunder = 0, flashes = 0;
        w.onThunder = () => thunder++;
        for (let index = 1; index <= g.level.waves.length; index++) {
          w.waveStarted(index, g.level.waves.length);
          if (w.flash > 0) flashes++;
          w.update(.01);
          if (w.flash > 0) g.render(1, 0);
          for (let i = 0; i < 20; i++) w.update(.1);
        }
        for (let index = 1; index <= g.level.waves.length; index++) w.waveStarted(index, g.level.waves.length);
        return { flashes, thunder, duplicate: w.flash };
      });
      assert.deepEqual(eventCheck, { flashes: 4, thunder: 4, duplicate: 0 });
    }
    if (level === '4') {
      const dawn = await page.evaluate(() => {
        const g = window.game, w = g.scene.weather;
        g.applyPreset('high');
        const early = g.scene.stage.scene.fog.far;
        w.waveStarted(g.level.waves.length, g.level.waves.length);
        for (let i = 0; i < 200; i++) w.update(.1);
        g.render(1, 0);
        return { early, late: g.scene.stage.scene.fog.far, clearing: w.clearing.value };
      });
      assert.ok(dawn.late > dawn.early && dawn.clearing > .99);
      await page.screenshot({ path: 'artifacts/weather-4-cleared.png' });
    }
    assert.deepEqual(errors, []);
    report.push({ level, snapshots });
    console.log(`Chapter ${level}: 3 presets, resource lifetime, batching, low timing passed`);
    await page.close();
  }
  await writeFile(`artifacts/weather-report-${process.env.WEATHER_LEVELS ?? 'all'}.json`, JSON.stringify(report, null, 2));
} finally { await browser.close(); }
