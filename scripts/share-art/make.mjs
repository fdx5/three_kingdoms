/**
 * 링크 공유 썸네일(og:image)과 아이콘을 굽는다.
 *
 *   npm run share:art            (dev 서버가 5173 에 떠 있어야 한다)
 *   npm run share:art -- --url http://localhost:5178
 *
 * 만드는 것
 *   public/og-cover.jpg        1200x630  카카오톡·슬랙·트위터가 쓰는 미리보기
 *   public/og-cover-square.jpg 1200x1200 정사각으로 자르는 곳(일부 메신저)을 위해
 *   public/apple-touch-icon.png 180x180  홈 화면에 추가했을 때의 아이콘
 *
 * 왜 손으로 그리지 않고 여기서 굽는가
 * ---------------------------------
 * 썸네일에 들어가는 전장 사진은 **방금 돌아간 판**의 화면이다. 그림을 따로 그려 두면
 * 게임이 바뀌어도 그림은 그대로라, 링크를 눌러 들어온 사람이 다른 게임을 만나게 된다.
 * 장수 하나도 게임이 쓰는 그 GLB 를 그대로 렌더한다.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const TMP = resolve(ROOT, '.share-art');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const BASE = (arg('--url', 'http://localhost:5173')).replace(/\/+$/, '');
/** 어느 장의 전장을 배경으로 쓸 것인가. 6장은 붉은 깃발이 서 있어 그림이 가장 산다. */
const FIELD_LEVEL = Number(arg('--level', '6'));
/** 썸네일에 세울 장수 */
const HERO = arg('--hero', 'guanyu');

mkdirSync(TMP, { recursive: true });
const dataUrl = (path, mime) => `data:${mime};base64,${readFileSync(path).toString('base64')}`;

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

try {
  /* ── 1. 진짜 전장 한 장면 ───────────────────────────────────────── */
  const game = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  game.on('pageerror', (e) => console.log('[game]', e.message));
  await game.goto(`${BASE}/?level=${FIELD_LEVEL}`);
  await game.waitForFunction(() => window.game?.world, null, { timeout: 180000 });
  await game.waitForTimeout(2500);

  /*
   * 빈 전장은 이 게임이 무엇인지 말해 주지 않는다. 망루를 세우고 적을 불러 둔다.
   *
   * 망루는 **올리지 않는다.** 처음에 5단계까지 올렸더니 웨이브가 길에 들어서기도 전에
   * 전멸해서, 찍을 때마다 적이 한 마리도 없는 사진이 나왔다(실측: enemies 0).
   * 대신 웨이브를 여러 번 겹쳐 불러 길이 차게 만든다.
   */
  await game.evaluate(() => {
    const g = window.game;
    g.world.economy.add(999999);
    for (const s of g.world.level.buildSlots) g.world.build(s.id);
    for (let i = 0; i < 4; i++) g.world.callWaveEarly();
  });
  // 길 위가 충분히 찰 때까지 기다린다. 출현 지점에 몰려 있으면 "진군"으로 읽히지 않는다.
  const crowded = await game.waitForFunction(() => {
    const es = window.game.world.enemies;
    return es.length >= 18 && es.filter((e) => e.worldX > 300).length >= 8;
  }, null, { timeout: 120000 }).then(() => true).catch(() => false);
  if (!crowded) console.warn('[share] 길이 덜 찼다 — 그대로 찍는다');

  /*
   * 기본 시점은 전장 전체를 담아서 병사 하나가 몇 픽셀밖에 안 된다.
   * 적 무리 쪽으로 당겨야 "길가에 망루, 길 위에 적"이 썸네일에서도 보인다.
   */
  const frame = await game.evaluate(() => {
    const g = window.game;
    const live = g.world.enemies;
    if (!live.length) return { enemies: 0 };
    const cx = live.reduce((a, e) => a + e.worldX, 0) / live.length;
    const cz = live.reduce((a, e) => a + e.worldZ, 0) / live.length;
    /*
     * 시점은 기본(전장 전체)에서 아주 조금만 당긴다.
     *
     * 무리 쪽으로 바짝 당겨 봤더니 화면이 흙길 한 조각이 되어, 정작 이 게임이
     * 무엇인지 — 길이 굽이치고 그 길가에 망루가 늘어서 있다는 것 — 가 사라졌다.
     * 병사 몇은 작게 찍히더라도 지형과 망루가 보이는 쪽이 썸네일로 낫다.
     * 좌우로만 조금 옮겨 무리가 제목에 가리지 않게 한다.
     */
    g.scene.stage.target.set(g.scene.stage.target.x + 60, 0, cz * 0.25 + 262);
    g.scene.stage.setZoom(0.9);
    return { enemies: live.length, cx: Math.round(cx), cz: Math.round(cz) };
  });
  await game.waitForTimeout(3500);
  // 실제로 화면 어디에 찍히는지 재 둔다 — 안 보이면 프레임이 잘못 잡힌 것이다.
  const onScreen = await game.evaluate(() => {
    const g = window.game;
    const r = g.handle.domElement.getBoundingClientRect();
    const pts = g.world.enemies.map((e) => g.scene.project(e.worldX, 20, e.worldZ));
    const inside = pts.filter((p) => p.x > 0 && p.x < r.width && p.y > 0 && p.y < r.height);
    return {
      화면안: inside.length,
      전체: pts.length,
      오른쪽절반: inside.filter((p) => p.x > r.width * 0.45).length,
    };
  });
  console.log('적 프레임:', JSON.stringify(frame), JSON.stringify(onScreen));
  await game.evaluate(() => {
    window.game.setPaused(true, false);
    // HUD 는 걷는다 — 썸네일에 버튼이 찍히면 광고가 아니라 스크린샷 유출처럼 보인다.
    document.getElementById('hud-root').style.opacity = '0';
    document.getElementById('backend-label')?.remove();
  });
  await game.waitForTimeout(400);
  await game.screenshot({ path: `${TMP}/field.png` });

  const counts = await game.evaluate(async () => {
    const [{ LEVEL_ORDER }, { TOWER_LIST }, { UNIT_LIST }] = await Promise.all([
      import('/src/data/levels/index.ts'),
      import('/src/data/towers.ts'),
      import('/src/data/units.ts'),
    ]);
    return { levels: LEVEL_ORDER.length, towers: TOWER_LIST.length, units: UNIT_LIST.length };
  });
  await game.close();
  console.log(`전장 ${FIELD_LEVEL}장 촬영 · ${counts.levels}장/${counts.towers}종/${counts.units}종`);

  /* ── 2. 장수 하나 ──────────────────────────────────────────────── */
  const shot = await browser.newPage({ viewport: { width: 640, height: 760 }, deviceScaleFactor: 2 });
  shot.on('pageerror', (e) => console.log('[hero]', e.message));
  await shot.goto(`${BASE}/scripts/share-art/hero.html`);
  await shot.waitForFunction(() => window.ready, null, { timeout: 180000 });
  await shot.evaluate((id) => window.shotUnit(id), HERO);
  await (await shot.$('canvas')).screenshot({ path: `${TMP}/hero.png`, omitBackground: true });
  await shot.close();
  await sharp(`${TMP}/hero.png`).trim({ threshold: 1 }).toFile(`${TMP}/hero-trim.png`);
  console.log(`장수 ${HERO} 렌더`);

  /* ── 3. 카드 조판 ──────────────────────────────────────────────── */
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  card.on('pageerror', (e) => console.log('[card]', e.message));
  await card.goto(`${BASE}/scripts/share-art/card.html`, { waitUntil: 'networkidle' });
  await card.evaluate(() => document.fonts.ready);
  await card.evaluate((payload) => window.fill(payload), {
    field: dataUrl(`${TMP}/field.png`, 'image/png'),
    hero: dataUrl(`${TMP}/hero-trim.png`, 'image/png'),
    ...counts,
  });
  await card.waitForTimeout(600);
  await card.screenshot({ path: `${TMP}/card.png` });

  // 정사각으로 자르는 메신저를 위해 한 장 더. 가운데가 아니라 **왼쪽**을 남긴다 —
  // 제목이 왼쪽에 있어서 가운데로 자르면 글자가 반쯤 날아간다.
  await card.setViewportSize({ width: 1200, height: 630 });
  await card.screenshot({ path: `${TMP}/card-wide.png` });
  await card.close();

  /* ── 4. 내보내기 ──────────────────────────────────────────────── */
  const out = resolve(ROOT, 'public');
  await sharp(`${TMP}/card.png`).resize(1200, 630)
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(`${out}/og-cover.jpg`);
  await sharp(`${TMP}/card.png`).extract({ left: 0, top: 0, width: 1260, height: 1260 })
    .resize(1200, 1200)
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(`${out}/og-cover-square.jpg`)
    .catch(async () => {
      // 원본이 1260px 높이에 못 미치면(배율이 다르면) 폭 기준으로 잘라 위아래를 채운다.
      await sharp(`${TMP}/card.png`).resize(1200, 1200, { fit: 'cover', position: 'left top' })
        .jpeg({ quality: 88, mozjpeg: true }).toFile(`${out}/og-cover-square.jpg`);
    });

  // 홈 화면 아이콘 — SVG 파비콘을 못 읽는 iOS 를 위해 PNG 로도 굽는다.
  await sharp(resolve(out, 'favicon.svg'), { density: 720 })
    .resize(180, 180).png({ compressionLevel: 9 })
    .toFile(`${out}/apple-touch-icon.png`);
  await sharp(resolve(out, 'favicon.svg'), { density: 720 })
    .resize(512, 512).png({ compressionLevel: 9 })
    .toFile(`${out}/icon-512.png`);

  console.log('public/og-cover.jpg · og-cover-square.jpg · apple-touch-icon.png · icon-512.png 생성');
} finally {
  await browser.close();
  rmSync(TMP, { recursive: true, force: true });
}
