import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { YUAN_UNITS } from '../src/data/unitsYuan';
import { BALANCE } from '../src/data/balance';

let model: GLTF;
beforeAll(async () => {
  const bytes = readFileSync('public/assets/models/yanliang.glb');
  model = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
});

describe('Blender Yan Liang export', () => {
  it('loads a dedicated skinned model with the game animation contract', () => {
    const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8'));
    expect(YUAN_UNITS.yanliang.view.modelId).toBe('yanliang');
    expect(manifest.models.yanliang.url).toBe('models/yanliang.glb');
    expect(model.animations.map(a => a.name).sort()).toEqual(['attack', 'die', 'idle', 'walk']);
    expect(model.animations.find(a => a.name === 'attack')!.duration).toBeCloseTo(BALANCE.fx.castleAttackDuration);
    expect(model.animations.find(a => a.name === 'die')!.duration).toBeCloseTo(BALANCE.fx.deathAnimDuration);
    let skins = 0;
    model.scene.traverse(o => {
      if (!(o instanceof THREE.SkinnedMesh)) return;
      skins++;
      expect(o.skeleton.bones.length).toBe(21);
      const weights = o.geometry.getAttribute('skinWeight');
      for (let i = 0; i < weights.count; i++) {
        expect(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)).toBeCloseTo(1);
      }
    });
    expect(skins).toBeGreaterThan(0);
  });

  it('animates the limbs and cloak while keeping exported vertices finite', () => {
    const mixer = new THREE.AnimationMixer(model.scene);
    for (const name of ['walk', 'attack']) {
      mixer.stopAllAction();
      const clip = model.animations.find(a => a.name === name)!;
      mixer.clipAction(clip).play();
      const poses: number[][] = [];
      for (const t of [0, .25, .53, .8]) {
        mixer.setTime(t * clip.duration);
        model.scene.updateMatrixWorld(true);
        const pose: number[] = [];
        model.scene.traverse(o => {
          if (o instanceof THREE.Bone) pose.push(...o.quaternion.toArray());
          if (o instanceof THREE.SkinnedMesh) {
            o.skeleton.update();
            o.computeBoundingBox();
            expect(o.boundingBox!.min.toArray().every(Number.isFinite)).toBe(true);
            expect(o.boundingBox!.max.toArray().every(Number.isFinite)).toBe(true);
          }
        });
        poses.push(pose);
      }
      expect(poses[1]).not.toEqual(poses[0]);
      expect(poses[2]).not.toEqual(poses[1]);
    }
  });
});
