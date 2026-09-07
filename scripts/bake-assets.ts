/**
 * 원본 모델을 게임 사양으로 굽는다 (경량화 -> 리깅 -> 클립).
 *
 *   npm run asset:all            전부
 *   npm run asset:soldier        하나만
 *
 * 각 모델의 기준값을 여기 한 곳에 모아 둔다. 손으로 긴 명령줄을 치면
 * `--arms` 나 `--cadence` 를 빠뜨렸을 때 조용히 다른 결과가 나온다.
 */
import { optimize } from './optimize-model';
import { rig, type BodyKind, type AttackStyle } from './rig-model';
import { rigTower, type TowerKind } from './rig-tower';
import { rigTrap } from './rig-trap';
import { rigDragonTower } from './rig-dragon-tower';
import { isolateFigure } from './isolate-figure';
import { unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** 사람 형상은 rig-model, 건물은 rig-tower 로 간다 */
type RigKind = 'humanoid' | 'tower' | 'trap' | 'dragon';

interface Recipe {
  kind: RigKind;
  /** 원본 (img/) */
  input: string;
  /** 결과 (public/assets/models/) */
  output: string;
  tris: number;
  tex: number;
  /** 감면 허용 오차. 얇은 구조가 있는 건물은 작게 잡는다 */
  error?: number;
  forwardDeg: number;
  /** 완성 키(u). 유닛의 scale 이 여기에 곱해진다 — 보스는 units.ts 에서 2.0배 */
  targetHeight: number;
  /** humanoid 전용 */
  bodyKind?: BodyKind;
  armMode?: 'single' | 'split';
  attackStyle?: AttackStyle;
  cadence?: number;
  /** 바닥까지 닿는 긴 봉을 든 모델 — 봉을 통째로 손에 묶는다 */
  staff?: boolean;
  /** 한 손에 든 긴 칼을 통째로 그 팔 뼈에 묶는다 (걸을 때 칼이 휘는 모델) */
  blade?: boolean;
  /** 허리에 매달린 갑주 자락 — 다리가 아니라 골반을 따라가게 한다 */
  skirt?: { toRatio: number; legInfluence?: number; topRatio?: number };
  /** 갑주를 두른 덩치 — 몸통 축·뼈 굵기 보정을 켠다 */
  bulky?: boolean;
  /** 머리 위로 솟은 넓은 부속(깃발)이 있어 몸 높이를 자동으로 못 자를 때 (bbox 비율) */
  bodyTopRatio?: number;
  /** 바닥까지 닿는 무기가 발로 잡히지 않게 발 탐색을 좁힌다 (bodyH 비율) */
  footRadius?: number;
  /** 무기를 든 손을 못 박는다 (등에 깃발을 진 모델은 자동 판정이 진다) */
  weaponSide?: 'L' | 'R';
  /** 등에 진 깃발을 몸통 뼈에 묶는다 (안 하면 팔에 붙어 휘둘린다) */
  backProp?: boolean;
  /** 척추가 지나는 자리를 못 박는다 (정점이 한쪽으로 몰린 모델) */
  bodyAxis?: { x: number; z: number };
  /** 팔을 따로 돌리지 않는다 — 큰 소매의 장포를 입은 인물 */
  rigidArms?: boolean;
  /** 다리가 안 보이는 인물의 걷기 — 골반이 몸 전체를 흔든다 */
  robeGait?: boolean;
  /**
   * 원본에 인물이 둘 이상이면 하나만 남긴다.
   * keep 은 자르는 축에서 어느 쪽을 남길지다.
   */
  isolate?: { axis?: 'x' | 'z' | 'auto'; keep: 'min' | 'max'; rotateYDeg?: number };
  /** 직립 보행 조절값. 작을수록 보폭과 무릎 굽힘이 줄어든다. */
  walkStride?: number;
  kneeBend?: number;
  legCloseFactor?: number;
  /** tower 전용 */
  towerKind?: TowerKind;
  /** trap 전용 — 완성된 원반의 지름(u). targetHeight 는 쓰지 않는다 */
  diameter?: number;
  /** trap 전용 — 이 높이(두께 비율) 위로 솟은 것을 가시로 본다 */
  spikeTop?: number;
  /** 이 높이 비율 위를 쇠뇌/팔/대포로 본다 */
  bowY?: number;
  bows?: number;
  /** cannons 전용 — 이 높이 비율 위는 정자·지붕·깃발이다 */
  deckTop?: number;
  /** cannons 전용 — 데크 반경 대비 이 비율 밖이 대포의 몸이다 */
  cannonRadius?: number;
  /** cannons 전용 — 데크 반경 대비 이 비율 밖은 난간을 넘은 포신이다 */
  protrudeRadius?: number;
  /** cannons 전용 — 각도가 이만큼 비면 다른 대포로 나눈다 */
  gapDeg?: number;
  /** cannons 전용 — 찾은 방향의 좌우로 이만큼 넓혀 가져온다 */
  sectorPadDeg?: number;
  /** cannons 전용 — 난간 밖 포신은 천장을 이 비율만큼 넘어도 가져온다 */
  barrelLift?: number;
}

const RECIPES: Record<string, Recipe> = {
  fire_tower: {
    kind: 'dragon', input: 'img/화공 망루.glb', output: 'public/assets/models/fire_tower.glb',
    tris: 28000, tex: 2048, error: .003, forwardDeg: 0, targetHeight: 80,
  },
  // 황건적 보병 — 창을 양손으로 잡아 팔을 나눌 수 없다
  soldier: {
    kind: 'humanoid',
    input: 'img/Soldier2.glb',
    output: 'public/assets/models/soldier.glb',
    tris: 2500,
    tex: 1024,
    forwardDeg: 0,
    targetHeight: 34,
    armMode: 'single',
    attackStyle: 'thrust',
    cadence: 0.9,
    walkStride: 0.70,
    kneeBend: 0.10,
    legCloseFactor: 0.08,
  },
  // 서량 방패병 — 방패 팔은 방어 자세를 유지하고 검을 든 팔로 내려친다.
  shield_soldier: {
    kind: 'humanoid',
    input: 'img/Soldier_shield.glb',
    output: 'public/assets/models/shield_soldier.glb',
    tris: 4500,
    tex: 1024,
    error: 0.012,
    forwardDeg: 0,
    targetHeight: 34,
    armMode: 'split',
    attackStyle: 'swing',
    /*
     * 방패 아래 모서리가 발로 잡혔다.
     *
     * 발은 하단 20% 대역을 XZ 2-means 로 갈라 찾는데, 그 대역에 방패 끝
     * 4정점(x -0.349, z 0.25 — 축에서 0.43H, 바닥에서 0.14 떠 있다)이 들어 있었다.
     * 2-means 는 x 양 끝에서 시작하므로 그 4개가 한 군집을 통째로 붙들었고,
     * 진짜 두 발은 반대쪽 군집 하나에 몰렸다.
     *
     * 결과: 왼발 뼈가 정점을 12개만 들고(오른발은 331), 두 다리가 전부 오른다리
     * 뼈에 붙어 **같은 위상으로 함께 흔들렸다** — 허리에서 두 발이 공중에서
     * 같이 움직이는 걸음이 그것이다.
     *
     * 발은 아무리 벌려도 축에서 0.22H 안쪽이다(다른 병사들 실측 0.06~0.09).
     */
    footRadius: 0.22,
    cadence: 1.05,
    walkStride: 0.88,
    kneeBend: 0.12,
    legCloseFactor: 0.10,
  },
  /**
   * 서량 철기 — 말 탄 창기병.
   * 사람이 아니라 네 다리로 달리므로 `bodyKind: 'mounted'` 로 리깅한다.
   * 걸음 주기가 짧은 이유는 갤럽이기 때문이다 — 보병(0.9s)보다 빨라야 달리는 것으로 읽힌다.
   */
  cavalry: {
    kind: 'humanoid',
    bodyKind: 'mounted',
    input: 'img/Cavalry.glb',
    output: 'public/assets/models/cavalry.glb',
    tris: 6000,
    tex: 1024,
    forwardDeg: 0,
    targetHeight: 42,
    cadence: 0.7,
  },

  /**
   * 여포 — 적토마를 탄 최종보스. 앞다리를 든 자세라 다리를 앞뒤·좌우로 갈라 찾는다.
   * 화면 높이는 units.ts 의 scale 2.2 가 곱해진 값이다 — 38u 로 구우면 약 79u 가 되어
   * 장각(68u)·화웅(65u)보다 크고 서량 철기(47u)와는 확실히 구분된다.
   *
   * 공격은 **휘두르기**다. 기본값(찌르기)으로 구웠더니 앞으로 나가는 성분밖에 없어서
   * 방천화극이 아니라 머리로 들이받는 것처럼 보였다 — 날이 옆으로 뻗은 무기는
   * 어깨와 몸통이 가로로 돌아야 무기가 무기로 읽힌다.
   */
  lubu: {
    kind: 'humanoid',
    bodyKind: 'mounted',
    input: 'img/2level_boss.glb',
    output: 'public/assets/models/lubu.glb',
    tris: 9000,
    tex: 1024,
    forwardDeg: 0,
    targetHeight: 38,
    attackStyle: 'swing',
    cadence: 0.8,
  },

  /**
   * 서량 종군 도사 — 봉을 짚은 승려.
   *
   * 원본(img/xl_healer.glb)에는 같은 승려가 둘 나란히 서 있다. X축 가운데가 비어 있어
   * 거기서 자르고 +X 쪽 한 명만 남긴다 — 이쪽이 봉을 몸에서 떼어 들고 있어
   * (몸통축 거리 0.18 vs 반대쪽 0.14) 봉을 통째로 손에 묶기 좋다.
   *
   * 봉이 발끝부터 머리 위까지 이어지므로 staff 를 켠다. 이게 없으면 거리 스키닝이
   * 봉을 다리·가슴·머리로 쪼개서 걷기만 해도 봉이 휜다.
   *
   * 걸음은 보병(0.9s)보다 느긋하다 — 지원형이라 뒤에서 따라오는 인상을 준다.
   */
  healer: {
    kind: 'humanoid',
    input: 'img/xl_healer.glb',
    output: 'public/assets/models/healer.glb',
    tris: 6000,
    tex: 1024,
    // 이 승려는 +X 를 보고 서 있다. 파이프라인은 +Z 정면을 전제하므로 돌려 세운다.
    isolate: { axis: 'x', keep: 'max', rotateYDeg: -90 },
    staff: true,
    forwardDeg: 0,
    targetHeight: 34,
    armMode: 'split',
    attackStyle: 'swing',
    cadence: 1.05,
    // 봉을 짚은 승려다. 보폭을 크게 주면 종종거리며 달리는 것처럼 보인다 —
    // 0.82 로 구웠더니 걸음마다 몸이 키의 12%씩 오르내렸다.
    walkStride: 0.58,
    kneeBend: 0.14,
    legCloseFactor: 0.10,
  },

  /**
   * 원소 — 3장 최종보스. 쌍칼을 양손에 든 하북의 맹주.
   *
   * 34u 로 구우면 units.ts 의 scale 2.3 이 곱해져 화면에서 78u — 여포(79u)와 어깨를
   * 나란히 하고 장각(68u)·화웅(65u)보다 크다. 3장의 마지막이 앞 장 보스보다
   * 작아 보이면 안 된다.
   *
   * 두 팔이 각각 칼을 들고 있어 armMode 는 split, 공격은 dual_swing 이다.
   * 걸음은 가장 느리고 무겁다 — 갑주를 두른 대장이다.
   */
  yuanshao: {
    kind: 'humanoid',
    input: 'img/3level_boss.glb',
    output: 'public/assets/models/yuanshao.glb',
    tris: 9000,
    tex: 1024,
    forwardDeg: 0,
    targetHeight: 34,
    armMode: 'split',
    attackStyle: 'dual_swing',
    // 갑주를 두른 덩치라 몸통 축·뼈 굵기 보정이 필요하다
    bulky: true,
    // 갑주 자락이 무릎 위(몸 높이 28%)까지 내려온다
    skirt: { toRatio: 0.28, legInfluence: 0.3 },
    cadence: 1.3,
    walkStride: 0.7,
    kneeBend: 0.16,
    legCloseFactor: 0.35,
  },

  // 황건적 두목 — 몽둥이를 한 손에 든다. 덩치가 커서 걸음이 느리다
  captain: {
    kind: 'humanoid',
    input: 'img/Big Soldier.glb',
    output: 'public/assets/models/captain.glb',
    tris: 6000,
    tex: 1024,
    forwardDeg: 0,
    targetHeight: 34,
    armMode: 'split',
    attackStyle: 'swing',
    cadence: 1.25,
    walkStride: 1.05,
    kneeBend: 0.14,
    legCloseFactor: 0.10,
  },
  /**
   * 장각 — 큰칼을 한 손에 든다. 가장 느리고 무겁게 걷는다.
   *
   * blade 를 켠 이유: 대도가 몸 높이의 절반을 넘어 팔에서 아래로 뻗는데, 거리
   * 스키닝은 그 칼을 팔·골반·다리로 토막 내서 걸을 때마다 칼이 활처럼 휘었다.
   */
  zhangjiao: {
    kind: 'humanoid',
    input: 'img/1level_boss.glb',
    output: 'public/assets/models/zhangjiao.glb',
    tris: 7000,
    tex: 1024,
    forwardDeg: 0,
    targetHeight: 34,
    armMode: 'split',
    attackStyle: 'swing',
    // 위 주석이 말하는 그 플래그다. 이게 빠져 있어서 칼이 걸을 때마다 휘었다.
    // dual_swing 모델은 자동으로 켜지지만 한 손 swing 은 이렇게 명시해야 한다.
    blade: true,
    cadence: 1.35,
    walkStride: 1.12,
    kneeBend: 0.16,
    legCloseFactor: 0.10,
  },


  /**
   * 관우 — 5장 최종보스. 청룡언월도를 한 손에 들고 등에 깃발을 세웠다.
   *
   * blade 를 켠 이유는 장각과 같다. 언월도가 손에서 비스듬히 내려와 발치까지
   * 닿는데, 거리 스키닝은 그 긴 자루를 팔·골반·다리로 토막 내서 걷기만 해도
   * 칼이 활처럼 휜다. 켜면 날 캡슐 안의 정점이 전부 그 팔 뼈 하나를 따라간다.
   *
   * bulky 는 갑주 두른 덩치라 켠다 — 허리 중앙값이 언월도 쪽으로 끌려가므로
   * 몸통 축을 머리에서 다시 잡아야 한다.
   *
   * 등 뒤 깃대는 머리 위까지 솟아 bbox 를 부풀린다. 그래도 targetHeight 는
   * 몸 높이(bodyTopY)에 걸리므로 관우 자신이 작아지지는 않는다 —
   * analyze 가 정점 수 3% 규칙으로 가느다란 부속을 잘라 낸다.
   */
  guanyu: {
    kind: 'humanoid',
    input: 'img/관우.glb',
    output: 'public/assets/models/guanyu.glb',
    tris: 9000,
    tex: 1024,
    forwardDeg: 0,
    targetHeight: 34,
    armMode: 'split',
    attackStyle: 'swing',
    blade: true,
    bulky: true,
    // 투구 끝이 bbox 의 82%. 그 위는 깃발이다 (probe 로 쟀다)
    bodyTopRatio: 0.82,
    // 언월도 날 끝이 축에서 0.47H — 발로 잡히지 않게 0.40H 로 자른다
    footRadius: 0.40,
    // 언월도는 왼손이다. 자동 판정은 등 뒤 깃발이 있는 오른쪽을 고른다
    weaponSide: 'L',
    // 등 뒤 깃발 — 켜지 않으면 오른팔에 붙어 내려칠 때 팔처럼 휘둘린다
    backProp: true,
    skirt: { toRatio: 0.30, legInfluence: 0.3 },
    cadence: 1.3,
    walkStride: 0.9,
    kneeBend: 0.16,
    legCloseFactor: 0.2,
  },

  /**
   * 제갈량 — 6장 최종보스. 바닥까지 끌리는 장포에 우선깃털부채.
   *
   * 이 모델에는 **다리가 없다.** 장포가 허리부터 바닥까지 한 덩어리라
   * 발 대역을 2-means 로 갈라도 옷자락 왼쪽/오른쪽이 나올 뿐이다. 그대로
   * 걷기 클립을 태우면 옷자락이 두 쪽으로 찢어져 가위질한다.
   *
   * 그래서 skirt 의 아랫단을 바닥(0.02)까지 내리고 다리 영향을 0 으로 막는다.
   * 장포 전체가 골반을 따라가고, 걸음은 다리가 아니라 몸통의 위아래·좌우
   * 흔들림으로 읽힌다 — 승상이 미끄러지듯 다가오는 편이 맞다.
   * 보폭과 무릎을 거의 0 으로 두는 것도 같은 이유다.
   */
  zhugeliang: {
    kind: 'humanoid',
    input: 'img/제갈량.glb',
    output: 'public/assets/models/zhugeliang.glb',
    /*
     * 삼각형이 다른 인물(9,000)보다 많고 오차도 크게 준다.
     *
     * 우선깃털부채가 얇은 깃 수십 장이라 감면기가 거기서 멈춘다 — 기본 오차
     * 0.02 로는 9,000 을 목표로 줘도 27,748 에서 서고, 그 예산의 84%가 가슴
     * 높이(부채·소매)로 간다. 머리에 남은 정점이 13개였다.
     * 오차를 키워 깃을 뭉개면 예산이 골고루 퍼진다.
     */
    tris: 12000,
    error: 0.003,
    tex: 1024,
    forwardDeg: 0,
    targetHeight: 34,
    armMode: 'split',
    attackStyle: 'swing',
    /*
     * 팔을 따로 돌리지 않는다. 소매가 커서 팔과 옷이 구분되지 않고, 거리
     * 스키닝이 오른팔에 모델의 70%(26,182정점)를 붙였다 — 그 팔을 0.75rad
     * 돌리면 상체가 접힌다. 부채는 상체가 비틀리며 쓸고 지나간다.
     */
    rigidArms: true,
    /*
     * 닫힌 장포는 좌우 다리 사이의 연속 가중치로 굽힌다.
     * 허리와 큰 소매는 안정시키고 발 접지로 골반 높이를 계산한다.
     */
    robeGait: true,
    bulky: false,
    /*
     * 머리 위에는 아무것도 없다 — 관(冠)이 곧 꼭대기다. 그런데 자동 규칙은
     * 여기서 반대로 틀린다: 장포가 정점의 대부분을 가져가서 머리·관 대역이
     * 최대치의 3% 밑으로 떨어지고, 그래서 **머리를 부속으로 잘라 냈다**
     * (실측: 몸 높이 78% — 머리 뼈가 가슴에 놓이고 정점 16,920개를 삼켰다).
     * 그래서 "꼭대기까지가 몸"이라고 말해 준다.
     */
    bodyTopRatio: 0.99,
    /*
     * 척추 자리. 부채와 앞자락이 정점의 절반을 쥐고 있어 중앙값이 앞으로 0.10
     * 밀린다 — 실측: 머리 중앙은 (-0.028, 0.030) 인데 자동 축은 (0.079, 0.148)
     * 이 나와서 머리 뼈가 머리 밖에 놓였다(정점 58개).
     */
    bodyAxis: { x: -0.02, z: 0.04 },
    // 장포 자락이 바닥에 넓게 깔린다. 그 끝을 발로 잡으면 다리 뼈가 옷단으로 뻗는다
    footRadius: 0.25,
    /*
     * 자락 아랫단을 **바닥(0)** 까지 내린다. 0.02 로 두었더니 바닥에 깔린 옷단
     * 정점(가중치 합 382)이 자락 대역 밖에 남아 다리를 그대로 탔다.
     * 자동 다리 가중치를 먼저 지우고 robeGait가 매끄러운 가중치를 다시 부여한다.
     */
    skirt: { toRatio: 0, topRatio: 0.78, legInfluence: 0 },
    cadence: 1.35,
    walkStride: 0.24,
    kneeBend: 0.04,
    legCloseFactor: 0.5,
  },

  /**
   * 하북 창병 (3장 주력) — 바닥까지 닿는 긴 창을 **한 손**으로 세워 들었다.
   *
   * staff 를 켠 이유: 창대가 발밑에서 머리 위까지 이어진다. 거리 스키닝은 그
   * 창을 다리·골반·가슴·머리로 토막 내므로, 켜지 않으면 걷기만 해도 창이 활처럼
   * 휜다(장각의 대도와 같은 병이다). 켜면 창대가 통째로 weapon 뼈 하나가 되어
   * 손에 붙는다.
   *
   * armMode 는 split — 한 손으로 든다. 반대 손은 허리의 환도 쪽에 비어 있다.
   * single 로 묶으면 빈 손까지 창에 딸려가 두 손으로 잡은 모양이 된다.
   *
   * attackStyle 은 thrust — 성문을 창으로 찌른다.
   */
  ys_spear: {
    kind: 'humanoid',
    input: 'img/하복 창병.glb',
    output: 'public/assets/models/ys_spear.glb',
    tris: 6000,
    tex: 1024,
    staff: true,
    /*
     * 갑주 자락 — 허리에서 허벅지까지 덮는 판이다.
     *
     * 켜지 않으면 자락의 왼쪽 절반은 왼다리가, 오른쪽 절반은 오른다리가 가져가서
     * 걸을 때 두 쪽으로 찢어져 판때기처럼 날아다닌다(실측: 첫 굽기의 walk·attack
     * 프레임에서 자락이 발보다 앞까지 뻗어 나갔다).
     */
    skirt: { toRatio: 0.34, legInfluence: 0.25 },
    forwardDeg: 0,
    targetHeight: 34,
    armMode: 'split',
    attackStyle: 'thrust',
    // 체력 130 에 속도 44 — 3장에서 가장 느리고 무거운 잡병이다.
    // 보병(0.9s)보다 느긋하게, 창을 세워 든 무게가 보이도록 잡는다.
    cadence: 1.15,
    walkStride: 0.72,
    kneeBend: 0.12,
    legCloseFactor: 0.10,
  },

  /**
   * 강동 수병 (4장 잡병) — 왼손에 둥근 방패, 오른손에 환도.
   *
   * 서량 방패병과 같은 구성이라 같은 값에서 출발한다(split + swing). 다른 것은
   * 성문을 때리는 리듬이다 — 방패를 앞세우고 짧게 끊어 치는 병사라 cadence 를
   * 방패병(1.05)보다 조금 빠르게 잡았다. 걸음은 속도 56 짜리 보병에 맞춘 보통 걸음이다.
   */
  wu_marine: {
    kind: 'humanoid',
    input: 'img/강동수병.glb',
    output: 'public/assets/models/wu_marine.glb',
    tris: 4500,
    tex: 1024,
    error: 0.012,
    forwardDeg: 0,
    targetHeight: 34,
    armMode: 'split',
    attackStyle: 'swing',
    cadence: 0.98,
    walkStride: 0.82,
    kneeBend: 0.12,
    legCloseFactor: 0.10,
  },

  /**
   * 등갑병 (4장 방벽) — **양손에 검을 한 자루씩** 들었다. 원소와 같은 쌍칼이다.
   *
   * 그래서 dual_swing 이다. swing 으로 구우면 왼손 검이 균형을 잡느라 뒤로 빠져서
   * 칼을 든 손이 아니라 빈손처럼 움직인다. 갑주를 두른 덩치라 bulky 를 켜고,
   * 무릎까지 내려오는 갑주 자락이 있어 skirt 로 골반에 묶는다 — 안 묶으면
   * 걸을 때 자락이 두 쪽으로 찢어져 날아다닌다.
   *
   * 걸음은 느리고 무겁다. 속도 40 짜리 방벽이라 보병(0.9)보다 한참 길게 잡았다.
   */
  wu_rattan: {
    kind: 'humanoid',
    input: 'img/등갑병.glb',
    output: 'public/assets/models/wu_rattan.glb',
    tris: 6000,
    tex: 1024,
    error: 0.012,
    forwardDeg: 0,
    targetHeight: 34,
    armMode: 'split',
    attackStyle: 'dual_swing',
    bulky: true,
    skirt: { toRatio: 0.30, legInfluence: 0.3 },
    cadence: 1.25,
    walkStride: 0.72,
    kneeBend: 0.14,
    legCloseFactor: 0.20,
  },

  /**
   * 강동 야습대 (4장 속공) — 몸을 다 덮는 대형 방패와 짧은 검.
   *
   * 속도 118 로 이 게임에서 가장 빠른 잡병이다. 그래서 cadence 를 0.62 로 —
   * 서량 철기의 갤럽(0.7)보다도 짧게 잡았다. 빠름은 보폭이 아니라 **주기**로 낸다:
   * 보폭 1.05 로 구웠더니 방패가 왼다리를 가린 채 다리만 크게 뻗어 나가서
   * 몸이 두 동강 난 것처럼 보였다. 방패를 든 병사는 종종걸음이어야 한다.
   *
   * 방패가 몸통만큼 커서 bulky 를 켠다. 켜지 않으면 거리 스키닝이 방패를
   * 가슴 뼈로 가져가 걸을 때 방패가 몸에 붙어 흔들린다.
   */
  wu_raider: {
    kind: 'humanoid',
    input: 'img/강동야습대.glb',
    output: 'public/assets/models/wu_raider.glb',
    tris: 5000,
    tex: 1024,
    error: 0.012,
    forwardDeg: 0,
    targetHeight: 34,
    armMode: 'split',
    attackStyle: 'swing',
    bulky: true,
    cadence: 0.62,
    walkStride: 0.74,
    kneeBend: 0.13,
    legCloseFactor: 0.12,
  },

  /**
   * 감녕 (4장 중간보스) — 오른손에 용머리 철퇴, 왼손에 대형 방패.
   *
   * units.ts 의 scale 1.9 가 곱해지므로 34u 로 구우면 화면에서 65u —
   * 화웅(65u)과 같은 급이고 손권(2.3배)보다는 작다. 중간보스의 자리다.
   *
   * 철퇴는 한 손 무기라 split + swing. 내려치는 무기라 cadence 를 길게 잡아
   * 한 번 한 번이 무겁게 보이게 했다. 돌진(6초마다 3배속)이 걸리면 걸음 재생이
   * 빨라지므로 기본 걸음은 느긋해도 된다.
   */
  ganning: {
    kind: 'humanoid',
    input: 'img/감념.glb',
    output: 'public/assets/models/ganning.glb',
    tris: 7000,
    tex: 1024,
    error: 0.012,
    forwardDeg: 0,
    targetHeight: 34,
    armMode: 'split',
    attackStyle: 'swing',
    bulky: true,
    skirt: { toRatio: 0.28, legInfluence: 0.3 },
    cadence: 1.2,
    walkStride: 0.85,
    kneeBend: 0.15,
    legCloseFactor: 0.20,
  },

  /**
   * 손권 (4장 최종보스) — 봉황 방패와 오환도(吳). 갑주 자락이 무릎까지 내려온다.
   *
   * units.ts 의 scale 2.3 이 곱해지므로 34u 로 구우면 화면에서 78u —
   * 원소(78u)와 어깨를 나란히 하고 감녕(65u)보다 확실히 크다.
   * 4장의 마지막이 그 장의 중간보스보다 작아 보이면 안 된다.
   *
   * 감녕과 같은 구성(한 손 무기 + 대형 방패)이라 값도 거기서 출발하되,
   * 걸음은 더 느리다 — 회복 오라를 두르고 전군을 이끄는 대장이라
   * 뒤에서 밀고 오는 인상이어야 한다.
   */
  sunquan: {
    kind: 'humanoid',
    input: 'img/손권.glb',
    output: 'public/assets/models/sunquan.glb',
    tris: 9000,
    tex: 1024,
    error: 0.012,
    forwardDeg: 0,
    targetHeight: 34,
    armMode: 'split',
    attackStyle: 'swing',
    bulky: true,
    skirt: { toRatio: 0.30, legInfluence: 0.3 },
    cadence: 1.3,
    walkStride: 0.78,
    kneeBend: 0.15,
    legCloseFactor: 0.22,
  },

  /**
   * 활 망루 — 사람이 아니라 건물이다.
   * 삼각형을 넉넉히 두는 이유는 성벽 톱니가 감면에 약해서다.
   * 14,000 에서는 톱니가 부서진 것처럼 뭉개졌다 — 원본과 나란히 렌더해 확인했다.
   * 30,000 이면 원본과 거의 구분되지 않는다.
   * 쇠뇌는 원본에 4개뿐이라 5레벨용으로 하나를 복제한다.
   */
  archer_tower: {
    kind: 'tower',
    towerKind: 'bows',
    input: 'img/bow_tower.glb',
    output: 'public/assets/models/archer_tower.glb',
    tris: 30000,
    tex: 1024,
    error: 0.005,
    forwardDeg: 0,
    targetHeight: 62,
    bowY: 0.76,
    bows: 5,
  },

  /**
   * 화포 진지 — 둥근 데크에 대포가 둘러선 포대.
   *
   * 원본(img/cannon.glb)이 대포 진지라 화포 쪽에 붙인다. 한동안 화공 망루가
   * 이 모델을 쓰고 있었는데, 화공은 불을 다루는 망루라 대포와 실루엣이 겹쳤다.
   * 화공 망루는 따로 디자인한다 — 그때까지 프리미티브로 돈다.
   *
   * 원본에는 대포가 세 문뿐이라 두 문을 복제해 다섯 문 링을 만든다(레벨 = 문수).
   * 활 망루의 복제와 달리 **돌려서** 놓는다 — 데크 한가운데는 정자가 차지하고 있다.
   *
   * 임계값의 뜻 (전부 실측해서 맞췄다 — Y x 반경 점유도를 찍어 봤다)
   *   bowY 0.578         데크 바닥 바로 위. 0.60 은 포가와 바퀴를 잘라 데크에 파편을 남겼고
   *                      0.565 는 바닥면을 물어 데크에 구멍이 뚫렸다.
   *                      바닥면이 방향 찾기를 흐리는 문제는 리깅 쪽에서 푼다 —
   *                      방향은 데크 위쪽 70% 만 보고 찾는다
   *   deckTop 0.74       이 위는 정자·기와지붕. 0.72 로 자르면 포신 위 밧줄 장식이 잘려 남았다
   *   protrudeRadius .88 난간 밖으로 나간 것은 포신뿐이다 — 이걸로 세 문의 방향을 찾는다
   *   cannonRadius .40   찾은 방향의 부채꼴에서 데크 한가운데만 뺀다
   *   sectorPadDeg 20    ±14도로는 포가와 바퀴가 잘려 데크에 파편이 남았다
   *   barrelLift .05     포구가 들려 있어 천장을 조금 넘는다. 난간 밖이라 안전하다
   *
   * 삼각형이 활 망루(30,000)와 같은 이유는 같은 이유다 — 성벽 톱니와 기와가
   * 감면에 약하다. 실제로 16,000 에서는 처마가 톱니처럼 부서졌다.
   */
  cannon_tower: {
    kind: 'tower',
    towerKind: 'cannons',
    input: 'img/cannon.glb',
    output: 'public/assets/models/cannon_tower.glb',
    tris: 30000,
    tex: 1024,
    error: 0.005,
    forwardDeg: 0,
    targetHeight: 58,
    bowY: 0.578,
    deckTop: 0.74,
    protrudeRadius: 0.88,
    cannonRadius: 0.40,
    gapDeg: 12,
    sectorPadDeg: 20,
    barrelLift: 0.05,
    bows: 5,
  },

  /**
   * 철질려 진지 — 바닥에 까는 팔괘 석반에 마름쇠 여덟 개가 박혀 있다.
   *
   * 유일한 trap 이다. 쏘지 않고 밟은 적을 늦추는 진지라 쇠뇌 뼈가 필요 없고,
   * 대신 마름쇠마다 뼈를 심어 idle(천천히 돈다)과 trigger(솟구친다)를 굽는다.
   * 자세한 이유는 scripts/rig-trap.ts 머리말에 적어 두었다.
   *
   * 원본이 참고 그림의 원근을 그대로 구워서 원반이 40.5도 기울어 있다 —
   * rig-trap 이 주성분으로 법선을 찾아 세운다.
   *
   * 지름 52u 는 궁노 망루(62u 높이)와 나란히 놓았을 때 슬롯 하나를 채우는 크기다.
   * targetHeight 대신 diameter 를 쓰는 이유는 이것이 납작한 원반이기 때문이다 —
   * 높이(17u)로 맞추면 지름이 155u 가 되어 경로를 통째로 덮는다.
   */
  caltrop_camp: {
    kind: 'trap',
    input: 'img/칠질러.glb',
    output: 'public/assets/models/caltrop_camp.glb',
    tris: 9000,
    tex: 1024,
    forwardDeg: 0,
    targetHeight: 0,
    diameter: 52,
    spikeTop: 0.57,
  },

  /**
   * 벽력거 — 팔 하나가 돌아가는 투석기.
   * 팔은 틀보다 위에 있어 높이로 갈리고, 팔 끝에 매달린 균형추도 함께 딸려 간다.
   */
  catapult: {
    kind: 'tower',
    towerKind: 'catapult',
    input: 'img/catapult.glb',
    output: 'public/assets/models/catapult.glb',
    tris: 16000,
    tex: 1024,
    error: 0.005,
    forwardDeg: 0,
    targetHeight: 46,
    bowY: 0.72,
  },
};

async function bake(name: string): Promise<void> {
  const r = RECIPES[name];
  if (!r) throw new Error(`알 수 없는 모델: ${name} (${Object.keys(RECIPES).join(', ')})`);
  const tmp = `${r.output.replace(/\.glb$/, '')}._tmp.glb`;
  console.log(`\n=== ${name} ===`);
  await optimize({ input: r.input, output: tmp, tris: r.tris, tex: r.tex, error: r.error });
  // 원본에 인물이 둘이면 여기서 하나만 남긴다 (감면 뒤에 잘라야 빠르다)
  if (r.isolate) await isolateFigure(tmp, tmp, r.isolate);
  if (r.kind === 'dragon') {
    await rigDragonTower(tmp, r.output, r.targetHeight);
  } else if (r.kind === 'trap') {
    await rigTrap(tmp, r.output, {
      diameter: r.diameter ?? 52,
      spikeTop: r.spikeTop ?? 0.57,
    });
  } else if (r.kind === 'tower') {
    await rigTower(tmp, r.output, {
      kind: r.towerKind ?? 'bows',
      bowY: r.bowY ?? 0.76,
      targetHeight: r.targetHeight,
      bowCount: r.bows ?? 5,
      debug: 'none',
      deckTop: r.deckTop,
      cannonRadius: r.cannonRadius,
      protrudeRadius: r.protrudeRadius,
      gapDeg: r.gapDeg,
      sectorPadDeg: r.sectorPadDeg,
      barrelLift: r.barrelLift,
    });
  } else {
    await rig(tmp, r.output, {
      bodyKind: r.bodyKind ?? 'humanoid',
      forwardDeg: r.forwardDeg,
      targetHeight: r.targetHeight,
      armMode: r.armMode ?? 'single',
      attackStyle: r.attackStyle ?? 'thrust',
      cadence: r.cadence ?? 0.9,
      walkStride: r.walkStride ?? 0.38,
      kneeBend: r.kneeBend ?? 0.3,
      legCloseFactor: r.legCloseFactor ?? 0.3,
      staff: r.staff,
      blade: r.blade,
      skirt: r.skirt,
      bulky: r.bulky,
      bodyTopRatio: r.bodyTopRatio,
      footRadius: r.footRadius,
      weaponSide: r.weaponSide,
      backProp: r.backProp,
      bodyAxis: r.bodyAxis,
      rigidArms: r.rigidArms,
      robeGait: r.robeGait,
    });
  }
  unlinkSync(tmp);
  if (r.kind === 'dragon') {
    const version = createHash('sha256').update(readFileSync(r.output)).digest('hex').slice(0, 12);
    const manifestPath = 'public/assets/manifest.json';
    const manifest = readFileSync(manifestPath, 'utf8');
    const next = manifest.replace(/("fire_tower"\s*:\s*\{\s*"url"\s*:\s*")[^"]+/, `$1models/fire_tower.glb?v=${version}`);
    if (next !== manifest) writeFileSync(manifestPath, next);
  }
}

const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const name of names.length > 0 ? names : Object.keys(RECIPES)) {
  await bake(name);
}
