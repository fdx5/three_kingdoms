import type { UnitDef } from '../types/units';
import type { PrimitiveSpec } from '../types/primitives';
import { infantryPrimitive, cavalryPrimitive, generalTrim, SKIN } from './unitPrimitives';

/**
 * 레벨 2 — 동탁 토벌전. 서량군.
 *
 * 레벨 1이 "업그레이드" 하나를 가르쳤다면, 레벨 2는 "속성에는 답이 따로 있다"를 가르친다.
 * 속성마다 답이 되는 타워가 다르다:
 *   방패병 -> 벽력거     공성 피해는 원거리 저항을 무시한다
 *   철기   -> 철질려 진지 감속으로 묶어 사거리 안 체류 시간을 늘린다
 *   도사   -> 타게팅     선두가 아니라 도사를 먼저 끊어야 앞줄이 죽는다
 *   여포   -> 감속       돌진 중에는 망루 하나를 통째로 지나친다
 */

const XL_CLOTH = '#3f4652';
const XL_STEEL = '#8e97a3';
const XL_RED = '#7d2b2b';

/** 서량 방패병 — 몸 옆에 큰 방패 판. 위에서 봐도 방패가 보인다. */
function shieldPrimitive(): PrimitiveSpec {
  const base = infantryPrimitive(XL_CLOTH, XL_STEEL);
  return {
    parts: [
      // 창을 빼고 방패를 든다
      ...base.parts.filter((p) => p.tag !== 'weapon' && p.tag !== 'spearhead'),
      { shape: 'box', size: [3, 26, 20], offset: [7, 15, 0], color: XL_STEEL, roughness: 0.55, metalness: 0.45, tag: 'shield' },
      { shape: 'torus', size: [5, 1.6], offset: [8.6, 15, 0], rotation: [0, 0, Math.PI / 2], color: '#c9a227', roughness: 0.5, metalness: 0.6, tag: 'shield_boss' },
    ],
  };
}

/** 종군 도사 — 머리 위 청록 구슬과 발밑 고리가 회복 오라의 표식이다. */
function healerPrimitive(): PrimitiveSpec {
  return {
    parts: [
      { shape: 'capsule', size: [5.5, 13], offset: [0, 12, 0], color: '#2f5d54', roughness: 0.9, tag: 'body' },
      { shape: 'sphere', size: [4.6], offset: [0, 24, 0], color: SKIN, roughness: 0.85, tag: 'head' },
      { shape: 'cone', size: [7, 8], offset: [0, 29, 0], color: '#1f4038', roughness: 0.9, tag: 'hood' },
      { shape: 'cylinder', size: [1, 1, 36], offset: [7, 20, 0], color: '#5b4632', roughness: 1, tag: 'staff' },
      // 구슬 — 이게 보이면 "회복시키는 놈"이다
      { shape: 'sphere', size: [4.5], offset: [7, 40, 0], color: '#5fe6c8', roughness: 0.25, tag: 'orb' },
      { shape: 'torus', size: [10, 1.2], offset: [0, 3, 0], rotation: [Math.PI / 2, 0, 0], color: '#5fe6c8', opacity: 0.5, roughness: 0.4, tag: 'aura_ring' },
    ],
  };
}

/** 장수(화웅·여포) — 기병 형상에 망토와 등 뒤 깃발 */
function generalPrimitive(cloak: string, flag: string): PrimitiveSpec {
  return {
    parts: [...cavalryPrimitive(XL_CLOTH, XL_STEEL).parts, ...generalTrim(cloak, flag, XL_STEEL)],
  };
}

export const XILIANG_UNITS: Record<string, UnitDef> = {
  xl_infantry: {
    id: 'xl_infantry',
    displayName: '서량 보병',
    faction: 'xiliang',
    hp: 34,
    speed: 50,
    goldOnKill: 12,
    castleDamage: 18,
    scale: 1.0,
    kind: 'minion',
    // 보병 모델은 진영을 가리지 않고 같은 것을 쓴다 (docs/ASSETS.md)
    view: { primitive: infantryPrimitive(XL_CLOTH, XL_STEEL), modelId: 'yt_infantry' },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit' },
  },

  xl_shield: {
    id: 'xl_shield',
    displayName: '서량 방패병',
    faction: 'xiliang',
    hp: 90,
    speed: 38,
    goldOnKill: 22,
    castleDamage: 30,
    scale: 1.15,
    kind: 'minion',
    view: { primitive: shieldPrimitive(), modelId: 'xl_shield' },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit_shield' },
    // 화살 피해를 72% 흘린다. 궁노 망루만으로는 뚫을 수 없다 — 답은 공성 피해(벽력거)다.
    traits: { rangedResist: 0.72 },
  },

  xl_cavalry: {
    id: 'xl_cavalry',
    displayName: '서량 철기',
    faction: 'xiliang',
    hp: 26,
    speed: 112,
    goldOnKill: 14,
    castleDamage: 24,
    scale: 1.1,
    kind: 'minion',
    view: { primitive: cavalryPrimitive(XL_CLOTH, XL_STEEL), modelId: 'cavalry' },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit' },
  },

  xl_healer: {
    id: 'xl_healer',
    displayName: '종군 도사',
    faction: 'xiliang',
    hp: 70,
    speed: 44,
    goldOnKill: 30,
    castleDamage: 20,
    scale: 1.05,
    kind: 'minion',
    view: { primitive: healerPrimitive(), modelId: 'xl_healer' },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit' },
    // 주변을 초당 14씩 회복시킨다. 먼저 끊지 않으면 앞줄이 녹지 않는다.
    traits: { healAura: { radius: 90, hps: 14 } },
  },

  huaxiong: {
    id: 'huaxiong',
    displayName: '화웅',
    faction: 'xiliang',
    hp: 950,
    speed: 46,
    goldOnKill: 300,
    castleDamage: 100,
    scale: 1.9,
    kind: 'elite',
    // 중간보스는 1장 두목과 같은 모델을 쓴다
    view: { primitive: generalPrimitive(XL_RED, '#a03030'), modelId: 'yt_captain' },
    audio: { spawn: 'sfx_boss_spawn', die: 'sfx_die_boss', hit: 'sfx_hit' },
    traits: { rangedResist: 0.25 },
  },

  lubu: {
    id: 'lubu',
    displayName: '여포',
    faction: 'xiliang',
    hp: 2400,
    speed: 44,
    goldOnKill: 800,
    castleDamage: 160,
    scale: 2.2,
    kind: 'boss',
    // 적토마를 탄 여포. 말이 달리고 기수가 방천화극을 내지른다 (docs/ASSETS.md)
    view: { primitive: generalPrimitive('#6d1414', '#e8c547'), modelId: 'lubu' },
    audio: { spawn: 'sfx_boss_spawn', die: 'sfx_die_boss', hit: 'sfx_hit' },
    /**
     * 여포의 고유 능력 — 무쌍.
     * 8초마다 3초간 속도가 2.6배가 된다. 감속으로 묶어두지 않으면
     * 돌진 한 번에 망루 하나의 사거리를 통째로 지나친다.
     */
    traits: {
      rangedResist: 0.3,
      charge: { every: 8, duration: 3, speedMul: 2.6 },
    },
  },
};
