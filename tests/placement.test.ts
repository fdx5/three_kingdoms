import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/World';
import { Path } from '../src/sim/Path';
import { LEVEL_ORDER, LEVEL_01 } from '../src/data/levels';
import { BALANCE } from '../src/data/balance';
import { spotKey, spotFromKey, placementReason } from '../src/sim/Placement';

/**
 * 자유 배치 — 타워는 빈 땅 아무 데나 세운다. 레벨이 정하는 것은 자리가 아니라 개수다.
 *
 * 여기서 지키는 것은 두 가지다.
 *   1) 규칙이 예전 설계와 어긋나지 않는가 (추천 자리는 전부 여전히 유효해야 한다)
 *   2) 개수 한도가 실제로 막는가 (여섯 장의 밸런스가 그 수를 전제로 맞춰져 있다)
 */
describe('타워 자유 배치', () => {
  const world = (): World => new World({ level: LEVEL_01, seed: 1 });
  const rich = (): World => {
    const w = world();
    w.economy.add(100000);
    return w;
  };

  it('여섯 장의 추천 자리는 전부 지을 수 있다', () => {
    for (const level of LEVEL_ORDER) {
      const w = new World({ level, seed: 1 });
      for (const slot of level.buildSlots) {
        expect(w.canBuildAt(slot.x, slot.z), `${level.id} ${slot.id}`).toBe('ok');
      }
    }
  });

  it('길 위와 길가에는 못 짓는다', () => {
    for (const level of LEVEL_ORDER) {
      const w = new World({ level, seed: 1 });
      const path = new Path(level.path);
      const p = { x: 0, z: 0 };
      // 경로를 따라 100유닛마다 찍어 본다 — 어느 지점도 지을 수 없어야 한다.
      for (let d = 0; d <= path.totalLength; d += 100) {
        path.positionAt(d, p);
        expect(['on_path', 'castle', 'out_of_bounds']).toContain(w.canBuildAt(p.x, p.z));
      }
    }
  });

  it('세운 망루 옆에는 towerSpacing 안쪽으로 못 짓는다', () => {
    const w = rich();
    const first = LEVEL_01.buildSlots[0];
    expect(w.build(first)).toBe('ok');

    const gap = BALANCE.placement.towerSpacing;
    /*
     * 간격 규칙만 따로 보려면 길·성문에 걸리지 않는 방향을 골라야 한다 —
     * 판정은 순서대로 돌아서 길이 먼저 걸리면 'on_path' 가 나온다.
     */
    const dir = [0, 45, 90, 135, 180, 225, 270, 315]
      .map((deg) => (deg * Math.PI) / 180)
      .find((rad) => w.canBuildAt(
        first.x + Math.cos(rad) * (gap + 6),
        first.z + Math.sin(rad) * (gap + 6),
      ) === 'ok');
    expect(dir, '간격 밖에 지을 수 있는 방향이 없다').toBeDefined();

    // 같은 방향으로 간격 안쪽이면 막힌다
    expect(
      w.canBuildAt(first.x + Math.cos(dir!) * (gap - 4), first.z + Math.sin(dir!) * (gap - 4)),
    ).toBe('too_close');
  });

  it('성문 앞 광장과 전장 밖은 막힌다', () => {
    const w = world();
    const gate = w.castlePosition();
    expect(w.canBuildAt(gate.x, gate.z)).toBe('castle');
    expect(w.canBuildAt(-50, 300)).toBe('out_of_bounds');
    expect(w.canBuildAt(10, 10)).toBe('out_of_bounds');
    expect(w.canBuildAt(BALANCE.mapWidth + 20, 300)).toBe('out_of_bounds');
  });

  it('레벨이 정한 수만큼만 세울 수 있다 (기본값은 추천 자리 수)', () => {
    for (const level of LEVEL_ORDER) {
      const w = new World({ level, seed: 1 });
      w.economy.add(100000);
      expect(w.maxTowers).toBe(level.buildSlots.length);
      for (const slot of level.buildSlots) expect(w.build(slot)).toBe('ok');
      expect(w.towerCount).toBe(w.maxTowers);

      // 한도를 채우면 어디를 골라도 'limit' 이다 — 자리 문제보다 먼저 걸린다.
      const anywhere = w.canBuildAt(level.buildSlots[0].x + 200, level.buildSlots[0].z);
      expect(anywhere).toBe('limit');
    }
  });

  it('팔면 그 자리도 한도도 돌아온다', () => {
    const w = rich();
    for (const slot of LEVEL_01.buildSlots) w.build(slot);
    expect(w.build({ x: 250, z: 250 })).toBe('limit');

    const first = LEVEL_01.buildSlots[0];
    expect(w.sell(spotKey(first.x, first.z))).toBeGreaterThan(0);
    expect(w.towerCount).toBe(LEVEL_01.buildSlots.length - 1);
    expect(w.build(first)).toBe('ok');
  });

  it('자리 id 는 좌표 그 자체다 (같은 자리는 언제나 같은 이름)', () => {
    const w = rich();
    const slot = LEVEL_01.buildSlots[1];
    w.build(slot);
    const id = spotKey(slot.x, slot.z);
    expect(w.towers.get(id)?.slotId).toBe(id);
    expect(spotFromKey(id)).toEqual({ x: Math.round(slot.x), z: Math.round(slot.z) });
    expect(spotFromKey('그런 자리 없음')).toBeNull();
    // 반올림 오차 안쪽이면 같은 이름이 나온다
    expect(spotKey(slot.x + 0.2, slot.z - 0.3)).toBe(id);
  });

  /*
   * 화면에 그리는 "건설 가능 위치"는 이 목록이다. 뷰가 규칙을 다시 구현하지 않으므로
   * 여기서 나온 자리는 반드시 실제로 지어져야 한다 — 안 그러면 눌러도 안 되는 표시가 뜬다.
   */
  it('표시되는 자리는 전부 실제로 지을 수 있다', () => {
    for (const level of LEVEL_ORDER) {
      const w = new World({ level, seed: 1 });
      w.economy.add(100000);
      const spots = w.buildableSpots();
      expect(spots.length, level.id).toBeGreaterThan(20);
      for (const s of spots) expect(w.canBuildAt(s.x, s.z), `${level.id} ${s.x},${s.z}`).toBe('ok');
      // 길 위를 표시하지 않는다
      expect(spots.every((s) => w.canBuildAt(s.x, s.z) === 'ok')).toBe(true);
    }
  });

  it('세우면 그 자리가, 다 쓰면 전부 표시에서 빠진다', () => {
    const w = rich();
    const before = w.buildableSpots();
    // 표시된 자리 하나를 그대로 눌러 짓는다 — 표시와 실제가 같은 규칙을 본다는 뜻이다.
    const target = before[Math.floor(before.length / 2)];
    expect(w.build(target)).toBe('ok');

    const after = w.buildableSpots();
    expect(after.length).toBeLessThan(before.length);
    // 세운 자리 둘레(towerSpacing 안쪽)는 사라졌다
    expect(
      after.every(
        (s) => Math.hypot(s.x - target.x, s.z - target.z) >= BALANCE.placement.towerSpacing,
      ),
    ).toBe(true);

    for (const slot of LEVEL_01.buildSlots.slice(1)) w.build(slot);
    expect(w.towerCount).toBe(w.maxTowers);
    expect(w.buildableSpots()).toHaveLength(0);
  });

  it('막힌 이유는 저마다 다른 문장을 갖는다 (HUD 가 그대로 말한다)', () => {
    const reasons = (['on_path', 'too_close', 'castle', 'out_of_bounds', 'limit'] as const).map(
      placementReason,
    );
    expect(new Set(reasons).size).toBe(reasons.length);
    for (const r of reasons) expect(r.length).toBeGreaterThan(0);
    expect(placementReason('ok')).toBe('');
  });
});
