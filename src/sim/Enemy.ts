import type { UnitDef, UnitKind, UnitTraits } from '../types/units';
import type { DamageKind } from '../types/towers';
import { BALANCE } from '../data/balance';

/**
 * 적. 위치를 저장하지 않는다 — distance 하나로 전부 파생된다.
 * 풀링되므로 reset()으로 재사용한다.
 */
export class Enemy {
  id = 0;
  defId = '';
  hp = 0;
  maxHp = 0;
  /** 경로 누적거리 (u) */
  distance = 0;
  /** u/s */
  speed = 0;
  alive = false;
  scale = 1;
  kind: UnitKind = 'minion';
  goldOnKill = 0;
  castleDamage = 0;
  /** 성문 앞에 도착해 이동을 멈추고 공성 중인가. */
  atCastle = false;
  castleAttackCooldown = 0;
  /** 경로 중심선 기준 좌우 열 위치. */
  laneOffset = 0;

  /** 속성 (원본 정의를 그대로 참조한다 — 복사하지 않는다) */
  traits: UnitTraits | undefined = undefined;

  /** 감속: 남은 시간과 배율. 0이면 감속 없음. */
  freezeTimer = 0;
  slowTimer = 0;
  slowMul = 1;

  /**
   * 가속(기수의 오라): 남은 시간과 배율. 사거리 안에 있는 동안 매 스텝 갱신되므로
   * 기수가 죽거나 멀어지면 곧바로 풀린다.
   */
  hasteTimer = 0;
  hasteMul = 1;

  /** 돌진(장수 고유 능력): 다음 발동까지 남은 시간과 현재 지속 시간 */
  chargeCooldown = 0;
  chargeTimer = 0;

  /** 뷰 보간용: 직전 스텝의 distance */
  prevDistance = 0;

  /**
   * World가 매 스텝 Path.positionAt으로 캐시하는 월드 좌표.
   * 진실의 출처는 distance이며 이 두 값은 파생 캐시일 뿐이다 —
   * 타워 사거리 판정과 SpatialGrid가 매 스텝 재계산하지 않도록 두었다.
   */
  worldX = 0;
  worldZ = 0;

  init(id: number, def: UnitDef, hpMul: number, speedMul: number, laneOffset = 0): void {
    this.id = id;
    this.defId = def.id;
    /*
     * 유닛 표의 체력 * 웨이브 성장률 * 전역 난이도 배율.
     * 마지막 항이 여섯 장의 표를 건드리지 않고 "적이 더 단단하다"를 만든다.
     *
     * 장수(elite/boss)는 다른 배율을 쓴다 — bossHpMul. 장수의 체력은 각 장이
     * inserts 에 hpMul 2·3 으로 적어 둔 값이고, 물량용 배율을 그대로 얹으면
     * 두 축이 섞여 "장수를 얼마나 단단하게 했나"를 한 값으로 읽을 수 없다.
     * 장수는 2초마다 성벽을 치므로(castleCombat.bossAttackInterval) 이쪽을 올리면
     * "성문 앞에 도달한 장수를 끊을 수 있는가"가 곧바로 흔들린다 —
     * 올릴 때마다 level02/03/0456 헤드리스 테스트로 클리어를 확인한다.
     */
    const hardMul = def.kind === 'minion'
      ? BALANCE.difficulty.enemyHpMul
      : BALANCE.difficulty.bossHpMul;
    this.maxHp = Math.round(def.hp * hpMul * hardMul);
    this.hp = this.maxHp;
    this.distance = 0;
    this.prevDistance = 0;
    this.worldX = 0;
    this.worldZ = 0;
    this.speed = def.speed * speedMul;
    this.alive = true;
    this.scale = def.scale;
    this.kind = def.kind;
    this.goldOnKill = def.goldOnKill;
    this.castleDamage = def.castleDamage;
    this.atCastle = false;
    this.castleAttackCooldown = 0;
    this.laneOffset = laneOffset;
    this.traits = def.traits;
    this.freezeTimer = 0;
    this.slowTimer = 0;
    this.slowMul = 1;
    this.hasteTimer = 0;
    this.hasteMul = 1;
    this.chargeCooldown = def.traits?.charge?.every ?? 0;
    this.chargeTimer = 0;
  }

  reset(): void {
    this.id = 0;
    this.defId = '';
    this.hp = 0;
    this.maxHp = 0;
    this.distance = 0;
    this.prevDistance = 0;
    this.worldX = 0;
    this.worldZ = 0;
    this.speed = 0;
    this.alive = false;
    this.scale = 1;
    this.kind = 'minion';
    this.goldOnKill = 0;
    this.castleDamage = 0;
    this.atCastle = false;
    this.castleAttackCooldown = 0;
    this.laneOffset = 0;
    this.traits = undefined;
    this.freezeTimer = 0;
    this.slowTimer = 0;
    this.slowMul = 1;
    this.hasteTimer = 0;
    this.hasteMul = 1;
    this.chargeCooldown = 0;
    this.chargeTimer = 0;
  }

  get hpRatio(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  /** 감속·가속·돌진을 반영한 실제 이동 속도 */
  get effectiveSpeed(): number {
    if (this.atCastle || this.freezeTimer > 0) return 0;
    let s = this.speed;
    if (this.slowTimer > 0) s *= this.slowMul;
    if (this.hasteTimer > 0) s *= this.hasteMul;
    if (this.chargeTimer > 0 && this.traits?.charge) s *= this.traits.charge.speedMul;
    return s;
  }

  /**
   * 가속 적용. 감속과 곱해지므로 철질려에 걸린 기수 부대는 느려진 채로 조금 빨라진다 —
   * 감속을 무효로 만들지는 않는다. 더 센 쪽이 남고 중첩되지 않는다.
   */
  applyHaste(mul: number, duration: number): void {
    if (this.hasteTimer > 0 && this.hasteMul >= mul) {
      this.hasteTimer = Math.max(this.hasteTimer, duration);
      return;
    }
    this.hasteMul = mul;
    this.hasteTimer = duration;
  }

  /** 감속 적용. 이미 더 강한 감속이 걸려 있으면 갱신하지 않는다(중첩 방지). */
  applySlow(mul: number, duration: number): void {
    if (this.traits?.slowImmune) return;
    if (this.slowTimer > 0 && this.slowMul <= mul) {
      // 기존 감속이 더 세다 — 지속 시간만 늘린다
      this.slowTimer = Math.max(this.slowTimer, duration);
      return;
    }
    this.slowMul = mul;
    this.slowTimer = duration;
  }

  /**
   * 속성 저항을 반영한 실제 피해량.
   *
   * 세 종류가 각각 다른 저항을 본다 — 이게 타워를 섞게 만드는 축이다.
   *   ranged  rangedResist (방패병·창병)
   *   siege   아무 저항도 받지 않는다 (그래서 언제나 답이 되지만 느리고 비싸다)
   *   fire    fireResist 로 막고 fireVuln 으로 증폭된다 (젖은 수군 / 마른 등갑)
   */
  damageAfterResist(amount: number, kind: DamageKind): number {
    const t = this.traits;
    if (!t) return amount;
    if (kind === 'ranged' && t.rangedResist) return amount * (1 - t.rangedResist);
    if (kind === 'fire') {
      let v = amount;
      if (t.fireResist) v *= 1 - t.fireResist;
      if (t.fireVuln) v *= t.fireVuln;
      return v;
    }
    return amount;
  }
}
