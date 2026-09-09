import * as THREE from 'three';
import type { Tower } from '../../sim/Tower';
import type { TowerDef } from '../../types/towers';
import type { AssetRegistry } from '../AssetRegistry';
import type { Terrain } from '../Terrain';
import type { EntityView, ViewState } from '../EntityView';
import { BALANCE } from '../../data/balance';
import { RangeRing } from './RangeRing';
import { TowerHealthBar } from './TowerHealthBar';
import { TowerDamageFx } from '../vfx/TowerDamageFx';
import type { GroundFireAssets } from './GroundFireView';

/**
 * 타워 뷰.
 *
 * 프리미티브일 때는 지붕 둘레의 활 표식이 레벨만큼 늘고, 몸통이 목표를 향해 돌며
 * 발사할 때 짧게 뒤로 밀린다.
 *
 * GLTF 모델(활 망루)일 때는 그보다 많은 일을 한다.
 *   - 쇠뇌를 레벨 수만큼만 보여준다 (뼈 스케일 0으로 접는다)
 *   - 쏜 쇠뇌만 조준 방향으로 돌아가고 `shootN` 클립이 재생된다
 *   - 활 양끝과 시위 걸이(nock)를 이어 **시위를 직접 그린다**.
 *     시위는 원본 메시에서 실 한 가닥이라 감면하면 사라진다. 그래서 뷰가 만든다.
 *   - 화살이 떠나는 자리(muzzle)를 그 쇠뇌의 시위 위치로 알려준다
 */

/** 쇠뇌 하나에 딸린 노드들 */
interface BowRig {
  /** bowN 뼈 — 조준 회전과 숨기기 */
  bone: THREE.Object3D;
  /** 시위를 거는 점(투석기는 돌이 놓이는 자리). 투사체가 여기서 떠난다 */
  nock: THREE.Object3D;
  /** 활 양끝. 투석기처럼 시위가 없는 무기는 null 이고 그때는 선을 그리지 않는다 */
  tipA: THREE.Object3D | null;
  tipB: THREE.Object3D | null;
  /** 바인드 포즈에서 이 쇠뇌가 바라보던 방향 (탑 중심에서 바깥) */
  restYaw: number;
  /** 조준 목표와 현재 각도 */
  aimYaw: number;
  displayYaw: number;
  /** 시위 (tipA -> nock -> tipB). 시위가 없는 무기는 null */
  string: THREE.Line | null;
  /** 레벨업으로 새로 나타나는 중이면 0..1 */
  popIn: number;
  visible: boolean;
}

const STRING_COLOR = 0x2b2118;

export class TowerView implements EntityView<Tower> {
  readonly object3d = new THREE.Group();
  private model: THREE.Object3D;
  private body: THREE.Object3D | null = null;
  private newMarks: THREE.Object3D[] = [];
  private markAnim = 0;

  private recoil = 0;
  private auraPulse = 0;
  private aimAngle = 0;
  private displayAngle = 0;
  private level: number;

  // ── 피격 / 파괴 ────────────────────────────────────────────────────
  /**
   * 지금 얼마나 부서졌는가 (0 = 멀쩡, 1 = 무너지기 직전).
   * 이 값 하나에서 그을음·기울기·불·연기가 전부 파생된다.
   */
  private damage = 0;
  /** 한 대 맞은 여운 — 뒤로 밀렸다 돌아오는 0..1 */
  private flinch = 0;
  /** 밀려나는 방향 (때린 쪽의 반대) */
  private flinchX = 0;
  private flinchZ = 0;
  /** 맞는 순간의 흰 섬광 0..1 */
  private hitFlash = 0;
  /** 무너지는 중이면 0..1, 아니면 -1 */
  private collapse = -1;
  private collapseAxis = 0;
  private collapseImpactEmitted = false;
  private damageFx: TowerDamageFx | null = null;
  private fireAssets: GroundFireAssets | null = null;
  private readonly bar: TowerHealthBar;
  /** 그을림·번쩍임을 걸기 위해 복제해 둔 재질 (레지스트리 캐시를 공유하면 안 된다) */
  private tintMats: THREE.MeshStandardMaterial[] = [];
  private baseColor: THREE.Color[] = [];
  private baseEmissive: THREE.Color[] = [];
  private baseOpacity: { opacity: number; transparent: boolean; depthWrite: boolean }[] = [];
  /** measureBounds 가 마지막으로 잰 크기 — 체력바 높이와 불의 크기가 여기서 나온다 */
  private bounds = { height: 60, radius: 22 };

  /** GLTF 망루(쇠뇌·대포)일 때만 채워진다. 비어 있으면 프리미티브 동작을 쓴다. */
  private bows: BowRig[] = [];
  /** 이번 일제사격이 몇 번 무기부터 시작하는가 (돌아가며 쏘게 하는 값) */
  private salvoBase = 0;
  /** 지난 일제사격이 쓴 무기 수 — 다음 다발의 시작 번호를 이만큼 민다 */
  private lastSalvoSize = 1;
  private mixer: THREE.AnimationMixer | null = null;
  private shootActions: THREE.AnimationAction[] = [];
  /**
   * 지면 함정(철질려)의 클립. 쏘는 망루와 규약이 다르다 —
   * idle 은 계속 돌고, trigger 는 적이 걸린 순간 한 번 튄다.
   */
  private idleAction: THREE.AnimationAction | null = null;
  private triggerAction: THREE.AnimationAction | null = null;
  private stringMaterial: THREE.LineBasicMaterial | null = null;

  readonly ring: RangeRing;
  private readonly groundY: number;
  /** 세운 자리 — 흔들리고 나면 반드시 여기로 돌아온다 */
  private readonly baseX: number;
  private readonly baseZ: number;
  private readonly worldBuf = new THREE.Vector3();

  constructor(
    readonly def: TowerDef,
    x: number,
    z: number,
    level: number,
    terrain: Terrain,
    private readonly assets: AssetRegistry,
  ) {
    this.level = level;
    this.groundY = terrain.heightAt(x, z);
    this.baseX = x;
    this.baseZ = z;
    this.object3d.position.set(x, this.groundY, z);

    this.model = this.buildLevelModel(level);
    this.object3d.add(this.model);
    this.setupBows();
    this.applyBowCount(level, false);
    this.collectTintMaterials();

    this.ring = new RangeRing(def.levels[level - 1].range, terrain);
    this.ring.group.position.set(x, 0, z);
    this.ring.setVisible(false);

    this.bar = new TowerHealthBar(this.bounds.height * BALANCE.fx.towerDamage.barHeightMul);
    this.object3d.add(this.bar.group);
  }

  /**
   * 그을림과 피격 섬광을 걸 재질을 복제해 둔다.
   *
   * AssetRegistry 의 재질은 같은 종류의 망루 전부가 **공유**한다. 그대로 색을
   * 바꾸면 한 기가 맞을 때 판 위의 궁노 망루가 전부 같이 검게 탄다.
   * (적 뷰가 같은 이유로 같은 일을 한다 — EnemyView 생성자 참고.)
   */
  private collectTintMaterials(): void {
    for (const m of this.tintMats) m.dispose();
    this.tintMats = [];
    this.baseColor = [];
    this.baseEmissive = [];
    this.baseOpacity = [];
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const clone = (mat: THREE.Material): THREE.Material => {
        const std = mat as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) return mat;
        const c = std.clone();
        this.tintMats.push(c);
        this.baseColor.push(c.color.clone());
        this.baseEmissive.push(c.emissive.clone());
        this.baseOpacity.push({ opacity: c.opacity, transparent: c.transparent, depthWrite: c.depthWrite });
        return c;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(clone)
        : clone(mesh.material);
    });
  }

  // ── 피격 / 파괴 ────────────────────────────────────────────────────

  /**
   * 불과 연기를 쓸 수 있게 한다. 지면 화재와 같은 텍스처를 빌려 쓰므로
   * GameScene 이 자기 자산을 넘겨 준다 — 뷰마다 텍스처를 굽지 않는다.
   */
  setFireAssets(assets: GroundFireAssets): void {
    this.fireAssets = assets;
  }

  /**
   * 남은 체력 비율. 이 한 값이 그을림·기울기·불·연기·체력바를 전부 움직인다.
   * @param flashBar 방금 맞아서 체력바를 띄워야 하면 true
   */
  setHealth(hpRatio: number, flashBar = false): void {
    this.damage = THREE.MathUtils.clamp(1 - hpRatio, 0, 1);
    this.bar.set(hpRatio, flashBar ? 3.2 : 0);
    this.ensureDamageFx();
    this.damageFx?.setDamage(this.damage);
  }

  /**
   * 한 대 맞았다. (fromX, fromZ) 는 때린 쪽 — 망루는 그 반대로 밀린다.
   *
   * 밀리는 방향이 없으면 그냥 위아래로 덜컹거리는 것이 되어 "어디서 맞았는지"가
   * 안 보인다. 여덟 방향에서 둘러싸여 맞을 때 이게 있어야 무리의 위치가 읽힌다.
   */
  hit(fromX: number, fromZ: number, power = 1): void {
    const dx = this.object3d.position.x - fromX;
    const dz = this.object3d.position.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    this.flinchX = dx / len;
    this.flinchZ = dz / len;
    this.flinch = Math.min(1, this.flinch + power);
    this.hitFlash = 1;
  }

  /** 수리했다 — 불이 잦아들고 체력바가 한 번 뜬다 */
  repaired(hpRatio: number): void {
    this.setHealth(hpRatio, true);
  }

  /** 골라 둔 망루는 체력바를 계속 띄운다 */
  setBarPinned(on: boolean): void {
    this.bar.setPinned(on);
  }

  /**
   * 무너지기 시작한다. 시뮬에서는 이미 사라진 망루이고 여기서는 여운만 남는다.
   * 끝났는지는 isCollapseFinished 로 묻는다.
   */
  startCollapse(): void {
    if (this.collapse >= 0) return;
    this.collapse = 0;
    // 마지막으로 밀린 방향으로 넘어간다. 맞은 적이 없으면(판매 등) 아무 쪽으로나.
    this.collapseAxis = Math.atan2(this.flinchX, this.flinchZ);
    this.ring.setVisible(false);
    this.bar.hide();
    this.damageFx?.setDamage(1);
  }

  get isCollapsing(): boolean {
    return this.collapse >= 0;
  }

  get isCollapseFinished(): boolean {
    return this.collapse >= 1;
  }

  /** The heavy second impact happens when the falling structure reaches the ground. */
  takeCollapseImpact(): boolean {
    if (this.collapse < .55 || this.collapseImpactEmitted) return false;
    this.collapseImpactEmitted = true;
    return true;
  }

  private ensureDamageFx(): void {
    if (this.damageFx || !this.fireAssets) return;
    if (this.damage < BALANCE.fx.towerDamage.smokeAt * 0.5) return;
    this.damageFx = new TowerDamageFx(
      this.fireAssets,
      this.bounds.height,
      Math.max(10, this.bounds.radius * 0.8),
      Math.round(this.object3d.position.x + this.object3d.position.z),
    );
    this.object3d.add(this.damageFx.object3d);
  }

  /** 쇠뇌가 달린 GLTF 모델인가 */
  get hasBows(): boolean {
    return this.bows.length > 0;
  }

  private buildLevelModel(level: number): THREE.Object3D {
    const lv = this.def.levels[level - 1];
    const modelId = lv.view.modelId ?? `${this.def.id}_lv${level}`;
    const obj = this.assets.getMesh(lv.view.modelId ? modelId : undefined, lv.view.primitive);
    this.body = obj.getObjectByName('body') ?? obj;
    return obj;
  }

  /**
   * 모델에서 쇠뇌 노드를 찾아 조립한다.
   * `bow1` 이 없으면 프리미티브 타워이므로 아무 일도 하지 않는다.
   */
  private setupBows(): void {
    this.bows = [];
    this.shootActions = [];
    this.idleAction = null;
    this.triggerAction = null;
    this.mixer = null;
    if (!this.model.getObjectByName('bow1')) {
      this.setupTrapClips();
      return;
    }

    this.model.updateMatrixWorld(true);
    const towerNode = this.model.getObjectByName('tower') ?? this.model;
    const towerPos = towerNode.getWorldPosition(new THREE.Vector3());

    this.stringMaterial = new THREE.LineBasicMaterial({ color: STRING_COLOR });

    for (let i = 1; ; i++) {
      const bone = this.model.getObjectByName(`bow${i}`);
      const nock = this.model.getObjectByName(`bow${i}_nock`);
      const tipA = this.model.getObjectByName(`bow${i}_tipA`) ?? null;
      const tipB = this.model.getObjectByName(`bow${i}_tipB`) ?? null;
      if (!bone || !nock) break;

      const p = bone.getWorldPosition(new THREE.Vector3());
      // 바인드 포즈에서 이 쇠뇌가 보던 방향 = 탑 중심에서 바깥
      const restYaw = Math.atan2(p.x - towerPos.x, p.z - towerPos.z);

      let string: THREE.Line | null = null;
      if (tipA && tipB) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 3), 3));
        string = new THREE.Line(geo, this.stringMaterial);
        string.frustumCulled = false;
        this.object3d.add(string);
      }

      this.bows.push({
        bone,
        nock,
        tipA,
        tipB,
        restYaw,
        aimYaw: restYaw,
        displayYaw: restYaw,
        string,
        popIn: 1,
        visible: true,
      });
    }

    const clips = (this.model as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations;
    if (clips && clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(this.model);
      for (let i = 0; i < this.bows.length; i++) {
        const clip = THREE.AnimationClip.findByName(clips, `shoot${i + 1}`);
        if (!clip) continue;
        const action = this.mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        this.shootActions[i] = action;
      }
    }
  }

  /**
   * 지면 함정의 클립을 건다.
   *
   * 철질려는 투사체가 없어 shootN 을 쓸 수 없다. 대신 rig-trap 이 구운
   * idle(마름쇠가 천천히 돈다)을 계속 틀고, tower:aura 가 올 때 trigger
   * (가시가 솟는다)를 한 번 얹는다. 둘 다 없으면 아무 일도 하지 않는다 —
   * 프리미티브 타워와 클립 없는 모델이 여기로 온다.
   */
  private setupTrapClips(): void {
    const clips = (this.model as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations;
    if (!clips || clips.length === 0) return;
    const idle = THREE.AnimationClip.findByName(clips, 'idle');
    const trigger = THREE.AnimationClip.findByName(clips, 'trigger');
    if (!idle && !trigger) return;

    this.mixer = new THREE.AnimationMixer(this.model);
    if (idle) {
      this.idleAction = this.mixer.clipAction(idle);
      this.idleAction.setLoop(THREE.LoopRepeat, Infinity);
      /*
       * 진지마다 시작 위상을 어긋나게 한다. 여러 기를 나란히 지으면 전부 같은
       * 박자로 돌아 기계 부품처럼 보이는데, 조금씩 밀어 두면 각자 도는 것처럼
       * 보인다. 클립 길이를 모르므로 비율로 민다.
       */
      this.idleAction.time = Math.random() * idle.duration;
      this.idleAction.play();
    }
    if (trigger) {
      this.triggerAction = this.mixer.clipAction(trigger);
      this.triggerAction.setLoop(THREE.LoopOnce, 1);
      this.triggerAction.clampWhenFinished = false;
    }
  }

  /** 레벨 수만큼만 쇠뇌를 보여준다. 새로 생긴 것은 팝 인 한다. */
  private applyBowCount(level: number, animate: boolean): void {
    for (let i = 0; i < this.bows.length; i++) {
      const b = this.bows[i];
      // 쇠뇌가 하나뿐인 무기(투석기)는 레벨과 상관없이 늘 보인다
      const shouldShow = this.bows.length === 1 ? true : i < level;
      if (shouldShow && !b.visible && animate) b.popIn = 0;
      else if (shouldShow && !animate) b.popIn = 1;
      b.visible = shouldShow;
      if (b.bone.userData.dragonHead) b.bone.visible = shouldShow;
      if (!shouldShow) {
        // 스케일 0은 노멀 계산에서 NaN 을 낼 수 있어 아주 작은 값으로 접는다
        b.bone.scale.setScalar(0.0001);
        if (b.string) b.string.visible = false;
      } else if (b.string) {
        b.string.visible = true;
      }
    }
  }

  mount(parent: THREE.Object3D): void {
    parent.add(this.object3d);
    parent.add(this.ring.group);
  }

  /** 업그레이드: 쇠뇌를 하나 더 세운다 (프리미티브면 활 표식을 하나 더 띄운다) */
  setLevel(level: number): void {
    if (level === this.level) return;
    const prevMarks = this.level;
    this.level = level;

    if (this.hasBows) {
      // 모델은 하나뿐이다 — 다시 만들 필요 없이 쇠뇌 수만 늘린다
      this.applyBowCount(level, true);
    } else {
      this.mixer?.stopAllAction();
      this.object3d.remove(this.model);
      this.disposeModel(this.model);
      this.model = this.buildLevelModel(level);
      this.object3d.add(this.model);
      this.setupBows();
      // 모델이 통째로 바뀌었다 — 그을림을 걸 재질도 새로 복제해야 한다.
      this.collectTintMaterials();

      // 새로 생긴 표식만 스케일 0에서 시작해 팝 인 (화살대 + 촉 둘 다)
      this.newMarks = [];
      for (let i = prevMarks; i < level; i++) {
        for (const name of [`arrowmark_${i}`, `arrowtip_${i}`]) {
          const mark = this.model.getObjectByName(name);
          if (mark) {
            mark.scale.setScalar(0.001);
            this.newMarks.push(mark);
          }
        }
      }
      this.markAnim = 0;
    }

    this.ring.setRadius(this.def.levels[level - 1].range);
    this.ring.pulse();
    // 새 재질에도 지금까지의 그을림을 다시 얹는다 (강화해도 부서진 자국은 남는다)
    this.applyScorch();
  }

  /**
   * 이 일제사격의 몇 번째 발이 **어느 무기**에서 나가는가.
   *
   * 단순히 `bowIndex % shown` 으로 두면 늘 앞 번호만 쏜다. 활 망루는 발수와
   * 쇠뇌 수가 레벨로 같아서 문제가 없었지만, 화공 망루는 5레벨에 대포가 다섯 문인데
   * 한 번에 세 발만 나간다 — 그러면 4·5번 대포는 영영 쏘지 않는 장식이 된다.
   * 그래서 일제사격마다 시작 번호를 밀어(salvoBase) 돌아가며 맡게 한다.
   *
   * fire() 와 muzzle() 이 같은 답을 내야 한다. GameScene 이 한 발마다 fire() 를
   * 부른 뒤 muzzle() 을 부르므로, 자리를 미는 것은 다발의 첫 발(bowIndex 0)에서만 한다.
   */
  private slotOf(bowIndex: number): number {
    const shown = Math.max(1, Math.min(this.level, this.bows.length));
    return (this.salvoBase + bowIndex) % shown;
  }

  /**
   * 발사. bowIndex 는 이번 일제사격에서 몇 번째 발인지 —
   * 그 발을 맡은 무기만 조준하고 시위를 튕긴다(대포는 뒤로 튄다).
   */
  fire(angle: number, bowIndex = 0): void {
    this.aimAngle = angle;
    this.recoil = 1;

    if (!this.hasBows) return;
    const shown = Math.max(1, Math.min(this.level, this.bows.length));
    if (bowIndex === 0) {
      // 지난 다발이 쓴 만큼 밀어 다음 무기부터 시작한다
      this.salvoBase = (this.salvoBase + this.lastSalvoSize) % shown;
      this.lastSalvoSize = 1;
    } else {
      this.lastSalvoSize = Math.max(this.lastSalvoSize, bowIndex + 1);
    }
    const i = this.slotOf(bowIndex);
    this.bows[i].aimYaw = angle;
    if (this.bows[i].bone.userData.dragonHead) {
      const turret = this.model.getObjectByName('dragon_turret');
      if (turret) turret.rotation.y = angle;
      // Rotate the turret, then align its forward fan. Heads never aim through the timber drum.
      for (const b of this.bows) {
        b.aimYaw = 0;b.displayYaw = 0;b.bone.rotation.y = -b.restYaw;
      }
    }
    const action = this.shootActions[i];
    if (action) action.reset().play();
  }

  /**
   * 이 발이 떠나는 자리 (쇠뇌의 시위, 대포의 포구). 월드 좌표.
   * 무기 노드가 없으면 null — 호출자가 타워 중심을 쓰면 된다.
   */
  muzzle(bowIndex: number, out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.hasBows) return null;
    return this.bows[this.slotOf(bowIndex)].nock.getWorldPosition(out);
  }

  muzzleNode(bowIndex: number): THREE.Object3D | null {
    return this.hasBows ? this.bows[this.slotOf(bowIndex)].nock : null;
  }

  /**
   * aura 타워(철질려)가 효과를 걸었다.
   * 투사체가 없어서 화면상 아무 일도 안 일어나는 것처럼 보이므로,
   * 진지 자체가 한 번 눌렸다 펴지며 "지금 작동 중"을 알린다.
   */
  pulseAura(): void {
    this.auraPulse = 1;
    // 모델 함정이면 가시가 솟는다. 처음부터 다시 트는 이유는 연달아 밟힐 때
    // 앞 재생이 끝나기를 기다리면 두 번째 적이 걸린 것이 안 보이기 때문이다.
    if (this.triggerAction) {
      this.triggerAction.reset();
      this.triggerAction.play();
    }
  }

  sync(_tower: Tower, _alpha: number, dt: number, camera?: THREE.Camera): void {
    if (this.collapse >= 0) {
      this.updateCollapse(dt, camera);
      return;
    }
    if (this.hasBows) {
      this.syncBows(dt);
    } else if (this.mixer) {
      /*
       * 지면 함정 — 클립이 돌아간다.
       *
       * 조준 회전은 하지 않는다. 바닥에 깐 원반이 적을 따라 도는 것은 이상하고,
       * 팔괘 무늬가 돌아가면 그 자체가 눈에 걸린다. 이 진지는 방향이 없다.
       */
      this.mixer.update(dt);
      this.model.updateMatrixWorld(true);
    } else {
      // 조준 방향으로 부드럽게 회전 (프리미티브는 몸통이 통째로 돈다)
      let diff = this.aimAngle - this.displayAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.displayAngle += diff * Math.min(1, dt * 9);
      this.object3d.rotation.y = this.displayAngle;
    }

    // 반동: 짧게 뒤로 밀렸다 돌아온다
    if (this.recoil > 0) {
      this.recoil = Math.max(0, this.recoil - dt * 6);
      const k = this.recoil * this.recoil;
      this.object3d.position.y = this.groundY - k * (this.hasBows ? 0.5 : 1.6);
      if (this.body && !this.hasBows) this.body.rotation.x = -k * 0.06;
    }

    // aura 맥동 — 살짝 납작해졌다 돌아온다
    if (this.auraPulse > 0) {
      this.auraPulse = Math.max(0, this.auraPulse - dt * 3.5);
      const k = this.auraPulse;
      this.object3d.scale.set(1 + k * 0.06, 1 - k * 0.1, 1 + k * 0.06);
      if (this.auraPulse === 0) this.object3d.scale.set(1, 1, 1);
    }

    // 활 표식 팝 인 (0 -> 1.2 -> 1, 0.25s)
    if (this.newMarks.length > 0) {
      this.markAnim += dt / 0.25;
      const t = Math.min(1, this.markAnim);
      const s = t < 0.6 ? (t / 0.6) * 1.2 : 1.2 - ((t - 0.6) / 0.4) * 0.2;
      for (const m of this.newMarks) m.scale.setScalar(s);
      if (t >= 1) {
        for (const m of this.newMarks) m.scale.setScalar(1);
        this.newMarks.length = 0;
      }
    }

    this.updateDamage(dt, camera);
    this.ring.update(dt);
  }

  /**
   * 부서진 정도가 몸에 드러나는 곳.
   *
   *   그을림   목재가 타서 검어진다. 색을 그냥 어둡게 하는 것이 아니라 **재의
   *            색**으로 끌어당긴다 — 어둡게만 하면 밤이 된 것처럼 보인다.
   *   달아오름 임계점을 넘으면 이음새가 붉게 달아오른다 (emissive).
   *   기울기   기둥이 상해 한쪽으로 눕는다. 마지막에 넘어갈 방향의 예고다.
   *   덜컹임   맞는 순간 그 반대로 밀렸다 돌아온다.
   */
  private updateDamage(dt: number, camera?: THREE.Camera): void {
    const td = BALANCE.fx.towerDamage;

    /*
     * 밀렸다 돌아온다. **절대 위치로** 쓴다 — 매 프레임 더하면 망루가 맞을 때마다
     * 조금씩 옆으로 걸어가서, 한 판이 끝날 때쯤 세운 자리에 없다.
     */
    if (this.flinch > 0) {
      this.flinch = Math.max(0, this.flinch - dt * 5.5);
      // 튕겨 돌아오는 감쇠 진동 — 목재가 한 번 흔들리고 멎는다
      const k = this.flinch * this.flinch;
      const wobble = Math.sin(this.flinch * Math.PI * 3) * k;
      this.object3d.position.x = this.baseX + this.flinchX * wobble * td.flinch;
      this.object3d.position.z = this.baseZ + this.flinchZ * wobble * td.flinch;
      if (this.flinch === 0) {
        this.object3d.position.x = this.baseX;
        this.object3d.position.z = this.baseZ;
      }
    }

    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 7);

    // 임계 구간에서만 눕는다 — 조금 맞았다고 기우는 망루는 부실 공사로 보인다
    const lean = THREE.MathUtils.clamp((this.damage - td.fireAt) / (1 - td.fireAt), 0, 1);
    if (lean > 0 || this.model.rotation.x !== 0 || this.model.rotation.z !== 0) {
      const amount = lean * lean * td.maxLean;
      // 흔들림은 피해가 클수록 커진다. 무너지기 직전의 망루는 가만히 서 있지 않는다.
      const shiver = Math.sin(performance.now() * 0.004) * lean * 0.012;
      this.model.rotation.z = this.flinchX * amount + shiver;
      this.model.rotation.x = -this.flinchZ * amount;
    }

    this.applyScorch();

    if (this.damageFx && camera) this.damageFx.update(dt, camera);
    if (camera) this.bar.update(dt, camera);
  }

  /**
   * 그을음 + 피격 섬광을 재질에 얹는다.
   *
   * 그을음이 주역이고 달아오름은 조역이다. 처음에는 반대로 잡았다가
   * (emissive 를 0.55까지 섞었다) 망루가 통째로 분홍빛으로 빛나서, 타는 것이
   * 아니라 붉게 칠한 것으로 보였다. 불의 붉은빛은 TowerDamageFx 의 불꽃이
   * 이미 충분히 뿌리고 있다 — 몸통이 할 일은 **검어지는 것**이다.
   */
  private applyScorch(): void {
    if (this.tintMats.length === 0) return;
    const soot = THREE.MathUtils.clamp((this.damage - 0.1) / 0.9, 0, 1);
    const glow = THREE.MathUtils.clamp((this.damage - BALANCE.fx.towerDamage.fireAt) / 0.5, 0, 1);
    const flash = this.hitFlash;
    for (let i = 0; i < this.tintMats.length; i++) {
      const m = this.tintMats[i];
      m.color.copy(this.baseColor[i]).lerp(_soot, soot * 0.86);
      if (flash > 0) m.color.lerp(_white, flash * 0.45);
      // 이음새가 아주 옅게 달아오르는 정도. 몸통이 광원이 되면 안 된다.
      m.emissive.copy(this.baseEmissive[i]).lerp(_ember, glow * 0.22);
      m.emissiveIntensity = 0.2 + glow * 0.3 + flash * 0.5;
    }
  }

  /**
   * 무너진다. 한쪽으로 기울어 쓰러지면서 땅으로 꺼지고 흐려진다.
   *
   * 그냥 사라지게 두면 "부서졌다"가 아니라 "지워졌다"로 보인다. 넘어가는 방향은
   * 마지막으로 맞은 쪽의 반대다 — 때린 무리가 밀어 넘긴 것으로 읽힌다.
   */
  private updateCollapse(dt: number, camera?: THREE.Camera): void {
    const td = BALANCE.fx.towerDamage;
    this.collapse = Math.min(1, this.collapse + dt / td.collapseSec);
    const t = this.collapse;
    // 처음엔 주저앉듯 천천히, 그다음 한 번에 넘어간다
    const fall = t * t * (3 - 2 * t);
    const tip = Math.sin(fall * Math.PI * 0.5) * 1.35;
    this.model.rotation.z = Math.sin(this.collapseAxis) * tip;
    this.model.rotation.x = -Math.cos(this.collapseAxis) * tip;
    this.object3d.position.y = this.groundY - fall * this.bounds.height * 0.22;
    // 넘어가면서 좌우로 조금 흔들린다
    this.object3d.rotation.y += dt * 0.6 * (1 - fall);

    const fade = 1 - THREE.MathUtils.smoothstep(t, 0.55, 1);
    for (let i = 0; i < this.tintMats.length; i++) {
      const m = this.tintMats[i];
      m.transparent = true;
      m.opacity = this.baseOpacity[i].opacity * fade;
      m.depthWrite = this.baseOpacity[i].depthWrite && fade > 0.5;
      m.color.copy(this.baseColor[i]).lerp(_soot, 0.85);
    }
    // 무너지는 동안 체력바는 거둔다 — 0인 막대가 잔해 위에 떠 있으면 잔상으로 보인다.
    this.bar.hide();
    if (this.damageFx) {
      // 불은 끝까지 타다가 마지막에 함께 꺼진다
      this.damageFx.setDamage(fade > 0.2 ? 1 : 0);
      if (camera) this.damageFx.update(dt, camera);
    }
    for (const b of this.bows) if (b.string) b.string.visible = false;
  }

  /** 쇠뇌 조준 회전, 팝 인, 시위 갱신 */
  private syncBows(dt: number): void {
    this.mixer?.update(dt);
    this.model.updateMatrixWorld(true);

    for (const b of this.bows) {
      if (b.visible) {
        // 이 쇠뇌만 목표를 향해 돈다. 뼈의 회전은 바인드 방향으로부터의 차이다.
        let diff = b.aimYaw - b.displayYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        b.displayYaw += diff * Math.min(1, dt * 7);
        b.bone.rotation.y = b.displayYaw - b.restYaw;

        if (b.popIn < 1) {
          b.popIn = Math.min(1, b.popIn + dt / 0.28);
          const t = b.popIn;
          const s = t < 0.6 ? (t / 0.6) * 1.2 : 1.2 - ((t - 0.6) / 0.4) * 0.2;
          b.bone.scale.setScalar(s);
        } else {
          b.bone.scale.setScalar(1);
        }
      }

      if (!b.string || !b.string.visible || !b.tipA || !b.tipB) continue;
      // 시위: 활 양끝과 시위 걸이를 잇는다. nock 이 뒤로 당겨지면 V자가 된다.
      const pos = b.string.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      let k = 0;
      for (const node of [b.tipA, b.nock, b.tipB]) {
        this.object3d.worldToLocal(node.getWorldPosition(this.worldBuf));
        arr[k++] = this.worldBuf.x;
        arr[k++] = this.worldBuf.y;
        arr[k++] = this.worldBuf.z;
      }
      pos.needsUpdate = true;
      b.string.geometry.computeBoundingSphere();
    }
  }

  playState(_state: ViewState): void {
    // 타워의 상태 애니메이션은 발사(shootN)뿐이고 fire() 가 직접 재생한다.
  }

  /**
   * 탭 판정에 쓸 실제 크기 — 뷰 원점 기준 { 높이, 반지름 }.
   *
   * 스킨 메시는 지오메트리 바운딩 박스가 **바인드 포즈**(약 1유닛) 라서 쓸모가 없다.
   * 뼈(stand)가 스케일을 들고 있기 때문이다. 그래서 스키닝을 먹인 정점 위치를
   * 직접 훑어 잰다. 건설·업그레이드 때 한 번씩만 부르므로 비용은 문제되지 않는다.
   */
  measureBounds(): { height: number; radius: number } {
    this.object3d.updateWorldMatrix(true, true);
    let height = 0;
    let radius = 0;
    const v = new THREE.Vector3();

    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute('position');
      if (!pos) return;
      const skinned = mesh as THREE.SkinnedMesh;
      const posed = skinned.isSkinnedMesh === true;
      if (posed) {
        // three는 스킨 메시의 바운딩 스피어를 **처음 프러스텀 판정 때 한 번** 재고
        // 그대로 캐시한다. 그 순간 뼈 행렬이 아직 서 있지 않으면 바인드 포즈(1유닛)
        // 크기로 굳어 버려서, 망루가 화면 안에 있는데도 통째로 잘려 안 보인다.
        // 여기서는 행렬이 확실히 갱신된 뒤이므로 지금 다시 재서 못을 박는다.
        skinned.computeBoundingSphere();
      }
      // 정점이 많으면 촘촘히 볼 필요가 없다. 최대 2000점만 균등 샘플링한다.
      const step = Math.max(1, Math.ceil(pos.count / 2000));
      for (let i = 0; i < pos.count; i += step) {
        if (posed) skinned.getVertexPosition(i, v);
        else v.fromBufferAttribute(pos, i);
        mesh.localToWorld(v);
        this.object3d.worldToLocal(v);
        if (v.y > height) height = v.y;
        const r = Math.hypot(v.x, v.z);
        if (r > radius) radius = r;
      }
    });

    /*
     * 잰 값을 기억해 둔다 — 체력바 높이와 불이 붙는 범위가 여기서 나온다.
     * GameScene 이 건설·업그레이드 다음 프레임에 이걸 부르므로(fitHitVolume),
     * 그 시점에 뷰의 두 장식도 같이 실제 크기를 얻는다.
     */
    this.bounds.height = height;
    this.bounds.radius = radius;
    this.bar.setHeight(height * BALANCE.fx.towerDamage.barHeightMul);
    this.damageFx?.setSize(height, Math.max(10, radius * 0.8));
    return { height, radius };
  }

  private disposeModel(obj: THREE.Object3D): void {
    // 지오메트리/머티리얼은 AssetRegistry 캐시가 소유한다. 여기서 dispose하지 않는다.
    obj.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.dispose(); });
    obj.clear();
  }

  dispose(): void {
    this.object3d.removeFromParent();
    this.bar.dispose();
    this.damageFx?.dispose();
    this.damageFx = null;
    for (const m of this.tintMats) m.dispose();
    this.tintMats.length = 0;
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.idleAction = null;
    this.triggerAction = null;
    for (const b of this.bows) {
      b.string?.removeFromParent();
      b.string?.geometry.dispose();
    }
    this.bows.length = 0;
    this.stringMaterial?.dispose();
    this.stringMaterial = null;
    this.disposeModel(this.model);
    this.ring.dispose();
    this.object3d.clear();
  }
}

const _white = new THREE.Color(0xffffff);
/** 탄 목재의 색 — 검정이 아니라 젖은 재의 회갈색이다 */
const _soot = new THREE.Color(0x241d18);
/** 이음새가 달아오른 색 */
const _ember = new THREE.Color(0xc23a12);
