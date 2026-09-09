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
  /**
   * 자리는 잡았지만 아직 칠 차례가 아닌 부대 (망루 바깥 고리).
   * 무기를 든 채 서서 몸을 들썩이며 기다린다 — 얼어붙은 인형이 아니라
   * "다음 차례를 노리는 놈"으로 보여야 포위가 무리로 읽힌다.
   */
  private waiting = false;
  private waitPhase = 0;
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
      // 기다리는 부대는 반 박자 느리게 — 때리는 무리와 대기하는 무리가 갈려 보인다
      if (this.mixer) this.mixer.timeScale = this.waiting ? 0.5 : 1;
      this.updateAttack(dt);
      this.mixer?.update(dt);
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
    this.updateFlash(dt);
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
   *
   * interval 0 은 "아직 칠 차례가 아니다"라는 뜻이다 (망루 바깥 고리에서 대기).
   * 그때는 클립을 틀지 않고 무기를 든 채 서서 몸만 들썩인다 — 그래야 안쪽에서
   * 때리는 놈과 밖에서 기다리는 놈이 화면에서 구분된다.
   */
  startSiegeAttack(interval: number): void {
    const waiting = interval <= 0;
    // 이미 같은 자세로 붙어 있으면 박자를 처음부터 다시 세지 않는다 —
    // 자리를 옮길 때마다 리셋하면 영영 첫 타격이 나가지 않는다.
    if (this.attacking && this.waiting === waiting) {
      if (!waiting) this.attackInterval = Math.max(BALANCE.fx.castleAttackDuration, interval);
      return;
    }
    this.attacking = true;
    this.waiting = waiting;
    this.attackTime = 0;
    this.attackCycle = 0;
    // 클립 한 번보다 짧은 간격은 없다 — 있으면 동작이 잘려 어정쩡해진다
    this.attackInterval = waiting ? 1 : Math.max(BALANCE.fx.castleAttackDuration, interval);
    this.impactPending = !waiting;
    this.model.position.set(0, 0, 0);
    this.model.rotation.set(0, 0, 0);
    if (waiting) {
      // 기다리는 자세 — idle 이 있으면 그걸, 없으면 걷기를 아주 느리게 돌린다.
      this.playState(this.actions.has('idle') ? 'idle' : 'walk');
      return;
    }
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
    this.waiting = false;
    this.impactPending = false;
    this.attackTime = 0;
    this.attackCycle = 0;
    this.model.position.set(0, 0, 0);
    this.model.rotation.set(0, 0, 0);
    if (this.mixer) this.mixer.timeScale = 1;
    this.playState('walk');
  }

  /** 지금 목표를 때리는 중인가 (대기 중은 제외) */
  get isStriking(): boolean {
    return this.attacking && !this.waiting;
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
    return this.headHeight * 0.55;
  }

  get isAttackFinished(): boolean {
    return this.attacking && this.attackTime >= BALANCE.fx.castleAttackDuration;
  }

  private updateAttack(dt: number): void {
    this.attackTime += dt;

    /*
     * 대기 중 — 때리지 않는다. 무게 중심만 좌우로 옮기며 몸을 들썩인다.
     * 완전히 멈춰 세우면 스무 기가 둘러선 그림이 인형 진열대가 된다.
     */
    if (this.waiting) {
      this.waitPhase += dt * 1.6;
      const sway = Math.sin(this.waitPhase) * 0.055;
      this.model.rotation.z = sway;
      this.model.position.y = Math.abs(Math.sin(this.waitPhase * 2)) * 0.7;
      return;
    }

    // 다음 타격 차례가 왔으면 클립을 다시 튼다
    const cycle = Math.floor(this.attackTime / this.attackInterval);
    if (cycle > this.attackCycle) {
      this.attackCycle = cycle;
      this.impactPending = true;
      this.replayAttackClip();
    }

    const t = (this.attackTime % this.attackInterval) / BALANCE.fx.castleAttackDuration;

    // 클립이 없으면 몸을 통째로 앞으로 내밀었다가 되돌린다.
    // sin(pi*t)^2 은 찌르고 빠지는 한 번의 왕복이라 창 동작과 박자가 같다.
    if (!this.hasClips) {
      const thrust = t < 1 ? Math.sin(Math.PI * t) ** 2 : 0;
      // The model is already inside the rotated root: thrust in local +Z.
      this.model.position.set(0, 0, thrust * 9);
      this.model.rotation.x = -thrust * 0.22;
    }

  }

  /** 시뮬은 이미 죽였다. 뷰만 남아 연출한다. 끝나면 true를 반환한다. */
  startDeath(): void {
    this.attacking = false;
    this.waiting = false;
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
    this.waiting = false;
    this.waitPhase = 0;
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

const _white = new THREE.Color(0xffffff);
const _burnTint = new THREE.Color(0xd33a08);
const _slowTint = new THREE.Color(0x1d5f8a);
const _chargeTint = new THREE.Color(0x8a3a10);
