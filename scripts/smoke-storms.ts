import { chromium } from 'playwright-core';
import type { World } from '../src/sim/World';
import type { GameScene } from '../src/view/GameScene';
import type { Loop } from '../src/core/Loop';

declare global {
  interface Window { game: { world: World; scene: GameScene; loop: Loop } }
}
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--disable-gpu-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text()); });
  await page.goto('http://localhost:5178/?level=2&debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.game?.world, { timeout: 60000 });
  await page.evaluate(() => {
    const g = window.game;
    g.loop.setPaused(true);
    g.world.economy.add(10000); g.world.callWaveEarly();
    for (let i = 0; i < 1200 && g.world.enemies.length < 18; i++) g.world.step(1 / 60);
    g.world.enemies.forEach((e, i) => {
      e.hp = e.maxHp = 10000;
      e.distance = e.prevDistance = 50 + i * 105;
      const p = { x: 0, z: 0 }; g.world.path.positionAt(e.distance, p);
      e.worldX = p.x; e.worldZ = p.z;
    });
    g.scene.render(1, 0);
  });
  await page.locator('.stratcard', { hasText: '화공' }).click();
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.querySelector('.storm-title')?.getAnimations().forEach(a => { a.pause(); a.currentTime = 650; });
  });
  await page.screenshot({ path: 'artifacts/storm-fire-title.png' });
  await page.evaluate(() => {
    document.querySelector('.storm-title')?.getAnimations().forEach(a => a.cancel());
    for (let i = 0; i < 120; i++) window.game.world.step(1 / 60);
  });
  await page.screenshot({ path: 'artifacts/storm-fire-rain.png' });
  await page.locator('.stratcard', { hasText: '얼음폭풍' }).click();
  const status = await page.evaluate(() => {
    document.querySelector('.storm-title')?.getAnimations().forEach(a => a.cancel());
    const w = window.game.world;
    for (let i = 0; i < 30; i++) w.step(1 / 60);
    return { fire: w.fireStormRemaining, ice: w.iceStormRemaining, frozen: w.enemies.every(e => e.effectiveSpeed === 0) };
  });
  await page.screenshot({ path: 'artifacts/storm-ice.png' });
  if (!status.frozen || status.fire <= 0 || status.ice <= 0) throw new Error(JSON.stringify(status));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Storm UI, simultaneous effects, frozen units and renderer passed.', status);
} finally { await browser.close(); }
