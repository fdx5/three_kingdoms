import type { UnitDef } from '../types/units';
import type { PrimitiveSpec } from '../types/primitives';
import { infantryPrimitive, cavalryPrimitive, generalTrim } from './unitPrimitives';

/**
 * 레벨 6 — 오장원. 제갈량의 북벌군. 마지막 장.
 *
 * 앞의 다섯 장이 낸 문제가 여기서 한꺼번에 온다 —
 * 저항(2장) · 물량과 속도(3장) · 화공(4장) · 화염 저항(5장).
 * 레벨 6이 가르치는 것은 **전부 쓴다**: 타워 다섯 종류와 성문 여섯 단계가
 * 모두 있어야 마지막 웨이브를 넘긴다.
 *
 *   연노병     제갈연노 — 얇지만 무섭게 빠르고 수가 많다
 *   백이병     사슬갑주. 화살도 불도 반쯤 흘린다
 *   목우유마   보급 수레 — 주변을 회복시키며 굴러온다. 끊지 않으면 앞줄이 안 죽는다
 *   강유       10파. 돌진 + 전군 가속
 *   제갈량     15파. 팔진도 — 모든 저항을 두르고 전군을 회복·가속시킨다
 */

const SHU_CLOTH = '#5a2b2b';
const SHU_STEEL = '#c2c7cc';
const SHU_GOLD = '#d9b64a';

/** 연노병 — 손에 든 상자 모양 연노. 창병과 실루엣이 다르다. */
function repeaterPrimitive(): PrimitiveSpec {
  const base = infantryPrimitive(SHU_CLOTH, SHU_GOLD);
  return {
    parts: [
      ...base.parts.filter((p) => p.tag !== 'weapon' && p.tag !== 'spearhead'),
      { shape: 'box', size: [5, 6, 14], offset: [7, 19, 4], color: '#4a3826', roughness: 0.9, tag: 'repeater' },
      { shape: 'box', size: [14, 1.4, 1.4], offset: [7, 22, 4], color: '#8e97a3', roughness: 0.5, metalness: 0.5, tag: 'repeater_arm' },
      { shape: 'box', size: [3.4, 5, 3.4], offset: [7, 24, 2], color: SHU_GOLD, roughness: 0.4, metalness: 0.5, tag: 'magazine' },
    ],
  };
}

/** 백이병 — 흰 사슬갑주. 어깨와 정수리가 은빛이라 무리 속에서 밝게 뜬다. */
function chainmailPrimitive(): PrimitiveSpec {
  const base = infantryPrimitive('#4a4f56', '#e8ebef');
  return {
    parts: [
      ...base.parts,
      { shape: 'box', size: [17, 4, 10], offset: [0, 21, 0], color: '#d6dae0', roughness: 0.35, metalness: 0.65, tag: 'pauldron' },
      { shape: 'torus', size: [6.6, 1.8], offset: [0, 14, 0], rotation: [Math.PI / 2, 0, 0], color: '#c2c7cc', roughness: 0.35, metalness: 0.6, tag: 'chain' },
    ],
  };
}

/** 목우유마 — 나무 소·말 수레. 등 위 곡식 자루가 회복 오라의 표식이다. */
function supplyCartPrimitive(): PrimitiveSpec {
  return {
    parts: [
      { shape: 'box', size: [15, 11, 24], offset: [0, 10, 0], color: '#6b5a3f', roughness: 1, tag: 'body' },
      { shape: 'cylinder', size: [5, 5, 3], offset: [-8, 5, 7], rotation: [0, 0, Math.PI / 2], color: '#3d2f24', roughness: 1, tag: 'wheelL' },
      { shape: 'cylinder', size: [5, 5, 3], offset: [8, 5, 7], rotation: [0, 0, Math.PI / 2], color: '#3d2f24', roughness: 1, tag: 'wheelR' },
      { shape: 'sphere', size: [4.6], offset: [0, 14, 14], color: '#5b4632', roughness: 0.95, tag: 'head' },
      // 곡식 자루 — 위에서 보면 이 누런 덩어리가 먼저 보인다
      { shape: 'capsule', size: [5, 8], offset: [0, 19, -2], rotation: [0, 0, Math.PI / 2], color: '#c9a86a', roughness: 1, tag: 'sack' },
      { shape: 'torus', size: [13, 1.5], offset: [0, 3, 0], rotation: [Math.PI / 2, 0, 0], color: '#5fe6c8', opacity: 0.5, roughness: 0.4, tag: 'aura_ring' },
    ],
  };
}

function shuGeneralPrimitive(cloak: string, flag: string): PrimitiveSpec {
  return {
    parts: [...cavalryPrimitive(SHU_CLOTH, SHU_STEEL).parts, ...generalTrim(cloak, flag, SHU_STEEL)],
  };
}

/**
 * 제갈량 — 말이 아니라 사륜거(수레)에 앉아 온다. 학창의와 우선(羽扇),
 * 그리고 발밑의 팔진도 고리 둘. 이 게임의 마지막 적이다.
 */
function zhugeliangPrimitive(): PrimitiveSpec {
  return {
    parts: [
      // 사륜거
      { shape: 'box', size: [20, 8, 26], offset: [0, 8, 0], color: '#4a3826', roughness: 1, tag: 'cart' },
      { shape: 'cylinder', size: [7, 7, 3], offset: [-11, 7, 8], rotation: [0, 0, Math.PI / 2], color: '#3d2f24', roughness: 1, tag: 'wheelFL' },
      { shape: 'cylinder', size: [7, 7, 3], offset: [11, 7, 8], rotation: [0, 0, Math.PI / 2], color: '#3d2f24', roughness: 1, tag: 'wheelFR' },
      { shape: 'cylinder', size: [7, 7, 3], offset: [-11, 7, -8], rotation: [0, 0, Math.PI / 2], color: '#3d2f24', roughness: 1, tag: 'wheelBL' },
      { shape: 'cylinder', size: [7, 7, 3], offset: [11, 7, -8], rotation: [0, 0, Math.PI / 2], color: '#3d2f24', roughness: 1, tag: 'wheelBR' },
      // 학창의를 입은 몸
      { shape: 'capsule', size: [6.5, 15], offset: [0, 22, 0], color: '#eef1f4', roughness: 0.85, tag: 'body' },
      { shape: 'sphere', size: [5], offset: [0, 35, 0], color: '#c9a37a', roughness: 0.85, tag: 'head' },
      { shape: 'box', size: [11, 7, 11], offset: [0, 41, 0], color: '#2b3a4a', roughness: 0.9, tag: 'guanjin' },
      // 우선 — 흰 깃부채
      { shape: 'cylinder', size: [0.9, 0.9, 14], offset: [9, 30, 2], rotation: [0, 0, -0.3], color: '#3a2c1e', roughness: 1, tag: 'fan_handle' },
      { shape: 'plane', size: [14, 12], offset: [12, 40, 2], color: '#f5f7f9', roughness: 0.9, doubleSided: true, tag: 'fan' },
      // 팔진도 — 두 겹 고리. 회복과 가속을 동시에 두른다는 표식.
      { shape: 'torus', size: [19, 2.1], offset: [0, 3, 0], rotation: [Math.PI / 2, 0, 0], color: '#5fe6c8', opacity: 0.55, roughness: 0.4, tag: 'aura_ring' },
      { shape: 'torus', size: [25, 1.5], offset: [0, 4.5, 0], rotation: [Math.PI / 2, 0, 0], color: '#d9b64a', opacity: 0.45, roughness: 0.4, tag: 'aura_ring2' },
    ],
  };
}

export const SHU_UNITS: Record<string, UnitDef> = {
  sh_repeater: {
    id: 'sh_repeater',
    displayName: '촉 연노병',
    faction: 'shu',
    hp: 105,
    speed: 62,
    goldOnKill: 22,
    castleDamage: 20,
    scale: 1.0,
    kind: 'minion',
    view: { primitive: repeaterPrimitive(), modelId: 'yt_infantry' },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit' },
    traits: { rangedResist: 0.2 },
  },

  sh_chainmail: {
    id: 'sh_chainmail',
    displayName: '백이병',
    faction: 'shu',
    hp: 200,
    speed: 42,
    goldOnKill: 47,
    castleDamage: 34,
    scale: 1.2,
    kind: 'minion',
    view: { primitive: chainmailPrimitive(), modelId: 'xl_shield' },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit_shield' },
    /** 화살도 불도 반쯤 흘린다. 5장의 대도수보다 얕지만 수가 훨씬 많다. */
    traits: { rangedResist: 0.38, fireResist: 0.42 },
  },

  sh_supply: {
    id: 'sh_supply',
    displayName: '목우유마',
    faction: 'shu',
    hp: 460,
    speed: 34,
    goldOnKill: 95,
    castleDamage: 50,
    scale: 1.45,
    kind: 'minion',
    view: { primitive: supplyCartPrimitive() },
    audio: { die: 'sfx_die_boss', hit: 'sfx_hit_shield' },
    /**
     * 2장의 도사가 하던 일을 6장에서는 수레가 한다 — 다만 도사와 달리
     * 두껍고 감속이 통하지 않는다. 뒤로 흘려보내면 대열 전체가 회복되므로
     * 반드시 앞에서 끊어야 한다(타게팅을 strongest로 돌리는 자리).
     */
    traits: { slowImmune: true, healAura: { radius: 130, hps: 34 } },
  },

  jiangwei: {
    id: 'jiangwei',
    displayName: '강유',
    faction: 'shu',
    hp: 4600,
    speed: 50,
    goldOnKill: 420,
    castleDamage: 130,
    scale: 2.0,
    kind: 'elite',
    view: { primitive: shuGeneralPrimitive('#7a2f2f', '#d9b64a'), modelId: 'yt_captain' },
    audio: { spawn: 'sfx_boss_spawn', die: 'sfx_die_boss', hit: 'sfx_hit' },
    traits: {
      rangedResist: 0.4,
      fireResist: 0.4,
      charge: { every: 8, duration: 2.6, speedMul: 2.4 },
      speedAura: { radius: 150, speedMul: 1.28 },
    },
  },

  zhugeliang: {
    id: 'zhugeliang',
    displayName: '제갈량',
    faction: 'shu',
    hp: 9000,
    speed: 38,
    goldOnKill: 1500,
    castleDamage: 260,
    scale: 2.5,
    kind: 'boss',
    // 우선깃털부채를 든 전용 모델. 큰 소매라 팔을 따로 돌리지 않고 상체가 쓸고 지나간다.
    view: { primitive: zhugeliangPrimitive(), modelId: 'zhugeliang' },
    audio: { spawn: 'sfx_boss_spawn', die: 'sfx_die_boss', hit: 'sfx_hit' },
    /**
     * 팔진도 — 이 게임 최종보스의 답은 "한 가지로는 안 된다"이다.
     *   저항 두 겹     궁노도 화공도 절반만 들어간다. 화포와 벽력거가 필요하다
     *   회복 오라      뒤의 대열이 계속 살아난다
     *   가속 오라      전군이 1.4배로 온다
     * 셋을 동시에 두르므로 제갈량을 먼저 끊지 않으면 마지막 웨이브를 못 넘긴다.
     * 감속은 통한다 — 철질려로 묶어 화포 사거리 안에 오래 두는 것이 정답이다.
     */
    traits: {
      rangedResist: 0.55,
      fireResist: 0.55,
      healAura: { radius: 210, hps: 90 },
      speedAura: { radius: 210, speedMul: 1.4 },
    },
  },
};
