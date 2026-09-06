-- 삼국지 TD — 토르소(libSQL/SQLite) 스키마
--
-- 설계 원칙 세 가지
-- ----------------
-- 1) 게임 코드의 도메인 타입(src/account/types.ts)과 1:1로 맞춘다. 서버가 하는 일은
--    필드 이름을 snake_case 로 바꿔 넣고 빼는 것뿐이어야 한다.
-- 2) 시각은 전부 **정수 밀리초(Unix epoch)** 다. 게임이 Date.now() 를 쓰기 때문이다.
--    SQLite 의 DATETIME 문자열로 바꾸면 왕복할 때마다 파싱이 끼어든다.
-- 3) 진행도는 JSON 덩어리가 아니라 **행**으로 쪼갠다. {"level01":3} 같은 blob 으로 두면
--    "3장을 3별로 깬 사람 수" 같은 질문에 답할 수 없다.
--
-- 참조 테이블(levels/units/towers)은 게임 데이터에서 그대로 적재한다(scripts/db-seed.ts).
-- DB만 보고도 전적을 해석할 수 있어야 랭킹·통계를 SQL 로 짤 수 있다.

PRAGMA foreign_keys = ON;

-- ── 계정 ──────────────────────────────────────────────────────────────
--
-- password_hash 는 **절대 밖으로 나가지 않는다**. 서버가 /sessions 에서 직접
-- 비교하고 참/거짓만 돌려준다. salt 는 공개해도 되는 값이라 클라이언트가 받아 간다
-- (브라우저에서 PBKDF2 를 돌려야 하므로).
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_last_login ON accounts (last_login_at DESC);

-- ── 진행도 ────────────────────────────────────────────────────────────
--
-- 계정 x 레벨 당 한 행. 별은 1~3 만 들어간다(미클리어는 행이 없다).
CREATE TABLE IF NOT EXISTS progress (
  account_id TEXT    NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  level_id   TEXT    NOT NULL,
  stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 3),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, level_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_level ON progress (level_id, stars DESC);

-- ── 전적 ──────────────────────────────────────────────────────────────
--
-- 이기든 지든 한 판마다 한 행. level_title 을 같이 박아 두는 것은 의도적이다 —
-- 나중에 레벨 제목을 바꿔도 그때 그 판의 기록은 그때 이름으로 남아야 한다.
CREATE TABLE IF NOT EXISTS records (
  id            TEXT PRIMARY KEY,
  account_id    TEXT    NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  level_id      TEXT    NOT NULL,
  level_title   TEXT    NOT NULL,
  won           INTEGER NOT NULL CHECK (won IN (0, 1)),
  stars         INTEGER NOT NULL CHECK (stars BETWEEN 0 AND 3),
  waves_cleared INTEGER NOT NULL,
  total_waves   INTEGER NOT NULL,
  kills         INTEGER NOT NULL,
  leaks         INTEGER NOT NULL,
  castle_hp     INTEGER NOT NULL,
  castle_max_hp INTEGER NOT NULL,
  castle_level  INTEGER NOT NULL,
  gold_earned   INTEGER NOT NULL,
  elapsed       REAL    NOT NULL,
  played_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_records_account   ON records (account_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_level     ON records (level_id, played_at DESC);
-- 랭킹 질의용 — 이긴 판만, 별 높은 순, 같으면 빨리 깬 순
CREATE INDEX IF NOT EXISTS idx_records_ranking   ON records (level_id, won, stars DESC, elapsed ASC);

-- ── 방명록 ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guestbook (
  id           TEXT PRIMARY KEY,
  account_id   TEXT    NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  display_name TEXT    NOT NULL,
  message      TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guestbook_recent ON guestbook (created_at DESC);

-- ── 참조 데이터 ───────────────────────────────────────────────────────
--
-- 게임 데이터의 사본이다. 여기 있는 값으로 전적을 해석한다 —
-- 예: "등갑병에게 몇 번 뚫렸나"를 물으려면 DB가 등갑병이 뭔지 알아야 한다.
-- scripts/db-seed.ts 가 src/data/* 에서 읽어 통째로 다시 채운다(멱등).

CREATE TABLE IF NOT EXISTS levels (
  id          TEXT PRIMARY KEY,
  ordinal     INTEGER NOT NULL,
  title       TEXT    NOT NULL,
  castle_id   TEXT    NOT NULL,
  castle_hp   INTEGER NOT NULL,
  start_gold  INTEGER NOT NULL,
  wave_count  INTEGER NOT NULL,
  three_star  REAL    NOT NULL,
  two_star    REAL    NOT NULL,
  path_length REAL    NOT NULL,
  slot_count  INTEGER NOT NULL,
  stratagems  TEXT    NOT NULL,  -- JSON 배열
  castle_upgrade INTEGER NOT NULL CHECK (castle_upgrade IN (0, 1))
);

CREATE TABLE IF NOT EXISTS units (
  id            TEXT PRIMARY KEY,
  display_name  TEXT    NOT NULL,
  faction       TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  hp            INTEGER NOT NULL,
  speed         REAL    NOT NULL,
  gold_on_kill  INTEGER NOT NULL,
  castle_damage INTEGER NOT NULL,
  scale         REAL    NOT NULL,
  model_id      TEXT,
  traits        TEXT    NOT NULL   -- JSON 객체 (저항·오라·돌진)
);

CREATE INDEX IF NOT EXISTS idx_units_faction ON units (faction, kind);

CREATE TABLE IF NOT EXISTS towers (
  id           TEXT PRIMARY KEY,
  display_name TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  build_cost   INTEGER NOT NULL,
  kind         TEXT    NOT NULL,
  damage_kind  TEXT    NOT NULL,
  targeting    TEXT    NOT NULL,
  unlocked_in  TEXT,
  levels       TEXT    NOT NULL   -- JSON 배열 (레벨별 발수·피해·간격·사거리·비용)
);

-- ── 조회용 뷰 ─────────────────────────────────────────────────────────
--
-- 랭킹 화면이 붙을 때 서버가 SQL 을 다시 짜지 않아도 되도록 여기 둔다.

-- 레벨별 최고 기록 (이긴 판만, 계정당 한 줄)
CREATE VIEW IF NOT EXISTS v_level_best AS
SELECT
  r.level_id,
  r.account_id,
  a.display_name,
  MAX(r.stars)                                  AS best_stars,
  MIN(CASE WHEN r.won = 1 THEN r.elapsed END)   AS best_elapsed,
  COUNT(*)                                      AS wins
FROM records r
JOIN accounts a ON a.id = r.account_id
WHERE r.won = 1
GROUP BY r.level_id, r.account_id;

-- 계정 요약 — 로비에 띄울 한 줄짜리 전적
CREATE VIEW IF NOT EXISTS v_account_summary AS
SELECT
  a.id,
  a.display_name,
  a.created_at,
  a.last_login_at,
  (SELECT COUNT(*)          FROM records  r WHERE r.account_id = a.id)                AS plays,
  (SELECT COUNT(*)          FROM records  r WHERE r.account_id = a.id AND r.won = 1)  AS wins,
  (SELECT COALESCE(SUM(p.stars), 0) FROM progress p WHERE p.account_id = a.id)        AS total_stars,
  (SELECT COUNT(*)          FROM progress p WHERE p.account_id = a.id)                AS levels_cleared,
  (SELECT COALESCE(SUM(r.kills), 0) FROM records r WHERE r.account_id = a.id)         AS total_kills
FROM accounts a;
