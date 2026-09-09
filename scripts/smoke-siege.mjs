/**
 * 공성전 눈 검사 — 망루가 맞고, 타고, 무너지는 그림을 실제로 찍어 본다.
 *
 *   node scripts/smoke-siege.mjs --url http://127.0.0.1:5177
 *
 * 헤드리스 밸런스 러너(npm run sim)는 숫자만 본다. 이 파일이 보는 것은 그 반대다:
 * 습격조가 정말 대열을 벗어나 망루를 둘러싸는가, 피해 비율에 따라 연기와 불이
 * 차례로 붙는가, 무너질 때 잔해가 쏟아지는가 — 화면에만 있는 것들이다.
 *
 * 판정은 두 갈래로 한다.
 *   1) 시뮬 상태를 읽어 숫자로 확인한다 (둘러싼 수, 체력 비율, 파괴 여부)
 *   2) 같은 순간을 artifacts/siege-*.png 로 남겨 사람이 본다
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : null;
};
const BASE = (arg('--url') ?? 'http://127.0.0.1:5177').replace(/\/+$/, '');
const OUT = 'artifacts';

const ok = (m) => console.log(`[ok] ${m}`);
const fail = (m) => {
  console.error(`[FAIL] ${m}`);
  process.exitCode = 1;
};

/** 시뮬을 n초만큼 굴린다. 렌더 루프와 무관하게 결과를 정확히 재기 위한 것이다. */
const stepFor = (page, seconds) =>
  page.evaluate(`(function () {
    var g = window.game;
    for (var i = 0; i < ${seconds} * 60; i++) g.world.step(1 / 60);
    return g.world.elapsed;
  })()`);

const snapshot = (page) =>
  page.evaluate(`(function () {
    var g = window.game;
    var towers = [];
    var besieged = 0;
    g.world.towers.forEach(function (t) {
      var n = 0;
      for (var i = 0; i < t.siegeSlots.length; i++) if (t.siegeSlots[i] !== 0) n++;
      besieged += n;
      towers.push({ id: t.slotId, kind: t.def.id, lv: t.level, hp: Math.round(t.hp),
        max: t.maxHp, ratio: +(t.hpRatio).toFixed(3), around: n });
    });
    var roles = { raider: 0, runner: 0 };
    var states = { none: 0, approach: 0, assault: 0, return: 0 };
    g.world.enemies.forEach(function (e) { roles[e.role]++; states[e.siege]++; });
    return { towers: towers, besieged: besieged, roles: roles, states: states,
      enemies: g.world.enemies.length, gold: g.world.economy.gold,
      castle: g.world.castle.hp, wave: g.world.waveRunner.displayIndex };
  })()`);

async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/siege-${name}.png` });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${BASE}/?level=2`, { waitUntil: 'load' });
  await page.waitForFunction('window.game && window.game.world', null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  // 골드를 넉넉히 주고 길 옆에 망루를 촘촘히 세운다 — 습격조가 반드시 걸리게.
  const built = await page.evaluate(`(function () {
    var g = window.game;
    g.world.economy.add(20000);
    var spots = g.world.buildableSpots(50);
    var path = g.world.path;
    // 길에 가까운 자리부터 — 거기가 습격조가 가장 먼저 만나는 자리다
    spots.sort(function (a, b) {
      var da = path.lengthWithinRadius(a.x, a.z, 150);
      var db = path.lengthWithinRadius(b.x, b.z, 150);
      return db - da;
    });
    var n = 0;
    for (var i = 0; i < spots.length && n < g.world.maxTowers; i++) {
      if (g.world.build(spots[i], 'archer_tower') === 'ok') n++;
    }
    g.hud.setGold(g.world.economy.gold);
    return n;
  })()`);
  ok(`망루 ${built}기 건설`);

  await page.evaluate('window.game.world.callWaveEarly()');
  await stepFor(page, 22);
  const early = await snapshot(page);
  console.log('  [22초]', JSON.stringify(early.states), `둘러싼 적 ${early.besieged}`);

  if (early.states.approach + early.states.assault > 0) {
    ok(`습격조가 대열을 벗어났다 — 접근 ${early.states.approach} / 교전 ${early.states.assault}`);
  } else {
    fail('습격조가 아무도 망루로 가지 않았다');
  }

  // 역할 비율 — 7:3 에 가까워야 한다 (표본이 작으니 넉넉히 본다)
  const total = early.roles.raider + early.roles.runner;
  const ratio = total > 0 ? early.roles.raider / total : 0;
  if (total >= 8 && ratio > 0.45 && ratio < 0.92) ok(`습격조 비율 ${(ratio * 100).toFixed(0)}% (${total}기 중)`);
  else console.log(`  [i] 표본 ${total}기, 습격조 ${(ratio * 100).toFixed(0)}% — 비율은 sim 테스트가 본다`);

  await shot(page, '1-surround');

  /*
   * 카메라를 그 망루 코앞으로 붙인다.
   *
   * 기본 시점은 전장 전체를 담느라 망루가 40px 남짓이다 — 그 크기로는 연기가
   * 붙었는지 불이 붙었는지 사람이 구분할 수 없고, 이 검사의 목적이 바로 그것이다.
   */
  await page.evaluate(`(function () {
    var g = window.game;
    var t = g.world.towers.values().next().value;
    g.scene.stage.target.set(t.x, 0, t.z);
    g.scene.stage.setZoom(0.32);
  })()`);
  await page.waitForTimeout(700);
  await shot(page, '1b-closeup');

  // 망루 하나를 반쯤 부수고 그 그림을 본다 (연기 -> 불)
  for (const [name, ratio] of [['2-smoke', 0.62], ['3-fire', 0.38], ['4-critical', 0.14]]) {
    await page.evaluate(`(function () {
      var g = window.game;
      var t = g.world.towers.values().next().value;
      var want = Math.max(1, Math.round(t.maxHp * ${ratio}));
      var e = g.world.enemies[0];
      // 이벤트를 그대로 흘려 뷰가 실제 경로로 반응하게 한다
      g.world.bus.emit('tower:damaged', { slotId: t.slotId, towerId: t.def.id,
        enemyId: e ? e.id : 0, unitId: e ? e.defId : 'xl_infantry',
        amount: t.hp - want, hp: want, maxHp: t.maxHp, hpRatio: want / t.maxHp,
        worldPos: { x: t.x, y: 0, z: t.z },
        attackerPos: { x: t.x + 30, y: 0, z: t.z + 10 } });
      t.hp = want;
      g.selectTower ? 0 : 0;
      return t.slotId;
    })()`);
    // 불이 붙고 자라는 데 시간이 필요하다 (TowerDamageFx 는 목표 강도로 서서히 간다)
    await page.waitForTimeout(1400);
    await shot(page, name);
    ok(`${name} — 피해 ${Math.round((1 - ratio) * 100)}% 그림 저장`);
  }

  // 그 망루를 실제로 무너뜨린다
  const destroyed = await page.evaluate(`(function () {
    var g = window.game;
    var t = g.world.towers.values().next().value;
    var before = g.world.towers.size;
    var e = g.world.enemies[0];
    t.hp = 1;
    // 시뮬의 실제 경로로 부순다 — 이벤트를 손으로 만들지 않는다
    g.world.strikeTower ? 0 : 0;
    var priv = g.world;
    priv.strikeTower ? priv.strikeTower(t, e) : (function () {
      // strikeTower 는 private 이므로 한 대 맞히는 것으로 대신한다
      t.hp = 0;
      priv.destroyTower ? priv.destroyTower(t) : null;
    })();
    return { before: before, after: g.world.towers.size };
  })()`);
  await page.waitForTimeout(500);
  await shot(page, '5-collapse');
  if (destroyed.after < destroyed.before) ok(`망루 파괴 — ${destroyed.before} -> ${destroyed.after}기`);
  else fail('망루가 무너지지 않았다');

  await page.waitForTimeout(1400);
  await shot(page, '6-after');

  // 수리 — 패널을 열고 버튼이 뜨는지 본다
  const repair = await page.evaluate(`(function () {
    var g = window.game;
    var t = g.world.towers.values().next().value;
    if (!t) return null;
    t.hp = Math.round(t.maxHp * 0.3);
    t.repairCooldown = 0;
    g.world.economy.add(5000);
    var p = g.scene.project(t.x, 60, t.z);
    g.selectTower(t.slotId, p.x, p.y);
    var btns = Array.prototype.map.call(g.panel.root.querySelectorAll('button'), function (b) { return b.textContent; });
    var status = g.world.repairTowerStatus(t.slotId);
    var quote = g.world.repairTowerQuote(t.slotId);
    return { btns: btns, status: status, quote: quote, hp: t.hp, max: t.maxHp,
      bar: !!g.panel.root.querySelector('.durability__fill') };
  })()`);
  await page.waitForTimeout(300);
  await shot(page, '7-panel');
  if (repair && repair.btns.some((b) => b && b.indexOf('수리') === 0)) {
    ok(`수리 버튼 — ${repair.btns.filter((b) => b && b.indexOf('수리') === 0).join(', ')} / 상태 ${repair.status}`);
  } else fail(`수리 버튼이 패널에 없다: ${JSON.stringify(repair && repair.btns)}`);
  if (repair && repair.bar) ok('내구도 막대 표시');
  else fail('내구도 막대가 없다');

  // 실제로 눌러 본다
  const repaired = await page.evaluate(`(function () {
    var g = window.game;
    var id = g.selectedSlot;
    var before = g.world.towers.get(id).hp;
    var gold = g.world.economy.gold;
    var healed = g.world.repairTower(id);
    return { healed: healed, before: before, after: g.world.towers.get(id).hp,
      spent: gold - g.world.economy.gold };
  })()`);
  if (repaired.healed > 0) ok(`수리 동작 — ${repaired.before} -> ${repaired.after} (${repaired.spent} G)`);
  else fail('수리가 동작하지 않았다');

  await page.waitForTimeout(900);
  await shot(page, '8-repaired');

  // 전투를 더 굴려 실제 파괴가 자연히 일어나는지 본다
  await page.evaluate('window.game.world.callWaveEarly()');
  await stepFor(page, 60);
  const late = await snapshot(page);
  console.log('  [후반]', JSON.stringify(late.states), `둘러싼 적 ${late.besieged}`,
    late.towers.map((t) => `${t.kind}:${Math.round(t.ratio * 100)}%`).join(' '));
  await shot(page, '9-battle');

  /*
   * 마지막으로 가장 많이 둘러싸인 망루에 카메라를 붙인다.
   * 여기서 봐야 하는 것: 무리가 **망루를 향해** 서 있는가, 안쪽 여덟은 휘두르고
   * 바깥은 기다리는가 — 포위가 무리로 읽히는지가 이 한 장에 달렸다.
   */
  await page.evaluate(`(function () {
    var g = window.game;
    var best = null, bestN = -1;
    g.world.towers.forEach(function (t) {
      var n = 0;
      for (var i = 0; i < t.siegeSlots.length; i++) if (t.siegeSlots[i] !== 0) n++;
      if (n > bestN) { bestN = n; best = t; }
    });
    if (best) { g.scene.stage.target.set(best.x, 0, best.z); g.scene.stage.setZoom(0.3); }
    return bestN;
  })()`);
  await page.waitForTimeout(900);
  await shot(page, '10-siege-closeup');

  if (errors.length > 0) {
    fail(`콘솔 에러 ${errors.length}건`);
    for (const e of errors.slice(0, 6)) console.error(`   ${e}`);
  } else ok('콘솔 에러 없음');

  await browser.close();
  console.log(process.exitCode ? '\n=== 실패 ===' : '\n=== 공성 눈 검사 통과 ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
