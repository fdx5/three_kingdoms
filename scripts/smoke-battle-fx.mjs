/* global window, console, process */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${process.env.REVIEW_URL ?? 'http://localhost:5178'}/?level=6&api=local`);
  await page.waitForFunction(() => !!window.game?.scene, null, { timeout: 60000 });
  await page.evaluate(() => { window.game.loop.stop(); window.game.autoTuned = true; });
  await page.waitForFunction(() => !!window.game.scene.stage.skyTexture);
  await page.evaluate(() => {
    const g = window.game;
    g.applyPreset('high');
    g.world.economy.add(100000);
    const types = ['archer_tower', 'catapult', 'cannon_tower', 'fire_tower'];
    g.level.buildSlots.forEach((slot, i) => {
      g.world.build(slot.id, types[i % types.length]);
      for (let j = 0; j < 3; j++) g.world.upgrade(slot.id);
    });
    for (let i = 0; i < 56; i++) {
      g.world.spawnEnemy({ unitId: 'yt_infantry', hpMul: 30, speedMul: 1 });
      const enemy = g.world.enemies[g.world.enemies.length - 1];
      enemy.distance = enemy.prevDistance = 80 + i * 30;
    }
    for (let i = 0; i < 80; i++) { g.world.step(1 / 60); g.scene.render(1, 1 / 60); }
    g.scene.stage.setZoom(0.75);
    g.scene.impacts.emit(450, 2, 420, 75, true);
    g.scene.impacts.emit(240, 2, 320, 65, false);
    g.scene.particles.emit('weapon_spark', 450, 12, 420, 2);
    g.scene.impacts.update(.12);
    g.scene.particles.update(.08);
    g.loop.setPaused(true);
    g.render(1, 1 / 60);
  });
  await page.screenshot({ path: 'artifacts/battle-fx-high.png' });
  const samples = [];
  for (const preset of ['medium', 'high', 'medium', 'high', 'low', 'high', 'medium']) {
    samples.push(await page.evaluate(preset => {
      const g = window.game;
      g.applyPreset(preset);
      g.render(1, 1 / 60);
      const r = g.handle.renderer;
      return { preset, ...r.info.memory, calls: r.info.render.calls, points: r.info.render.points };
    }, preset));
  }
  const mediums = samples.filter(s => s.preset === 'medium');
  assert.equal(mediums.at(-1).textures, mediums[0].textures, JSON.stringify(samples));
  assert.equal(mediums.at(-1).geometries, mediums[0].geometries, JSON.stringify(samples));
  const highs = samples.filter(s => s.preset === 'high');
  assert.equal(highs.at(-1).textures, highs[0].textures, JSON.stringify(samples));
  const adaptive = await page.evaluate(() => {
    const g = window.game;
    g.applyPreset('high');
    g.loop.setPaused(false);
    g.qualityCooldown = 0;
    for (let i = 0; i < 180; i++) g.updateFps(1 / 30);
    const downgraded = g.preset;
    g.applyPreset('high');
    g.qualityCooldown = 0;
    g.loop.setPaused(true);
    for (let i = 0; i < 200; i++) g.updateFps(1 / 30);
    return { downgraded, paused: g.preset };
  });
  assert.equal(adaptive.downgraded, 'medium');
  assert.equal(adaptive.paused, 'high');
  for (const [width, height] of [[844, 390], [390, 844], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => { window.game.resize(); window.game.render(1, 1 / 60); });
  }
  await page.screenshot({ path: 'artifacts/battle-fx-wide.png' });
  assert.deepEqual(errors, []);
  await writeFile('artifacts/battle-fx-report.json', JSON.stringify({ samples, adaptive, errors }, null, 2));
  console.log('Battle FX: HDR shaders, instanced impacts, preset GPU cleanup, resize and adaptive quality passed.', samples);
} finally {
  await browser.close();
}
