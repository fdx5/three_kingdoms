import * as THREE from 'three';
import type { Enemy } from '../../sim/Enemy';
import type { Path } from '../../sim/Path';
import type { UnitDef } from '../../types/units';
import type { AssetRegistry } from '../AssetRegistry';
import type { Terrain } from '../Terrain';
import type { EntityView, ViewState } from '../EntityView';
import { CLIP_NAMES } from '../EntityView';
import { BALANCE } from '../../data/balance';
import { RIBBON_LIFT } from '../PathRibbon';
import { UnitBurnView } from '../vfx/DragonFireEffects';
import type { GroundFireAssets } from './GroundFireView';

/**
 * 적 뷰. 시뮬의 distance를 Path.positionAt으로 월드 좌표로 바꾸고,
 * prevDistance와 alpha로 보간해 60fps 시뮬과 가변 fps 렌더 사이를 부드럽게 잇는다.
 * 사망 연출은 시뮬이 이미 죽인 뒤 뷰만 남아서 진행한다.
 */
export class EnemyView implements EntityView<Enemy> {
  readonly object3d = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<ViewState, THREE.AnimationAction>();
  /**
   * 아직 아무 상태도 재생하지 않았음을 null 로 표시한다.
   * 초기값을 'walk' 로 두면 생성자의 playState('walk') 가 "이미 walk 다"라며
   * 그냥 돌아가서 액션이 시작되지 않는다 — 1파 유닛만 다리가 안 움직였던 원인이다.
   */
  private state: ViewState | null = null;

  /** 프리미티브일 때 걷는 느낌을 내기 위한 위상 */
  private bouncePhase = Math.random() * Math.PI * 2;
  private hasClips = false;
  /** 같은 모델도 개체마다 보행 박자와 위상이 다르게 보이게 하는 결정론적 변주. */
  private boundEnemyId = 0;
  private gaitRate = 1;
  private upperPhase = 0;
  private armVariation = 0;
  private torsoVariation = 0;
  private gaitBones = new Map<string, THREE.Bone>();
  private variationPose = new Map<THREE.Bone, THREE.Quaternion>();
  private facingInitialized = false;

  /**
   * 접지 보정 — 공격 자세에서 발이 땅에 묻히는 것을 걷기 기준으로 되돌린다.
   *
   * 굽는 쪽(scripts/rig-model.ts)의 plantFeet 은 **걷기 클립에만** 걸려 있다.
   * 걷는 동안은 지지발이 한 높이에 고정되지만 공격 클립은 그 보정을 안 받아서,
   * 내지르는 순간 몸이 2유닛쯤 가라앉는다. 성문에 바짝 붙어 때릴 때는 성벽에
   * 가려 보이지 않았는데, 망루를 둘러싸고 치기 시작하면서 훤한 땅 위에서
   * 여덟 기가 동시에 발목까지 묻히는 그림이 됐다.
   *
   * 상수로 들어 올리지 않는다 — 가라앉는 깊이는 모델마다 다르다. 걷는 동안
   * 실제 발 높이를 재 두고(footRefY), 공격 중 그보다 낮아진 만큼만 들어 올린다.
   * 자기 모델을 기준으로 자기를 고치므로 새 유닛이 늘어도 손댈 것이 없다.
   */
  private footRefY: number | null = null;
  private attackLift = 0;

  /** 흰색 플래시 */
  private flash = 0;
  private burn: UnitBurnView | null = null;
  /** 상태 표시 */
  private slowed = false;
  private charging = false;
  private flashMats: THREE.MeshStandardMaterial[] = [];
  private originalEmissive: THREE.Color[] = [];
  private originalMaterials: { opacity: number; transparent: boolean; depthWrite: boolean; intensity: number }[] = [];

  /** 사망 연출 */
  private dying = false;
  private dieTime = 0;
  private deathGroundY = 0;
  private deathScale = 1;
  private deathTilt = 0;
  /**
   * 공격 연출 — 시뮬에는 없는 뷰만의 상태.
   *
   * 성벽과 망루가 같은 상태를 쓴다. 시뮬에서는 완전히 다른 두 전투지만
   * 화면에서 벌어지는 일은 하나다: 제자리에 서서 앞의 것을 주기적으로 친다.
   * 다른 것은 무엇을 바라보는가뿐이고, 그건 시뮬이 faceX/faceZ 로 알려 준다.
   */
  private attacking = false;
  private attackTime = 0;
  /** 무기가 목표에 닿는 순간을 한 번만 알리기 위한 플래그 */
  private impactPending = false;
  /**
   * 한 번 때리고 다음까지의 간격(초). 시뮬의 타격 주기와 같은 값을 받는다 —
   * 클립이 제 박자로 계속 도는 것과 실제로 성이 깎이는 순간이 어긋나면
   * "때리는 시늉만 한다"로 보인다. 장수는 2초, 잡몹은 16초다.
   */
  private attackInterval = 1;
  /** 지금까지 몇 번째 타격인가 — 이 값이 바뀔 때 클립을 다시 튼다 */
  private attackCycle = 0;
  private baseScale = 1;

  /** HUD 체력바가 쓰는 화면 투영 기준점 높이 */
  readonly headHeight: number;

  private pos = { x: 0, z: 0 };
  private dir = { x: 0, z: 0 };

  constructor(
    readonly def: UnitDef,
    private readonly path: Path,
    private readonly terrain: Terrain,
    assets: AssetRegistry,
  ) {
    this.model = assets.getMesh(def.view.modelId, def.view.primitive);
    this.object3d.add(this.model);
    this.baseScale = def.scale;
    this.object3d.scale.setScalar(this.baseScale);
    this.headHeight = 40 * def.scale;

    const clips = (this.model as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations;
    if (clips && clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(this.model);
      for (const [state, name] of Object.entries(CLIP_NAMES) as [ViewState, string][]) {
        const clip = THREE.AnimationClip.findByName(clips, name);
        if (clip) this.actions.set(state, this.mixer.clipAction(clip));
      }
      this.hasClips = this.actions.size > 0;
    }

    // 플래시용 머티리얼 수집 — 프리미티브 머티리얼은 레지스트리 캐시라 공유된다.
    // 공유 머티리얼을 그대로 건드리면 같은 색의 모든 적이 함께 번쩍이므로 복제한다.
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.gaitBones.set(o.name, o as THREE.Bone);
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const cloneMaterial = (mat: THREE.Material): THREE.Material => {
        if (!(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return mat;
        const cloned = (mat as THREE.MeshStandardMaterial).clone();
        this.flashMats.push(cloned);
        this.originalEmissive.push(cloned.emissive.clone());
        this.originalMaterials.push({ opacity: cloned.opacity, transparent: cloned.transparent,
          depthWrite: cloned.depthWrite, intensity: cloned.emissiveIntensity });
        return cloned;
      };
      m.material = Array.isArray(m.material) ? m.material.map(cloneMaterial) : cloneMaterial(m.material);
    });
    for (const name of ['chest', 'shoulderL', 'shoulderR', 'arms', 'armL', 'armR']) {
      const bone = this.gaitBones.get(name);
      if (bone) this.variationPose.set(bone, bone.quaternion.clone());
    }

    this.playState('walk');
  }

  mount(parent: THREE.Object3D): void {
    parent.add(this.object3d);
  }

  ignite(assets: GroundFireAssets): void {
    if (!this.burn) {
      this.burn = new UnitBurnView(assets);
      // Attach to the animated model, so fire follows its recoil and death fall.
      this.model.add(this.burn.object3d);
    }
    this.burn.ignite();
  }

  updateBurn(dt: number, camera: THREE.Camera): void {
    if (!this.burn) return;
    const heat = this.burn.update(dt, camera);
    if (heat > 0) {
      const base = this.charging ? _chargeTint : this.slowed ? _slowTint : null;
      for (let i = 0; i < this.flashMats.length; i++) {
        this.flashMats[i].emissive.copy(base ?? this.originalEmissive[i]).lerp(_burnTint, .22 * heat);
      }
    } else if (this.flash <= 0) this.applyTint();
  }

  playState(state: ViewState): void {
    if (this.state === state && this.hasClips) return;
    this.state = state;
    if (!this.hasClips) return;
    this.restoreWalkPose();
    const next = this.actions.get(state);
    if (!next) return;
    for (const [s, a] of this.actions) {
      if (s !== state) a.fadeOut(0.15);
    }
    next.reset().fadeIn(0.15).play();
    if (state === 'die') {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    }
  }

  sync(enemy: Enemy, alpha: number, dt: number): void {
    if (enemy.id > 0 && this.boundEnemyId !== enemy.id) this.bindGait(enemy.id);
    if (this.dying) {
      this.updateDeath(dt);
      this.mixer?.update(dt);
      return;
    }
    if (enemy.freezeTimer > 0) {
      this.object3d.position.set(enemy.worldX, this.terrain.heightAt(enemy.worldX, enemy.worldZ) + RIBBON_LIFT, enemy.worldZ);
      this.updateFlash(dt);
      return;
    }
    if (this.attacking) {
      const groundY = this.terrain.heightAt(enemy.worldX, enemy.worldZ) + RIBBON_LIFT;
      this.object3d.position.set(enemy.worldX, groundY, enemy.worldZ);
      // 때리는 동안은 시뮬이 알려 준 쪽을 본다 — 성벽이든 망루든 표적이 앞이다.
      this.object3d.rotation.set(0, Math.atan2(enemy.faceX, enemy.faceZ), 0);
      if (this.mixer) this.mixer.timeScale = 1;
      this.updateAttack(dt);
      this.mixer?.update(dt);
      this.applyAttackLift(dt);
      this.updateFlash(dt);
      return;
    }

    /*
     * 위치. 길 위에 있으면 distance 를 보간해 경로에서 뽑고, 길을 벗어났으면
     * (망루로 달려가는 중) 월드 좌표를 직접 보간한다 — 그 순간 경로는
     * 이 적이 어디 있는지에 대해 아무것도 모른다.
     */
    if (enemy.detached) {
      this.pos.x = enemy.prevWorldX + (enemy.worldX - enemy.prevWorldX) * alpha;
      this.pos.z = enemy.prevWorldZ + (enemy.worldZ - enemy.prevWorldZ) * alpha;
      this.dir.x = enemy.faceX;
      this.dir.z = enemy.faceZ;
    } else {
      const d = enemy.prevDistance + (enemy.distance - enemy.prevDistance) * alpha;
      this.path.positionAt(d, this.pos);
      this.path.directionAt(d, this.dir);
      this.pos.x += this.dir.z * enemy.laneOffset;
      this.pos.z -= this.dir.x * enemy.laneOffset;
    }

    // 길 리본은 지형보다 RIBBON_LIFT 만큼 떠 있다. 적을 지형 높이에 두면
    // 발이 길 표면 아래로 들어가 다리가 잘려 보인다.
    const groundY = this.terrain.heightAt(this.pos.x, this.pos.z) + RIBBON_LIFT;

    // 모델이 없으면 상하 미세 바운스 + 좌우 스웨이로 걷는 느낌을 대신한다.
    let bob = 0;
    let sway = 0;
    if (!this.hasClips) {
      this.bouncePhase += dt * (enemy.speed / 50) * 9;
      bob = Math.abs(Math.sin(this.bouncePhase)) * 2.2;
      sway = Math.sin(this.bouncePhase * 0.5) * 0.07;
    } else {
      this.bouncePhase += dt * this.gaitRate * 7;
      // Skinned clips already contain hip motion. Rotating the whole character
      // here made infantry wag at the waist, so only use a subtle grounded bob.
      bob = 0;
      if (this.mixer) {
        // Match foot cadence to actual world velocity to prevent skating.
        const speedRatio = enemy.effectiveSpeed / 50;
        this.mixer.timeScale = this.gaitRate * THREE.MathUtils.clamp(speedRatio, 0, 2.5);
      }
    }

    this.object3d.position.set(this.pos.x, groundY + bob, this.pos.z);
    // +Z가 정면 규약. atan2(x, z)로 진행 방향을 바라보게 한다.
    const targetYaw = Math.atan2(this.dir.x, this.dir.z);
    const turn = Math.atan2(Math.sin(targetYaw - this.object3d.rotation.y), Math.cos(targetYaw - this.object3d.rotation.y));
    const yaw = this.facingInitialized ? this.object3d.rotation.y + turn * (1 - Math.exp(-14 * dt)) : targetYaw;
    this.facingInitialized = true;
    this.object3d.rotation.set(0, yaw, sway);

    this.restoreWalkPose();
    this.mixer?.update(dt);
    this.applyWalkVariation();
    this.calibrateFoot();
    this.updateFlash(dt);
  }

  /**
   * 지금 지지발이 접지면보다 얼마나 위/아래에 있는가 (월드 단위).
   * 발 뼈가 없는 모델(프리미티브 등)은 null.
   */
  private soleOffset(): number | null {
    const l = this.gaitBones.get('footL');
    const r = this.gaitBones.get('footR');
    if (!l || !r) return null;
    const a = l.getWorldPosition(_footBufA).y;
    const b = r.getWorldPosition(_footBufB).y;
    return Math.min(a, b) - this.object3d.position.y;
  }

  /** 걷는 동안의 지지발 높이를 기준으로 잡아 둔다 (가장 낮은 프레임). */
  private calibrateFoot(): void {
    const y = this.soleOffset();
    if (y === null) return;
    this.footRefY = this.footRefY === null ? y : Math.min(this.footRefY, y);
  }

  /**
   * 공격 중 가라앉은 만큼 모델을 들어 올린다.
   *
   * 부드럽게 따라가는 이유는 클립 안에서도 깊이가 바뀌기 때문이다 —
   * 매 프레임 그대로 반영하면 발이 아니라 몸 전체가 떨린다.
   */
  private applyAttackLift(dt: number): void {
    const ref = this.footRefY;
    if (ref === null) return;
    const now = this.soleOffset();
    if (now === null) return;
    // 월드 단위로 잰 값이다. model 은 스케일이 걸린 object3d 안에 있으므로 되돌린다.
    const scale = this.object3d.scale.y || 1;
    // The measured foot already includes the previous lift; retain it when closing the remaining gap.
    const want = THREE.MathUtils.clamp(this.model.position.y + (ref - now) / scale, 0, MAX_ATTACK_LIFT);
    this.attackLift += (want - this.attackLift) * Math.min(1, dt * 12);
    this.model.position.y = this.attackLift;
  }

  private bindGait(enemyId: number): void {
    this.boundEnemyId = enemyId;
    // 정수 해시라 리플레이마다 같지만 이웃한 병사끼리는 다른 값이 나온다.
    const hash = ((enemyId * 2654435761) >>> 0) / 0xffffffff;
    const hash2 = (((enemyId + 97) * 2246822519) >>> 0) / 0xffffffff;
    this.gaitRate = 0.96 + hash * 0.08;
    this.upperPhase = hash2 * Math.PI * 2;
    this.armVariation = 0.012 + hash * 0.026;
    this.torsoVariation = 0.004 + hash2 * 0.012;
    this.bouncePhase = hash2 * Math.PI * 2;
    const walk = this.actions.get('walk');
    if (walk) {
      walk.time = hash * walk.getClip().duration;
      walk.stopFading().setEffectiveWeight(1);
      // A unit can spawn already frozen. Resolve the planted animation pose
      // before the freeze branch returns, instead of exposing the bind pose.
      this.mixer?.update(0);
    }
  }

  private restoreWalkPose(): void {
    for (const [bone, pose] of this.variationPose) bone.quaternion.copy(pose);
  }

  private applyWalkVariation(): void {
    if (!this.hasClips || this.state !== 'walk' || !this.mixer) return;
    for (const [bone, pose] of this.variationPose) pose.copy(bone.quaternion);
    const walk = this.actions.get('walk');
    const phase = ((walk?.time ?? 0) / (walk?.getClip().duration || 0.9)) * Math.PI * 2 + this.upperPhase;
    const swing = Math.sin(phase);
    const chest = this.gaitBones.get('chest');
    const shoulderL = this.gaitBones.get('shoulderL');
    const shoulderR = this.gaitBones.get('shoulderR');
    const arms = this.gaitBones.get('arms');
    const armL = this.gaitBones.get('armL');
    const armR = this.gaitBones.get('armR');
    if (chest) chest.rotation.y += swing * this.torsoVariation;
    if (shoulderL) shoulderL.rotation.x += swing * this.armVariation;
    if (shoulderR) shoulderR.rotation.x -= swing * this.armVariation * 0.92;
    if (arms) arms.rotation.x += swing * this.armVariation * 0.55;
    if (armL) armL.rotation.x += swing * this.armVariation * 0.45;
    if (armR) armR.rotation.x -= swing * this.armVariation * 0.45;
  }

  /** 피격 흰색 플래시 */
  hit(): void {
    this.flash = BALANCE.fx.hitFlashDuration;
  }

  /**
   * 감속 표시 — 몸을 푸르게 물들인다.
   * 파티클만으로는 "누가 걸렸는지"가 안 보인다. 색이 붙어야 판단이 된다.
   */
  setSlowed(on: boolean): void {
    if (this.slowed === on) return;
    this.slowed = on;
    this.applyTint();
  }

  /** 돌진(여포 무쌍) 표시 — 붉게 달아오른다 */
  setCharging(on: boolean): void {
    if (this.charging === on) return;
    this.charging = on;
    this.applyTint();
    // 돌진 중에는 살짝 커져서 실루엣으로도 읽힌다
    this.object3d.scale.setScalar(this.baseScale * (on ? 1.12 : 1));
  }

  private applyTint(): void {
    const tint = this.charging ? _chargeTint : this.slowed ? _slowTint : null;
    for (let i = 0; i < this.flashMats.length; i++) {
      if (tint) this.flashMats[i].emissive.copy(tint);
      else this.flashMats[i].emissive.copy(this.originalEmissive[i]);
    }
  }

  private updateFlash(dt: number): void {
    if (this.flash <= 0) return;
    this.flash = Math.max(0, this.flash - dt);
    const k = this.flash / BALANCE.fx.hitFlashDuration;
    // 상태 색(감속·돌진)이 있으면 그 위에서 흰색으로 번쩍인다
    const base = this.charging ? _chargeTint : this.slowed ? _slowTint : null;
    for (let i = 0; i < this.flashMats.length; i++) {
      const from = base ?? this.originalEmissive[i];
      this.flashMats[i].emissive.copy(from).lerp(_white, k);
      this.flashMats[i].emissiveIntensity = THREE.MathUtils.lerp(this.originalMaterials[i].intensity, 1, k);
    }
  }

  /**
   * 목표 앞에 붙었다 — 성벽이든 망루든. 그 자리에서 주기적으로 휘두른다.
   * 클립이 없으면(프리미티브) 앞으로 찌르는 절차적 동작으로 대신한다.
   */
  startSiegeAttack(interval: number): void {
    // 이미 붙어 있으면 박자를 처음부터 다시 세지 않는다 —
    // 이벤트가 다시 올 때마다 리셋하면 영영 첫 타격이 나가지 않는다.
    if (this.attacking) {
      this.attackInterval = Math.max(BALANCE.fx.castleAttackDuration, interval);
      return;
    }
    this.attacking = true;
    this.attackTime = 0;
    this.attackCycle = 0;
    // 클립 한 번보다 짧은 간격은 없다 — 있으면 동작이 잘려 어정쩡해진다
    this.attackInterval = Math.max(BALANCE.fx.castleAttackDuration, interval);
    this.impactPending = true;
    this.model.position.set(0, 0, 0);
    this.model.rotation.set(0, 0, 0);
    this.playState('attack');
    this.replayAttackClip();
  }

  /** 예전 이름. 성문 전투 쪽 호출부가 그대로 쓴다. */
  startCastleAttack(interval: number): void {
    this.startSiegeAttack(interval);
  }

  /** 목표를 잃고 다시 걷기 시작한다 (망루가 무너졌거나 포위를 풀었다) */
  stopSiegeAttack(): void {
    if (!this.attacking) return;
    this.attacking = false;
    this.attackLift = 0;
    this.impactPending = false;
    this.attackTime = 0;
    this.attackCycle = 0;
    this.model.position.set(0, 0, 0);
    this.model.rotation.set(0, 0, 0);
    if (this.mixer) this.mixer.timeScale = 1;
    this.playState('walk');
  }

  /** 지금 목표를 때리는 중인가 */
  get isStriking(): boolean {
    return this.attacking;
  }

  /**
   * 공격 클립을 처음부터 한 번만 재생한다.
   *
   * 기본값(LoopRepeat)으로 두면 클립이 제 길이(0.75~0.95초)마다 계속 돌아서,
   * 2초에 한 번 성이 깎이는데 화면에서는 쉬지 않고 휘두르는 그림이 된다.
   * 한 번 휘두르고 멈춰 있다가 다음 타격 때 다시 휘둘러야 박자가 맞는다.
   */
  private replayAttackClip(): void {
    const action = this.actions.get('attack');
    if (!action) return;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset().play();
  }

  /**
   * 무기가 성벽에 닿았는가. 공격 한 번에 딱 한 번만 true 를 돌려준다.
   *
   * 불꽃을 공격 시작에 터뜨리면 무기가 아직 뒤로 젖혀져 있어서 허공에서 튄다.
   * 클립이 내려치는 시점(BALANCE.fx.castleAttackImpactAt)에 맞춰야 부딪힌 것으로 보인다.
   */
  takeCastleImpact(): boolean {
    if (!this.impactPending) return false;
    // 이번 타격 주기 안에서의 진행도로 잰다 — 누적 시간으로 재면 두 번째 타격부터 어긋난다
    const t = (this.attackTime % this.attackInterval) / BALANCE.fx.castleAttackDuration;
    if (t < BALANCE.fx.castleAttackImpactAt) return false;
    this.impactPending = false;
    return true;
  }

  /** 무기가 성벽을 때리는 대략적인 높이 (불꽃을 여기서 터뜨린다) */
  get weaponHeight(): number {
    return this.object3d.position.y + this.headHeight * 0.55;
  }

  get isAttackFinished(): boolean {
    return this.attacking && this.attackTime >= BALANCE.fx.castleAttackDuration;
  }

  private updateAttack(dt: number): void {
    this.attackTime += dt;

    // 다음 타격 차례가 왔으면 클립을 다시 튼다
    const cycle = Math.floor(this.attackTime / this.attackInterval);
    if (cycle > this.attackCycle) {
      this.attackCycle = cycle;
      this.impactPending = true;
      this.replayAttackClip();
    }

    const t = (this.attackTime % this.attackInterval) / BALANCE.fx.castleAttackDuration;

    /*
     * 내지르며 앞으로 파고든다.
     *
     * sin(pi*t)^2 은 찌르고 빠지는 한 번의 왕복이라 창 동작과 박자가 같다.
     * 모델은 이미 회전된 루트 안에 있으므로 로컬 +Z 가 곧 표적 쪽이다.
     *
     * 클립이 있는 유닛에게도 이걸 얹는다. 구운 공격 클립은 **제자리에서** 팔만
     * 휘두르는데, 그러면 둘러싼 무리가 망루를 향해 허공을 젓는 것처럼 보인다.
     * 한 발 파고들었다 물러나는 왕복이 붙어야 "때린다"가 된다 —
     * 다만 클립이 이미 상체를 쓰므로 폭은 절반 아래로 둔다.
     */
    const thrust = t < 1 ? Math.sin(Math.PI * t) ** 2 : 0;
    if (this.hasClips) {
      this.model.position.z = thrust * LUNGE_CLIP;
      this.model.position.x = 0;
      this.model.rotation.x = -thrust * 0.07;
    } else {
      this.model.position.z = thrust * LUNGE_PRIMITIVE;
      this.model.position.x = 0;
      this.model.rotation.x = -thrust * 0.22;
    }
  }

  /** 시뮬은 이미 죽였다. 뷰만 남아 연출한다. 끝나면 true를 반환한다. */
  startDeath(): void {
    this.attacking = false;
    this.dying = true;
    this.dieTime = 0;
    this.deathGroundY = this.object3d.position.y;
    this.deathScale = this.object3d.scale.x;
    this.deathTilt = this.model.rotation.x;
    this.playState('die');
    if (this.mixer) this.mixer.timeScale = this.actions.has('die') ? 1 : 0;
  }

  get isDeathFinished(): boolean {
    return this.dying && this.dieTime >= BALANCE.fx.deathAnimDuration;
  }

  private updateDeath(dt: number): void {
    this.dieTime += dt;
    const t = Math.min(1, this.dieTime / BALANCE.fx.deathAnimDuration);
    const settle = THREE.MathUtils.smoothstep(t, 0, .7);
    const fade = 1 - THREE.MathUtils.smoothstep(t, .35, 1);
    this.object3d.scale.setScalar(this.deathScale * (1 - .12 * settle));
    this.object3d.position.y = this.deathGroundY - 4 * THREE.MathUtils.smoothstep(t, .6, 1);
    if (!this.actions.has('die')) this.model.rotation.x = this.deathTilt + .95 * settle;
    for (let i = 0; i < this.flashMats.length; i++) {
      const m = this.flashMats[i];
      m.transparent = true;
      m.opacity = this.originalMaterials[i].opacity * fade;
      m.depthWrite = this.originalMaterials[i].depthWrite && fade > .5;
    }
  }

  /** 풀 재사용을 위한 초기화 */
  resetForReuse(): void {
    this.burn?.reset();
    this.dying = false;
    this.dieTime = 0;
    this.attacking = false;
    this.attackTime = 0;
    this.attackCycle = 0;
    this.impactPending = false;
    this.boundEnemyId = 0;
    this.facingInitialized = false;
    this.restoreWalkPose();
    this.mixer?.stopAllAction();
    this.mixer?.setTime(0);
    if (this.mixer) this.mixer.timeScale = 1;
    this.model.position.set(0, 0, 0);
    this.model.rotation.set(0, 0, 0);
    this.flash = 0;
    this.attackLift = 0;
    this.footRefY = null;
    this.slowed = false;
    this.charging = false;
    this.object3d.scale.setScalar(this.baseScale);
    this.object3d.visible = true;
    for (let i = 0; i < this.flashMats.length; i++) {
      const m = this.flashMats[i];
      const original = this.originalMaterials[i];
      m.opacity = original.opacity;
      m.transparent = original.transparent;
      m.depthWrite = original.depthWrite;
      m.emissiveIntensity = original.intensity;
      m.emissive.copy(this.originalEmissive[i]);
    }
    this.state = null;
    this.playState('walk');
  }

  dispose(): void {
    this.burn?.dispose();
    this.object3d.removeFromParent();
    this.mixer?.stopAllAction();
    this.mixer?.uncacheRoot(this.model);
    this.mixer = null;
    this.model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.dispose(); });
    for (const m of this.flashMats) m.dispose();
    this.flashMats.length = 0;
    this.object3d.clear();
  }
}

/**
 * 내지를 때 앞으로 파고드는 거리(u).
 * 클립이 있는 유닛은 상체가 이미 움직이므로 발만 조금 옮기고,
 * 프리미티브는 몸통 전체가 유일한 표현 수단이라 크게 내민다.
 */
const LUNGE_CLIP = 4.5;
const LUNGE_PRIMITIVE = 9;

/** 접지 보정의 상한(모델 로컬 단위). 측정이 어긋나도 유닛이 공중에 뜨지 않게. */
const MAX_ATTACK_LIFT = 6;

const _footBufA = new THREE.Vector3();
const _footBufB = new THREE.Vector3();

const _white = new THREE.Color(0xffffff);
const _burnTint = new THREE.Color(0xd33a08);
const _slowTint = new THREE.Color(0x1d5f8a);
const _chargeTint = new THREE.Color(0x8a3a10);
