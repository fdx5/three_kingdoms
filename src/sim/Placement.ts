import type { Path } from './Path';
import { BALANCE } from '../data/balance';

/**
 * 타워를 어디에 세울 수 있는가.
 *
 * 예전에는 레벨이 정한 슬롯 위에만 지을 수 있었다(BuildSlotDef). 지금은 빈 땅
 * 아무 데나 지을 수 있고, 대신 **개수**가 레벨의 예산이다(LevelDef.maxTowers).
 * 그래서 "어느 자리가 좋은가"를 고르는 것이 곧 플레이가 된다 — 예전에는
 * 레벨이 대신 골라 주던 판단이다.
 *
 * 규칙은 네 가지뿐이고 전부 BALANCE.placement 에 수치가 있다.
 * 여기서 하는 일은 그 수치를 읽어 한 지점을 판정하는 것뿐이다 —
 * 시뮬(World.build)과 뷰(건설 미리보기)가 **같은 함수**로 판정해야
 * "지을 수 있어 보이는데 안 지어지는" 자리가 생기지 않는다.
 */
export type PlacementCheck =
  /** 지을 수 있다 */
  | 'ok'
  /** 길 위 또는 길가 — 적이 지나갈 자리는 비워 둔다 */
  | 'on_path'
  /** 다른 타워와 너무 가깝다 */
  | 'too_close'
  /** 성문 앞 광장 */
  | 'castle'
  /** 맵 밖 또는 가장자리 여백 */
  | 'out_of_bounds'
  /** 이 레벨의 타워 예산을 다 썼다 */
  | 'limit';

/** 지어진 타워 한 기의 자리. World.towers 와 뷰가 같은 모양으로 쓴다. */
export interface Spot {
  x: number;
  z: number;
}

/**
 * 자리 id — 좌표 그 자체다.
 *
 * 슬롯이 없어졌으므로 타워를 부를 이름도 없어졌다. 새로 번호를 매기면
 * (tower-1, tower-2...) 같은 자리에 다시 지을 때 id 가 달라져서, 저장·리플레이·
 * 뷰 캐시가 "같은 자리"를 다른 것으로 본다. 좌표를 반올림해 id 로 쓰면
 * 자리가 곧 이름이라 그런 어긋남이 없다.
 */
export function spotKey(x: number, z: number): string {
  return `${Math.round(x)},${Math.round(z)}`;
}

/** id 를 좌표로 되돌린다. 형식이 아니면 null. */
export function spotFromKey(key: string): Spot | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key);
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}

export interface PlacementContext {
  path: Path;
  /**
   * 이미 세워진 타워들의 자리.
   * 여러 번 순회하므로 배열처럼 **다시 읽을 수 있는** 것이어야 한다
   * (Map 이터레이터를 넘기면 두 번째 판정부터 비어 보인다).
   */
  taken: readonly Spot[];
  /** 지금까지 세운 수 */
  built: number;
  /** 이 레벨이 허용하는 총 수 */
  maxTowers: number;
  /** 성문 위치 (경로의 끝) */
  castle: Spot;
}

/**
 * 한 지점에 지을 수 있는지 판정한다.
 *
 * 순서가 곧 사용자에게 보여줄 이유의 우선순위다 — 예산이 먼저다.
 * "여기는 길이라 안 됩니다"보다 "타워를 다 썼습니다"가 먼저 알아야 할 사실이다.
 */
export function checkPlacement(ctx: PlacementContext, x: number, z: number): PlacementCheck {
  if (ctx.built >= ctx.maxTowers) return 'limit';

  const p = BALANCE.placement;
  if (
    x < p.edgeMargin ||
    z < p.edgeMargin ||
    x > BALANCE.mapWidth - p.edgeMargin ||
    z > BALANCE.mapDepth - p.edgeMargin
  ) {
    return 'out_of_bounds';
  }

  // 성문 앞이 길 판정보다 먼저다. 성문은 경로의 끝이라 둘 다 걸리는데,
  // 거기서는 "길 위"보다 "성문 앞"이 사람이 납득하는 이유다.
  if (Math.hypot(x - ctx.castle.x, z - ctx.castle.z) < p.castleClearance) return 'castle';

  // 길 위는 안 된다. 길 리본의 반폭(44)에 발판만큼을 더한 값이 기준이다 —
  // 이 판정을 통과하는 자리는 예전의 슬롯들이 지키던 것과 같은 거리다.
  if (ctx.path.lengthWithinRadius(x, z, p.pathClearance) > 0) return 'on_path';

  for (const t of ctx.taken) {
    if (Math.hypot(x - t.x, z - t.z) < p.towerSpacing) return 'too_close';
  }
  return 'ok';
}

/**
 * 지금 지을 수 있는 자리들을 격자로 훑어 돌려준다 — 화면에 "여기 지을 수 있다"를
 * 그리기 위한 것이다.
 *
 * 자유 배치의 유일한 불친절은 "어디가 빈 땅인지 눈에 안 보인다"였다. 규칙(길에서 46,
 * 성문에서 100, 타워끼리 44)은 머릿속에서 계산할 수 있는 것이 아니므로 보여줘야 한다.
 * 뷰가 규칙을 다시 구현하지 않고 이 함수를 쓰면, 표시된 자리는 반드시 실제로 지어진다.
 *
 * step 은 표시 격자의 간격이다. 타워 간격(44)보다 촘촘하면 표시가 뭉개지므로
 * 기본값은 그보다 넓다 — 표시는 "이 근방이면 된다"를 뜻하고, 실제로 누른 좌표는
 * checkPlacement 가 다시 판정한다.
 */
export function buildableSpots(ctx: PlacementContext, step = 50): Spot[] {
  const out: Spot[] = [];
  if (ctx.built >= ctx.maxTowers) return out;
  const half = step / 2;
  for (let x = half; x < BALANCE.mapWidth; x += step) {
    for (let z = half; z < BALANCE.mapDepth; z += step) {
      if (checkPlacement(ctx, x, z) === 'ok') out.push({ x, z });
    }
  }
  return out;
}

/** 판정 결과를 사람이 읽을 한 줄로. HUD 안내와 테스트가 같이 쓴다. */
export function placementReason(check: PlacementCheck): string {
  switch (check) {
    case 'ok':
      return '';
    case 'on_path':
      return '길 위에는 세울 수 없습니다';
    case 'too_close':
      return '다른 망루와 너무 가깝습니다';
    case 'castle':
      return '성문 앞은 비워 두어야 합니다';
    case 'out_of_bounds':
      return '전장 밖입니다';
    case 'limit':
      return '이 전장에 세울 수 있는 망루를 다 썼습니다';
  }
}
