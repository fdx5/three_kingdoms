import type { StratagemDef } from '../types/stratagems';

export const STRATAGEMS: Record<string, StratagemDef> = {
  fire_attack: {
    id: 'fire_attack',
    displayName: '화공',
    glyph: '火',
    description: '불화살 폭우로 10초간 모든 적에게 초당 60 화염 피해.',
    cost: 400,
    cooldown: 30,
    effect: { type: 'fire_storm', params: { dps: 60, duration: 10 } },
  },

  ice_storm: {
    id: 'ice_storm',
    displayName: '얼음폭풍',
    glyph: '冰',
    description: '고드름 폭우로 모든 적을 10초간 빙결. 이동·공격·오라 정지.',
    cost: 260,
    cooldown: 30,
    effect: { type: 'ice_storm', params: { duration: 10 } },
  },

  reinforcements: {
    id: 'reinforcements',
    displayName: '원군',
    glyph: '援',
    description: '10초간 모든 타워의 피해량이 50% 오른다.',
    cost: 450,
    cooldown: 35,
    effect: { type: 'rally', params: { damageMul: 1.5, duration: 10 } },
  },
};

export function getStratagem(id: string): StratagemDef {
  const s = STRATAGEMS[id];
  if (!s) throw new Error(`unknown stratagem id: ${id}`);
  return s;
}

/** 없으면 null. 상태 조회처럼 던지면 안 되는 자리에서 쓴다. */
export function findStratagem(id: string): StratagemDef | null {
  return STRATAGEMS[id] ?? null;
}

export const STRATAGEM_LIST: StratagemDef[] = Object.values(STRATAGEMS);
