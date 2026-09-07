/* global process, document, window, innerWidth, innerHeight, console, getComputedStyle */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ hasTouch: true, isMobile: true });
  await page.route('**/src/main.ts*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(process.env.MOBILE_TEST_URL ?? 'http://localhost:5178');
  await page.evaluate(async () => {
    const { trackViewport } = await import('/src/ui/viewport.ts');
    trackViewport();
    const { Hud } = await import('/src/ui/Hud.ts');
    const { TowerPanel } = await import('/src/ui/TowerPanel.ts');
    const { TOWER_LIST } = await import('/src/data/towers.ts');
    const { STRATAGEM_LIST } = await import('/src/data/stratagems.ts');
    const root = document.querySelector('#hud-root');
    const cb = new Proxy({}, { get: () => () => {} });
    const hud = new Hud(root, cb, { bgmVolume: .5, sfxVolume: .5, preset: 'low', shake: false, damageNumbers: true });
    hud.setRepairAvailable(true);
    hud.setRepair('ok', { hp: 250, cost: 100 }, 0);
    hud.setCastleUpgradeAvailable(true);
    hud.setCastleUpgrade('ok', 2, { level: 3, title: '화룡구', description: '', cost: 1200 });
    hud.setStratagems(STRATAGEM_LIST);
    const panel = new TowerPanel(root, TOWER_LIST, { ...cb, onClose: () => panel.close() });
    window.mobileFixture = { hud, panel };
    document.querySelector('#rotate-notice').style.display = 'none';
  });
  for (const [width, height] of [[320,568],[375,667],[390,844],[600,960],[667,375],[740,360],[844,390],[768,673],[882,690],[960,720],[1024,768],[1440,900]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => { window.mobileFixture.panel.close(); window.mobileFixture.hud.closeOverlay(); });
    await page.waitForTimeout(100);
    const failures = await page.evaluate(() => {
      const errors = [];
      /*
       * 최소 탭 크기는 화면에 따라 다르다.
       *
       * 세로·태블릿에서는 44px 이 맞다. 그런데 **가로로 든 휴대폰**은 높이가 390px
       * 안팎뿐이라, 44px 버튼 한 줄에 상단바까지 더하면 전장이 남지 않는다.
       * 실제로 그 크기 때문에 건설 패널이 화면을 덮어 게임이 불가능했다.
       * 그 화면에서는 30px 로 줄이는 대신, 잘리지 않는 것은 그대로 요구한다.
       */
      const short = innerHeight <= 500 && innerWidth > innerHeight;
      const min = short ? 30 : 44;
      for (const b of document.querySelectorAll('.bottombar__left button, .bottombar__right button')) {
        const r = b.getBoundingClientRect();
        if (r.left < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight || r.top < 0) errors.push(`clipped: ${b.textContent}`);
        if (r.height < min || r.width < min) errors.push(`small target(${min}): ${b.textContent} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return errors;
    });
    assert.deepEqual(failures, [], `${width}x${height}`);
    await page.evaluate(() => { const p = window.mobileFixture.panel; p.place(100,150); p.showBuild('test',99999); });
    await page.waitForTimeout(50);
    const panelBox = await page.locator('.panel').boundingBox();
    assert(panelBox.y >= 0 && panelBox.y + panelBox.height <= height, `panel clipped at ${width}x${height}`);
    /*
     * 가로로 든 휴대폰에서는 건설 패널이 전장을 덮으면 안 된다.
     *
     * 예전에는 화면 가운데에 500x254 로 떠서, 아이폰 가로(844x390)에서 전장이
     * 통째로 가려졌다 — 어디에 짓는지 보이지 않는 채로 지어야 했다.
     * 지금은 왼쪽 기둥으로 세우므로 폭의 절반을 넘지 않아야 한다.
     */
    if (height <= 500 && width > height) {
      assert(panelBox.width <= width * 0.45,
        `panel covers the battlefield at ${width}x${height}: ${Math.round(panelBox.width)}px of ${width}px`);
    }
    /*
     * 건설 버튼은 스크롤하지 않고도 보여야 한다. 패널이 넘칠 때 이 줄이 아래로
     * 밀려나면 사용자 눈에는 "건설 버튼이 없는" 화면이 된다.
     */
    const build = await page.locator('.panel__actions button').first().boundingBox();
    assert(build.y >= 0 && build.y + build.height <= height + 1,
      `build button out of view at ${width}x${height}: y=${Math.round(build.y)} h=${Math.round(build.height)}`);
    await page.locator('.panel__actions button').first().click({ trial: true });
    await page.evaluate(() => { window.mobileFixture.panel.close(); window.mobileFixture.hud.showSettings(); });
    await page.getByRole('button', { name: '닫기', exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: '닫기', exact: true }).click({ trial: true });
    await page.evaluate(async () => {
      window.mobileFixture.hud.closeOverlay();
      const { Tower } = await import('/src/sim/Tower.ts');
      const { TOWER_LIST } = await import('/src/data/towers.ts');
      window.mobileFixture.panel.showTower(new Tower('test', TOWER_LIST[0], 0, 0), 99999);
    });
    await page.locator('.panel__close').click();
    assert.equal(await page.locator('.panel').isVisible(), false);
    for (const screen of ['pause', 'win', 'lose']) {
      await page.evaluate(screen => {
        const hud = window.mobileFixture.hud;
        if (screen === 'pause') hud.showPause();
        else hud.showResult(screen === 'win', { stars: 3, kills: 100, leaks: 2, castleHp: 999, castleMaxHp: 1000, castleLevel: 3, goldLeft: 9999, elapsed: 300, wavesCleared: 10 }, '다음 전장');
      }, screen);
      for (const button of await page.locator('.overlay:not(#rotate-notice) .overlay__actions button:not(:disabled)').all()) {
        await button.scrollIntoViewIfNeeded();
        await button.click({ trial: true });
      }
    }    console.log(`PASS ${width}x${height}: controls, build/upgrade, settings, pause, results`);
  }
  // Simulate browser chrome reducing only the visual viewport after unfolding.
  await page.setViewportSize({ width: 882, height: 690 });
  await page.evaluate(async () => {
    window.mobileFixture.hud.closeOverlay();
    const { trackViewport } = await import('/src/ui/viewport.ts');
    const viewport = new window.EventTarget();
    Object.assign(viewport, { width: 882, height: 590, offsetTop: 0, offsetLeft: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.mobileFixture.stopViewport = trackViewport();
  });
  for (const height of [590, 540, 690]) {
    await page.evaluate(height => {
      window.visualViewport.height = height;
      window.visualViewport.dispatchEvent(new window.Event('resize'));
    }, height);
    await page.waitForTimeout(100);
    const bounds = await page.evaluate(() => ({
      app: document.querySelector('#app').getBoundingClientRect().bottom,
      buttons: [...document.querySelectorAll('.bottombar__left button, .bottombar__right button')]
        .map(button => button.getBoundingClientRect().bottom),
    }));
    assert.equal(bounds.app, height);
    assert(bounds.buttons.every(bottom => bottom <= height - 10), `Fold controls clipped at visual height ${height}`);
    console.log(`PASS Fold visual viewport 882x${height}`);
  }
  await page.evaluate(() => {
    window.mobileFixture.stopViewport();
    delete window.visualViewport;
    window.dispatchEvent(new window.Event('resize'));
  });
  await page.evaluate(async () => {
    window.mobileFixture.hud.closeOverlay();
    const { LevelSelect } = await import('/src/ui/LevelSelect.ts');
    const { LoginScreen } = await import('/src/ui/LoginScreen.ts');
    const root = document.querySelector('#hud-root');
    window.mobileFixture.menu = new LevelSelect(root, () => {});
    window.mobileFixture.menu.setAccount({ displayName: 'abcdefghijklmnop', onLogout: () => {} });
    window.mobileFixture.login = new LoginScreen(root, {});
  });
  for (const [width, height] of [[320,568],[390,844],[667,375],[844,390]]) {
    await page.setViewportSize({ width, height });
    for (const screen of ['menu', 'login']) {
      await page.evaluate(screen => { window.mobileFixture.menu.close(); window.mobileFixture.login.close(); void window.mobileFixture[screen].open(); }, screen);
      const container = page.locator('.main-menu');
      const horizontalOverflow = await container.evaluate(el => el.scrollWidth > el.clientWidth);
      assert(!horizontalOverflow, `${screen} overflow at ${width}x${height}`);
      const target = screen === 'login' ? page.locator('button[type="submit"]') : page.locator('.levelcard:not(:disabled)').first();
      await target.scrollIntoViewIfNeeded();
      await target.click({ trial: true });
      if (screen === 'login') {
        assert.equal(await page.locator('#login-id').evaluate(el => getComputedStyle(el).fontSize), '16px');
      }
      console.log(`PASS ${width}x${height}: ${screen} scrolling and controls`);
    }
  }
  if (process.env.MOBILE_TEST_SHOT) await page.screenshot({ path: process.env.MOBILE_TEST_SHOT });
} finally { await browser.close(); }


