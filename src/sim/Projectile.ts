import type { DamageKind, FireSource } from '../types/towers';

/**
 * 투사체. 오브젝트 풀에서 꺼내 쓴다.
 * 리드 타게팅: 목표의 현재 속도로 도달 시점 위치를 예측해 그 지점을 향한다.
 * 대상이 도착 전에 죽으면 마지막 예측 지점까지 날아가 소멸한다(빗나감 연출).
 */
export class Projectile {
  id = 0;
  active = false;
  towerSlotId = '';
  targetId = 0;
  damage = 0;
  speed = 0;
  arcHeight = 0;

  /**
   * 발사 시점의 타워 효과를 복사해 들고 간다.
   * 비행 중에 타워가 팔릴 수 있으므로 착탄 때 타워를 되찾아 보면 안 된다.
   */
  damageKind: DamageKind = 'ranged';
  splashRadius = 0;
  splashFalloff = 0;

  /** 현재 위치 */
  x = 0;
  z = 0;
  /** 출발 위치 (뷰의 포물선 계산용) */
  fromX = 0;
  fromZ = 0;
  /** 예측 착탄 지점 */
  toX = 0;
  toZ = 0;

  /** 총 비행거리 / 이미 날아간 거리 — 뷰가 t = traveled/total 로 포물선을 그린다 */
  totalDist = 0;
  traveled = 0;
  lifetime = 0;

  /**
   * 한 번의 발사에서 이 투사체가 몇 번째인지, 그리고 그 발사가 몇 발이었는지.
   * 시뮬은 이 값을 쓰지 않는다 — 뷰가 N발을 N개로 보이게 흩는 데만 쓴다
   * (같은 지점에서 같은 순간에 떠나면 화면에서는 한 발로 뭉쳐 보인다).
   */
  salvoIndex = 0;
  salvoSize = 1;

  /**
   * 쏜 타워의 레벨(1..5). 역시 시뮬은 쓰지 않는다 —
   * 업그레이드가 눈에 보이려면 날아가는 물건 자체가 달라져야 한다.
   * 비행 중에 타워가 팔릴 수 있으므로 발사 시점 값을 복사해 들고 간다.
   */
  towerLevel = 1;
  /** 3레벨 이상이면 착탄 지점에 화염 지대를 만든다. */
  fireRadius = 0;
  fireDps = 0;
  fireDuration = 0;
  fireSource: FireSource = 'arrow';

  /** 뷰 보간용 */
  prevX = 0;
  prevZ = 0;
  prevTraveled = 0;

  init(
    id: number,
    towerSlotId: string,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    targetId: number,
    damage: number,
    speed: number,
    arcHeight: number,
    damageKind: DamageKind,
    splashRadius: number,
    splashFalloff: number,
    salvoIndex = 0,
    salvoSize = 1,
    towerLevel = 1,
    fireRadius = 0,
    fireDps = 0,
    fireDuration = 0,
    fireSource: FireSource = 'arrow',
  ): void {
    this.id = id;
    this.active = true;
    this.towerSlotId = towerSlotId;
    this.targetId = targetId;
    this.damage = damage;
    this.speed = speed;
    this.arcHeight = arcHeight;
    this.damageKind = damageKind;
    this.splashRadius = splashRadius;
    this.splashFalloff = splashFalloff;
    this.salvoIndex = salvoIndex;
    this.salvoSize = salvoSize;
    this.towerLevel = towerLevel;
    this.fireRadius = fireRadius;
    this.fireDps = fireDps;
    this.fireDuration = fireDuration;
    this.fireSource = fireSource;
    this.x = this.prevX = this.fromX = fromX;
    this.z = this.prevZ = this.fromZ = fromZ;
    this.toX = toX;
    this.toZ = toZ;
    this.totalDist = Math.max(1e-6, Math.hypot(toX - fromX, toZ - fromZ));
    this.traveled = 0;
    this.prevTraveled = 0;
    this.lifetime = 0;
  }

  reset(): void {
    this.active = false;
    this.targetId = 0;
    this.damage = 0;
    this.traveled = 0;
    this.prevTraveled = 0;
    this.lifetime = 0;
    this.totalDist = 0;
    this.damageKind = 'ranged';
    this.splashRadius = 0;
    this.splashFalloff = 0;
    this.salvoIndex = 0;
    this.salvoSize = 1;
    this.towerLevel = 1;
    this.fireRadius = 0;
    this.fireDps = 0;
    this.fireDuration = 0;
    this.fireSource = 'arrow';
  }

  /** 0~1 비행 진행률 */
  get t(): number {
    return Math.min(1, this.traveled / this.totalDist);
  }
}
