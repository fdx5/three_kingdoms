/* global window, console, process */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const base = process.env.REVIEW_URL ?? 'http://localhost:5178';
const tag = process.env.REVIEW_TAG ?? 'review';
// 어떤 모델을 볼지. 굽고 나서 바로 눈으로 확인하는 자리라 모델마다 고쳐 쓰지 않는다.
const modelId = process.env.REVIEW_MODEL ?? 'zhugeliang';
const clipName = process.env.REVIEW_CLIP ?? 'walk';
// 카메라 자리 "x,y,z" — 부위(반대쪽 팔, 안쪽 바퀴)를 확인할 때 돌려 본다
const cam = (process.env.REVIEW_CAM ?? '48,32,78').split(',').map(Number);
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}/?level=6&debug=1`);
  await page.waitForFunction(() => !!window.game?.scene, null, { timeout: 60000 });
  await page.evaluate(() => window.game.loop.stop());
  // Use the loaded production asset in a well-lit inspection scene.
  await page.evaluate(async ({ modelId, clipName, cam }) => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const g = window.game;
    const model = g.assets.getMesh(modelId, { parts: [] });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x26343e);
    scene.add(new THREE.HemisphereLight(0xe2f0ff, 0x7a6554, 2));
    const sun = new THREE.DirectionalLight(0xffeddb, 3);
    sun.position.set(-40, 80, 70); scene.add(sun); scene.add(model);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0x68736e, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.05; scene.add(ground);
    const grid = new THREE.GridHelper(100, 20, 0xb1beb4, 0x82918a); grid.position.y = .01; scene.add(grid);
    const camera = new THREE.PerspectiveCamera(35, 1200 / 900, .1, 500);
    camera.position.set(cam[0], cam[1], cam[2]); camera.lookAt(0, 16, 0);
    const mixer = new THREE.AnimationMixer(model);
    const found = model.animations?.find(clip => clip.name === clipName);
    if (!found) throw new Error(`클립 ${clipName} 이(가) 없다 — ${(model.animations ?? []).map(c => c.name).join(',') || '클립 없음'}`);
    const walk = mixer.clipAction(found).play();
    window.rigReview = { scene, camera, mixer, walk, model };
    g.handle.renderer.setPixelRatio(1); g.handle.renderer.setSize(1200, 900);
    for (const selector of ['#hud-root', '#fx-layer', '#debug-panel']) {
      const element = window.document.querySelector(selector); if (element) element.style.display = 'none';
    }
  }, { modelId, clipName, cam });
  for (const phase of [0, .25, .5, .75]) {
    await page.evaluate(phase => {
      const r = window.rigReview;
      r.mixer.setTime(phase * r.walk.getClip().duration);
      window.game.handle.renderer.render(r.scene, r.camera);
    }, phase);
    await page.screenshot({ path: `artifacts/${tag}-${modelId}-${clipName}-${phase}.png` });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`${tag}: ${modelId} ${clipName} 네 위상을 렌더했다 (브라우저 오류 없음)`);
} finally { await browser.close(); }
