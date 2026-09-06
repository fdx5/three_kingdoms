import type { LevelDef, WaveSpawn, BuildSlotDef } from '../types/level';
import type { UnitDef } from '../types/units';
import type { TowerDef, TargetingMode } from '../types/towers';
import type { GameEvents, RunStats, WorldPos } from '../types/events';
import type { StratagemDef, StratagemStatus } from '../types/stratagems';
import type { CastleLevelDef } from '../types/castle';
import type { DamageKind, FireSource } from '../types/towers';
import type { ProjectileVisual } from '../types/events';
import { EventBus } from '../core/EventBus';
import { ObjectPool } from '../core/ObjectPool';
import { SpatialGrid } from '../core/SpatialGrid';
import { Rng } from '../core/Rng';
import { BALANCE } from '../data/balance';
import { getUnit } from '../data/units';
import { getTower } from '../data/towers';
import { MAX_CASTLE_LEVEL } from '../data/castle';
import { getStratagem, findStratagem } from '../data/stratagems';
import { isTowerAvailable } from '../data/levels';
import { Path } from './Path';
import { Enemy } from './Enemy';
import { Projectile } from './Projectile';
import { FireZone } from './FireZone';
import { Tower, assignArrows } from './Tower';
import { applySplash, applySlowAura, applyHealAura, applySpeedAura } from './effects';
import { Economy } from './Economy';
import { Castle } from './Castle';
import { WaveRunner } from './WaveRunner';

export type BuildResult = 'ok' | 'occupied' | 'no_gold' | 'no_slot' | 'locked' | 'game_over';
export type UpgradeResult = 'ok' | 'max_level' | 'no_gold' | 'no_tower' | 'game_over';
export type CastleUpgradeStatus = 'ok' | 'disabled' | 'max_level' | 'no_gold';

/**
 * 성문이 쏜 투사체의 towerSlotId. 슬롯 지도에는 없는 이름이라
 * 뷰가 "이건 타워가 아니라 성이 쏜 것"을 이 값 하나로 구분한다.
 */
export const CASTLE_SLOT_ID = '__castle__';

/** 시뮬의 피해 종류 + 불 종류를 뷰가 그릴 모습으로 옮긴다. */
function projectileVisual(kind: DamageKind, source: FireSource): ProjectileVisual {
  if (kind === 'fire') return 'flame';
  if (source === 'shell') return 'shell';
  return kind === 'siege' ? 'stone' : 'arrow';
}

export interface WorldOptions {
  level: LevelDef;
  seed?: number;
  bus?: EventBus<GameEvents>;
}

export class World {
  readonly level: LevelDef;
  readonly bus: EventBus<GameEvents>;
  readonly path: Path;
  readonly economy: Economy;
  readonly castle: Castle;
  readonly waveRunner: WaveRunner;
  readonly rng: Rng;

  readonly enemies: Enemy[] = [];
  readonly projectiles: Projectile[] = [];
  readonly fireZones: FireZone[] = [];
  readonly towers = new Map<string, Tower>();
  readonly slots = new Map<string, BuildSlotDef>();

  private enemyPool: ObjectPool<Enemy>;
  private projectilePool: ObjectPool<Projectile>;
  private fireZonePool: ObjectPool<FireZone>;
  private grid = new SpatialGrid<Enemy>(BALANCE.spatialCellSize);

  private nextEnemyId = 1;
  private nextProjectileId = 1;
  private nextFireZoneId = 1;

  /** 계략 id -> 남은 재사용 대기 시간(초) */
  private stratagemCooldowns = new Map<string, number>();
  /** 원군(rally) 남은 시간과 배율. 타워 피해에 곱해진다. */
  fireStormRemaining = 0;
  iceStormRemaining = 0;
  private stormDamageTime = 0;
  private stormDps = 0;
  private rallyTimer = 0;
  private rallyMul = 1;
  private rallyId = '';
  private castleFireCooldown = 0;

  /** 총 경과 시뮬 시간 (초) */
  elapsed = 0;
  kills = 0;
  leaks = 0;
  over: 'none' | 'won' | 'lost' = 'none';

  // 핫패스 재사용 버퍼 — 스텝마다 배열을 새로 만들지 않는다.
  private candidateBuf: Enemy[] = [];
  private targetBuf: Enemy[] = [];
  private arrowBuf: Enemy[] = [];
  private posBuf = { x: 0, z: 0 };
  private predictBuf = { x: 0, z: 0 };
  private dirBuf = { x: 0, z: 0 };

  constructor(opts: WorldOptions) {
    this.level = opts.level;
    this.bus = opts.bus ?? new EventBus<GameEvents>();
    this.path = new Path(opts.level.path);
    this.economy = new Economy(opts.level.startGold);
    this.castle = new Castle(opts.level.castle.id, opts.level.castle.hp);
    this.rng = new Rng(opts.seed ?? 1);

    for (const s of opts.level.buildSlots) this.slots.set(s.id, s);

    this.enemyPool = new ObjectPool<Enemy>(
      () => new Enemy(),
      (e) => e.reset(),
      64,
    );
    this.projectilePool = new ObjectPool<Projectile>(
      () => new Projectile(),
      (p) => p.reset(),
      128,
    );
    this.fireZonePool = new ObjectPool<FireZone>(() => new FireZone(), (z) => z.reset(), 24);

    this.waveRunner = new WaveRunner(
      opts.level.waves,
      {
        spawn: (s) => this.spawnEnemy(s),
        onWaveStarted: (wave, total) =>
          this.bus.emit('wave:started', {
            index: wave.index,
            total,
            banner: wave.banner,
            isBossWave: wave.isBossWave ?? false,
          }),
        onWaveCleared: (wave, reward) => {
          if (reward > 0) this.grantGold(reward, 'wave_reward');
          this.bus.emit('wave:cleared', { index: wave.index, reward });
        },
        onCountdown: (index, remaining, total) =>
          this.bus.emit('wave:countdown', { index, remaining, total }),
        onAllWavesCleared: () => this.finish('won'),
        hasLiveEnemies: () => this.enemies.length > 0,
      },
      opts.level.firstWaveDelay ?? BALANCE.firstWaveDelay,
      opts.level.waveInterval ?? BALANCE.waveInterval,
      opts.level.earlyCallBonusPerSecond ?? BALANCE.earlyCallBonusPerSecond,
    );
  }

  // -------------------------------------------------------------------
  // step 순서는 고정이다. 바꾸면 결과가 달라진다.
  //   1) 스폰 큐 소비 (WaveRunner)
  //   2) 상태이상 시간 감소 (감속 / 돌진)
  //   3) 적 이동 (감속·돌진이 반영된 실제 속도로)
  //   4) 누수 판정 -> 성 피해 -> 적 제거
  //   5) SpatialGrid 갱신
  //   6) 회복 오라 (도사) — 타워가 쏘기 전에 회복시켜야 "회복을 뚫는" 판정이 된다
  //   7) 타워 쿨다운 감소 및 발사 / 오라 적용
  //   8) 투사체 이동 및 명중 판정
  //   9) 사망 처리 -> 골드 지급 -> 풀 반환
  //  10) 웨이브 상태 갱신
  // 8)에서 준 피해가 9)에서 사망으로 수거되도록 순서를 이렇게 둔다.
  // 2)가 3)보다 먼저여야 감속이 걸린 그 스텝부터 느려진다.
  // -------------------------------------------------------------------
  step(dt: number): void {
    if (this.over !== 'none') return;
    this.elapsed += dt;

    // 1) + 10) — WaveRunner가 둘 다 처리한다. 스폰이 이동보다 먼저여야 하므로 앞에 둔다.
    this.waveRunner.step(dt);

    if (this.repairCooldown > 0) this.repairCooldown = Math.max(0, this.repairCooldown - dt);
    this.tickStratagems(dt);

    this.updateStatusEffects(dt); // 2)
    this.moveEnemies(dt); // 3)
    this.updateCastleCombat(dt); // 4)
    if (this.over !== 'none') return;
    this.rebuildGrid(); // 5)
    this.updateHealAuras(dt); // 6)
    this.updateFireZones(dt); // 6.5) 지면 지속 피해
    this.updateTowers(dt); // 7)
    this.updateProjectiles(dt); // 8)
    this.collectDead(); // 9)
    for (const e of this.enemies) e.freezeTimer = Math.max(0, e.freezeTimer - dt);
  }

  // 2) 상태이상
  private updateStatusEffects(dt: number): void {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.slowTimer > 0) {
        e.slowTimer -= dt;
        if (e.slowTimer <= 0) {
          e.slowTimer = 0;
          e.slowMul = 1;
        }
      }
      if (e.hasteTimer > 0) {
        e.hasteTimer -= dt;
        if (e.hasteTimer <= 0) {
          e.hasteTimer = 0;
          e.hasteMul = 1;
        }
      }
      if (e.freezeTimer > 0) continue;
      const charge = e.traits?.charge;
      if (!charge) continue;
      if (e.chargeTimer > 0) {
        e.chargeTimer -= dt;
        if (e.chargeTimer <= 0) {
          e.chargeTimer = 0;
          e.chargeCooldown = charge.every;
          this.bus.emit('enemy:ability', { enemyId: e.id, unitId: e.defId, ability: 'charge', active: false });
        }
      } else {
        e.chargeCooldown -= dt;
        if (e.chargeCooldown <= 0) {
          e.chargeTimer = charge.duration;
          this.bus.emit('enemy:ability', { enemyId: e.id, unitId: e.defId, ability: 'charge', active: true });
        }
      }
    }
  }

  // 6) 적의 오라 (회복 / 가속)
  private updateHealAuras(dt: number): void {
    for (let i = 0; i < this.enemies.length; i++) {
      const source = this.enemies[i];
      if (!source.alive || !source.traits || source.freezeTimer > 0) continue;
      const heal = source.traits.healAura;
      if (heal) applyHealAura(source, this.enemies, heal.radius, heal.hps, dt);
      const haste = source.traits.speedAura;
      if (haste) {
        applySpeedAura(
          source,
          this.enemies,
          haste.radius,
          haste.speedMul,
          BALANCE.auraRefreshSec,
        );
      }
    }
  }

  // 1) 스폰
  private spawnEnemy(spawn: WaveSpawn): void {
    const def: UnitDef = getUnit(spawn.unitId);
    const e = this.enemyPool.acquire();
    e.init(this.nextEnemyId++, def, spawn.hpMul, spawn.speedMul, spawn.laneOffset ?? 0);
    this.path.positionAt(0, this.posBuf);
    this.path.directionAt(0, this.dirBuf);
    e.worldX = this.posBuf.x + this.dirBuf.z * e.laneOffset;
    e.worldZ = this.posBuf.z - this.dirBuf.x * e.laneOffset;
    this.enemies.push(e);
    this.bus.emit('enemy:spawned', { enemyId: e.id, unitId: e.defId, distance: 0 });
  }

  // 3) 이동
  private moveEnemies(dt: number): void {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      e.prevDistance = e.distance;
      if (!e.atCastle) e.distance += e.effectiveSpeed * dt;
      this.path.positionAt(e.distance, this.posBuf);
      this.path.directionAt(e.distance, this.dirBuf);
      e.worldX = this.posBuf.x + this.dirBuf.z * e.laneOffset;
      e.worldZ = this.posBuf.z - this.dirBuf.x * e.laneOffset;
    }
  }

  // 4) 성문 전투 — 도착한 적은 사라지지 않고 죽을 때까지 성을 반복 공격한다.
  private updateCastleCombat(dt: number): void {
    const stop = this.path.totalLength * BALANCE.leakDistanceRatio - BALANCE.castleCombat.stopBeforeGate;
    for (const e of this.enemies) {
      if (!e.alive || e.freezeTimer > 0) continue;
      if (!e.atCastle && e.distance >= stop) {
        e.distance = stop;
        e.prevDistance = stop;
        this.path.positionAt(stop, this.posBuf);
        this.path.directionAt(stop, this.dirBuf);
        e.worldX = this.posBuf.x + this.dirBuf.z * e.laneOffset;
        e.worldZ = this.posBuf.z - this.dirBuf.x * e.laneOffset;
        e.atCastle = true;
        e.castleAttackCooldown = BALANCE.castleCombat.enemyFirstImpactDelay;
        this.leaks++;
        this.bus.emit('enemy:leaked', { enemyId: e.id, unitId: e.defId, castleDamage: e.castleDamage });
      }
      if (!e.atCastle) continue;
      e.castleAttackCooldown -= dt;
      if (e.castleAttackCooldown > 0) continue;
      /*
       * 장수는 2초마다, 잡몹은 16초마다 성벽을 친다.
       * 같은 간격으로 두면 장수가 성문 앞에서 그냥 서 있는 것처럼 보인다 —
       * 무엇이 위협인지는 얼마나 자주 때리는가로 읽힌다. [[BALANCE.castleCombat]]
       */
      const boss = e.kind !== 'minion';
      const cc = BALANCE.castleCombat;
      e.castleAttackCooldown += boss ? cc.bossAttackInterval : cc.enemyAttackInterval;
      const mul = boss ? cc.bossStrikeDamageMul : cc.enemyStrikeDamageMul;
      const strike = Math.max(1, Math.round(e.castleDamage * mul));
      const dmg = this.castle.takeDamage(strike);
      this.bus.emit('enemy:castle-attack', { enemyId: e.id, unitId: e.defId, castleDamage: dmg });
      this.bus.emit('castle:damaged', { hp: this.castle.hp, maxHp: this.castle.maxHp, amount: dmg });
      if (this.castle.destroyed) {
        this.finish('lost');
        return;
      }
    }

    this.updateCastleWeapon(dt);
  }

  /**
   * 성문의 반격. 무엇으로 쏘는지는 성문 강화 단계가 정한다 (src/data/castle.ts).
   *
   * 앞 세 장의 성은 성벽에 달라붙은 적만 화살 두 발로 때렸다. 이제 단계마다
   * 사거리가 있으므로 "다가오는 적"도 사정권에 들어온다 — 다만 성벽을 두드리는
   * 적이 있으면 언제나 그쪽이 먼저다(preferAtGate). 사거리가 늘었다고 코앞의
   * 공성병을 놔두고 멀리를 쏘면 성문 강화가 오히려 손해가 되기 때문이다.
   */
  private updateCastleWeapon(dt: number): void {
    this.castleFireCooldown -= dt;
    if (this.castleFireCooldown > 0) return;

    const weapon = this.castle.levelDef.weapon;
    const target = this.pickCastleTarget(weapon.range);
    if (!target) return;

    for (let i = 0; i < weapon.shots; i++) this.fireCastleShot(target, i, weapon.shots);
    this.castleFireCooldown = weapon.fireInterval;
    this.bus.emit('castle:fired', {
      level: this.castle.level,
      kind: weapon.kind,
      shots: weapon.shots,
      targetId: target.id,
    });
  }

  /** 성벽에 붙은 적 우선, 그다음 사거리 안에서 가장 앞선 적. */
  private pickCastleTarget(range: number): Enemy | null {
    const gate = this.castlePosition();
    const r2 = range * range;
    let atGate: Enemy | null = null;
    let approaching: Enemy | null = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.atCastle) {
        if (!atGate || e.distance > atGate.distance || (e.distance === atGate.distance && e.hp < atGate.hp)) {
          atGate = e;
        }
        continue;
      }
      const dx = e.worldX - gate.x;
      const dz = e.worldZ - gate.z;
      if (dx * dx + dz * dz > r2) continue;
      if (!approaching || e.distance > approaching.distance) approaching = e;
    }
    if (BALANCE.castleCombat.preferAtGate && atGate) return atGate;
    return atGate ?? approaching;
  }

  /**
   * 성문 한 발.
   *
   * dualMuzzle 무기는 좌우 망루에서 번갈아 나가고, 화룡구(Lv6)는 두 줄기가
   * 동시에 양쪽에서 떠나 목표에서 만난다 — 시뮬은 두 발을 각각 명중시키고,
   * 뷰는 from 좌표가 다르므로 저절로 양방향 연출이 된다.
   */
  private fireCastleShot(target: Enemy, salvoIndex: number, salvoSize: number): void {
    if (this.projectiles.length >= BALANCE.maxProjectiles) return;
    const weapon = this.castle.levelDef.weapon;
    const muzzle = this.castleMuzzle(salvoIndex, weapon.dualMuzzle);
    const kind: DamageKind =
      weapon.kind === 'arrow' ? 'ranged' : weapon.kind === 'cannon' ? 'siege' : 'fire';

    const p = this.projectilePool.acquire();
    p.init(
      this.nextProjectileId++,
      CASTLE_SLOT_ID,
      muzzle.x,
      muzzle.z,
      target.worldX,
      target.worldZ,
      target.id,
      weapon.damagePerShot,
      weapon.projectileSpeed,
      weapon.projectileArcHeight,
      kind,
      weapon.splashRadius,
      weapon.splashFalloff,
      salvoIndex,
      salvoSize,
      this.castle.level,
      weapon.ignite?.radius ?? 0,
      weapon.ignite?.dps ?? 0,
      weapon.ignite?.duration ?? 0,
      weapon.fireSource,
    );
    this.projectiles.push(p);
    this.bus.emit('projectile:fired', {
      projectileId: p.id,
      towerSlotId: CASTLE_SLOT_ID,
      kind: projectileVisual(kind, weapon.fireSource),
      from: { x: muzzle.x, y: muzzle.y, z: muzzle.z },
      to: { x: p.toX, y: 8, z: p.toZ },
      targetId: target.id,
    });
  }

  /**
   * 이 발이 떠나는 자리 — 좌 망루 / 우 망루 / 성문 한가운데.
   * 경로의 마지막 진행 방향에 수직으로 벌리므로 맵이 어느 쪽에서 들어오든 맞는다.
   */
  private castleMuzzle(salvoIndex: number, dual: boolean): WorldPos {
    const gate = this.castlePosition();
    if (!dual) return { x: gate.x, y: BALANCE.castleCombat.muzzleHeight * 0.6, z: gate.z };
    this.path.directionAt(this.path.totalLength, this.dirBuf);
    const side = salvoIndex % 2 === 0 ? 1 : -1;
    const spread = BALANCE.castleCombat.muzzleSpread;
    return {
      x: gate.x + this.dirBuf.z * spread * side,
      y: BALANCE.castleCombat.muzzleHeight,
      z: gate.z - this.dirBuf.x * spread * side,
    };
  }

  // 5) 격자
  private rebuildGrid(): void {
    this.grid.clear();
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.alive) this.grid.insert(e.worldX, e.worldZ, e);
    }
  }

  // 7) 타워
  private updateTowers(dt: number): void {
    for (const tower of this.towers.values()) {
      tower.cooldown -= dt;
      if (tower.cooldown > 0) continue;

      this.grid.queryRadius(tower.x, tower.z, tower.range, this.candidateBuf);
      const targets = tower.acquire(this.candidateBuf, this.targetBuf);
      if (targets.length === 0) continue;

      const lv = tower.levelDef;

      // aura 타워는 투사체를 쏘지 않고 사거리 안 적에게 직접 효과를 건다.
      if (tower.def.kind === 'aura') {
        this.applyAura(tower, targets, lv.arrows);
        tower.cooldown = lv.fireInterval;
        continue;
      }

      assignArrows(targets, lv.arrows, this.arrowBuf);
      // 원군(rally)은 발사 시점에 곱해진다 — 이미 날아가는 화살은 강해지지 않는다.
      const damage = lv.damagePerArrow * this.rallyMul;
      for (let i = 0; i < this.arrowBuf.length; i++) {
        this.fireArrow(tower, this.arrowBuf[i], damage, i, this.arrowBuf.length);
      }
      const primary = targets[0];
      tower.lastFireAngle = Math.atan2(primary.worldX - tower.x, primary.worldZ - tower.z);
      tower.cooldown = lv.fireInterval;
    }
  }

  /** aura 타워: 최대 maxTargets명에게 효과를 건다. 레벨이 오르면 더 많이 잡는다. */
  private applyAura(tower: Tower, targets: readonly Enemy[], maxTargets: number): void {
    const effect = tower.def.effect;
    if (!effect || effect.type !== 'slow') return;
    const slice = targets.length <= maxTargets ? targets : targets.slice(0, maxTargets);
    const affected = applySlowAura(slice, effect.params.speedMul, effect.params.duration);
    if (affected > 0) {
      this.bus.emit('tower:aura', {
        slotId: tower.slotId,
        towerId: tower.def.id,
        affected,
        worldPos: { x: tower.x, y: 0, z: tower.z },
      });
    }
  }

  private fireArrow(
    tower: Tower,
    target: Enemy,
    damage: number,
    salvoIndex = 0,
    salvoSize = 1,
  ): void {
    if (this.projectiles.length >= BALANCE.maxProjectiles) return;
    const proj = tower.def.projectile;

    // 리드 타게팅: 도달 시간을 추정해 그 시점의 목표 위치를 예측한다.
    // 감속·돌진이 걸린 적은 실제 속도로 예측해야 빗나가지 않는다.
    const dist = Math.hypot(target.worldX - tower.x, target.worldZ - tower.z);
    const flightTime = dist / proj.speed;
    this.path.positionAt(target.distance + target.effectiveSpeed * flightTime, this.predictBuf);
    this.path.directionAt(target.distance + target.effectiveSpeed * flightTime, this.dirBuf);
    this.predictBuf.x += this.dirBuf.z * target.laneOffset;
    this.predictBuf.z -= this.dirBuf.x * target.laneOffset;

    const p = this.projectilePool.acquire();
    /*
     * 착탄 지점에 남길 불.
     *
     * 기본값은 "3레벨부터 무기가 달아오른다"(BALANCE.fire)로, 궁노 망루와 벽력거가
     * 여기에 해당한다. 화공 망루·화포처럼 불이 곧 정체성인 타워는 TowerDef.ignite 에
     * 자기 값을 적어 1레벨부터, 레벨에 비례해 더 크게 태운다.
     */
    const kind = tower.def.damageKind;
    const custom = tower.def.ignite;
    const fallback = kind === 'siege' ? BALANCE.fire.stone : BALANCE.fire.arrow;
    const fireSource: FireSource = custom?.source ?? (kind === 'siege' ? 'stone' : 'arrow');
    const ignites = tower.level >= (custom?.fromLevel ?? BALANCE.fire.unlockLevel);
    const dpsScale = custom?.dpsPerLevel ? Math.pow(custom.dpsPerLevel, tower.level - 1) : 1;
    const fireRadius = ignites ? (custom?.radius ?? fallback.radius) : 0;
    const fireDps = ignites ? (custom?.dps ?? fallback.dps) * dpsScale : 0;
    const fireDuration = ignites ? (custom?.duration ?? fallback.duration) : 0;

    p.init(
      this.nextProjectileId++,
      tower.slotId,
      tower.x,
      tower.z,
      this.predictBuf.x,
      this.predictBuf.z,
      target.id,
      damage,
      proj.speed,
      proj.arcHeight,
      kind,
      tower.def.effect?.type === 'splash' ? tower.def.effect.params.radius : 0,
      tower.def.effect?.type === 'splash' ? tower.def.effect.params.falloff : 0,
      salvoIndex,
      salvoSize,
      tower.level,
      fireRadius,
      fireDps,
      fireDuration,
      fireSource,
    );
    this.projectiles.push(p);
    this.bus.emit('projectile:fired', {
      projectileId: p.id,
      towerSlotId: tower.slotId,
      kind: projectileVisual(kind, fireSource),
      from: { x: tower.x, y: 38, z: tower.z },
      to: { x: p.toX, y: 0, z: p.toZ },
      targetId: target.id,
    });
  }

  // 8) 투사체
  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.prevX = p.x;
      p.prevZ = p.z;
      p.prevTraveled = p.traveled;
      p.lifetime += dt;

      // 목표가 살아있으면 조준을 갱신한다. 죽었으면 마지막 예측 지점으로 계속 날아가 소멸한다.
      const target = p.targetId ? this.findEnemy(p.targetId) : null;
      if (target && target.alive) {
        p.toX = target.worldX;
        p.toZ = target.worldZ;
      } else {
        p.targetId = 0;
      }

      const dx = p.toX - p.x;
      const dz = p.toZ - p.z;
      const remaining = Math.hypot(dx, dz);
      const stepDist = p.speed * dt;

      if (remaining <= Math.max(stepDist, BALANCE.projectileHitRadius)) {
        p.x = p.toX;
        p.z = p.toZ;
        p.traveled = p.totalDist;
        const didHit = !!(target && target.alive);
        if (didHit && target) this.damageEnemy(target, p.damage, p.damageKind);
        // 범위 피해는 빗나가도 터진다 — 착탄 지점 기준이기 때문이다.
        if (p.splashRadius > 0) {
          applySplash(
            this.enemies,
            p.x,
            p.z,
            p.splashRadius,
            p.splashFalloff,
            p.damage,
            didHit && target ? target.id : 0,
            this.damageEnemyBound,
            // 화룡구의 폭발은 불이다 — 젖은 적에게는 폭발까지 약해져야 앞뒤가 맞는다.
            p.damageKind === 'fire' ? 'fire' : 'siege',
          );
        }
        if (p.fireRadius > 0) this.createFireZone(p.x, p.z, p.fireRadius, p.fireDps, p.fireDuration, p.fireSource);
        this.bus.emit('projectile:hit', {
          projectileId: p.id,
          enemyId: didHit && target ? target.id : 0,
          worldPos: { x: p.x, y: 6, z: p.z },
          hit: didHit,
          splashRadius: p.splashRadius,
          fire: p.fireRadius > 0,
        });
        this.releaseProjectileAt(i);
        continue;
      }

      const inv = 1 / remaining;
      p.x += dx * inv * stepDist;
      p.z += dz * inv * stepDist;
      p.traveled += stepDist;

      if (p.lifetime > BALANCE.projectileMaxLifetime) {
        this.bus.emit('projectile:hit', {
          projectileId: p.id,
          enemyId: 0,
          worldPos: { x: p.x, y: 6, z: p.z },
          hit: false,
          fire: false,
        });
        this.releaseProjectileAt(i);
      }
    }
  }

  /** 가까운 불은 합쳐 프레임 폭주를 막고, 대신 수명을 갱신해 계속 타오르게 한다. */
  private createFireZone(
    x: number,
    z: number,
    radius: number,
    dps: number,
    duration: number,
    source: FireSource,
  ): void {
    const mergeDist2 = (radius * BALANCE.fire.mergeDistanceRatio) ** 2;
    for (const zone of this.fireZones) {
      const dx = zone.x - x;
      const dz = zone.z - z;
      if (zone.source === source && dx * dx + dz * dz <= mergeDist2) {
        zone.remaining = Math.max(zone.remaining, duration);
        return;
      }
    }
    if (this.fireZones.length >= BALANCE.fire.maxZones) return;
    const zone = this.fireZonePool.acquire();
    zone.init(this.nextFireZoneId++, x, z, radius, dps, duration, source);
    this.fireZones.push(zone);
    this.bus.emit('fire-zone:created', {
      zoneId: zone.id,
      worldPos: { x, y: 3, z },
      radius,
      duration,
      source,
    });
  }

  private updateFireZones(dt: number): void {
    for (let i = this.fireZones.length - 1; i >= 0; i--) {
      const zone = this.fireZones[i];
      zone.remaining -= dt;
      zone.tickAccumulator += dt;
      while (zone.tickAccumulator >= BALANCE.fire.damageTick) {
        zone.tickAccumulator -= BALANCE.fire.damageTick;
        const r2 = zone.radius * zone.radius;
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;
          const dx = enemy.worldX - zone.x;
          const dz = enemy.worldZ - zone.z;
          if (dx * dx + dz * dz <= r2) {
            // 지면의 불은 화염 피해다 — 젖은 적은 덜 타고 마른 적은 더 탄다.
            this.damageEnemy(enemy, zone.dps * BALANCE.fire.damageTick, 'fire');
          }
        }
      }
      if (zone.remaining > 0) continue;
      this.fireZones.splice(i, 1);
      this.bus.emit('fire-zone:removed', { zoneId: zone.id });
      this.fireZonePool.release(zone);
    }
  }

  /** applySplash에 넘기기 위한 바인딩. 스텝마다 클로저를 새로 만들지 않는다. */
  private damageEnemyBound = (e: Enemy, amount: number, kind: DamageKind): void =>
    this.damageEnemy(e, amount, kind);

  private damageEnemy(e: Enemy, amount: number, kind: DamageKind = 'ranged'): void {
    if (!e.alive) return;
    // 방패병의 원거리 저항은 여기서 한 번만 적용한다.
    const effective = e.damageAfterResist(amount, kind);
    const applied = Math.min(e.hp, effective);
    e.hp -= applied;
    this.bus.emit('enemy:damaged', {
      enemyId: e.id,
      amount: applied,
      hpRatio: e.hpRatio,
      worldPos: { x: e.worldX, y: 20 * e.scale, z: e.worldZ },
    });
    if (e.hp <= 0) e.alive = false;
  }

  // 9) 사망 수거
  private collectDead(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.alive) continue;
      const pos: WorldPos = { x: e.worldX, y: 20 * e.scale, z: e.worldZ };
      this.kills++;
      const gold = e.goldOnKill;
      const unitId = e.defId;
      const enemyId = e.id;
      this.removeEnemyAt(i);
      this.bus.emit('enemy:killed', { enemyId, unitId, gold, worldPos: pos });
      this.grantGold(gold, 'kill', pos);
    }
  }

  private removeEnemyAt(i: number): void {
    const e = this.enemies[i];
    this.enemies.splice(i, 1);
    // 이 적을 노리던 투사체는 목표를 잃는다 (마지막 예측 지점까지 날아가 소멸).
    for (let j = 0; j < this.projectiles.length; j++) {
      if (this.projectiles[j].targetId === e.id) this.projectiles[j].targetId = 0;
    }
    this.enemyPool.release(e);
  }

  private releaseProjectileAt(i: number): void {
    const p = this.projectiles[i];
    this.projectiles.splice(i, 1);
    this.projectilePool.release(p);
  }

  private findEnemy(id: number): Enemy | null {
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i].id === id) return this.enemies[i];
    }
    return null;
  }

  // 골드
  private grantGold(amount: number, reason: string, worldPos?: WorldPos): void {
    if (amount === 0) return;
    const total = this.economy.add(amount);
    this.bus.emit('gold:changed', { total, delta: amount, reason, worldPos });
  }

  private spendGold(amount: number, reason: string, worldPos?: WorldPos): boolean {
    if (!this.economy.trySpend(amount)) return false;
    this.bus.emit('gold:changed', { total: this.economy.gold, delta: -amount, reason, worldPos });
    return true;
  }

  // 플레이어 액션
  build(slotId: string, towerId = 'archer_tower'): BuildResult {
    if (this.over !== 'none') return 'game_over';
    const slot = this.slots.get(slotId);
    if (!slot) return 'no_slot';
    if (this.towers.has(slotId)) return 'occupied';
    const def: TowerDef = getTower(towerId);
    // 레벨 2에서 해금되는 타워를 레벨 1에서 지을 수는 없다.
    if (!isTowerAvailable(def.unlockedIn, this.level.id)) return 'locked';
    const pos: WorldPos = { x: slot.x, y: 0, z: slot.z };
    if (!this.spendGold(def.buildCost, 'build', pos)) return 'no_gold';

    const tower = new Tower(slotId, def, slot.x, slot.z);
    this.towers.set(slotId, tower);
    this.bus.emit('tower:built', { slotId, towerId: def.id, cost: def.buildCost, worldPos: pos });
    return 'ok';
  }

  upgrade(slotId: string): UpgradeResult {
    if (this.over !== 'none') return 'game_over';
    const tower = this.towers.get(slotId);
    if (!tower) return 'no_tower';
    const cost = tower.nextUpgradeCost;
    if (cost === null) return 'max_level';
    const pos: WorldPos = { x: tower.x, y: 0, z: tower.z };
    if (!this.spendGold(cost, 'upgrade', pos)) return 'no_gold';
    tower.applyUpgrade(cost);
    this.bus.emit('tower:upgraded', {
      slotId,
      towerId: tower.def.id,
      level: tower.level,
      cost,
      worldPos: pos,
    });
    return 'ok';
  }

  sell(slotId: string): number {
    if (this.over !== 'none') return 0;
    const tower = this.towers.get(slotId);
    if (!tower) return 0;
    const refund = tower.sellValue();
    const pos: WorldPos = { x: tower.x, y: 0, z: tower.z };
    this.towers.delete(slotId);
    this.grantGold(refund, 'sell', pos);
    this.bus.emit('tower:sold', { slotId, towerId: tower.def.id, refund, worldPos: pos });
    return refund;
  }

  setTargeting(slotId: string, targeting: TargetingMode): void {
    const tower = this.towers.get(slotId);
    if (!tower) return;
    tower.targeting = targeting;
    this.bus.emit('tower:targeting', { slotId, targeting });
  }

  /**
   * 성벽 수리 — 남는 골드의 소비처.
   * 한 번에 chunkHp 만큼(부족분이 더 적으면 그만큼) 고치고 goldPerHp 비율로 지불한다.
   * 실제로 고친 양을 반환한다. 0이면 아무 일도 없었다는 뜻이다.
   */
  repairCastle(): number {
    if (!this.canRepair()) return 0;
    const missing = this.castle.missingHp;
    if (missing <= 0) return 0;
    const hp = Math.min(BALANCE.repair.chunkHp, missing);
    const cost = hp * BALANCE.repair.goldPerHp;
    const pos: WorldPos = this.castlePosition();
    if (!this.spendGold(cost, 'repair', pos)) return 0;
    const healed = this.castle.repair(hp);
    this.repairCooldown = BALANCE.repair.cooldownSec;
    this.bus.emit('castle:repaired', {
      hp: this.castle.hp,
      maxHp: this.castle.maxHp,
      amount: healed,
      cost,
    });
    return healed;
  }

  /**
   * 지금 성벽을 고칠 수 있는가.
   *
   * 규칙 두 가지: (1) 웨이브가 스폰되는 중에는 못 고친다 (2) 수리 사이에 쿨다운이 있다.
   *
   * 네 가지를 다 재봤다.
   *   상시 무제한        누수가 실시간으로 지워져 성 체력이 사실상 무한 (누수 36기에 600/600)
   *   대기 중에만        마지막 웨이브 피해가 전부 정리 구간에 몰려서 수리가 한 번도 못 쓰인다
   *   정리 구간도 무제한  역시 전부 지워져 600/600
   *   정리 구간 + 쿨다운  마지막 웨이브 피해의 일부만 만회한다 <- 이걸 쓴다
   *
   * 마지막 웨이브를 얼마나 깔끔하게 막았는가가 여전히 성적을 가르되,
   * 남는 골드가 죽은 자원이 되지는 않는다.
   */
  canRepair(): boolean {
    if (!this.level.allowRepair) return false;
    if (this.over !== 'none') return false;
    if (BALANCE.repair.notWhileSpawning && this.waveRunner.state === 'spawning') return false;
    return this.repairCooldown <= 0;
  }

  /** 다음 수리까지 남은 시간(초). HUD가 버튼에 표시한다. */
  repairCooldown = 0;

  /**
   * 왜 지금 수리를 못 하는가. HUD가 버튼에 이유를 적는다 —
   * "수리 불가" 한 마디로는 성이 멀쩡해서인지 쿨다운인지 알 수 없다.
   */
  repairStatus(): 'ok' | 'disabled' | 'full' | 'spawning' | 'cooldown' | 'no_gold' {
    if (!this.level.allowRepair || this.over !== 'none') return 'disabled';
    if (this.castle.missingHp <= 0) return 'full';
    if (BALANCE.repair.notWhileSpawning && this.waveRunner.state === 'spawning') return 'spawning';
    if (this.repairCooldown > 0) return 'cooldown';
    const hp = Math.min(BALANCE.repair.chunkHp, this.castle.missingHp);
    if (!this.economy.canAfford(hp * BALANCE.repair.goldPerHp)) return 'no_gold';
    return 'ok';
  }

  /** 다음 수리 1회의 비용과 회복량 (HUD 버튼 표시용). 지금 고칠 수 없으면 null. */
  repairQuote(): { hp: number; cost: number } | null {
    if (!this.canRepair()) return null;
    const missing = this.castle.missingHp;
    if (missing <= 0) return null;
    const hp = Math.min(BALANCE.repair.chunkHp, missing);
    return { hp, cost: hp * BALANCE.repair.goldPerHp };
  }

  // ── 성문 강화 ───────────────────────────────────────────────────────

  /**
   * 성문을 한 단계 올린다.
   *
   * 타워와 달리 성문은 팔 수도, 옮길 수도 없다. 그래서 되돌릴 수 없는 지출이고
   * 그만큼 값이 세다 — 슬롯이 모자라는 마지막 구간을 살 때만 이득이 되도록 잡았다.
   * 성벽 수리와 달리 웨이브 한복판에도 올릴 수 있다: 강화는 "지금 이 순간을
   * 넘기는" 수단이 아니라 다음 웨이브를 위한 투자라, 타이밍을 막을 이유가 없다.
   */
  upgradeCastle(): UpgradeResult {
    if (this.castleUpgradeStatus() !== 'ok') {
      if (this.over !== 'none') return 'game_over';
      if (this.castle.isMaxLevel) return 'max_level';
      if (!this.level.castleUpgrade) return 'no_tower';
      return 'no_gold';
    }
    const cost = this.castle.nextUpgradeCost!;
    const pos = this.castlePosition();
    if (!this.spendGold(cost, 'castle_upgrade', pos)) return 'no_gold';
    const def: CastleLevelDef = this.castle.applyUpgrade();
    // 새 무기로 바뀌는 순간은 쿨다운을 비워 준다 — 눌렀는데 아무 일도 안 일어나면 안 된다.
    this.castleFireCooldown = 0;
    this.bus.emit('castle:upgraded', {
      level: def.level,
      title: def.title,
      cost,
      hp: this.castle.hp,
      maxHp: this.castle.maxHp,
      weaponKind: def.weapon.kind,
      shots: def.weapon.shots,
      worldPos: pos,
    });
    return 'ok';
  }

  /** 왜 지금 못 올리는가. HUD가 버튼에 이유를 적는다. */
  castleUpgradeStatus(): CastleUpgradeStatus {
    if (!this.level.castleUpgrade || this.over !== 'none') return 'disabled';
    if (this.castle.isMaxLevel) return 'max_level';
    const cost = this.castle.nextUpgradeCost;
    if (cost === null) return 'max_level';
    if (!this.economy.canAfford(cost)) return 'no_gold';
    return 'ok';
  }

  /** 다음 단계의 정의와 비용 (HUD 표시용). 만렙이거나 잠겨 있으면 null. */
  castleUpgradeQuote(): { level: number; title: string; description: string; cost: number } | null {
    if (!this.level.castleUpgrade) return null;
    const next = this.castle.nextLevelDef;
    if (!next || next.upgradeCost === null) return null;
    return { level: next.level, title: next.title, description: next.description, cost: next.upgradeCost };
  }

  get castleMaxLevel(): number {
    return MAX_CASTLE_LEVEL;
  }

  // ── 계략 ────────────────────────────────────────────────────────────

  /**
   * 이 레벨에서 쓸 수 있는 계략들. 레벨이 목록을 정하므로
   * 카드를 추가해도 앞 레벨의 밸런스는 건드려지지 않는다.
   */
  get stratagems(): StratagemDef[] {
    const ids = this.level.stratagems;
    if (!ids || ids.length === 0) return [];
    return ids.map((id) => getStratagem(id));
  }

  /** 계략 쿨다운과 지속 효과를 흘려보낸다 */
  private tickStratagems(dt: number): void {
    if (this.iceStormRemaining > 0) {
      for (const e of this.enemies) if (e.alive) e.freezeTimer = Math.max(e.freezeTimer, this.iceStormRemaining);
      this.iceStormRemaining = Math.max(0, this.iceStormRemaining - dt);
      if (this.iceStormRemaining < 1e-8) { this.iceStormRemaining = 0; this.bus.emit('stratagem:ended', { stratagemId: 'ice_storm' }); }
    }
    if (this.fireStormRemaining > 0) {
      this.stormDamageTime += Math.min(dt, this.fireStormRemaining);
      this.fireStormRemaining = Math.max(0, this.fireStormRemaining - dt);
      if (this.fireStormRemaining < 1e-8) this.fireStormRemaining = 0;
      if (this.stormDamageTime >= 0.25 - 1e-8 || this.fireStormRemaining === 0) {
        for (const e of this.enemies) if (e.alive) this.damageEnemy(e, this.stormDps * this.stormDamageTime, 'fire');
        this.stormDamageTime = 0;
        this.collectDead();
      }
      if (this.fireStormRemaining === 0) this.bus.emit('stratagem:ended', { stratagemId: 'fire_attack' });
    }

    if (this.stratagemCooldowns.size > 0) {
      for (const [id, t] of this.stratagemCooldowns) {
        const next = t - dt;
        if (next <= 0) this.stratagemCooldowns.delete(id);
        else this.stratagemCooldowns.set(id, next);
      }
    }
    if (this.rallyTimer > 0) {
      this.rallyTimer -= dt;
      if (this.rallyTimer <= 0) {
        this.rallyTimer = 0;
        this.rallyMul = 1;
        this.bus.emit('stratagem:ended', { stratagemId: this.rallyId });
        this.rallyId = '';
      }
    }
  }

  /**
   * 계략 발동. 실제로 영향을 준 대상 수를 반환한다 (0이면 아무 일도 없었다).
   *
   * 수리와 달리 웨이브 한복판에도 쓸 수 있다 — 그게 계략의 존재 이유다.
   * 대신 쿨다운이 길고, 적이 하나도 없으면 즉발 계략은 낭비되지 않도록 막는다.
   */
  castStratagem(id: string): number {
    if (this.stratagemStatus(id) !== 'ok') return 0;
    const def = getStratagem(id);
    if (!this.spendGold(def.cost, 'stratagem')) return 0;

    let affected = 0;
    let duration = 0;

    switch (def.effect.type) {
      case 'fire_storm':
        duration = def.effect.params.duration;
        this.fireStormRemaining = duration;
        this.stormDps = def.effect.params.dps;
        this.stormDamageTime = 0;
        affected = this.enemies.filter(e => e.alive).length;
        break;
      case 'ice_storm':
        duration = def.effect.params.duration;
        this.iceStormRemaining = duration;
        for (const e of this.enemies) if (e.alive) { e.freezeTimer = duration; affected++; }
        break;
      case 'rally':
        this.rallyMul = def.effect.params.damageMul;
        this.rallyTimer = def.effect.params.duration;
        this.rallyId = def.id;
        duration = def.effect.params.duration;
        affected = this.towers.size;
        break;
    }

    this.stratagemCooldowns.set(id, def.cooldown);
    this.bus.emit('stratagem:cast', { stratagemId: id, cost: def.cost, affected, duration });
    return affected;
  }

  /** 왜 지금 못 쓰는가. HUD가 버튼에 이유를 적는다. */
  stratagemStatus(id: string): StratagemStatus {
    if (this.over !== 'none') return 'disabled';
    if (!this.level.stratagems?.includes(id)) return 'disabled';
    const def = findStratagem(id);
    if (!def) return 'disabled';
    if ((this.stratagemCooldowns.get(id) ?? 0) > 0) return 'cooldown';
    if (!this.economy.canAfford(def.cost)) return 'no_gold';
    // 즉발 계략을 빈 경로에 쓰면 골드만 사라진다. 지속형(원군)은 미리 걸 수 있다.
    if (def.effect.type !== 'rally' && this.enemies.length === 0) return 'no_target';
    return 'ok';
  }

  /** 남은 재사용 대기 시간(초) */
  stratagemCooldown(id: string): number {
    return this.stratagemCooldowns.get(id) ?? 0;
  }

  /** 원군이 걸려 있으면 남은 시간(초), 아니면 0 */
  get rallyRemaining(): number {
    return this.rallyTimer;
  }

  callWaveEarly(): number {
    if (this.over !== 'none') return 0;
    const bonus = this.waveRunner.callWaveEarly();
    if (bonus > 0) this.grantGold(bonus, 'early_call');
    return bonus;
  }

  // 종료
  private finish(result: 'won' | 'lost'): void {
    if (this.over !== 'none') return;
    this.over = result;
    const stats = this.stats();
    this.bus.emit(result === 'won' ? 'level:won' : 'level:lost', { stats });
  }

  stats(): RunStats {
    const ratio = this.castle.hpRatio;
    const thresholds = this.level.stars ?? BALANCE.stars;
    const stars: 1 | 2 | 3 = ratio >= thresholds.three ? 3 : ratio >= thresholds.two ? 2 : 1;
    const towerLevels: Record<string, number> = {};
    for (const [id, t] of this.towers) towerLevels[id] = t.level;
    return {
      wavesCleared: this.waveRunner.wavesCleared,
      totalWaves: this.waveRunner.totalWaves,
      kills: this.kills,
      leaks: this.leaks,
      castleHp: this.castle.hp,
      castleMaxHp: this.castle.maxHp,
      goldLeft: this.economy.gold,
      goldEarned: this.economy.earned,
      elapsed: this.elapsed,
      towerLevels,
      castleLevel: this.castle.level,
      stars,
    };
  }

  /** 경로 끝 = 성 위치 */
  castlePosition(): WorldPos {
    const p = this.path.positionAt(this.path.totalLength, { x: 0, z: 0 });
    return { x: p.x, y: 0, z: p.z };
  }

  get liveEnemyCount(): number {
    return this.enemies.length;
  }
  get liveProjectileCount(): number {
    return this.projectiles.length;
  }
}
