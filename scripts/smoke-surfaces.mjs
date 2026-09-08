/* global window, console, process */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
const report = [];
try {
  for (let level = 1; level <= 6; level++) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${process.env.REVIEW_URL ?? 'http://localhost:5178'}/?level=${level}&api=local`);
    await page.waitForFunction(() => !!window.game?.scene, null, { timeout: 60000 });
    await page.evaluate(() => { window.game.loop.stop(); window.game.autoTuned = true; });
    await page.waitForFunction(() => !!window.game.scene.stage.skyTexture);
    const result = await page.evaluate(() => {
      const g = window.game;
      g.applyPreset('high');
      g.render(1, 1 / 60);
      const { terrain } = g.scene;
      const houseKinds = [...new Set(terrain.group.children.map(o => o.userData.houseKind).filter(Boolean))];
      const treeSpecies = [...new Set(terrain.group.children.map(o => o.userData.treeSpecies).filter(Boolean))];
      const thatchMaterials = terrain.group.children.filter(o => o.name === 'settlement-thatch-3' || o.name === 'settlement-granary-3');
      const thatchLoaded = thatchMaterials.length > 0 && thatchMaterials.every(o => o.material.map && o.material.normalMap);
      const point = { x: 0, z: 0 };
      let roadDeviation = 0;
      for (let d = 0; d <= g.world.path.totalLength; d += 10) {
        g.world.path.positionAt(d, point);
        roadDeviation = Math.max(roadDeviation, Math.abs(terrain.heightAt(point.x, point.z)));
      }
      const slotDeviation = Math.max(...g.level.buildSlots.map(slot => Math.abs(terrain.heightAt(slot.x, slot.z))));
      let minimum = Infinity, maximum = -Infinity, raised = 0, samples = 0;
      for (let x = 0; x <= 1200; x += 20) for (let z = 0; z <= 700; z += 20) {
        const height = terrain.heightAt(x, z);
        minimum = Math.min(minimum, height); maximum = Math.max(maximum, height);
        if (height > 20) raised++;
        samples++;
      }
      g.world.economy.add(100000);
      const slot = g.level.buildSlots[0];
      const buildResult = g.world.build(slot, 'archer_tower');
      g.scene.render(1, 1 / 60);
      g.render(1, 1 / 60);
      return {
        roadDeviation, slotDeviation, buildResult, towers: g.world.towers.size,
        minimum, maximum, raisedFraction: raised / samples,
        houseKinds, treeSpecies, thatchLoaded,
        groundMap: !!terrain.material.map,
        normalMap: !!terrain.material.normalMap,
        roughnessMap: !!terrain.material.roughnessMap,
        detail: terrain.material.userData.groundDetail,
        cover: !!terrain.groundCover,
      };
    });
    assert.ok(result.roadDeviation < .1, JSON.stringify(result));
    assert.ok(result.slotDeviation < .1, JSON.stringify(result));
    assert.equal(result.towers, 1);
    assert.equal(result.buildResult, 'ok');
    const previousPeak = [67, 111, 69, 61, 56, 92][level - 1];
    assert.ok(result.maximum > previousPeak * 1.85 && result.maximum < previousPeak * 2.15, 'terrain relief must be approximately twice the previous chapter peak');
    assert.ok(result.raisedFraction > .06, 'raised contours occupy too little of the battlefield');
    assert.ok(result.houseKinds.length >= 3, 'not enough settlement variety');
    assert.ok(result.treeSpecies.length >= 1, 'specialized trees are missing');
    assert.equal(result.thatchLoaded, true, 'the external thatch material did not load');
    assert.ok(result.groundMap && result.normalMap && result.roughnessMap && result.detail);
    await page.screenshot({ path: `artifacts/surfaces-${level}-high.png` });
    await page.evaluate(() => { window.game.scene.stage.setZoom(.72); window.game.render(1, 1 / 60); });
    await page.screenshot({ path: `artifacts/surfaces-${level}-close.png` });
    await page.evaluate(() => { window.game.scene.stage.setZoom(1); window.game.render(1, 1 / 60); });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => { window.game.resize(); window.game.render(1, 1 / 60); });
    await page.screenshot({ path: `artifacts/surfaces-${level}-compact.png` });
    assert.deepEqual(errors, []);
    report.push({ level, ...result, errors });
    console.log(`Chapter ${level}: PBR shaders, flat road/slots, construction and compact rendering passed.`, result);
    await page.close();
  }
  assert.ok(report.some(result => result.cover), 'ground coverage shader was never exercised');
  await writeFile('artifacts/surfaces-report.json', JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
