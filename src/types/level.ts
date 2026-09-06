export interface WaveSpawn {
  unitId: string;
  /** 웨이브 시작 후 초 */
  at: number;
  hpMul: number;
  speedMul: number;
  /** 경로 중심선에서 좌우로 떨어진 거리. 여러 열 대형에 사용한다. */
  laneOffset?: number;
}

export interface WaveDef {
  index: number;
  spawns: WaveSpawn[];
  /** 클리어 보너스 골드 */
  reward?: number;
  /** "제 10파 — 황건적 두목" */
  banner: string;
  /** 보스 웨이브면 배너/사운드를 다르게 */
  isBossWave?: boolean;
}

export interface BuildSlotDef {
  id: string;
  x: number;
  z: number;
}

export interface LevelEnvironment {
  skyColor: string;
  groundColor: string;
  /** 고도 낮은 곳 흙색 */
  lowColor: string;
  /** 고도 높은 곳 마른 풀색 */
  highColor: string;
  fogColor: string;
  /** PBR ground material registered in the asset manifest. */
  terrainTexture?: string;
  /** Landscape relief multiplier; gameplay roads remain flattened. */
  terrainRelief?: number;
  biome?: 'drylands' | 'highlands' | 'woodland';
  landscape?: 'lakeside' | 'floodplain' | 'loess';
  /**
   * 이 레벨에서 반복 재생할 배경음 — 유튜브 영상 id.
   * 곡 파일을 직접 서빙하지 않는다(접속자마다 수 MB의 트래픽이 나간다).
   * 화면 밖에 숨긴 유튜브 플레이어가 소리만 낸다. [[YoutubeBgm]]
   */
  bgmYoutubeId?: string;
}

export interface LevelDef {
  id: string;
  title: string;
  castle: { id: string; hp: number };
  startGold: number;
  /**
   * 성벽 수리를 쓸 수 있는가. 기본값 false.
   *
   * 레벨 1은 잉여 골드가 43%나 남지만 일부러 소비처를 두지 않는다 —
   * 가르쳐야 할 것이 "업그레이드" 하나뿐이기 때문이다.
   * 수리를 열어주면 업그레이드를 안 해도 성을 고치며 버틸 수 있게 되어
   * 그 교훈이 흐려진다(실측: 10파 패배가 12파 패배로 밀렸다).
   */
  allowRepair?: boolean;
  /**
   * 성문 강화를 쓸 수 있는가. 기본값 false.
   *
   * 앞 세 장은 열지 않는다 — 각 장이 가르치는 것(업그레이드 / 조합 / 시간)이
   * 하나씩인데, 성문이라는 네 번째 소비처를 끼워 넣으면 그 교훈이 흐려진다.
   * 실제로 1장에 열어보면 성문만 올려도 10파 중간보스를 넘어가서
   * "업그레이드를 안 하면 진다"가 성립하지 않는다.
   * 성문은 슬롯이 모자라는 4장부터의 답이다. [[CASTLE_LEVELS]]
   */
  castleUpgrade?: boolean;
  /**
   * 이 레벨에서 쓸 수 있는 계략 id 목록. 없거나 비어 있으면 계략 UI 자체가 없다.
   *
   * 수리와 같은 이유로 레벨 1에는 두지 않는다. 계략은 "지금 이 순간의 답"이라
   * 배치와 업그레이드라는 기본기를 흐린다. 기본기를 다 배운 뒤에 열린다.
   */
  stratagems?: string[];
  /**
   * 웨이브 사이 간격(초). 없으면 BALANCE.waveInterval.
   * 웨이브가 겹쳐서 오므로 이 값이 곧 "숨 돌릴 틈"이고, 성벽 수리 창이기도 하다.
   * 적이 많고 단단한 레벨일수록 길어야 한다.
   */
  waveInterval?: number;
  /** 첫 웨이브 전 준비 시간(초). 없으면 BALANCE.firstWaveDelay. */
  firstWaveDelay?: number;
  /**
   * 조기 소집 보너스 계수 (남은 초 x 이 값만큼 골드). 없으면 BALANCE.earlyCallBonusPerSecond.
   *
   * 이 값이 곧 "위험을 사서 돈을 버는" 환율이다. 처치 골드만으로 감당되는 레벨에서는
   * 아무도 조기 소집을 쓰지 않는다 — 레벨 3은 이쪽을 주 수입원으로 만든다.
   */
  earlyCallBonusPerSecond?: number;
  /**
   * 별 등급 기준 (성 체력 비율). 없으면 BALANCE.stars 기본값.
   * 누수가 전제된 레벨에서는 100%/70% 기준이 너무 가혹하다 —
   * 최선의 플레이가 1별을 받으면 등급이 정보를 주지 못한다.
   */
  stars?: { three: number; two: number };
  /** 폴리라인. y는 지형에서 샘플링한다. */
  path: [number, number][];
  buildSlots: BuildSlotDef[];
  waves: WaveDef[];
  environment: LevelEnvironment;
}
