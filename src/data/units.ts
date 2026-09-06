import type { UnitDef } from '../types/units';
import type { PrimitiveSpec } from '../types/primitives';
import { infantryPrimitive } from './unitPrimitives';
import { XILIANG_UNITS } from './unitsXiliang';
import { YUAN_UNITS } from './unitsYuan';
import { WU_UNITS } from './unitsWu';
import { JING_UNITS } from './unitsJing';
import { SHU_UNITS } from './unitsShu';

/** 황건적 색 — 노란 두건이 이 진영의 시그니처다. */
const TURBAN_YELLOW = '#d4a017';
const CRIMSON = '#8f1d1d';
const CLOTH_DARK = '#4a4038';

/** 두목/장각: 같은 형상을 키우고 진홍색 + 등 뒤 깃발 판. */
function captainPrimitive(bodyColor: string, flagColor: string): PrimitiveSpec {
  const base = infantryPrimitive(bodyColor, TURBAN_YELLOW);
  return {
    parts: [
      ...base.parts,
      // 등 뒤 깃발 (plane, 양면)
      { shape: 'cylinder', size: [0.9, 0.9, 44], offset: [-7, 24, -4], color: '#3a2c1e', roughness: 1.0, tag: 'flagpole' },
      { shape: 'plane', size: [22, 16], offset: [-18, 40, -4], rotation: [0, Math.PI / 2, 0], color: flagColor, roughness: 0.95, doubleSided: true, tag: 'flag' },
      // 어깨 갑주
      { shape: 'box', size: [16, 3.5, 9], offset: [0, 21, 0], color: '#2f2a26', roughness: 0.7, metalness: 0.3, tag: 'armor' },
    ],
  };
}

export const YELLOW_TURBAN_UNITS: Record<string, UnitDef> = {
  yt_infantry: {
    id: 'yt_infantry',
    displayName: '황건적 보병',
    faction: 'yellow_turban',
    hp: 20,
    speed: 50,
    goldOnKill: 10,
    castleDamage: 20,
    scale: 1.0,
    kind: 'minion',
    view: {
      primitive: infantryPrimitive(CLOTH_DARK, TURBAN_YELLOW),
      // manifest.json 에서 이 id를 지우면 위 프리미티브로 즉시 되돌아간다
      modelId: 'yt_infantry',
    },
    audio: { die: 'sfx_die_small', hit: 'sfx_hit' },
  },

  yt_captain: {
    id: 'yt_captain',
    displayName: '황건적 두목',
    faction: 'yellow_turban',
    hp: 500,
    speed: 40,
    goldOnKill: 200,
    castleDamage: 100,
    scale: 2.0,
    kind: 'elite',
    view: {
      // 보병과 같은 34u 로 구웠고, 위 scale 2.0 이 곱해져 화면에서는 두 배가 된다
      primitive: captainPrimitive(CRIMSON, TURBAN_YELLOW),
      modelId: 'yt_captain',
    },
    audio: { spawn: 'sfx_boss_spawn', die: 'sfx_die_boss', hit: 'sfx_hit' },
  },

  zhangjiao: {
    id: 'zhangjiao',
    displayName: '장각',
    faction: 'yellow_turban',
    hp: 1000,
    speed: 38,
    goldOnKill: 500,
    castleDamage: 100,
    // 중간보스와 같은 크기. 최종보스는 크기가 아니라 체력과 연출로 구별된다.
    scale: 2.0,
    kind: 'boss',
    view: {
      primitive: captainPrimitive('#6d1414', '#e8c547'),
      modelId: 'zhangjiao',
    },
    audio: { spawn: 'sfx_boss_spawn', die: 'sfx_die_boss', hit: 'sfx_hit' },
  },
};

/**
 * 모든 유닛. 새 진영을 추가하면 파일 하나 만들고 여기에 스프레드 한 줄이면 된다.
 * id가 겹치면 뒤의 진영이 이기므로 tests/data.test.ts 가 유일성을 검사한다.
 */
export const UNITS: Record<string, UnitDef> = {
  ...YELLOW_TURBAN_UNITS,
  ...XILIANG_UNITS,
  ...YUAN_UNITS,
  ...WU_UNITS,
  ...JING_UNITS,
  ...SHU_UNITS,
};

export function getUnit(id: string): UnitDef {
  const u = UNITS[id];
  if (!u) throw new Error(`unknown unit id: ${id}`);
  return u;
}

export const UNIT_LIST: UnitDef[] = Object.values(UNITS);
