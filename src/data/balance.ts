/**
 * 전역 밸런스 상수.
 * "이 파일만 열면 밸런스가 다 보인다"가 목표다.
 * 다른 곳의 매직넘버는 버그다 (확장성 5원칙 #1).
 */
export const BALANCE = {
  /** 1 타일 = 50 world unit. 맵 격자 24 x 14 = 1200 x 700 u */
  tileSize: 50,
  mapWidth: 1200,
  mapDepth: 700,
  gridCols: 24,
  gridRows: 14,

  /** 게임 속도 배율 옵션 */
  speedOptions: [1, 2, 3] as const,

  /**
   * 난이도 손잡이 — 여섯 장의 표를 다시 쓰지 않고 여기 세 값으로 조인다.
   *
   * 각 장의 수치표(타워 피해·유닛 체력·웨이브 간격)에는 "왜 이 값인가"가
   * 주석으로 붙어 있다. 난이도를 올리자고 그 표를 하나씩 고치면 그 근거가
   * 전부 거짓말이 되므로, 표는 그대로 두고 곱하는 값만 여기서 정한다.
   *
   *   towerDamageMul   타워 한 발의 피해 (towers.ts 의 표에 곱해진다)
   *   enemyHpMul       모든 적의 최대 체력 (Enemy.init 에서 곱해진다)
   *   hpGrowthBonus    각 장이 정한 웨이브당 체력 성장률(hpGrowth)에 **더하는** 값.
   *                    enemyHpMul 이 판 전체를 같은 비율로 두껍게 한다면 이쪽은
   *                    뒤로 갈수록 벌어진다 — 1파는 그대로고 15파는 1.4~1.5배가 된다.
   *                    "초반은 지금처럼 배우고 후반은 실제로 밀린다"가 목표다.
   *                    곱이 아니라 합인 이유: 장마다 hpGrowth 가 0.078~0.26 으로
   *                    제각각이라 배수로 올리면 이미 가파른 1장만 폭발한다.
   *                    합이면 어느 장이든 "웨이브당 +3%p" 라는 같은 크기로 얹힌다.
   *   bossHpMul        장수(elite/boss)의 체력 (Enemy.init 에서 곱해진다).
   *                    각 장이 inserts 에 적어 둔 hpMul 2·3 위에 다시 곱한다 —
   *                    표를 고치지 않고 "여포가 두 배로 단단하다"를 만드는 자리다.
   *                    장수는 2초마다 성벽을 치므로(castleCombat.bossAttackInterval)
   *                    이 값을 올리면 "성문 앞에서 끊을 수 있는가"가 곧바로 흔들린다.
   *                    올린 뒤에는 반드시 level02/03/0456 테스트로 클리어를 확인한다.
   *   spawnIntervalMul 적과 적 사이 간격. 1보다 작으면 한 웨이브가 짧은 시간에
   *                    통째로 쏟아진다 — "길게 늘어져 오는" 대열이 "왕창 몰려오는"
   *                    대열로 바뀐다. 웨이브 사이 간격(waveInterval)은 그대로라
   *                    밀려오는 순간의 밀도만 오른다.
   *   groupGapMul      부대와 부대 사이의 숨. 같은 이유로 줄인다.
   *   rank             한 번에 나란히 서는 횡대 — 아래 주석 참조.
   *
   * 배율이 전부 1이고 rank.columnsMul 이 1이면 조정 이전의 밸런스다.
   */
  difficulty: {
    towerDamageMul: 0.95,
    enemyHpMul: 1.15,
    spawnIntervalMul: 0.95,
    groupGapMul: 0.95,
    hpGrowthBonus: 0.005,
    bossHpMul: 2,

    /**
     * 횡대 — "한 줄로 늘어져 온다"를 "한 무리가 통째로 온다"로 바꾸는 값.
     *
     * 각 장이 정한 열 수(formationColumns)에 columnsMul 을 곱한다. 한 행은 동시에
     * 스폰되고 행 사이 간격은 열 수만큼 늘어나므로, 웨이브의 총 길이는 그대로인 채
     * **같은 순간 길 위에 서 있는 적의 수만** 늘어난다. spawnIntervalMul 이 웨이브를
     * 앞뒤로 압축한다면 이쪽은 좌우로 벌린다.
     *
     * 폭은 길(PathRibbon 88u = 반폭 44u) 밖으로 나가면 안 되고 적끼리 파고들어도 안 된다.
     * 그래서 열이 늘면 간격을 좁히고(반폭 42u 안에), 그래도 minSpacing 아래로는
     * 내려가지 않는다. maxColumns 는 그 위에 덧씌운 상한이다 — 일곱을 넘기면
     * 가장 큰 유닛(목우유마, 폭 16u)이 옆 줄과 겹쳐 대열이 뭉개진다.
     */
    rank: { columnsMul: 2, maxColumns: 7, maxHalfWidth: 38, minSpacing: 12 },
  },

  /** 웨이브 사이 대기 시간 (초) */
  waveInterval: 12,
  /** 첫 웨이브 시작 전 준비 시간 (초) — 타워 1기를 지을 여유 */
  firstWaveDelay: 20,

  /** 조기 소집: 남은 초 * 계수 만큼 골드 즉시 지급 */
  earlyCallBonusPerSecond: 4,

  /** 누수 판정: 경로 총 길이의 이 비율을 넘으면 성에 도달한 것으로 본다 */
  leakDistanceRatio: 1.0,

  /** 타워 판매 환급률 (TowerDef.sellRatio가 없을 때의 기본값) */
  defaultSellRatio: 0.7,

  /**
   * 성벽 수리 — 레벨 2부터의 골드 소비처.
   *
   * 웨이브가 스폰되는 중에는 고칠 수 없다(betweenWavesOnly).
   * 이게 없으면 누수를 실시간으로 되돌려 성 체력이 사실상 무한이 된다 —
   * 실제로 2G/HP로 상시 수리를 허용해 봤더니 누수 36기를 내고도 600/600으로 끝났다.
   *
   * 4G/HP는 "보병 3~4기를 잡아야 누수 1기를 되돌린다"는 환율이다.
   * 잉여 골드를 흡수하되 방어 실패를 무료로 지워주지는 않는다.
   */
  repair: {
    goldPerHp: 4,
    chunkHp: 50,
    /** 웨이브가 스폰되는 중에는 못 고친다 (밀려오는 동안은 손쓸 수 없다) */
    notWhileSpawning: true,
    /**
     * 수리 사이 최소 간격(초). 이게 없으면 골드가 있는 한 매 프레임 고칠 수 있어
     * 누수가 실시간으로 지워진다(실측: 누수 11기에 600/600).
     * 쿨다운이 있으면 "마지막 웨이브 피해의 일부만 만회한다"가 된다.
     */
    cooldownSec: 8,
  },

  /** 최대 동시 투사체 수 */
  maxProjectiles: 400,
  /** 투사체가 목표에 "명중"으로 판정되는 거리 (u) */
  projectileHitRadius: 8,
  /** 목표를 잃은 투사체가 예측 지점 도달 후 사라지기까지 최대 수명 (초) */
  projectileMaxLifetime: 4,

  /**
   * 3레벨부터 투사체가 만드는 화염 지대 (타워의 기본값).
   * 화공 망루·화포처럼 불이 곧 정체성인 타워는 TowerDef.ignite 로 자기 값을 갖는다.
   */
  fire: {
    unlockLevel: 3,
    arrow: { radius: 24, dps: 5, duration: 2.4 },
    stone: { radius: 52, dps: 14, duration: 4.2 },
    /** 화공 망루의 불 (뷰 기본값용 — 실제 수치는 TowerDef.ignite 가 정한다) */
    flame: { radius: 46, dps: 22, duration: 3.4 },
    /** 포탄이 낸 불구덩이 */
    shell: { radius: 62, dps: 24, duration: 4.6 },
    /** 같은 종류의 불이 너무 가까우면 새로 만들지 않고 기존 불의 수명만 갱신한다. */
    mergeDistanceRatio: 0.55,
    maxZones: 80,
    /** 매 프레임 소수 피해를 띄우지 않고 이 주기로 묶어 적용한다. */
    damageTick: 0.25,
  },

  /**
   * 성문 전투: 적은 죽을 때까지 반복 공격하고 성은 스스로 반격한다.
   *
   * 무엇으로 반격하는지(발수·피해·사거리·폭발·불)는 여기가 아니라
   * src/data/castle.ts 의 CASTLE_LEVELS 가 여섯 단계로 정한다.
   * 여기 남는 것은 단계와 무관한 값 — 적이 어디서 멈추고 얼마나 자주 때리는가다.
   */
  castleCombat: {
    stopBeforeGate: 30,
    enemyAttackInterval: 16,
    enemyFirstImpactDelay: 0.42,
    /** 기존 1회 누수 피해를 반복 타격에 맞게 나눈 비율. */
    enemyStrikeDamageMul: 0.20,
    /**
     * 장수(elite / boss)는 2초마다 성벽을 친다 — 모든 장에 같다.
     *
     * 왜 따로 두는가. 16초 간격에서 장수는 성문 앞에 도달해도 사실상 무해했다.
     * 대개 두 번째 타격 전에 죽어서, 화면에서는 "여포가 성벽 앞에 서 있다"로만 보이고
     * 위협으로 읽히지 않았다. 2초면 서 있는 동안 계속 때리므로
     * "장수를 성문까지 보내면 안 된다"가 실제 규칙이 된다.
     *
     * 한 대의 세기는 간격이 짧아진 만큼 정확히 나눈다 — 0.20 / 8 = 0.025.
     * 즉 **초당 피해는 예전과 같고 때리는 횟수만 여덟 배**가 된다.
     * 앞 여섯 장의 밸런스를 그대로 두면서 "장수가 쉬지 않고 성벽을 친다"만
     * 얻는 값이다. 0.20 을 그대로 두면 여포 한 기가 초당 16씩 깎아
     * 2장 성(600)을 40초에 무너뜨린다 — 막을 수 있는 위협이 아니라
     * 도달하는 순간 끝나는 판정이 된다(실측: 3·5장이 그 자리에서 패배로 뒤집혔다).
     * 장수를 더 사납게 하고 싶으면 이 값 하나만 올리면 된다.
     */
    bossAttackInterval: 2,
    bossStrikeDamageMul: 0.025,
    /**
     * 좌우 망루의 포문이 성문 중심에서 좌우로 떨어진 거리(u)와 높이(u).
     * dualMuzzle 무기는 여기서 번갈아 나가고, 화룡구는 양쪽이 동시에 나간다 —
     * "양방향에서 불이 온다"가 성립하려면 실제로 두 자리에서 떠나야 한다.
     */
    muzzleSpread: 62,
    muzzleHeight: 96,
    /**
     * 성문 사격이 노리는 우선순위.
     * 성벽에 붙은 적이 있으면 그쪽이 먼저다 — 사거리가 늘어난 뒤에도
     * 멀리 있는 선두를 쏘느라 코앞을 때리는 적을 놔두면 안 된다.
     */
    preferAtGate: true,
  },

  /**
   * 오라(가속)를 다시 거는 주기 겸 지속 시간(초).
   * 한 스텝(1/60초)보다 넉넉히 길어야 프레임 사이에 깜빡이지 않고,
   * 짧아야 기수가 죽는 순간 곧바로 풀린다.
   */
  auraRefreshSec: 0.35,

  /** SpatialGrid 셀 크기 = 타워 사거리 */
  spatialCellSize: 100,

  /** 별 등급 기준 (성 체력 비율) */
  stars: { three: 1.0, two: 0.7 },

  /** 뷰 연출 (sim에는 영향 없음) */
  fx: {
    deathAnimDuration: 0.35,
    /**
     * 성에 닿은 적이 창을 한 번 내지르고 사라지기까지. attack 클립 길이와 맞춘다.
     * 시뮬은 닿는 즉시 성에 피해를 주고 적을 지운다 — 이건 순전히 뷰의 여운이다.
     */
    castleAttackDuration: 0.75,
    /**
     * 공격 클립에서 무기가 실제로 성에 닿는 시점 (0~1).
     * 불꽃은 공격이 시작될 때가 아니라 이 순간에 터져야 "부딪혔다"로 읽힌다.
     * rig-model.ts 의 공격 클립은 0.4/0.75 지점에서 타격하므로 그 근처다.
     */
    castleAttackImpactAt: 0.53,
    hitFlashDuration: 0.08,
    damageNumberDuration: 0.6,
    coinFlightDuration: 0.55,
    coinStaggerMs: 20,
    goldCountUpDuration: 0.4,
    castleBarLagDuration: 0.5,
    bannerDuration: 1.2,
    healthBarVisibleAfterHit: 2.0,
    cameraShakeOnLeak: 0.35,
    cameraShakeOnBossLeak: 0.7,

    /**
     * 유닛이 죽은 자리에 남는 핏자국.
     * 모양은 12가지 패턴 × 3가지 변형에서 무작위로 뽑고, 여기서는 크기와 수명만 정한다.
     * maxDecals는 high 기준이고 성능 프리셋의 particleScale이 곱해진다.
     */
    blood: {
      maxDecals: 56,
      /** 보병 기준 자국 반지름(u). 유닛 scale이 곱해진다 (타일 = 50u) */
      baseRadius: 21,
      /** 지면에서 띄우는 높이 — 길 리본(0.6)보다 위여야 파묻히지 않는다 */
      lift: 0.9,
      /** 자국끼리 겹칠 때 z-파이팅을 막는 무작위 추가 높이 */
      liftJitter: 0.35,
      opacity: 0.92,
      /** 착지 순간 바깥으로 번지는 시간 */
      spreadSec: 0.22,
      fadeInSec: 0.08,
      /** 선명하게 남아 있는 시간 (자국마다 ±25% 흔들린다) */
      holdSec: 11,
      /** 사라지는 데 걸리는 시간 */
      fadeSec: 3.5,
      /** 이 시간에 걸쳐 선홍색에서 마른 검붉은색으로 변한다 */
      drySec: 4,
    },
  },

  /** 성능 프리셋 */
  presets: {
    high: { shadows: true, shadowMapSize: 2048, particleScale: 1.0, decorScale: 1.0, postFx: true, maxDpr: 2 },
    medium: { shadows: true, shadowMapSize: 1024, particleScale: 0.6, decorScale: 0.6, postFx: false, maxDpr: 1.5 },
    low: { shadows: false, shadowMapSize: 512, particleScale: 0.3, decorScale: 0.3, postFx: false, maxDpr: 1.0 },
  },

  /** 최대 파티클 수 (high 기준. 프리셋 비율이 곱해진다) */
  maxParticles: 600,
} as const;

export type PerformancePresetName = keyof typeof BALANCE.presets;
export type PerformancePreset = (typeof BALANCE.presets)[PerformancePresetName];
