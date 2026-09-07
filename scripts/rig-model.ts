/**
 * 정지 메시에 뼈대와 애니메이션 클립을 심는다.
 *
 *   npx tsx scripts/rig-model.ts <in.glb> <out.glb> [옵션]
 *
 *   --forward <deg>       모델이 바라보는 방향. +Z가 정면이면 0
 *   --height <u>          완성 키(world unit). 보병 34
 *   --body humanoid|mounted  사람인지 말 탄 기병인지
 *   --arms single|split   양손 무기는 single, 한 손 무기는 split
 *   --attack thrust|swing 창은 thrust, 몽둥이는 swing
 *   --cadence <sec>       걷기 한 주기. 덩치가 크면 길게 (보병 0.9, 두목 1.25)
 *
 * 왜 필요한가
 * ----------
 * 받은 원본(img/Soldier.glb)은 스킨도 애니메이션도 없는 조각 메시였다.
 * 걷는 씬과 창 찌르기를 재생하려면 뼈대가 있어야 하는데, DCC 툴 없이
 * 데이터 수준에서 심는다. 자동 리깅이므로 목표는 "해부학적으로 정확"이 아니라
 * **45도 부감에서 30~60px로 보일 때 자연스럽게 읽히는 것**이다.
 *
 * 뼈 11개
 *   root ─ hips ┬ chest ┬ head
 *               │       ├ shoulderL / shoulderR   어깨와 위팔
 *               │       └ arms                    아래팔 + 손 + 창 (한 덩어리)
 *               ├ legL ─ footL
 *               └ legR ─ footR
 *
 * 창을 **양손**으로 잡고 있어서 좌우 팔을 따로 돌리면 한쪽 손이 창에서 떨어진다.
 * 그래서 아래팔·손·창은 `arms` 하나로 묶어 통째로 돌리고, 어깨만 좌우로 나눈다.
 * 어깨 회전은 작게 두어(0.1 rad 이하) 위팔과 아래팔 사이가 벌어지지 않게 한다.
 *
 * 가중치는 "뼈 선분까지의 거리"로 굽는다. 팔·창은 어느 다리 선분에서도 멀기 때문에
 * 자연스럽게 chest로 붙고, 그래서 다리가 흔들려도 창이 찢어지지 않는다.
 * 조각난 메시(연결 요소 144개)라 부위 분리를 위상으로 할 수 없어 거리로 한다.
 *
 * 클립 셋
 *   idle    제자리 호흡 (아주 작은 상하 움직임)
 *   walk    다리 가위질 + 몸통 상하 + 반대 방향 어깨 흔들림
 *   attack  창 찌르기 — 당겼다가(0.25s) 내지르고(0.15s) 되돌아온다
 */
import { NodeIO, type Document, type Node, type Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

// ── 뼈대 정의 ─────────────────────────────────────────────────────────
//
// 좌표는 모델 로컬 공간(정규화된 bbox: 높이 0.92)이며,
// 아래 analyze 단계에서 실제 메시에 맞춰 보정된다.

type Vec3 = [number, number, number];

/**
 * 팔 구성.
 *   single  아래팔·손·무기를 `arms` 하나로 묶는다 — 창처럼 **양손**으로 잡는 무기
 *   split   `armL`/`armR` 로 나눈다 — 몽둥이처럼 **한 손**으로 드는 무기
 * 양손 무기를 split 으로 하면 한쪽 손이 무기에서 떨어진다.
 */
export type ArmMode = 'single' | 'split';

/**
 * 공격 방식.
 *   thrust      찌르기 — 창
 *   swing       내려치기 — 몽둥이·도끼. 무기 든 팔이 뒤로 젖혔다가 앞아래로 쓸어 내린다
 *   dual_swing  쌍칼 내려치기 — 두 팔이 **함께** 올라갔다가 동시에 내리꽂는다.
 *               한 팔만 쓰는 swing 과 달리 반대 팔이 균형을 잡지 않는다. 둘 다 무기다.
 */
export type AttackStyle = 'thrust' | 'swing' | 'dual_swing';

/**
 * 몸 구조.
 *   humanoid  두 다리로 걷는 사람
 *   mounted   말 탄 기병 — 다리가 넷이고, 공격은 말 위의 병사가 한다
 *
 * mounted 도 attackStyle 을 따른다. thrust 는 창을 내지르고, swing 은
 * 방천화극처럼 날이 옆으로 뻗은 무기를 어깨·몸통으로 휘두른다.
 */
export type BodyKind = 'humanoid' | 'mounted';

export interface RigOptions {
  bodyKind: BodyKind;
  forwardDeg: number;
  targetHeight: number;
  armMode: ArmMode;
  attackStyle: AttackStyle;
  /** 걷기 한 주기(초). 덩치가 클수록 길어야 무겁게 걷는다. */
  cadence: number;
  /** 허벅지 앞뒤 스윙 각도(rad). */
  walkStride: number;
  /** 무릎 최대 굽힘 각도(rad). */
  kneeBend: number;
  /** 원본의 벌어진 다리를 안쪽으로 모으는 강도. */
  legCloseFactor: number;
  /**
   * 덩치가 크고 자세가 비대칭인 모델인가 (갑주를 두른 대장 같은).
   *
   * 켜면 세 가지가 달라진다.
   *   - 몸통 축을 허리가 아니라 **머리**에서 잡는다 (넓게 벌린 자세에서 허리 중앙값이 밀린다)
   *   - 뼈마다 **굵기**를 재서 거리에서 빼 준다 (선 하나로는 두꺼운 몸통을 못 잡는다)
   *   - 팔 뼈가 어깨 바깥에서 시작한다
   *
   * 날씬한 병사들은 이 보정이 필요 없고, 켜면 이미 맞춰 둔 결과가 바뀐다.
   * 그래서 기본은 꺼짐이다.
   */
  bulky?: boolean;
  /**
   * 갑주 자락 — 허리에 매달려 두 다리를 덮는 치마형 방어구.
   *
   * 거리로만 가중치를 굽으면 자락의 왼쪽 절반은 왼다리, 오른쪽 절반은 오른다리가
   * 가져간다. 그러면 걸을 때 자락이 두 쪽으로 찢어져 판때기처럼 날아다닌다
   * (실측: 원소의 자락이 다리 스윙 0.7rad 을 그대로 따라갔다).
   *
   * 자락은 옷이 아니라 허리에 달린 판이다 — 골반을 따라가고, 아랫단만 다리를 조금 탄다.
   * toRatio 는 자락 아랫단의 높이(몸 높이 비율), legInfluence 는 아랫단에서 허용할
   * 다리 가중치의 상한이다.
   */
  skirt?: {
    toRatio: number;
    legInfluence?: number;
    /**
     * 자락 대역의 **윗단** — 몸 높이 비율. 기본 0.5 (허리).
     *
     * 다리 뼈는 반경 안이면 위쪽 정점도 가져간다. 장포처럼 다리가 아예 없는
     * 인물은 그 반경이 가슴 아래까지 닿아서(실측: 제갈량의 다리 뼈가 y 0.22,
     * 몸 높이의 73% 지점까지 가중치 1,372를 들었다) 허리까지만 눌러서는 모자란다.
     */
    topRatio?: number;
  };
  /**
   * 바닥까지 닿는 긴 봉을 든 모델인가.
   *
   * 봉은 발끝부터 머리 위까지 이어져 거리 기반 스키닝으로는 다리·골반·가슴·머리
   * 뼈에 토막토막 나뉜다. 그러면 걷기만 해도 봉이 활처럼 휘어 부러진다.
   * 이 옵션을 켜면 봉을 찾아 **통째로 무기 뼈 하나에 묶고** 손에서 회전시킨다.
   */
  staff?: boolean;
  /**
   * 한 손에 든 긴 무기(대도·언월도)를 통째로 그 팔 뼈에 묶는가.
   *
   * 켜지 않으면 거리 스키닝이 칼을 팔·가슴·골반으로 나눠 가져서, 걷기만 해도
   * 칼이 활처럼 휜다. 켜면 칼날 캡슐 안의 정점이 전부 그 팔 뼈 하나를 따라간다.
   *
   * 아무 모델에나 켜면 안 된다 — 칼이 없는 모델에서는 갑주 자락과 장화가 이어진
   * 세로줄을 칼로 잡는다. 걷을 때 칼이 휘는 것이 실제로 보이는 모델에만 켠다.
   */
  blade?: boolean;
  /**
   * 몸(머리 끝)의 높이 — bbox 높이 대비 비율. 큰 부속이 머리 위로 솟았을 때만 준다.
   *
   * 평소에는 analyze 가 "Y 칸별 정점 수가 최대치의 3% 밑으로 떨어지는 곳부터는
   * 부속"이라는 규칙으로 알아서 자른다. 창처럼 **가느다란** 것은 그걸로 잘린다.
   * 관우의 등 뒤 깃발은 안 잘린다 — 넓은 천이라 정점이 많고(실측: 머리 위 칸에
   * 315개, 3% 문턱은 훨씬 아래였다) 깃대가 몸통 축에서 0.14H 밖에 안 떨어져 있다.
   *
   * 그대로 두면 bodyTopY 가 깃발 꼭대기까지 올라가고, **거기서 파생되는 모든 것**이
   * 어긋난다 — 머리 뼈가 깃발 속에 박히고(실측: 머리 정점 대신 깃천 682개를 잡았다),
   * 어깨·팔 높이가 밀리고, targetHeight 가 깃발까지 포함한 키에 걸려 관우가 작아진다.
   *
   * 그래서 이 모델에서만 손으로 준다. 값은 참고 그림과 probe 로 잰다.
   */
  bodyTopRatio?: number;
  /**
   * 발을 찾을 때 몸통 축에서 이 거리(bodyH 비율) 밖의 정점은 무시한다.
   *
   * 발은 하단 20% 대역을 XZ 2-means 로 갈라 찾는다. 그 대역에 **바닥까지 닿는
   * 무기**가 있으면 한쪽 군집이 통째로 그 무기가 된다 — 관우의 언월도 날 끝이
   * 축에서 0.47H 떨어진 자리에 있어서 왼발로 잡혔고, 그 결과 다리 뼈가 몸이
   * 아니라 칼을 향해 뻗었다.
   *
   * 발은 아무리 벌려도 축에서 0.4H 안쪽이다. 기본값(없음)은 지금까지 구운
   * 모델들의 결과를 바꾸지 않기 위한 것이다 — 필요한 모델만 켠다.
   */
  footRadius?: number;
  /**
   * 무기를 든 손을 못 박는다.
   *
   * 자동 판정은 "몸통 축에서 더 멀리 뻗은 팔"이다. 무기 말고는 아무것도 안 뻗은
   * 모델에서는 맞지만, 등에 깃발을 진 관우는 깃발 쪽(오른쪽)이 이겨서 언월도를
   * 든 왼손을 놓쳤다. 그럴 때만 준다.
   */
  weaponSide?: 'L' | 'R';
  /**
   * 척추가 지나는 자리(모델 로컬 x·z)를 못 박는다.
   *
   * 자동 판정은 허리 대역의 XZ 중앙값이고, bulky 면 머리 대역으로 갈아탄다.
   * 둘 다 "정점이 몸 부위에 고르게 퍼져 있다"를 전제한다. 제갈량은 그렇지 않다 —
   * 우선깃털부채와 장포 앞자락이 정점의 절반을 가져가 중앙값을 앞으로 0.10 밀었고
   * (실측: 머리는 z 0.030 인데 축은 0.148), 머리 뼈가 머리 밖에 놓여 58정점만 잡았다.
   *
   * 이럴 때만 준다. 값은 머리 대역의 중앙값을 재서 넣는다.
   */
  bodyAxis?: { x: number; z: number };
  /**
   * 팔을 따로 움직이지 않는다 — 소매·손에 든 것까지 몸통이 통째로 들고 돈다.
   *
   * 큰 소매의 장포를 입은 인물(제갈량)에게 쓴다. 그런 모델에서는 팔과 옷이
   * 공간적으로 구분되지 않는다 — 거리 스키닝이 팔 뼈에 **모델의 70%** 를 붙였고
   * (실측: 오른팔 26,182 / 전체 35,582. 부채 깃털이 정점 예산을 다 먹어서
   * 부채·깃·앞자락이 한 덩어리로 뭉쳐 있다), 그 팔을 0.75rad 돌리면 상체가
   * 통째로 접힌다.
   *
   * 켜면 팔·어깨 뼈의 반경을 0 으로 만들어 정점을 하나도 잡지 않게 한다.
   * 뼈와 클립은 그대로 남지만 아무것도 움직이지 않고, 보이는 동작은 몸통(chest)의
   * 비틀기가 한다 — 부채를 쥔 팔이 따로 도는 대신 **상체가 돌며 부채를 쓸고
   * 지나간다.** 소매 안에 팔이 있는 인물의 실제 동작에 가깝고, 무엇보다 찢어지지 않는다.
   */
  rigidArms?: boolean;
  /**
   * 장포 걸음 — **다리가 안 보이는 인물**의 걷기.
   *
   * 보통 걷기는 다리 뼈가 만든다. 바닥까지 끌리는 장포를 입은 인물은 그 다리에
   * 정점이 하나도 없으므로(자락을 전부 골반으로 옮겼다) 다리를 아무리 흔들어도
   * 화면에서는 아무 일도 일어나지 않는다 — 제갈량이 **공중에 떠서 미끄러졌다.**
   *
   * 그래서 골반이 대신 걷는다. 몸 전체를 좌우로 싣고(sway), 걸음마다 살짝
   * 들어 올리고(bob), 디딘 쪽으로 기운다(roll). 옷자락은 골반에 매달려 있으므로
   * 기우는 만큼 밑단이 크게 쓸린다 — 그것이 이 인물의 걸음으로 읽힌다.
   *
   * 위아래는 **위로만** 흔든다. 아래로 내리면 접지 계산이 그만큼 몸을 띄워서
   * 서 있을 때 옷단이 바닥에서 떠 버린다.
   */
  robeGait?: boolean;
  /**
   * 등에 진 깃발·창통을 몸통 뼈에 묶는다.
   *
   * 켜지 않으면 머리 위 부속이 "가장 가까운 뼈"인 팔로 떨어져, 내려치기에서
   * 깃발이 팔처럼 휘둘린다. 켜면 부속 전용 뼈(prop)가 chest 밑에 생기고
   * 아무 클립도 그 뼈를 돌리지 않는다 — 몸통이 도는 만큼만 따라 돈다.
   */
  backProp?: boolean;
}

interface BoneSpec {
  name: string;
  parent: string | null;
  /** 바인드 포즈 월드 위치 */
  head: Vec3;
  /**
   * 가중치를 구울 때 쓰는 선분의 끝점. 없으면 자식 뼈의 head를 쓴다.
   * 말단 뼈(head, foot)는 여기서 직접 준다.
   */
  tail?: Vec3;
  /**
   * 뼈의 "굵기". 이만큼은 거리에서 빼고 잰다.
   *
   * 뼈는 선인데 몸통은 통이다. 갑주를 두른 덩치는 가슴 표면이 척추에서 0.17 떨어져 있는데,
   * 팔 뼈는 삼각근에서 시작해 배 앞을 가로지르므로 그 표면에 0.05 까지 붙는다.
   * 그래서 거리만으로 재면 **팔이 상체를 통째로 가져간다**(실측: 원소의 armR 이 1,094정점).
   * 몸통 뼈에 굵기를 주면 표면이 제 뼈에 붙고, 팔·칼은 여전히 팔에 붙는다.
   */
  coreR?: number;
  /**
   * 이 뼈가 잡을 수 있는 최대 거리. 이걸 넘으면 아예 후보에서 빠진다.
   *
   * 반경을 "부드러운 감쇠"로 쓰면 큰 뼈가 작은 뼈를 삼킨다 — 실제로 hips 반경을
   * 크게 뒀더니 다리 정점의 96%가 hips로 가서 다리가 통째로 안 움직였다.
   * 그래서 지금은 감쇠가 아니라 **하드 캡**이다. 다리 근처는 다리만 잡는다.
   */
  maxR: number;
}

/**
 * 메시 분석 결과로 뼈를 놓는다.
 *
 * 골반은 몸통 중앙값이 아니라 **두 발의 중간**에 둔다. 이 모델은 크게 벌린
 * 런지 자세라 몸통이 한쪽 다리 위로 쏠려 있는데, 몸통 중앙값을 골반으로 삼으면
 * 골반이 왼발 바로 위에 놓여 오른다리 뼈가 몸을 가로지른다. 그러면 그 뼈를
 * 돌렸을 때 다리가 아니라 엉뚱한 데가 움직인다.
 */
function buildSkeleton(m: MeshStats, armMode: ArmMode, weaponArms = false): BoneSpec[] {
  const { minY, bodyTopY, legA, legB, armCenter } = m;

  // 두 다리 클러스터 중 X가 작은 쪽을 L로 둔다 (좌우 이름은 편의상일 뿐이다)
  const [fl, fr] = legA[0] <= legB[0] ? [legA, legB] : [legB, legA];

  const bodyH = bodyTopY - minY;
  const hipY = minY + bodyH * 0.50;
  const chestY = minY + bodyH * 0.66;
  const headY = minY + bodyH * 0.86;

  // 골반 = 두 발의 중간
  // Keep the torso axis independent from accessories near the ground (large shields,
  // swords and capes can otherwise pull the two-foot clustering far off-centre).
  const pelvisX = m.bodyX;
  const pelvisZ = m.bodyZ;

  // 각 다리의 고관절은 골반에서 그 발 쪽으로 30% 나간 자리 —
  // 뼈가 실제 다리 안을 지나가야 그 다리의 정점을 잡는다.
  const hip = (f: [number, number]): Vec3 => [
    pelvisX + (f[0] - pelvisX) * 0.3,
    hipY,
    pelvisZ + (f[1] - pelvisZ) * 0.3,
  ];
  // 무릎은 고관절과 발 사이 45%
  const knee = (h: Vec3, f: [number, number]): Vec3 => [
    h[0] + (f[0] - h[0]) * 0.45,
    minY + bodyH * 0.22,
    h[2] + (f[1] - h[2]) * 0.45,
  ];

  const hipL = hip(fl);
  const hipR = hip(fr);
  const kneeL = knee(hipL, fl);
  const kneeR = knee(hipR, fr);
  const legR2 = bodyH * 0.24;

  // 어깨는 가슴 위쪽 좌우. 위팔까지만 잡을 만큼만 반경을 준다.
  const shoulderY = headY - bodyH * 0.05;
  const shoulderOff = bodyH * 0.12;
  const shoulderL: Vec3 = [pelvisX - shoulderOff, shoulderY, pelvisZ];
  const shoulderR: Vec3 = [pelvisX + shoulderOff, shoulderY, pelvisZ];

  /*
   * arms 는 어깨선 **바깥**에서 시작해야 한다.
   * 몸통 한가운데에서 시작하면 외투·갑옷까지 이 뼈가 가져가서,
   * 팔을 조금만 돌려도 상체가 통째로 뒤틀린다(실측: 803정점을 삼켰다).
   */
  const shoulderMid: Vec3 = [pelvisX, shoulderY, pelvisZ];
  const toArm = [
    armCenter[0] - shoulderMid[0],
    armCenter[1] - shoulderMid[1],
    armCenter[2] - shoulderMid[2],
  ];
  const toArmLen = Math.hypot(toArm[0], toArm[1], toArm[2]) || 1;
  const armsHead: Vec3 = [
    shoulderMid[0] + (toArm[0] / toArmLen) * bodyH * 0.16,
    shoulderMid[1] + (toArm[1] / toArmLen) * bodyH * 0.16,
    shoulderMid[2] + (toArm[2] / toArmLen) * bodyH * 0.16,
  ];
  const armsTail: Vec3 = [
    armsHead[0] + (toArm[0] / toArmLen) * bodyH * 0.40,
    armsHead[1] + (toArm[1] / toArmLen) * bodyH * 0.40,
    armsHead[2] + (toArm[2] / toArmLen) * bodyH * 0.40,
  ];

  const common: BoneSpec[] = [
    { name: 'root', parent: null, head: [pelvisX, minY, pelvisZ], tail: [pelvisX, hipY, pelvisZ], maxR: 0 },
    { name: 'hips', parent: 'root', head: [pelvisX, hipY, pelvisZ], tail: [pelvisX, chestY, pelvisZ], maxR: bodyH * 0.26 },
    // chest 는 몸통 속만 잡는다. 넓게 잡으면 팔·무기까지 삼켜서 팔이 안 움직인다.
    { name: 'chest', parent: 'hips', head: [pelvisX, chestY, pelvisZ], tail: [pelvisX, headY, pelvisZ], maxR: bodyH * 0.34 },
    { name: 'head', parent: 'chest', head: [pelvisX, headY, pelvisZ], tail: [pelvisX, bodyTopY, pelvisZ], maxR: bodyH * 0.13 },
    { name: 'shoulderL', parent: 'chest', head: shoulderL, tail: [shoulderL[0] - bodyH * 0.10, shoulderY - bodyH * 0.08, shoulderL[2]], maxR: bodyH * 0.13 },
    { name: 'shoulderR', parent: 'chest', head: shoulderR, tail: [shoulderR[0] + bodyH * 0.10, shoulderY - bodyH * 0.08, shoulderR[2]], maxR: bodyH * 0.13 },
    /*
     * 등짐(깃발) 뼈 — 몸통에 매달린다. maxR 0 이라 거리 스키닝에는 안 잡히고,
     * 캡슐 안 정점만 나중에 통째로 묶인다. 어떤 클립도 이 뼈를 돌리지 않는다:
     * 등에 묶인 물건이니 가슴이 도는 만큼만 따라 돌면 된다.
     */
    ...(m.backProp
      ? [{ name: 'prop', parent: 'chest', head: m.backProp.head, tail: m.backProp.tail, maxR: 0 } as BoneSpec]
      : []),
  ];

  const legs: BoneSpec[] = [
    { name: 'legL', parent: 'hips', head: hipL, tail: kneeL, maxR: legR2 },
    { name: 'footL', parent: 'legL', head: kneeL, tail: [fl[0], minY, fl[1]], maxR: legR2 },
    { name: 'legR', parent: 'hips', head: hipR, tail: kneeR, maxR: legR2 },
    { name: 'footR', parent: 'legR', head: kneeR, tail: [fr[0], minY, fr[1]], maxR: legR2 },
  ];

  /**
   * 봉 뼈 — 손에서 봉 끝까지. 반경 0 이라 거리 스키닝에는 잡히지 않고,
   * 봉 정점만 나중에 통째로 이 뼈에 묶인다. 회전 중심이 손이라
   * 휘두를 때 봉 아래끝이 땅을 파고들지 않는다.
   */
  const weaponBone = (parent: string): BoneSpec[] => {
    const st = m.staff;
    if (!st) return [];
    return [{ name: 'weapon', parent, head: st.grip, tail: st.top, maxR: 0 }];
  };

  if (armMode === 'single') {
    return [
      ...common,
      { name: 'arms', parent: 'chest', head: armsHead, tail: armsTail, maxR: bodyH * 0.26 },
      ...weaponBone('arms'),
      ...legs,
    ];
  }

  // split — 팔마다 어깨에서 그 팔 덩어리 쪽으로 뻗는다
  const armBone = (
    name: string,
    shoulder: Vec3,
    center: Vec3,
    fitted: { head: Vec3; tail: Vec3 } | null,
  ): BoneSpec => {
    const parent = name === 'armL' ? 'shoulderL' : 'shoulderR';
    /*
     * 무기를 든 팔은 그 덩어리(팔+어깨갑옷+칼)에 맞춘 축을 그대로 뼈로 쓴다.
     * 어깨에서 팔 중심으로 곧게 뻗는 뼈는 두 가지를 다 놓친다 —
     * 칼날은 뼈에서 비껴 있어 가슴 뼈로 새고, 뼈가 배 앞을 가로질러 상체를 삼킨다.
     */
    if (weaponArms && fitted) {
      return { name, parent, head: fitted.head, tail: fitted.tail, maxR: bodyH * 0.17 };
    }
    const d = [center[0] - shoulder[0], center[1] - shoulder[1], center[2] - shoulder[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || bodyH * 0.25;
    return {
      name,
      parent,
      head: shoulder,
      tail: [
        shoulder[0] + (d[0] / len) * bodyH * 0.34,
        shoulder[1] + (d[1] / len) * bodyH * 0.34,
        shoulder[2] + (d[2] / len) * bodyH * 0.34,
      ],
      maxR: bodyH * 0.22,
    };
  };

  return [
    ...common,
    armBone('armL', shoulderL, m.armCenterL, m.armAxisL),
    armBone('armR', shoulderR, m.armCenterR, m.armAxisR),
    ...weaponBone(m.weaponSide === 'L' ? 'armL' : 'armR'),
    ...legs,
  ];
}

// ── 메시 분석 ─────────────────────────────────────────────────────────

interface MeshStats {
  minY: number;
  maxY: number;
  height: number;
  /**
   * 몸(창 제외)의 꼭대기. bbox 최고점은 창끝이라 그걸 키로 쓰면
   * 스케일도 발 위치도 전부 틀어진다 — 실제로 몸이 땅에 파묻혔다.
   */
  bodyTopY: number;
  /** 몸통 중심 (다리 위쪽 구간의 XZ 중앙값) */
  bodyX: number;
  bodyZ: number;
  /** 발 클러스터 두 개 (XZ) */
  legA: [number, number];
  legB: [number, number];
  /**
   * 팔·무기 덩어리의 중심. 몸통 축에서 멀리 떨어진 상체 정점들의 평균이다.
   * 팔 뼈를 이 방향으로 뻗어야 그 뼈가 실제 팔과 무기를 잡는다.
   */
  armCenter: Vec3;
  /** 몸통 축 기준 왼쪽(-X)·오른쪽(+X) 팔 덩어리의 중심 (split 모드용) */
  armCenterL: Vec3;
  armCenterR: Vec3;
  /**
   * 팔+무기를 하나의 선으로 맞춘 축 (쌍칼처럼 팔마다 무기를 든 모델용).
   *
   * 어깨에서 팔 중심으로 곧게 뻗는 뼈로는 칼을 못 덮는다 — 팔은 옆으로,
   * 칼은 거기서 위로 꺾이기 때문에 그 직선은 칼날 옆을 스칠 뿐이다.
   * 그 덩어리(팔+어깨갑옷+칼) 전체에 주성분을 맞추면 칼날을 따라 눕는 축이 나온다.
   */
  armAxisL: { head: Vec3; tail: Vec3 } | null;
  armAxisR: { head: Vec3; tail: Vec3 } | null;
  /** 팔 덩어리를 가르는 기준 — 이 높이 위, 몸통 축에서 이 거리 밖 */
  chestY: number;
  armFar: number;
  /** 몸통의 굵기 (가슴 대역에서 축까지 거리의 중앙값) */
  torsoRadius: number;
  /** 좌우 손에 든 칼날 (쌍칼 모델에서만) */
  bladeL: StaffInfo | null;
  bladeR: StaffInfo | null;
  /** 무기를 든 쪽 — 몸통에서 더 멀리 뻗은 팔로 판정한다 */
  weaponSide: 'L' | 'R';
  /** 바닥까지 닿는 봉 (staff 옵션이 켜졌고 실제로 찾았을 때만) */
  staff: StaffInfo | null;
  /** 등에 진 깃발 (backProp 옵션이 켜졌고 실제로 찾았을 때만) */
  backProp: BackProp | null;
}

/**
 * 몸에서 떨어져 선 봉 — **캡슐**로 잡는다.
 *
 * 처음에는 수직 원기둥으로 잡았는데, 봉이 조금만 기울어도(이 모델은 약 8도)
 * 아래끝이 원기둥 밖으로 나가 다리 뼈에 붙었다. 그러면 걷을 때 봉 아래 토막만
 * 다리를 따라 흔들려 봉이 두 동강 난 것처럼 보인다. 그래서 축을 직접 맞춘다.
 */
/** 등에 진 부속 — 어느 정점이 부속인지와, 그 부속을 대표하는 뼈의 양 끝 */
interface BackProp {
  mask: Uint8Array;
  head: Vec3;
  tail: Vec3;
}

interface StaffInfo {
  /** 손이 잡은 지점 = 회전 중심 */
  grip: Vec3;
  /** 봉 위끝 */
  top: Vec3;
  /** 봉 축 (정규화, 위쪽) */
  dir: Vec3;
  /** 축에서 이 거리 안이면 봉 — **손 위쪽** 기준 (쥔 손가락과 창날·술까지 들어온다) */
  r: number;
  /**
   * 손 **아래쪽**에 쓰는 반경. 위쪽보다 좁다.
   *
   * 손 위의 봉은 허공에 있어 넉넉히 잡아도 봉밖에 안 들어온다. 그런데 손 아래는
   * 다리와 갑주 자락이 바로 옆에 있어서, 같은 반경으로 잡으면 자락을 물어 버린다.
   * 그러면 그 조각이 봉을 따라 돌아 허공을 날아다닌다(실측: 찌르기에서 병사
   * 오른쪽에 검은 덩어리가 떠다녔다). 아래는 대의 굵기만 잡는다.
   */
  rLow: number;
  /** grip 기준 축 방향 범위 */
  tMin: number;
  tMax: number;
}

/** 점에서 무한 직선까지의 거리와 축 방향 위치 */
function alongAxis(p: Vec3, origin: Vec3, dir: Vec3): { t: number; d: number } {
  const vx = p[0] - origin[0];
  const vy = p[1] - origin[1];
  const vz = p[2] - origin[2];
  const t = vx * dir[0] + vy * dir[1] + vz * dir[2];
  const dx = vx - dir[0] * t;
  const dy = vy - dir[1] * t;
  const dz = vz - dir[2] * t;
  return { t, d: Math.hypot(dx, dy, dz) };
}

/**
 * 바닥까지 닿는 봉을 찾는다.
 *
 * 봉은 "몸통 축에서 떨어져 있으면서 키의 대부분을 세로로 관통하는 가느다란 기둥"이다.
 * XZ 격자로 잘라 셀마다 Y 범위를 재면, 몸통 셀은 축 가까이에 있고 봉 셀만
 * 멀리 떨어진 채 위아래로 길다. 실측(서량 종군 도사): 봉 셀 dist 0.175~0.184,
 * 몸통 셀은 0.10 이하 — 사이가 확실히 비어 있어 가장 먼 셀에서 뭉치면 봉만 잡힌다.
 */
/**
 * 기울어진 봉의 씨앗 축을 찾는다 — 격자 방식이 실패했을 때의 대안.
 *
 * 격자 방식은 (x,z) 칸 **하나**가 세로로 키의 90% 를 덮어야 봉으로 인정한다.
 * 곧게 세운 봉에는 잘 맞지만 기울어진 봉은 여러 칸에 나뉘어 어느 칸도 기준을
 * 못 채운다 (실측 — 하북 창병의 창은 아래 x=-0.30·z=-0.02 에서 위 x=-0.40·z=0.24
 * 로 0.28 흘러가 네 칸에 걸쳐 있었고, 가장 긴 칸도 89.7% 에서 멎었다).
 *
 * 여기서는 칸을 세지 않고 **몸통에서 충분히 떨어진 점들의 위아래 끝**을 잡아
 * 그 둘을 잇는 선을 씨앗으로 준다. 기울기와 무관하다. 이 씨앗을 넘기면 뒤의
 * 주성분 다듬기가 실제 봉 축으로 수렴한다.
 *
 * 몸이 아니라 봉임을 어떻게 아는가: 몸통축에서 bodyH*0.18 밖이어야 하고(발·어깨는
 * 그 안쪽이다), 그 바깥 점들이 키의 75% 이상을 세로로 덮어야 한다. 게다가 이
 * 함수는 모델이 staff 를 켰을 때만 불린다.
 */
function tiltedStaffSeed(
  P: Float32Array,
  n: number,
  height: number,
  bodyH: number,
  axisX: number,
  axisZ: number,
): { origin: Vec3; dir: Vec3 } | null {
  const outer = bodyH * 0.18;
  let top: Vec3 | null = null;
  let bot: Vec3 | null = null;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3];
    const y = P[i * 3 + 1];
    const z = P[i * 3 + 2];
    if (Math.hypot(x - axisX, z - axisZ) < outer) continue;
    if (!top || y > top[1]) top = [x, y, z];
    if (!bot || y < bot[1]) bot = [x, y, z];
  }
  if (!top || !bot || top[1] - bot[1] < height * 0.75) return null;
  const d: Vec3 = [top[0] - bot[0], top[1] - bot[1], top[2] - bot[2]];
  const L = Math.hypot(d[0], d[1], d[2]) || 1;
  return {
    origin: [(top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2, (top[2] + bot[2]) / 2],
    dir: [d[0] / L, d[1] / L, d[2] / L],
  };
}

function findStaff(
  P: Float32Array,
  n: number,
  minY: number,
  height: number,
  bodyH: number,
  axisX: number,
  axisZ: number,
): StaffInfo | null {
  const cell = bodyH * 0.05;
  interface Cell { c: number; lo: number; hi: number; x: number; z: number }
  const cells = new Map<string, Cell>();
  for (let i = 0; i < n; i++) {
    const x = P[i * 3];
    const y = P[i * 3 + 1];
    const z = P[i * 3 + 2];
    const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    let g = cells.get(key);
    if (!g) {
      g = { c: 0, lo: Infinity, hi: -Infinity, x: 0, z: 0 };
      cells.set(key, g);
    }
    g.c++;
    g.x += x;
    g.z += z;
    if (y < g.lo) g.lo = y;
    if (y > g.hi) g.hi = y;
  }

  /*
   * 봉은 **발끝부터 머리 위까지** 이어진다 — 이 조건이 핵심이다.
   * 처음엔 "키의 60% 이상"으로 잡았더니 늘어뜨린 장삼 자락(키의 82%, 몸통축에서
   * 0.203)이 봉(1.00, 0.181)보다 더 멀어서 그쪽이 뽑혔다. 그러면 옷자락이 손에
   * 묶이고 진짜 봉은 팔 뼈에 붙어, 걸을 때 봉과 옷자락이 따로 흔들린다.
   */
  const tall = [...cells.values()]
    .filter((g) => g.c >= 6 && (g.hi - g.lo) >= height * 0.9)
    .map((g) => {
      const cx = g.x / g.c;
      const cz = g.z / g.c;
      return { ...g, cx, cz, dist: Math.hypot(cx - axisX, cz - axisZ) };
    })
    .sort((a, b) => b.dist - a.dist);

  const seed = tall[0];
  // 몸통에서 충분히 떨어져 있어야 봉이다. 가까우면 그냥 몸통 기둥이다.
  const seedOk = seed !== undefined && seed.dist >= bodyH * 0.10;

  let cx: number;
  let cz: number;
  let r: number;
  /** 씨앗 축 — 격자로 잡았으면 수직에서 시작하고, 기운 봉이면 그 기울기에서 시작한다 */
  let seedOrigin: Vec3;
  let seedDir: Vec3;

  if (seedOk) {
    // 씨앗 셀 주변만 모은다 — 반대쪽 팔이나 옷자락이 딸려오지 않게
    const near = tall.filter((g) => Math.hypot(g.cx - seed.cx, g.cz - seed.cz) <= cell * 1.6);
    let sx = 0;
    let sz = 0;
    let sc = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const g of near) {
      sx += g.cx * g.c;
      sz += g.cz * g.c;
      sc += g.c;
      if (g.lo < lo) lo = g.lo;
      if (g.hi > hi) hi = g.hi;
    }
    cx = sx / sc;
    cz = sz / sc;
    let spread = 0;
    for (const g of near) spread = Math.max(spread, Math.hypot(g.cx - cx, g.cz - cz));
    r = spread + cell * 0.9;
    seedOrigin = [cx, (lo + hi) / 2, cz];
    seedDir = [0, 1, 0];
  } else {
    // 격자가 못 잡았다 — 기울어진 봉일 수 있다.
    const tilted = tiltedStaffSeed(P, n, height, bodyH, axisX, axisZ);
    if (!tilted) return null;
    seedOrigin = tilted.origin;
    seedDir = tilted.dir;
    cx = tilted.origin[0];
    cz = tilted.origin[2];
    // 반경은 아래에서 bodyH*0.07 로 묶인다. 여기서는 그 상한을 그대로 쓴다.
    r = bodyH * 0.07;
  }

  /*
   * 축 맞추기 — 대략의 기둥 안 정점들로 주성분(가장 길게 퍼진 방향)을 찾는다.
   * 봉은 가늘고 길어서 이 방향이 곧 봉의 축이다. 두 번 반복하면
   * 처음에 놓친 아래끝까지 들어와 축이 안정된다.
   */
  let origin: Vec3 = seedOrigin;
  let dir: Vec3 = seedDir;
  /*
   * 반경은 고정한다. 반복할 때마다 실제 분포에서 다시 재게 했더니 손·소매가
   * 섞이면서 점점 커져 몸통까지 삼켰다(정점 991개 = 모델의 절반).
   * 봉은 가늘다 — 몸 높이의 7%면 쥔 손가락까지만 들어온다.
   */
  const radius = Math.min(bodyH * 0.07, r);
  for (let pass = 0; pass < 3; pass++) {
    const pick: number[] = [];
    for (let i = 0; i < n; i++) {
      const p: Vec3 = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
      // 첫 판은 기울어진 끝을 놓치지 않게 넉넉히, 다음부터는 축에 바짝 붙여 고른다
      if (alongAxis(p, origin, dir).d <= radius * (pass === 0 ? 1.9 : 1.15)) pick.push(i);
    }
    if (pick.length < 12) break;

    let mx = 0, my = 0, mz = 0;
    for (const i of pick) {
      mx += P[i * 3];
      my += P[i * 3 + 1];
      mz += P[i * 3 + 2];
    }
    origin = [mx / pick.length, my / pick.length, mz / pick.length];

    // 공분산의 최대 고유벡터를 거듭제곱법으로 찾는다 (3x3 이라 몇 번이면 수렴한다)
    const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const i of pick) {
      const v = [P[i * 3] - origin[0], P[i * 3 + 1] - origin[1], P[i * 3 + 2] - origin[2]];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) c[a * 3 + b] += v[a] * v[b];
    }
    let e: Vec3 = dir;
    for (let it = 0; it < 24; it++) {
      const nx = c[0] * e[0] + c[1] * e[1] + c[2] * e[2];
      const ny = c[3] * e[0] + c[4] * e[1] + c[5] * e[2];
      const nz = c[6] * e[0] + c[7] * e[1] + c[8] * e[2];
      const len = Math.hypot(nx, ny, nz) || 1;
      e = [nx / len, ny / len, nz / len];
    }
    dir = e[1] < 0 ? [-e[0], -e[1], -e[2]] : e; // 항상 위쪽을 향하게
  }

  /*
   * 축이 정해졌으니 **봉의 실제 굵기**를 재서 반경을 좁힌다.
   *
   * 위의 radius 는 축을 찾기 위한 넉넉한 탐색 반경이다. 그걸 그대로 가중치에
   * 쓰면 캡슐이 봉 주변의 살·갑주 자락까지 통째로 삼킨다 — 그러면 자락 절반은
   * 봉을 따라가고 나머지 절반은 다리를 따라가서, 그 경계의 삼각형이 걸음마다
   * 판때기처럼 늘어난다(실측: 하북 창병의 창 캡슐 반경 0.115 에 정점 690개가
   * 0.00~0.115 전 구간에 고루 퍼져 있었다. 가는 창대라면 0.03 안쪽에 몰려야 한다).
   *
   * 굵기는 **손 위쪽 구간에서만** 잰다. 아래쪽은 몸에 붙어 있어 어디까지가 봉이고
   * 어디부터가 옷인지 구분할 수 없지만, 위쪽 자유 구간은 봉밖에 없다.
   */
  const poleR = ((): number => {
    const along: { t: number; d: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = alongAxis([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], origin, dir);
      if (a.d <= radius) along.push(a);
    }
    if (along.length < 24) return radius;
    let lo = Infinity;
    let hi = -Infinity;
    for (const a of along) {
      if (a.t < lo) lo = a.t;
      if (a.t > hi) hi = a.t;
    }
    /*
     * 재는 구간은 **손 위쪽 대의 중간**이다 (축 범위의 60~90%).
     *   - 손 근처를 넣으면 손·소매가 섞여 굵어진다
     *   - 맨 끝을 넣으면 창날과 술이 섞여 굵어진다
     * 그리고 **중앙값**을 쓴다. 백분위수는 이 구간에도 조금씩 끼어드는 팔·소매에
     * 그대로 끌려간다(실측: 95퍼센타일로 재니 0.115 로 되레 커졌다).
     * 중앙값은 대의 정점이 다수라 대의 굵기를 가리킨다.
     */
    const a1 = lo + (hi - lo) * 0.6;
    const a2 = lo + (hi - lo) * 0.9;
    const ds = along.filter((a) => a.t >= a1 && a.t <= a2).map((a) => a.d).sort((x, y) => x - y);
    if (ds.length < 12) return radius;
    const med = ds[ds.length >> 1];
    return Math.min(radius, Math.max(bodyH * 0.012, med * 1.5));
  })();

  // 축 방향 범위
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = alongAxis([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], origin, dir);
    if (a.d > poleR) continue;
    if (a.t < tMin) tMin = a.t;
    if (a.t > tMax) tMax = a.t;
  }
  if (!isFinite(tMin) || tMax - tMin < height * 0.5) return null;

  // 손 높이 = 봉 바로 바깥에 붙어 있는 몸쪽 정점들의 중앙값 Y.
  // 이게 회전 중심이 된다 — 어깨에서 돌리면 봉 아래끝이 땅을 파고든다.
  const hands: number[] = [];
  for (let i = 0; i < n; i++) {
    const p: Vec3 = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    const t = (p[1] - minY) / bodyH;
    if (t < 0.45 || t > 0.95) continue;
    const a = alongAxis(p, origin, dir);
    if (a.d > poleR && a.d < poleR * 2.4 + radius * 0.6) hands.push(a.t);
  }
  hands.sort((a, b) => a - b);
  const gripT = hands.length > 0 ? hands[hands.length >> 1] : (minY + bodyH * 0.62 - origin[1]) / (dir[1] || 1);
  const at = (t: number): Vec3 => [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];

  return {
    grip: at(gripT),
    top: at(tMax),
    dir,
    // 손 위쪽은 넉넉히(창날·술까지), 아래쪽은 대의 굵기만
    r: radius,
    rLow: poleR,
    tMin: tMin - gripT,
    tMax: tMax - gripT,
  };
}

/**
 * 손에 든 칼날을 캡슐로 잡는다.
 *
 * 봉(findStaff)과 문제는 같지만 단서가 다르다. 봉은 바닥부터 머리 위까지 이어지는
 * 기둥이라 "키의 90%를 관통한다"로 찾을 수 있었다. 칼은 팔에서 각도를 꺾어 뻗기 때문에
 * 그 단서가 없다 — 대신 **몸통 축에서 가장 멀리 나간 정점**이 칼끝이라는 사실을 쓴다.
 *
 * 여기까지 오는 데 실패한 방법들:
 *   - 좌우 상체를 통째로 팔에 묶기: 갑주가 두꺼워 가슴 갑옷까지 팔을 따라 돌았다.
 *   - 연결 요소로 묶기: 감면이 표면을 86조각으로 쪼개 칼이 한 조각이 아니다.
 *   - 팔 뼈를 칼끝까지 늘리기: 내린 칼은 가슴보다 아래라 팔 덩어리에 안 들어온다.
 *     그 바람에 뼈가 투구 장식 쪽을 향했다.
 */
/**
 * 등에 진 부속 — 깃발·깃대·창통처럼 **몸통에 매달려 머리 위로 솟은 것**.
 *
 * 왜 따로 잡는가
 * -------------
 * 이런 부속은 어느 뼈에도 안 맞는다. 머리 뼈는 짧아서 반경 밖이고, 그러면 거리
 * 스키닝의 마지막 수단인 "가장 가까운 뼈"가 가져간다 — 관우의 깃발은 그렇게
 * **오른팔**에 통째로 붙었다(1,062정점). 내려치기 클립에서 반대 팔이 ±26도를
 * 도니까, 깃발이 어깨를 축으로 팔처럼 휘둘렸다.
 *
 * 깃발은 등에 묶인 것이다. 팔이 아니라 몸통을 따라가야 한다.
 *
 * 어떻게 잡는가
 * ------------
 * 머리 위 정점만 씨앗으로 삼아 주성분으로 축을 맞추고(깃대의 기울기), 그 축의
 * 캡슐을 가슴 높이까지 내려 늘린다. 내려오는 구간에서는 **몸통 굵기 밖**만
 * 받는다 — 안 그러면 등판 갑주까지 딸려와 몸통이 부속을 따라 도는 꼴이 된다.
 */
function findBackProp(
  P: Float32Array,
  n: number,
  axisX: number,
  axisZ: number,
  bodyTopY: number,
  chestY: number,
  bodyH: number,
  torsoRadius: number,
): BackProp | null {
  /*
   * 씨앗은 두 가지다.
   *   머리 위               깃천 본체. 몸이 거기까지 올라갈 일은 없다
   *   몸 뒤로 크게 벗어난 것  깃대 밑동과 뒤로 늘어진 갈래
   *
   * 두 번째가 없으면 아래로 처진 갈래를 놓친다 — 실측: 102정점이 양팔에 남아,
   * 내려칠 때 그것만 팔을 따라 휘둘렸다(천은 가만있고 갈래만 도는 꼴).
   *
   * 등 뒤 판정은 몸통 굵기를 넘는 뒤쪽으로 잡는다. 언월도를 쥔 손이 z -0.080 인데
   * 문턱은 그보다 더 뒤(-0.111)라 무기는 안 걸리고, 등판 갑주는 몸통 굵기 안이라
   * farOut 에서 걸러진다.
   */
  const behindZ = axisZ - torsoRadius * 1.1;
  const farOut = (i: number): boolean =>
    Math.hypot(P[i * 3] - axisX, P[i * 3 + 2] - axisZ) > torsoRadius * 1.15;
  const seeds: number[] = [];
  for (let i = 0; i < n; i++) {
    const y = P[i * 3 + 1];
    if (y > bodyTopY) { seeds.push(i); continue; }
    if (y > chestY && P[i * 3 + 2] < behindZ && farOut(i)) seeds.push(i);
  }
  if (seeds.length < 30) {
    console.log(`[rig] 등짐 없음: 씨앗 ${seeds.length}개 (몸통 굵기 ${torsoRadius.toFixed(3)})`);
    return null;
  }

  let cx = 0, cy = 0, cz = 0;
  for (const i of seeds) { cx += P[i * 3]; cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; }
  const origin: Vec3 = [cx / seeds.length, cy / seeds.length, cz / seeds.length];

  // 주성분 = 깃대 축. 멱반복으로 충분하다 (씨앗이 한 방향으로 길게 늘어서 있다)
  const cov = new Array<number>(9).fill(0);
  for (const i of seeds) {
    const v = [P[i * 3] - origin[0], P[i * 3 + 1] - origin[1], P[i * 3 + 2] - origin[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a * 3 + b] += v[a] * v[b];
  }
  let dir: Vec3 = [0, 1, 0];
  for (let it = 0; it < 48; it++) {
    const nx = cov[0] * dir[0] + cov[1] * dir[1] + cov[2] * dir[2];
    const ny = cov[3] * dir[0] + cov[4] * dir[1] + cov[5] * dir[2];
    const nz = cov[6] * dir[0] + cov[7] * dir[1] + cov[8] * dir[2];
    const L = Math.hypot(nx, ny, nz) || 1;
    dir = [nx / L, ny / L, nz / L];
  }
  if (dir[1] < 0) dir = [-dir[0], -dir[1], -dir[2]];

  /*
   * 캡슐로 잡지 않는다. 깃발은 봉이 아니라 **넓은 천**이라, 주성분이 세로가 아니라
   * 가로로 눕는다(실측: 관우의 깃천은 x 로 0.23 퍼지고 y 로는 0.05 밖에 안 된다).
   * 그 축으로 캡슐을 세우면 깃천만 잡히고 **깃대 아랫도리가 남아** 팔에 붙는다 —
   * 그러면 내려칠 때 천은 가만있고 대만 휘둘려 부속이 두 동강 난다.
   *
   * 대신 머리 위 정점에서 시작해 **가까운 이웃으로 번져 나간다.** 깃대는 천에서
   * 이어져 내려오므로 자연스럽게 딸려온다. 몸으로 새지 않게 두 가지로 막는다 —
   * 가슴보다 아래로는 안 가고, 몸통 굵기 안으로도 안 들어간다.
   */
  /*
   * 번지는 거리. 감면된 메시라 정점 간격이 고르지 않고, 깃발은 여러 갈래로 찢긴
   * 천이라 갈래끼리 떨어져 있다. 0.06 으로는 갈래 하나(66정점)를 놓쳐 그것만
   * 팔에 남았다 — 몸으로 새는 것은 inBody 가 막으므로 넉넉히 잡는 편이 낫다.
   */
  const grow = bodyH * 0.11;
  const inBody = (i: number): boolean => !farOut(i);
  const mask = new Uint8Array(n);
  let frontier: number[] = [];
  for (const i of seeds) { mask[i] = 1; frontier.push(i); }

  // 격자로 이웃을 찾는다 — 전수 비교는 정점 수의 제곱이라 못 쓴다
  const cell = grow;
  const key = (x: number, y: number, z: number): string =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    if (P[i * 3 + 1] < chestY) continue;
    const k = key(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    const cellList = grid.get(k);
    if (cellList) cellList.push(i); else grid.set(k, [i]);
  }
  for (let pass = 0; pass < 60 && frontier.length > 0; pass++) {
    const next: number[] = [];
    for (const i of frontier) {
      const bx = Math.floor(P[i * 3] / cell);
      const by = Math.floor(P[i * 3 + 1] / cell);
      const bz = Math.floor(P[i * 3 + 2] / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const j of grid.get(`${bx + dx},${by + dy},${bz + dz}`) ?? []) {
          if (mask[j]) continue;
          if (P[j * 3 + 1] <= bodyTopY && inBody(j)) continue;
          const d = Math.hypot(P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]);
          if (d > grow) continue;
          mask[j] = 1;
          next.push(j);
        }
      }
    }
    frontier = next;
  }

  let count = 0;
  let loY = Infinity;
  let hiY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    count++;
    if (P[i * 3 + 1] < loY) loY = P[i * 3 + 1];
    if (P[i * 3 + 1] > hiY) hiY = P[i * 3 + 1];
  }
  console.log(
    `[rig] 등짐: 씨앗 ${seeds.length} -> 정점 ${count}  y ${loY.toFixed(3)}~${hiY.toFixed(3)}` +
      `  몸통 굵기 ${torsoRadius.toFixed(3)}  등 뒤 문턱 z<${behindZ.toFixed(3)}`,
  );
  return { mask, head: [origin[0], loY, origin[2]], tail: [origin[0], hiY, origin[2]] };
}

function findBlade(
  P: Float32Array,
  n: number,
  sign: number,
  axisX: number,
  axisZ: number,
  minY: number,
  bodyH: number,
  headY: number,
  shoulder: Vec3,
  /** 이 높이 위는 칼이 아니다 (등에 진 깃발 같은 것). 기본은 제한 없음 */
  maxY = Infinity,
): StaffInfo | null {
  const label = sign < 0 ? '-X' : '+X';
  /**
   * 칼이 아닌 것 — 몸통 가까이(척추로 눕는 것을 막는다)와 **머리 위 좁은 원기둥**.
   * 투구 장식은 머리 위로 솟아 앞으로 굽으니 머리 뼈(짧은 수직선)에서는 멀고
   * 팔 쪽에서는 가깝다. 그대로 두면 팔에 묶여, 휘두를 때 투구가 검은 판때기로 늘어난다.
   */
  const isBlade = (i: number): boolean => {
    const dx = P[i * 3] - axisX;
    const dz = P[i * 3 + 2] - axisZ;
    const r = Math.hypot(dx, dz);
    if (P[i * 3 + 1] > maxY) return false;
    if (P[i * 3 + 1] > headY && r < bodyH * 0.25) return false;
    return r > bodyH * 0.17 && Math.sign(dx) === sign;
  };

  let seed = -1;
  let seedD = 0;
  for (let i = 0; i < n; i++) {
    if (!isBlade(i)) continue;
    const d = Math.hypot(P[i * 3] - axisX, P[i * 3 + 2] - axisZ);
    if (d > seedD) {
      seedD = d;
      seed = i;
    }
  }
  if (seed < 0 || seedD < bodyH * 0.25) {
    console.log(`[rig] ${label} 칼날 없음: 칼끝 후보 거리 ${seedD.toFixed(3)}`);
    return null;
  }

  const radius = bodyH * 0.07;
  const tip: Vec3 = [P[seed * 3], P[seed * 3 + 1], P[seed * 3 + 2]];

  const fitFrom = (dir0: Vec3): { origin: Vec3; dir: Vec3; tMin: number; tMax: number } | null => {
    let origin: Vec3 = tip;
    let dir = dir0;
    for (let pass = 0; pass < 3; pass++) {
      const pick: number[] = [];
      for (let i = 0; i < n; i++) {
        if (!isBlade(i)) continue;
        const a = alongAxis([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], origin, dir);
        // 처음부터 축에 바짝 붙여 고른다. 넓게 훑으면 어깨갑옷이 딸려와 축이 눕는다.
        if (a.d > radius * (pass === 0 ? 1.6 : 1.2)) continue;
        pick.push(i);
      }
      if (pick.length < 10) return null;

      let mx = 0, my = 0, mz = 0;
      for (const i of pick) {
        mx += P[i * 3];
        my += P[i * 3 + 1];
        mz += P[i * 3 + 2];
      }
      origin = [mx / pick.length, my / pick.length, mz / pick.length];

      const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (const i of pick) {
        const v = [P[i * 3] - origin[0], P[i * 3 + 1] - origin[1], P[i * 3 + 2] - origin[2]];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) c[a * 3 + b] += v[a] * v[b];
      }
      let e: Vec3 = dir;
      for (let it = 0; it < 24; it++) {
        const nx = c[0] * e[0] + c[1] * e[1] + c[2] * e[2];
        const ny = c[3] * e[0] + c[4] * e[1] + c[5] * e[2];
        const nz = c[6] * e[0] + c[7] * e[1] + c[8] * e[2];
        const len = Math.hypot(nx, ny, nz) || 1;
        e = [nx / len, ny / len, nz / len];
      }
      dir = e;
    }

    /*
     * 길이는 칼끝에서 몸 쪽으로 걸어 들어가며 잰다.
     * 축을 따라 얇게 썰면 칼 구간은 단면 정점이 몇 개뿐이고 몸에 닿는 순간 불어난다.
     * 거기서 멈춘다 — 몸통까지 재면 캡슐이 상체를 삼키고, 몸통을 아예 빼고 재면
     * 몸을 가로질러 든 칼이 배 앞에서 잘려 휘두를 때 늘어난다.
     */
    const slice = radius;
    const bins = new Map<number, number>();
    let tipT = -Infinity;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const a = alongAxis([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], origin, dir);
      if (a.d > radius) continue;
      total++;
      const b = Math.round(a.t / slice);
      bins.set(b, (bins.get(b) ?? 0) + 1);
      if (isBlade(i) && a.t > tipT) tipT = a.t;
    }
    if (total < 20 || !isFinite(tipT)) return null;

    const tipBin = Math.round(tipT / slice);
    const thin: number[] = [];
    for (const [b, c] of bins) if (b > tipBin - 6 && b <= tipBin) thin.push(c);
    thin.sort((a, b) => a - b);
    const rodCount = Math.max(2, thin[Math.floor(thin.length / 2)] ?? 2);

    let tMin = tipT;
    let gap = 0;
    for (let b = tipBin - 1; b > tipBin - 200; b--) {
      const c = bins.get(b) ?? 0;
      if (c === 0) {
        if (++gap >= 2) break;
        continue;
      }
      if (c > rodCount * 3) break; // 여기서부터는 칼이 아니라 몸이다
      gap = 0;
      tMin = b * slice;
    }
    return { origin, dir, tMin, tMax: tipT };
  };

  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  // 시작 방향을 여럿 시도해 가장 긴 캡슐을 고른다 — 칼은 가장 길고 가는 물건이다
  const seeds: Vec3[] = [
    norm([tip[0] - shoulder[0], tip[1] - shoulder[1], tip[2] - shoulder[2]]),
    norm([axisX - tip[0], 0, axisZ - tip[2]]),
    norm([axisX - tip[0], minY + bodyH * 0.7 - tip[1], axisZ - tip[2]]),
    [0, 1, 0],
  ];
  let best: { origin: Vec3; dir: Vec3; tMin: number; tMax: number } | null = null;
  for (const sd of seeds) {
    const r = fitFrom(sd);
    if (r && (!best || r.tMax - r.tMin > best.tMax - best.tMin)) best = r;
  }
  if (!best || best.tMax - best.tMin < bodyH * 0.3) {
    console.log(`[rig] ${label} 칼날 없음: 가장 긴 캡슐 ${best ? (best.tMax - best.tMin).toFixed(3) : '없음'}`);
    return null;
  }
  const { origin, dir, tMin, tMax } = best;
  const at = (t: number): Vec3 => [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
  // 칼날은 손 위아래를 나누지 않는다 — 봉처럼 바닥까지 내려가지 않아 몸과 겹칠 일이 없다.
  return { grip: at(tMin), top: at(tMax), dir, r: radius, rLow: radius, tMin: 0, tMax: tMax - tMin };
}

/**
 * 칼날 캡슐을 어느 손에서 찾을 것인가.
 *   none  안 찾는다
 *   one   **무기를 든 쪽 한 손만** — 한 손 무기(swing)
 *   both  양손 다 — 쌍칼(dual_swing)
 */
type BladeMode = 'none' | 'one' | 'both';

interface AnalyzeTweaks {
  /** 몸 높이를 손으로 준다 (bbox 비율). RigOptions.bodyTopRatio 참고 */
  bodyTopRatio?: number;
  /** 발 탐색 반경 (bodyH 비율). RigOptions.footRadius 참고 */
  footRadius?: number;
  /** 무기를 든 손. RigOptions.weaponSide 참고 */
  weaponSide?: 'L' | 'R';
  /** 등에 진 깃발을 찾아 몸통에 묶는다. RigOptions.backProp 참고 */
  backProp?: boolean;
  /** 몸통 축을 손으로 준다. RigOptions.bodyAxis 참고 */
  bodyAxis?: { x: number; z: number };
}

function analyze(
  P: Float32Array,
  n: number,
  detectStaff = false,
  bladeMode: BladeMode = 'none',
  bulky = false,
  tweak: AnalyzeTweaks = {},
): MeshStats {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = P[i * 3 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = maxY - minY;

  // 몸통 중심 — 허리 높이대(40~55%)의 XZ 중앙값.
  // 평균이 아니라 중앙값을 쓰는 이유는 창이 한쪽으로 길게 뻗어 평균을 끌기 때문이다.
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (P[i * 3 + 1] - minY) / height;
    if (t > 0.4 && t < 0.55) {
      xs.push(P[i * 3]);
      zs.push(P[i * 3 + 2]);
    }
  }
  const median = (a: number[]): number => {
    if (a.length === 0) return 0;
    a.sort((p, q) => p - q);
    return a[a.length >> 1];
  };
  let bodyX = median(xs);
  let bodyZ = median(zs);

  // 몸의 꼭대기 — Y 슬라이스별 정점 수가 최대치의 3% 밑으로 떨어지는 지점부터는
  // 창처럼 가느다란 부속뿐이다. 그 아래 마지막 지점을 머리 끝으로 본다.
  const BINS = 60;
  const bin = new Array<number>(BINS).fill(0);
  for (let i = 0; i < n; i++) {
    const b = Math.min(BINS - 1, Math.floor(((P[i * 3 + 1] - minY) / height) * BINS));
    bin[b]++;
  }
  const peak = Math.max(...bin);
  let topBin = BINS - 1;
  while (topBin > 0 && bin[topBin] < peak * 0.03) topBin--;
  const autoTopY = minY + ((topBin + 1) / BINS) * height;
  // 넓은 부속(깃발)은 3% 규칙으로 안 잘린다 — 그런 모델만 손으로 준다
  const bodyTopY = tweak.bodyTopRatio ? minY + height * tweak.bodyTopRatio : autoTopY;
  if (tweak.bodyTopRatio) {
    console.log(
      `[rig] 몸 높이를 지정받았다: 자동 ${((autoTopY - minY) / height * 100).toFixed(0)}% -> ` +
        `${(tweak.bodyTopRatio * 100).toFixed(0)}% (머리 위 부속을 몸으로 세지 않는다)`,
    );
  }
  const bodyH0 = bodyTopY - minY;

  /*
   * 몸통 축 보정 — 머리로 다시 잰다.
   *
   * 허리 대역의 중앙값은 몸이 대칭일 때만 몸통 축이다. 원소처럼 넓게 벌린 런지 자세에
   * 갑주 자락이 한쪽으로 퍼지고 칼 든 팔이 그 높이를 가로지르면 중앙값이 통째로 끌려간다
   * (실측: 진짜 축은 x≈0.05 인데 허리 중앙값은 0.162 — 몸 높이의 11% 어긋났다).
   * 그러면 머리 뼈가 머리 밖에 놓여 정점 2개만 잡는다.
   *
   * 머리에는 무기도 옷자락도 없다. 그래서 어긋남이 클 때만 머리 대역으로 갈아탄다.
   * 대칭인 모델은 두 값이 거의 같아 아무것도 바뀌지 않는다.
   */
  const headXs: number[] = [];
  const headZs: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (P[i * 3 + 1] - minY) / bodyH0;
    if (t > 0.78 && t < 0.94) {
      headXs.push(P[i * 3]);
      headZs.push(P[i * 3 + 2]);
    }
  }
  if (tweak.bodyAxis) {
    console.log(
      `[rig] 몸통 축을 지정받았다: 자동 (${bodyX.toFixed(3)}, ${bodyZ.toFixed(3)}) -> ` +
        `(${tweak.bodyAxis.x.toFixed(3)}, ${tweak.bodyAxis.z.toFixed(3)})`,
    );
    bodyX = tweak.bodyAxis.x;
    bodyZ = tweak.bodyAxis.z;
  } else if (bulky && headXs.length >= 20) {
    const hx = median(headXs);
    const hz = median(headZs);
    if (Math.hypot(hx - bodyX, hz - bodyZ) > bodyH0 * 0.06) {
      console.log(
        `[rig] 몸통 축 보정: 허리 (${bodyX.toFixed(3)}, ${bodyZ.toFixed(3)}) -> 머리 (${hx.toFixed(3)}, ${hz.toFixed(3)})`,
      );
      bodyX = hx;
      bodyZ = hz;
    }
  }

  // 발 — 하단 20% 를 XZ 2-means 로 나눈다 (결정론: 시작점을 X 최소/최대로 고정)
  const low: number[] = [];
  // 바닥까지 닿는 무기가 발로 잡히지 않도록, 켠 모델만 축에서 가까운 것으로 좁힌다
  const footR = tweak.footRadius ? tweak.footRadius * bodyH0 : Infinity;
  for (let i = 0; i < n; i++) {
    if ((P[i * 3 + 1] - minY) / height >= 0.2) continue;
    if (Math.hypot(P[i * 3] - bodyX, P[i * 3 + 2] - bodyZ) > footR) continue;
    low.push(i);
  }
  if (tweak.footRadius) console.log(`[rig] 발 탐색 반경 ${footR.toFixed(3)} — 하단 정점 ${low.length}개만 본다`);
  let cA: [number, number] = [Infinity, 0];
  let cB: [number, number] = [-Infinity, 0];
  for (const i of low) {
    if (P[i * 3] < cA[0]) cA = [P[i * 3], P[i * 3 + 2]];
    if (P[i * 3] > cB[0]) cB = [P[i * 3], P[i * 3 + 2]];
  }
  for (let iter = 0; iter < 40; iter++) {
    let ax = 0, az = 0, an = 0, bx = 0, bz = 0, bn = 0;
    for (const i of low) {
      const x = P[i * 3];
      const z = P[i * 3 + 2];
      const dA = (x - cA[0]) ** 2 + (z - cA[1]) ** 2;
      const dB = (x - cB[0]) ** 2 + (z - cB[1]) ** 2;
      if (dA < dB) { ax += x; az += z; an++; } else { bx += x; bz += z; bn++; }
    }
    if (an) cA = [ax / an, az / an];
    if (bn) cB = [bx / bn, bz / bn];
  }
  /*
   * 두 발 무리의 크기가 크게 다르면 한쪽은 발이 아니다.
   *
   * 방패병이 그랬다 — 방패 아래 모서리 4정점이 한 군집을 붙들어서, 진짜 두
   * 발이 반대쪽 군집 하나에 몰렸다. 그러면 다리 뼈 하나가 두 다리를 다 들고
   * 걷기에서 **두 발이 같은 위상으로 함께 흔들린다.** 로그도 클립도 멀쩡해
   * 보이므로, 굽는 자리에서 이 한 줄이 없으면 화면을 봐야만 안다.
   */
  {
    let an = 0;
    let bn = 0;
    for (const i of low) {
      const dA = (P[i * 3] - cA[0]) ** 2 + (P[i * 3 + 2] - cA[1]) ** 2;
      const dB = (P[i * 3] - cB[0]) ** 2 + (P[i * 3 + 2] - cB[1]) ** 2;
      if (dA < dB) an++; else bn++;
    }
    const weak = Math.min(an, bn);
    const strong = Math.max(an, bn) || 1;
    if (weak / strong < 0.3) {
      console.warn(
        `[rig] ⚠ 두 발 무리가 ${an}:${bn} 로 심하게 기울었다 — 한쪽이 발이 아닐 수 있다` +
          ` (방패·무기 끝이 발 대역에 들어온 경우다). footRadius 로 좁혀 보라.`,
      );
    }
  }
  // 팔·창 — 가슴 높이 위에서 몸통 축으로부터 멀리 떨어진 정점들의 평균.
  // 창이 한쪽으로 길게 뻗어 있어 이 평균이 곧 "팔이 향한 쪽"이 된다.
  const bodyH = bodyTopY - minY;
  const axisX = bodyX;
  const axisZ = bodyZ;
  const chestY = minY + bodyH * 0.66;
  const far = bodyH * 0.16;

  // 몸통 굵기 — 가슴 대역 정점이 축에서 얼마나 떨어져 있는지의 중앙값
  const torsoDs: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (P[i * 3 + 1] - minY) / bodyH;
    if (t < 0.52 || t > 0.78) continue;
    torsoDs.push(Math.hypot(P[i * 3] - axisX, P[i * 3 + 2] - axisZ));
  }
  const torsoRadius = torsoDs.length > 0 ? median(torsoDs) : bodyH * 0.12;

  /*
   * 등짐은 팔을 재기 **전에** 찾아 빼낸다.
   *
   * 나중에 찾으면 늦다. 깃대 밑동이 어깨 옆을 지나므로 팔 무리에 섞이고,
   * "어깨에서 가장 먼 5%" 로 팔 축을 잡는 axisOf 가 그 밑동을 팔 끝으로 본다 —
   * 실측: 관우의 오른팔 뼈가 등 뒤 위쪽(0.076, 0.250, -0.296)을 가리켰다.
   * 팔은 앞에 있는데 뼈는 뒤를 보므로, 그 뼈를 돌리면 팔이 엉뚱하게 돈다.
   */
  const backProp = tweak.backProp
    ? findBackProp(P, n, axisX, axisZ, bodyTopY, chestY, bodyH, torsoRadius)
    : null;

  /*
   * 팔은 머리 위에 없다.
   *
   * bodyTopRatio 를 준 모델은 "머리 위에 몸이 아닌 것이 있다"고 말한 것이다.
   * 그 위를 팔 후보로 두면 부속이 팔 중심을 통째로 끌어간다 — 관우의 깃발이
   * 오른팔 축을 등 뒤 위쪽으로 눕혀서, 언월도 대신 깃대가 무기로 잡혔다.
   * 지정하지 않은 모델은 지금까지와 똑같이 위쪽 제한 없이 본다.
   */
  const armTopY = tweak.bodyTopRatio ? bodyTopY : Infinity;
  /** 등짐 정점은 팔이 아니다 — 중심에서도 축 맞추기에서도 뺀다 */
  const propMask = backProp?.mask;
  let ax = 0, ay = 0, az = 0, ac = 0;
  for (let i = 0; i < n; i++) {
    const y = P[i * 3 + 1];
    if (y < chestY || y > armTopY) continue;
    if (propMask?.[i]) continue;
    const dx = P[i * 3] - axisX;
    const dz = P[i * 3 + 2] - axisZ;
    if (Math.hypot(dx, dz) < far) continue;
    ax += P[i * 3];
    ay += y;
    az += P[i * 3 + 2];
    ac++;
  }
  const armCenter: Vec3 = ac > 0 ? [ax / ac, ay / ac, az / ac] : [axisX, chestY, axisZ];

  // 좌우로 나눈 팔 중심 — 한 손 무기를 든 유닛은 팔을 따로 움직일 수 있다
  const side = (sign: number): { center: Vec3; members: number[] } => {
    let sx = 0, sy = 0, sz = 0;
    const members: number[] = [];
    for (let i = 0; i < n; i++) {
      const y = P[i * 3 + 1];
      if (y < chestY || y > armTopY) continue;
      if (propMask?.[i]) continue;
      const dx = P[i * 3] - axisX;
      const dz = P[i * 3 + 2] - axisZ;
      if (Math.hypot(dx, dz) < far) continue;
      if (Math.sign(dx) !== sign) continue;
      sx += P[i * 3];
      sy += y;
      sz += P[i * 3 + 2];
      members.push(i);
    }
    const c = members.length;
    return {
      center: c > 0 ? [sx / c, sy / c, sz / c] : [axisX + sign * far, chestY, axisZ],
      members,
    };
  };

  /**
   * 팔 뼈가 향할 곳 — 어깨에서 **칼끝**까지.
   *
   * 칼을 따로 찾아 묶는 방법(캡슐)은 이 모델에서 번번이 빗나갔다. 칼날이 가늘어
   * 정점이 적고, 감면이 표면을 86조각으로 쪼개 놔서 연결로도 못 묶는다.
   * 캡슐이 조금만 어긋나면 투구 장식을 물어 팔을 휘두를 때 검은 판때기로 늘어났다.
   *
   * 그래서 칼을 따로 잡지 않는다. 대신 **팔 뼈를 칼끝까지 뻗어** 칼날이 자연스럽게
   * 그 뼈에 가장 가깝게 만든다. 방향은 어깨에서 가장 먼 5% 정점들의 평균 방향 —
   * 한 점만 쓰면 튄 정점 하나에 뼈가 끌려간다.
   */
  const axisOf = (shoulder: Vec3, members: number[]): { head: Vec3; tail: Vec3 } | null => {
    if (members.length < 30) return null;
    const withD = members
      .map((i) => ({
        i,
        d: Math.hypot(P[i * 3] - shoulder[0], P[i * 3 + 1] - shoulder[1], P[i * 3 + 2] - shoulder[2]),
      }))
      .sort((a, b) => b.d - a.d);
    const top = withD.slice(0, Math.max(3, Math.floor(withD.length * 0.05)));
    let dx = 0, dy = 0, dz = 0;
    for (const t of top) {
      dx += P[t.i * 3] - shoulder[0];
      dy += P[t.i * 3 + 1] - shoulder[1];
      dz += P[t.i * 3 + 2] - shoulder[2];
    }
    const len = Math.hypot(dx, dy, dz) || 1;
    const dir: Vec3 = [dx / len, dy / len, dz / len];
    const reach = top[Math.floor(top.length / 2)].d;
    return {
      head: shoulder,
      tail: [shoulder[0] + dir[0] * reach, shoulder[1] + dir[1] * reach, shoulder[2] + dir[2] * reach],
    };
  };

  const sideL = side(-1);
  const sideR = side(1);
  const armCenterL = sideL.center;
  const armCenterR = sideR.center;
  // 어깨 위치는 buildSkeleton 과 같은 규칙으로 다시 만든다 (뻗침을 재려면 시작점이 필요하다)
  const shoulderY = minY + bodyH * 0.86 - bodyH * 0.05;
  const shoulderOff = bodyH * 0.12;
  const armAxisL = axisOf([axisX - shoulderOff, shoulderY, axisZ], sideL.members);
  const armAxisR = axisOf([axisX + shoulderOff, shoulderY, axisZ], sideR.members);
  // 무기(몽둥이)는 몸에서 멀리 뻗어 있으므로 그쪽 중심이 축에서 더 멀다
  const reach = (c: Vec3): number => Math.hypot(c[0] - axisX, c[2] - axisZ);
  const autoSide: 'L' | 'R' = reach(armCenterL) >= reach(armCenterR) ? 'L' : 'R';
  /*
   * "더 멀리 뻗은 쪽이 무기 손"은 무기 말고 아무것도 안 뻗었을 때만 맞다.
   * 등에 깃발을 지거나 망토를 늘어뜨린 모델은 그쪽이 이긴다. 그럴 때만 손으로 준다.
   */
  const weaponSide: 'L' | 'R' = tweak.weaponSide ?? autoSide;
  if (tweak.weaponSide && tweak.weaponSide !== autoSide) {
    console.log(`[rig] 무기 손을 지정받았다: 자동 ${autoSide} -> ${tweak.weaponSide}`);
  }

  const staff = detectStaff ? findStaff(P, n, minY, height, bodyH, axisX, axisZ) : null;
  const headY = minY + bodyH * 0.86;
  /*
   * 한 손 무기(one)는 **빈 손 쪽에서 칼날을 찾지 않는다.**
   *
   * findBlade 는 "몸통 축에서 가장 먼 점"으로 축을 맞추므로, 아무것도 안 든 손
   * 쪽에서는 팔·갑주 자락·장화가 세로로 늘어선 줄을 칼날로 잡아 버린다. 그걸 팔
   * 뼈에 통째로 묶으면 팔을 들 때 허벅지가 따라 올라간다.
   *
   * 실측(장각): 칼을 든 왼손은 길이 0.855 짜리 대도가 제대로 잡혔지만, 빈
   * 오른손에서도 0.451 짜리가 잡혀 오른 허벅지 정점 90개를 팔 뼈로 끌어갔다.
   * 무기 하나짜리 모델은 무기가 있는 쪽만 본다.
   */
  const wantL = bladeMode === 'both' || (bladeMode === 'one' && weaponSide === 'L');
  const wantR = bladeMode === 'both' || (bladeMode === 'one' && weaponSide === 'R');
  // 칼도 머리 위 부속을 물면 안 된다 — 팔과 같은 상한을 쓴다
  const bladeL = wantL
    ? findBlade(P, n, -1, axisX, axisZ, minY, bodyH, headY, [axisX - shoulderOff, shoulderY, axisZ], armTopY)
    : null;
  const bladeR = wantR
    ? findBlade(P, n, 1, axisX, axisZ, minY, bodyH, headY, [axisX + shoulderOff, shoulderY, axisZ], armTopY)
    : null;

  return {
    minY,
    maxY,
    height,
    bodyTopY,
    bodyX,
    bodyZ,
    legA: cA,
    legB: cB,
    armCenter,
    armCenterL,
    armCenterR,
    armAxisL,
    armAxisR,
    chestY,
    armFar: far,
    torsoRadius,
    weaponSide,
    staff,
    backProp,
    bladeL,
    bladeR,
  };
}

// ── 말 탄 기병 ────────────────────────────────────────────────────────

/** 다리 하나의 발 위치(XZ)와 그 다리가 실제로 차지한 Y 범위 */
interface FootInfo {
  x: number;
  z: number;
  /** 이 다리 무리의 가장 낮은 점 — 굽은 앞다리는 땅에 닿지 않는다 */
  bottomY: number;
}

export interface MountStats {
  minY: number;
  bodyTopY: number;
  height: number;
  feet: { frontL: FootInfo; frontR: FootInfo; backL: FootInfo; backR: FootInfo };
  /** 말 몸통 중심 */
  body: Vec3;
  /** 목·머리가 향하는 앞쪽 위 지점 */
  neck: Vec3;
  /** 안장 위 기수의 몸통 */
  rider: Vec3;
  /** 기수의 팔·무기 덩어리 중심 */
  riderArm: Vec3;
  /** 기수 어깨 좌우 */
  shoulderL: Vec3;
  shoulderR: Vec3;
}

/**
 * 말 탄 기병의 형상을 읽는다.
 *
 * 다리 넷은 **앞뒤(Z)로 먼저 가르고 각각 좌우(X)로 가른다.**
 * 4-means 로 잡으면 자세에 휘둘린다 — 앞다리를 든 말(여포의 적토마)에서는
 * 바닥 근처에 뒷다리만 남아 클러스터 넷이 전부 뒷다리 쪽으로 몰렸다.
 * 앞뒤·좌우로 가르면 어떤 자세든 다리 하나씩 잡힌다.
 *
 * 말은 +Z 를 보고 선다고 본다(모델 규약). 그래서 Z 가 큰 쪽이 앞다리다.
 */
function analyzeMount(P: Float32Array, n: number, base: MeshStats): MountStats {
  const { minY, bodyTopY } = base;
  const height = bodyTopY - minY;
  const y = (t: number): number => minY + height * t;

  /** 주어진 인덱스들의 중심과 최저 Y */
  const centroidOf = (list: number[]): Vec3 & { length: 3 } => {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const i of list) {
      sx += P[i * 3];
      sy += P[i * 3 + 1];
      sz += P[i * 3 + 2];
    }
    const c = Math.max(1, list.length);
    return [sx / c, sy / c, sz / c];
  };

  // 몸통 중심 Z — 허리 높이대의 중앙값. 평균은 목과 꼬리에 끌린다.
  const zs: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (P[i * 3 + 1] - minY) / height;
    if (t > 0.35 && t < 0.6) zs.push(P[i * 3 + 2]);
  }
  zs.sort((a, b) => a - b);
  const bodyZ = zs.length > 0 ? zs[zs.length >> 1] : 0;

  // 다리 — 하단 35% 를 앞뒤로 가르고, 각 무리를 X 중앙값으로 다시 가른다
  const low: number[] = [];
  for (let i = 0; i < n; i++) if (P[i * 3 + 1] < y(0.35)) low.push(i);
  const splitX = (group: number[]): [number[], number[]] => {
    const xs = group.map((i) => P[i * 3]).sort((a, b) => a - b);
    const mid = xs.length > 0 ? xs[xs.length >> 1] : 0;
    return [group.filter((i) => P[i * 3] < mid), group.filter((i) => P[i * 3] >= mid)];
  };
  const frontAll = low.filter((i) => P[i * 3 + 2] >= bodyZ);
  const backAll = low.filter((i) => P[i * 3 + 2] < bodyZ);
  const [fl, fr] = splitX(frontAll);
  const [bl, br] = splitX(backAll);

  const foot = (list: number[]): FootInfo => {
    const c = centroidOf(list);
    let bottom = Infinity;
    for (const i of list) if (P[i * 3 + 1] < bottom) bottom = P[i * 3 + 1];
    return { x: c[0], z: c[2], bottomY: Number.isFinite(bottom) ? bottom : minY };
  };

  /** 지정한 Y·Z 범위 안 정점들의 중심 */
  const centroid = (y0: number, y1: number, z0: number, z1: number, fallback: Vec3): Vec3 => {
    const list: number[] = [];
    for (let i = 0; i < n; i++) {
      const yy = P[i * 3 + 1];
      const zz = P[i * 3 + 2];
      if (yy < y0 || yy > y1 || zz < z0 || zz > z1) continue;
      list.push(i);
    }
    return list.length > 0 ? centroidOf(list) : fallback;
  };

  const body = centroid(y(0.3), y(0.6), bodyZ - height * 0.3, bodyZ + height * 0.3, [0, y(0.45), bodyZ]);
  const neck = centroid(y(0.45), y(0.75), bodyZ + height * 0.2, Infinity, [body[0], y(0.6), bodyZ + height * 0.3]);
  const rider = centroid(y(0.62), y(0.92), bodyZ - height * 0.25, bodyZ + height * 0.25, [body[0], y(0.75), bodyZ]);

  // 기수의 팔·무기 — 몸통 축에서 멀리 떨어진 상체. 좌우로도 나눠 어깨를 잡는다.
  const armIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (P[i * 3 + 1] < y(0.6)) continue;
    const dx = P[i * 3] - rider[0];
    const dz = P[i * 3 + 2] - rider[2];
    if (Math.hypot(dx, dz) < height * 0.07) continue;
    armIdx.push(i);
  }
  const riderArm = armIdx.length > 0 ? centroidOf(armIdx) : ([rider[0], rider[1], rider[2] + height * 0.1] as Vec3);
  const shoulderY = rider[1] + height * 0.06;
  const shoulderOff = height * 0.055;
  const shoulderL: Vec3 = [rider[0] - shoulderOff, shoulderY, rider[2]];
  const shoulderR: Vec3 = [rider[0] + shoulderOff, shoulderY, rider[2]];

  return {
    minY,
    bodyTopY,
    height,
    feet: { frontL: foot(fl), frontR: foot(fr), backL: foot(bl), backR: foot(br) },
    body,
    neck,
    rider,
    riderArm,
    shoulderL,
    shoulderR,
  };
}

/**
 * 말 탄 기병의 뼈.
 *
 *   root ─ body ┬ neck
 *               ├ rider ┬ shoulderL / shoulderR   기수 어깨
 *               │       └ riderArm                기수 팔과 무기
 *               └ legXX ─ kneeXX ─ hoofXX         다리 넷, 각 3마디
 *
 * 다리를 3마디로 두는 이유는 말 다리가 무릎(앞)·비절(뒤)과 구절에서 두 번 꺾이기 때문이다.
 * 2마디로 두면 곧은 막대가 흔들리는 것처럼 보인다.
 *
 * 마디 위치는 그 다리 무리의 **실제 최저점**까지를 기준으로 나눈다.
 * 굽어 든 앞다리는 땅에 닿지 않으므로 바닥(minY)을 쓰면 뼈가 다리 밖으로 나간다.
 */
function buildMountSkeleton(m: MountStats): BoneSpec[] {
  const H = m.height;
  const y = (t: number): number => m.minY + H * t;
  const legR = H * 0.1;

  const leg = (name: string, f: FootInfo): BoneSpec[] => {
    const suffix = name.slice(3);
    const hipY = y(0.42);
    const hip: Vec3 = [
      m.body[0] + (f.x - m.body[0]) * 0.75,
      hipY,
      m.body[2] + (f.z - m.body[2]) * 0.9,
    ];
    const foot: Vec3 = [f.x, f.bottomY, f.z];
    /** 고관절에서 발까지 t 만큼 내려간 자리 */
    const at = (t: number): Vec3 => [
      hip[0] + (foot[0] - hip[0]) * t,
      hip[1] + (foot[1] - hip[1]) * t,
      hip[2] + (foot[2] - hip[2]) * t,
    ];
    const knee = at(0.45);
    const fetlock = at(0.78);
    return [
      { name, parent: 'body', head: hip, tail: knee, maxR: legR },
      { name: `knee${suffix}`, parent: name, head: knee, tail: fetlock, maxR: legR },
      { name: `hoof${suffix}`, parent: `knee${suffix}`, head: fetlock, tail: foot, maxR: legR * 0.9 },
    ];
  };

  return [
    { name: 'root', parent: null, head: [m.body[0], m.minY, m.body[2]], tail: [m.body[0], y(0.42), m.body[2]], maxR: 0 },
    { name: 'body', parent: 'root', head: m.body, tail: [m.body[0], m.body[1] + H * 0.1, m.body[2]], maxR: H * 0.3 },
    { name: 'neck', parent: 'body', head: [m.body[0], m.body[1] + H * 0.08, m.body[2] + H * 0.15], tail: m.neck, maxR: H * 0.16 },
    { name: 'rider', parent: 'body', head: [m.rider[0], m.body[1] + H * 0.12, m.rider[2]], tail: m.rider, maxR: H * 0.15 },
    { name: 'shoulderL', parent: 'rider', head: m.shoulderL, tail: [m.shoulderL[0] - H * 0.05, m.shoulderL[1] - H * 0.04, m.shoulderL[2]], maxR: H * 0.06 },
    { name: 'shoulderR', parent: 'rider', head: m.shoulderR, tail: [m.shoulderR[0] + H * 0.05, m.shoulderR[1] - H * 0.04, m.shoulderR[2]], maxR: H * 0.06 },
    { name: 'riderArm', parent: 'rider', head: [m.rider[0], m.rider[1] + H * 0.04, m.rider[2]], tail: m.riderArm, maxR: H * 0.2 },
    ...leg('legFL', m.feet.frontL),
    ...leg('legFR', m.feet.frontR),
    ...leg('legBL', m.feet.backL),
    ...leg('legBR', m.feet.backR),
  ];
}

/**
 * 갤럽과 무기 찌르기.
 *
 * 다리 넷은 같은 사인파를 위상만 달리해서 돌린다. 네 박자 갤럽의 위상은
 * 뒤 -> 뒤 -> 앞 -> 앞 순서라 뒷다리로 차고 앞다리로 받는 것처럼 보인다.
 *
 * 무릎과 구절은 **다리가 앞으로 나올 때만** 굽고, 구절은 무릎보다 조금 늦게 따라온다.
 * 뒤로 뻗은 다리를 굽히면 관절이 반대로 꺾여 보이고, 둘이 같이 굽으면 막대가 접히는 것처럼 보인다.
 */
export function buildMountClips(
  m: MountStats,
  swingAxis: Vec3,
  forward: Vec3,
  cadence: number,
  attackStyle: AttackStyle,
): ClipSpec[] {
  const H = m.height;
  const K = 12;
  const times = Array.from({ length: K + 1 }, (_, i) => (i / K) * cadence);
  const rotTrack = (bone: string, angles: number[], axis: Vec3, ts = times): Track => ({
    bone,
    path: 'rotation',
    times: ts,
    values: angles.flatMap((a) => quat(axis, a)),
  });
  /** 두 축을 합성한 회전 (b축 다음에 a축). 휘두르기는 한 축으로는 안 된다. */
  const rot2Track = (
    bone: string,
    a: number[],
    axisA: Vec3,
    b: number[],
    axisB: Vec3,
    ts: number[],
  ): Track => ({
    bone,
    path: 'rotation',
    times: ts,
    values: a.flatMap((v, i) => mulQuat(quat(axisA, v), quat(axisB, b[i]))),
  });
  const UP: Vec3 = [0, 1, 0];

  const swing = 0.5;
  const legPhase: Record<string, number> = { legBL: 0, legBR: 0.12, legFL: 0.5, legFR: 0.62 };
  const legTracks: Track[] = [];
  for (const [bone, phase] of Object.entries(legPhase)) {
    const suffix = bone.slice(3);
    const hip: number[] = [];
    const knee: number[] = [];
    const fetlock: number[] = [];
    for (let i = 0; i <= K; i++) {
      const t = i / K + phase;
      const w = Math.sin(t * Math.PI * 2);
      hip.push(w * swing);
      // 앞으로 나오는 반주기에만 굽힌다
      knee.push(-Math.max(0, w) * 0.75);
      // 구절은 무릎보다 15% 늦게, 얕게
      fetlock.push(-Math.max(0, Math.sin((t + 0.15) * Math.PI * 2)) * 0.4);
    }
    legTracks.push(rotTrack(bone, hip, swingAxis));
    legTracks.push(rotTrack(`knee${suffix}`, knee, swingAxis));
    legTracks.push(rotTrack(`hoof${suffix}`, fetlock, swingAxis));
  }

  // 몸통 상하 — 갤럽은 한 주기에 두 번 튄다
  const bob = H * 0.035;
  const bodyValues: number[] = [];
  for (let i = 0; i <= K; i++) bodyValues.push(0, Math.sin((i / K) * Math.PI * 4) * bob, 0);

  const gallop: ClipSpec = {
    name: 'walk',
    tracks: [
      ...legTracks,
      { bone: 'body', path: 'translation', times, values: bodyValues },
      rotTrack('body', Array.from({ length: K + 1 }, (_, i) => Math.sin((i / K) * Math.PI * 2) * 0.07), swingAxis),
      rotTrack('neck', Array.from({ length: K + 1 }, (_, i) => -Math.sin((i / K) * Math.PI * 2 + 0.6) * 0.12), swingAxis),
      // 기수는 안장 위에서 반동을 받는다. 어깨는 그보다 한 박자 늦게 흔들린다.
      rotTrack('rider', Array.from({ length: K + 1 }, (_, i) => -Math.sin((i / K) * Math.PI * 4) * 0.06), swingAxis),
      rotTrack('shoulderL', Array.from({ length: K + 1 }, (_, i) => Math.sin((i / K) * Math.PI * 4 + 0.5) * 0.07), swingAxis),
      rotTrack('shoulderR', Array.from({ length: K + 1 }, (_, i) => -Math.sin((i / K) * Math.PI * 4 + 0.5) * 0.07), swingAxis),
      rotTrack('riderArm', Array.from({ length: K + 1 }, (_, i) => Math.sin((i / K) * Math.PI * 4 + 1.0) * 0.06), swingAxis),
    ],
  };

  // 제자리 — 말이 숨쉬듯 오르내리고 고개를 끄덕인다
  const idleTimes = [0, 1.2, 2.4];
  const idle: ClipSpec = {
    name: 'idle',
    tracks: [
      { bone: 'body', path: 'translation', times: idleTimes, values: [0, 0, 0, 0, H * 0.008, 0, 0, 0, 0] },
      rotTrack('neck', [0, -0.05, 0], swingAxis, idleTimes),
    ],
  };

  const lunge = H * 0.05;
  const fwd = (k: number): number[] => [forward[0] * k, forward[1] * k, forward[2] * k];

  /*
   * 공격 — 말은 멈춰 서고 기수가 무기를 쓴다.
   *
   * 왜 두 가지가 필요한가
   * --------------------
   * 창기병은 창을 내지르면 되지만, 방천화극처럼 날이 옆으로 뻗은 무기는
   * 찌르기로 만들면 **머리로 들이받는 것처럼** 보인다. 앞으로 나가는 성분밖에
   * 없어서, 화면에서 읽히는 것은 무기가 아니라 앞으로 기운 몸통과 말 머리뿐이기
   * 때문이다(실측: 여포가 그렇게 보였다).
   *
   * 휘두르기는 그 반대로 만든다 — 몸통은 거의 앞으로 나가지 않고,
   * 팔이 위뒤로 크게 젖혔다가 앞아래로 **비스듬히 가로질러** 내려온다.
   * 그 가로 성분(yaw)이 있어야 "휘둘렀다"로 읽힌다.
   */
  const AT = [0, 0.25, 0.4, 0.75];
  let attack: ClipSpec;

  if (attackStyle === 'swing' || attackStyle === 'dual_swing') {
    /*
     * 방천화극 후려치기.
     *
     * 다섯 마디로 나눈다 — 네 마디로는 "들었다 내렸다"만 보이고 무게가 안 실린다.
     *   0.00 준비
     *   0.30 오른쪽 위로 크게 젖힌다 (팔 -1.05, 몸통이 반대로 비틀린다)
     *   0.42 정점에서 잠깐 멈춘다 — 이 정지가 다음 동작을 무겁게 만든다
     *   0.58 왼쪽 앞아래로 가로질러 내리친다 (팔 +1.25, 몸통이 따라 돈다)
     *   0.95 되돌아온다
     *
     * 어깨 둘은 같은 위상으로 움직인다. 방천화극은 양손 무기라 좌우를 어긋나게
     * 돌리면 한 손이 자루에서 떨어진다.
     *
     * 말 목(neck)은 건드리지 않는다. 찌르기에서 목을 흔든 것이 "들이받는다"로
     * 읽힌 원인이었다 — 말은 버티고 서 있고 움직이는 것은 기수여야 한다.
     */
    const ST = [0, 0.3, 0.42, 0.58, 0.95];
    /** 오른손잡이 기준. 오른쪽 위에서 왼쪽 아래로 쓸어내린다. */
    const yaw = -1;
    attack = {
      name: 'attack',
      tracks: [
        // 몸통은 거의 제자리다. 체중만 살짝 실어 준다 — 앞으로 나가면 다시 들이받는 그림이 된다.
        {
          bone: 'body',
          path: 'translation',
          times: ST,
          values: [...fwd(0), ...fwd(-lunge * 0.3), ...fwd(-lunge * 0.3), ...fwd(lunge * 0.45), ...fwd(0)],
        },
        // 기수 상체 — 젖힐 때 반대로 비틀었다가 내리칠 때 같이 돈다. 이게 "몸통으로 휘둘렀다"의 정체다.
        rot2Track(
          'rider',
          [0, -0.2, -0.24, 0.3, 0],
          swingAxis,
          [0, 0.34 * yaw, 0.4 * yaw, -0.46 * yaw, 0],
          UP,
          ST,
        ),
        // 어깨 — 팔만 돌면 자루가 어깨에서 떨어져 보인다. 좌우 같은 위상.
        rot2Track(
          'shoulderL',
          [0, -0.3, -0.36, 0.4, 0],
          swingAxis,
          [0, 0.16 * yaw, 0.2 * yaw, -0.24 * yaw, 0],
          UP,
          ST,
        ),
        rot2Track(
          'shoulderR',
          [0, -0.3, -0.36, 0.4, 0],
          swingAxis,
          [0, 0.16 * yaw, 0.2 * yaw, -0.24 * yaw, 0],
          UP,
          ST,
        ),
        // 팔과 무기 — 이 클립의 주인공. 위뒤로 젖혔다가 앞아래로 가로지른다.
        rot2Track(
          'riderArm',
          [0, -1.05, -1.15, 1.25, 0],
          swingAxis,
          [0, 0.55 * yaw, 0.62 * yaw, -0.7 * yaw, 0],
          UP,
          ST,
        ),
      ],
    };
  } else {
    /*
     * 찌르기 — 창기병.
     * 몸통은 조금만 숙이고(크게 주면 말 목 위로 엎어진다) 힘은 어깨와 팔이 낸다.
     * 어깨 둘은 같은 방향으로 밀어야 두 손으로 잡은 무기가 어긋나지 않는다.
     */
    attack = {
      name: 'attack',
      tracks: [
        { bone: 'body', path: 'translation', times: AT, values: [...fwd(0), ...fwd(-lunge * 0.5), ...fwd(lunge), ...fwd(0)] },
        rotTrack('rider', [0, -0.16, 0.26, 0], swingAxis, AT),
        rotTrack('shoulderL', [0, -0.2, 0.34, 0], swingAxis, AT),
        rotTrack('shoulderR', [0, -0.2, 0.34, 0], swingAxis, AT),
        rotTrack('riderArm', [0, -0.42, 0.7, 0], swingAxis, AT),
        rotTrack('neck', [0, 0.1, -0.15, 0], swingAxis, AT),
      ],
    };
  }

  return [idle, gallop, attack];
}

// ── 스키닝 ────────────────────────────────────────────────────────────

/**
 * 굵기를 가진 뼈까지의 거리.
 *
 * 굵기는 **옆으로만** 뺀다. 선분 끝을 지나 위아래로까지 빼 주면 가슴 뼈가 목 위의
 * 머리까지 삼킨다(실측: 머리 뼈가 정점 0개를 잡았다). 옆으로만 빼면 몸통 표면은
 * 가슴이, 머리는 머리가 가져간다.
 */
function distToBone(p: Vec3, a: Vec3, b: Vec3, coreR: number): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const apz = p[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  const t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  const clamped = Math.max(0, Math.min(1, t));
  // 축에 수직인 성분과, 선분 끝을 넘어간 성분을 나눠 잰다
  const px = apx - abx * clamped;
  const py = apy - aby * clamped;
  const pz = apz - abz * clamped;
  const perp = Math.hypot(px, py, pz);
  const over = (clamped - t) * Math.sqrt(len2);
  if (coreR <= 0) return perp;
  return Math.hypot(Math.max(0, perp - coreR), over);
}

/** 점에서 선분까지의 거리 */
function distToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / len2)) : 0;
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const MAX_INFLUENCES = 3;

/**
 * 뼈 선분까지의 거리로 가중치를 굽는다.
 *
 * maxR 안에 든 뼈만 후보가 되고, 그중 가까운 순으로 최대 3개를 1/d^3 비율로 섞는다.
 * 거리의 세제곱을 쓰는 이유는 경계를 또렷하게 만들기 위해서다 — 부드럽게 섞으면
 * 다리와 골반이 반반씩 나눠 가져서 다리를 돌려도 절반만 따라온다.
 *
 * 아무 뼈에도 안 잡히면 fallback 뼈(chest)가 통째로 가져간다.
 * 가중치 합이 0이면 그 정점은 원점으로 붕괴하므로 이 처리가 반드시 있어야 한다.
 */
function skinVertex(p: Vec3, bones: BoneSpec[], tails: Vec3[]): { joints: number[]; weights: number[] } {
  const inRange: { i: number; d: number }[] = [];
  let nearest = -1;
  let nearestD = Infinity;
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    if (b.maxR <= 0) continue; // root 는 가중치를 갖지 않는다
    const d = distToBone(p, b.head, tails[i], b.coreR ?? 0);
    if (d < nearestD) {
      nearestD = d;
      nearest = i;
    }
    if (d <= b.maxR) inRange.push({ i, d });
  }

  const joints = [0, 0, 0, 0];
  const weights = [0, 0, 0, 0];

  /*
   * 어느 뼈의 반경에도 안 들어온 정점은 **가장 가까운 뼈**가 가져간다.
   * 고정된 뼈 하나를 fallback 으로 두면 그 뼈가 상체 외투를 통째로 삼켜서
   * (실측 774정점) 팔을 조금만 돌려도 상체가 뒤틀렸다.
   * 가장 가까운 뼈로 보내면 외투는 몸통이, 창끝은 팔이 자연스럽게 가져간다.
   */
  if (inRange.length === 0) {
    joints[0] = nearest < 0 ? 0 : nearest;
    weights[0] = 1;
    return { joints, weights };
  }

  inRange.sort((a, b) => a.d - b.d);
  const picked = inRange.slice(0, MAX_INFLUENCES);
  let sum = 0;
  const w: number[] = [];
  for (const c of picked) {
    const inv = 1 / Math.pow(Math.max(c.d, 1e-5), 3);
    w.push(inv);
    sum += inv;
  }
  for (let k = 0; k < picked.length; k++) {
    joints[k] = picked[k].i;
    weights[k] = w[k] / sum;
  }
  return { joints, weights };
}

// ── 애니메이션 ────────────────────────────────────────────────────────

type Quat = [number, number, number, number];

/** 축-각 → 쿼터니언 */
function quat(axis: Vec3, angle: number): Quat {
  const l = Math.hypot(...axis) || 1;
  const s = Math.sin(angle / 2);
  return [(axis[0] / l) * s, (axis[1] / l) * s, (axis[2] / l) * s, Math.cos(angle / 2)];
}

/** a 다음에 b 를 적용한 회전 (b * a) */
function mulQuat(b: Quat, a: Quat): Quat {
  const [bx, by, bz, bw] = b;
  const [ax, ay, az, aw] = a;
  return [
    bw * ax + bx * aw + by * az - bz * ay,
    bw * ay - bx * az + by * aw + bz * ax,
    bw * az + bx * ay - by * ax + bz * aw,
    bw * aw - bx * ax - by * ay - bz * az,
  ];
}

export interface Track {
  bone: string;
  path: 'rotation' | 'translation';
  times: number[];
  /** rotation이면 4개씩, translation이면 3개씩 */
  values: number[];
}

export interface ClipSpec {
  name: string;
  tracks: Track[];
}

/**
 * 클립을 만든다.
 *
 * 바인드 포즈에서 다리가 벌어져 있으면(런지 자세) 다리만 앞뒤로 흔들 때
 * 걷는 게 아니라 벌린 채로 미끄러지는 것처럼 보인다. 그래서 걷기 클립은
 * **벌린 다리를 먼저 모으고(close) 그 위에 앞뒤 스윙을 얹는다.**
 *
 * swingAxis  진행 방향에 수직인 축 — 이 축으로 돌려야 다리·팔이 앞뒤로 간다
 * sideAxis   진행 방향 축 — 이 축으로 돌리면 다리가 좌우로 벌어지고 모인다
 */
function buildClips(
  m: MeshStats,
  swingAxis: Vec3,
  sideAxis: Vec3,
  forward: Vec3,
  opts: RigOptions,
): ClipSpec[] {
  const bodyH = m.bodyTopY - m.minY;
  const bob = bodyH * 0.022;
  const stride = opts.walkStride;
  const kneeBend = opts.kneeBend;
  const split = opts.armMode === 'split';
  const cadence = opts.cadence;

  // 벌어진 정도 — 두 발 간격을 다리 길이로 나눈 각도만큼 모아준다
  const spread = Math.abs(m.legA[0] - m.legB[0]);
  const legLen = bodyH * 0.5;
  const close = Math.min(0.28, Math.atan2(spread, legLen) * opts.legCloseFactor);

  const track = (bone: string, times: number[], values: number[], path: 'rotation' | 'translation' = 'rotation'): Track => ({
    bone,
    path,
    times,
    values,
  });

  /** 모으기(고정) + 스윙(시간에 따라) 을 합성한 회전 트랙 */
  const legTrack = (bone: string, times: number[], angles: number[], closeSign: number): Track =>
    track(
      bone,
      times,
      angles.flatMap((a) => mulQuat(quat(swingAxis, a), quat(sideAxis, close * closeSign))),
    );

  const rot = (bone: string, times: number[], angles: number[], axis: Vec3): Track =>
    track(bone, times, angles.flatMap((a) => quat(axis, a)));

  /** 두 축을 합성한 회전 (b축 각도 다음에 a축 각도) */
  const rot2 = (bone: string, times: number[], a: number[], axisA: Vec3, b: number[], axisB: Vec3): Track =>
    track(
      bone,
      times,
      a.flatMap((v, i) => mulQuat(quat(axisA, v), quat(axisB, b[i]))),
    );

  // 걷기 — cadence 초 한 주기. 덩치가 크면 길게 잡아야 무겁게 걷는다.
  const k = (r: number): number => r * cadence;
  const T = Array.from({ length: 9 }, (_, i) => k(i / 8));

  /** 걷기의 팔 흔들림과 어깨 구름. 봉을 되세우려면 이 값들이 필요하다. */
  const ARM_SWING = [-0.16, -0.11, 0, 0.11, 0.16, 0.11, 0, -0.11, -0.16];
  const SHOULDER_ROLL = [0.11, 0.075, 0, -0.075, -0.11, -0.075, 0, 0.075, 0.11];

  /**
   * 봉 뼈에 걸 되돌림 각도.
   * 부모 사슬(어깨 -> 팔)이 같은 축으로 돌기 때문에 각도는 그냥 더해진다.
   * single 모드의 `arms` 는 가슴 직속이라 어깨 몫이 없다.
   */
  const staffCounter = (): number[] => {
    if (!split) return ARM_SWING.map((a) => -a);
    const sign = m.weaponSide === 'L' ? 1 : -1;
    return ARM_SWING.map((a, i) => -sign * (a + SHOULDER_ROLL[i]));
  };

  /** 팔 흔들림 — split이면 좌우 따로, single이면 한 덩어리로 */
  const armSwing = (angles: number[], flip: boolean): Track[] => {
    const inv = angles.map((a) => -a);
    if (!split) return [rot('arms', T, angles, swingAxis)];
    return [rot('armL', T, flip ? inv : angles, swingAxis), rot('armR', T, flip ? angles : inv, swingAxis)];
  };

  /*
   * 장포 걸음. 다리가 아니라 골반이 걷는다 — 위 RigOptions.robeGait 참고.
   *
   * 9개 키가 한 주기(두 걸음)를 덮는다. 좌우 흔들림과 기울기는 주기당 한 번,
   * 위아래는 걸음마다 한 번이라 두 번 오르내린다.
   */
  const robeWalk = (): ClipSpec => {
    const H = m.bodyTopY - m.minY;
    const bob = H * 0.030;
    const sway = H * 0.020;
    const roll = 0.125;
    /** 걸음마다 앞으로 실렸다 돌아온다 — 나아가는 인상을 준다 */
    const pitch = 0.035;
    const wave = [0, 0.7, 1, 0.7, 0, -0.7, -1, -0.7, 0];
    const lift = [0, 0.7, 1, 0.7, 0, 0.7, 1, 0.7, 0];
    // 좌우 축은 swingAxis 다 (다리를 앞뒤로 흔들 때 쓰는 회전축 = 몸의 좌우선)
    const move: number[] = [];
    for (let i = 0; i < 9; i++) {
      move.push(swingAxis[0] * sway * wave[i], lift[i] * bob, swingAxis[2] * sway * wave[i]);
    }
    return {
      name: 'walk',
      tracks: [
        track('hips', T, move, 'translation'),
        // 디딘 발 쪽으로 기운다 — 옷자락 밑단이 이 회전으로 쓸린다
        rot('hips', T, wave.map((v) => v * roll), sideAxis),
        // 몸통은 절반만 되돌린다. 다 되돌리면 상체가 굳어 보이고, 안 하면 머리까지 기운다
        rot('chest', T, wave.map((v) => -v * roll * 0.45), sideAxis),
        // 머리는 수평을 지킨다
        rot('head', T, wave.map((v) => -v * roll * 0.35), sideAxis),
        // 걸음마다 몸통이 조금 비틀린다
        rot('hips', T, wave.map((v) => v * 0.05), [0, 1, 0]),
        rot('chest', T, wave.map((v) => -v * 0.035), [0, 1, 0]),
        // 걸음마다(주기당 두 번) 앞으로 실린다
        rot('chest', T, lift.map((v) => v * pitch), swingAxis),
      ],
    };
  };

  const walk: ClipSpec = opts.robeGait ? robeWalk() : {
    name: 'walk',
    tracks: [
      // legA(왼쪽, X가 작은 쪽)는 +X 로, legB는 -X 로 모은다
      legTrack('legL', T, [stride, stride * 0.72, 0, -stride * 0.72, -stride, -stride * 0.72, 0, stride * 0.72, stride], +1),
      legTrack('legR', T, [-stride, -stride * 0.72, 0, stride * 0.72, stride, stride * 0.72, 0, -stride * 0.72, -stride], -1),
      // 무릎은 뒤로만 굽는다. 뒤로 간 다리가 들려 올라오는 구간에서 굽어야 자연스럽다.
      rot('footL', T, [0, 0, -kneeBend * 0.3, -kneeBend, -kneeBend * 0.55, -kneeBend * 0.15, 0, 0, 0], swingAxis),
      rot('footR', T, [-kneeBend * 0.55, -kneeBend * 0.15, 0, 0, 0, 0, -kneeBend * 0.3, -kneeBend, -kneeBend * 0.55], swingAxis),
      // 상하 움직임은 발 고정(plantFeet)이 다리 길이 변화에서 만들어 준다.
      // 여기서는 자리만 잡아 두고 값은 0에서 시작한다 — 인위적인 bob 을 얹으면 발이 뜬다.
      // 다리 키프레임(5개)보다 촘촘히 잡아야 키프레임 사이에서 발이 뜨지 않는다.
      track(
        'hips',
        Array.from({ length: 13 }, (_, i) => (i / 12) * cadence),
        new Array(13 * 3).fill(0),
        'translation',
      ),
      // 몸통은 다리 반대로 아주 조금 비튼다
      rot('hips', T, [0.035, 0.025, 0, -0.025, -0.035, -0.025, 0, 0.025, 0.035], [0, 1, 0]),
      rot('chest', T, [-0.025, -0.018, 0, 0.018, 0.025, 0.018, 0, -0.018, -0.025], [0, 1, 0]),
      /*
       * 팔은 다리와 반대 위상으로 흔들린다 — 걷는 사람의 기본 리듬이다.
       * 무기를 든 팔까지 크게 흔들면 무기가 화면을 가로질러 튀므로
       * 다리(0.38)의 1/3 이하로 둔다.
       */
      ...armSwing(ARM_SWING, false),
      // 어깨는 걸음마다 위아래로 아주 조금 구른다.
      rot('shoulderL', T, SHOULDER_ROLL, swingAxis),
      rot('shoulderR', T, SHOULDER_ROLL.map((a) => -a), swingAxis),
      /*
       * 봉은 걷는 동안 세워 든다.
       * 봉 뼈는 팔(그리고 어깨)의 자식이라 가만두면 팔이 흔들리는 만큼 같이 흔들려,
       * 아래끝이 키의 10%를 넘게 앞뒤로 쓸고 땅을 판다. 그래서 부모가 돌린 만큼
       * 정확히 되돌린다 — 손목만 움직이고 봉은 서 있는, 실제로 짚고 걷는 모습이다.
       */
      ...(m.staff ? [rot('weapon', T, staffCounter(), swingAxis)] : []),
    ],
  };

  // 제자리 — 아주 작은 호흡. 다리는 바인드 포즈 그대로 둔다.
  const idleArm = split ? 'armR' : 'arms';
  const idle: ClipSpec = {
    name: 'idle',
    tracks: [
      track('hips', [0, 1.1, 2.2], [0, 0, 0, 0, bob * 0.5, 0, 0, 0, 0], 'translation'),
      rot('chest', [0, 1.1, 2.2], [0, 0.03, 0], swingAxis),
      rot(idleArm, [0, 1.1, 2.2], [0, -0.04, 0], swingAxis),
      // 숨 쉬는 동안에도 봉은 세워 둔다
      ...(m.staff && (!split || (m.weaponSide === 'R') === (idleArm === 'armR'))
        ? [rot('weapon', [0, 1.1, 2.2], [0, 0.04, 0], swingAxis)]
        : []),
    ],
  };

  // ── 공격 ────────────────────────────────────────────────────────
  const lunge = bodyH * 0.13;
  const fwd = (v: number): number[] => [forward[0] * v, forward[1] * v, forward[2] * v];
  const AT = [0, 0.25, 0.4, 0.75];

  let attack: ClipSpec;
  if (opts.attackStyle === 'dual_swing') {
    /*
     * 쌍칼 내려치기 — 두 팔이 함께 올라갔다가 성벽에 동시에 내리꽂힌다.
     *
     * swing 과 다른 점은 **반대 팔이 없다**는 것이다. 한손 무기는 반대 팔이
     * 반대로 움직여 균형을 잡지만, 쌍칼은 둘 다 무기라 같은 위상으로 가야
     * "두 자루로 내리찍었다"로 읽힌다.
     *
     * 몸통도 좌우로 비틀지 않는다(yaw 없음). 비틀면 한쪽 칼이 앞서 나가
     * 두 팔이 어긋나 보인다 — 정면으로 내리꽂는 대칭 동작이라야 한다.
     */
    attack = {
      name: 'attack',
      tracks: [
        track('hips', AT, [...fwd(0), ...fwd(-lunge * 0.5), ...fwd(lunge * 0.9), ...fwd(0)], 'translation'),
        // 두 팔: 뒤위로 크게 젖혔다가(-) 앞아래로 내리꽂는다(+)
        rot('armL', AT, [0, -0.85, 1.2, 0], swingAxis),
        rot('armR', AT, [0, -0.85, 1.2, 0], swingAxis),
        // 어깨도 같이 올라갔다 내려온다 — 팔만 돌면 칼이 어깨에서 떨어져 보인다
        rot('shoulderL', AT, [0, -0.28, 0.32, 0], swingAxis),
        rot('shoulderR', AT, [0, -0.28, 0.32, 0], swingAxis),
        /*
         * 몸통은 젖혔다가 실어 내린다. 체중이 실려야 무겁게 보인다.
         * 다만 0.4 까지 숙이면 내려치는 게 아니라 **절하는** 것처럼 보였다 —
         * 팔이 이미 1.2rad 을 도는데 상체까지 접히면 얼굴이 땅을 본다.
         */
        rot('chest', AT, [0, -0.22, 0.26, 0], swingAxis),
        // 머리는 몸통과 반대로 조금 들어 목이 꺾이지 않게 한다
        rot('head', AT, [0, 0.06, -0.08, 0], swingAxis),
        // 앞다리로 딛고 뒷다리로 민다
        rot('legL', AT, [0, 0.16, -0.34, 0], swingAxis),
        rot('legR', AT, [0, -0.14, 0.26, 0], swingAxis),
        rot('footL', AT, [0, -0.12, 0.1, 0], swingAxis),
        rot('footR', AT, [0, 0.1, -0.16, 0], swingAxis),
      ],
    };
  } else if (opts.attackStyle === 'swing' && m.staff) {
    /*
     * 봉 후려치기 — 성벽 앞에서 내려친다.
     *
     * 팔을 크게 돌리는 대신 **봉을 손에서 돌린다**. 어깨에서 돌리면 봉 아래끝이
     * 반경 1(키만 한 거리)로 휘둘려 땅을 뚫고 지나간다. 손이 중심이면 위끝이
     * 앞아래로 내려오고 아래끝은 오히려 들려서, 어디도 지면을 건드리지 않는다.
     *
     * 0.25s 뒤로 세우고(-64도), 0.4s 앞아래로 후려치고(+117도), 0.75s 제자리.
     */
    const weaponArm = split ? (m.weaponSide === 'L' ? 'armL' : 'armR') : 'arms';
    const other = m.weaponSide === 'L' ? 'armR' : 'armL';
    const yaw = m.weaponSide === 'L' ? 1 : -1;
    attack = {
      name: 'attack',
      tracks: [
        track('hips', AT, [...fwd(0), ...fwd(-lunge * 0.35), ...fwd(lunge * 0.75), ...fwd(0)], 'translation'),
        // 봉 자체 — 이 클립의 주인공이다
        rot('weapon', AT, [0, -0.7, 1.4, 0], swingAxis),
        // 쥔 팔은 봉을 따라 조금만 돈다. 옆으로 쓸리도록 yaw 를 섞는다.
        rot2(weaponArm, AT, [0, -0.3, 0.45, 0], swingAxis, [0, 0.18 * yaw, -0.26 * yaw, 0], [0, 1, 0]),
        ...(split ? [rot(other, AT, [0, 0.26, -0.38, 0], swingAxis)] : []),
        rot('shoulderL', AT, [0, -0.12, 0.2, 0], swingAxis),
        rot('shoulderR', AT, [0, -0.12, 0.2, 0], swingAxis),
        // 몸통은 젖힐 때 반대로 비틀었다가 내려칠 때 같이 돈다
        rot2('chest', AT, [0, -0.2, 0.32, 0], swingAxis, [0, 0.2 * yaw, -0.28 * yaw, 0], [0, 1, 0]),
        rot('head', AT, [0, 0.05, -0.12, 0], swingAxis),
        // 앞다리로 딛고 뒷다리로 민다
        rot('legL', AT, [0, 0.12, -0.28, 0], swingAxis),
        rot('legR', AT, [0, -0.12, 0.22, 0], swingAxis),
      ],
    };
  } else if (opts.attackStyle === 'swing') {
    /*
     * 내려치기 — 몽둥이.
     * 무기 든 팔을 뒤로 젖혔다가(0.25s) 앞아래로 쓸어 내린다(0.4s).
     * 몸통을 같은 방향으로 비틀어야 팔만 따로 도는 것처럼 보이지 않는다.
     * 반대 팔은 균형을 잡느라 반대로 움직인다.
     */
    const weapon = m.weaponSide === 'L' ? 'armL' : 'armR';
    const other = m.weaponSide === 'L' ? 'armR' : 'armL';
    const yaw = m.weaponSide === 'L' ? 1 : -1;
    attack = {
      name: 'attack',
      tracks: [
        track('hips', AT, [...fwd(0), ...fwd(-lunge * 0.4), ...fwd(lunge * 0.8), ...fwd(0)], 'translation'),
        // 무기 팔: 위로 젖혔다가(-) 앞아래로(+) 내려친다. 옆으로 쓸리도록 yaw 를 섞는다.
        rot2(weapon, AT, [0, -0.75, 1.25, 0], swingAxis, [0, 0.35 * yaw, -0.5 * yaw, 0], [0, 1, 0]),
        rot(other, AT, [0, 0.3, -0.45, 0], swingAxis),
        rot('shoulderL', AT, [0, -0.12, 0.2, 0], swingAxis),
        rot('shoulderR', AT, [0, -0.12, 0.2, 0], swingAxis),
        // 몸통은 젖힐 때 반대로 비틀었다가 내려칠 때 같이 돈다
        rot2('chest', AT, [0, -0.18, 0.3, 0], swingAxis, [0, 0.22 * yaw, -0.3 * yaw, 0], [0, 1, 0]),
        rot('head', AT, [0, 0.05, -0.1, 0], swingAxis),
        rot('legL', AT, [0, 0.1, -0.26, 0], swingAxis),
        rot('legR', AT, [0, -0.1, 0.2, 0], swingAxis),
      ],
    };
  } else {
    /*
     * 찌르기 — 창. 원본 포즈가 이미 내지르는 자세라
     * "당김 -> 원위치 -> 더 깊이" 로 만든다. 팔이 몸통보다 크게 움직여야
     * 창이 먼저 나가서 "찔렀다"로 읽힌다.
     */
    const armTracks: Track[] = split
      ? [rot('armL', AT, [0, -0.42, 0.55, 0], swingAxis), rot('armR', AT, [0, -0.42, 0.55, 0], swingAxis)]
      : [rot('arms', AT, [0, -0.42, 0.55, 0], swingAxis)];
    attack = {
      name: 'attack',
      tracks: [
        track('hips', AT, [...fwd(0), ...fwd(-lunge * 0.5), ...fwd(lunge), ...fwd(0)], 'translation'),
        rot('chest', AT, [0, -0.3, 0.36, 0], swingAxis),
        // 머리는 몸통과 **반대로** 조금 든다. 몸통(0.36)에 그대로 얹으면
        // 찌르는 순간 고개가 0.5 rad 이상 처박혀 목이 꺾인 것처럼 보인다.
        rot('head', AT, [0, 0.06, -0.14, 0], swingAxis),
        ...armTracks,
        rot('shoulderL', AT, [0, -0.16, 0.2, 0], swingAxis),
        rot('shoulderR', AT, [0, -0.16, 0.2, 0], swingAxis),
        // 앞다리로 딛고 뒷다리로 민다
        rot('legL', AT, [0, 0.14, -0.34, 0], swingAxis),
        rot('legR', AT, [0, -0.14, 0.26, 0], swingAxis),
        /*
         * 세워 든 창을 **눕혀서** 내지른다.
         *
         * 봉 뼈가 없으면(staff 를 안 켰으면) 창은 팔에 딸린 살덩이라 팔이 도는
         * 만큼만 움직인다 — 팔 0.55rad(31도)로는 창이 여전히 하늘을 보고 있어서
         * "앞으로 몸을 기울였다"로만 읽히고 찌르기로는 안 읽힌다(실측: 첫 굽기의
         * attack 프레임에서 창이 끝까지 수직이었다).
         *
         * 걷기에서 staffCounter 가 팔이 돌린 만큼 창을 **되세운다면**, 여기서는
         * 반대로 팔 위에 각도를 **더 얹어** 창을 지면과 나란히 만든다.
         * 부모(팔)와 같은 축이라 각도는 그냥 더해진다.
         *   당길 때  팔 -0.42 + 창 0.80 = 0.38rad (22도)  — 창을 뒤로 빼며 눕히기 시작
         *   찌를 때  팔  0.55 + 창 0.95 = 1.50rad (86도)  — 지면과 나란하다
         * 회전 중심은 손이다. 창끝이 앞으로 나가는 만큼 물미는 뒤로 빠진다 —
         * 실제로 창을 내지를 때 나오는 모양이다.
         */
        ...(m.staff ? [rot('weapon', AT, [0, 0.8, 0.95, 0], swingAxis)] : []),
      ],
    };
  }

  return [idle, walk, attack];
}

// ── 접지 계산 (모든 클립을 CPU에서 스키닝해 최저점을 찾는다) ──────────
//
// 매니페스트의 scale/yOffset 을 손으로 맞추면 클립이 바뀔 때마다 어긋난다.
// 대신 여기서 "가장 낮은 프레임의 발끝"을 실제로 구해 모델에 변환을 구워 넣는다.
// 그러면 게임 쪽은 보정값 없이 그냥 세우기만 하면 된다.

type Mat4 = Float64Array;

function matIdentity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** 열우선 4x4 곱 (a 다음 b 를 적용 = b * a) */
function matMul(out: Mat4, b: Mat4, a: Mat4): Mat4 {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += b[k * 4 + r] * a[c * 4 + k];
      out[c * 4 + r] = v;
    }
  }
  return out;
}

/** 평행이동 + 회전(쿼터니언) 으로 로컬 행렬을 만든다 (스케일 없음) */
function matCompose(t: Vec3, q: Quat): Mat4 {
  const [x, y, z, w] = q;
  const m = new Float64Array(16);
  m[0] = 1 - 2 * (y * y + z * z);
  m[1] = 2 * (x * y + z * w);
  m[2] = 2 * (x * z - y * w);
  m[4] = 2 * (x * y - z * w);
  m[5] = 1 - 2 * (x * x + z * z);
  m[6] = 2 * (y * z + x * w);
  m[8] = 2 * (x * z + y * w);
  m[9] = 2 * (y * z - x * w);
  m[10] = 1 - 2 * (x * x + y * y);
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  m[15] = 1;
  return m;
}

/** 트랙에서 시각 t 의 값을 선형 보간해 뽑는다 */
function sampleTrack(track: Track, t: number): number[] {
  const stride = track.path === 'rotation' ? 4 : 3;
  const times = track.times;
  const at = (i: number): number[] => track.values.slice(i * stride, i * stride + stride);
  if (t <= times[0]) return at(0);
  if (t >= times[times.length - 1]) return at(times.length - 1);
  let i = 0;
  while (i < times.length - 1 && times[i + 1] < t) i++;
  const span = times[i + 1] - times[i] || 1;
  const k = (t - times[i]) / span;
  const a = at(i);
  const b = at(i + 1);
  return a.map((v, j) => v + (b[j] - v) * k);
}

interface SkinContext {
  P: Float32Array;
  n: number;
  joints: Uint16Array;
  weights: Float32Array;
  bones: BoneSpec[];
  parentIndex: number[];
  bindLocal: Vec3[];
  step: number;
  /**
   * 접지 계산에서 뺄 정점 (봉 같은 소품).
   * 땅에 닿는 기준은 발이어야 한다 — 봉 끝이 조금 내려갔다고 골반을 밀어 올리면
   * 유닛이 통째로 떠 버린다.
   */
  ignore: Uint8Array | null;
}

function makeSkinContext(
  P: Float32Array,
  n: number,
  joints: Uint16Array,
  weights: Float32Array,
  bones: BoneSpec[],
  ignore: Uint8Array | null = null,
): SkinContext {
  const parentIndex = bones.map((b) => (b.parent ? bones.findIndex((x) => x.name === b.parent) : -1));
  const bindLocal: Vec3[] = bones.map((b, i) => {
    const pi = parentIndex[i];
    return pi < 0
      ? b.head
      : [b.head[0] - bones[pi].head[0], b.head[1] - bones[pi].head[1], b.head[2] - bones[pi].head[2]];
  });
  return { P, n, joints, weights, bones, parentIndex, bindLocal, ignore, step: Math.max(1, Math.floor(n / 4000)) };
}

/** 이 클립을 시각 t 에서 재생했을 때 메시가 닿는 가장 낮은 Y */
function lowestAt(ctx: SkinContext, clip: ClipSpec, time: number): number {
  const { bones, parentIndex, bindLocal } = ctx;

  const world: Mat4[] = [];
  for (let i = 0; i < bones.length; i++) {
    const name = bones[i].name;
    let t: Vec3 = bindLocal[i];
    let q: Quat = [0, 0, 0, 1];
    for (const tr of clip.tracks) {
      if (tr.bone !== name) continue;
      const v = sampleTrack(tr, time);
      if (tr.path === 'rotation') q = [v[0], v[1], v[2], v[3]] as Quat;
      else t = [bindLocal[i][0] + v[0], bindLocal[i][1] + v[1], bindLocal[i][2] + v[2]];
    }
    const local = matCompose(t, q);
    const pi = parentIndex[i];
    world.push(pi < 0 ? local : matMul(matIdentity(), world[pi], local));
  }

  const skin: Mat4[] = world.map((w, i) => {
    const ibm = matCompose([-bones[i].head[0], -bones[i].head[1], -bones[i].head[2]], [0, 0, 0, 1]);
    return matMul(matIdentity(), w, ibm);
  });

  let lowest = Infinity;
  for (let v = 0; v < ctx.n; v += ctx.step) {
    if (ctx.ignore?.[v]) continue;
    const x = ctx.P[v * 3];
    const y = ctx.P[v * 3 + 1];
    const z = ctx.P[v * 3 + 2];
    let wy = 0;
    for (let k = 0; k < 4; k++) {
      const w = ctx.weights[v * 4 + k];
      if (w === 0) continue;
      const m = skin[ctx.joints[v * 4 + k]];
      wy += w * (m[1] * x + m[5] * y + m[9] * z + m[13]);
    }
    if (wy < lowest) lowest = wy;
  }
  return lowest;
}

/**
 * 발을 땅에 붙인다.
 *
 * 다리를 앞뒤로 벌리면 다리의 "수직 길이"가 짧아져 골반이 그대로면 발이 뜬다.
 * 반대로 다리를 모으면 발이 땅을 뚫는다. 실제로 걷기 클립의 최저점이
 * 바인드 포즈보다 0.08(모델 단위)이나 내려가서 발이 땅에 파묻혔다.
 *
 * IK를 넣는 대신, 프레임마다 최저점을 재서 골반 Y를 그만큼 밀어 올린다.
 * 결과적으로 지지발이 항상 같은 높이에 있고, 몸통의 상하 움직임은
 * 인위적인 bob이 아니라 다리 길이 변화에서 자연스럽게 나온다.
 */
function plantFeet(ctx: SkinContext, clip: ClipSpec, rootBone = 'hips'): void {
  const hips = clip.tracks.find((t) => t.bone === rootBone && t.path === 'translation');
  if (!hips) return;

  const lows = hips.times.map((t) => lowestAt(ctx, clip, t));
  const target = Math.max(...lows); // 가장 높이 뜨는 프레임에 맞춘다 = 아무 프레임도 파묻히지 않는다
  for (let i = 0; i < hips.times.length; i++) {
    hips.values[i * 3 + 1] += target - lows[i];
  }
  console.log(
    `[rig] 발 고정 "${clip.name}": 프레임별 최저 ${lows.map((v) => v.toFixed(3)).join(' ')} -> ${target.toFixed(3)}`,
  );
}

/**
 * 접지 오프셋을 굽는 기준 높이.
 *
 * **걷기 클립만** 본다. 유닛은 거의 항상 걷고 있고, plantFeet 이 걷기의 지지발을
 * 한 높이로 맞춰 두었기 때문이다. 모든 클립의 최저점으로 잡으면 걷는 내내 떠 있게 된다 —
 * 네 발 짐승이 특히 그렇다(다리를 앞뒤로 뻗으면 몸이 올라간다). 실측으로 기병이 3u 떴다.
 * 제자리·공격은 발을 옮기지 않으므로 그 차이만큼만 잠깐 낮게 선다.
 */
function lowestAnimatedY(ctx: SkinContext, clips: ClipSpec[], samplesPerClip = 12): number {
  const walk = clips.filter((c) => c.name === 'walk');
  let lowest = Infinity;
  for (const clip of walk.length > 0 ? walk : clips) {
    const dur = Math.max(...clip.tracks.flatMap((t) => t.times));
    for (let i = 0; i <= samplesPerClip; i++) {
      const v = lowestAt(ctx, clip, (i / samplesPerClip) * dur);
      if (v < lowest) lowest = v;
    }
  }
  return lowest;
}

// ── glTF 조립 ─────────────────────────────────────────────────────────

function floatAccessor(doc: Document, data: number[] | Float32Array, type: 'SCALAR' | 'VEC3' | 'VEC4'): Accessor {
  const array = data instanceof Float32Array ? data : new Float32Array(data);
  return doc
    .createAccessor()
    .setType(type)
    .setArray(array as Float32Array<ArrayBuffer>)
    .setBuffer(doc.getRoot().listBuffers()[0]);
}

export async function rig(
  input: string,
  output: string,
  opts: RigOptions,
): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(input);
  const root = doc.getRoot();
  const meshes = root.listMeshes();
  if (meshes.length !== 1) throw new Error(`메시가 1개여야 한다 (지금 ${meshes.length}개)`);
  const prim = meshes[0].listPrimitives()[0];
  const posAcc = prim.getAttribute('POSITION')!;
  const n = posAcc.getCount();

  const P = new Float32Array(n * 3);
  const tmp = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    posAcc.getElement(i, tmp);
    P[i * 3] = tmp[0];
    P[i * 3 + 1] = tmp[1];
    P[i * 3 + 2] = tmp[2];
  }

  /*
   * 칼날 캡슐을 찾을 것인가.
   *
   * 쌍칼(dual_swing)은 늘 찾는다 — 양손에 든 것이 둘 다 무기임이 확실하다.
   * 한 손 무기는 **모델이 시켰을 때만** 찾는다(blade). 거리 기반 스키닝이 긴 칼을
   * 팔·가슴·골반으로 토막 내서 걷기만 해도 칼이 휘는 모델이 있고(장각의 대도),
   * 그런 모델에 이걸 켠다.
   *
   * 왜 split 전체에 켜지 않는가: findBlade 는 "몸통 축에서 가장 먼 점"에서 축을 맞추므로,
   * 칼이 없는 모델에서는 팔·갑주 자락·장화가 세로로 늘어선 줄을 칼날로 잡는다
   * (실측: 강동 수병 1.60, 야습대 1.58 — 몸 높이가 1.8인데 그만한 칼은 없다).
   * 그걸 팔 뼈에 통째로 묶으면 팔을 들 때 다리가 따라 올라간다.
   */
  const bladeMode: BladeMode =
    opts.attackStyle === 'dual_swing' ? 'both' : opts.blade === true ? 'one' : 'none';
  const stats = analyze(P, n, opts.staff === true, bladeMode, opts.bulky === true, {
    bodyTopRatio: opts.bodyTopRatio,
    footRadius: opts.footRadius,
    weaponSide: opts.weaponSide,
    backProp: opts.backProp,
    bodyAxis: opts.bodyAxis,
  });
  console.log(
    `[rig] bbox 높이 ${stats.height.toFixed(3)}  몸 높이 ${(stats.bodyTopY - stats.minY).toFixed(3)}  ` +
      `(bodyTopY ${stats.bodyTopY.toFixed(3)} / maxY ${stats.maxY.toFixed(3)})`,
  );
  console.log(
    `[rig] 몸통중심 (${stats.bodyX.toFixed(3)}, ${stats.bodyZ.toFixed(3)})  ` +
      `발 A(${stats.legA[0].toFixed(3)}, ${stats.legA[1].toFixed(3)}) B(${stats.legB[0].toFixed(3)}, ${stats.legB[1].toFixed(3)})`,
  );

  if (opts.staff) {
    const st = stats.staff;
    if (st) {
      const tiltDeg = (Math.acos(Math.min(1, Math.abs(st.dir[1]))) * 180) / Math.PI;
      console.log(
        `[rig] 봉: 손(${st.grip.map((v) => v.toFixed(3)).join(', ')}) 끝(${st.top.map((v) => v.toFixed(3)).join(', ')})` +
          `  반경 위 ${st.r.toFixed(3)}/아래 ${st.rLow.toFixed(3)}  기울기 ${tiltDeg.toFixed(1)}도  길이 ${(st.tMax - st.tMin).toFixed(3)}`,
      );
    } else {
      console.warn('[rig] 봉을 찾지 못했다 — 일반 스키닝으로 진행한다');
    }
  }

  const mount = opts.bodyKind === 'mounted' ? analyzeMount(P, n, stats) : null;
  if (mount) {
    console.log(
      `[rig] 말: 몸통(${mount.body.map((v) => v.toFixed(3)).join(', ')})` +
        `  목(${mount.neck.map((v) => v.toFixed(3)).join(', ')})` +
        `  병사(${mount.rider.map((v) => v.toFixed(3)).join(', ')})`,
    );
    console.log(
      `[rig] 발: ` +
        (['frontL', 'frontR', 'backL', 'backR'] as const)
          .map((k) => {
            const f = mount.feet[k];
            return `${k}(${f.x.toFixed(2)}, ${f.z.toFixed(2)} y${f.bottomY.toFixed(2)})`;
          })
          .join(' '),
    );
  }
  const bones = mount ? buildMountSkeleton(mount) : buildSkeleton(stats, opts.armMode, opts.bulky === true);
  if (opts.rigidArms) {
    // 반경 0 = 거리 스키닝의 후보에서 빠진다(fallback 에서도 제외된다)
    let zeroed = 0;
    for (const b of bones) {
      if (!/^(arm|shoulder)/.test(b.name) || b.maxR <= 0) continue;
      b.maxR = 0;
      zeroed++;
    }
    console.log(`[rig] 팔을 몸통에 붙였다 — 뼈 ${zeroed}개의 반경을 0 으로 (소매·손에 든 것은 chest 가 든다)`);
  }
  const tails: Vec3[] = bones.map((b, i) => {
    if (b.tail) return b.tail;
    const child = bones.find((c, j) => c.parent === b.name && j !== i);
    return child ? child.head : ([b.head[0], b.head[1] + stats.height * 0.1, b.head[2]] as Vec3);
  });

  /*
   * 뼈 굵기 재기 — 몸이 두꺼운 모델에서만.
   *
   * 뼈는 선이고 몸은 통이다. 선까지의 거리로만 재면 몸통 표면은 척추(멀다)가 아니라
   * 옆을 지나는 팔 뼈(가깝다)에 붙는다. 그래서 뼈마다 자기 주변 정점까지의 중앙 거리를
   * 재서 그만큼을 "굵기"로 빼 준다 — 그러면 표면이 제 부위의 뼈에 붙는다.
   *
   * 몸통에만 굵기를 주면 이번엔 골반이 다리를 삼킨다(실측: 2,262정점).
   * 모든 뼈에 같은 방식으로 줘야 균형이 맞는다.
   */
  if (opts.bulky) {
    bones.forEach((b, bi) => {
      if (b.maxR <= 0) return;
      const ds: number[] = [];
      for (let v = 0; v < n; v++) {
        const d = distToSegment([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], b.head, tails[bi]);
        if (d <= b.maxR) ds.push(d);
      }
      if (ds.length < 30) return;
      ds.sort((x, y) => x - y);
      b.coreR = ds[Math.floor(ds.length * 0.5)] * 0.8;
    });
    console.log(
      `[rig] 뼈 굵기: ${bones.filter((b) => b.coreR).map((b) => `${b.name} ${b.coreR!.toFixed(3)}`).join('  ')}`,
    );
  }

  // 가중치 굽기
  const joints = new Uint16Array(n * 4) as Uint16Array<ArrayBuffer>;
  const weights = new Float32Array(n * 4) as Float32Array<ArrayBuffer>;
  const usage = new Array<number>(bones.length).fill(0);
  const staff = stats.staff;
  const backProp = stats.backProp;
  const propIndex = bones.findIndex((b) => b.name === 'prop');
  const weaponIndex = bones.findIndex((b) => b.name === 'weapon');
  const hipsIndex = bones.findIndex((b) => b.name === 'hips');
  /** 칼날 캡슐 — 그 안의 정점은 통째로 그 팔 뼈가 가져간다 */
  const blades: { rod: StaffInfo; bone: number }[] = [];
  for (const [rod, name] of [
    [stats.bladeL, 'armL'],
    [stats.bladeR, 'armR'],
  ] as const) {
    const bi = bones.findIndex((b) => b.name === name);
    if (rod && bi >= 0) {
      blades.push({ rod, bone: bi });
      console.log(
        `[rig] ${name} 칼날: 손(${rod.grip.map((v) => v.toFixed(3)).join(', ')})` +
          ` 끝(${rod.top.map((v) => v.toFixed(3)).join(', ')}) 길이 ${(rod.tMax - rod.tMin).toFixed(3)}`,
      );
    }
  }
  const headBoneY = stats.minY + (stats.bodyTopY - stats.minY) * 0.86;
  const legBone = bones.map((b) => /^(leg|foot)/.test(b.name));
  const bodyHeight0 = stats.bodyTopY - stats.minY;
  const skirtBand = opts.skirt
    ? {
        top: stats.minY + bodyHeight0 * (opts.skirt.topRatio ?? 0.5),
        bottom: stats.minY + bodyHeight0 * opts.skirt.toRatio,
        legInfluence: opts.skirt.legInfluence ?? 0.3,
      }
    : null;
  if (skirtBand) {
    console.log(
      `[rig] 갑주 자락: y ${skirtBand.bottom.toFixed(3)}~${skirtBand.top.toFixed(3)}` +
        `  아랫단 다리 가중치 상한 ${skirtBand.legInfluence}`,
    );
  }
  /** 접지 계산에서 뺄 정점 = 봉 */
  const staffMask = staff && weaponIndex >= 0 ? new Uint8Array(n) : null;
  for (let i = 0; i < n; i++) {
    const p: Vec3 = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    /*
     * 봉 정점은 거리 계산을 건너뛰고 통째로 무기 뼈가 가져간다.
     * 거리로 나누면 봉 아래는 다리, 가운데는 가슴, 위는 머리 뼈로 갈려서
     * 걷기만 해도 봉이 세 토막으로 휜다.
     */
    /*
     * 칼날은 거리 계산을 건너뛰고 그 팔이 통째로 가져간다.
     * 투구와 그 장식(머리 위 좁은 원기둥)은 예외다 — 칼날 축이 그 옆을 스치기 때문에
     * 그냥 두면 투구 절반이 팔에 묶여 휘두를 때 검은 판때기로 늘어난다.
     */
    /*
     * 등짐이 먼저다. 깃대는 어깨 옆을 스쳐 지나가므로 칼날 캡슐이나 팔 반경에
     * 먼저 걸릴 수 있는데, 그러면 다시 팔을 따라 휘둘린다.
     */
    if (propIndex >= 0 && backProp?.mask[i]) {
      joints[i * 4] = propIndex;
      weights[i * 4] = 1;
      usage[propIndex]++;
      continue;
    }

    let bladeBone = -1;
    const headZone =
      p[1] > headBoneY && Math.hypot(p[0] - stats.bodyX, p[2] - stats.bodyZ) < (stats.bodyTopY - stats.minY) * 0.25;
    if (!headZone) {
      for (const b of blades) {
        const a = alongAxis(p, b.rod.grip, b.rod.dir);
        if (a.d <= b.rod.r && a.t >= -b.rod.r && a.t <= b.rod.tMax + b.rod.r) {
          bladeBone = b.bone;
          break;
        }
      }
    }
    if (bladeBone >= 0) {
      joints[i * 4] = bladeBone;
      weights[i * 4] = 1;
      usage[bladeBone]++;
      continue;
    }

    const onStaff =
      staff !== null &&
      (() => {
        const a = alongAxis(p, staff.grip, staff.dir);
        // 손(t=0) 위아래로 반경이 다르다 — 위는 허공, 아래는 몸 옆이다
        const rr = a.t < 0 ? staff.rLow : staff.r;
        return a.d <= rr && a.t >= staff.tMin - rr && a.t <= staff.tMax + rr;
      })();
    if (staffMask && onStaff) {
      joints[i * 4] = weaponIndex;
      weights[i * 4] = 1;
      staffMask[i] = 1;
      usage[weaponIndex]++;
      continue;
    }
    const { joints: j, weights: w } = skinVertex(p, bones, tails);

    /*
     * 갑주 자락 — 다리 가중치를 눌러 골반으로 옮긴다.
     *
     * 자락은 허리에 매달린 판이라 두 다리 사이에서 찢어지면 안 된다.
     * 허리에서는 다리를 전혀 타지 않고, 아랫단으로 갈수록 조금씩 탄다
     * (아랫단이 뻣뻣하게 굳어 있으면 그것대로 어색하다).
     * 자락에 덮인 허벅지도 같이 눌리지만 어차피 보이지 않는다.
     */
    if (skirtBand) {
      const t = (p[1] - skirtBand.bottom) / (skirtBand.top - skirtBand.bottom);
      if (t >= 0 && t <= 1) {
        const allow = skirtBand.legInfluence * (1 - t) ** 1.2;
        let moved = 0;
        for (let k = 0; k < 4; k++) {
          if (!legBone[j[k]] || w[k] <= allow) continue;
          moved += w[k] - allow;
          w[k] = allow;
        }
        if (moved > 0) {
          let slot = j.indexOf(hipsIndex);
          if (slot < 0) {
            // 가장 약한 자리를 골반에 내준다
            slot = w.indexOf(Math.min(...w));
            j[slot] = hipsIndex;
            w[slot] = 0;
          }
          w[slot] += moved;
        }
      }
    }

    for (let k = 0; k < 4; k++) {
      joints[i * 4 + k] = j[k];
      weights[i * 4 + k] = w[k];
    }
    usage[j[0]]++;
  }
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    console.log(
      `[rig]   ${b.name.padEnd(6)} head(${b.head.map((v) => v.toFixed(3)).join(', ')})` +
        ` tail(${tails[i].map((v) => v.toFixed(3)).join(', ')})` +
        ` maxR ${b.maxR.toFixed(3)}  정점 ${usage[i]}`,
    );
  }

  /*
   * 봉 경계를 다듬는다 — 이웃이 거의 다 몸이면 그 정점도 몸으로 되돌린다.
   *
   * 캡슐은 원통이라 봉 옆을 스치는 살점(자락 끝, 장화 옆면)을 몇 점씩 문다.
   * 그렇게 물린 점들은 몸 한복판에 박힌 **외딴 섬**이라, 아래에서 이음매를
   * 자르고 나면 어디에도 안 붙은 채 봉을 따라 날아다닌다. 삼각형을 지워
   * 치우는 것보다 **애초에 봉으로 치지 않는 것**이 맞다 — 구멍도 안 생긴다.
   *
   * 판단은 메시의 이웃으로 한다. 진짜 봉의 정점은 이웃도 거의 다 봉이고,
   * 잘못 물린 살점은 이웃이 거의 다 몸이다. 두 번 돌리면 한 겹 더 벗겨진다.
   */
  if (staffMask) {
    const idx0 = prim.getIndices();
    const arr0 = idx0?.getArray();
    if (arr0) {
      const adj: number[][] = Array.from({ length: n }, () => []);
      for (let t = 0; t + 2 < arr0.length; t += 3) {
        const v = [arr0[t], arr0[t + 1], arr0[t + 2]];
        for (let a = 0; a < 3; a++)
          for (let b = 0; b < 3; b++) if (a !== b) adj[v[a]].push(v[b]);
      }
      let freed = 0;
      for (let pass = 0; pass < 2; pass++) {
        const flip: number[] = [];
        for (let i = 0; i < n; i++) {
          if (staffMask[i] !== 1 || adj[i].length === 0) continue;
          let same = 0;
          for (const j of adj[i]) if (staffMask[j] === 1) same++;
          if (same / adj[i].length < 0.34) flip.push(i);
        }
        if (flip.length === 0) break;
        for (const i of flip) {
          staffMask[i] = 0;
          const p: Vec3 = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
          const { joints: j2, weights: w2 } = skinVertex(p, bones, tails);
          for (let k = 0; k < 4; k++) {
            joints[i * 4 + k] = j2[k];
            weights[i * 4 + k] = w2[k];
          }
        }
        freed += flip.length;
      }
      if (freed > 0) console.log(`[rig] 봉 경계 정리: 잘못 물린 정점 ${freed}개를 몸으로 되돌렸다`);
    }
  }

  prim.setAttribute('JOINTS_0', floatAccessor(doc, new Float32Array(joints), 'VEC4').setArray(joints));
  prim.setAttribute('WEIGHTS_0', floatAccessor(doc, weights, 'VEC4'));

  /*
   * 봉과 몸을 잇는 삼각형을 잘라낸다.
   *
   * 원본이 사람과 무기를 **하나의 껍질**로 만들어 놓은 경우가 있다(이미지에서
   * 생성한 모델이 대개 그렇다). 그러면 창대와 갑주 자락이 한 면으로 이어져 있고,
   * 창을 손에서 돌리는 순간 그 이음매의 삼각형이 창을 따라 끌려가 부채처럼
   * 펼쳐진다 — 실측: 하북 창병의 찌르기에서 발과 창을 잇는 모서리가 키의 40배로
   * 늘어났고, 화면에는 허리에서 뻗어 나온 판때기로 보였다.
   *
   * 가중치를 아무리 잘 나눠도 이건 못 고친다. 한 삼각형의 세 꼭짓점이 서로 다른
   * 물체에 속해 있다는 것 자체가 문제이기 때문이다. 그 삼각형은 실제 표면이
   * 아니라 두 물체가 붙어 나온 자국이므로 지우는 것이 맞다. 창대가 그 자리를
   * 가리고 있어 구멍은 보이지 않는다.
   */
  if (staffMask) {
    const idx = prim.getIndices();
    const src = idx?.getArray();
    if (idx && src) {
      const keep: number[] = [];
      let cut = 0;
      for (let t = 0; t + 2 < src.length; t += 3) {
        const a = staffMask[src[t]];
        if (a === staffMask[src[t + 1]] && a === staffMask[src[t + 2]]) {
          keep.push(src[t], src[t + 1], src[t + 2]);
        } else {
          cut++;
        }
      }
      if (cut > 0) {
        /*
         * 잘라 내고 나면 **부스러기 섬**이 남는다.
         *
         * 봉 캡슐은 원통이라 봉 주변의 살점(갑주 자락 끝, 장화 옆면)을 조금씩
         * 물고 있다. 이음매를 자르기 전에는 그것들이 몸에 붙어 있어 티가 안 났지만,
         * 자르고 나면 어디에도 안 붙은 조각이 되어 봉을 따라 허공을 날아다닌다
         * (실측: 찌르기 프레임에서 병사 오른쪽 허공에 검은 덩어리가 떠다녔다).
         *
         * 그래서 남은 삼각형을 연결 요소로 묶고, 아주 작은 덩어리는 버린다.
         * 사람 모델은 몸통 하나와 봉 하나가 큰 덩어리로 남고, 그보다 작은 것은
         * 전부 자국이다. 기준을 넉넉히 잡아도(전체의 1%) 진짜 부품은 안 걸린다.
         */
        const parent = new Int32Array(n).fill(-1);
        const find = (x: number): number => {
          let root = x;
          while (parent[root] >= 0) root = parent[root];
          while (parent[x] >= 0) {
            const nx = parent[x];
            parent[x] = root;
            x = nx;
          }
          return root;
        };
        const union = (a: number, b: number): void => {
          const ra = find(a);
          const rb = find(b);
          if (ra !== rb) parent[ra] = rb;
        };
        for (let t = 0; t + 2 < keep.length; t += 3) {
          union(keep[t], keep[t + 1]);
          union(keep[t + 1], keep[t + 2]);
        }
        const size = new Map<number, number>();
        for (let t = 0; t + 2 < keep.length; t += 3) {
          const r = find(keep[t]);
          size.set(r, (size.get(r) ?? 0) + 1);
        }
        /*
         * 버리는 것은 **봉 쪽의 작은 덩어리뿐이다.**
         *
         * 두 번 틀렸다. 처음에는 "봉 쪽은 가장 큰 덩어리 하나만 남긴다"고 했는데,
         * 이음매를 자르면 봉 자체가 여러 토막으로 나뉘므로 가장 큰 것이 손잡이
         * 토막 하나였고 창이 통째로 사라졌다. 다음에는 크기만 보고 버렸더니
         * 이번에는 **몸 쪽 부품**이 사라졌다 — 승려의 소매가 원래부터 따로 떨어진
         * 작은 덩어리였는데 그게 지워져 가슴에 구멍이 뚫렸다.
         *
         * 몸 쪽 덩어리는 이 코드가 만든 것이 아니라 원본이 원래 그렇게 생긴
         * 것이므로 건드리지 않는다. 이 코드가 책임질 것은 봉을 떼어 내면서
         * 생긴 봉 쪽 부스러기뿐이다.
         */
        const minPart = Math.max(6, Math.floor((keep.length / 3) * 0.01));
        const kept2: number[] = [];
        let debris = 0;
        for (let t = 0; t + 2 < keep.length; t += 3) {
          const root = find(keep[t]);
          const drop = staffMask[root] === 1 && (size.get(root) ?? 0) < minPart;
          if (!drop) kept2.push(keep[t], keep[t + 1], keep[t + 2]);
          else debris++;
        }
        idx.setArray(Uint32Array.from(kept2));
        console.log(
          `[rig] 봉↔몸 이음 삼각형 ${cut}개를 잘랐다 (${((cut / (src.length / 3)) * 100).toFixed(1)}%)` +
            (debris > 0 ? `, 부스러기 ${debris}개도 버렸다(덩어리 ${minPart}개 미만)` : ''),
        );
      }
    }
  }

  // 뼈 노드 — 로컬 위치는 부모와의 차이
  const nodeByName = new Map<string, Node>();
  for (const b of bones) {
    const parent = b.parent ? bones.find((x) => x.name === b.parent)! : null;
    const local: Vec3 = parent
      ? [b.head[0] - parent.head[0], b.head[1] - parent.head[1], b.head[2] - parent.head[2]]
      : b.head;
    nodeByName.set(b.name, doc.createNode(b.name).setTranslation(local));
  }
  for (const b of bones) {
    if (b.parent) nodeByName.get(b.parent)!.addChild(nodeByName.get(b.name)!);
  }

  // 역바인드 행렬 — 바인드 포즈에 회전·스케일이 없으므로 -월드위치 평행이동이다
  const ibm = new Float32Array(bones.length * 16) as Float32Array<ArrayBuffer>;
  bones.forEach((b, i) => {
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.head[0], -b.head[1], -b.head[2], 1];
    ibm.set(m, i * 16);
  });
  const ibmAcc = doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(root.listBuffers()[0]);

  const skin = doc.createSkin('soldier_skin').setInverseBindMatrices(ibmAcc);
  for (const b of bones) skin.addJoint(nodeByName.get(b.name)!);
  skin.setSkeleton(nodeByName.get('root')!);

  // 메시 노드에 스킨을 물린다
  const scene = root.listScenes()[0];
  let meshNode: Node | null = null;
  root.listNodes().forEach((nd) => {
    if (nd.getMesh() === meshes[0]) meshNode = nd;
  });
  if (!meshNode) throw new Error('메시 노드를 찾지 못했다');
  (meshNode as Node).setSkin(skin);

  // 애니메이션
  const rad = (opts.forwardDeg * Math.PI) / 180;
  const forward: Vec3 = [Math.sin(rad), 0, Math.cos(rad)];
  // 다리는 진행 방향에 수직인 축을 중심으로 흔들리고(swing),
  // 진행 방향 축을 중심으로 벌어지고 모인다(side).
  const swingAxis: Vec3 = [Math.cos(rad), 0, -Math.sin(rad)];
  const sideAxis: Vec3 = forward;

  const clips = mount
    ? buildMountClips(mount, swingAxis, forward, opts.cadence, opts.attackStyle)
    : buildClips(stats, swingAxis, sideAxis, forward, opts);

  const skinCtx = makeSkinContext(P, n, joints, weights, bones, staffMask);
  // 걷기는 지지발이 땅에 붙어 있어야 한다 (제자리·찌르기는 발을 옮기지 않으므로 그대로 둔다)
  const rootBone = mount ? 'body' : 'hips';
  /*
   * 발 고정은 **다리로 걷는 모델**의 것이다.
   *
   * 프레임마다 최저점을 한 높이로 맞춰서 지지발이 땅을 파거나 뜨지 않게 한다.
   * 그런데 장포 걸음은 위아래 흔들림 자체가 걸음의 신호다 — 여기에 이 보정을
   * 걸면 그 흔들림이 정확히 지워져서, 옷자락만 좌우로 쓸리는 미끄러짐이 된다
   * (실측: 골반을 0.030 올렸는데 보정이 같은 만큼 도로 내렸다).
   */
  if (!opts.robeGait) {
    for (const clip of clips) if (clip.name === 'walk') plantFeet(skinCtx, clip, rootBone);
  }

  // 접지 기준점은 오프셋 표현일 때 재야 한다 — 아래에서 절대 좌표로 바꾸기 전에.
  const lowest = lowestAnimatedY(skinCtx, clips);

  /*
   * glTF 의 translation 채널은 노드의 위치를 **교체**한다(더하지 않는다).
   * 클립은 다루기 쉬우라고 "바인드 위치로부터의 오프셋"으로 만들었으므로,
   * 굽기 직전에 절대 좌표로 바꿔 준다.
   *
   * 이걸 빼먹으면 골반 노드가 바인드 위치(0, 0.354, 0)가 아니라 오프셋 값
   * (0, 0.01, 0)으로 순간이동해서 하반신이 통째로 내려앉는다 —
   * 실제로 발이 지면보다 16u 아래(몸 높이의 절반)로 내려가 다리가 안 보였다.
   */
  for (const clip of clips) {
    for (const tr of clip.tracks) {
      if (tr.path !== 'translation') continue;
      const bi = bones.findIndex((b) => b.name === tr.bone);
      const local = skinCtx.bindLocal[bi];
      for (let i = 0; i < tr.times.length; i++) {
        tr.values[i * 3] += local[0];
        tr.values[i * 3 + 1] += local[1];
        tr.values[i * 3 + 2] += local[2];
      }
    }
  }

  for (const clip of clips) {
    const anim = doc.createAnimation(clip.name);
    for (const t of clip.tracks) {
      const input = floatAccessor(doc, t.times, 'SCALAR');
      const outType = t.path === 'rotation' ? 'VEC4' : 'VEC3';
      const output = floatAccessor(doc, t.values, outType);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      anim.addSampler(sampler);
      anim.addChannel(
        doc.createAnimationChannel().setTargetNode(nodeByName.get(t.bone)!).setTargetPath(t.path).setSampler(sampler),
      );
    }
    console.log(`[rig] 클립 "${clip.name}" 트랙 ${clip.tracks.length}`);
  }

  // ── 접지와 크기를 모델에 굽는다 ──────────────────────────────────
  //
  // 스킨드 메시는 자기 노드의 변환이 무시되므로(관절이 전부 결정한다),
  // 뼈대 루트를 감싸는 노드에 스케일·평행이동을 걸어야 결과가 따라온다.
  // 게임 쪽 manifest 는 url 만 있으면 되고 scale/yOffset 보정이 사라진다.
  const bodyHeight = stats.bodyTopY - stats.minY;
  const scale = opts.targetHeight / bodyHeight;
  console.log(
    `[rig] 접지: 클립 최저점 ${lowest.toFixed(3)} (바인드 ${stats.minY.toFixed(3)})` +
      `  몸 높이 ${bodyHeight.toFixed(3)} -> ${opts.targetHeight}u  스케일 ${scale.toFixed(2)}`,
  );

  const stand = doc
    .createNode('stand')
    .setScale([scale, scale, scale])
    .setTranslation([0, -lowest * scale, 0]);
  stand.addChild(nodeByName.get('root')!);
  scene.addChild(stand);

  mkdirSync(dirname(output), { recursive: true });
  await io.write(output, doc);
  console.log(`[rig] 저장: ${output} (${(statSync(output).size / 1024 / 1024).toFixed(2)} MB)`);
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/rig-model.ts');
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name: string, d: number): number => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : d;
  };
  const str = (name: string, d: string): string => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : d;
  };
  const positional = args.filter((a) => !a.startsWith('--') && !/^-?\d+(\.\d+)?$/.test(a));
  await rig(
    positional[0] ?? 'public/assets/models/_preview.glb',
    positional[1] ?? 'public/assets/models/soldier.glb',
    {
      bodyKind: str('body', 'humanoid') === 'mounted' ? 'mounted' : 'humanoid',
      forwardDeg: flag('forward', 0),
      targetHeight: flag('height', 34),
      armMode: str('arms', 'single') === 'split' ? 'split' : 'single',
      attackStyle: ((): AttackStyle => {
        const a = str('attack', 'thrust');
        return a === 'swing' || a === 'dual_swing' ? a : 'thrust';
      })(),
      cadence: flag('cadence', 0.9),
      walkStride: flag('stride', 0.38),
      kneeBend: flag('knee-bend', 0.3),
      legCloseFactor: flag('leg-close', 0.3),
    },
  );
}
