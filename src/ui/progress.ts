import { LEVEL_ORDER, DEFAULT_LEVEL_ID } from '../data/levels';
import type { AccountService } from '../account/AccountService';
import type { LevelProgress, Stars } from '../account/types';

export type { LevelProgress } from '../account/types';

/**
 * 진행도 — 이제 브라우저가 아니라 **계정**에 붙는다.
 *
 * 실제 읽기·쓰기는 [[AccountService]]가 하고, 이 파일은 그 앞의 얇은 창구다.
 * 창구를 남겨 둔 이유는 레벨 선택 화면과 승리 처리가 렌더 경로에서 불려
 * await를 끼울 수 없기 때문이다 — 여기서 보는 값은 서비스가 들고 있는
 * 동기 스냅숏이고, 저장은 그 뒤에서 알아서 흘러간다.
 *
 * 로그인 전에는 빈 진행도를 돌려준다. 그래서 로그인하지 않은 상태로 화면이
 * 열려도 "1장만 열려 있음"이 되지, 남의 진행도가 보이지 않는다.
 */
let service: AccountService | null = null;

/** 부트에서 한 번 연결한다 (main.ts) */
export function bindProgress(next: AccountService | null): void {
  service = next;
}

const EMPTY: LevelProgress = { stars: {} };

export function loadProgress(): LevelProgress {
  return service?.progress ?? EMPTY;
}

/** 클리어 기록. 기존 기록보다 높을 때만 갱신한다. */
export function recordClear(levelId: string, stars: Stars): LevelProgress {
  return service?.recordClear(levelId, stars) ?? EMPTY;
}

/**
 * 이 장을 한 번이라도 클리어했는가.
 *
 * 별은 클리어해야만 붙으므로 별의 유무가 곧 클리어 여부다.
 * 배속 해금이 이 값을 본다 — 처음 보는 판은 1배로만 돌게 하려는 것이다.
 */
export function isLevelCleared(levelId: string, p: LevelProgress = loadProgress()): boolean {
  return (p.stars[levelId] ?? 0) > 0;
}

/**
 * 그 레벨이 열려 있는가.
 * 첫 레벨은 항상 열려 있고, 나머지는 바로 앞 레벨을 클리어해야 열린다.
 * 즉 1장을 깬 계정은 다음 접속에서 2장부터, 2장까지 깼으면 3장부터 시작할 수 있다.
 */
export function isLevelUnlocked(levelId: string, p: LevelProgress = loadProgress()): boolean {
  const i = LEVEL_ORDER.findIndex((l) => l.id === levelId);
  if (i <= 0) return i === 0;
  return !!p.stars[LEVEL_ORDER[i - 1].id];
}

/** 아직 안 깬 것 중 가장 앞선 레벨 (없으면 마지막 레벨) */
export function suggestedLevelId(p: LevelProgress = loadProgress()): string {
  for (const l of LEVEL_ORDER) {
    if (!p.stars[l.id] && isLevelUnlocked(l.id, p)) return l.id;
  }
  return LEVEL_ORDER[LEVEL_ORDER.length - 1]?.id ?? DEFAULT_LEVEL_ID;
}

/**
 * 계정이 생기기 전(브라우저 단위)에 쌓인 진행도.
 *
 * 계정 기능이 붙기 전에 플레이한 사람의 기록이 여기 남아 있다. 이 브라우저에서
 * 처음 만드는 계정 하나에만 물려주고 그 뒤로는 쓰지 않는다 —
 * 계정마다 나눠 주면 남의 진행도를 받는 셈이 되기 때문이다.
 */
const LEGACY_KEY = 'samtd.progress';
const LEGACY_CLAIMED = 'samtd.progress.claimed';

export function claimLegacyProgress(): LevelProgress | null {
  try {
    if (localStorage.getItem(LEGACY_CLAIMED)) return null;
    const raw = localStorage.getItem(LEGACY_KEY);
    localStorage.setItem(LEGACY_CLAIMED, '1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LevelProgress>;
    const stars = parsed.stars ?? {};
    return Object.keys(stars).length > 0 ? { stars } : null;
  } catch {
    return null;
  }
}
