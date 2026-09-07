import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

/**
 * 걷기 리깅 — 두 다리가 **따로** 움직이는가.
 *
 * 방패병이 "허리에서 두 발이 공중에서 같이 움직이는" 걸음으로 걷고 있었다.
 * 원인은 클립이 아니라 가중치였다 — 방패 아래 모서리 4정점이 발로 잡혀서
 * 왼발 뼈가 정점을 12개만 들었고(오른발 331), 진짜 두 다리가 전부 오른다리
 * 뼈에 몰려 같은 위상으로 흔들렸다.
 *
 * 이런 것은 굽는 사람이 로그를 안 보면 모른다. 클립도 뼈도 정상으로 보이고
 * 테스트도 다 통과한다 — 화면에서 걷는 것을 봐야만 안다. 그래서 **구워 놓은
 * 모든 모델**을 여기서 훑는다. 새 모델을 넣어도 자동으로 대상이 된다.
 */
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const files = readdirSync('public/assets/models').filter((f) => f.endsWith('.glb')).sort();

interface Legs {
  weight: Record<string, number>;
  /** legL / legR 의 walk 회전이 서로 반대인가 */
  opposite: boolean | null;
  gapRatio: number;
}

async function readLegs(path: string): Promise<Legs | null> {
  const doc = await io.read(path);
  const skins = doc.getRoot().listSkins();
  if (skins.length === 0) return null;
  const joints = skins[0].listJoints();
  const names = joints.map((j) => j.getName());
  if (!names.includes('legL') || !names.includes('legR')) return null;

  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const P = prim.getAttribute('POSITION')!;
  const J = prim.getAttribute('JOINTS_0')!;
  const W = prim.getAttribute('WEIGHTS_0')!;
  const weight: Record<string, number> = {};
  const jb = [0, 0, 0, 0];
  const wb = [0, 0, 0, 0];
  for (let i = 0; i < J.getCount(); i++) {
    J.getElement(i, jb);
    W.getElement(i, wb);
    for (let k = 0; k < 4; k++) {
      if (wb[k] <= 0) continue;
      const name = names[jb[k]];
      weight[name] = (weight[name] ?? 0) + wb[k];
    }
  }

  // 몸 높이 대비 두 다리 뼈의 수평 거리
  let minY = Infinity;
  let maxY = -Infinity;
  const p = [0, 0, 0];
  for (let i = 0; i < P.getCount(); i++) {
    P.getElement(i, p);
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const a = joints[names.indexOf('legL')].getTranslation();
  const b = joints[names.indexOf('legR')].getTranslation();
  const gapRatio = Math.hypot(a[0] - b[0], a[2] - b[2]) / (maxY - minY);

  const walk = doc.getRoot().listAnimations().find((x) => x.getName() === 'walk');
  let opposite: boolean | null = null;
  if (walk) {
    const spin = (bone: string): number | null => {
      const ch = walk
        .listChannels()
        .find((c) => c.getTargetNode()?.getName() === bone && c.getTargetPath() === 'rotation');
      const out = ch?.getSampler()?.getOutput()?.getArray();
      // 두 번째 키프레임의 x 성분 = 허벅지를 앞뒤로 흔든 방향
      return out && out.length >= 8 ? out[4] : null;
    };
    const l = spin('legL');
    const r = spin('legR');
    if (l !== null && r !== null) opposite = l * r < 0;
  }
  return { weight, opposite, gapRatio };
}

describe('걷기 리깅 — 구워 놓은 모든 모델', () => {
  it('검사할 모델이 실제로 있다', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`${file.replace('.glb', '')}`, async () => {
      const legs = await readLegs(`public/assets/models/${file}`);
      if (!legs) return; // 다리 없는 것(망루·함정)은 건너뛴다

      const l = legs.weight.legL ?? 0;
      const r = legs.weight.legR ?? 0;

      /*
       * 다리 뼈가 둘 다 비어 있는 것은 **일부러** 그런 것이다 —
       * 제갈량처럼 장포가 다리를 덮은 인물은 자락을 전부 골반으로 옮긴다.
       * 고장난 것은 "한쪽만 비어 있는" 경우다.
       */
      if (l < 1 && r < 1) return;

      // 걷기는 두 다리를 번갈아 쓴다. 한쪽이 다른 쪽의 3분의 1도 못 들면
      // 그 다리는 사실상 없는 것이고, 두 다리가 한 뼈에 몰려 함께 흔들린다.
      const weak = Math.min(l, r);
      const strong = Math.max(l, r);
      expect(weak / strong, `${file}: 다리 가중치가 한쪽으로 쏠렸다 (legL ${l.toFixed(0)} / legR ${r.toFixed(0)})`)
        .toBeGreaterThan(0.33);

      const footL = legs.weight.footL ?? 0;
      const footR = legs.weight.footR ?? 0;
      if (footL + footR > 1) {
        expect(
          Math.min(footL, footR) / Math.max(footL, footR),
          `${file}: 발 가중치가 한쪽으로 쏠렸다 (footL ${footL.toFixed(0)} / footR ${footR.toFixed(0)})`,
        ).toBeGreaterThan(0.25);
      }

      // 두 다리가 겹치면(간격 0) 좌우가 안 갈리고, 너무 벌어지면 발이 몸 밖에 있다
      expect(legs.gapRatio, `${file}: 다리 간격이 이상하다`).toBeGreaterThan(0.02);
      expect(legs.gapRatio, `${file}: 다리 간격이 이상하다`).toBeLessThan(0.25);

      // 클립은 두 다리를 반대로 흔들어야 한다
      if (legs.opposite !== null) {
        expect(legs.opposite, `${file}: walk 에서 두 다리가 같은 방향으로 돈다`).toBe(true);
      }
    });
  }
});

describe('방패병', () => {
  it('방패가 발로 잡히지 않게 발 탐색을 좁혀 두었다', () => {
    // 이 값을 지우면 방패 모서리가 다시 한쪽 발이 된다
    const recipe = readFileSync('scripts/bake-assets.ts', 'utf8');
    const block = recipe.slice(recipe.indexOf('shield_soldier: {'));
    expect(block.slice(0, block.indexOf('},'))).toMatch(/footRadius:\s*0\.2/);
  });
});
