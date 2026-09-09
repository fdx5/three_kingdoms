import type { UnitDef, UnitKind, UnitTraits } from '../types/units';
import type { DamageKind } from '../types/towers';
import { BALANCE } from '../data/balance';

/**
 * 이 적이 판에서 하려는 일.
 *
 *   runner  성문으로 곧장 간다. 지금까지 모든 적이 이것뿐이었다.
 *   raider  가는 길에 망루가 보이면 대열을 벗어나 부수러 간다.
 *
 * 스폰될 때 한 번 정해지고 바뀌지 않는다 (BALANCE.towerCombat.raiderRatio).
 */
export type EnemyRole = 'runner' | 'raider';

/**
 * 습격조가 지금 어느 단계에 있는가.
 *
 *   none      아직 길 위다. distance 가 위치를 정한다.
 *   approach  망루를 향해 길을 벗어나 달린다. worldX/worldZ 가 위치를 정한다.
 *   assault   자리에 붙어 때리고 있다.
 *   return    표적을 잃고 길로 돌아가는 중이다.
 *
 * none 이 아닌 동안(정확히는 detached 인 동안) 위치의 진실은 distance 가 아니라
 * worldX/worldZ 다. 이 뒤집힘이 이 클래스에서 가장 조심할 부분이라 플래그를
 * 따로 둔다 — 상태 이름으로 판단하면 새 상태가 늘 때마다 조건이 갈라진다.
 */
export type SiegeState = 'none' | 'approach' | 'assault' | 'return';

/**
 * 적. 길 위에 있는 동안은 위치를 저장하지 않는다 — distance 하나로 전부 파생된다.
 * 망루를 치러 길에서 벗어나면(detached) 그때만 worldX/worldZ 가 진실이 된다.
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
  /** 뷰 보간용: 직전 스텝의 월드 좌표. 길을 벗어난 동안 이쪽이 보간의 근거다. */
  prevWorldX = 0;
  prevWorldZ = 0;

  // ── 공성 (망루 습격) ────────────────────────────────────────────────
  /** 스폰 때 정해지는 역할. 열 중 일곱이 raider 다. */
  role: EnemyRole = 'runner';
  siege: SiegeState = 'none';
  /**
   * 길에서 벗어나 자유롭게 움직이는 중인가.
   * true 인 동안 World 는 distance 를 건드리지 않고 worldX/worldZ 를 직접 민다.
   */
  detached = false;
  /** 노리는 망루의 자리 id. 없으면 null. */
  targetSlotId: string | null = null;
  /** 그 망루에서 배정받은 둘레 자리 (-1 = 없음) */
  siegeSlotIndex = -1;
  /** 달려가는 목적지 / 돌아갈 길 위의 지점 */
  moveToX = 0;
  moveToZ = 0;
  /** 뷰가 바라볼 방향 — 달릴 때는 진행 방향, 때릴 때는 망루 쪽이다 */
  faceX = 0;
  faceZ = 1;
  towerAttackCooldown = 0;
  /** 이번 타격 주기 (뷰가 클립 박자를 맞추는 데 쓴다). 0이면 대기 중이다. */
  attackInterval = 0;
  /** 이 망루에 매달린 지 얼마나 됐는가(초). assaultSeconds 를 넘기면 물러난다. */
  siegeElapsed = 0;


  /**
   * World가 매 스텝 Path.positionAt으로 캐시하는 월드 좌표.
   * 진실의 출처는 distance이며 이 두 값은 파생 캐시일 뿐이다 —
   * 타워 사거리 판정과 SpatialGrid가 매 스텝 재계산하지 않도록 두었다.
   */
  worldX = 0;
  worldZ = 0;

  init(id: number, def: UnitDef, hpMul: number, speedMul: number, laneOffset = 0, role: EnemyRole = 'runner'): void {
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
    this.prevWorldX = 0;
    this.prevWorldZ = 0;
    this.speed = def.speed * speedMul;
    this.alive = true;
    this.scale = def.scale;
    this.kind = def.kind;
    this.goldOnKill = def.goldOnKill;
    /*
     * 휘두르는 힘은 성문이든 망루든 하나다 — 여기서 한 번 곱하고 두 전투가 같이 쓴다.
     * 두 곳에서 따로 곱하면 "적의 공격력"이 두 값이 되어 표를 읽을 수 없게 된다.
     */
    this.castleDamage = def.castleDamage * BALANCE.difficulty.unitDamageMul;
    this.atCastle = false;
    this.castleAttackCooldown = 0;
    this.laneOffset = laneOffset;
    this.role = role;
    this.siege = 'none';
    this.detached = false;
    this.targetSlotId = null;
    this.siegeSlotIndex = -1;
    this.moveToX = 0;
    this.moveToZ = 0;
    this.faceX = 0;
    this.faceZ = 1;
    this.towerAttackCooldown = 0;
    this.attackInterval = 0;
    this.siegeElapsed = 0;
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
    this.prevWorldX = 0;
    this.prevWorldZ = 0;
    this.speed = 0;
    this.alive = false;
    this.scale = 1;
    this.kind = 'minion';
    this.goldOnKill = 0;
    this.castleDamage = 0;
    this.atCastle = false;
    this.castleAttackCooldown = 0;
    this.laneOffset = 0;
    this.role = 'runner';
    this.siege = 'none';
    this.detached = false;
    this.targetSlotId = null;
    this.siegeSlotIndex = -1;
    this.moveToX = 0;
    this.moveToZ = 0;
    this.faceX = 0;
    this.faceZ = 1;
    this.towerAttackCooldown = 0;
    this.attackInterval = 0;
    this.siegeElapsed = 0;
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
    if (this.atCastle || this.freezeTimer > 0 || this.siege === 'assault') return 0;
    let s = this.speed;
    if (this.slowTimer > 0) s *= this.slowMul;
    if (this.hasteTimer > 0) s *= this.hasteMul;
    if (this.chargeTimer > 0 && this.traits?.charge) s *= this.traits.charge.speedMul;
    // 대열을 벗어나 망루로 달려드는 순간은 눈에 띄어야 한다 — 그래서 조금 더 빠르다.
    if (this.siege === 'approach') s *= BALANCE.towerCombat.approachSpeedMul;
    return s;
  }

  /** 이 유닛이 망루를 때리는 주기(초). 장수는 더 자주 친다. */
  get towerStrikeInterval(): number {
    const tc = BALANCE.towerCombat;
    return this.kind === 'minion' ? tc.attackInterval : tc.bossAttackInterval;
  }

  /** 망루를 한 대 칠 때의 피해. castleDamage 에 이미 3배가 들어 있다. */
  get towerStrikeDamage(): number {
    const tc = BALANCE.towerCombat;
    const mul = this.kind === 'minion' ? tc.strikeDamageMul : tc.bossStrikeDamageMul;
    return Math.max(1, Math.round(this.castleDamage * mul));
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
