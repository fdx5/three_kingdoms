import { describe, it, expect, beforeEach } from 'vitest';
import { AccountService } from '../src/account/AccountService';
import { LocalGameStore } from '../src/account/LocalGameStore';
import { hashPassword, newSalt, constantTimeEqual } from '../src/account/password';
import { bindProgress, isLevelUnlocked, suggestedLevelId, loadProgress } from '../src/ui/progress';

/**
 * 테스트 환경(node)에는 localStorage가 없다.
 * 브라우저와 같은 의미(문자열 -> 문자열, 실패하면 예외)만 갖춘 최소 구현을 끼운다 —
 * LocalGameStore가 진짜로 하는 일(같은 id 두 번 못 만들기 등)을 그대로 검사하기 위해서다.
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: Storage }).localStorage = storage;

beforeEach(() => storage.clear());

describe('비밀번호 해싱', () => {
  it('같은 비밀번호·같은 소금이면 같은 해시, 소금이 다르면 다른 해시', async () => {
    const s1 = newSalt();
    const s2 = newSalt();
    expect(s1).not.toBe(s2);
    expect(await hashPassword('pw1234', s1)).toBe(await hashPassword('pw1234', s1));
    expect(await hashPassword('pw1234', s1)).not.toBe(await hashPassword('pw1234', s2));
  });

  it('비밀번호가 다르면 해시가 다르고, 원문이 해시에 남지 않는다', async () => {
    const salt = newSalt();
    const a = await hashPassword('pw1234', salt);
    const b = await hashPassword('pw1235', salt);
    expect(a).not.toBe(b);
    expect(a).not.toContain('pw1234');
  });

  it('시간 일정 비교가 정확하다', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('가입과 로그인', () => {
  const service = () => new AccountService(new LocalGameStore());

  it('처음 보는 아이디는 그 자리에서 계정이 되고 바로 로그인된다', async () => {
    const a = service();
    const r = await a.signIn('liubei', 'peach1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(true);
    expect(r.account.id).toBe('liubei');
    expect(a.isLoggedIn).toBe(true);
  });

  it('같은 아이디로는 두 번 만들 수 없다 — 두 번째부터는 로그인이다', async () => {
    await service().signIn('caocao', 'wei123');

    const again = await service().signIn('caocao', 'wei123');
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.created).toBe(false); // 새로 만든 것이 아니라 들어간 것
  });

  it('비밀번호를 모르면 남의 아이디로 들어갈 수 없다', async () => {
    await service().signIn('sunquan', 'wu12345');

    const intruder = service();
    const r = await intruder.signIn('sunquan', 'guess!!');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('wrong_password');
    expect(intruder.isLoggedIn).toBe(false);
  });

  it('아이디는 대소문자를 가리지 않는다 (같은 계정으로 본다)', async () => {
    const first = await service().signIn('ZhugeLiang', 'shu999');
    expect(first.ok && first.created).toBe(true);

    const second = await service().signIn('zhugeliang', 'shu999');
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.created).toBe(false);
  });

  it('규칙에 안 맞는 아이디·비밀번호는 계정을 만들지 않는다', async () => {
    const a = service();
    expect((await a.signIn('ab', 'pw1234')).ok).toBe(false); // 너무 짧다
    expect((await a.signIn('한글아이디', 'pw1234')).ok).toBe(false); // 영문·숫자만
    expect((await a.signIn('okid', '123')).ok).toBe(false); // 비밀번호가 짧다
    expect(a.isLoggedIn).toBe(false);
    // 실패한 시도는 계정을 남기지 않는다
    expect(await new LocalGameStore().findAccount('okid')).toBeNull();
  });

  it('로그아웃하면 진행도까지 놓는다 (다음 사람이 물려받지 않게)', async () => {
    const a = service();
    await a.signIn('zhaoyun', 'chang1');
    a.recordClear('level01', 3);
    expect(a.progress.stars.level01).toBe(3);

    a.logout();
    expect(a.isLoggedIn).toBe(false);
    expect(a.progress.stars).toEqual({});
  });

  it('새로고침해도 로그인이 유지된다', async () => {
    const store = new LocalGameStore();
    await new AccountService(store).signIn('guanyu', 'green1');

    const reopened = new AccountService(store);
    expect(reopened.isLoggedIn).toBe(false);
    const restored = await reopened.restore();
    expect(restored?.id).toBe('guanyu');
  });
});

describe('진행도는 계정에 붙는다', () => {
  it('1장을 깬 계정은 다음 접속에서 2장부터 시작한다', async () => {
    const store = new LocalGameStore();
    const first = new AccountService(store);
    await first.signIn('player1', 'pw1234');

    bindProgress(first);
    expect(isLevelUnlocked('level02')).toBe(false);
    expect(suggestedLevelId()).toBe('level01');

    first.recordClear('level01', 3);
    expect(isLevelUnlocked('level02')).toBe(true);
    expect(suggestedLevelId()).toBe('level02');

    // 다시 접속해도 그대로다 (저장소에서 읽어 온다)
    const again = new AccountService(store);
    await again.restore();
    bindProgress(again);
    expect(loadProgress().stars.level01).toBe(3);
    expect(suggestedLevelId()).toBe('level02');
  });

  it('2장까지 깼으면 3장부터 시작한다', async () => {
    const a = new AccountService(new LocalGameStore());
    await a.signIn('player2', 'pw1234');
    bindProgress(a);
    a.recordClear('level01', 2);
    a.recordClear('level02', 1);
    expect(isLevelUnlocked('level03')).toBe(true);
    expect(isLevelUnlocked('level04')).toBe(false);
    expect(suggestedLevelId()).toBe('level03');
  });

  it('계정이 다르면 진행도도 다르다', async () => {
    const store = new LocalGameStore();
    const veteran = new AccountService(store);
    await veteran.signIn('veteran', 'pw1234');
    veteran.recordClear('level01', 3);
    veteran.recordClear('level02', 3);

    const rookie = new AccountService(store);
    await rookie.signIn('rookie', 'pw1234');
    bindProgress(rookie);
    expect(rookie.progress.stars).toEqual({});
    expect(isLevelUnlocked('level02')).toBe(false);

    bindProgress(veteran);
    expect(isLevelUnlocked('level03')).toBe(true);
  });

  it('등급은 내려가지 않는다 (더 잘한 기록만 남는다)', async () => {
    const a = new AccountService(new LocalGameStore());
    await a.signIn('grader', 'pw1234');
    a.recordClear('level01', 3);
    a.recordClear('level01', 1);
    expect(a.progress.stars.level01).toBe(3);
  });

  it('로그인하지 않았으면 진행도가 비어 있다 (1장만 열린다)', () => {
    bindProgress(null);
    expect(loadProgress().stars).toEqual({});
    expect(isLevelUnlocked('level01')).toBe(true);
    expect(isLevelUnlocked('level02')).toBe(false);
  });
});

describe('전적과 방명록 (향후 토르소 DB)', () => {
  const record = {
    levelId: 'level04',
    levelTitle: '합비 공방전 — 소요진',
    won: true,
    stars: 3 as const,
    wavesCleared: 15,
    totalWaves: 15,
    kills: 800,
    leaks: 12,
    castleHp: 990,
    castleMaxHp: 1020,
    castleLevel: 5,
    goldEarned: 7000,
    elapsed: 631,
  };

  it('이겨도 져도 한 줄씩 쌓이고 최신순으로 읽힌다', async () => {
    const store = new LocalGameStore();
    const a = new AccountService(store);
    await a.signIn('recorder', 'pw1234');

    a.saveRecord(record);
    a.saveRecord({ ...record, levelId: 'level05', won: false, stars: 1 });
    // saveRecord는 기다리지 않는다(게임을 막지 않으려고) — 저장소에서 직접 확인한다
    await Promise.resolve();

    const { items, total } = await store.listRecords({ accountId: 'recorder' });
    expect(total).toBe(2);
    expect(items).toHaveLength(2);
    expect(items[0].levelId).toBe('level05');
    expect(items[0].accountId).toBe('recorder');
    expect(items[0].id).toMatch(/^rec_/);
    expect(items.every((r) => r.playedAt > 0)).toBe(true);
  });

  it('내 전적만 볼 수도, 모두의 전적을 볼 수도 있다', async () => {
    const store = new LocalGameStore();
    const a = new AccountService(store);
    await a.signIn('alpha', 'pw1234');
    a.saveRecord(record);
    await Promise.resolve();

    const b = new AccountService(store);
    await b.signIn('beta', 'pw1234');
    // mine: true 는 그 계정의 것만
    expect((await b.listRecords({ mine: true })).items).toHaveLength(0);
    expect((await a.listRecords({ mine: true })).items).toHaveLength(1);
    // 기본은 모두의 것 — 이력 화면은 함께 보는 곳이다
    expect((await b.listRecords()).items).toHaveLength(1);
    expect((await b.listRecords()).items[0].accountId).toBe('alpha');
  });

  it('전적은 열 줄씩 끊어 읽을 수 있다', async () => {
    const store = new LocalGameStore();
    const a = new AccountService(store);
    await a.signIn('pager', 'pw1234');
    for (let i = 0; i < 23; i++) a.saveRecord({ ...record, kills: i });
    await Promise.resolve();

    const first = await a.listRecords({ limit: 10 });
    expect(first.total).toBe(23);
    expect(first.items).toHaveLength(10);

    const last = await a.listRecords({ limit: 10, offset: 20 });
    expect(last.items).toHaveLength(3);
    // 쪽이 겹치지 않는다 — 같은 판이 두 쪽에 나오면 페이징이 깨진 것이다
    const ids = new Set([...first.items, ...last.items].map((r) => r.id));
    expect(ids.size).toBe(13);
  });

  it('로그인 전에는 아무것도 남기지 않는다', async () => {
    const store = new LocalGameStore();
    new AccountService(store).saveRecord(record);
    await Promise.resolve();
    expect((await store.listRecords()).items).toHaveLength(0);
  });

  it('방명록은 계정 이름과 함께 남고 최신순으로 읽힌다', async () => {
    const a = new AccountService(new LocalGameStore());
    await a.signIn('Writer', 'pw1234');
    expect(await a.postGuestbook('   ')).toBeNull(); // 빈 글은 남기지 않는다
    await a.postGuestbook('첫 글');
    await a.postGuestbook('둘째 글');

    const { items, total } = await a.listGuestbook();
    expect(total).toBe(2);
    expect(items.map((r) => r.message)).toEqual(['둘째 글', '첫 글']);
    expect(items[0].displayName).toBe('Writer');
    expect(items[0].accountId).toBe('writer');

    // 방명록도 모두가 함께 본다 — 다른 계정으로 들어와도 같은 글이 보인다
    const other = new AccountService(new LocalGameStore());
    await other.signIn('reader', 'pw1234');
    expect((await other.listGuestbook({ limit: 1 })).items[0].message).toBe('둘째 글');
    expect((await other.listGuestbook({ limit: 1, offset: 1 })).items[0].message).toBe('첫 글');
  });
});
