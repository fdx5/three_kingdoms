import { ROAD_COLUMNS } from '../src/view/RoadSurface';
/**
 * 뷰 계층 테스트.
 * three의 지오메트리/씬 그래프 수학은 WebGL 컨텍스트 없이도 node에서 돈다.
 * 렌더러가 필요한 부분(Renderer.ts)은 여기서 다루지 않는다.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';
import { Path } from '../src/sim/Path';
import { LEVEL_01 } from '../src/data/levels/level01';
import { UNITS } from '../src/data/units';
import { TOWERS } from '../src/data/towers';
import { BALANCE } from '../src/data/balance';
import { distanceToPath } from '../src/view/Terrain';

// AssetRegistry는 fetch/DRACO 등 브라우저 API를 생성자에서 건드리지 않는다.
// 다만 GLTFLoader가 내부적으로 쓰는 전역이 없어도 buildPrimitive는 순수하다.
import { AssetRegistry } from '../src/view/AssetRegistry';
import { Terrain } from '../src/view/Terrain';
import { PathRibbon, RIBBON_WIDTH } from '../src/view/PathRibbon';
import { ParticleSystem } from '../src/view/vfx/Particles';
import { BloodDecals, BLOOD_PATTERNS, bakeBloodGeometries } from '../src/view/vfx/BloodDecals';
import { heatOf, createProjectileAssets } from '../src/view/views/ProjectileView';

let path: Path;
let assets: AssetRegistry;

beforeAll(() => {
  path = new Path(LEVEL_01.path);
  assets = new AssetRegistry();
});

describe('AssetRegistry 프리미티브 폴백', () => {
  it('모델 id가 없으면 프리미티브를 조립한다', () => {
    const obj = assets.getMesh(undefined, UNITS.yt_infantry.view.primitive);
    expect(obj).toBeInstanceOf(THREE.Group);
    expect(obj.children.length).toBe(UNITS.yt_infantry.view.primitive.parts.length);
  });

  it('매니페스트에 없는 모델 id는 에러가 아니라 폴백이다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const obj = assets.getMesh('does_not_exist', UNITS.yt_infantry.view.primitive);
    expect(obj.children.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('지오메트리와 머티리얼을 캐시해 공유한다', () => {
    const a = assets.getMesh(undefined, UNITS.yt_infantry.view.primitive);
    const b = assets.getMesh(undefined, UNITS.yt_infantry.view.primitive);
    const ma = a.children[0] as THREE.Mesh;
    const mb = b.children[0] as THREE.Mesh;
    expect(ma.geometry).toBe(mb.geometry);
    expect(ma.material).toBe(mb.material);
  });

  it('타워 레벨마다 활 표식이 레벨 수만큼 있다', () => {
    for (let lv = 1; lv <= 5; lv++) {
      const obj = assets.buildPrimitive(TOWERS.archer_tower.levels[lv - 1].view.primitive);
      const marks = obj.children.filter((c) => c.name.startsWith('arrowmark_'));
      expect(marks).toHaveLength(lv);
    }
  });
});

describe('Terrain', () => {
  it('경로 위 지형은 평탄하다 (리본이 뜨지 않는다)', () => {
    const terrain = new Terrain(path, LEVEL_01.environment);
    const pos = { x: 0, z: 0 };
    for (let d = 0; d < path.totalLength; d += 50) {
      path.positionAt(d, pos);
      expect(terrain.heightAt(pos.x, pos.z)).toBeLessThan(1.5);
    }
    terrain.dispose();
  });

  it('경로에서 먼 곳은 높이가 생긴다', () => {
    const terrain = new Terrain(path, LEVEL_01.environment);
    let maxH = 0;
    for (let x = 0; x <= BALANCE.mapWidth; x += 40) {
      for (let z = 0; z <= BALANCE.mapDepth; z += 40) {
        if (distanceToPath(path, x, z) < 200) continue;
        maxH = Math.max(maxH, terrain.heightAt(x, z));
      }
    }
    // Hills must read as actual contours, with a bounded height above the road.
    expect(maxH).toBeGreaterThan(90);
    expect(maxH).toBeLessThanOrEqual(160);
    terrain.dispose();
  });

  it('장식은 프리셋 비율에 따라 개수가 줄고 경로 위에 놓이지 않는다', () => {
    const terrain = new Terrain(path, LEVEL_01.environment);
    terrain.buildDecor(BALANCE.presets.high);
    const high = countInstances(terrain);
    terrain.buildDecor(BALANCE.presets.low);
    const low = countInstances(terrain);
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThan(0);
    terrain.dispose();
  });
});

function countInstances(terrain: Terrain): number {
  let total = 0;
  terrain.group.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) total += im.count;
  });
  return total;
}

describe('PathRibbon', () => {
  it('세분화된 도로의 정점과 위쪽 법선, 가장자리 투명도가 유효하다', () => {
    const terrain = new Terrain(path, LEVEL_01.environment);
    const ribbon = new PathRibbon(path, terrain, assets);
    const mesh = ribbon.group.children[0] as THREE.Mesh;
    const pos = mesh.geometry.attributes.position;
    expect(pos.count).toBeGreaterThan(LEVEL_01.path.length * 2);
    const color = mesh.geometry.getAttribute('color');
    const normal = mesh.geometry.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
      expect(normal.getY(i)).toBeGreaterThan(0);
      expect(color.getW(i)).toBeGreaterThanOrEqual(0);
      expect(color.getW(i)).toBeLessThanOrEqual(1);
    }
    ribbon.dispose();
    terrain.dispose();
  });

  it('리본이 지형보다 위에 있다 (z-fighting 방지)', () => {
    const terrain = new Terrain(path, LEVEL_01.environment);
    const ribbon = new PathRibbon(path, terrain, assets);
    const mesh = ribbon.group.children[0] as THREE.Mesh;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const ground = terrain.heightAt(pos.getX(i), pos.getZ(i));
      expect(y).toBeGreaterThan(ground);
    }
    ribbon.dispose();
    terrain.dispose();
  });

  it('모퉁이에서도 리본 폭이 유지된다', () => {
    const terrain = new Terrain(path, LEVEL_01.environment);
    const ribbon = new PathRibbon(path, terrain, assets);
    const mesh = ribbon.group.children[0] as THREE.Mesh;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    // Each subdivided row includes the feathered shoulder, 22% wider than the road.
    for (let i = 0; i < pos.count; i += ROAD_COLUMNS) {
      const width = Math.hypot(pos.getX(i) - pos.getX(i + ROAD_COLUMNS - 1), pos.getZ(i) - pos.getZ(i + ROAD_COLUMNS - 1));
      expect(width).toBeGreaterThanOrEqual(RIBBON_WIDTH * 1.22 - 0.1);
      expect(width).toBeLessThanOrEqual(RIBBON_WIDTH * 1.22 * Math.SQRT2 + 0.1);
    }
    ribbon.dispose();
    terrain.dispose();
  });
});

describe('ParticleSystem', () => {
  it('프리셋 비율만큼만 입자를 그린다', () => {
    const high = new ParticleSystem(BALANCE.presets.high);
    const low = new ParticleSystem(BALANCE.presets.low);
    for (let i = 0; i < 100; i++) {
      high.emit('weapon_spark', 100, 10, 100);
      low.emit('weapon_spark', 100, 10, 100);
    }
    const cap = (p: ParticleSystem) => p.points.geometry.drawRange.count;
    expect(cap(high)).toBe(BALANCE.maxParticles);
    expect(cap(low)).toBeLessThan(cap(high));
    high.dispose();
    low.dispose();
  });

  it('입자는 수명이 끝나면 사라진다 (버퍼가 무한히 늘지 않는다)', () => {
    const ps = new ParticleSystem(BALANCE.presets.high);
    const capacity = (ps.points.geometry.attributes.position as THREE.BufferAttribute).count;
    for (let i = 0; i < 200; i++) ps.emit('hit_spark', 100, 20, 100);
    expect((ps.points.geometry.attributes.position as THREE.BufferAttribute).count).toBe(capacity);
    // 충분히 오래 돌리면 전부 죽어 화면 밖(-9999)으로 간다
    for (let i = 0; i < 120; i++) ps.update(1 / 60);
    const pos = ps.points.geometry.attributes.position as THREE.BufferAttribute;
    let alive = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > -9000) alive++;
    expect(alive).toBe(0);
    ps.dispose();
  });
});

describe('데이터 -> 뷰 계약', () => {
  it('모든 유닛이 프리미티브 스펙을 갖는다 (에셋 없이도 그려진다)', () => {
    for (const def of Object.values(UNITS)) {
      expect(def.view.primitive.parts.length).toBeGreaterThan(0);
      const obj = assets.buildPrimitive(def.view.primitive);
      expect(obj.children.length).toBe(def.view.primitive.parts.length);
    }
  });

  it('보스는 보병보다 크다', () => {
    expect(UNITS.yt_captain.scale).toBeGreaterThan(UNITS.yt_infantry.scale);
    expect(UNITS.zhangjiao.scale).toBeGreaterThanOrEqual(UNITS.yt_captain.scale);
  });
});

describe('투척체 연출 단계', () => {
  it('궁노와 벽력거는 3레벨부터 불붙은 투사체를 쓴다', () => {
    expect(heatOf(1)).toBe('cold');
    expect(heatOf(2)).toBe('cold');
    expect(heatOf(3)).toBe('hot');
    expect(heatOf(4)).toBe('hot');
    expect(heatOf(5)).toBe('blazing');
  });

  it('벽력거는 만렙까지 가는 동안 단계가 세 번 바뀐다 (발사체가 1개라 이게 유일한 표시다)', () => {
    const levels = TOWERS.catapult.levels.map((_, i) => heatOf(i + 1));
    expect(new Set(levels).size).toBe(3);
    // 발사체 수는 레벨이 올라도 그대로다 — 그래서 모습이 달라져야 한다
    expect(new Set(TOWERS.catapult.levels.map((l) => l.arrows)).size).toBe(1);
  });

  it('공유 에셋은 한 번만 만들고 dispose로 전부 반납한다', () => {
    const a = createProjectileAssets();
    const geos = [a.shaft, a.head, a.stone, a.shell, a.flame, a.trailGeo];
    const mats = [
      a.material,
      a.fireArrowMaterial,
      ...Object.values(a.stoneMaterials),
      ...Object.values(a.flameMaterials),
      ...a.trailMats,
      ...a.emberMats,
    ];
    const disposed: unknown[] = [];
    for (const g of geos) vi.spyOn(g, 'dispose').mockImplementation(() => disposed.push(g));
    for (const m of mats) vi.spyOn(m, 'dispose').mockImplementation(() => disposed.push(m));
    a.dispose();
    expect(disposed.length).toBe(geos.length + mats.length);
  });
});

describe('핏자국 데칼', () => {
  it('패턴은 10가지 이상이고 패턴마다 서로 다른 지오메트리가 구워진다', () => {
    expect(BLOOD_PATTERNS.length).toBeGreaterThanOrEqual(10);
    const geos = bakeBloodGeometries();
    expect(geos.length).toBe(BLOOD_PATTERNS.length * 3);

    // 같은 자국이 두 번 나오면 "여러 모양"이 아니다 — 정점 수로 대략 걸러낸다
    const shapes = new Set(geos.map((g) => `${g.getAttribute('position').count}:${g.getIndex()!.count}`));
    expect(shapes.size).toBeGreaterThan(BLOOD_PATTERNS.length);

    for (const g of geos) {
      expect(g.getAttribute('position').count).toBeGreaterThan(0);
      // 정점 알파로 가장자리를 부드럽게 만든다 = color는 vec4다
      expect(g.getAttribute('color').itemSize).toBe(4);
      g.dispose();
    }
  });

  it('죽을 때마다 자국이 쌓이되 상한을 넘지 않고, 수명이 다하면 사라진다', () => {
    const blood = new BloodDecals(BALANCE.presets.high);
    const cap = Math.round(BALANCE.fx.blood.maxDecals * BALANCE.presets.high.particleScale);
    for (let i = 0; i < cap + 30; i++) blood.splat(i * 7, 0, i * 3, 1);
    expect(blood.group.children.length).toBeLessThanOrEqual(cap);
    expect(blood.group.children.some((c) => c.visible)).toBe(true);

    // 가장 긴 수명 + 페이드가 지나면 전부 회수된다
    const maxLife = BALANCE.fx.blood.holdSec * 1.25 + BALANCE.fx.blood.fadeSec;
    for (let t = 0; t < maxLife + 1; t += 0.5) blood.update(0.5);
    expect(blood.group.children.every((c) => !c.visible)).toBe(true);
    blood.dispose();
  });
});
