/* global window, console, process */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${process.env.REVIEW_URL ?? 'http://localhost:5178'}/?level=6&api=local`);
  await page.waitForFunction(() => !!window.game?.scene, null, { timeout: 60000 });
  await page.evaluate(() => { window.game.loop.stop(); window.game.applyPreset('medium'); });
  const snapshots = [];
  for (let pass = 0; pass < 3; pass++) {
    if (pass) await page.evaluate(() => window.game.restart());
    // Let the panorama finish loading before comparing GPU texture counts.
    await page.waitForFunction(() => !!window.game.scene.stage.skyTexture);
    const result = await page.evaluate(() => {
      const g = window.game;
      const { world, scene } = g;
      for (let i = 0; i < 48; i++) world.spawnEnemy({ unitId: i % 12 === 0 ? 'zhugeliang' : 'yt_infantry', hpMul: 1, speedMul: 1 });
      world.enemies.forEach((e, i) => { e.prevDistance = e.distance = 50 + i * 17; });
      for (let i = 0; i < 12; i++) { world.step(1 / 60); scene.render(1, 1 / 60); }
      for (const e of world.enemies) scene.enemyViews.get(e.id).ignite(scene.groundFireAssets);
      scene.particles.emit('ground_smoke', 600, 15, 300, 3);
      scene.render(1, .2);
      g.handle.renderer.render(scene.stage.scene, scene.stage.camera);
      const view = scene.enemyViews.values().next().value;
      const time = view.mixer.time;
      g.loop.setPaused(true);
      g.render(1, .1);
      const frozen = Math.abs(view.mixer.time - time) < 1e-9;
      g.loop.setPaused(false); g.loop.setSpeed(3);
      g.render(1, .1);
      const accelerated = view.mixer.time - time > .15;
      // Put allocated skeletons and burn views into the free pool before restart.
      for (const e of [...world.enemies]) {
        const v = scene.enemyViews.get(e.id);
        scene.enemyViews.delete(e.id);
        scene.releaseEnemyView(e.defId, v);
      }
      g.handle.renderer.render(scene.stage.scene, scene.stage.camera);
      return { frozen, accelerated, ...g.handle.renderer.info.memory, draws: g.handle.renderer.info.render.calls };
    });
    assert.equal(result.frozen, true, 'paused skeleton continued animating');
    assert.equal(result.accelerated, true, '3x speed did not accelerate animation');
    snapshots.push(result);
  }
  assert.ok(snapshots[2].textures <= snapshots[0].textures + 2, JSON.stringify(snapshots));
  assert.ok(snapshots[2].geometries <= snapshots[0].geometries + 2, JSON.stringify(snapshots));
  assert.deepEqual(errors, []);
  console.log('Quality smoke: pause, 3x animation, particle shaders, pooled GPU resource cleanup', snapshots);
} finally { await browser.close(); }
