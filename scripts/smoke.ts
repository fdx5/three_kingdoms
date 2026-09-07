/**
 * 브라우저 스모크 테스트.
 * 설치된 Chrome을 헤드리스로 띄워 실제 렌더 경로를 한 번 돌린다.
 * "빌드는 되는데 켜면 흰 화면" 같은 사고를 잡기 위한 최소 확인이다.
 *
 *   npm run smoke              (dev 서버가 5178에 떠 있어야 한다)
 *   npm run smoke -- --url http://localhost:5173
 *   npm run smoke -- --only 2  (그 장만)
 *
 * 세 판을 돈다.
 *   1장 — 레벨 선택 화면 -> 궁노 건설 -> 업그레이드 -> 전투 -> 세로 모드 (+ 보병 GLTF 모델)
 *   2장 — ?level=2 직행 -> 타워 3종 선택 -> 벽력거/철질려 건설 -> 감속·수리·계략 확인
 *   3장 — ?level=3 직행 -> 경제(조기 소집 계수)와 화공·얼음폭풍 해금 확인
 * 장마다 새로 생긴 렌더 경로가 있어서, 앞 장만 돌면 그 경로는 한 번도 실행되지 않는다.
 */
import { BALANCE } from '../src/data/balance';
import { chromium, type ConsoleMessage, type Page, type Browser } from 'playwright-core';

const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const BASE = (arg('--url') ?? 'http://localhost:5178').replace(/\/+$/, '');
const SHOT = arg('--shot');
const ONLY = arg('--only');

interface Snapshot {
  backend: string;
  gold: string;
  castle: string;
  wave: string;
  enemies: number;
  towers: number;
  projectiles: number;
  drawCalls: number;
  triangles: number;
  canvasW: number;
  canvasH: number;
  hudButtons: number;
}

function fail(msg: string): never {
  throw new Error(msg);
}

/** 페이지 안의 게임 상태와 HUD 텍스트를 한 번에 긁어온다 */
function snap(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const g = (window as unknown as { game: unknown }).game as {
      handle: { backend: string; renderer: { info: { render: { calls: number; triangles: number } } } };
      world: { enemies: unknown[]; towers: Map<string, unknown>; projectiles: unknown[] };
    };
    const canvas = document.querySelector('#canvas-container canvas') as HTMLCanvasElement;
    return {
      backend: g.handle.backend,
      gold: document.querySelector('#gold-chip .chip__value')?.textContent ?? '',
      castle: document.querySelector('#castle-chip .chip__value')?.textContent ?? '',
      wave: document.querySelector('#wave-chip .chip__value')?.textContent ?? '',
      enemies: g.world.enemies.length,
      towers: g.world.towers.size,
      projectiles: g.world.projectiles.length,
      drawCalls: g.handle.renderer.info.render.calls,
      triangles: g.handle.renderer.info.render.triangles,
      canvasW: canvas?.width ?? 0,
      canvasH: canvas?.height ?? 0,
      hudButtons: document.querySelectorAll('#hud-root button').length,
    };
  });
}

/** 로딩 화면이 사라질 때까지 */
/**
 * 발끝 높이를 재는 브라우저 코드 조각 — 스킨드 메시에서 **무기 뼈를 뺀** 최저점.
 *
 * 무기를 빼는 이유: 접지는 발 기준으로 굽는다(rig-model 이 봉을 빼고 잰다).
 * 손에서 비스듬히 내려온 날은 지면을 스치는 것이 정상이라, 통째로 재면
 * "모델이 파묻혔다"로 잘못 잡힌다 — 실제로 화웅의 아래 날이 그랬다(-2.2u).
 */
const FOOT_LOW = `function (view, stride) {
  var sk = null;
  view.object3d.updateMatrixWorld(true);
  view.object3d.traverse(function (o) { if (o.isSkinnedMesh) sk = o; });
  if (!sk) return null;
  var weapon = -1;
  var bones = sk.skeleton ? sk.skeleton.bones : [];
  for (var b = 0; b < bones.length; b++) if (bones[b].name === 'weapon') weapon = b;
  var si = sk.geometry.attributes.skinIndex;
  var tmp = view.object3d.position.clone();
  var n = sk.geometry.attributes.position.count;
  var lo = Infinity;
  for (var k = 0; k < n; k += stride) {
    if (weapon >= 0 && si && si.getX(k) === weapon) continue;
    var p = sk.getVertexPosition(k, tmp);
    var m = sk.matrixWorld.elements;
    var wy = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
    if (wy < lo) lo = wy;
  }
  return lo === Infinity ? null : lo - view.object3d.position.y;
}`;


async function boot(page: Page, url: string): Promise<void> {
  // Smoke accounts must stay local, including when checking a deployed build.
  const localUrl = new URL(url);
  localUrl.searchParams.set('api', 'local');
  await page.goto(localUrl.href, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 20000 });
}

/** 지금 살아 있는 적 중 감속이 걸린 수 */
function slowedCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (window as unknown as { game: { world: { enemies: { slowTimer: number }[] } } }).game;
    return g.world.enemies.filter((e) => e.slowTimer > 0).length;
  });
}

function kills(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { game: { world: { kills: number } } }).game.world.kills,
  );
}

// ── 제 1장 ────────────────────────────────────────────────────────────

async function level1Pass(page: Page): Promise<void> {
  console.log('\n=== 제 1장 (황건적의 난) ===');
  await boot(page, `${BASE}/?debug=1`);

  // A fresh browser context starts at login before campaign selection.
  await page.locator('#login-id').fill('smoke_player');
  await page.locator('#login-password').fill('smoke-test-password');
  await page.locator('#login-screen button[type="submit"]').click();

  // 레벨 선택 화면에서 첫 장을 고른다
  await page.waitForSelector('#level-select', { timeout: 10000 });
  await page.locator('.levelcard').first().click();
  await page.waitForTimeout(600);
  console.log('[ok] 레벨 선택 -> 제 1장 시작');

  await page.evaluate('window.game.setPaused(true, false)');
  const initial = await snap(page);
  console.log('\n[초기 상태]');
  console.table(initial);

  if (initial.canvasW === 0) fail('캔버스 크기가 0이다 — 렌더러가 붙지 않았다');
  if (initial.drawCalls === 0) fail('드로우콜이 0이다 — 아무것도 그려지지 않았다');
  if (initial.gold !== '250') fail(`시작 골드가 250이 아니다: ${initial.gold}`);
  if (initial.castle !== '1000') fail(`시작 성 체력이 1000이 아니다: ${initial.castle}`);
  if (initial.hudButtons < 6) fail(`HUD 버튼이 너무 적다: ${initial.hudButtons}`);

  // 레벨 1에는 지을 수 있는 타워가 궁노 하나뿐이라 선택 행이 없어야 한다
  await page.keyboard.press('1');
  await page.waitForTimeout(200);
  const panel = await page.evaluate(() => {
    const p = document.querySelector('.panel') as HTMLElement | null;
    return {
      visible: !!p && p.style.display !== 'none',
      hasArcher: !!p && p.textContent!.includes('궁노 망루'),
      picks: document.querySelectorAll('.towerpick button').length,
    };
  });
  if (!panel.visible || !panel.hasArcher) fail('슬롯 선택 후 건설 패널이 뜨지 않았다');
  if (panel.picks !== 0) fail(`레벨 1에 타워 선택 행이 떴다 (${panel.picks}종) — 해금 필터가 새고 있다`);
  console.log('[ok] 슬롯 선택 -> 건설 패널 표시 (타워 1종, 선택 행 없음)');

  // 보병 GLTF 모델이 실제로 붙었는지 — 프리미티브로 조용히 폴백하면 여기서 잡힌다
  const models = await page.evaluate(`(function () {
    var g = window.game;
    return ['yt_infantry', 'yt_captain', 'zhangjiao'].map(function (id) {
      var m = g.assets.getModel(id);
      var skinned = 0, bones = 0, clips = [];
      if (m) {
        m.scene.traverse(function (o) { if (o.isSkinnedMesh) skinned++; if (o.isBone) bones++; });
        clips = m.animations.map(function (a) { return a.name; });
      }
      return { id: id, loaded: !!m, skinned: skinned, bones: bones, clips: clips };
    });
  })()`) as { id: string; loaded: boolean; skinned: number; bones: number; clips: string[] }[];
  for (const model of models) {
    if (!model.loaded) fail(`"${model.id}" 모델이 로드되지 않았다 (manifest / 파일 확인)`);
    if (model.skinned === 0 || model.bones === 0) fail(`"${model.id}" 에 스킨/뼈대가 없다: ${JSON.stringify(model)}`);
    for (const need of ['idle', 'walk', 'attack']) {
      if (!model.clips.includes(need)) fail(`"${model.id}" 에 "${need}" 클립이 없다: ${JSON.stringify(model.clips)}`);
    }
    console.log(`[ok] ${model.id} 모델 — 뼈 ${model.bones}개, 클립 ${model.clips.join('/')}`);
  }

  await page.locator('.panel button', { hasText: '건설' }).click();
  await page.waitForTimeout(300);
  const afterBuild = await snap(page);
  if (afterBuild.towers !== 1) fail('건설이 반영되지 않았다');
  if (afterBuild.gold !== '150') fail(`건설 후 골드가 150이 아니다: ${afterBuild.gold}`);
  console.log('[ok] 건설 -> 타워 1기, 골드 250 -> 150');

  /*
   * 세워진 망루를 **몸통 어느 높이에서 눌러도** 잡히는가.
   *
   * 탭 판정이 지면 원판이던 시절, 60유닛짜리 모델을 붙이자 45도 부감에서
   * 몸통 윗부분이 원판 바깥에 그려져 눌러도 아무 반응이 없었다.
   * (쇠뇌가 달린, 가장 누르고 싶은 자리가 전부 죽어 있었다.)
   */
  await page.waitForTimeout(200);
  const hitBox = await page.evaluate(`(function () {
    var g = window.game;
    var id = g.world.level.buildSlots[0].id;
    var hit = g.scene.slotHits.get(id);
    return hit ? { h: hit.scale.y, r: hit.scale.x } : null;
  })()`) as { h: number; r: number } | null;
  if (!hitBox) fail('슬롯 탭 판정 볼륨이 없다');
  if (hitBox.h < 40) fail(`탭 판정 높이가 타워를 못 덮는다: ${hitBox.h.toFixed(1)}u`);
  if (hitBox.r < 32 || hitBox.r > 64) fail(`탭 판정 반지름이 이상하다: ${hitBox.r.toFixed(1)}u`);

  const tapHeights = await page.evaluate(`(function () {
    var g = window.game;
    var s = g.world.level.buildSlots[0];
    return [0, 20, 40, 55].map(function (h) {
      var p = g.scene.project(s.x, h, s.z);
      return { h: h, x: Math.round(p.x), y: Math.round(p.y) };
    });
  })()`) as { h: number; x: number; y: number }[];
  for (const t of tapHeights) {
    await page.evaluate(`window.game.panel.close()`);
    await page.waitForTimeout(80);
    await page.mouse.click(t.x, t.y);
    await page.waitForTimeout(180);
    const sel = await page.evaluate(`window.game.selectedSlot`);
    if (!sel) fail(`망루 y=${t.h}u 지점을 눌렀는데 슬롯이 잡히지 않는다 (탭 판정이 몸통을 못 덮음)`);
  }
  console.log(`[ok] 망루 몸통 전 높이 탭 가능 — 판정 ${hitBox.h.toFixed(0)}u x r${hitBox.r.toFixed(0)}u`);

  /*
   * 가로로 든 휴대폰에서 슬롯을 짚을 수 있는가.
   *
   * 판정 기둥은 월드 좌표라 화면에서의 크기가 시점에 따라 변한다. 전장 전체를 담는
   * 가로 폰(844x390)에서는 슬롯 지름이 25px 밖에 안 돼서, 손가락 끝이 그보다 굵다 —
   * 분명히 눌렀는데 아무 일도 안 일어나는 일이 생겼다. 그래서 빗나간 탭은
   * 화면 좌표로 한 번 더 보고 가장 가까운 슬롯으로 끌어당긴다.
   */
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  const tapSnap = await page.evaluate(`(function () {
    var g = window.game;
    var r = g.handle.domElement.getBoundingClientRect();
    var out = { 지름: 0, 맞은거리: [], 잘못잡힘: [] };
    var s = g.world.level.buildSlots[0];
    var a = g.scene.project(s.x - 28, 0, s.z); var ax = a.x;
    var c = g.scene.project(s.x + 28, 0, s.z);
    out.지름 = Math.round(Math.abs(c.x - ax));
    var center = g.scene.project(s.x, 0, s.z);
    var cx = center.x, cy = center.y;
    [0, 10, 18, 22].forEach(function (off) {
      g.scene.handleTap(r.left + 4, r.top + 4, r);  // 빈 땅을 눌러 선택을 푼다
      g.scene.handleTap(r.left + cx + off, r.top + cy, r);
      if (g.selectedSlot === s.id) out.맞은거리.push(off);
    });
    // 각 슬롯의 한복판을 눌렀을 때 제 것이 잡히는가 (스냅이 옆 슬롯을 훔치지 않는지)
    g.world.level.buildSlots.forEach(function (q) {
      var pt = g.scene.project(q.x, 0, q.z); var qx = pt.x, qy = pt.y;
      g.scene.handleTap(r.left + qx, r.top + qy, r);
      if (g.selectedSlot !== q.id) out.잘못잡힘.push(q.id + '->' + g.selectedSlot);
    });
    return out;
  })()`) as { 지름: number; 맞은거리: number[]; 잘못잡힘: string[] };
  if (tapSnap.맞은거리.length < 4) {
    fail(`가로 폰에서 슬롯 탭이 빗나간다 — 지름 ${tapSnap.지름}px, 잡힌 거리 ${JSON.stringify(tapSnap.맞은거리)}`);
  }
  if (tapSnap.잘못잡힘.length > 0) {
    fail(`탭 스냅이 옆 슬롯을 훔친다: ${tapSnap.잘못잡힘.join(', ')}`);
  }
  console.log(`[ok] 가로 폰 슬롯 탭 — 화면 지름 ${tapSnap.지름}px 인데 ±22px 까지 잡힌다`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);

  /*
   * 활 망루: 레벨 수만큼만 쇠뇌가 보이고, 쏠 때 시위가 당겨졌다 놓이고,
   * 화살이 각 쇠뇌의 시위에서 떠나는지.
   *
   * 셋 다 "조용히 안 되는" 종류라 콘솔 에러로는 잡히지 않는다. 그래서 직접 잰다.
   */
  // 시뮬을 건드리지 않고 뷰만 레벨을 오르내리며 센다 (뒤 검사가 영향을 받지 않도록)
  const bowsByLevel = await page.evaluate(`(function () {
    var g = window.game;
    var slot = g.world.level.buildSlots[0].id;
    var v = g.scene.towerViews.get(slot);
    if (!v || !v.hasBows) return null;
    var origin = v.level;
    var out = [];
    for (var lv = 1; lv <= 5; lv++) {
      v.setLevel(lv);
      out.push(v.bows.filter(function (b) { return b.visible; }).length);
    }
    v.setLevel(origin);
    return { perLevel: out, total: v.bows.length, clips: v.shootActions.filter(Boolean).length };
  })()`) as { perLevel: number[]; total: number; clips: number } | null;

  if (!bowsByLevel) fail('활 망루 모델이 붙지 않았다 (manifest / archer_tower.glb 확인)');
  if (bowsByLevel.total < 5) fail(`쇠뇌가 5개가 아니다: ${bowsByLevel.total}`);
  if (bowsByLevel.clips < 5) fail(`shootN 클립이 모자란다: ${bowsByLevel.clips}`);
  const expected = [1, 2, 3, 4, 5];
  if (bowsByLevel.perLevel.join(',') !== expected.join(',')) {
    fail(`레벨별 쇠뇌 수가 1..5 가 아니다: ${bowsByLevel.perLevel.join(',')}`);
  }
  console.log(`[ok] 활 망루 — 레벨별 쇠뇌 ${bowsByLevel.perLevel.join('/')}, 클립 ${bowsByLevel.clips}개`);

  // 업그레이드 (U)
  await page.keyboard.press('1');
  await page.waitForTimeout(150);
  await page.keyboard.press('u');
  await page.waitForTimeout(300);
  const afterUpgrade = await page.evaluate(() => {
    const g = (window as unknown as { game: { world: { towers: Map<string, { level: number }> } } }).game;
    return [...g.world.towers.values()][0]?.level ?? 0;
  });
  if (afterUpgrade !== 2) fail(`업그레이드가 반영되지 않았다: Lv${afterUpgrade}`);
  console.log('[ok] 업그레이드 -> Lv2');
  const goldBeforeCombat = Number((await snap(page)).gold);

  // 조기 소집으로 웨이브를 시작시키고 전투가 실제로 도는지 본다
  await page.keyboard.press('Escape');
  await page.evaluate('window.game.setPaused(false, false)');
  await page.locator('button', { hasText: '지금 소집' }).click();
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await page.waitForTimeout(4000);

  const inCombat = await snap(page);
  console.log('\n[전투 중]');
  console.table(inCombat);
  if (inCombat.enemies === 0) fail('웨이브를 시작했는데 적이 없다');
  if (inCombat.wave === '0/20') fail('웨이브 카운터가 올라가지 않았다');

  // 화살이 나가고 적이 죽는지 — 처치 수가 오르면 전투 루프 전체가 도는 것이다
  await page.waitForTimeout(6000);
  const killed = await kills(page);
  if (killed === 0) fail('타워가 적을 하나도 죽이지 못했다 — 전투 루프가 돌지 않는다');
  console.log(`[ok] 전투 루프 동작 — 처치 ${killed}기`);

  /*
   * 모델이 실제로 "걷고 있고" "땅에 서 있는지".
   *
   * 둘 다 조용히 깨졌던 자리다.
   *   - 첫 뷰에서 walk 액션이 시작되지 않아 1파 유닛만 미끄러지듯 이동했다
   *   - 애니메이션 translation 을 오프셋으로 구워서 골반이 순간이동, 발이 16u 파묻혔다
   * 둘 다 콘솔 에러가 없어서 스모크가 통과했다. 그래서 여기서 직접 잰다.
   */
  const anim = await page.evaluate(`(function () {
    var footLow = ${FOOT_LOW};
    var g = window.game;
    var worst = null;
    var running = 0;
    var total = 0;
    g.scene.enemyViews.forEach(function (v) {
      total++;
      v.actions.forEach(function (a, st) { if (st === 'walk' && a.isRunning()) running++; });
      var rel = footLow(v, 5);
      if (rel === null) return;
      if (worst === null || rel < worst) worst = rel;
    });
    return { total: total, running: running, lowestRelToFeet: worst === null ? null : +worst.toFixed(2) };
  })()`) as { total: number; running: number; lowestRelToFeet: number | null };

  if (anim.total === 0) fail('적 뷰가 하나도 없다');
  if (anim.running === 0) fail('walk 액션이 도는 적이 하나도 없다 — 첫 뷰에서 클립이 시작되지 않았다');
  if (anim.lowestRelToFeet === null) fail('스킨드 메시를 찾지 못했다 — 모델이 프리미티브로 폴백했다');
  // 발끝은 접지면(=object3d.position.y) 근처여야 한다. 크게 음수면 땅에 파묻힌 것이다.
  if (anim.lowestRelToFeet < -2) {
    fail(`발끝이 접지면보다 ${(-anim.lowestRelToFeet).toFixed(1)}u 아래다 — 모델이 땅에 파묻혔다`);
  }
  if (anim.lowestRelToFeet > 6) {
    fail(`발끝이 접지면보다 ${anim.lowestRelToFeet.toFixed(1)}u 위다 — 모델이 떠 있다`);
  }
  console.log(
    `[ok] 걷기 재생 ${anim.running}/${anim.total}기, 발끝 접지면 대비 ${anim.lowestRelToFeet.toFixed(2)}u`,
  );

  /*
   * 중간 보스(두목)는 10파에나 나오므로 직접 스폰해서 확인한다.
   * 보병의 두 배여야 하고, 보병과 마찬가지로 땅에 발이 닿아야 한다.
   */
  await page.evaluate(
    `window.game.world.spawnEnemy({ unitId: 'yt_captain', at: 0, hpMul: 1, speedMul: 1 })`,
  );
  await page.waitForTimeout(900);
  const boss = await page.evaluate(`(function () {
    var g = window.game;
    function stats(defId) {
      var out = null;
      g.world.enemies.forEach(function (e) {
        if (out || e.defId !== defId) return;
        var v = g.scene.enemyViews.get(e.id);
        if (!v) return;
        v.object3d.updateMatrixWorld(true);
        var sk = null;
        v.object3d.traverse(function (o) { if (o.isSkinnedMesh) sk = o; });
        if (!sk) return;
        var tmp = v.object3d.position.clone();
        var n = sk.geometry.attributes.position.count;
        var lo = Infinity, hi = -Infinity;
        for (var k = 0; k < n; k += 7) {
          var p = sk.getVertexPosition(k, tmp);
          var m = sk.matrixWorld.elements;
          var wy = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
          if (wy < lo) lo = wy;
          if (wy > hi) hi = wy;
        }
        var running = [];
        v.actions.forEach(function (a, st) { if (a.isRunning()) running.push(st); });
        out = { height: hi - lo, footRel: lo - v.object3d.position.y, running: running.join(',') };
      });
      return out;
    }
    return { infantry: stats('yt_infantry'), captain: stats('yt_captain') };
  })()`) as {
    infantry: { height: number; footRel: number; running: string } | null;
    captain: { height: number; footRel: number; running: string } | null;
  };

  if (!boss.captain) fail('두목 뷰가 만들어지지 않았다');
  if (!boss.captain.running.includes('walk')) fail('두목이 walk 클립을 재생하지 않는다');
  if (boss.captain.footRel < -2) fail(`두목 발끝이 접지면보다 ${(-boss.captain.footRel).toFixed(1)}u 아래다`);
  if (boss.captain.footRel > 6) fail(`두목 발끝이 접지면보다 ${boss.captain.footRel.toFixed(1)}u 위다`);
  if (boss.infantry) {
    // 두목은 보병보다 확실히 커야 한다 (unit scale 2.0)
    const ratio = boss.captain.height / boss.infantry.height;
    if (ratio < 1.3) fail(`두목이 보병보다 크지 않다 (높이 비 ${ratio.toFixed(2)})`);
    console.log(
      `[ok] 두목 — 높이 ${boss.captain.height.toFixed(0)}u (보병 ${boss.infantry.height.toFixed(0)}u), ` +
        `발끝 ${boss.captain.footRel.toFixed(2)}u`,
    );
  }

  /*
   * 최종 보스가 성벽을 칼로 때리는 순간 불꽃이 튀는지.
   *
   * 이 연출은 공격 시작이 아니라 클립 중간(castleAttackImpactAt)에 한 번만 터진다.
   * 타이밍이 어긋나면 무기가 허공에 있을 때 불꽃이 나므로 시점까지 같이 잰다.
   */
  await page.evaluate(
    `window.game.world.spawnEnemy({ unitId: 'zhangjiao', at: 0, hpMul: 1, speedMul: 1 })`,
  );
  const spark = await page.evaluate(`new Promise(function (res, rej) {
    var g = window.game, t0 = performance.now(), moved = false;
    var original = g.scene.particles.emit;
    g.scene.particles.emit = function (kind, x, y, z, scale) {
      original.call(this, kind, x, y, z, scale);
      var enemy = g.world.enemies.find(function (e) { return e.defId === 'zhangjiao' && e.atCastle; });
      var view = enemy && g.scene.enemyViews.get(enemy.id);
      if (view && kind === 'weapon_spark' && Math.abs(y - view.weaponHeight) < 0.001) {
        g.scene.particles.emit = original;
        res({ t: (view.attackTime % view.attackInterval) / 0.75 });
      }
    };
    function c() {
      if (g.scene.particles.emit === original) return;
      if (!moved) {
        g.world.enemies.forEach(function (e) {
          if (e.defId === 'zhangjiao') { e.distance = g.world.path.totalLength - 60; moved = true; }
        });
      }
      if (performance.now() - t0 > 45000) {
        g.scene.particles.emit = original;
        rej(new Error('Castle impact spark did not fire'));
        return;
      }
      requestAnimationFrame(c);
    }
    c();
  })`) as { t: number };

  if (spark.t < BALANCE.fx.castleAttackImpactAt || spark.t > 1) {
    fail(`Castle impact spark timing incorrect: ${spark.t}`);
  }
  console.log(`[ok] Castle impact spark emitted at ${(spark.t * 100).toFixed(0)}% of attack clip`);

  const bowShot = await page.evaluate(`new Promise(function (res, rej) {
    var g = window.game, t0 = performance.now(), started = 0;
    var slot = g.world.level.buildSlots[0].id;
    var lo = [], hi = [], origins = {};
    function drawOf(b) {
      var a = b.string.geometry.getAttribute('position').array;
      var mx = (a[0] + a[6]) / 2, my = (a[1] + a[7]) / 2, mz = (a[2] + a[8]) / 2;
      return Math.hypot(a[3] - mx, a[4] - my, a[5] - mz);
    }
    function c() {
      var v = g.scene.towerViews.get(slot);
      if (!started) {
        if (g.world.projectiles.length > 0) started = performance.now();
        if (performance.now() - t0 > 45000) { rej(new Error('화살이 나가지 않았다')); return; }
        requestAnimationFrame(c);
        return;
      }
      if (v && v.bows.length) {
        for (var i = 0; i < v.bows.length; i++) {
          var d = drawOf(v.bows[i]);
          if (lo[i] === undefined || d < lo[i]) lo[i] = d;
          if (hi[i] === undefined || d > hi[i]) hi[i] = d;
        }
      }
      g.scene.projectileViews.forEach(function (pv, id) {
        var p = null;
        g.world.projectiles.forEach(function (q) { if (q.id === id) p = q; });
        if (p && p.towerSlotId === slot && pv.launch) origins[p.salvoIndex] = [Math.round(pv.launch.x), Math.round(pv.launch.z)];
      });
      if (performance.now() - started > 2500) {
        res({ drawMin: Math.min.apply(null, lo), drawMax: Math.max.apply(null, hi), origins: origins });
        return;
      }
      requestAnimationFrame(c);
    }
    c();
  })`) as { drawMin: number; drawMax: number; origins: Record<string, [number, number]> };

  // 당김폭이 거의 0이면 시위가 고정된 것이다 (클립이 안 돌거나 nock 뼈가 안 물렸다)
  if (!(bowShot.drawMax - bowShot.drawMin > 3)) {
    fail(`시위가 당겨지지 않는다 (당김 ${bowShot.drawMin.toFixed(1)}..${bowShot.drawMax.toFixed(1)})`);
  }
  const spots = Object.values(bowShot.origins).map((p) => p.join(','));
  if (new Set(spots).size < 2) {
    fail(`화살이 전부 같은 자리에서 떠난다: ${JSON.stringify(bowShot.origins)}`);
  }
  console.log(
    `[ok] 시위 당김 ${bowShot.drawMin.toFixed(1)} -> ${bowShot.drawMax.toFixed(1)}, ` +
      `발사 지점 ${new Set(spots).size}곳`,
  );

  /*
   * 활 발사음 — 한 발마다 짧게. 원본은 1초짜리라 연사하면 서로 겹쳐 뭉개진다.
   * 앞 묵음(mp3 패딩)을 건너뛰는지도 본다. 안 건너뛰면 소리가 발사보다 늦다.
   */
  const bowSfx = await page.evaluate(`(function () {
    var g = window.game;
    var p = (window.__plays || []).filter(function (x) { return x.len !== null; });
    return { has: g.assets.hasAudio('sfx_bow'), n: p.length, off: p.length ? p[0].off : null,
             len: p.length ? p[0].len : null, src: p.length ? p[0].src : null };
  })()`) as { has: boolean; n: number; off: number | null; len: number | null; src: number | null };

  if (!bowSfx.has) fail('활 발사음(sfx_bow)이 매니페스트에 없다');
  if (bowSfx.n === 0) fail('활을 쐈는데 발사음이 재생되지 않았다');
  if (bowSfx.len === null || bowSfx.len > 0.5) fail(`활 발사음이 너무 길다: ${String(bowSfx.len)}초`);
  if (bowSfx.off === null || bowSfx.off <= 0) fail('활 발사음이 앞 묵음을 건너뛰지 않았다');
  console.log(
    `[ok] 활 발사음 — 원본 ${String(bowSfx.src)}s → ${String(bowSfx.off)}s 부터 ` +
      `${String(bowSfx.len)}s (${bowSfx.n}회)`,
  );

  const goldNow = await page.evaluate(
    () => document.querySelector('#gold-chip .chip__value')?.textContent ?? '',
  );
  if (Number(goldNow) <= goldBeforeCombat) fail(`처치 골드가 반영되지 않았다: ${goldNow}`);
  console.log(`[ok] 처치 골드 반영 — 골드 ${goldNow}`);

  // 세로 화면에서도 맵이 잘리지 않는지 (카메라 거리 재계산)
  await page.setViewportSize({ width: 480, height: 900 });
  await page.waitForTimeout(600);
  const portrait = await page.evaluate(() => {
    const g = (window as unknown as { game: { scene: { stage: { camera: { position: { y: number } } } } } }).game;
    const rotate = document.getElementById('rotate-notice');
    return {
      camY: g.scene.stage.camera.position.y,
      rotateShown: rotate ? getComputedStyle(rotate).display !== 'none' : false,
    };
  });
  if (!portrait.rotateShown) fail('세로 모드 안내가 뜨지 않았다');
  console.log(`[ok] 세로 모드 안내 표시, 카메라 거리 재계산 (y=${portrait.camY.toFixed(0)})`);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
}

// ── 제 2장 ────────────────────────────────────────────────────────────

/** 건설 패널에서 타워 종류를 고른다 */
async function pickTower(page: Page, name: string): Promise<void> {
  const pick = page.locator('.towerpick button', { hasText: name });
  if ((await pick.count()) === 0) fail(`건설 패널에 "${name}" 선택 버튼이 없다`);
  await pick.first().click();
  await page.waitForTimeout(200);
}

async function level2Pass(page: Page): Promise<void> {
  console.log('\n=== 제 2장 (동탁 토벌전) ===');
  // ?level=2 는 잠금과 선택 화면을 건너뛴다 (main.ts forcedLevelId)
  await boot(page, `${BASE}/?debug=1&level=2`);
  await page.waitForTimeout(600);

  if (await page.locator('#level-select').isVisible().catch(() => false)) {
    fail('?level=2 인데 레벨 선택 화면이 떴다 — 직행 경로가 끊겼다');
  }

  await page.evaluate('window.game.setPaused(true, false)');
  const initial = await snap(page);
  console.log('\n[초기 상태]');
  console.table(initial);

  if (initial.drawCalls === 0) fail('드로우콜이 0이다 — 레벨 2 씬이 그려지지 않았다');
  if (initial.gold !== '300') fail(`레벨 2 시작 골드가 300이 아니다: ${initial.gold}`);
  if (initial.castle !== '600') fail(`레벨 2 시작 성 체력이 600이 아니다: ${initial.castle}`);

  // 시각 스모크는 철질려와 벽력거를 연달아 확인하므로 테스트 전용 40G를 보탠다.
  await page.evaluate(() => {
    const g = (window as unknown as { game: { world: { economy: { add(amount: number): number }; bus: { emit(name: string, payload: unknown): void } } } }).game;
    const total = g.world.economy.add(40);
    g.world.bus.emit('gold:changed', { total, delta: 40, reason: 'smoke' });
  });

  // 성벽 수리 버튼 — 레벨 2에서만 보인다. 성이 멀쩡할 땐 비활성.
  const repair = await page.evaluate(() => {
    const b = document.getElementById('repair-wall') as HTMLButtonElement | null;
    return b ? { shown: b.style.display !== 'none', disabled: b.disabled } : null;
  });
  if (!repair?.shown) fail('레벨 2인데 성벽 수리 버튼이 없다 (allowRepair 배선 확인)');
  if (!repair.disabled) fail('성이 만피인데 수리 버튼이 눌린다');
  console.log('[ok] 성벽 수리 버튼 표시 (만피라 비활성)');

  // 타워 3종이 전부 뜨는지 — 해금 필터(unlockedIn)의 반대편 확인
  await page.keyboard.press('1');
  await page.waitForTimeout(250);
  const picks = await page.evaluate(() =>
    [...document.querySelectorAll('.towerpick__name')].map((n) => n.textContent),
  );
  if (picks.length !== 3) fail(`레벨 2 건설 패널의 타워가 3종이 아니다: ${JSON.stringify(picks)}`);
  console.log(`[ok] 건설 패널 타워 3종 — ${picks.join(' / ')}`);

  // 철질려 (120G) — 투사체가 없는 aura 타워.
  // 경로상 첫 헤어핀(s2_a)에 세운다. 뒤쪽에 두면 적이 거기 닿기 전에 죽어
  // 감속이 한 번도 안 걸리는 채로 테스트가 지나가 버린다.
  await pickTower(page, '철질려');
  await page.locator('.panel button', { hasText: '건설' }).click();
  await page.waitForTimeout(300);
  let s = await snap(page);
  if (s.towers !== 1) fail('철질려 건설이 반영되지 않았다');
  if (s.gold !== '220') fail(`철질려 건설 후 골드가 220이 아니다: ${s.gold}`);
  console.log('[ok] 철질려 건설 -> 골드 340 -> 220');

  const trap = await page.evaluate(`(function () {
    var g = window.game;
    var v = g.scene.towerViews.get(g.world.level.buildSlots[0].id);
    if (!v || !v.model.getObjectByName('spike1') || !v.idleAction || !v.triggerAction) return null;
    var spike = v.model.getObjectByName('spike1');
    var before = spike.position.y;
    v.pulseAura();
    v.sync(null, 0, 0.1);
    return { idle: v.idleAction.isRunning(), lift: spike.position.y - before, bounds: v.measureBounds() };
  })()`) as { idle: boolean; lift: number; bounds: { radius: number } } | null;
  if (!trap || !trap.idle || trap.lift < 1 || trap.bounds.radius < 20 || trap.bounds.radius > 35) {
    fail('철질려 모델의 크기 또는 가시 애니메이션이 잘못됐다: ' + JSON.stringify(trap));
  }
  console.log('[ok] 철질려 3D 모델 — 대기 회전과 감속 반응, 슬롯 크기 확인');

  // 벽력거 (220G) — 새 프리미티브가 실제로 씬에 올라가는지
  await page.keyboard.press('2');
  await page.waitForTimeout(250);
  await pickTower(page, '벽력거');
  await page.locator('.panel button', { hasText: '건설' }).click();
  await page.waitForTimeout(300);
  s = await snap(page);
  if (s.towers !== 2) fail('벽력거 건설이 반영되지 않았다');
  if (s.gold !== '0') fail(`벽력거 건설 후 골드가 0이 아니다: ${s.gold}`);
  console.log('[ok] 벽력거 건설 -> 골드 220 -> 0');

  /*
   * 벽력거 모델: 팔 하나(bow1)와 발사 클립이 있고, 시위는 없어야 한다.
   * 활 망루 코드를 그대로 쓰므로 시위가 생겨 버리면 투석기에 활줄이 그려진다.
   */
  const cat = await page.evaluate(`(function () {
    var g = window.game;
    var slotId = g.world.level.buildSlots[1].id;
    var v = g.scene.towerViews.get(slotId);
    if (!v || !v.hasBows) return null;
    var arm = v.bows[0].bone.getObjectByName('bow1_arm');
    return {
      bows: v.bows.length,
      hasString: !!v.bows[0].string,
      hasArm: !!arm,
      clips: v.shootActions.filter(Boolean).length,
    };
  })()`) as { bows: number; hasString: boolean; hasArm: boolean; clips: number } | null;

  if (!cat) fail('벽력거 모델이 붙지 않았다 (manifest / catapult.glb 확인)');
  if (cat.bows !== 1) fail(`벽력거의 팔이 1개가 아니다: ${cat.bows}`);
  if (cat.hasString) fail('벽력거에 활시위가 그려졌다 — 투석기에는 시위가 없어야 한다');
  if (!cat.hasArm) fail('bow1_arm(던지는 팔) 노드가 없다');
  if (cat.clips < 1) fail('shoot1 클립이 없다');
  console.log(`[ok] 벽력거 — 팔 1개, 시위 없음, 클립 ${cat.clips}개`);

  await page.evaluate(`(function () {
    var g = window.game;
    var total = g.world.economy.add(200);
    g.world.bus.emit('gold:changed', { total: total, delta: 200, reason: 'smoke' });
  })()`);

  // 세 슬롯을 더 채워 전투가 실제로 벌어지게 한다 (질려는 혼자서 아무도 못 죽인다)
  await page.keyboard.press('Escape');
  for (const key of ['3', '4']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
    await pickTower(page, '궁노 망루');
    await page.locator('.panel button', { hasText: '건설' }).click();
    await page.waitForTimeout(250);
  }
  await page.keyboard.press('Escape');
  console.log('[ok] 궁노 망루 2기 추가 -> 총 4기');

  // 전투. 감속은 적이 진지를 지나는 짧은 구간에서만 참이므로
  // 배속을 올리기 전에 1배속으로 한 번 확인한다.
  await page.evaluate('window.game.setPaused(false, false)');
  await page.locator('button', { hasText: '지금 소집' }).click();
  await page.waitForTimeout(1500);

  let slowed = 0;
  for (let i = 0; i < 25 && slowed === 0; i++) {
    slowed = await slowedCount(page);
    if (slowed === 0) await page.waitForTimeout(500);
  }
  if (slowed === 0) fail('철질려 사거리를 적이 지나갔는데 감속이 한 번도 걸리지 않았다');
  console.log(`[ok] 철질려 감속 적용 — 동시 ${slowed}기`);

  await page.keyboard.press('+');
  await page.keyboard.press('+');

  // 처치가 나올 때까지 기다린다. 고정 대기로 두면 스폰 타이밍에 따라 0기로 끝난다.
  let killed = 0;
  for (let i = 0; i < 40 && killed === 0; i++) {
    killed = await kills(page);
    if (killed === 0) await page.waitForTimeout(600);
  }

  const inCombat = await snap(page);
  console.log('\n[전투 중]');
  console.table(inCombat);
  if (inCombat.enemies === 0 && killed === 0) fail('레벨 2에서 웨이브를 시작했는데 적이 없다');
  if (killed === 0) fail('레벨 2에서 아무도 죽지 않았다 — 벽력거/궁노가 쏘지 않는다');
  console.log(`[ok] 전투 루프 동작 — 처치 ${killed}기`);

  // 던지는 팔이 실제로 도는지 + 돌이 팔 끝에서 떠나는지
  const throwCheck = await page.evaluate(`new Promise(function (res, rej) {
    var g = window.game, t0 = performance.now();
    var slotId = g.world.level.buildSlots[1].id;
    var lo = Infinity, hi = -Infinity, launched = 0;
    function c() {
      var v = g.scene.towerViews.get(slotId);
      var arm = v && v.bows.length ? v.bows[0].bone.getObjectByName('bow1_arm') : null;
      if (arm) {
        if (arm.rotation.x < lo) lo = arm.rotation.x;
        if (arm.rotation.x > hi) hi = arm.rotation.x;
      }
      g.scene.projectileViews.forEach(function (pv) { if (pv.launch) launched++; });
      if (performance.now() - t0 > 6000) { res({ swing: hi - lo, launched: launched }); return; }
      if (performance.now() - t0 > 45000) { rej(new Error('시간 초과')); return; }
      requestAnimationFrame(c);
    }
    c();
  })`) as { swing: number; launched: number };

  if (!(throwCheck.swing > 0.5)) {
    fail(`벽력거 팔이 돌지 않는다 (회전폭 ${throwCheck.swing.toFixed(2)} rad)`);
  }
  if (throwCheck.launched === 0) fail('돌이 팔 끝에서 떠나지 않는다 (launch 미지정)');
  console.log(
    `[ok] 벽력거 발사 — 팔 회전폭 ${throwCheck.swing.toFixed(2)} rad, 돌 발사 ${throwCheck.launched}회`,
  );

  /*
   * 발사음 — 활은 짧게, 벽력거는 0.7초.
   * 원본은 각각 1.0초 / 2.1초짜리라 그대로 틀면 연사할 때 서로 겹쳐 뭉개진다.
   * 앞 묵음(mp3 패딩)을 건너뛰는지도 같이 본다. 안 건너뛰면 소리가 발사보다 늦다.
   */
  const shotSfx = await page.evaluate(`(function () {
    var g = window.game;
    var have = { bow: g.assets.hasAudio('sfx_bow'), rock: g.assets.hasAudio('sfx_catapult') };
    var byLen = {};
    (window.__plays || []).forEach(function (p) {
      var k = p.src.toFixed(2);
      if (!byLen[k]) byLen[k] = { n: 0, off: p.off, len: p.len };
      byLen[k].n++;
    });
    return { have: have, plays: byLen };
  })()`) as {
    have: { bow: boolean; rock: boolean };
    plays: Record<string, { n: number; off: number | null; len: number | null }>;
  };

  if (!shotSfx.have.bow) fail('활 발사음(sfx_bow)이 매니페스트에 없다');
  if (!shotSfx.have.rock) fail('투석 발사음(sfx_catapult)이 매니페스트에 없다');

  const clips = Object.entries(shotSfx.plays).filter(([, v]) => v.len !== null);
  if (clips.length === 0) fail('발사음이 한 번도 재생되지 않았다');
  for (const [srcLen, v] of clips) {
    if (v.len === null) continue;
    if (v.len > 0.75) fail(`발사음이 너무 길다 — 원본 ${srcLen}s 를 ${v.len}s 재생`);
    if (!(v.off !== null && v.off > 0)) {
      fail(`발사음이 앞 묵음을 건너뛰지 않았다 — 원본 ${srcLen}s, offset ${String(v.off)}`);
    }
  }
  const rock = clips.find(([srcLen]) => Number(srcLen) > 1.5);
  if (rock && rock[1].len !== 0.7) fail(`투석 발사음이 0.7초가 아니다: ${String(rock[1].len)}초`);
  console.log(
    `[ok] 발사음 — ${clips
      .map(([srcLen, v]) => `원본 ${srcLen}s → ${String(v.off)}s 부터 ${String(v.len)}s (${v.n}회)`)
      .join(' / ')}`,
  );

  // 계략 — 쿨다운/골드 상태가 버튼에 나오는지까지 본다.
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('.stratcard')].map((b) => ({
      name: b.querySelector('.stratcard__name')?.textContent ?? '',
      note: b.querySelector('.stratcard__note')?.textContent ?? '',
      ready: b.classList.contains('stratcard--ready'),
    })),
  );
  if (cards.length !== 3) fail(`계략 카드가 3장이 아니다: ${JSON.stringify(cards)}`);
  console.log(`[ok] 계략 카드 3장 — ${cards.map((c) => `${c.name}(${c.note})`).join(' / ')}`);

  // 쓸 수 있는 카드가 생길 때까지 기다렸다가 눌러 본다
  let cast: { id: string; affected: number } | null = null;
  for (let i = 0; i < 20 && !cast; i++) {
    const ready = page.locator('.stratcard--ready').first();
    if ((await ready.count()) > 0) {
      cast = await page.evaluate(() => {
        const g = (window as unknown as { game: { world: { stratagems: { id: string }[]; castStratagem: (id: string) => number } } }).game;
        for (const st of g.world.stratagems) {
          const n = g.world.castStratagem(st.id);
          if (n > 0) return { id: st.id, affected: n };
        }
        return null;
      });
    }
    if (!cast) await page.waitForTimeout(700);
  }
  if (!cast) fail('전투 중에 쓸 수 있는 계략이 한 장도 없었다 (골드/대상 조건 확인)');
  console.log(`[ok] 계략 발동 — ${cast.id}, 대상 ${cast.affected}`);

  await page.waitForTimeout(400);
  const cooling = await page.evaluate(() =>
    [...document.querySelectorAll('.stratcard__note')].map((n) => n.textContent ?? ''),
  );
  if (!cooling.some((t) => t.endsWith('초'))) {
    fail(`계략을 쓴 뒤 쿨다운 표시가 없다: ${JSON.stringify(cooling)}`);
  }
  console.log(`[ok] 계략 쿨다운 표시 — ${cooling.join(' / ')}`);

  // 여기까지 왔으면 레벨 2의 새 유닛(철기·방패병)도 한 번은 스폰되어 뷰가 만들어졌다
  const seen = await page.evaluate(() => {
    const g = (window as unknown as { game: { world: { enemies: { defId: string }[] } } }).game;
    return [...new Set(g.world.enemies.map((e) => e.defId))];
  });
  console.log(`[ok] 화면 위 유닛 종류 — ${seen.join(', ') || '(전멸)'}`);

  /*
   * 2장의 보병·기병·중간보스도 GLTF 모델이어야 한다.
   * 기병은 네 다리가 실제로 돌아야 "달린다"로 읽히므로 다리 뼈 회전폭까지 잰다.
   */
  await page.evaluate(`(function () {
    var g = window.game;
    // Isolate gait sampling from the ice-storm freeze exercised above.
    g.restart();
    // Animation now correctly pauses with the game. Run this isolated scene
    // while measuring a complete gait cycle.
    g.setPaused(false, false);
    ['xl_infantry', 'xl_cavalry', 'huaxiong', 'lubu'].forEach(function (id) {
      g.world.spawnEnemy({ unitId: id, at: 0, hpMul: 1, speedMul: 1 });
    });
  })()`);
  const l2models = await page.evaluate(`new Promise(function (res, rej) {
    var footLow = ${FOOT_LOW};
    var g = window.game, t0 = performance.now(), started = 0;
    var legLo = Infinity, legHi = -Infinity;
    // 여포는 말 다리 3마디가 전부 움직여야 한다 (고관절·무릎·구절)
    var joint = {};
    function c() {
      var seen2 = {};
      g.world.enemies.forEach(function (e) { seen2[e.defId] = e.id; });
      if (!started) {
        if (seen2.xl_cavalry && seen2.huaxiong && seen2.lubu) started = performance.now();
        if (performance.now() - t0 > 40000) { rej(new Error('2장 유닛 스폰 실패')); return; }
        requestAnimationFrame(c);
        return;
      }
      var cav = g.scene.enemyViews.get(seen2.xl_cavalry);
      if (cav) {
        var leg = cav.object3d.getObjectByName('legFL');
        if (leg) {
          if (leg.rotation.x < legLo) legLo = leg.rotation.x;
          if (leg.rotation.x > legHi) legHi = leg.rotation.x;
        }
      }
      var lb = g.scene.enemyViews.get(seen2.lubu);
      if (lb) {
        ['legFL', 'kneeFL', 'hoofFL'].forEach(function (b) {
          var o = lb.object3d.getObjectByName(b);
          if (!o) return;
          var r = joint[b] || (joint[b] = [Infinity, -Infinity]);
          if (o.rotation.x < r[0]) r[0] = o.rotation.x;
          if (o.rotation.x > r[1]) r[1] = o.rotation.x;
        });
      }
      if (performance.now() - started > 2000) {
        var out = {};
        ['xl_infantry', 'xl_cavalry', 'huaxiong', 'lubu'].forEach(function (id) {
          var v = g.scene.enemyViews.get(seen2[id]);
          if (!v) { out[id] = null; return; }
          var sk = null;
          v.object3d.updateMatrixWorld(true);
          v.object3d.traverse(function (o) { if (o.isSkinnedMesh) sk = o; });
          var running = [];
          v.actions.forEach(function (a, st) { if (a.isRunning()) running.push(st); });
          var rel = footLow(v, 7);
          out[id] = { skinned: !!sk, walking: running.indexOf('walk') >= 0, footRel: rel === null ? 0 : rel };
        });
        var js = {};
        Object.keys(joint).forEach(function (b) { js[b] = joint[b][1] - joint[b][0]; });
        res({ units: out, legSwing: legHi - legLo, lubuJoints: js });
        return;
      }
      requestAnimationFrame(c);
    }
    c();
  })`) as {
    units: Record<string, { skinned: boolean; walking: boolean; footRel: number } | null>;
    legSwing: number;
    lubuJoints: Record<string, number>;
  };

  for (const [id, u] of Object.entries(l2models.units)) {
    if (!u) fail(`"${id}" 뷰가 만들어지지 않았다`);
    if (!u.skinned) fail(`"${id}" 이 프리미티브로 폴백했다 — 모델/매니페스트 확인`);
    if (!u.walking) fail(`"${id}" 이 walk 클립을 재생하지 않는다`);
    if (u.footRel < -2 || u.footRel > 6) {
      fail(`"${id}" 발끝이 접지면 대비 ${u.footRel.toFixed(1)}u 다`);
    }
  }
  if (!(l2models.legSwing > 0.4)) {
    fail(`기병의 다리가 돌지 않는다 (legFL 회전폭 ${l2models.legSwing.toFixed(2)} rad)`);
  }
  // 여포의 말 다리는 세 마디가 전부 꺾여야 한다. 한 마디라도 굳으면 막대가 흔들리는 것처럼 보인다.
  for (const b of ['legFL', 'kneeFL', 'hoofFL']) {
    const sw = l2models.lubuJoints[b] ?? 0;
    if (!(sw > 0.2)) fail(`여포의 말 관절 "${b}" 이 움직이지 않는다 (회전폭 ${sw.toFixed(2)} rad)`);
  }
  console.log(
    `[ok] 2장 유닛 모델 — 보병/기병/중간보스/여포 전부 스킨드, 기병 다리 ${l2models.legSwing.toFixed(2)} rad, ` +
      `여포 말 관절 ${['legFL', 'kneeFL', 'hoofFL'].map((b) => l2models.lubuJoints[b].toFixed(2)).join('/')} rad`,
  );
}

// ── 제 3장 ────────────────────────────────────────────────────────────

async function level3Pass(page: Page): Promise<void> {
  console.log('\n=== 제 3장 (관도대전) ===');
  await boot(page, `${BASE}/?debug=1&level=3`);
  await page.waitForTimeout(600);

  await page.evaluate('window.game.setPaused(true, false)');
  const initial = await snap(page);
  console.log('\n[초기 상태]');
  console.table(initial);
  if (initial.drawCalls === 0) fail('드로우콜이 0이다 — 레벨 3 씬이 그려지지 않았다');
  // level03.ts 의 startGold 와 맞춘다. 400 -> 500 으로 오른 것은 난이도 조정 때다 —
  // 횡대가 넓어진 뒤로 400 으로는 일곱 슬롯을 세우는 동안 업그레이드가 밀렸다.
  if (initial.gold !== '500') fail(`레벨 3 시작 골드가 500이 아니다: ${initial.gold}`);
  if (initial.castle !== '500') fail(`레벨 3 시작 성 체력이 500이 아니다: ${initial.castle}`);

  // 3장부터도 화공과 얼음폭풍을 사용할 수 있다.
  const cards = await page.evaluate(() => document.querySelectorAll('.stratcard').length);
  if (cards !== 2) fail(`레벨 3에는 화공과 얼음폭풍 2장이 필요하다: ${cards}`);
  console.log('[ok] 3장 화공·얼음폭풍 해금');

  // 조기 소집 보너스가 앞 레벨보다 크게 표시되는지 — 이게 레벨 3의 주 수입원이다
  const bonus = await page.evaluate(
    () => document.querySelector('#call-wave .call-wave__bonus')?.textContent ?? '',
  );
  const amount = Number(bonus.replace(/[^0-9]/g, ''));
  if (!(amount > 60)) fail(`조기 소집 보너스가 너무 작다: "${bonus}" — 계수 배선 확인`);
  console.log(`[ok] 조기 소집 보너스 표시 — ${bonus}`);

  // 슬롯 7개를 키보드로 전부 고를 수 있는지 (레벨마다 슬롯 수가 다르다)
  await page.keyboard.press('7');
  await page.waitForTimeout(250);
  const seventh = await page.evaluate(() => {
    const p = document.querySelector('.panel') as HTMLElement | null;
    return !!p && p.style.display !== 'none';
  });
  if (!seventh) fail('7번 슬롯이 키보드로 선택되지 않았다');
  console.log('[ok] 7번 슬롯 선택 (슬롯 수만큼 키가 동작한다)');

  // 조기 소집으로 골드를 앞당겨 벌고 그 돈으로 짓는다 — 레벨 3의 기본 루프
  await page.keyboard.press('Escape');
  const before = Number((await snap(page)).gold);
  await page.evaluate('window.game.setPaused(false, false)');
  await page.locator('button', { hasText: '지금 소집' }).click();
  await page.waitForTimeout(400);
  const after = Number((await snap(page)).gold);
  if (!(after > before)) fail(`조기 소집으로 골드가 늘지 않았다: ${before} -> ${after}`);
  console.log(`[ok] 조기 소집 -> 골드 ${before} -> ${after}`);

  await page.keyboard.press('+');
  await page.keyboard.press('+');
  let killed = 0;
  for (let i = 0; i < 40 && killed === 0; i++) {
    await page.waitForTimeout(600);
    killed = await kills(page);
    if (killed === 0 && (await snap(page)).enemies === 0) continue;
  }
  const seen = await page.evaluate(() => {
    const g = (window as unknown as { game: { world: { enemies: { defId: string }[] } } }).game;
    return [...new Set(g.world.enemies.map((e) => e.defId))];
  });
  console.log(`[ok] 하북군 스폰 — ${seen.join(', ') || '(전멸)'}`);
}

// ── 실행 ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const browser: Browser = await chromium.launch({
    channel: 'chrome',
    args: ['--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  /*
   * 발사음 계측.
   * 헤드리스에는 스피커가 없으니 "소리가 났는지"는 볼 수 없다. 대신 실제로
   * 어느 구간을 트는지 — 앞 묵음을 건너뛰고 정한 길이만큼만 내는지 — 를 기록한다.
   */
  await page.addInitScript(`
    window.__plays = [];
    var origStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      try {
        if (!this.loop) window.__plays.push({
          src: this.buffer ? +this.buffer.duration.toFixed(2) : 0,
          off: offset === undefined ? null : +offset.toFixed(3),
          len: duration === undefined ? null : +duration.toFixed(3),
        });
      } catch (e) {}
      return origStart.apply(this, arguments);
    };
  `);

  const errors: string[] = [];
  const logs: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    const t = `${m.type()}: ${m.text()}`;
    logs.push(t);
    if (m.type() === 'error') errors.push(t);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  try {
    if (!ONLY || ONLY === '1') await level1Pass(page);
    if (!ONLY || ONLY === '2') await level2Pass(page);
    if (!ONLY || ONLY === '3') await level3Pass(page);

    if (SHOT) {
      await page.screenshot({ path: SHOT });
      console.log(`[ok] 스크린샷 저장: ${SHOT}`);
    }

    if (errors.length > 0) {
      console.log('\n[콘솔 에러]');
      for (const e of errors) console.log('  ' + e);
      throw new Error(`콘솔 에러 ${errors.length}건`);
    }

    const rendererLog = logs.find((l) => l.includes('renderer:'));
    console.log(`\n[백엔드] ${rendererLog ?? '(로그 없음)'}`);
    console.log('\n=== 스모크 테스트 통과 ===\n');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\n=== 스모크 테스트 실패 ===');
  console.error(err.message);
  process.exit(1);
});
