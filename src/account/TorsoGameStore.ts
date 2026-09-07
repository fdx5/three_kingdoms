import type { GameStore, Page, PageQuery } from './GameStore';
import type { Account, GameRecord, GuestbookEntry, LevelProgress } from './types';

/**
 * 토르소 DB 저장소 — REST API 뒤에 있는 진짜 저장소.
 *
 * 아직 서버가 없으므로 이 클래스는 **꺼져 있다**. 켜는 방법은 하나다:
 *   .env 에 VITE_API_BASE=https://... 를 넣거나, URL에 ?api=https://... 를 붙인다.
 * 그러면 createGameStore()가 LocalGameStore 대신 이걸 고른다.
 *
 * 서버가 있어야 할 엔드포인트 (이 파일이 곧 API 명세다)
 * ---------------------------------------------------
 *   POST   /accounts                {id, displayName, passwordHash, passwordSalt}
 *                                   -> 201 Account | 409 (id 중복)
 *   GET    /accounts/:id            -> 200 Account(해시는 비어 있다) | 404
 *   POST   /sessions                {id, passwordHash} -> 200 | 401
 *   PATCH  /accounts/:id            {lastLoginAt, ...}      -> 204
 *   GET    /accounts/:id/progress   -> 200 {stars: {...}}
 *   PUT    /accounts/:id/progress   {stars}                 -> 204
 *   POST   /records                 GameRecord(id 없이)      -> 201 GameRecord
 *   GET    /records?accountId&limit&offset
 *                                   -> 200 {items: GameRecord[], total}
 *   POST   /guestbook               GuestbookEntry(id 없이)  -> 201 GuestbookEntry
 *   GET    /guestbook?limit&offset  -> 200 {items: GuestbookEntry[], total}
 *
 * 비밀번호는 이렇게 나뉜다
 * ----------------------
 * 브라우저가 소금으로 PBKDF2 를 돌려 해시를 만들고, **비교는 서버가 한다**
 * (POST /sessions). 저장된 해시는 어떤 응답에도 실리지 않는다 — 아이디만 알면
 * 오프라인에서 사전 공격을 할 수 있기 때문이다.
 *
 * 남은 것: 지금은 로그인 뒤에 세션 토큰을 받지 않아서, 전적·진행도 쓰기를
 * 서버가 "정말 그 사람인지" 확인하지 못한다. 공개 랭킹을 열 때 손봐야 할 자리다.
 */
export class TorsoGameStore implements GameStore {
  readonly name = 'torso';

  constructor(private readonly baseUrl: string) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T | null> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    // 409(중복) / 404(없음)는 오류가 아니라 "없다"는 대답이다.
    if (res.status === 404 || res.status === 409) return null;
    if (!res.ok) throw new Error(`torso ${init?.method ?? 'GET'} ${path} -> ${res.status}`);
    if (res.status === 204) return null;
    return (await res.json()) as T;
  }

  createAccount(account: Account): Promise<Account | null> {
    return this.req<Account>('/accounts', { method: 'POST', body: JSON.stringify(account) });
  }

  /**
   * 서버는 `passwordHash` 를 빈 문자열로 채워 보낸다 — 저장된 해시는 나오지 않는다.
   * 소금은 진짜 값이 온다(브라우저가 PBKDF2 를 돌려야 하고, 소금은 비밀이 아니다).
   */
  findAccount(id: string): Promise<Account | null> {
    return this.req<Account>(`/accounts/${encodeURIComponent(id)}`);
  }

  /**
   * 비교는 서버가 한다. 200 이면 맞고 401 이면 틀렸다 —
   * `req` 가 401 을 오류로 던지므로 여기서 직접 fetch 한다.
   */
  async verifyPassword(id: string, passwordHash: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, passwordHash }),
    });
    if (res.status === 200) return true;
    if (res.status === 401) return false;
    throw new Error(`torso POST /sessions -> ${res.status}`);
  }

  async touchAccount(id: string, patch: Partial<Account>): Promise<void> {
    await this.req(`/accounts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async loadProgress(accountId: string): Promise<LevelProgress> {
    const p = await this.req<LevelProgress>(`/accounts/${encodeURIComponent(accountId)}/progress`);
    return { stars: p?.stars ?? {} };
  }

  async saveProgress(accountId: string, progress: LevelProgress): Promise<void> {
    await this.req(`/accounts/${encodeURIComponent(accountId)}/progress`, {
      method: 'PUT',
      body: JSON.stringify(progress),
    });
  }

  async appendRecord(record: Omit<GameRecord, 'id'>): Promise<GameRecord> {
    const saved = await this.req<GameRecord>('/records', {
      method: 'POST',
      body: JSON.stringify(record),
    });
    if (!saved) throw new Error('torso: 전적 저장 응답이 비어 있다');
    return saved;
  }

  async listRecords(query?: PageQuery & { accountId?: string }): Promise<Page<GameRecord>> {
    const q = pageQuery(query);
    if (query?.accountId) q.set('accountId', query.accountId);
    return (await this.req<Page<GameRecord>>(`/records?${q}`)) ?? { items: [], total: 0 };
  }

  async appendGuestbook(entry: Omit<GuestbookEntry, 'id'>): Promise<GuestbookEntry> {
    const saved = await this.req<GuestbookEntry>('/guestbook', {
      method: 'POST',
      body: JSON.stringify(entry),
    });
    if (!saved) throw new Error('torso: 방명록 저장 응답이 비어 있다');
    return saved;
  }

  async listGuestbook(query?: PageQuery): Promise<Page<GuestbookEntry>> {
    return (await this.req<Page<GuestbookEntry>>(`/guestbook?${pageQuery(query)}`)) ?? { items: [], total: 0 };
  }
}

function pageQuery(query?: PageQuery): URLSearchParams {
  return new URLSearchParams({
    limit: String(query?.limit ?? 50),
    offset: String(query?.offset ?? 0),
  });
}
