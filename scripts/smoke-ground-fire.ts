import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import type { GroundFireView } from '../src/view/views/GroundFireView';

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--disable-gpu-sandbox'] });
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text()); });
  await page.goto('http://localhost:5178/?level=2&debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.game?.world, { timeout: 60000 });
  const state = await page.evaluate(() => {
    const { world, scene, loop } = window.game;
    loop.setPaused(true);
    const sources = ['arrow', 'stone', 'shell', 'flame'] as const;
    sources.forEach((source, i) => {
      const p = { x: 0, z: 0 };
      world.path.positionAt(world.path.totalLength * (.24 + i * .13), p);
      world.bus.emit('fire-zone:created', { zoneId: 9000 + i, worldPos: { ...p, y: 0 }, radius: 26 + i * 4, duration: 3, source });
    });
    for (let i = 0; i < 40; i++) scene.render(1, 1 / 60);
    const views = [...(scene as unknown as { groundFireViews: Map<number, GroundFireView> }).groundFireViews.values()];
    return { active: views.length, visible: views.every(v => v.object3d.parent && v.object3d.children.length > 0) };
  });
  if (state.active !== 4 || !state.visible) throw new Error(JSON.stringify(state));
  await page.screenshot({ path: 'artifacts/ground-fire-burning.png' });
  const cooling = await page.evaluate(() => {
    const { world, scene } = window.game;
    for (let i = 0; i < 4; i++) world.bus.emit('fire-zone:removed', { zoneId: 9000 + i });
    for (let i = 0; i < 50; i++) scene.render(1, 1 / 60);
    const s = scene as unknown as { groundFireViews: Map<number, GroundFireView>; coolingFireViews: GroundFireView[] };
    return { active: s.groundFireViews.size, cooling: s.coolingFireViews.length, attached: s.coolingFireViews.every(v => !!v.object3d.parent) };
  });
  if (cooling.active !== 0 || cooling.cooling !== 4 || !cooling.attached) throw new Error(JSON.stringify(cooling));
  await page.screenshot({ path: 'artifacts/ground-fire-cooling.png' });
  const remaining = await page.evaluate(() => {
    for (let i = 0; i < 150; i++) window.game.scene.render(1, 1 / 60);
    return (window.game.scene as unknown as { coolingFireViews: GroundFireView[] }).coolingFireViews.length;
  });
  if (remaining !== 0) throw new Error('Expired fire residues were not released');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Four fire styles rendered; extinguishing retained residues; expired residues released; no renderer errors.');
} finally { await browser.close(); }
