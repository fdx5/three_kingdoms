import type { PrimitiveSpec } from '../types/primitives';

/**
 * 진영 간에 공유하는 프리미티브 형상 빌더.
 * 진영별 유닛 파일(units.ts, unitsXiliang.ts)이 이걸 가져다 색만 바꿔 쓴다.
 *
 * 카메라가 45도 부감이라 화면에서 가장 크게 보이는 면은 "위"다.
 * 진영을 구분하는 색은 반드시 머리 꼭대기나 어깨처럼 위에서 보이는 곳에 둘 것 —
 * 챙 넓은 삿갓 아래에 넣으면 전부 검은 덩어리로만 보인다.
 */

export const SKIN = '#c9a37a';

/** 보병 기본형: 캡슐 몸통 + 머리 + 정수리 진영색 + 창. 기준 키 약 34u. */
export function infantryPrimitive(bodyColor: string, accent: string): PrimitiveSpec {
  return {
    parts: [
      { shape: 'capsule', size: [5.5, 13], offset: [0, 12, 0], color: bodyColor, roughness: 0.9, tag: 'body' },
      { shape: 'sphere', size: [4.6], offset: [0, 24, 0], color: SKIN, roughness: 0.85, tag: 'head' },
      // 이마를 감는 진영색 띠
      { shape: 'torus', size: [4.9, 1.7], offset: [0, 25, 0], rotation: [Math.PI / 2, 0, 0], color: accent, roughness: 0.8, tag: 'turban' },
      // 정수리 — 위에서 봤을 때 진영색이 보이는 부분
      { shape: 'sphere', size: [4.4], offset: [0, 28, 0], color: accent, roughness: 0.8, tag: 'turban_top' },
      // 창 (진행 방향 표시도 겸한다)
      { shape: 'cylinder', size: [0.8, 0.8, 30], offset: [6, 18, 2], rotation: [0.25, 0, -0.15], color: '#5b4632', roughness: 1.0, tag: 'weapon' },
      { shape: 'cone', size: [1.6, 5], offset: [7.9, 32, 2.8], rotation: [0.25, 0, -0.15], color: '#b9b3a4', roughness: 0.5, metalness: 0.4, tag: 'spearhead' },
    ],
  };
}

/** 기병: 말 몸통 위에 기수. 길쭉한 실루엣이라 위에서도 보병과 구분된다. */
export function cavalryPrimitive(clothColor: string, metalColor: string): PrimitiveSpec {
  return {
    parts: [
      // 말
      { shape: 'capsule', size: [7, 20], offset: [0, 15, 0], rotation: [Math.PI / 2, 0, 0], color: '#4a3a2c', roughness: 0.95, tag: 'horse' },
      { shape: 'cylinder', size: [3.5, 4, 12], offset: [0, 20, 12], rotation: [0.5, 0, 0], color: '#4a3a2c', roughness: 0.95, tag: 'horse_neck' },
      { shape: 'sphere', size: [4], offset: [0, 25, 16], color: '#3d2f24', roughness: 0.95, tag: 'horse_head' },
      { shape: 'cylinder', size: [1.6, 1.6, 15], offset: [4, 7, 7], color: '#3d2f24', roughness: 1 },
      { shape: 'cylinder', size: [1.6, 1.6, 15], offset: [-4, 7, 7], color: '#3d2f24', roughness: 1 },
      { shape: 'cylinder', size: [1.6, 1.6, 15], offset: [4, 7, -7], color: '#3d2f24', roughness: 1 },
      { shape: 'cylinder', size: [1.6, 1.6, 15], offset: [-4, 7, -7], color: '#3d2f24', roughness: 1 },
      // 기수
      { shape: 'capsule', size: [4.5, 10], offset: [0, 28, -1], color: clothColor, roughness: 0.9, tag: 'body' },
      { shape: 'sphere', size: [4], offset: [0, 37, -1], color: SKIN, roughness: 0.85, tag: 'head' },
      { shape: 'cone', size: [5, 7], offset: [0, 41, -1], color: metalColor, roughness: 0.5, metalness: 0.5, tag: 'helm' },
      { shape: 'cylinder', size: [0.9, 0.9, 34], offset: [6, 30, 6], rotation: [1.2, 0, -0.1], color: '#5b4632', roughness: 1, tag: 'weapon' },
    ],
  };
}

/** 등 뒤 깃발 + 어깨 갑주. 장수·보스 공통 장식. */
export function generalTrim(cloakColor: string, flagColor: string, metalColor: string): PrimitiveSpec['parts'] {
  return [
    { shape: 'plane', size: [22, 20], offset: [0, 30, -9], rotation: [0.25, 0, 0], color: cloakColor, roughness: 0.95, doubleSided: true, tag: 'cloak' },
    { shape: 'cylinder', size: [1.2, 1.2, 50], offset: [-7, 36, -6], color: '#3a2c1e', roughness: 1, tag: 'flagpole' },
    { shape: 'plane', size: [24, 18], offset: [-18, 54, -6], rotation: [0, Math.PI / 2, 0], color: flagColor, roughness: 0.95, doubleSided: true, tag: 'flag' },
    { shape: 'box', size: [18, 4, 10], offset: [0, 33, -1], color: metalColor, roughness: 0.5, metalness: 0.5, tag: 'armor' },
  ];
}
