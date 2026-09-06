import type * as THREE from 'three';

export type ViewState = 'idle' | 'walk' | 'attack' | 'die';

/**
 * 확장성 5원칙 #3 — 모든 시각 표현은 이 인터페이스 뒤에 있다.
 * 프리미티브 메시 -> GLTF 모델 교체가 AssetRegistry 한 곳 수정으로 끝나야 한다.
 */
export interface EntityView<T> {
  readonly object3d: THREE.Object3D;
  mount(parent: THREE.Object3D): void;
  /** alpha = 시뮬 스텝 간 보간 계수 (0~1) */
  sync(entity: T, alpha: number, dt: number): void;
  playState(state: ViewState): void;
  dispose(): void;
}

/** 애니메이션 클립명 규약 — GLTF 제작 시 반드시 이 이름을 쓴다 (docs/ASSETS.md) */
export const CLIP_NAMES: Record<ViewState, string> = {
  idle: 'idle',
  walk: 'walk',
  attack: 'attack',
  die: 'die',
};
