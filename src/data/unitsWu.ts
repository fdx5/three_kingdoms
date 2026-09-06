import type { UnitDef } from '../types/units';
import type { PrimitiveSpec } from '../types/primitives';
import { infantryPrimitive, cavalryPrimitive, generalTrim } from './unitPrimitives';

/**
 * 레벨 4 — 합비 공방전. 손권의 강동군.
 *
 * 앞 세 장이 가르친 것은 타워였다(업그레이드 / 조합 / 시간).
 * 레벨 4가 가르치는 것은 **성문**이다 — 슬롯 다섯으로는 마지막 직선을 막을 수 없고,
 * 모자란 한 겹은 성문을 강화해서 사야 한다.
 *
 * 강동군의 특징은 "붙으면 센데 잘 탄다"다.
 *   등갑병   화살을 크게 튕기지만 기름불에는 두 배로 탄다 (화공 망루의 존재 이유)
 *   수병     평범하지만 수가 많다
 *   야습대   감녕의 백기(百騎) — 빠르고 얇다. 선두만 보는 타워는 놓친다
 *   감녕     10파. 돌진으로 방어선을 통째로 건너뛴다
 *   손권     15파. 전군을 회복시키며 밀어붙인다 — 본인을 먼저 끊어야 앞줄이 죽는다
 */

const WU_CLOTH = '#2a4d44';
const WU_STEEL = '#a8b4a0';
const WU_RED = '#8f3020';

/** 등갑병 — 몸을 감은 굵은 등나무 테. 누렇고 두꺼워서 위에서도 구별된다. */
function rattanPrimitive(): PrimitiveSpec {
  const base = infantryPrimitive(WU_CLOTH, '#c9a227');
  return {
    parts: [
      ...base.parts,
      { shape: 'torus', size: [7.4, 2.2], offset: [0, 10, 0], rotation: [Math.PI / 2, 0, 0], color: '#b9922f', roughness: 1, tag: 'rattan_lo' },
      { shape: 'torus', size: [7.2, 2.2], offset: [0, 15, 0], rotation: [Math.PI / 2, 0, 0], color: '#c9a23a', roughness: 1, tag: 'rattan_mid' },
      { shape: 'torus', size: [6.8, 2.0], offset: [0, 19.5, 0], rotation: [Math.PI / 2, 0, 0], color: '#b9922f', roughness: 1, tag: 'rattan_hi' },
      // 등나무 방패 — 화살은 여기서 튕긴다
      { shape: 'cylinder', size: [9, 9, 2.4], offset: [7.5, 15, 0], rotation: [0, 0, Math.PI / 2], color: '#d0ac4a', roughness: 1, tag: 'rattan_shield' },
    ],
  };
}

/** 야습대 — 말 없이 달리는 경장 보병. 머리에 붉은 띠 하나뿐이다. */
function raiderPrimitive(): PrimitiveSpec {
  const base = infantryPrimitive('#1e2a2f', WU_RED);
  return {
    parts: [
      // 창 대신 짧은 칼 — 실루엣이 낮고 빠르다
      ...base.parts.filter((p) => p.tag !== 'weapon' && p.tag !== 'spearhead'),
      { shape: 'box', size: [1.6, 14, 1.2], offset: [7, 20, 1], rotation: [0.2, 0, -0.5], color: '#cfd4d8', roughness: 0.4, metalness: 0.55, tag: 'blade' },
      // 등에 맨 방울 — 감녕의 백기는 방울을 달고 밤에 들이쳤다
      { shape: 'sphere', size: [2.2], offset: [-5, 22, -3], color: '#d9b64a', roughness: 0.3, metalness: 0.6, tag: 'bell' },
    ],
  };
}

/** 강동 장수 — 기병 형상에 망토와 깃발 */
function wuGeneralPrimitive(cloak: string, flag: string): PrimitiveSpec {
  return {
    parts: [...cavalryPrimitive(WU_CLOTH, WU_STEEL).parts, ...generalTrim(cloak, flag, WU_STEEL)],
  };
}

/** 손권 — 장수 형상에 회복 오라의 표식(발밑 청록 고리)과 자줏빛 수염 대신 금관 */
function sunquanPrimitive(): PrimitiveSpec {
  return {
    parts: [
      ...wuGeneralPrimitive('#2f6b5a', '#e8c547').parts,
      { shape: 'torus', size: [17, 1.9], offset: [0, 3, 0], rotation: [Math.PI / 2, 0, 0], color: '#5fe6c8', opacity: 0.55, roughness: 0.4, tag: 'aura_ring' },
      { shape: 'cylinder', size: [5.2, 5.6, 4], offset: [0, 46, 12], color: '#e8c547', roughness: 0.3, metalness: 0.7, tag: 'crown' },
    ],
  };
}

export const WU_UNITS: Record<string, UnitDef> = {
  wu_marine: {
    id: 'wu_marine',
    displayName: '강동 수병',
    faction: 'wu',
    hp: 84,
    speed: 56,
    goldOnKill: 7,
    castleDamage: 16,
    scale: 1.0,
    kind: 'minion',
    // 4장은 진영 전용 모델을 쓴다 — 둥근 방패에 환도를 찬 강동 수병이다
    view: { primitive: infantryPrimitive(WU_CLOTH, '#5fe6c8'), modelId: 'wu_marine' },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit' },
  },

  wu_rattan: {
    id: 'wu_rattan',
    displayName: '등갑병',
    faction: 'wu',
    hp: 215,
    speed: 40,
    goldOnKill: 14,
    castleDamage: 28,
    scale: 1.15,
    kind: 'minion',
    // 양손에 검을 든 등갑병. 쌍칼이라 리깅도 dual_swing 이다.
    view: { primitive: rattanPrimitive(), modelId: 'wu_rattan' },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit_shield' },
    /**
     * 등갑은 기름에 절여 말린 등나무다 — 화살은 튕기지만 불이 붙으면 사람째 탄다.
     * 이 한 줄이 4장에서 화공 망루를 짓게 만드는 유일한 장치다.
     * 궁노만으로 상대하면 저항 65%에 막혀 대열이 성문까지 도착한다.
     */
    traits: { rangedResist: 0.65, fireVuln: 2.2 },
  },

  wu_raider: {
    id: 'wu_raider',
    displayName: '강동 야습대',
    faction: 'wu',
    hp: 44,
    speed: 118,
    goldOnKill: 10,
    castleDamage: 22,
    scale: 1.05,
    kind: 'minion',
    // 몸을 다 덮는 대형 방패와 짧은 검. 가장 빠른 잡병이라 걸음 주기가 가장 짧다.
    view: { primitive: raiderPrimitive(), modelId: 'wu_raider' },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit' },
    /**
     * 서량 철기와 같은 자리의 유닛이지만 감속 면역이 붙어 철질려가 통하지 않는다.
     * 답은 "묶는 것"이 아니라 "사거리를 늘리는 것" — 성문 강화다.
     */
    traits: { slowImmune: true },
  },

  ganning: {
    id: 'ganning',
    displayName: '감녕',
    faction: 'wu',
    hp: 2100,
    speed: 50,
    goldOnKill: 220,
    castleDamage: 100,
    scale: 1.9,
    kind: 'elite',
    // 용머리 철퇴와 대형 방패를 든 강동의 맹장. scale 1.9 가 곱해져 화면에서 65u 다.
    view: { primitive: wuGeneralPrimitive(WU_RED, '#c23a3a'), modelId: 'ganning' },
    audio: { spawn: 'sfx_boss_spawn', die: 'sfx_die_boss', hit: 'sfx_hit' },
    /** 백기야습 — 6초마다 2.5초간 세 배로 달린다. 여포보다 자주, 대신 짧게. */
    traits: { rangedResist: 0.3, charge: { every: 6, duration: 2.5, speedMul: 3.0 } },
  },

  sunquan: {
    id: 'sunquan',
    displayName: '손권',
    faction: 'wu',
    hp: 3600,
    speed: 42,
    goldOnKill: 600,
    castleDamage: 160,
    scale: 2.3,
    kind: 'boss',
    // 봉황 방패와 오환도를 든 강동의 주인. scale 2.3 이 곱해져 화면에서 78u —
    // 원소와 어깨를 나란히 하고 감녕(65u)보다 확실히 크다.
    view: { primitive: sunquanPrimitive(), modelId: 'sunquan' },
    audio: { spawn: 'sfx_boss_spawn', die: 'sfx_die_boss', hit: 'sfx_hit' },
    /**
     * 원소가 전군을 빠르게 만들었다면 손권은 전군을 안 죽게 만든다.
     * 반경 190에 초당 55 회복 — 마지막 대열이 통째로 되살아나므로
     * 손권을 먼저 끊지 않으면 뒤의 40기가 영영 줄지 않는다.
     * 젖은 강동군답게 불에도 절반만 탄다.
     */
    traits: {
      rangedResist: 0.4,
      fireResist: 0.5,
      healAura: { radius: 190, hps: 55 },
    },
  },
};
