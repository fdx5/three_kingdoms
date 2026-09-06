import type { UnitDef } from '../types/units';
import type { PrimitiveSpec } from '../types/primitives';
import { infantryPrimitive, cavalryPrimitive, generalTrim, SKIN } from './unitPrimitives';

/**
 * 레벨 5 — 번성 공방전. 관우의 형주군.
 *
 * 관우는 한수를 터뜨려 번성을 물에 잠기게 했다(수엄칠군). 그래서 이 장의 적은
 * 전부 **젖어 있다** — 4장에서 배운 화공이 여기서는 통하지 않는다.
 * 레벨 5가 가르치는 것은 **답은 하나가 아니다**: 불이 막히면 포탄으로 뚫는다.
 *
 *   형주 수군   fireResist 0.8 — 화공 망루가 거의 아무 일도 못 한다
 *   대도수      두껍고 원거리 저항까지 있다. 답은 오직 공성 피해
 *   공성 목우   감속 면역 + 아주 두껍다. 시간을 벌 수 없으니 화력으로 부순다
 *   관평        10파. 단단하고 빠르다
 *   관우        15파. 청룡언월도 — 돌진하면서 전군을 이끈다
 */

const JZ_CLOTH = '#3c4a5e';
const JZ_STEEL = '#9fa8b4';
const JZ_GREEN = '#2f6b3a';

/** 젖은 수군 — 몸에 물빛 얼룩. 위에서 보면 푸르스름하다. */
function soakedPrimitive(): PrimitiveSpec {
  const base = infantryPrimitive(JZ_CLOTH, '#6fb7f5');
  return {
    parts: [
      ...base.parts,
      { shape: 'torus', size: [6.4, 1.6], offset: [0, 7, 0], rotation: [Math.PI / 2, 0, 0], color: '#6fb7f5', opacity: 0.6, roughness: 0.25, tag: 'soak' },
      { shape: 'sphere', size: [2.4], offset: [-4, 4, 3], color: '#8fd0ff', opacity: 0.55, roughness: 0.2, tag: 'drip' },
    ],
  };
}

/** 대도수 — 긴 언월도와 어깨 갑주 */
function halberdPrimitive(): PrimitiveSpec {
  const base = infantryPrimitive(JZ_CLOTH, JZ_GREEN);
  return {
    parts: [
      ...base.parts.filter((p) => p.tag !== 'weapon' && p.tag !== 'spearhead'),
      { shape: 'box', size: [18, 4, 10], offset: [0, 21, 0], color: '#39424f', roughness: 0.6, metalness: 0.45, tag: 'pauldron' },
      { shape: 'cylinder', size: [1.1, 1.1, 40], offset: [7, 22, 1], rotation: [0.18, 0, -0.12], color: '#4a3826', roughness: 1, tag: 'pole' },
      // 초승달 날 — 위에서 봐도 언월도라는 게 읽힌다
      { shape: 'torus', size: [6, 1.4], offset: [9, 42, 2], rotation: [0, 0.5, 0], color: JZ_STEEL, roughness: 0.35, metalness: 0.6, tag: 'blade' },
    ],
  };
}

/** 공성 목우 — 나무 수레에 씌운 소머리. 낮고 넓어서 위에서 크게 보인다. */
function oxCartPrimitive(): PrimitiveSpec {
  return {
    parts: [
      { shape: 'box', size: [16, 12, 26], offset: [0, 10, 0], color: '#5b4632', roughness: 1, tag: 'body' },
      { shape: 'box', size: [18, 4, 28], offset: [0, 17, 0], color: '#3e3125', roughness: 1, tag: 'roof' },
      { shape: 'cylinder', size: [5.5, 5.5, 3], offset: [-8, 5, 8], rotation: [0, 0, Math.PI / 2], color: '#3d2f24', roughness: 1, tag: 'wheelL' },
      { shape: 'cylinder', size: [5.5, 5.5, 3], offset: [8, 5, 8], rotation: [0, 0, Math.PI / 2], color: '#3d2f24', roughness: 1, tag: 'wheelR' },
      { shape: 'sphere', size: [5], offset: [0, 15, 15], color: '#4a3a2c', roughness: 0.95, tag: 'head' },
      { shape: 'cone', size: [2, 7], offset: [-4, 20, 15], rotation: [0, 0, -0.5], color: '#d8d0bc', roughness: 0.6, tag: 'hornL' },
      { shape: 'cone', size: [2, 7], offset: [4, 20, 15], rotation: [0, 0, 0.5], color: '#d8d0bc', roughness: 0.6, tag: 'hornR' },
      // 젖은 나무 — 이 파랑이 "불이 안 붙는다"는 표식이다
      { shape: 'torus', size: [10, 1.6], offset: [0, 3, 0], rotation: [Math.PI / 2, 0, 0], color: '#6fb7f5', opacity: 0.5, roughness: 0.3, tag: 'soak' },
    ],
  };
}

function jingGeneralPrimitive(cloak: string, flag: string): PrimitiveSpec {
  return {
    parts: [...cavalryPrimitive(JZ_CLOTH, JZ_STEEL).parts, ...generalTrim(cloak, flag, JZ_STEEL)],
  };
}

/** 관우 — 녹포에 긴 수염, 청룡언월도. 형상만으로 알아보게 한다. */
function guanyuPrimitive(): PrimitiveSpec {
  return {
    parts: [
      ...jingGeneralPrimitive(JZ_GREEN, '#1f5c2e').parts,
      // 긴 수염 — 관우의 시그니처
      { shape: 'capsule', size: [2.6, 12], offset: [0, 38, 9], color: '#2a2320', roughness: 1, tag: 'beard' },
      { shape: 'sphere', size: [4.2], offset: [0, 46, 8], color: SKIN, opacity: 0, roughness: 1, tag: 'face_anchor' },
      // 청룡언월도
      { shape: 'cylinder', size: [1.6, 1.6, 54], offset: [10, 36, 0], rotation: [0.12, 0, -0.1], color: '#3a2c1e', roughness: 1, tag: 'guandao' },
      { shape: 'torus', size: [8, 2], offset: [13, 62, 1], rotation: [0, 0.6, 0], color: '#5fe6c8', roughness: 0.3, metalness: 0.55, tag: 'guandao_blade' },
    ],
  };
}

export const JING_UNITS: Record<string, UnitDef> = {
  jz_marine: {
    id: 'jz_marine',
    displayName: '형주 수군',
    faction: 'jing',
    hp: 88,
    speed: 52,
    goldOnKill: 9,
    castleDamage: 18,
    scale: 1.0,
    kind: 'minion',
    view: { primitive: soakedPrimitive(), modelId: 'yt_infantry' },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit' },
    /**
     * 수엄칠군 — 물에 잠긴 채로 올라온다. 불이 80% 꺼진다.
     * 4장을 화공으로 이긴 플레이어에게 "그 답은 여기서 안 통한다"를 알리는 유닛이다.
     */
    traits: { fireResist: 0.8 },
  },

  jz_halberd: {
    id: 'jz_halberd',
    displayName: '형주 대도수',
    faction: 'jing',
    hp: 215,
    speed: 40,
    goldOnKill: 18,
    castleDamage: 32,
    scale: 1.18,
    kind: 'minion',
    view: { primitive: halberdPrimitive(), modelId: 'xl_shield' },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit_shield' },
    /** 화살도 불도 반쯤 흘린다. 남는 답은 공성 피해 하나다. */
    traits: { rangedResist: 0.5, fireResist: 0.55 },
  },

  jz_oxcart: {
    id: 'jz_oxcart',
    displayName: '공성 목우',
    faction: 'jing',
    hp: 380,
    speed: 30,
    goldOnKill: 42,
    castleDamage: 60,
    scale: 1.5,
    kind: 'minion',
    view: { primitive: oxCartPrimitive() },
    audio: { die: 'sfx_die_boss', hit: 'sfx_hit_shield' },
    /**
     * 느리지만 묶을 수 없고 잘 죽지도 않는다. 성문에 닿으면 피해가 크다 —
     * 이 장에서 성문 사거리를 늘려야 하는 이유가 이 수레다.
     */
    traits: { slowImmune: true, fireResist: 0.7, rangedResist: 0.35 },
  },

  guanping: {
    id: 'guanping',
    displayName: '관평',
    faction: 'jing',
    hp: 3200,
    speed: 48,
    goldOnKill: 260,
    castleDamage: 110,
    scale: 1.95,
    kind: 'elite',
    view: { primitive: jingGeneralPrimitive('#2f6b3a', '#4a9a5a'), modelId: 'yt_captain' },
    audio: { spawn: 'sfx_boss_spawn', die: 'sfx_die_boss', hit: 'sfx_hit' },
    traits: { rangedResist: 0.4, fireResist: 0.6 },
  },

  guanyu: {
    id: 'guanyu',
    displayName: '관우',
    faction: 'jing',
    hp: 5200,
    speed: 46,
    goldOnKill: 900,
    castleDamage: 200,
    scale: 2.4,
    kind: 'boss',
    view: { primitive: guanyuPrimitive(), modelId: 'lubu' },
    audio: { spawn: 'sfx_boss_spawn', die: 'sfx_die_boss', hit: 'sfx_hit' },
    /**
     * 여포의 돌진과 원소의 오라를 한 몸에 가진 최종보스.
     * 게다가 불이 75% 꺼지므로 화공 망루로는 손도 못 댄다 — 답은 화포다.
     * 돌진 중에는 감속이 걸려 있어도 방어선 하나를 통째로 지나친다.
     */
    traits: {
      rangedResist: 0.45,
      fireResist: 0.75,
      charge: { every: 9, duration: 3, speedMul: 2.4 },
      speedAura: { radius: 170, speedMul: 1.3 },
    },
  },
};
