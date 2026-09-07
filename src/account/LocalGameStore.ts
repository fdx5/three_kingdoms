import type { GameStore, Page, PageQuery } from './GameStore';
import { newId } from './GameStore';
import { constantTimeEqual } from './password';
import type { Account, GameRecord, GuestbookEntry, LevelProgress } from './types';

/**
 * localStorage 저장소 — 토르소 DB가 붙기 전까지의 구현.
 *
 * 테이블 하나를 키 하나에 담는다. 스키마는 토르소로 옮길 때 그대로 테이블이 된다:
 *   samtd.accounts   -> accounts   (PK: id)
 *   samtd.progress   -> progress   (PK: accountId, levelId)
 *   samtd.records    -> records    (PK: id, INDEX: accountId, playedAt)
 *   samtd.guestbook  -> guestbook  (PK: id, INDEX: createdAt)
 *
 * 저장 실패(사파리 프라이빗 모드 등)는 삼킨다 — 기록은 편의 기능이고,
 * 저장이 안 된다고 게임이 안 돌아가면 안 된다.
 */
const KEY = {
  accounts: 'samtd.accounts',
  progress: 'samtd.progress.v2',
  records: 'samtd.records',
  guestbook: 'samtd.guestbook',
} as const;

/** 이 수를 넘으면 오래된 것부터 버린다. 브라우저 저장 한도(≈5MB)를 넘기지 않으려고. */
const MAX_RECORDS = 400;
const MAX_GUESTBOOK = 400;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 실패는 무시한다 */
  }
}

/**
 * 입력 순서를 지키며 최신순으로 뒤집는다.
 *
 * 시간만으로 정렬하면 안 된다 — 한 밀리초 안에 두 줄이 들어오면 시각이 같아지고,
 * Array.sort는 안정 정렬이라 그 둘이 "먼저 넣은 것이 앞"으로 남는다.
 * 최신순을 기대하고 읽는 쪽에서는 순서가 거꾸로 보인다(실제로 방명록에서 그랬다).
 * 배열 순서가 곧 입력 순서이므로 같은 시각이면 뒤에 넣은 쪽을 앞세운다.
 */
/**
 * 최신순 한 쪽을 잘라 낸다.
 *
 * 같은 시각이면 나중에 들어온 것이 위로 온다 — 한 판이 끝나고 곧바로 방명록을
 * 남기면 밀리초가 겹칠 수 있는데, 그때 순서가 뒤집히면 "방금 쓴 글이 아래에 있다"가 된다.
 */
function newestPage<T>(rows: readonly T[], at: (row: T) => number, query?: PageQuery): Page<T> {
  const sorted = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => at(b.row) - at(a.row) || b.index - a.index)
    .map((x) => x.row);
  const offset = Math.max(0, query?.offset ?? 0);
  const limit = Math.max(1, query?.limit ?? 50);
  return { items: sorted.slice(offset, offset + limit), total: sorted.length };
}

export class LocalGameStore implements GameStore {
  readonly name = 'local';

  async createAccount(account: Account): Promise<Account | null> {
    const all = read<Record<string, Account>>(KEY.accounts, {});
    // 같은 id로는 두 번 만들 수 없다 — 이 한 줄이 그 규칙이다.
    if (all[account.id]) return null;
    all[account.id] = account;
    write(KEY.accounts, all);
    return account;
  }

  async findAccount(id: string): Promise<Account | null> {
    return read<Record<string, Account>>(KEY.accounts, {})[id] ?? null;
  }

  /**
   * 여기서는 감출 것이 없다 — 해시가 어차피 이 브라우저의 localStorage 에 있다.
   * 그래도 저장소 안에서 비교하는 이유는 인터페이스를 토르소 저장소와 맞추기 위해서다.
   * 그쪽에서는 이 비교가 서버에서 일어난다.
   */
  async verifyPassword(id: string, passwordHash: string): Promise<boolean> {
    const account = read<Record<string, Account>>(KEY.accounts, {})[id];
    if (!account) return false;
    return constantTimeEqual(account.passwordHash, passwordHash);
  }

  async touchAccount(id: string, patch: Partial<Account>): Promise<void> {
    const all = read<Record<string, Account>>(KEY.accounts, {});
    const cur = all[id];
    if (!cur) return;
    // id는 기본키다 — patch로 바뀌지 않게 마지막에 덮어쓴다.
    all[id] = { ...cur, ...patch, id };
    write(KEY.accounts, all);
  }

  async loadProgress(accountId: string): Promise<LevelProgress> {
    const all = read<Record<string, LevelProgress>>(KEY.progress, {});
    return { stars: all[accountId]?.stars ?? {} };
  }

  async saveProgress(accountId: string, progress: LevelProgress): Promise<void> {
    const all = read<Record<string, LevelProgress>>(KEY.progress, {});
    all[accountId] = progress;
    write(KEY.progress, all);
  }

  async appendRecord(record: Omit<GameRecord, 'id'>): Promise<GameRecord> {
    const saved: GameRecord = { ...record, id: newId('rec') };
    const all = read<GameRecord[]>(KEY.records, []);
    all.push(saved);
    write(KEY.records, all.slice(-MAX_RECORDS));
    return saved;
  }

  async listRecords(query?: PageQuery & { accountId?: string }): Promise<Page<GameRecord>> {
    const all = read<GameRecord[]>(KEY.records, []);
    const mine = query?.accountId ? all.filter((r) => r.accountId === query.accountId) : all;
    return newestPage(mine, (r) => r.playedAt, query);
  }

  async appendGuestbook(entry: Omit<GuestbookEntry, 'id'>): Promise<GuestbookEntry> {
    const saved: GuestbookEntry = { ...entry, id: newId('gb') };
    const all = read<GuestbookEntry[]>(KEY.guestbook, []);
    all.push(saved);
    write(KEY.guestbook, all.slice(-MAX_GUESTBOOK));
    return saved;
  }

  async listGuestbook(query?: PageQuery): Promise<Page<GuestbookEntry>> {
    return newestPage(read<GuestbookEntry[]>(KEY.guestbook, []), (e) => e.createdAt, query);
  }
}
