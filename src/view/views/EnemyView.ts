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

  /** 흰색 플래시 */
  private flash = 0;
  /** 상태 표시 */
  private slowed = false;
  private charging = false;
  private flashMats: THREE.MeshStandardMaterial[] = [];
  private originalEmissive: THREE.Color[] = [];

  /** 사망 연출 */
  private dying = false;
  private dieTime = 0;
  /** 성 공격 연출 — 시뮬에는 없는 뷰만의 상태 */
  private attacking = false;
  private attackTime = 0;
  /** 무기가 성벽에 닿는 순간을 한 번만 알리기 위한 플래그 */
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
      const mat = m.material as THREE.MeshStandardMaterial;
      if (Array.isArray(m.material) || !mat.isMeshStandardMaterial) return;
      const cloned = mat.clone();
      m.material = cloned;
      this.flashMats.push(cloned);
      this.originalEmissive.push(cloned.emissive.clone());
    });

    this.playState('walk');
  }

  mount(parent: THREE.Object3D): void {
    parent.add(this.object3d);
  }

  playState(state: ViewState): void {
    if (this.state === state && this.hasClips) return;
    this.state = state;
    if (!this.hasClips) return;
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
      this.path.directionAt(enemy.distance, this.dir);
      const groundY = this.terrain.heightAt(enemy.worldX, enemy.worldZ) + RIBBON_LIFT;
      this.object3d.position.set(enemy.worldX, groundY, enemy.worldZ);
      this.object3d.rotation.set(0, Math.atan2(this.dir.x, this.dir.z), 0);
      if (this.mixer) this.mixer.timeScale = this.gaitRate;
      this.updateAttack(dt);
      this.mixer?.update(dt);
      return;
    }

    const d = enemy.prevDistance + (enemy.distance - enemy.prevDistance) * alpha;
    this.path.positionAt(d, this.pos);
    this.path.directionAt(d, this.dir);
    this.pos.x += this.dir.z * enemy.laneOffset;
    this.pos.z -= this.dir.x * enemy.laneOffset;

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
        this.mixer.timeScale = this.gaitRate * THREE.MathUtils.clamp(speedRatio, 0.5, 1.65);
      }
    }

    this.object3d.position.set(this.pos.x, groundY + bob, this.pos.z);
    // +Z가 정면 규약. atan2(x, z)로 진행 방향을 바라보게 한다.
    this.object3d.rotation.set(0, Math.atan2(this.dir.x, this.dir.z), sway);

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
    this.mixer?.setTime(hash * 0.9);
  }

  private applyWalkVariation(): void {
    if (!this.hasClips || this.state !== 'walk' || !this.mixer) return;
    const phase = (this.mixer.time / 0.9) * Math.PI * 2 + this.upperPhase;
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
      this.flashMats[i].emissiveIntensity = 1;
    }
  }

  /**
   * 성에 닿았다. 시뮬은 이미 이 적을 지웠고 성도 이미 피해를 입었다 —
   * 여기서는 창을 한 번 내지르는 여운만 남긴다.
   * 클립이 없으면(프리미티브) 앞으로 찌르는 절차적 동작으로 대신한다.
   */
  startCastleAttack(interval: number): void {
    this.attacking = true;
    this.attackTime = 0;
    this.attackCycle = 0;
    // 클립 한 번보다 짧은 간격은 없다 — 있으면 동작이 잘려 어정쩡해진다
    this.attackInterval = Math.max(BALANCE.fx.castleAttackDuration, interval);
    this.impactPending = true;
    this.playState('attack');
    this.replayAttackClip();
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
      const thrust = Math.sin(Math.PI * t) ** 2;
      const yaw = this.object3d.rotation.y;
      this.model.position.set(Math.sin(yaw) * thrust * 9, 0, Math.cos(yaw) * thrust * 9);
      this.model.rotation.x = -thrust * 0.22;
    }

  }

  /** 시뮬은 이미 죽였다. 뷰만 남아 연출한다. 끝나면 true를 반환한다. */
  startDeath(): void {
    this.attacking = false;
    this.dying = true;
    this.dieTime = 0;
    this.playState('die');
  }

  get isDeathFinished(): boolean {
    return this.dying && this.dieTime >= BALANCE.fx.deathAnimDuration;
  }

  private updateDeath(dt: number): void {
    this.dieTime += dt;
    const t = Math.min(1, this.dieTime / BALANCE.fx.deathAnimDuration);
    const s = this.baseScale * (1 - t * 0.65);
    this.object3d.scale.setScalar(s);
    this.object3d.position.y -= dt * 26;
    const op = 1 - t;
    for (const m of this.flashMats) {
      m.transparent = true;
      m.opacity = op;
      m.depthWrite = op > 0.5;
    }
  }

  /** 풀 재사용을 위한 초기화 */
  resetForReuse(): void {
    this.dying = false;
    this.dieTime = 0;
    this.attacking = false;
    this.attackTime = 0;
    this.attackCycle = 0;
    this.impactPending = false;
    this.boundEnemyId = 0;
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
      m.opacity = 1;
      m.transparent = false;
      m.depthWrite = true;
      m.emissive.copy(this.originalEmissive[i]);
    }
    this.state = null;
    this.playState('walk');
  }

  dispose(): void {
    this.object3d.removeFromParent();
    this.mixer?.stopAllAction();
    this.mixer = null;
    for (const m of this.flashMats) m.dispose();
    this.flashMats.length = 0;
    this.object3d.clear();
  }
}

const _white = new THREE.Color(0xffffff);
const _slowTint = new THREE.Color(0x1d5f8a);
const _chargeTint = new THREE.Color(0x8a3a10);
