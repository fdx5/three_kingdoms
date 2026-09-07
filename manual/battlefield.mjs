/**
 * 장마다 실제 전장 한 장면을 찍는다.
 * ?level=N 은 로그인·장 선택을 건너뛰는 개발 경로다 (main.ts의 forcedLevelId).
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

mkdirSync('manual/img', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] });

for (const n of [1, 2, 3, 4, 5, 6]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log('[error]', e.message));
  await page.goto(`http://localhost:5173/?level=${n}`);
  await page.waitForFunction(() => window.game?.world, null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  // 골드를 넉넉히 주고 모든 슬롯을 세워 4단계까지 올린다 — 설명서에 빈 전장을 실을 수는 없다.
  await page.evaluate(() => {
    const g = window.game;
    g.world.economy.add(999999);
    for (const s of g.world.level.buildSlots) {
      g.world.build(s.id);
      for (let i = 0; i < 3; i++) g.world.upgrade(s.id);
    }
  });
  // 웨이브가 한창일 때를 잡는다.
  await page.evaluate(() => { window.game.world.callWaveEarly(); });
  await page.waitForFunction(() => window.game.world.liveEnemyCount > 6, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.game.setPaused(true, false));
  await page.waitForTimeout(400);
  // HUD를 걷어낸 순수한 전장 (설명서 지면에서는 UI가 방해된다)
  await page.evaluate(() => {
    document.getElementById('hud-root').style.opacity = '0';
    document.getElementById('backend-label')?.remove();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `manual/img/field-${n}.png` });

  // 5장은 HUD를 켠 채로도 한 장 — 화면 보는 법에 쓴다.
  if (n === 3) {
    await page.evaluate(() => { document.getElementById('hud-root').style.opacity = '1'; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'manual/img/hud-overview.png' });
  }
  console.log(`field ${n} ok`);
  await page.close();
}
await browser.close();
