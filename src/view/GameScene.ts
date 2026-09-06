import { StratagemStorm } from './vfx/StratagemStorm';
import * as THREE from 'three';
import type { World } from '../sim/World';
import type { Enemy } from '../sim/Enemy';
import type { Projectile } from '../sim/Projectile';
import type { PerformancePreset } from '../data/balance';
import { BALANCE } from '../data/balance';
import { getUnit } from '../data/units';
import { getStratagem } from '../data/stratagems';
import { getTower } from '../data/towers';
import { Subscriptions } from '../core/EventBus';
import { ObjectPool } from '../core/ObjectPool';
import { Stage } from './Stage';
import { Terrain } from './Terrain';
import { PathRibbon } from './PathRibbon';
import type { AssetRegistry } from './AssetRegistry';
import { EnemyView } from './views/EnemyView';
import { TowerView } from './views/TowerView';
import { CastleView } from './views/CastleView';
import { SlotMarker } from './views/SlotMarker';
import { RangeRing } from './views/RangeRing';
import { ProjectileView, createProjectileAssets, heatOf } from './views/ProjectileView';
import { GroundFireView, createGroundFireAssets } from './views/GroundFireView';
import { ParticleSystem } from './vfx/Particles';
import { BloodDecals } from './vfx/BloodDecals';

export interface GameSceneCallbacks {
  /** 슬롯을 탭했다 (건설 여부는 호출자가 판단) */
  onSlotTapped: (slotId: string, screenX: number, screenY: number) => void;
  /** 빈 곳을 탭했다 = 선택 해제 */
  onEmptyTapped: () => void;
  /** 적이 죽어 코인이 날아가야 한다 (화면 좌표) */
  onKillReward: (screenX: number, screenY: number, gold: number, isBoss: boolean) => void;
  /** 성벽에 한 대 맞았다. 무엇이 때렸는지(unitId)로 타격음이 갈린다. */
  onCastleHit: (unitId: string, isBoss: boolean) => void;
  /** 무기가 성벽에 부딪혀 불꽃이 튀었다 */
  onCastleSpark: (isBoss: boolean) => void;
}

/**
 * 시뮬과 뷰를 잇는 곳. sim은 이벤트만 발행하고 여기서 구독만 한다 (확장성 5원칙 #4).
 * 뷰는 전부 풀링되며 dispose에서 모든 구독을 끊는다.
 */
/** 빈 슬롯의 탭 판정 크기. 예전 원판(반지름 32)과 같은 감각을 유지한다. */
const EMPTY_SLOT_HIT = { height: 8, radius: 32 };
/** 판정 상한 — 측정이 어긋나도 기둥이 맵을 삼키지 않게 한다. */
const MAX_SLOT_HIT = { height: 120, radius: 64 };

export class GameScene {
  readonly stage: Stage;
  private storm: StratagemStorm;
  readonly terrain: Terrain;
  readonly ribbon: PathRibbon;
  readonly particles: ParticleSystem;
  readonly blood: BloodDecals;

  private castleView: CastleView;
  private slotMarkers = new Map<string, SlotMarker>();
  private towerViews = new Map<string, TowerView>();

  /** 살아있는 적 뷰 */
  private enemyViews = new Map<number, EnemyView>();
  /** 사망 연출 중인 뷰 (시뮬에서는 이미 사라졌다) */
  private dyingViews: { view: EnemyView; unitId: string }[] = [];
  /** unitId별 뷰 풀 */
  private enemyPools = new Map<string, ObjectPool<EnemyView>>();

  private projectileViews = new Map<number, ProjectileView>();
  private projectilePool: ObjectPool<ProjectileView>;
  private projectileAssets = createProjectileAssets();
  private groundFireViews = new Map<number, GroundFireView>();
  private coolingFireViews: GroundFireView[] = [];
  private groundFireAssets = createGroundFireAssets();

  private subs = new Subscriptions();
  private selectedSlot: string | null = null;
  private previewRingSlot: string | null = null;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private slotHitPlanes: THREE.Mesh[] = [];
  private slotHits = new Map<string, THREE.Mesh>();
  /** 다음 프레임에 탭 판정을 다시 잴 슬롯 */
  private pendingHitFit = new Set<string>();
  private hitPlaneGeo: THREE.CylinderGeometry;
  private hitPlaneMat: THREE.Material;

  /** 카메라 셰이크 on/off (설정) */
  shakeEnabled = true;
  /** 화면 크기 — 투영에 필요 */
  private viewportW = 1;
  private viewportH = 1;

  /** 보스 추적 (HUD 대형 체력바용) */
  bossEnemyId: number | null = null;

  private screenBuf = { x: 0, y: 0 };
  /** 활 시위 위치를 받아오는 임시 벡터 */
  private muzzleBuf = new THREE.Vector3();
  /** 상태 파티클을 일정 간격으로만 뿌리기 위한 누적 시간 */
  private fxTimer = 0;

  constructor(
    private readonly world: World,
    private readonly assets: AssetRegistry,
    preset: PerformancePreset,
    private readonly cb: GameSceneCallbacks,
  ) {
    this.stage = new Stage(world.level.environment);
    this.terrain = new Terrain(world.path, world.level.environment, assets, 1337, [...world.level.buildSlots, world.castlePosition()]);
    this.stage.root.add(this.terrain.group);
    this.terrain.buildDecor(preset);
    this.storm = new StratagemStorm(world, this.terrain, preset);
    this.stage.root.add(this.storm.group);

    this.ribbon = new PathRibbon(world.path, this.terrain, assets);
    this.stage.root.add(this.ribbon.group);

    const cpos = world.castlePosition();
    const approach = { x: 1, z: 0 };
    world.path.directionAt(world.path.totalLength, approach);
    this.castleView = new CastleView(cpos.x, cpos.z, this.terrain, assets, world.level.castle.id, approach);
    this.castleView.mount(this.stage.root);

    this.particles = new ParticleSystem(preset);
    this.stage.root.add(this.particles.points);

    // 핏자국은 파티클보다 먼저 씬에 들어간다 — 지면에 눕는 물건이라 렌더 순서가 앞이다.
    this.blood = new BloodDecals(preset);
    this.stage.root.add(this.blood.group);

    // 슬롯 마커 + 탭 판정용 투명 기둥.
    //
    // 예전에는 지면에 깔린 원판이었다. 그런데 모델을 붙이면서 망루가 60유닛 넘게
    // 솟았고, 45도 부감에서는 몸통 윗부분이 화면상 원판 **바깥**에 그려진다.
    // 그래서 눈에 가장 잘 띄는 망루 상단을 눌러도 아무 일도 일어나지 않았다.
    // 이제 슬롯마다 세워둔 기둥의 높이를 실제 타워 크기에 맞춰 늘린다.
    this.hitPlaneGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);
    this.hitPlaneGeo.translate(0, 0.5, 0); // 밑면이 원점 — scale.y 가 곧 높이
    this.hitPlaneMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    for (const slot of world.level.buildSlots) {
      const marker = new SlotMarker(slot, this.terrain);
      this.slotMarkers.set(slot.id, marker);
      this.stage.root.add(marker.group);

      const hit = new THREE.Mesh(this.hitPlaneGeo, this.hitPlaneMat);
      hit.position.set(slot.x, this.terrain.heightAt(slot.x, slot.z), slot.z);
      hit.userData.slotId = slot.id;
      this.slotHitPlanes.push(hit);
      this.slotHits.set(slot.id, hit);
      this.setHitVolume(slot.id, EMPTY_SLOT_HIT.height, EMPTY_SLOT_HIT.radius);
      this.stage.root.add(hit);
    }

    this.projectilePool = new ObjectPool<ProjectileView>(
      () => {
        const v = new ProjectileView(this.projectileAssets);
        v.mount(this.stage.root);
        return v;
      },
      (v) => v.setVisible(false),
      64,
    );

    this.bindEvents();
  }

  /**
   * 슬롯 탭 판정 기둥의 크기를 바꾼다.
   * 높이는 바닥부터, 반지름은 최소 EMPTY_SLOT_HIT.radius 를 보장한다.
   */
  private setHitVolume(slotId: string, height: number, radius: number): void {
    const hit = this.slotHits.get(slotId);
    if (!hit) return;
    const r = THREE.MathUtils.clamp(radius, EMPTY_SLOT_HIT.radius, MAX_SLOT_HIT.radius);
    const h = THREE.MathUtils.clamp(height, EMPTY_SLOT_HIT.height, MAX_SLOT_HIT.height);
    hit.scale.set(r, h, r);
    hit.updateMatrixWorld();
  }

  /**
   * 타워 실물 크기에 맞춰 탭 판정을 다시 재도록 예약한다.
   *
   * 건설·업그레이드 **그 순간**에는 믹서가 아직 한 번도 돌지 않아 뼈 행렬이
   * 제자리에 없다. 그대로 재면 반지름이 수백 유닛으로 튄다. 그래서 다음
   * 프레임(뷰 sync 이후)에 잰다.
   */
  private fitHitVolume(slotId: string): void {
    this.pendingHitFit.add(slotId);
  }

  /** 예약된 슬롯의 탭 판정을 실제로 잰다. render() 끝에서 한 번 돈다. */
  private flushHitFits(): void {
    if (this.pendingHitFit.size === 0) return;
    for (const slotId of this.pendingHitFit) {
      const view = this.towerViews.get(slotId);
      if (!view) continue;
      const b = view.measureBounds();
      this.setHitVolume(slotId, b.height, b.radius);
    }
    this.pendingHitFit.clear();
  }

  // ── 이벤트 구독 ────────────────────────────────────────────────────

  private bindEvents(): void {
    const bus = this.world.bus;

    this.subs.add(
      bus.on('enemy:spawned', ({ enemyId, unitId }) => {
        const view = this.acquireEnemyView(unitId);
        this.enemyViews.set(enemyId, view);
        if (getUnit(unitId).kind !== 'minion') this.bossEnemyId = enemyId;
      }),
    );

    this.subs.add(
      bus.on('enemy:damaged', ({ enemyId }) => {
        this.enemyViews.get(enemyId)?.hit();
      }),
    );

    this.subs.add(
      bus.on('enemy:killed', ({ enemyId, unitId, gold, worldPos }) => {
        const view = this.enemyViews.get(enemyId);
        if (view) {
          this.enemyViews.delete(enemyId);
          view.startDeath();
          this.dyingViews.push({ view, unitId });
        }
        const def = getUnit(unitId);
        this.particles.emit('death_dust', worldPos.x, 4, worldPos.z, def.scale);
        this.spillBlood(worldPos.x, worldPos.z, def.scale, def.kind !== 'minion');
        if (this.bossEnemyId === enemyId) this.bossEnemyId = null;

        this.project(worldPos.x, worldPos.y, worldPos.z);
        this.cb.onKillReward(this.screenBuf.x, this.screenBuf.y, gold, def.kind !== 'minion');
      }),
    );

    this.subs.add(
      bus.on('enemy:leaked', ({ enemyId, unitId }) => {
        const view = this.enemyViews.get(enemyId);
        if (view) {
          /*
           * 적은 시뮬에도 남아 죽을 때까지 성문을 반복 공격한다.
           * 뷰에 타격 주기를 같이 넘겨 클립이 그 박자로 다시 재생되게 한다 —
           * 장수는 2초, 잡몹은 16초다. 넘기지 않으면 클립이 제 길이(0.75초)마다
           * 계속 돌아서 성이 안 깎이는데도 쉬지 않고 휘두르는 그림이 된다.
           */
          const cc = BALANCE.castleCombat;
          const boss = getUnit(unitId).kind !== 'minion';
          view.startCastleAttack(boss ? cc.bossAttackInterval : cc.enemyAttackInterval);
        }
      }),
    );

    this.subs.add(
      bus.on('enemy:castle-attack', ({ unitId }) => {
        const c = this.world.castlePosition();
        const isBoss = getUnit(unitId).kind !== 'minion';
        this.particles.emit('castle_hit', c.x, 35, c.z, isBoss ? 2 : 1);
        this.particles.emit('weapon_spark', c.x, 30, c.z, isBoss ? 1.6 : 0.8);
        this.castleView.hit();
        if (this.shakeEnabled) this.stage.addShake(isBoss ? BALANCE.fx.cameraShakeOnBossLeak : BALANCE.fx.cameraShakeOnLeak);
        this.cb.onCastleHit(unitId, isBoss);
      }),
    );

    this.subs.add(
      bus.on('castle:damaged', ({ hp, maxHp }) => {
        this.castleView.setWarning(hp / maxHp <= 0.3);
      }),
    );

    // 성문 사격 — 포구 섬광. 화살 단계에서는 거의 티가 안 나고,
    // 포문·화룡구 단계에서 성벽 위가 번쩍인다.
    this.subs.add(
      bus.on('castle:fired', ({ kind }) => {
        this.castleView.flashMuzzle();
        if (kind === 'arrow') return;
        const count = this.world.castle.level === 5 ? 4 : 2;
        for (let i = 0; i < count; i++) {
          const muzzle = this.castleView.muzzle(i, this.muzzleBuf);
          this.particles.emit(
            kind === 'flame' ? 'fire_burst' : 'weapon_spark',
            muzzle.x,
            muzzle.y,
            muzzle.z,
            kind === 'flame' ? 1.1 : 0.8,
          );
        }
        if (kind === 'cannon' && this.shakeEnabled) this.stage.addShake(BALANCE.fx.cameraShakeOnLeak * 0.3);
      }),
    );

    // 성문 강화 — 그 자리에서 한 번 크게 터뜨린다. 되돌릴 수 없는 지출이라
    // "무언가 확실히 달라졌다"가 보여야 한다.
    this.subs.add(
      bus.on('castle:upgraded', ({ level, worldPos, weaponKind }) => {
        this.castleView.setLevel(level);
        this.castleView.flashMuzzle();
        this.particles.emit('splash_burst', worldPos.x, 70, worldPos.z, 1.6);
        if (weaponKind !== 'arrow') {
          this.particles.emit('fire_burst', worldPos.x, 80, worldPos.z, 1.8);
        }
        if (this.shakeEnabled) this.stage.addShake(BALANCE.fx.cameraShakeOnLeak);
      }),
    );

    // 계략 — 어디에 걸렸는지가 보여야 "돈을 썼다"가 납득된다.
    // 적이 40기씩 몰려 있을 수 있으므로 이펙트를 낼 대상 수에 상한을 둔다.
    this.subs.add(
      bus.on('stratagem:cast', ({ stratagemId }) => {
        const def = getStratagem(stratagemId);
        if (def.effect.type === 'rally') {
          for (const t of this.world.towers.values()) {
            this.particles.emit('upgrade_ray', t.x, 10, t.z, 1.0);
          }
          return;
        }
        this.storm.cast(def.effect.type === 'ice_storm');
        if (this.shakeEnabled) this.stage.addShake(0.22);

      }),
    );

    this.subs.add(
      bus.on('projectile:fired', ({ projectileId, towerSlotId, kind }) => {
        const view = this.projectilePool.acquire();
        // 무엇으로 보일지는 시뮬이 정해 실어 보낸다 — 성문의 포탄·불줄기는
        // 여기서 타워를 되찾아 봐도 알 수 없기 때문이다.
        const tower = this.world.towers.get(towerSlotId);
        // 레벨을 같이 넘긴다 — 업그레이드한 벽력거는 달군 바위를 던진다
        const incendiary = tower?.def.id === 'fire_tower';
        view.setKind(incendiary ? 'shell' : kind, tower?.level ?? this.world.castle.level, incendiary);

        // 몇 번째 화살인지 = 어느 활에서 나가는지. 그 활을 조준시키고
        // 화살이 그 시위에서 떠나게 한다 (활 망루는 쇠뇌가 다섯 군데에 있다).
        const proj = this.findProjectile(projectileId);
        const bowIndex = proj?.salvoIndex ?? 0;
        const towerView = this.towerViews.get(towerSlotId);
        if (tower && towerView) towerView.fire(tower.lastFireAngle, bowIndex);
        if (towerSlotId === '__castle__') {
          this.castleView.setLevel(this.world.castle.level);
          if (proj) this.castleView.fire(bowIndex, { x: proj.toX, z: proj.toZ });
        }
        const launch =
          towerSlotId === '__castle__'
            ? this.castleView.muzzle(bowIndex, this.muzzleBuf)
            : towerView?.muzzle(bowIndex, this.muzzleBuf) ?? null;
        view.setLaunch(launch);

        /*
         * 포구 화염과 화약 연기.
         *
         * 자리는 `muzzle()` 이 준 그 포문이다 — 다섯 문이 둘러선 화공 망루에서
         * 아무 데서나 불이 일면 어느 대포가 쐈는지 알 수 없다.
         * 연기를 섬광보다 조금 낮게 두는 것은 화약 연기가 포신을 타고
         * 아래로 깔렸다가 떠오르기 때문이다.
         */
        const blast = tower?.def.muzzleBlast;
        if (blast && launch) {
          this.particles.emit('fire_burst', launch.x, launch.y, launch.z, blast.flash);
          this.particles.emit('weapon_spark', launch.x, launch.y, launch.z, blast.flash * 0.6);
          this.particles.emit('muzzle_smoke', launch.x, launch.y - 2, launch.z, blast.smoke);
          // 한 다발의 첫 발에서만 흔든다. 다섯 문이 각자 흔들면 화면이 멀미가 난다.
          if (blast.shake && bowIndex === 0 && this.shakeEnabled) {
            this.stage.addShake(BALANCE.fx.cameraShakeOnLeak * blast.shake);
          }
        }

        view.setVisible(true);
        this.projectileViews.set(projectileId, view);
      }),
    );

    this.subs.add(
      bus.on('projectile:hit', ({ projectileId, worldPos, hit, splashRadius, fire }) => {
        const view = this.projectileViews.get(projectileId);
        if (view) {
          this.projectileViews.delete(projectileId);
          this.projectilePool.release(view);
        }
        // 범위 피해는 빗나가도 터진다 — 착탄 지점 기준이기 때문이다.
        if (splashRadius && splashRadius > 0) {
          this.particles.emit('splash_burst', worldPos.x, 6, worldPos.z, splashRadius / 62);
          if (fire) this.particles.emit('fire_burst', worldPos.x, 8, worldPos.z, 1.5);
          // 흙먼지가 가라앉은 자리에 연기가 피어오른다 — 폭발의 뒷맛이다.
          this.particles.emit('ground_smoke', worldPos.x, 5, worldPos.z, splashRadius / 70);
        } else if (fire) {
          this.particles.emit('fire_burst', worldPos.x, 6, worldPos.z, 0.9);
        } else if (hit) {
          this.particles.emit('hit_spark', worldPos.x, worldPos.y + 12, worldPos.z);
        }
      }),
    );

    this.subs.add(
      bus.on('fire-zone:created', ({ zoneId, worldPos, radius, source }) => {
        const view = new GroundFireView(this.groundFireAssets, radius, source, zoneId);
        view.object3d.position.set(worldPos.x, this.terrain.heightAt(worldPos.x, worldPos.z) + 2.2, worldPos.z);
        this.stage.root.add(view.object3d);
        this.groundFireViews.set(zoneId, view);
        if (source === 'flame') {
          const groundY = view.object3d.position.y;
          // Seeded lobes vary each impact without allocating timers or extra persistent effects.
          const lobes = 3 + zoneId % 3;
          for (let i = 0; i < lobes; i++) {
            const angle = zoneId * 2.399 + i * Math.PI * 2 / lobes;
            const reach = radius * (.18 + (i % 3) * .09);
            this.particles.emit('fire_burst', worldPos.x + Math.cos(angle) * reach,
              groundY + 3, worldPos.z + Math.sin(angle) * reach, .65 + (i % 2) * .25);
          }
          this.particles.emit('weapon_spark', worldPos.x, groundY + 3, worldPos.z, 1.2);
          this.particles.emit('splash_burst', worldPos.x, groundY + 1, worldPos.z, .85);
        }
        // 착탄 섬광과 불티. 투석은 화면을 채울 만큼 크게 터진다.
        this.particles.emit('fire_burst', worldPos.x, 8, worldPos.z, source === 'stone' ? 2.1 : 0.95);
        this.particles.emit('weapon_spark', worldPos.x, 7, worldPos.z, source === 'stone' ? 1.7 : 0.75);
        /*
         * 불구덩이가 생기면 연기 기둥이 함께 선다.
         * 지면의 불(GroundFireView)에도 연기 판이 있지만 그건 **타는 동안** 계속
         * 흔들리는 얇은 연기고, 이건 터지는 **그 순간** 한 번 치솟는 덩어리다.
         * 둘이 겹쳐야 "터졌고, 그 자리가 계속 탄다"로 읽힌다.
         */
        this.particles.emit('ground_smoke', worldPos.x, 6, worldPos.z, source === 'flame' ? 1.1 : 1.5);
        if (source === 'stone' && this.shakeEnabled) this.stage.addShake(BALANCE.fx.cameraShakeOnLeak * 0.65);
      }),
    );

    this.subs.add(
      bus.on('fire-zone:removed', ({ zoneId }) => {
        const view = this.groundFireViews.get(zoneId);
        if (!view) return;
        view.extinguish();
        this.coolingFireViews.push(view);
        // Residues are cosmetic; bound their count during sustained bombardment.
        if (this.coolingFireViews.length > BALANCE.fire.maxZones) {
          this.coolingFireViews.shift()!.dispose();
        }
        this.groundFireViews.delete(zoneId);
      }),
    );

    // 철질려 같은 aura 타워는 투사체가 없다 — 대신 진지가 한 번 맥동한다.
    this.subs.add(
      bus.on('tower:aura', ({ slotId }) => {
        this.towerViews.get(slotId)?.pulseAura();
      }),
    );

    // 여포의 돌진 — 발동하는 순간 눈에 보여야 대응할 수 있다
    this.subs.add(
      bus.on('enemy:ability', ({ enemyId, active }) => {
        const view = this.enemyViews.get(enemyId);
        if (!view) return;
        view.setCharging(active);
      }),
    );

    this.subs.add(
      bus.on('tower:built', ({ slotId, towerId }) => {
        const tower = this.world.towers.get(slotId);
        if (!tower) return;
        const view = new TowerView(getTower(towerId), tower.x, tower.z, tower.level, this.terrain, this.assets);
        view.mount(this.stage.root);
        this.towerViews.set(slotId, view);
        this.slotMarkers.get(slotId)?.setVisible(false);
        this.fitHitVolume(slotId);
        this.particles.emit('upgrade_ray', tower.x, 10, tower.z, 0.6);
      }),
    );

    this.subs.add(
      bus.on('tower:upgraded', ({ slotId, level, worldPos }) => {
        const view = this.towerViews.get(slotId);
        view?.setLevel(level);
        if (view) this.fitHitVolume(slotId);
        this.particles.emit('upgrade_ray', worldPos.x, 10, worldPos.z, 1.2);
      }),
    );

    this.subs.add(
      bus.on('tower:sold', ({ slotId }) => {
        const view = this.towerViews.get(slotId);
        if (view) {
          view.dispose();
          this.towerViews.delete(slotId);
        }
        this.slotMarkers.get(slotId)?.setVisible(true);
        this.pendingHitFit.delete(slotId);
        this.setHitVolume(slotId, EMPTY_SLOT_HIT.height, EMPTY_SLOT_HIT.radius);
        if (this.selectedSlot === slotId) this.setSelected(null);
      }),
    );

    this.subs.add(
      bus.on('wave:started', ({ index }) => {
        if (index === 1) this.ribbon.setArrowsHighlighted(false);
        for (const m of this.slotMarkers.values()) m.setHighlighted(false);
      }),
    );
  }

  // ── 적 뷰 풀 ───────────────────────────────────────────────────────

  private acquireEnemyView(unitId: string): EnemyView {
    let pool = this.enemyPools.get(unitId);
    if (!pool) {
      const def = getUnit(unitId);
      pool = new ObjectPool<EnemyView>(
        () => {
          const v = new EnemyView(def, this.world.path, this.terrain, this.assets);
          v.mount(this.stage.root);
          return v;
        },
        (v) => {
          v.object3d.visible = false;
        },
        unitId === 'yt_infantry' ? 32 : 1,
      );
      this.enemyPools.set(unitId, pool);
    }
    const view = pool.acquire();
    view.resetForReuse();
    return view;
  }

  private releaseEnemyView(unitId: string, view: EnemyView): void {
    view.object3d.visible = false;
    this.enemyPools.get(unitId)?.release(view);
  }

  /**
   * 죽은 자리에 피를 흩뿌린다.
   * 자국 모양은 12가지 패턴에서 무작위로 뽑히고, 큰 유닛은 여러 장이 겹쳐 넓게 번진다.
   */
  private spillBlood(x: number, z: number, scale: number, isBoss: boolean): void {
    const y = this.terrain.heightAt(x, z);
    this.particles.emit('blood_spray', x, 8 * scale, z, scale);
    this.particles.emit('blood_mist', x, 6 * scale, z, scale * 0.8);

    // 보병 1장, 큰 놈일수록 여러 장 — 겹치는 위치도 조금씩 어긋난다.
    const layers = isBoss ? 3 : scale > 1.2 ? 2 : 1;
    for (let i = 0; i < layers; i++) {
      const spreadRadius = i === 0 ? 0 : 9 * scale * (0.5 + i * 0.5);
      const a = Math.random() * Math.PI * 2;
      this.blood.splat(
        x + Math.cos(a) * spreadRadius,
        y,
        z + Math.sin(a) * spreadRadius,
        scale * (i === 0 ? 1 : 0.7),
      );
    }
  }

  // ── 프레임 갱신 ────────────────────────────────────────────────────

  /**
   * @param alpha 시뮬 스텝 간 보간 계수
   * @param dt    실제 프레임 시간 (연출은 배속과 무관하게 이 시간으로 돈다)
   */
  render(alpha: number, dt: number): void {
    this.stage.update(dt);
    this.terrain.update(dt);
    this.storm.update();

    this.fxTimer += dt;
    const emitFx = this.fxTimer >= 0.12;
    if (emitFx) this.fxTimer = 0;

    for (const [id, view] of this.enemyViews) {
      const enemy = this.findEnemy(id);
      if (!enemy) continue;
      view.setCharging(enemy.chargeTimer > 0 && enemy.freezeTimer <= 0);
      view.sync(enemy, alpha, dt);
      view.setSlowed(enemy.slowTimer > 0 || enemy.freezeTimer > 0);

      /*
       * 무기가 성벽에 닿는 그 순간의 불꽃.
       *
       * `enemy:castle-attack` 이벤트에도 불꽃이 있지만 그건 시뮬이 피해를 넣는
       * 시점이라 성문 한가운데서 터진다. 이쪽은 **뷰의 공격 클립**이 무기를
       * 앞으로 뻗은 순간이라, 등갑병의 검이든 감녕의 철퇴든 그 무기 끝에서 튄다.
       * 둘은 박자가 다르다 — 클립이 먼저 닿고 피해가 뒤따른다.
       */
      if (enemy.atCastle && view.takeCastleImpact()) {
        const def = getUnit(enemy.defId);
        const p = view.object3d.position;
        const c = this.world.castlePosition();
        const dx = c.x - p.x;
        const dz = c.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        // 무기는 몸에서 성 쪽으로 이만큼 뻗어 있다 — 덩치가 클수록 멀리 닿는다
        const reach = 10 * def.scale;
        this.particles.emit(
          'weapon_spark',
          p.x + (dx / len) * reach,
          view.weaponHeight,
          p.z + (dz / len) * reach,
          def.scale,
        );
        this.cb.onCastleSpark(def.kind !== 'minion');
        if (this.shakeEnabled && def.kind !== 'minion') {
          this.stage.addShake(BALANCE.fx.cameraShakeOnBossLeak);
        }
      }
      // 상태 파티클은 매 프레임 뿌리면 수백 마리 × 60fps가 되어 버린다.
      if (emitFx) {
        const p = view.object3d.position;
        if (this.world.fireStormRemaining > 0) this.particles.emit('fire_burst', p.x, 8, p.z, 0.35);
        if (enemy.slowTimer > 0 || enemy.freezeTimer > 0) this.particles.emit('slow_dust', p.x, 3, p.z, 0.5);
        if (enemy.chargeTimer > 0) this.particles.emit('charge_trail', p.x, 14, p.z, 0.6);
      }
    }

    // 사망 연출은 시뮬과 무관하게 진행되고 끝나면 풀로 돌아간다.
    for (let i = this.dyingViews.length - 1; i >= 0; i--) {
      const d = this.dyingViews[i];
      d.view.sync(_deadEnemy, alpha, dt);
      if (d.view.isDeathFinished) {
        this.dyingViews.splice(i, 1);
        this.releaseEnemyView(d.unitId, d.view);
      }
    }

    for (const [id, view] of this.projectileViews) {
      const p = this.findProjectile(id);
      if (!p) continue;
      view.sync(p, alpha, dt);
      // 달군 투척체는 지나간 자리에 불티를 흘린다 (적 상태 파티클과 같은 간격으로)
      if (emitFx && (heatOf(p.towerLevel) !== 'cold' || p.fireSource === 'flame')) {
        const q = view.object3d.position;
        this.particles.emit('fire_burst', q.x, q.y, q.z, 0.35);
      }
    }

    for (const view of this.groundFireViews.values()) view.update(dt, this.stage.camera);
    for (let i = this.coolingFireViews.length - 1; i >= 0; i--) {
      const view = this.coolingFireViews[i];
      view.update(dt, this.stage.camera);
      if (view.finished) {
        view.dispose();
        this.coolingFireViews.splice(i, 1);
      }
    }

    for (const [slotId, view] of this.towerViews) {
      const tower = this.world.towers.get(slotId);
      if (tower) view.sync(tower, alpha, dt);
    }

    this.castleView.sync(this.world.castle, alpha, dt);

    const gold = this.world.economy.gold;
    const cost = getTower('archer_tower').buildCost;
    for (const m of this.slotMarkers.values()) {
      m.setAffordable(gold >= cost);
      m.update(dt);
    }

    this.particles.update(dt);
    this.blood.update(dt);
    this.flushHitFits();
  }

  /** 화면 좌표 갱신이 필요한 것들(적 체력바)을 위한 투영 헬퍼 */
  project(x: number, y: number, z: number): { x: number; y: number } {
    return this.stage.projectToScreen(x, y, z, this.viewportW, this.viewportH, this.screenBuf);
  }

  /** 각 적의 머리 위 화면 좌표를 콜백으로 넘긴다 (HUD 체력바용) */
  /**
   * 진단용 — 지금 씬에 뷰가 실제로 뭘 들고 있는지.
   *
   * "모델이 안 보인다"는 신고는 원인이 세 갈래다.
   *   1. 뷰가 아예 안 만들어졌다        -> views 가 0
   *   2. 뷰가 GLB 대신 프리미티브를 받았다 -> skinned 가 false
   *   3. 받긴 받았는데 안 그려진다        -> skinned 는 true 인데 화면에 없다
   * 화면만 봐서는 셋이 구분되지 않으므로 숫자로 남긴다.
   */
  viewReport(): {
    enemyViews: number;
    towerViews: number;
    skinnedInScene: number;
    meshesInScene: number;
    samples: { kind: string; id: string; skinned: boolean; pos: number[]; screen: number[] }[];
  } {
    let skinnedInScene = 0;
    let meshesInScene = 0;
    this.stage.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinnedInScene++;
      else if ((o as THREE.Mesh).isMesh) meshesInScene++;
    });

    const samples: { kind: string; id: string; skinned: boolean; pos: number[]; screen: number[] }[] = [];
    const take = (kind: string, id: string, obj: THREE.Object3D): void => {
      if (samples.length >= 4) return;
      let skinned = false;
      obj.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
      });
      const p = new THREE.Vector3();
      obj.getWorldPosition(p);
      const s = this.project(p.x, p.y, p.z);
      samples.push({
        kind,
        id,
        skinned,
        pos: [Math.round(p.x), Math.round(p.y), Math.round(p.z)],
        screen: [Math.round(s.x), Math.round(s.y)],
      });
    };
    for (const [eid, v] of this.enemyViews) take('enemy', String(eid), v.object3d);
    for (const [sid, v] of this.towerViews) take('tower', sid, v.object3d);

    return {
      enemyViews: this.enemyViews.size,
      towerViews: this.towerViews.size,
      skinnedInScene,
      meshesInScene,
      samples,
    };
  }

  forEachEnemyScreenPos(fn: (enemy: Enemy, sx: number, sy: number) => void): void {
    for (const [id, view] of this.enemyViews) {
      const enemy = this.findEnemy(id);
      if (!enemy) continue;
      const p = view.object3d.position;
      this.project(p.x, p.y + view.headHeight, p.z);
      fn(enemy, this.screenBuf.x, this.screenBuf.y);
    }
  }

  private findEnemy(id: number): Enemy | null {
    const list = this.world.enemies;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  private findProjectile(id: number): Projectile | null {
    const list = this.world.projectiles;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // ── 입력 ───────────────────────────────────────────────────────────

  resize(width: number, height: number): void {
    this.viewportW = width;
    this.viewportH = height;
    this.stage.resize(width, height);
  }

  /** 캔버스 탭 -> 슬롯 판정 */
  handleTap(clientX: number, clientY: number, rect: DOMRect): void {
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.stage.camera);
    const hits = this.raycaster.intersectObjects(this.slotHitPlanes, false);
    if (hits.length === 0) {
      this.cb.onEmptyTapped();
      return;
    }
    const slotId = hits[0].object.userData.slotId as string;
    const world = hits[0].point;
    this.project(world.x, world.y, world.z);
    this.cb.onSlotTapped(slotId, this.screenBuf.x, this.screenBuf.y);
  }

  /** 선택 표시: 건설된 타워는 사거리 링을 흰색으로, 미건설 슬롯은 미리보기 링을 띄운다. */
  setSelected(slotId: string | null): void {
    // 이전 선택 정리
    if (this.selectedSlot) this.towerViews.get(this.selectedSlot)?.ring.setVisible(false);
    if (this.previewRingSlot) {
      this.previewRing?.setVisible(false);
    }
    this.selectedSlot = slotId;
    this.previewRingSlot = null;

    if (!slotId) return;

    const towerView = this.towerViews.get(slotId);
    if (towerView) {
      towerView.ring.setMode('selected');
      towerView.ring.setVisible(true);
      return;
    }

    // 미건설 슬롯 — 패널이 열린 동안 사거리 미리보기
    const slot = this.world.slots.get(slotId);
    if (!slot) return;
    const def = getTower('archer_tower');
    const affordable = this.world.economy.canAfford(def.buildCost);
    this.ensurePreviewRing(def.levels[0].range);
    this.previewRing!.group.position.set(slot.x, 0, slot.z);
    this.previewRing!.refresh();
    this.previewRing!.setMode(affordable ? 'buildable' : 'insufficient');
    this.previewRing!.setVisible(true);
    this.previewRingSlot = slotId;
  }

  private previewRing: RangeRing | null = null;

  private ensurePreviewRing(radius: number): void {
    if (this.previewRing) {
      this.previewRing.setRadius(radius);
      return;
    }
    this.previewRing = new RangeRing(radius, this.terrain);
    this.stage.root.add(this.previewRing.group);
  }

  /** 첫 웨이브 전 튜토리얼 강조 */
  highlightSlots(on: boolean): void {
    for (const m of this.slotMarkers.values()) m.setHighlighted(on);
  }

  applyPreset(preset: PerformancePreset, renderer: THREE.WebGLRenderer): void {
    this.stage.applyPreset(preset, renderer);
    this.terrain.buildDecor(preset);
    this.storm.applyPreset(preset);
    this.particles.setPreset(preset);
    this.blood.setPreset(preset);
  }

  dispose(): void {
    this.subs.dispose();
    this.storm.dispose();

    for (const v of this.enemyViews.values()) v.dispose();
    for (const d of this.dyingViews) d.view.dispose();
    this.enemyViews.clear();
    this.dyingViews.length = 0;
    for (const pool of this.enemyPools.values()) pool.clear();
    this.enemyPools.clear();


    this.blood.dispose();

    for (const v of this.projectileViews.values()) v.dispose();
    this.projectileViews.clear();
    this.projectilePool.clear();
    this.projectileAssets.dispose();

    for (const v of this.groundFireViews.values()) v.dispose();
    this.groundFireViews.clear();
    for (const v of this.coolingFireViews) v.dispose();
    this.coolingFireViews.length = 0;
    this.groundFireAssets.dispose();

    for (const v of this.towerViews.values()) v.dispose();
    this.towerViews.clear();
    for (const m of this.slotMarkers.values()) m.dispose();
    this.slotMarkers.clear();

    for (const p of this.slotHitPlanes) p.removeFromParent();
    this.slotHitPlanes.length = 0;
    this.hitPlaneGeo.dispose();
    this.hitPlaneMat.dispose();

    this.previewRing?.dispose();
    this.previewRing = null;

    this.castleView.dispose();
    this.particles.dispose();
    this.ribbon.dispose();
    this.terrain.dispose();
    this.stage.dispose();
  }
}

// 사망 연출 중인 뷰는 시뮬 엔티티가 없다. sync 시그니처를 맞추기 위한 더미.
const _deadEnemy = { prevDistance: 0, distance: 0, speed: 0 } as Enemy;
