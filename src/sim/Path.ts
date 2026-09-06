/**
 * 폴리라인 경로. 누적거리 LUT + 이진 탐색으로 O(log n) 조회.
 * 적은 위치를 xyz로 갖지 않고 "경로 누적거리(distance)" 스칼라만 갖는다.
 * 월드 좌표는 전부 여기서 파생된다 — 세이브/리플레이/네트워크 동기화가 가벼워진다.
 */
export interface Vec2 {
  x: number;
  z: number;
}

export class Path {
  readonly points: readonly [number, number][];
  /** cumulative[i] = points[0]..points[i] 까지의 누적거리 */
  private readonly cumulative: number[];
  /** 세그먼트별 단위 방향 벡터 */
  private readonly dirs: Vec2[];
  readonly totalLength: number;

  constructor(points: readonly [number, number][]) {
    if (points.length < 2) throw new Error('Path needs at least 2 points');
    this.points = points;

    this.cumulative = new Array(points.length);
    this.dirs = new Array(points.length - 1);
    this.cumulative[0] = 0;

    for (let i = 0; i < points.length - 1; i++) {
      const [x0, z0] = points[i];
      const [x1, z1] = points[i + 1];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len === 0) throw new Error(`Path has a zero-length segment at index ${i}`);
      this.dirs[i] = { x: dx / len, z: dz / len };
      this.cumulative[i + 1] = this.cumulative[i] + len;
    }
    this.totalLength = this.cumulative[this.cumulative.length - 1];
  }

  /** 누적거리 d를 포함하는 세그먼트 인덱스. 이진 탐색. */
  private segmentIndexAt(d: number): number {
    const cum = this.cumulative;
    let lo = 0;
    let hi = cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** 누적거리 d에서의 {x, z}. 범위 밖은 양 끝으로 클램프. */
  positionAt(d: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
    if (d <= 0) {
      out.x = this.points[0][0];
      out.z = this.points[0][1];
      return out;
    }
    if (d >= this.totalLength) {
      const last = this.points[this.points.length - 1];
      out.x = last[0];
      out.z = last[1];
      return out;
    }
    const i = this.segmentIndexAt(d);
    const t = d - this.cumulative[i];
    const dir = this.dirs[i];
    out.x = this.points[i][0] + dir.x * t;
    out.z = this.points[i][1] + dir.z * t;
    return out;
  }

  /** 진행 방향 단위 벡터 (모델 회전용) */
  directionAt(d: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
    const clamped = Math.max(0, Math.min(this.totalLength - 1e-6, d));
    const dir = this.dirs[this.segmentIndexAt(clamped)];
    out.x = dir.x;
    out.z = dir.z;
    return out;
  }

  /**
   * 점 (px, pz)에서 가장 가까운 경로 지점의 누적거리.
   * "이 슬롯은 경로의 앞쪽인가 뒤쪽인가"를 판단할 때 쓴다 —
   * 감속 타워는 앞쪽에 둬야 뒤쪽 타워에 시간을 벌어준다.
   */
  nearestDistance(px: number, pz: number): number {
    let bestD2 = Infinity;
    let bestDist = 0;
    for (let i = 0; i < this.points.length - 1; i++) {
      const [x0, z0] = this.points[i];
      const segLen = this.cumulative[i + 1] - this.cumulative[i];
      const dir = this.dirs[i];
      let t = (px - x0) * dir.x + (pz - z0) * dir.z;
      t = t < 0 ? 0 : t > segLen ? segLen : t;
      const cx = x0 + dir.x * t;
      const cz = z0 + dir.z * t;
      const d2 = (px - cx) ** 2 + (pz - cz) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestDist = this.cumulative[i] + t;
      }
    }
    return bestDist;
  }

  /**
   * 점 (px, pz)에서 반경 r 안에 들어오는 경로 길이의 합.
   * 타워 슬롯의 "좋은 자리" 판정에 쓴다 (테스트/툴 전용, 런타임 핫패스 아님).
   */
  lengthWithinRadius(px: number, pz: number, r: number): number {
    let total = 0;
    for (let i = 0; i < this.points.length - 1; i++) {
      const [x0, z0] = this.points[i];
      const segLen = this.cumulative[i + 1] - this.cumulative[i];
      const dir = this.dirs[i];
      // 점을 세그먼트 로컬 좌표로: t = 세그먼트 시작부터의 투영거리
      const tProj = (px - x0) * dir.x + (pz - z0) * dir.z;
      const perpX = px - (x0 + dir.x * tProj);
      const perpZ = pz - (z0 + dir.z * tProj);
      const perp2 = perpX * perpX + perpZ * perpZ;
      if (perp2 >= r * r) continue;
      const half = Math.sqrt(r * r - perp2);
      const lo = Math.max(0, tProj - half);
      const hi = Math.min(segLen, tProj + half);
      if (hi > lo) total += hi - lo;
    }
    return total;
  }
}
