import type { UnitDef } from '../types/units';
import type { PrimitiveSpec } from '../types/primitives';
import { infantryPrimitive, cavalryPrimitive, generalTrim, SKIN } from './unitPrimitives';

/**
 * 레벨 3 — 관도대전. 원소의 하북군.
 *
 * 레벨 1은 업그레이드를, 레벨 2는 타워 종류를 가르쳤다.
 * 레벨 3이 가르치는 것은 **시간**이다.
 *
 * 하북군의 특징은 개별 성능이 아니라 물량과 속도다. 여기 유닛들은
 * 레벨 2의 서량군보다 하나하나는 약하지만 수가 많고, 기수가 붙으면 더 빨리 온다.
 *   기수(旗手)   주변 아군 속도 x1.45 — 끊지 않으면 웨이브 전체가 앞당겨 도착한다
 *   창병         체력이 두꺼워 방어선에 오래 머문다 (그동안 뒤가 밀린다)
 *   안량         10파. 돌진 없이 그냥 단단하다
 *   원소         20파. 전군 가속 오라를 크게 두른다 — 본인을 먼저 끊어야 뒤가 늦어진다
 */

const HEBEI_CLOTH = '#2f3f52';
const HEBEI_STEEL = '#9aa6b2';
const HEBEI_BANNER = '#2b6ca3';

/** 기수 — 등 뒤가 아니라 손에 든 큰 깃발. 위에서 봐도 파란 판이 먼저 보인다. */
function bannerPrimitive(): PrimitiveSpec {
  const base = infantryPrimitive(HEBEI_CLOTH, HEBEI_STEEL);
  return {
    parts: [
      // 창을 빼고 깃대를 든다
      ...base.parts.filter((p) => p.tag !== 'weapon' && p.tag !== 'spearhead'),
      { shape: 'cylinder', size: [1.1, 1.1, 52], offset: [7, 28, 0], color: '#3a2c1e', roughness: 1, tag: 'pole' },
      {
        shape: 'plane',
        size: [24, 18],
        offset: [7, 48, -9],
        rotation: [0, 0, 0],
        color: HEBEI_BANNER,
        roughness: 0.95,
        doubleSided: true,
        tag: 'banner',
      },
      // 깃대 끝 금장 — 무리 속에서 기수를 찾는 표식
      { shape: 'sphere', size: [3], offset: [7, 55, 0], color: '#e8c547', roughness: 0.35, metalness: 0.6, tag: 'finial' },
    ],
  };
}

/** 창병 — 보병보다 긴 창과 어깨 갑주 */
function spearPrimitive(): PrimitiveSpec {
  const base = infantryPrimitive(HEBEI_CLOTH, HEBEI_STEEL);
  return {
    parts: [
      ...base.parts,
      { shape: 'box', size: [17, 3.5, 9], offset: [0, 21, 0], color: '#3b4652', roughness: 0.7, metalness: 0.35, tag: 'pauldron' },
      { shape: 'cone', size: [2.2, 8], offset: [7, 44, 0], color: HEBEI_STEEL, roughness: 0.45, metalness: 0.5, tag: 'spearhead2' },
    ],
  };
}

/** 장수(안량·원소) — 기병 형상에 망토와 깃발 */
function generalPrimitive(cloak: string, flag: string): PrimitiveSpec {
  return {
    parts: [...cavalryPrimitive(HEBEI_CLOTH, HEBEI_STEEL).parts, ...generalTrim(cloak, flag, HEBEI_STEEL)],
  };
}

/** 원소 — 장수 형상에 가속 오라의 표식(발밑 파란 고리) */
function yuanshaoPrimitive(): PrimitiveSpec {
  return {
    parts: [
      ...generalPrimitive('#1f4e79', '#e8c547').parts,
      { shape: 'torus', size: [16, 1.8], offset: [0, 3, 0], rotation: [Math.PI / 2, 0, 0], color: '#6fb7f5', opacity: 0.55, roughness: 0.4, tag: 'aura_ring' },
      { shape: 'sphere', size: [4.2], offset: [0, 5, 0], color: SKIN, opacity: 0, roughness: 1, tag: 'aura_core' },
    ],
  };
}

export const YUAN_UNITS: Record<string, UnitDef> = {
  ys_infantry: {
    id: 'ys_infantry',
    displayName: '하북 보병',
    faction: 'yuan',
    hp: 46,
    speed: 54,
    goldOnKill: 6,
    castleDamage: 14,
    scale: 1.0,
    kind: 'minion',
    // 보병 모델은 진영을 가리지 않고 같은 것을 쓴다 (docs/ASSETS.md)
    view: { primitive: infantryPrimitive(HEBEI_CLOTH, HEBEI_STEEL), modelId: 'yt_infantry' },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit' },
  },

  ys_spear: {
    id: 'ys_spear',
    displayName: '하북 창병',
    faction: 'yuan',
    hp: 130,
    speed: 44,
    goldOnKill: 11,
    castleDamage: 22,
    scale: 1.12,
    kind: 'minion',
    // 3장 주력이라 전용 모델을 붙였다. 한 손에 세워 든 긴 창 —
    // 걸을 때는 창을 세우고, 성문 앞에서는 눕혀 내지른다.
    view: { primitive: spearPrimitive(), modelId: 'ys_spear' },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit' },
    // 방패병만큼 화살을 튕기지는 않는다. 레벨 3의 문제는 저항이 아니라 물량이다.
    traits: { rangedResist: 0.3 },
  },

  ys_banner: {
    id: 'ys_banner',
    displayName: '하북 기수',
    faction: 'yuan',
    hp: 70,
    speed: 50,
    goldOnKill: 16,
    castleDamage: 16,
    scale: 1.05,
    kind: 'minion',
    view: { primitive: bannerPrimitive() },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit' },
    /**
     * 반경 110 안 아군을 1.45배로 만든다.
     * 체력이 낮아 끊기는 쉽다 — 문제는 "끊을 생각을 하느냐"다.
     * 선두만 노리는 타워는 기수를 지나쳐 버린다.
     */
    traits: { speedAura: { radius: 110, speedMul: 1.45 } },
  },

  yanliang: {
    id: 'yanliang',
    displayName: '안량',
    faction: 'yuan',
    hp: 1700,
    speed: 46,
    goldOnKill: 180,
    castleDamage: 90,
    scale: 1.9,
    kind: 'elite',
    // Blender 제작 전용 중갑 보행 장수. idle/walk/attack/die 클립을 포함한다.
    view: { primitive: generalPrimitive('#7a1f1f', '#c23a3a'), modelId: 'yanliang' },
    audio: { spawn: 'sfx_boss_spawn', die: 'sfx_die_boss', hit: 'sfx_hit' },
    traits: { rangedResist: 0.35 },
  },

  yuanshao: {
    id: 'yuanshao',
    displayName: '원소',
    faction: 'yuan',
    hp: 2800,
    speed: 42,
    goldOnKill: 500,
    castleDamage: 150,
    scale: 2.3,
    kind: 'boss',
    view: { primitive: yuanshaoPrimitive(), modelId: 'yuanshao' },
    audio: { spawn: 'sfx_boss_spawn', die: 'sfx_die_boss', hit: 'sfx_hit' },
    /**
     * 여포가 혼자 빨라졌다면 원소는 전군을 빠르게 만든다.
     * 반경 200은 마지막 웨이브의 대열을 통째로 덮는 크기다 —
     * 원소를 먼저 끊지 않으면 뒤따르는 40기가 전부 1.6배로 들이닥친다.
     */
    traits: {
      rangedResist: 0.35,
      speedAura: { radius: 200, speedMul: 1.35 },
    },
  },
};
