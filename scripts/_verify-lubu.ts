/**
 * 여포 공격 동작과 장수 타격 주기 확인.
 * 헤드리스 크롬에서 실제로 구운 GLB를 재생해 뼈가 어떻게 움직이는지 잰다.
 *
 *   npx tsx scripts/_verify-lubu.ts --url http://localhost:5173
 */
import { chromium } from 'playwright-core';

const BASE = (process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:5173'
).replace(/\/+$/, '');

let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log(`[ok] ${msg}`);
  else {
    failed++;
    console.log(`[FAIL] ${msg}`);
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  /*
   * tsx(esbuild)가 evaluate 안의 이름 붙은 함수에 __name 헬퍼를 끼워 넣는데,
   * 그 헬퍼는 페이지에 없어서 ReferenceError 가 난다. 아무것도 안 하는 것으로 채워 준다.
   */
  await page.addInitScript('window.__name = (fn) => fn;');

  // ?level=2 는 로그인·레벨 선택을 건너뛴다
  await page.goto(`${BASE}/?debug=1&level=2`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 30000 });

  // ── 1) 구운 모델의 공격 클립을 직접 재생해 뼈 궤적을 잰다 ──────────
  const rig = await page.evaluate(async () => {
    const THREE = (window as unknown as { THREE: typeof import('three') }).THREE;
    /*
     * 페이지 안에서는 'three/examples/...' 같은 맨 스펙파이어를 풀 수 없다.
     * 게임이 이미 매니페스트로 불러 둔 것을 그대로 쓴다 —
     * 실제로 게임이 쓰는 그 모델을 재는 것이므로 오히려 이쪽이 정확하다.
     */
    const g = (window as unknown as {
      game: { assets: { getMesh: (id: string, spec: { parts: [] }) => import('three').Object3D & { animations?: import('three').AnimationClip[] } } };
    }).game;
    const root = g.assets.getMesh('lubu', { parts: [] });
    const anims = root.animations ?? [];

    const clips = anims.map((a) => ({ name: a.name, duration: +a.duration.toFixed(3) }));
    const attack = anims.find((a) => a.name === 'attack');
    if (!attack) return { clips, error: 'attack 클립이 없다' };

    const bones: Record<string, import('three').Object3D> = {};
    root.traverse((o) => {
      if ((o as import('three').Bone).isBone) bones[o.name] = o;
    });

    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(attack);
    action.play();

    /** 클립을 훑으며 뼈의 월드 위치를 모은다 */
    const track: Record<string, { x: number[]; y: number[]; z: number[] }> = {};
    const names: string[] = ['riderArm', 'shoulderL', 'shoulderR', 'rider', 'neck', 'body'];
    for (const n of names) track[n] = { x: [], y: [], z: [] };

    /*
     * 뼈 원점만 재면 안 된다. riderArm 은 아주 짧은 뼈라 원점은 거의 안 움직이고,
     * 실제로 호를 그리는 것은 그 뼈에 매달린 **무기**다.
     * 그래서 뼈 로컬 +Z 로 30u 나간 지점을 방천화극 끝으로 삼아 같이 잰다.
     */
    track.weapon = { x: [], y: [], z: [] };
    const STEPS = 40;
    const v = new THREE.Vector3();
    const probe = new THREE.Vector3();
    mixer.setTime(0);
    for (let i = 0; i <= STEPS; i++) {
      mixer.setTime((i / STEPS) * attack.duration);
      root.updateMatrixWorld(true);
      for (const n of names) {
        const b = bones[n];
        if (!b) continue;
        b.getWorldPosition(v);
        track[n].x.push(v.x);
        track[n].y.push(v.y);
        track[n].z.push(v.z);
      }
      const arm = bones.riderArm;
      if (arm) {
        probe.set(0, 0, 30);
        arm.localToWorld(probe);
        track.weapon.x.push(probe.x);
        track.weapon.y.push(probe.y);
        track.weapon.z.push(probe.z);
      }
    }
    names.push('weapon');

    const span = (a: number[]): number => (a.length ? Math.max(...a) - Math.min(...a) : 0);
    const out: Record<string, { x: number; y: number; z: number }> = {};
    for (const n of names) {
      out[n] = { x: +span(track[n].x).toFixed(4), y: +span(track[n].y).toFixed(4), z: +span(track[n].z).toFixed(4) };
    }
    return { clips, bones: Object.keys(bones), span: out };
  });

  if ('error' in rig && rig.error) {
    check(false, String(rig.error));
  } else {
    const span = rig.span!;
    console.log(`     클립: ${rig.clips.map((c) => `${c.name}(${c.duration}s)`).join(' ')}`);
    for (const [n, s] of Object.entries(span)) {
      console.log(`     ${n.padEnd(10)} 좌우 ${s.x.toFixed(3)}  상하 ${s.y.toFixed(3)}  앞뒤 ${s.z.toFixed(3)}`);
    }

    check(rig.bones!.includes('riderArm'), '기수 팔 뼈가 있다');

    /*
     * 들이받기와 휘두르기를 가르는 것은 "무엇이 움직이는가"다.
     *   들이받기  몸통(body)이 앞으로 나가고 말 목이 따라 흔들린다. 무기는 그 관성으로만 움직인다.
     *   휘두르기  몸통은 거의 제자리인데 무기만 크게 호를 그린다.
     */
    const w = span.weapon;
    check(w.y > 20, `방천화극이 위아래로 크게 지나간다 (${w.y.toFixed(1)}u)`);
    check(w.x > 8, `옆으로도 쓸린다 — 앞뒤로만 나가는 찌르기가 아니다 (${w.x.toFixed(1)}u)`);
    check(
      w.y + w.x > span.body.z * 8,
      `무기의 움직임이 몸통이 나가는 양보다 훨씬 크다 (무기 ${(w.y + w.x).toFixed(1)}u vs 몸통 ${span.body.z.toFixed(1)}u)`,
    );
    check(
      span.shoulderL.x + span.shoulderR.x > 0.5,
      `어깨도 함께 돈다 (${(span.shoulderL.x + span.shoulderR.x).toFixed(2)}u)`,
    );
    // 말 목이 제 힘으로 움직이면 들이받는 그림이 된다. 몸통을 그대로 따라가기만 해야 한다.
    check(
      Math.abs(span.neck.z - span.body.z) < 0.01 && span.neck.x < 0.01,
      `말 목은 몸통을 따라가기만 한다 (목 ${span.neck.z.toFixed(3)} vs 몸통 ${span.body.z.toFixed(3)})`,
    );
  }

  // ── 2) 성문 앞 장수가 2초에 한 번 성을 깎는가 ─────────────────────
  const strikes = await page.evaluate(async () => {
    const g = (window as unknown as {
      game: {
        loop: { setSpeed: (n: number) => void };
        world: {
          path: { totalLength: number };
          enemies: { distance: number; hp: number; maxHp: number; defId: string }[];
          bus: { on: (k: string, f: (e: { unitId: string }) => void) => void };
          spawnEnemy: (s: unknown) => void;
        };
      };
    }).game;

    const w = g.world;
    // 여포 한 기를 성문 앞에 직접 세운다 (20파까지 기다릴 수 없다)
    (w as unknown as { spawnEnemy: (s: unknown) => void }).spawnEnemy({
      unitId: 'lubu',
      at: 0,
      hpMul: 200,
      speedMul: 1,
    });
    const e = w.enemies[w.enemies.length - 1];
    e.distance = w.path.totalLength;

    // 벽시계가 아니라 **시뮬 시간**으로 잰다. 헤드리스의 소프트웨어 렌더러는
    // 실시간보다 느려서, 벽시계로 재면 2초 주기가 3초로 보인다.
    const sim = w as unknown as { elapsed: number };
    const at: number[] = [];
    w.bus.on('enemy:castle-attack', (ev) => {
      if (ev.unitId === 'lubu') at.push(sim.elapsed);
    });
    const t0 = sim.elapsed;
    await new Promise((r) => setTimeout(r, 25000));
    return {
      simSeconds: +(sim.elapsed - t0).toFixed(1),
      gaps: at.map((t, i) => (i === 0 ? 0 : +(t - at[i - 1]).toFixed(2))),
      count: at.length,
    };
  });

  const gaps = strikes.gaps.slice(1);
  console.log(`     시뮬 ${strikes.simSeconds}초 동안 ${strikes.count}회 · 간격: ${gaps.join(', ') || '(없음)'}`);
  /*
   * 헤드리스의 소프트웨어 렌더러는 아주 느리다 — 벽시계 25초에 시뮬은 3초쯤만 흐른다.
   * 그래서 "몇 번 때렸나"로는 많이 재지 못한다. 중요한 것은 간격이고, 그건 아래에서 잰다.
   */
  check(strikes.count >= 2, `연달아 때린다 (${strikes.count}회 / 시뮬 ${strikes.simSeconds}초)`);
  if (gaps.length > 0) {
    const worst = Math.max(...gaps.map((g) => Math.abs(g - 2)));
    check(worst < 0.1, `간격이 정확히 2초다 (최대 오차 ${worst.toFixed(3)}초)`);
  }

  check(errors.length === 0, `콘솔 예외 없음${errors.length ? ` — ${errors[0]}` : ''}`);

  await browser.close();
  console.log(failed === 0 ? '\n전부 통과' : `\n${failed}건 실패`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
