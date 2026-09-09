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
   *   towerDamageMul   타워 한 발의 피해 (towers.ts 의 표에 곱해진다). 모든 레벨에 똑같이.
   *                    0.95 -> 0.91. 공성전을 다시 조이면서 판이 통째로 헐거워졌기에
   *                    (망루 수리가 싸지고 체력 곡선이 낮아지자 봇이 여섯 장 중
   *                    다섯을 여유 있게 넘겼다) 여기서 되돌려 준다. 적 체력으로
   *                    올리려 했더니 4·5장이 곧바로 무너졌다 — 장별 표가 벼랑에
   *                    붙어 있어서다(enemyHpMul 1.26 만 되어도 두 장이 전멸).
   *                    타워 화력은 그 벼랑을 건드리지 않고 여섯 장을 고르게 조인다.
   *   towerLevelFalloff 레벨이 오를수록 **더** 깎는다 — n레벨 피해에 falloff^(n-1).
   *                    업그레이드 곡선이 너무 가팔랐다: 궁노는 1레벨 10 DPS 에서
   *                    5레벨 175 DPS 로 17배가 된다(화살 수 x5, 한 발 피해 x2.8,
   *                    발사 간격 x1.25 가 전부 곱해진다). 그래서 한 번 다 올리면
   *                    남은 웨이브가 전부 헐거워졌다. 이 값은 그 곱셈의 한 축만 눕힌다 —
   *                    1레벨은 그대로 두고 5레벨만 깎으므로, 초반 난이도는 건드리지 않고
   *                    "다 올리면 끝"만 사라진다.
   *                    참고: 0.90 이면 5레벨 피해가 0.90^4 = 0.656 배.
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
   *                    공성전과 함께 2.0 -> 2.3 으로 올렸다. 장수는 이제 망루도
   *                    부수는데(towerCombat.bossStrikeDamageMul 이 잡몹의 2.7배),
   *                    그러려면 망루 앞에서 몇 초는 버텨야 하기 때문이다.
   *                    3.0 까지는 못 간다 — 네 시드 중 셋에서 4·5장이 무너진다.
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
    towerDamageMul: 0.91,
    towerLevelFalloff: 0.95,
    enemyHpMul: 1.2,
    spawnIntervalMul: 0.95,
    groupGapMul: 0.95,
    hpGrowthBonus: 0.005,
    bossHpMul: 2.3,

    /**
     * 유닛의 공격력 — 성문이든 망루든, 적이 휘두르는 모든 것에 곱해진다
     * (Enemy.init 에서 castleDamage 에 한 번 곱하고 그 값이 두 전투에 다 쓰인다).
     *
     * 왜 3배인데 성이 세 배로 빨리 무너지지 않는가: 이제 전진하는 적은 열 중 셋뿐이다
     * (towerCombat.raiderRatio). 나머지 일곱은 망루를 부수러 길에서 벗어난다.
     * 0.3 x 3 = 0.9 — 성문이 받는 압력은 예전과 거의 같고, 대신 **망루가 전선이 된다**.
     * 이 값을 올리면 성문과 망루 양쪽이 동시에 아파진다.
     */
    unitDamageMul: 3,

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

  /**
   * 타워를 어디에 세울 수 있는가 — 자유 배치의 규칙.
   *
   * 레벨이 정한 슬롯 위에만 짓던 시절에는 이 값들이 필요 없었다. 지금은 빈 땅
   * 아무 데나 지을 수 있고, 레벨이 정하는 것은 자리가 아니라 **개수**다
   * (LevelDef.maxTowers). 그래서 "어디에 세울 수 없는가"를 여기 네 줄로 정한다.
   *
   * 값은 예전 슬롯들이 실제로 지키던 거리에서 가져왔다 — 여섯 장의 슬롯은
   * 길에서 최소 48, 성문에서 117, 서로 95, 가장자리에서 90 떨어져 있었다.
   * 그래서 예전 슬롯 자리는 전부 지금도 유효하다(tests/placement.test.ts 가 지킨다).
   *
   *   pathClearance   길 중심선에서 이만큼 안쪽은 못 짓는다. 길 리본의 반폭이 44 다.
   *   towerSpacing    타워끼리 최소 간격. 모델이 겹쳐 보이지 않는 최소치이기도 하다.
   *   castleClearance 성문 앞 광장. 성벽에 붙여 지어 성문 전투를 화력으로 덮는 것을 막는다.
   *   edgeMargin      맵 가장자리 여백. 카메라가 잘 안 닿는 구석에 짓지 못하게.
   */
  placement: {
    pathClearance: 46,
    towerSpacing: 44,
    castleClearance: 100,
    edgeMargin: 40,
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
    /**
     * 기존 1회 누수 피해를 반복 타격에 맞게 나눈 비율.
     *
     * 공성전이 들어오면서 0.20 에서 0.06 으로 내렸다. 두 가지가 동시에 바뀌었기
     * 때문이다: 유닛의 공격력이 3배가 되었고(difficulty.unitDamageMul), 대신
     * 성문으로 곧장 오는 것은 열 중 셋뿐이 되었다(towerCombat.raiderRatio).
     *
     * 3 x 0.06 = 0.18 로 한 방의 세기는 예전(0.20)과 거의 같다. 달라진 것은
     * **때리는 머릿수와 오는 시점**이다 — 나머지 일곱은 망루 앞에서 시간을 쓰고,
     * 살아남은 만큼만 뒤늦게 성문에 붙는다. 성벽이 받는 총량은 비슷하되 압력이
     * 두 파도로 나뉘어 온다.
     *
     * 0.20 을 그대로 두면(= 한 방이 정말 3배가 되면) 여섯 장이 전부 성문 앞에서
     * 무너진다. 습격조를 0으로 두고 재 봤을 때도 2·4·5·6장이 졌다 —
     * 성문 앞의 3배는 어떤 배치로도 감당되는 크기가 아니다(실측).
     */
    enemyStrikeDamageMul: 0.06,
    /**
     * 장수(elite / boss)는 2초마다 성벽을 친다 — 모든 장에 같다.
     *
     * 왜 따로 두는가. 16초 간격에서 장수는 성문 앞에 도달해도 사실상 무해했다.
     * 대개 두 번째 타격 전에 죽어서, 화면에서는 "여포가 성벽 앞에 서 있다"로만 보이고
     * 위협으로 읽히지 않았다. 2초면 서 있는 동안 계속 때리므로
     * "장수를 성문까지 보내면 안 된다"가 실제 규칙이 된다.
     *
     * 한 대의 세기는 간격이 짧아진 만큼 정확히 나눈다 — 0.06 / 8 = 0.0075.
     * 즉 **초당 피해는 예전과 같고 때리는 횟수만 여덟 배**가 된다.
     * 앞 여섯 장의 밸런스를 그대로 두면서 "장수가 쉬지 않고 성벽을 친다"만
     * 얻는 값이다. 이 비율을 그대로 두면 여포 한 기가 초당 24씩 깎아
     * 2장 성(600)을 25초에 무너뜨린다 — 막을 수 있는 위협이 아니라
     * 도달하는 순간 끝나는 판정이 된다(실측: 3·5장이 그 자리에서 패배로 뒤집혔다).
     * 장수를 더 사납게 하고 싶으면 이 값 하나만 올리면 된다.
     */
    bossAttackInterval: 2,
    bossStrikeDamageMul: 0.0075,
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
   * 공성전 — 적이 망루를 부순다.
   *
   * 지금까지 망루는 맞지 않는 포탑이었다. 플레이어가 보는 위험은 "성문까지 몇 기가
   * 도달하는가" 하나뿐이었고, 세워 둔 망루는 판을 깔고 나면 더 볼 일이 없었다.
   * 여기 있는 값들이 그 축을 하나 더 만든다 — **망루도 전선이고, 무너진다.**
   *
   * 규칙은 셋뿐이다.
   *   1) 스폰될 때 열 중 일곱은 습격조(raider), 셋은 돌파조(runner)가 된다.
   *   2) 습격조는 길을 가다 사거리 안의 망루를 보면 대열을 벗어나 둘러싸고 친다.
   *   3) 망루가 무너지거나 근처에 표적이 없으면 다시 길로 돌아가 성문으로 간다.
   *
   *   raiderRatio       망루를 노리는 비율. 1이면 아무도 성문에 안 온다.
   *   aggroRange        길 위에서 망루를 발견하는 거리(u). 타워 사거리(100~210)보다
   *                     짧게 잡는다 — 망루가 먼저 쏘고, 그다음 적이 달려든다.
   *   slots             한 망루를 동시에 둘러싸고 때릴 수 있는 수.
   *                     **자리를 잡은 적은 전부 때린다.** 서서 기다리는 적은 없다.
   *                     8은 모델 둘레에 보병이 겹치지 않고 서는 최대치이자 망루가 받는
   *                     초당 피해의 상한이다 — 곧 망루의 수명이다.
   *
   *                     한때 이 바깥에 "차례를 기다리는" 고리를 두 겹 더 두었다.
   *                     안쪽 여덟만으로는 아홉 번째부터 설 자리를 못 찾고 그냥 성문으로
   *                     간다고 봤기 때문인데, 그 판단의 근거였던 실측(습격조 134기 중
   *                     78기 통과)이 사실은 **자리 반납 버그**였다. 죽은 적이 자리를
   *                     쥔 채 사라져 모든 망루가 유령으로 막혀 있었던 것이다.
   *                     버그를 고치니 여덟 자리로 충분했고, 대기 고리는 "때리지 않고
   *                     20초를 서 있는 유닛"만 만들어 냈다. 그래서 없앴다.
   *   surroundRadius    둘러서는 원의 반지름(u). 무기가 닿을 만큼 바짝 붙는다 —
   *                     멀찍이 서서 허공을 치면 때리는 것으로 안 보인다.
   *   arriveRadius      이 안에 들어오면 멈추고 공격 자세로 바꾼다.
   *   approachSpeedMul  달려드는 동안의 속도. 대열에서 이탈하는 순간이 눈에 띄어야 한다.
   *   assaultSeconds    한 부대가 한 망루에 매달리는 최대 시간(초).
   *                     이 시간을 넘기면 물러나 성문으로 향한다(그리고 다시는 망루를
   *                     노리지 않는다 — 한 번 물러난 부대는 돌파조가 된다).
   *                     왜 필요한가: 시간 제한이 없으면 습격조가 망루 앞에 영원히
   *                     눌러앉아 웨이브가 끝나지 않는다. 실측으로 2장 한 판이
   *                     653초에서 1173초로 늘었다 — 긴박한 게 아니라 늘어지는 것이다.
   *                     망루를 부순 부대는 예외다. 이긴 쪽은 다음 망루로 간다.
   *                     길수록 어려워진다: 붙어 있는 동안 망루의 화력이 통째로
   *                     묶이므로, 그 사이에 길을 지나는 돌파조가 한 발도 안 맞는다.
   *                     28초로 늘려 봤더니 여섯 장 서른여섯 판 중 스무 판을 졌다.
   *                     13초로 줄이면 반대로 헐거워진다. 20이 두 쪽의 가운데다.
   *                     (잡몹의 타격 주기는 아래 attackInterval — 성벽의 16초보다
   *                     훨씬 짧다. 망루는 성벽과 달리 **지금 무너질 수 있는 것**이라
   *                     박자가 보여야 한다.)
   *   attackInterval    잡몹의 타격 주기(초). 2.0 -> 3.5 로 늘렸다. 한 대를 크게
   *                     때리되 덜 자주 때린다 — 아래 strikeDamageMul 과 짝이다.
   *   strikeDamageMul   한 대의 세기 = castleDamage(이미 3배가 곱해진 값) x 이 값.
   *
   *                     0.0224 -> 0.0672 로 세 배 올렸다. 그전 값에서는 실제로 플레이해
   *                     보면 망루가 **거의 무너지지 않았다** — 한 부대가 매달리는
   *                     20초에 체력바의 31% 만 깎여서, 조금만 신경 쓰면 어떤 망루도
   *                     잃지 않았다. 공성전이 위협이 아니라 배경이었다는 뜻이다.
   *                     지금은 서량 보병 여덟이 붙으면 20초에 85%, 황건적은 95% 를
   *                     가져간다. 즉 **한 부대가 붙으면 그 망루는 그 자리에서 결판난다.**
   *                     1레벨 궁노 기준 수명 21~24초, 목우유마 부대는 7초다.
   *
   *                     이 값만 올리면 판이 무너진다(실측: 여섯 장 서른여섯 판 중
   *                     네 판만 이겼다). 망루를 잃으면 화력이 줄고 -> 골드가 줄고 ->
   *                     다시 못 세우는 나선이 돌기 때문이다. 그래서 repairCostRatio 를
   *                     같이 내렸다 — 아래 참조. 둘은 같이 움직여야 하는 한 쌍이다.
   *   bossStrikeDamageMul 장수는 주기가 짧은 만큼 한 대를 작게 나눈다. 그래도
   *                     여포(160x3=480 x 0.1806 = 86.7 / 2.1초)는 혼자서 1레벨 망루를
   *                     5초에, 관우는 3초에 부순다 — "장수를 붙게 두면 안 된다"가
   *                     이제 경고가 아니라 규칙이다.
   *   hpBase            어떤 망루든 갖는 바닥 체력. 건설비의 기울기를 눕히는 대신
   *                     이쪽을 올려, 값싼 망루와 비싼 망루의 격차를 좁힌다.
   *   hpPerGold         망루 체력 = (hpBase + 건설비 x 이 값) x 종류 x 레벨.
   *                     비싼 망루가 여전히 더 단단하되, 값이 세 배라고 체력이
   *                     세 배가 되지는 않는다(6 -> 0.55 로 낮췄다).
   *                     체력을 표에 따로 적지 않는 이유: 값과 단단함이 어긋나면
   *                     "왜 이게 더 잘 부서지나"를 설명할 방법이 없다.
   *   toughnessSpread   TowerDef.toughness 를 얼마나 반영하는가. 0이면 종류 차이가
   *                     사라지고 1이면 표에 적힌 그대로다. 0.5 = 절반만 —
   *                     철질려(2.2)는 1.6배로, 화공대(0.9)는 0.95배로 좁혀진다.
   *                     세 값을 합치면 1레벨 체력이 195~351 로, 예전 600~2340 의
   *                     1/3 아래이면서 종류 간 폭이 3.9배에서 1.8배로 좁아진다.
   *   levelHpMul        레벨 하나당 체력 배수.
   *   levelHpMax        그 배수의 상한 — **업그레이드로 오르는 체력의 천장이다.**
   *                     끝없이 오르면 다 올린 망루가 부술 수 없는 물건이 되어
   *                     공성전이 그림으로만 남는다(실측: 예전 곡선에서 5레벨 화포는
   *                     7772 였고, 여섯 장 어디서도 90% 아래로 내려간 망루가 없었다).
   *                     1.3 배씩 오르다 2.3 에서 멈춘다. 1.3^4 = 2.86 이므로 뚜껑은
   *                     5레벨에서 물리고, 마지막 한 칸은 체력을 4.7% 만 준다 —
   *                     "여기서부터의 강화는 화력이지 맷집이 아니다"가 눈에 보인다.
   *                     뚜껑이 실제로 물리는지 확인하지 않으면 이 값은 장식이 된다:
   *                     levelHpMul^4 가 이 값보다 커야 한다.
   *   repairCostRatio   수리비 = 총 투자 골드 x 이 값 x (되돌리는 체력 / 최대 체력)
   *                     / repairFraction. 즉 **한 번에 최대로 고치면 투자액의 0.03배**,
   *                     덜 깎였으면 그만큼만 낸다(자세한 이유는 Tower.repairCost).
   *
   *                     0.5 -> 0.13 -> 0.03 으로 두 번 내려왔고, 두 번 다 이유가 같다:
   *                     **망루 체력이 줄거나 받는 피해가 늘면 같은 피해를 되돌리는 데
   *                     드는 골드가 그만큼 늘어난다.** 수리 한 번이 채우는 양은 최대
   *                     체력에 비례하는데 값은 투자액에 묶여 있기 때문이다. 이 비례를
   *                     맞춰 주지 않으면 골드가 전부 수리로 빠져 업그레이드도 성문도
   *                     못 산다(실측: 맞추지 않은 채 피해만 세 배로 올리면 여섯 장
   *                     서른여섯 판 중 네 판만 이긴다. 맞추면 서른 판이다).
   *
   *                     싸 보이지만 헐거워지지는 않는다. 피해가 세 배라 고칠 일이
   *                     세 배로 잦고, 무엇보다 **한 부대가 붙으면 20초 안에 결판이
   *                     나므로** 값이 아니라 "제때 눌렀는가"가 망루의 생사를 가른다.
   *                     치르는 값이 골드에서 주의력으로 옮겨 간 것이다.
   *   repairFraction    한 번 수리에 회복하는 최대 체력의 비율.
   *   repairCooldownSec 같은 망루를 다시 고치기까지의 최소 간격(초).
   *                     없으면 골드가 있는 한 매 프레임 고쳐 망루가 불멸이 된다.
   */
  towerCombat: {
    raiderRatio: 0.7,
    aggroRange: 150,
    slots: 8,
    surroundRadius: 30,
    arriveRadius: 6,
    approachSpeedMul: 1.3,
    /** 자리에 붙고 첫 타격까지의 뜸 — 클립이 한 번 올라갈 시간이다 */
    firstImpactDelay: 0.45,
    assaultSeconds: 20,
    attackInterval: 3.5,
    bossAttackInterval: 2.1,
    strikeDamageMul: 0.0672,
    bossStrikeDamageMul: 0.1806,
    hpBase: 140,
    hpPerGold: 0.55,
    toughnessSpread: 0.5,
    levelHpMul: 1.3,
    levelHpMax: 2.3,
    /** 어떤 망루도 이보다 무르지는 않다 */
    minHp: 150,
    repairCostRatio: 0.03,
    repairFraction: 0.5,
    repairCooldownSec: 6,
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
    weather: {
      // One GPU batch, no per-drop objects. Low omits it altogether; medium uses particleScale.
      capacity: 1600, seed: 5017, ceiling: 340, padding: 100,
      rainSpeed: 440, rainLength: 24, rainWidth: .65, rainOpacity: .27,
      // Keep the nearest actors clear and prevent stalls from jumping an entire storm cycle.
      maxDt: .1, nearFade: 180, fullFade: 500,
      wetDarkening: .14, wetRoughness: .32,
      rippleTile: 18, rippleSpeed: 1.7, rippleWidth: .035, rippleStrength: .18,
      // Four wave milestones, rather than a repeating timer that flashes forever during preparation.
      lightningMilestones: [.15, .4, .65, .9], flashSec: .32, flashStrength: 2.4,
      thunderDelay: 1.3, thunderSec: 3.2, thunderGain: .28, thunderHz: 180,
      // Smoke begins beyond the north apron; small ash shares its batch without covering units.
      ashCount: 360, ashSpeed: 7, ashSize: 1.7, ashOpacity: .3,
      smokeFraction: .2, smokeColumns: 3, smokeZ: -100, smokeBase: 55,
      smokeHeight: 320, smokeSize: 135, smokeRise: 26, smokeOpacity: .48,
      smokeColor: '#333239', fireGlowStrength: .3,
      // Lake wisps stay below soldiers' heads. Only distant fog changes visibility as dawn clears.
      mistCount: 120, mistWidth: 150, mistHeight: 26, mistLift: 10, mistOpacity: .2,
      mistCycle: 18, mistClearRate: .4, mistSunrise: .65, clearFogNear: 1550, clearFogFar: 3700,
      mistNearOffset: 80, mistFarSpan: 750,
      waterline: -1.1, waterUvScale: 70, waterSearchAttempts: 100,
      // Thin, low dust streaks communicate the plateau wind without a full-screen veil.
      windCount: 240, dustHeight: 14, dustWidth: 54, dustThickness: 5, dustOpacity: .12,
      cloudScale: .006, cloudSpeed: .12, cloudShade: .22, cloudSunShade: .12,
      bossCloudSec: 5, bossCloudShade: .25, grassLean: 3.5, flagFlutter: 3.0, gustSpeed: 3.8,
      // The finale is intentionally emptier than the plateau; only one pooled quad becomes the omen.
      loessCount: 110, loessOpacity: .085, starSec: 12, starSize: 105,
      starStart: [930, 290, -80], starEnd: [560, 50, -80], starColor: '#ff9a58', starBrightness: 2.6,
      starCore: .065, starTrail: .05,
    },
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
     * 부서져 가는 망루.
     *
     * 체력이 아니라 **피해 비율**로 읽는다: 0.25 를 넘으면 연기가 오르고, 0.5 에서
     * 불이 붙고, 0.78 을 넘으면 기둥이 기울고 잉걸이 흩날린다. 숫자를 안 봐도
     * 화면만으로 "저 망루는 곧 무너진다"가 읽혀야 한다.
     *
     *   smokeAt/fireAt/criticalAt  각 단계가 시작되는 피해 비율
     *   maxLean                    무너지기 직전 기울기(라디안)
     *   flinch                     한 대 맞을 때 뒤로 밀리는 거리(u)
     *   collapseSec                무너지는 연출의 길이(초)
     */
    towerDamage: {
      smokeAt: 0.25,
      fireAt: 0.5,
      criticalAt: 0.78,
      maxLean: 0.09,
      flinch: 2.6,
      collapseSec: 1.35,
      /** 체력바가 머리 위로 뜨는 높이 배수 (측정된 망루 높이에 곱한다) */
      barHeightMul: 1.16,
    },

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
    high: { shadows: true, shadowMapSize: 4096, particleScale: 1.0, decorScale: 1.0, postFx: true, maxDpr: 2 },
    medium: { shadows: true, shadowMapSize: 1024, particleScale: 0.6, decorScale: 0.6, postFx: false, maxDpr: 1.5 },
    low: { shadows: false, shadowMapSize: 512, particleScale: 0.3, decorScale: 0.3, postFx: false, maxDpr: 1.0 },
  },

  /** 최대 파티클 수 (high 기준. 프리셋 비율이 곱해진다) */
  maxParticles: 600,
} as const;

export type PerformancePresetName = keyof typeof BALANCE.presets;
export type PerformancePreset = (typeof BALANCE.presets)[PerformancePresetName];
