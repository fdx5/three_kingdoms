import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { TOWERS } from '../src/data/towers';

let model: GLTF;
beforeAll(async () => {
  /*
   * 텍스처를 떼고 읽는다. 테스트는 node 환경이라 GLTFLoader 가 이미지를 만나면
   * document/self 를 찾다 죽는다(이 저장소는 시뮬 테스트를 위해 DOM 을 안 켠다).
   * 여기서 볼 것은 뼈·클립·치수뿐이라 그림은 없어도 된다.
   */
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read('public/assets/models/caltrop_camp.glb');
  for (const tex of doc.getRoot().listTextures()) tex.dispose();
  const bytes = await io.writeBinary(doc);
  model = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    '',
  );
});

/** 마름쇠 뼈를 번호순으로 — spike1..spikeN */
function spikeBones(): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (let i = 1; ; i++) {
    const b = model.scene.getObjectByName(`spike${i}`);
    if (!b) return out;
    out.push(b);
  }
}

describe('철질려 진지 모델', () => {
  it('타워 정의와 매니페스트가 같은 모델을 가리킨다', () => {
    const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8'));
    expect(manifest.models.caltrop_camp.url).toBe('models/caltrop_camp.glb');
    // 레벨마다 모델을 바꾸지 않는다 — 다섯 단계가 같은 진지를 쓴다
    expect(TOWERS.caltrop_camp.levels.map((l) => l.view.modelId)).toEqual(Array(5).fill('caltrop_camp'));
  });

  it('쏘지 않는 함정의 클립 규약을 지킨다 — bowN 은 없고 idle/trigger 가 있다', () => {
    expect(model.animations.map((a) => a.name).sort()).toEqual(['idle', 'trigger']);
    // 쇠뇌 규약(rig-tower)과 섞이면 TowerView 가 발사 망루로 착각한다
    expect(model.scene.getObjectByName('bow1')).toBeUndefined();
    expect(model.scene.getObjectByName('tower')).toBeDefined();
    expect(spikeBones().length).toBe(8);
  });

  it('바닥에 눕는다 — 원본의 기울기가 펴지고 지름이 슬롯 하나에 맞는다', () => {
    model.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model.scene);
    expect(box.min.y).toBeCloseTo(0, 1);
    const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    expect(width).toBeGreaterThan(46);
    expect(width).toBeLessThan(56);
    // 납작한 원반이다. 높이로 맞췄다면 지름이 경로를 통째로 덮었을 것이다
    expect(box.max.y).toBeLessThan(width / 2);
  });

  it('idle 은 마름쇠를 서로 다른 위상으로 돌린다', () => {
    const mixer = new THREE.AnimationMixer(model.scene);
    const clip = model.animations.find((a) => a.name === 'idle')!;
    expect(clip.duration).toBeCloseTo(6);
    mixer.clipAction(clip).play();

    const sample = (t: number): { yaw: number; y: number }[] => {
      mixer.setTime(t);
      model.scene.updateMatrixWorld(true);
      return spikeBones().map((b) => ({ yaw: b.quaternion.y, y: b.position.y }));
    };
    const a = sample(0);
    const b = sample(1.5);
    // 돌기는 돈다
    expect(b.some((s, i) => Math.abs(s.yaw - a[i].yaw) > 1e-3)).toBe(true);
    // 그런데 다 같이 돌지는 않는다 — 위상이 같으면 함정이 아니라 회전판이 된다
    const heights = a.map((s) => s.y);
    expect(new Set(heights.map((y) => y.toFixed(4))).size).toBeGreaterThan(1);
    // 이웃끼리 반대로 돈다
    expect(Math.sign(b[0].yaw - a[0].yaw)).toBe(-Math.sign(b[1].yaw - a[1].yaw));
  });

  it('trigger 는 가시를 한 번 솟구쳤다 제자리로 내린다', () => {
    const mixer = new THREE.AnimationMixer(model.scene);
    const clip = model.animations.find((a) => a.name === 'trigger')!;
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.play();

    const tops = (t: number): number[] => {
      mixer.setTime(t);
      model.scene.updateMatrixWorld(true);
      return spikeBones().map((b) => b.position.y);
    };
    const rest = tops(0);
    const peak = tops(0.12);
    /*
     * 마지막 키프레임 직전을 본다. 정확히 duration 에서 재면 three 가 1회 클립을
     * 끝내면서 뼈를 믹서가 잡기 전 값으로 되돌려 놓아 클립이 아니라 이전 상태를
     * 재게 된다 — 여기서 보고 싶은 것은 클립이 남기는 자세다.
     */
    const back = tops(clip.duration - 1e-3);
    // 올라가는 데 0.1초 — 그 순간이 보여야 "밟혔다"가 읽힌다
    expect(peak.every((y, i) => y > rest[i] + 1)).toBe(true);
    // 되돌아온다. 남아 있으면 다음 발동이 안 보인다
    for (let i = 0; i < rest.length; i++) expect(back[i]).toBeCloseTo(rest[i], 1);
  });
});
