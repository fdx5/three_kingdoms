/**
 * 프리미티브 시각 스펙.
 * 에셋(GLTF)이 없어도 게임이 돌아가야 한다 (확장성 5원칙 #5).
 * 이 스펙은 순수 데이터이며 three를 모른다 — view/AssetRegistry가 해석한다.
 */

export type PrimitiveShape = 'box' | 'sphere' | 'capsule' | 'cylinder' | 'cone' | 'torus' | 'plane';

export interface PrimitivePart {
  shape: PrimitiveShape;
  /** 셰이프별 치수. box: [w,h,d] / sphere: [r] / capsule: [r,len] /
   *  cylinder: [rTop,rBottom,h] / cone: [r,h] / torus: [r,tube] / plane: [w,h] */
  size: number[];
  /** 부모(엔티티 루트) 기준 오프셋 [x, y, z] */
  offset?: [number, number, number];
  /** 라디안 회전 [x, y, z] */
  rotation?: [number, number, number];
  /** '#rrggbb' */
  color: string;
  roughness?: number;
  metalness?: number;
  /** 0~1. 1 미만이면 transparent */
  opacity?: number;
  /** 양면 렌더 (깃발 판 등) */
  doubleSided?: boolean;
  /** 이 파트를 식별하는 태그. 뷰가 특정 파트만 찾아 애니메이트할 때 쓴다. */
  tag?: string;
}

export interface PrimitiveSpec {
  parts: PrimitivePart[];
  /** 전체 프리미티브에 곱해지는 스케일 */
  scale?: number;
}
