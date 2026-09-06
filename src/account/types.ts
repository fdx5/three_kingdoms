/**
 * 계정·기록 도메인 타입.
 *
 * 이 파일에는 저장 방식이 전혀 들어 있지 않다 — localStorage든 토르소 DB든
 * 같은 모양의 데이터를 주고받는다. 저장소를 갈아 끼울 때 고쳐야 할 곳은
 * [[GameStore]] 구현체 하나뿐이다.
 */

/** 별 등급 (1~3). 미클리어는 키 자체가 없다. */
export type Stars = 1 | 2 | 3;

export interface Account {
  /** 로그인 id. 계정의 기본키다 — 소문자로 정규화해 보관한다. */
  id: string;
  /** 화면에 보여줄 이름. 지금은 가입할 때 입력한 id 원문 그대로다. */
  displayName: string;
  /**
   * 비밀번호 검증용 해시와 소금.
   *
   * 주의: 브라우저에서 하는 해싱은 "같은 id로 다른 비밀번호를 쓰면 못 들어온다"까지만
   * 보장한다. 저장소가 localStorage인 동안에는 기기 주인이 값을 직접 고칠 수 있으므로
   * 진짜 인증이 아니다. 토르소 DB로 옮길 때 검증은 반드시 서버에서 해야 하고,
   * 그때 이 두 필드는 클라이언트에서 사라진다 (TorsoGameStore 주석 참고).
   */
  passwordHash: string;
  passwordSalt: string;
  createdAt: number;
  lastLoginAt: number;
}

/** 계정이 밖으로 나갈 때의 모습 — 비밀번호 관련 필드가 없다. */
export type PublicAccount = Omit<Account, 'passwordHash' | 'passwordSalt'>;

export interface LevelProgress {
  /** 레벨 id -> 그 레벨에서 받은 최고 별 등급 */
  stars: Record<string, Stars>;
}

/**
 * 한 판의 결과. 이기든 지든 남긴다 —
 * 향후 토르소 DB에 그대로 적재해 전적/랭킹을 만들 자리다.
 */
export interface GameRecord {
  /** 저장소가 부여하는 고유 id */
  id: string;
  accountId: string;
  levelId: string;
  levelTitle: string;
  won: boolean;
  stars: Stars;
  wavesCleared: number;
  totalWaves: number;
  kills: number;
  leaks: number;
  castleHp: number;
  castleMaxHp: number;
  /** 끝났을 때의 성문 강화 단계 */
  castleLevel: number;
  goldEarned: number;
  /** 초 */
  elapsed: number;
  playedAt: number;
}

/** 방명록 한 줄. 아직 UI는 없고 저장소 자리만 잡아 둔다. */
export interface GuestbookEntry {
  id: string;
  accountId: string;
  displayName: string;
  message: string;
  createdAt: number;
}

/** 로그인·가입 실패 이유. UI가 이 값으로 한국어 문구를 고른다. */
export type AuthFailure =
  | 'invalid_id'
  | 'invalid_password'
  | 'wrong_password'
  | 'store_error';

export type AuthResult =
  | { ok: true; account: PublicAccount; created: boolean }
  | { ok: false; reason: AuthFailure; message: string };
