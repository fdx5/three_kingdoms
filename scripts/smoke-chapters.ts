import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--disable-gpu-sandbox'] });
try {
  await mkdir('artifacts', { recursive: true });
  for (const level of [4, 5, 6]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://localhost:5178/?level=${level}&debug=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.game?.scene, { timeout: 60000 });
    const result = await page.evaluate(() => {
      const { world, scene, loop } = window.game;
      loop.setPaused(true);
      scene.render(1, .1);
      const chapter = scene.terrain.group.children.find(o => o.name.startsWith('landscape-'));
      const p = { x: 0, z: 0 };
      let deviation = 0;
      for (let d = 0; d < world.path.totalLength; d += 10) {
        world.path.positionAt(d, p); deviation = Math.max(deviation, Math.abs(scene.terrain.heightAt(p.x, p.z)));
      }
      return { theme: chapter?.name, objects: chapter?.children.length, deviation, slots: world.level.buildSlots.length };
    });
    if (!result.theme || !result.objects || result.deviation > .1) throw new Error(JSON.stringify(result));
    await page.screenshot({ path: `artifacts/chapter-${level}-landscape.png` });
    await page.keyboard.press('1');
    await page.locator('.panel button', { hasText: '건설' }).click();
    const towers = await page.evaluate(() => window.game.world.towers.size);
    if (towers !== 1) throw new Error(`Chapter ${level}: cannot build tower`);
    await page.setViewportSize({ width: 900, height: 600 });
    await page.screenshot({ path: `artifacts/chapter-${level}-compact.png` });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Chapter ${level}:`, result, 'rendered, road level, tower built, no browser errors');
    await page.close();
  }
} finally { await browser.close(); }
