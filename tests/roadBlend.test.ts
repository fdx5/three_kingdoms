import { describe, expect, it } from 'vitest';
import { Path } from '../src/sim/Path';
import { roadDistanceField } from '../src/view/RoadBlend';

describe('world-space road distance field', () => {
  it('keeps a continuous shoulder through corners and preserves the island between nearby lanes', () => {
    const field = roadDistanceField(new Path([[0, 350], [150, 350], [150, 170], [270, 170], [270, 350]]));
    const data = field.image.data as Uint8Array;
    const sample = (x: number, z: number) => data[Math.floor(z / 2) * 600 + Math.floor(x / 2)] / 255 * 128;
    expect(sample(100, 350)).toBeLessThan(2);
    expect(sample(150, 200)).toBeLessThan(2);
    expect(sample(119, 319)).toBeCloseTo(31, 0);
    expect(sample(210, 290)).toBeGreaterThan(57);
    expect(sample(900, 600)).toBe(128);
    field.dispose();
  });
  it('clips routes at the texture boundary without wrapping into the other side', () => {
    const field = roadDistanceField(new Path([[-100, 350], [150, 350]]));
    const data = field.image.data as Uint8Array;
    expect(data[175 * 600]).toBeLessThan(4);
    expect(data[175 * 600 + 599]).toBe(255);
    expect(data.length).toBe(600 * 350);
    field.dispose();
  });
});
