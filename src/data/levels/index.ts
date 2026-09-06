import type { LevelDef } from '../../types/level';
import { BALANCE } from '../balance';
import { LEVEL_01 } from './level01';
import { LEVEL_02 } from './level02';
import { LEVEL_03 } from './level03';
import { LEVEL_04 } from './level04';
import { LEVEL_05 } from './level05';
import { LEVEL_06 } from './level06';

/**
 * 레벨 레지스트리.
 * 새 레벨은 levelNN.ts 파일 하나 + 여기 배열에 한 줄이면 끝난다
 * (docs/EXTENDING.md "새 레벨 추가" 참고).
 *
 * 배열 순서가 곧 진행 순서다 — 앞 레벨을 클리어해야 다음이 열린다.
 */
export const LEVEL_ORDER: LevelDef[] = [LEVEL_01, LEVEL_02, LEVEL_03, LEVEL_04, LEVEL_05, LEVEL_06];

export const LEVELS: Record<string, LevelDef> = Object.fromEntries(
  LEVEL_ORDER.map((l) => [l.id, l]),
);

export const DEFAULT_LEVEL_ID = LEVEL_ORDER[0].id;

export function getLevel(id: string): LevelDef {
  const l = LEVELS[id];
  if (!l) throw new Error(`unknown level id: ${id}`);
  return l;
}

/** 진행 순서상 다음 레벨. 마지막이면 null. */
export function nextLevelId(id: string): string | null {
  const i = LEVEL_ORDER.findIndex((l) => l.id === id);
  return i >= 0 && i + 1 < LEVEL_ORDER.length ? LEVEL_ORDER[i + 1].id : null;
}

/**
 * 이 타워를 그 레벨에서 지을 수 있는가.
 * TowerDef.unlockedIn 이 없으면 처음부터, 있으면 그 레벨부터(그 이후 레벨 포함).
 */
export function isTowerAvailable(unlockedIn: string | undefined, levelId: string): boolean {
  if (!unlockedIn) return true;
  const need = LEVEL_ORDER.findIndex((l) => l.id === unlockedIn);
  const at = LEVEL_ORDER.findIndex((l) => l.id === levelId);
  if (need < 0 || at < 0) return false;
  return at >= need;
}

/** 그 레벨에서 지을 수 있는 타워 id 목록 (LEVEL_ORDER 순서와 무관하게 TOWERS 순서) */
export function availableTowerIds(levelId: string, towers: { id: string; unlockedIn?: string }[]): string[] {
  return towers.filter((t) => isTowerAvailable(t.unlockedIn, levelId)).map((t) => t.id);
}

/** 맵 중심 (카메라가 바라보는 지점) */
export const MAP_CENTER = { x: BALANCE.mapWidth / 2, z: BALANCE.mapDepth / 2 };

export { LEVEL_01, LEVEL_02, LEVEL_03, LEVEL_04, LEVEL_05, LEVEL_06 };
