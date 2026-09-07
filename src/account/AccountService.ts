import type { GameStore, Page, PageQuery } from './GameStore';
import { LocalGameStore } from './LocalGameStore';
import { TorsoGameStore } from './TorsoGameStore';
import { hashPassword, newSalt } from './password';
import type {
  Account,
  AuthResult,
  GameRecord,
  GuestbookEntry,
  LevelProgress,
  PublicAccount,
  Stars,
} from './types';

/** 로그인 id 규칙 — 소문자·숫자·밑줄·하이픈 3~16자 */
const ID_PATTERN = /^[a-z0-9_-]{3,16}$/;
const MIN_PASSWORD = 4;

/** 브라우저를 닫아도 유지되는 "지금 로그인한 사람" */
const SESSION_KEY = 'samtd.session';

/**
 * 저장소를 고른다.
 *
 * ?api=https://... 또는 VITE_API_BASE 가 있으면 토르소 DB를, 없으면 브라우저를 쓴다.
 * 게임 코드는 어느 쪽인지 모르며 [[GameStore]] 인터페이스만 본다.
 */
export function createGameStore(): GameStore {
  const fromUrl = new URLSearchParams(location.search).get('api');
  const fromEnv = (import.meta.env?.VITE_API_BASE as string | undefined) ?? '';
  const base = (fromUrl ?? fromEnv).replace(/\/+$/, '');
  return base ? new TorsoGameStore(base) : new LocalGameStore();
}

/**
 * 계정 서비스 — 가입·로그인·진행도·전적·방명록의 유일한 창구.
 *
 * 진행도만 동기 캐시를 들고 있다. 레벨 선택 화면과 승리 처리는 렌더 경로에서
 * 불리므로 await를 끼울 수 없기 때문이다. 쓰기는 캐시를 먼저 갱신하고
 * 저장소에는 뒤따라 보낸다(낙관적 갱신) — 저장이 늦거나 실패해도 화면은 맞다.
 */
export class AccountService {
  private account: PublicAccount | null = null;
  private progressCache: LevelProgress = { stars: {} };

  constructor(readonly store: GameStore = createGameStore()) {}

  get current(): PublicAccount | null {
    return this.account;
  }
  get isLoggedIn(): boolean {
    return this.account !== null;
  }
  /** 동기 읽기용 진행도 스냅숏 (레벨 선택·잠금 판정) */
  get progress(): LevelProgress {
    return this.progressCache;
  }

  /**
   * 새로고침해도 로그인이 유지되게 한다.
   * 저장된 id가 저장소에 더는 없으면(다른 기기·DB 교체) 조용히 로그아웃 상태가 된다.
   */
  async restore(): Promise<PublicAccount | null> {
    let id: string | null = null;
    try {
      id = localStorage.getItem(SESSION_KEY);
    } catch {
      id = null;
    }
    if (!id) return null;
    const found = await this.store.findAccount(id).catch(() => null);
    if (!found) {
      this.clearSession();
      return null;
    }
    await this.adopt(found);
    return this.account;
  }

  /**
   * 가입 겸 로그인.
   *
   * 규칙은 사양 그대로다:
   *   - 처음 보는 id면 그 자리에서 계정이 만들어지고 바로 로그인된다
   *   - 이미 있는 id면 비밀번호가 맞아야 들어간다 (틀리면 'wrong_password')
   * 즉 "가입 화면"과 "로그인 화면"이 따로 없다. 첫 화면 하나로 끝난다.
   */
  async signIn(rawId: string, password: string): Promise<AuthResult> {
    const id = rawId.trim().toLowerCase();
    if (!ID_PATTERN.test(id)) {
      return {
        ok: false,
        reason: 'invalid_id',
        message: '아이디는 영문 소문자·숫자·_·- 로 3~16자여야 합니다.',
      };
    }
    if (password.length < MIN_PASSWORD) {
      return {
        ok: false,
        reason: 'invalid_password',
        message: `비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.`,
      };
    }

    try {
      const existing = await this.store.findAccount(id);

      if (existing) {
        /*
         * 해시는 여기서 만들고 **비교는 저장소가 한다**.
         * 예전에는 저장소가 돌려준 해시를 여기서 맞춰 봤는데, 그러면 서버가
         * 아이디만 알면 누구에게나 해시를 내주는 셈이 된다(오프라인 사전 공격).
         * 소금은 비밀이 아니므로 받아 와도 된다.
         */
        const hash = await hashPassword(password, existing.passwordSalt);
        if (!(await this.store.verifyPassword(id, hash))) {
          return { ok: false, reason: 'wrong_password', message: '비밀번호가 다릅니다.' };
        }
        const now = Date.now();
        await this.store.touchAccount(id, { lastLoginAt: now });
        await this.adopt({ ...existing, lastLoginAt: now });
        return { ok: true, account: this.account!, created: false };
      }

      const salt = newSalt();
      const now = Date.now();
      const account: Account = {
        id,
        displayName: rawId.trim(),
        passwordHash: await hashPassword(password, salt),
        passwordSalt: salt,
        createdAt: now,
        lastLoginAt: now,
      };
      const created = await this.store.createAccount(account);
      if (!created) {
        /*
         * 여기 오는 경우: 확인과 생성 사이에 다른 탭·다른 기기가 같은 id를 선점했다.
         * 로컬에서는 사실상 없지만 토르소 DB에서는 실제로 일어난다.
         * "이미 있는 id"라는 뜻이므로 비밀번호를 다시 받아 로그인 경로로 보낸다.
         */
        return {
          ok: false,
          reason: 'wrong_password',
          message: '방금 같은 아이디가 만들어졌습니다. 비밀번호를 확인해 주세요.',
        };
      }
      await this.adopt(created);
      return { ok: true, account: this.account!, created: true };
    } catch (err) {
      console.error('[account] 로그인 실패:', err);
      return {
        ok: false,
        reason: 'store_error',
        message: '저장소에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
      };
    }
  }

  logout(): void {
    this.account = null;
    this.progressCache = { stars: {} };
    this.clearSession();
  }

  // ── 진행도 ──────────────────────────────────────────────────────────

  /**
   * 클리어 기록. 기존 등급보다 높을 때만 갱신한다.
   * 캐시를 먼저 고치고 저장은 뒤따라 보낸다 — 승리 오버레이가 기다리지 않게.
   */
  recordClear(levelId: string, stars: Stars): LevelProgress {
    if ((this.progressCache.stars[levelId] ?? 0) < stars) {
      this.progressCache = {
        stars: { ...this.progressCache.stars, [levelId]: stars },
      };
    }
    this.flushProgress();
    return this.progressCache;
  }

  /**
   * 바깥에서 진행도를 통째로 물려준다 (계정 기능 이전의 브라우저 기록 인계).
   * 더 높은 등급만 남기므로 이미 있는 기록을 깎지 않는다.
   */
  adoptProgress(p: LevelProgress): void {
    const merged = { ...this.progressCache.stars };
    for (const [levelId, stars] of Object.entries(p.stars)) {
      if ((merged[levelId] ?? 0) < stars) merged[levelId] = stars;
    }
    this.progressCache = { stars: merged };
    this.flushProgress();
  }

  private flushProgress(): void {
    const id = this.account?.id;
    if (!id) return;
    void this.store
      .saveProgress(id, this.progressCache)
      .catch((err) => console.warn('[account] 진행도 저장 실패:', err));
  }

  // ── 전적 / 방명록 ───────────────────────────────────────────────────

  /**
   * 한 판의 결과를 남긴다. 이겨도 져도 남긴다 —
   * 향후 토르소 DB에서 전적·랭킹이 될 데이터다. 실패해도 게임은 그대로 간다.
   */
  saveRecord(record: Omit<GameRecord, 'id' | 'accountId' | 'playedAt'>): void {
    const accountId = this.account?.id;
    if (!accountId) return;
    void this.store
      .appendRecord({ ...record, accountId, playedAt: Date.now() })
      .catch((err) => console.warn('[account] 전적 저장 실패:', err));
  }

  /**
   * 전적 목록 한 쪽.
   *
   * 기본이 **모두의 전적**인 것은 의도적이다 — 이력 화면은 게이머들이 함께 보는 곳이라
   * 남의 기록도 보여야 한다. 내 것만 보려면 `mine: true` 를 준다.
   */
  listRecords(query: PageQuery & { mine?: boolean } = {}): Promise<Page<GameRecord>> {
    const { mine, ...page } = query;
    const accountId = mine ? this.account?.id : undefined;
    if (mine && !accountId) return Promise.resolve({ items: [], total: 0 });
    return this.store.listRecords({ ...page, accountId });
  }

  /** 방명록 쓰기. 로그인한 사람만, 빈 글은 남기지 않는다. */
  async postGuestbook(message: string): Promise<GuestbookEntry | null> {
    const acc = this.account;
    const text = message.trim();
    if (!acc || !text) return null;
    return this.store
      .appendGuestbook({
        accountId: acc.id,
        displayName: acc.displayName,
        message: text.slice(0, 500),
        createdAt: Date.now(),
      })
      .catch((err) => {
        console.warn('[account] 방명록 저장 실패:', err);
        return null;
      });
  }

  /** 방명록 한 쪽. 모두가 함께 보는 목록이라 계정으로 거르지 않는다. */
  listGuestbook(query: PageQuery = {}): Promise<Page<GuestbookEntry>> {
    return this.store.listGuestbook(query);
  }

  // ── 내부 ────────────────────────────────────────────────────────────

  /** 계정을 현재 세션으로 삼고 진행도를 캐시에 올린다 */
  private async adopt(account: Account): Promise<void> {
    const { passwordHash: _h, passwordSalt: _s, ...pub } = account;
    void _h;
    void _s;
    this.account = pub;
    this.progressCache = await this.store.loadProgress(account.id).catch(() => ({ stars: {} }));
    try {
      localStorage.setItem(SESSION_KEY, account.id);
    } catch {
      /* 세션 유지는 편의 기능이다 */
    }
  }

  private clearSession(): void {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* 무시 */
    }
  }
}
