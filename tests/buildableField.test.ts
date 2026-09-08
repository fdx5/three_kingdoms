import { describe, it, expect } from 'vitest';
import { BuildableField } from '../src/view/views/BuildableField';
import type { Terrain } from '../src/view/Terrain';

/** 지형은 높이만 물어보므로 그것만 있는 가짜로 충분하다. */
const flatTerrain = { heightAt: (x: number, z: number) => (x + z) * 0.001 } as unknown as Terrain;

describe('건설 가능 위치 표시', () => {
  it('자리 수만큼만 그리고, 자리가 없으면 켜도 안 보인다', () => {
    const field = new BuildableField(flatTerrain, 16);
    expect(field.mesh.count).toBe(0);
    expect(field.visible).toBe(false);

    field.setSpots([{ x: 100, z: 100 }, { x: 200, z: 150 }]);
    // 아직 켜지 않았으므로 그리지 않는다
    expect(field.mesh.count).toBe(2);
    expect(field.visible).toBe(false);

    field.setVisible(true);
    expect(field.visible).toBe(true);

    // 다 지어서 자리가 없어지면 켜 둔 채로도 사라진다
    field.setSpots([]);
    expect(field.mesh.count).toBe(0);
    expect(field.visible).toBe(false);

    field.dispose();
  });

  it('용량을 넘는 자리는 잘라서 그린다 (인스턴스 버퍼를 넘지 않는다)', () => {
    const field = new BuildableField(flatTerrain, 4);
    field.setSpots(Array.from({ length: 40 }, (_, i) => ({ x: 50 + i * 10, z: 60 })));
    expect(field.mesh.count).toBe(4);
    field.dispose();
  });

  it('표시는 지형 위에 눕는다 (땅에 묻히지 않는다)', () => {
    const field = new BuildableField(flatTerrain, 8);
    field.setSpots([{ x: 400, z: 300 }]);
    const arr = field.mesh.instanceMatrix.array as Float32Array;
    // 4x4 행렬의 마지막 열이 위치 (x, y, z)
    expect(arr[12]).toBe(400);
    expect(arr[14]).toBe(300);
    expect(arr[13]).toBeCloseTo(flatTerrain.heightAt(400, 300) + 1, 5);
    field.dispose();
  });
});
