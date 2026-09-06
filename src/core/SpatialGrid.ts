/**
 * 셀 크기 = 타워 사거리(기본 100u)인 균등 격자.
 * 매 스텝 적 위치로 갱신하고, 타워는 인접 9셀만 조회한다.
 * 적이 50기를 넘어가면 전수 검사와 체감 차이가 난다.
 */
export class SpatialGrid<T> {
  private cells = new Map<number, T[]>();
  private readonly invCell: number;

  constructor(readonly cellSize: number) {
    this.invCell = 1 / cellSize;
  }

  private key(cx: number, cz: number): number {
    // 좌표를 16bit로 접어 하나의 정수 키로. 맵이 1200x700이라 충돌 없음.
    return ((cx + 32768) << 16) | (cz + 32768);
  }

  clear(): void {
    // Map 자체를 버리지 않고 배열만 비워 재할당을 줄인다.
    for (const arr of this.cells.values()) arr.length = 0;
  }

  insert(x: number, z: number, item: T): void {
    const cx = Math.floor(x * this.invCell);
    const cz = Math.floor(z * this.invCell);
    const k = this.key(cx, cz);
    let arr = this.cells.get(k);
    if (!arr) {
      arr = [];
      this.cells.set(k, arr);
    }
    arr.push(item);
  }

  /** 반경 r 안에 있을 "가능성"이 있는 후보를 out에 담는다 (정확한 거리 검사는 호출자 몫) */
  queryRadius(x: number, z: number, r: number, out: T[]): T[] {
    out.length = 0;
    const minCx = Math.floor((x - r) * this.invCell);
    const maxCx = Math.floor((x + r) * this.invCell);
    const minCz = Math.floor((z - r) * this.invCell);
    const maxCz = Math.floor((z + r) * this.invCell);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const arr = this.cells.get(this.key(cx, cz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    }
    return out;
  }
}
