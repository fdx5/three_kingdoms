import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { JING_UNITS } from '../src/data/unitsJing';
import { SHU_UNITS } from '../src/data/unitsShu';
import { BALANCE } from '../src/data/balance';

/**
 * 5·6장 최종보스의 리깅 계약.
 *
 * 둘 다 자동 리깅이 처음에 크게 빗나간 모델이라, **무엇이 어디에 묶였는지**를
 * 못 박아 둔다. 굽는 값(bodyTopRatio·weaponSide·rigidArms …)을 건드리면 여기서 걸린다.
 * 눈으로만 확인하고 넘어가면 다음 사람이 조용히 되돌린다.
 */

/*
 * 텍스처를 떼고 읽는다 — 테스트는 node 환경이라 GLTFLoader 가 이미지를 만나면
 * document/self 를 찾다 죽는다. 여기서 볼 것은 뼈와 가중치뿐이다.
 */
async function loadStripped(path: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path);
  for (const tex of doc.getRoot().listTextures()) tex.dispose();
  const bytes = await io.writeBinary(doc);
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    '',
  );
}

/** 뼈 이름 -> 그 뼈가 가진 총 가중치. 무엇이 어디에 묶였는지 한눈에 본다. */
function weightByBone(model: GLTF): Map<string, number> {
  const out = new Map<string, number>();
  model.scene.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    const names = o.skeleton.bones.map((b) => b.name);
    const j = o.geometry.getAttribute('skinIndex');
    const w = o.geometry.getAttribute('skinWeight');
    for (let i = 0; i < j.count; i++) {
      for (const k of ['x', 'y', 'z', 'w'] as const) {
        const weight = w[`get${k.toUpperCase()}` as 'getX'](i);
        if (weight <= 0) continue;
        const name = names[j[`get${k.toUpperCase()}` as 'getX'](i)];
        out.set(name, (out.get(name) ?? 0) + weight);
      }
    }
  });
  return out;
}

/** 클립을 t 에서 재생했을 때의 뼈 월드 위치 */
function bonePositions(model: GLTF, clipName: string, t: number): Map<string, THREE.Vector3> {
  const mixer = new THREE.AnimationMixer(model.scene);
  const clip = model.animations.find((a) => a.name === clipName)!;
  mixer.clipAction(clip).play();
  mixer.setTime(t * clip.duration);
  model.scene.updateMatrixWorld(true);
  const out = new Map<string, THREE.Vector3>();
  model.scene.traverse((o) => {
    if (o instanceof THREE.Bone) out.set(o.name, o.getWorldPosition(new THREE.Vector3()));
  });
  mixer.stopAllAction();
  return out;
}

function boneNames(model: GLTF): string[] {
  const out: string[] = [];
  model.scene.traverse((o) => {
    if (o instanceof THREE.Bone) out.push(o.name);
  });
  return out;
}

describe('관우 — 청룡언월도와 등 뒤 깃발', () => {
  let model: GLTF;
  beforeAll(async () => {
    model = await loadStripped('public/assets/models/guanyu.glb');
  });

  it('전용 모델을 쓴다 — 여포 것을 빌려 쓰던 것을 끊었다', () => {
    const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8'));
    expect(JING_UNITS.guanyu.view.modelId).toBe('guanyu');
    expect(manifest.models.guanyu.url).toBe('models/guanyu.glb');
  });

  it('걷기·공격 클립이 있고 공격은 성문 타격 박자에 맞는다', () => {
    expect(model.animations.map((a) => a.name).sort()).toEqual(['attack', 'idle', 'walk']);
    const attack = model.animations.find((a) => a.name === 'attack')!;
    expect(attack.duration).toBeCloseTo(BALANCE.fx.castleAttackDuration, 2);
  });

  it('관절을 나눠 가진다 — 다리·양팔·머리가 각자 정점을 든다', () => {
    const w = weightByBone(model);
    for (const bone of ['hips', 'chest', 'head', 'armL', 'armR', 'legL', 'legR']) {
      expect(w.get(bone) ?? 0, `${bone} 이(가) 아무 정점도 안 든다`).toBeGreaterThan(10);
    }
  });

  it('깃발은 몸통에 묶인다 — 팔을 따라 휘둘리지 않는다', () => {
    /*
     * 깃발이 팔에 붙으면 내려치기에서 어깨를 축으로 ±26도 휘둘린다.
     * 그래서 prop 뼈를 따로 두고 chest 밑에 매달았다. 어떤 클립도 이 뼈를 돌리지 않는다.
     */
    expect(boneNames(model)).toContain('prop');
    const w = weightByBone(model);
    expect(w.get('prop') ?? 0).toBeGreaterThan(500);
    for (const clip of model.animations) {
      expect(clip.tracks.map((t) => t.name).filter((n) => n.startsWith('prop'))).toEqual([]);
    }
  });

  it('언월도를 휘두른다 — 무기를 든 팔이 크게 돈다', () => {
    const rest = bonePositions(model, 'attack', 0);
    const peak = bonePositions(model, 'attack', 0.4 / BALANCE.fx.castleAttackDuration);
    // 언월도는 왼손이다. 그쪽 팔 끝이 오른팔보다 훨씬 많이 움직여야 "휘둘렀다"로 읽힌다
    const moved = (name: string): number => peak.get(name)!.distanceTo(rest.get(name)!);
    expect(moved('armL')).toBeGreaterThan(0);
    // 몸통도 같이 실린다 — 팔만 돌면 무기가 어깨에서 떨어져 보인다
    expect(moved('chest')).toBeGreaterThan(0);
  });
});

describe('제갈량 — 장포와 우선깃털부채', () => {
  let model: GLTF;
  beforeAll(async () => {
    model = await loadStripped('public/assets/models/zhugeliang.glb');
  });

  it('전용 모델을 쓴다 — 프리미티브로 서 있던 최종보스를 바꿨다', () => {
    const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8'));
    expect(SHU_UNITS.zhugeliang.view.modelId).toBe('zhugeliang');
    expect(manifest.models.zhugeliang.url).toBe('models/zhugeliang.glb');
    expect(model.animations.map((a) => a.name).sort()).toEqual(['attack', 'idle', 'walk']);
  });

  it('머리가 살아 있다 — 감면이 머리를 뭉개면 여기서 걸린다', () => {
    /*
     * 부채 깃털이 감면 예산을 다 먹으면 감면기가 매끈한 머리부터 접어 없앤다
     * (실측: 오차 0.02 에서 머리 대역 정점이 13개, 0.09 에서는 0개였다).
     * 오차를 0.003 까지 내려서 살렸다.
     */
    expect(weightByBone(model).get('head') ?? 0).toBeGreaterThan(100);
  });

  it('팔을 따로 돌리지 않는다 — 소매가 찢어지지 않게 상체가 통째로 든다', () => {
    /*
     * 큰 소매라 팔과 옷이 공간적으로 구분되지 않는다. 거리 스키닝은 오른팔에
     * 모델의 70%(26,182정점)를 붙였고, 그 팔을 0.75rad 돌리면 상체가 접혔다.
     * 지금은 팔·어깨 뼈가 정점을 하나도 들지 않고 chest 가 부채까지 든다.
     */
    const w = weightByBone(model);
    for (const bone of ['armL', 'armR', 'shoulderL', 'shoulderR']) {
      expect(w.get(bone) ?? 0, `${bone} 이 정점을 들고 있다`).toBeLessThan(1);
    }
    expect(w.get('chest') ?? 0).toBeGreaterThan(1000);
  });

  it('장포가 두 쪽으로 찢어지지 않는다 — 다리가 옷자락을 끌지 않는다', () => {
    // 다리가 없는 인물이다. 걷기에서 다리 뼈가 돌아도 옷은 골반만 따라가야 한다.
    const w = weightByBone(model);
    for (const bone of ['legL', 'legR', 'footL', 'footR']) {
      expect(w.get(bone) ?? 0, `${bone} 이 옷자락을 끌고 있다`).toBeLessThan(1);
    }
    expect(w.get('hips') ?? 0).toBeGreaterThan(1000);
  });

  it('걷는 것이 보인다 — 미끄러지지 않는다', () => {
    /*
     * 다리 뼈가 정점을 하나도 안 드는 인물이라, 다리를 흔들어 봐야 화면에서는
     * 아무 일도 일어나지 않는다. 실제로 그래서 **공중에 떠서 미끄러졌다.**
     * 지금은 골반이 몸 전체를 흔든다(robeGait) — 그것이 실제로 움직이는지 잰다.
     */
    const mixer = new THREE.AnimationMixer(model.scene);
    const clip = model.animations.find((a) => a.name === 'walk')!;
    mixer.clipAction(clip).play();

    const box = new THREE.Box3();
    const samples: THREE.Box3[] = [];
    for (let i = 0; i <= 8; i++) {
      mixer.setTime((i / 8) * clip.duration);
      model.scene.updateMatrixWorld(true);
      model.scene.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh) o.skeleton.update();
      });
      samples.push(box.setFromObject(model.scene, true).clone());
    }
    const span = (pick: (b: THREE.Box3) => number): number => {
      const v = samples.map(pick);
      return Math.max(...v) - Math.min(...v);
    };
    const height = samples[0].max.y - samples[0].min.y;

    // 몸이 걸음마다 오르내린다 (위로만 흔든다 — 아래로 내리면 옷단이 땅에 묻힌다)
    expect(span((b) => b.max.y) / height, '위아래로 안 움직인다').toBeGreaterThan(0.015);
    expect(Math.min(...samples.map((b) => b.min.y))).toBeCloseTo(samples[0].min.y, 2);
    // 옷자락이 좌우로 쓸린다 — 골반이 디딘 쪽으로 기울기 때문이다
    expect(span((b) => b.min.x) / height, '옷자락이 좌우로 안 쓸린다').toBeGreaterThan(0.02);
  });

  it('클립을 태워도 정점이 발산하지 않는다', () => {
    const mixer = new THREE.AnimationMixer(model.scene);
    for (const clip of model.animations) {
      mixer.stopAllAction();
      mixer.clipAction(clip).play();
      for (const t of [0, 0.3, 0.6, 1]) {
        mixer.setTime(t * clip.duration);
        model.scene.updateMatrixWorld(true);
        model.scene.traverse((o) => {
          if (!(o instanceof THREE.SkinnedMesh)) return;
          o.skeleton.update();
          o.computeBoundingBox();
          expect(o.boundingBox!.min.toArray().every(Number.isFinite)).toBe(true);
          expect(o.boundingBox!.max.toArray().every(Number.isFinite)).toBe(true);
        });
      }
    }
  });
});
