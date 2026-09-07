import type { PrimitiveSpec } from './primitives';

export type UnitKind = 'minion' | 'elite' | 'boss';
export type Faction = 'yellow_turban' | 'han' | 'xiliang' | 'yuan' | 'wu' | 'jing' | 'shu';

/**
 * 적 속성. 전부 선택 사항이며, 없으면 "평범한 보병"이다.
 * 타워 종류를 늘리는 것과 짝이 되는 축 — 속성마다 답이 되는 타워가 다르다.
 */
export interface UnitTraits {
  /** 원거리(화살) 피해 감소율 0~1. 방패병의 답은 공성 피해(투석기)다. */
  rangedResist?: number;
  /**
   * 화염 피해 감소율 0~1. 물에 젖은 형주 수군이 화공 망루를 무력화하는 장치다 —
   * 그 답은 다시 포탄(siege)이다. rangedResist 와 같은 축의 반대편이다.
   */
  fireResist?: number;
  /**
   * 화염 피해 증폭 배율. 등갑처럼 잘 타는 것에 1보다 큰 값을 준다.
   * fireResist 와 동시에 쓰지 않는다 — 둘 다 있으면 저항이 먼저 적용된 뒤 증폭된다.
   */
  fireVuln?: number;
  /** 감속 면역 */
  slowImmune?: boolean;
  /** 주변 아군을 회복시킨다. 먼저 끊지 않으면 앞줄이 죽지 않는다. */
  healAura?: { radius: number; hps: number };
  /**
   * 주변 아군을 가속시킨다 (기수의 북·깃발).
   * 회복 오라가 "더 안 죽는다"라면 이쪽은 "더 빨리 온다"다 —
   * 방어선을 지나는 시간을 줄여서, 끊지 않으면 웨이브 전체가 앞당겨 도착한다.
   */
  speedAura?: { radius: number; speedMul: number };
  /**
   * 이름 있는 장수의 고유 능력 — 주기적 돌진.
   * every초마다 duration초 동안 속도가 speedMul배가 된다.
   */
  charge?: { every: number; duration: number; speedMul: number };
  /**
   * 성문을 **불로** 때린다 — 부채를 휘두르면 화염이 날아가 성벽에 붙는다.
   *
   * 보통 적은 성문을 칠 때마다 그 자리에서 피해를 준다. 이 특성이 있으면 그
   * 한 방이 통째로 불이 되어 duration 초에 걸쳐 들어간다. 총량은 원래 한 방에
   * damageMul 을 곱한 값이다.
   *
   * 왜 즉발이 아니라 지속인가: 제갈량은 성벽을 두드리러 온 것이 아니라 태우러
   * 온 것이다. 한 번 붙은 불이 계속 깎아 내려가야 "먼저 끊어야 한다"가 몸으로
   * 읽힌다 — 때리는 순간만 아픈 적은 서서 버티면 되지만, 태우는 적은 그렇지 않다.
   */
  castleFlame?: { duration: number; damageMul: number };
}

export interface UnitAudio {
  spawn?: string;
  hit?: string;
  die?: string;
}

export interface UnitView {
  primitive: PrimitiveSpec;
  /** 매니페스트의 모델 id. 없거나 로드 실패면 primitive로 폴백한다. */
  modelId?: string;
  /**
   * 타격 순간 무기가 지나간 자리를 **호**로 그린다.
   *
   * 보통은 무기 끝에서 불꽃이 한 번 튄다. 청룡언월도처럼 날이 몸만 한 무기는
   * 그걸로 "휘둘렀다"가 안 읽힌다 — 점 하나가 튀는 것과 날이 쓸고 지나가는 것은
   * 다른 그림이다. 켠 유닛만 호를 따라 여러 번 튄다.
   */
  weaponSweep?: boolean;
}

export interface UnitDef {
  id: string;
  displayName: string;
  faction: Faction;

  hp: number;
  /** world unit / sec */
  speed: number;
  goldOnKill: number;
  /** 성에 도달했을 때 성이 입는 피해 */
  castleDamage: number;

  /** 중간보스는 2.0 */
  scale: number;
  kind: UnitKind;

  view: UnitView;
  /** 없으면 무음 */
  audio?: UnitAudio;

  /** 속성. 없으면 평범한 보병이다. */
  traits?: UnitTraits;
}
