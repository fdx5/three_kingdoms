import type { Account, GameRecord, GuestbookEntry, LevelProgress } from './types';

/**
 * 한 쪽 분량의 목록.
 *
 * `total`이 함께 오는 이유는 페이징 때문이다 — "몇 쪽인지"를 알려면 전체 수가 필요하고,
 * 그 수를 세는 일은 저장소가 해야 한다. 클라이언트가 전부 받아 세면
 * 전적이 만 줄이 되는 순간 방명록 한 쪽을 보려고 만 줄을 내려받게 된다.
 */
export interface Page<T> {
  items: T[];
  total: number;
}

/** 목록 조회 옵션. offset은 0부터. */
export interface PageQuery {
  limit?: number;
  offset?: number;
}

/**
 * 저장소 포트(port).
 *
 * 게임이 "무엇을 저장하는가"만 알고 "어디에 저장하는가"는 모르게 하는 경계다.
 * 지금은 [[LocalGameStore]](브라우저 localStorage)가 유일한 구현이고,
 * 토르소 DB가 붙으면 [[TorsoGameStore]]가 같은 인터페이스를 구현한다 —
 * 그때 게임 코드에서 고칠 곳은 createGameStore() 한 줄뿐이다.
 *
 * 모든 메서드가 async인 이유가 그것이다. localStorage는 동기지만 여기서
 * 동기 시그니처를 잡아 두면 나중에 네트워크 저장소를 끼울 수 없다.
 */
export interface GameStore {
  /** 진단용 이름 ('local' / 'torso') */
  readonly name: string;

  // ── 계정 ────────────────────────────────────────────────────────────

  /**
   * 계정을 만든다. 이미 있는 id면 null을 돌려준다 —
   * "같은 id로는 두 번 만들 수 없다"는 규칙은 여기서 지켜진다.
   */
  createAccount(account: Account): Promise<Account | null>;
  /**
   * 없으면 null.
   *
   * 주의: `passwordHash` 는 **비어 있을 수 있다.** 토르소 저장소는 저장된 해시를
   * 네트워크로 내보내지 않는다 — 아이디만 알면 오프라인에서 사전 공격을 할 수 있기
   * 때문이다. 비밀번호 확인은 [[verifyPassword]] 로 저장소에 맡긴다.
   * `passwordSalt` 는 공개해도 되는 값이라 늘 채워져 온다(브라우저가 PBKDF2 를 돌려야 한다).
   */
  findAccount(id: string): Promise<Account | null>;
  /**
   * 이 해시가 그 계정의 비밀번호가 맞는가.
   *
   * 비교를 **저장소 안에서** 한다. 로컬 저장소는 제자리에서, 토르소 저장소는 서버에서
   * 시간 일정 비교를 하고 참/거짓만 돌려준다. 계정이 없어도 false 다.
   */
  verifyPassword(id: string, passwordHash: string): Promise<boolean>;
  /** 마지막 로그인 시각 같은 가벼운 갱신 */
  touchAccount(id: string, patch: Partial<Account>): Promise<void>;

  // ── 진행도 ──────────────────────────────────────────────────────────

  loadProgress(accountId: string): Promise<LevelProgress>;
  saveProgress(accountId: string, progress: LevelProgress): Promise<void>;

  // ── 전적 ────────────────────────────────────────────────────────────

  /** id 없이 넣으면 저장소가 부여한다. 저장된 레코드를 돌려준다. */
  appendRecord(record: Omit<GameRecord, 'id'>): Promise<GameRecord>;
  /**
   * 최신순 한 쪽. accountId를 주면 그 사람 것만, 없으면 **모든 사람의 전적**이다 —
   * 이력 화면은 모두가 함께 보는 곳이라 후자가 기본이다.
   */
  listRecords(query?: PageQuery & { accountId?: string }): Promise<Page<GameRecord>>;

  // ── 방명록 ──────────────────────────────────────────────────────────

  appendGuestbook(entry: Omit<GuestbookEntry, 'id'>): Promise<GuestbookEntry>;
  /** 최신순 한 쪽 */
  listGuestbook(query?: PageQuery): Promise<Page<GuestbookEntry>>;
}

/** 저장소가 부여하는 id. 시간 접두사가 있어 정렬해도 대충 시간순이 된다. */
export function newId(prefix: string): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}${r}`;
}
