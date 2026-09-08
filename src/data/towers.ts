import type { TowerDef, TowerLevelDef } from '../types/towers';
import type { PrimitiveSpec } from '../types/primitives';
import { BALANCE } from './balance';

/**
 * 표에 적힌 피해에 난이도 손잡이 둘을 곱한다.
 *
 *   towerDamageMul       모든 레벨에 똑같이 (1레벨 망루도 그만큼 약해진다)
 *   towerLevelFalloff    레벨이 오를수록 더 깎는다 — n레벨에 falloff^(n-1)
 *
 * 아래 다섯 표의 수치에는 "왜 이 값인가"가 주석으로 붙어 있다(벽력거가 1발인 이유,
 * 화공 망루가 2·2·2·3·3 인 이유). 난이도를 조이자고 그 숫자를 하나씩 고치면
 * 근거가 전부 거짓말이 되므로, 표는 그대로 두고 곱하는 값만 밖에서 정한다.
 * 철질려처럼 피해가 0인 타워는 0으로 남는다 — 감속 타워를 실수로 공격 타워로 만들지 않는다.
 */
function scaled(levels: TowerLevelDef[]): TowerLevelDef[] {
  const { towerDamageMul, towerLevelFalloff } = BALANCE.difficulty;
  return levels.map((lv, i) => {
    const mul = towerDamageMul * Math.pow(towerLevelFalloff, i);
    return {
      ...lv,
      damagePerArrow: lv.damagePerArrow === 0 ? 0 : Math.max(1, Math.round(lv.damagePerArrow * mul)),
    };
  });
}

const WOOD = '#6b4f32';
const WOOD_DARK = '#4a3622';
const STONE = '#8a8578';
const ROOF = '#7a2e2e';

/**
 * 사각 기단 박스 + 원기둥 몸통 + 원뿔 지붕.
 * 레벨(=화살 수)만큼 지붕 둘레에 활 표식(작은 박스)을 배치한다 — 몇 발인지 눈으로 보인다.
 */
function towerPrimitive(level: number): PrimitiveSpec {
  // 지붕 처마 반경. 활 표식은 반드시 이 바깥에 세워야 위에서 보인다 —
  // 45도 부감에서 지붕 밑에 넣으면 표식이 통째로 가려져 몇 발인지 알 수 없다.
  const roofRadius = 17;
  const markRadius = 19.5;
  const markY = 49;

  const arrowMarks: PrimitiveSpec['parts'] = [];
  for (let i = 0; i < level; i++) {
    // -PI/2 에서 시작해 시계방향. 화살 수가 늘면 둘레에 고르게 퍼진다.
    const a = (i / level) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(a) * markRadius;
    const cz = Math.sin(a) * markRadius;
    // 화살대
    arrowMarks.push({
      shape: 'cylinder',
      size: [1.1, 1.1, 13],
      offset: [cx, markY, cz],
      color: '#e8d9a0',
      roughness: 0.6,
      tag: `arrowmark_${i}`,
    });
    // 화살촉 — 위에서 볼 때 밝은 점으로 읽힌다
    arrowMarks.push({
      shape: 'cone',
      size: [2.4, 5],
      offset: [cx, markY + 8.5, cz],
      color: '#fff2c4',
      roughness: 0.4,
      metalness: 0.3,
      tag: `arrowtip_${i}`,
    });
  }

  return {
    parts: [
      { shape: 'box', size: [36, 9, 36], offset: [0, 4.5, 0], color: STONE, roughness: 0.95, tag: 'base' },
      { shape: 'cylinder', size: [9, 12, 34], offset: [0, 26, 0], color: WOOD, roughness: 0.9, tag: 'body' },
      // 난간 데크 — 활 표식이 서는 바닥. 지붕보다 넓어야 한다.
      { shape: 'cylinder', size: [22, 22, 4], offset: [0, 45, 0], color: WOOD_DARK, roughness: 0.9, tag: 'deck' },
      { shape: 'cone', size: [roofRadius, 17], offset: [0, 56, 0], color: ROOF, roughness: 0.85, tag: 'roof' },
      ...arrowMarks,
    ],
  };
}

/**
 * 궁노 망루 레벨 표 (전제 블록 확정 수치).
 * range는 5레벨 전부 100 — 사거리 증가는 향후 다른 타워의 차별점으로 남긴다.
 */
/**
 * 활 망루는 레벨마다 다른 모델을 쓰지 않는다 — 하나의 GLTF 안에 쇠뇌가 다섯 개 있고,
 * 뷰가 레벨 수만큼만 보여준다(TowerView). 매니페스트에서 이 id 를 지우면
 * 아래 프리미티브(지붕의 활 표식)로 되돌아간다.
 */
const ARCHER_MODEL = 'archer_tower';

const ARCHER_LEVELS: TowerLevelDef[] = scaled([
  { arrows: 1, damagePerArrow: 10, fireInterval: 1.0, range: 100, upgradeCost: null, view: { primitive: towerPrimitive(1), modelId: ARCHER_MODEL } },
  { arrows: 2, damagePerArrow: 13, fireInterval: 0.95, range: 100, upgradeCost: 100, view: { primitive: towerPrimitive(2), modelId: ARCHER_MODEL } },
  { arrows: 3, damagePerArrow: 17, fireInterval: 0.9, range: 100, upgradeCost: 150, view: { primitive: towerPrimitive(3), modelId: ARCHER_MODEL } },
  { arrows: 4, damagePerArrow: 22, fireInterval: 0.85, range: 100, upgradeCost: 200, view: { primitive: towerPrimitive(4), modelId: ARCHER_MODEL } },
  { arrows: 5, damagePerArrow: 28, fireInterval: 0.8, range: 100, upgradeCost: 250, view: { primitive: towerPrimitive(5), modelId: ARCHER_MODEL } },
]);

/**
 * 투석기(벽력거) — 범위 피해, 느린 발사.
 * 공성 피해라 방패병의 원거리 저항을 무시한다. 뭉친 적에게 강하고 단일 대상엔 약하다.
 */
function catapultPrimitive(level: number): PrimitiveSpec {
  const stones: PrimitiveSpec['parts'] = [];
  for (let i = 0; i < Math.min(level, 4); i++) {
    stones.push({
      shape: 'sphere',
      size: [4],
      offset: [-13 + i * 8, 12, 15],
      color: '#6e6a62',
      roughness: 1,
      tag: `stone_${i}`,
    });
  }
  return {
    parts: [
      { shape: 'box', size: [40, 8, 40], offset: [0, 4, 0], color: STONE, roughness: 0.95, tag: 'base' },
      // 받침대
      { shape: 'box', size: [30, 6, 14], offset: [0, 11, 0], color: WOOD_DARK, roughness: 0.9, tag: 'frame' },
      // A자 지지대
      { shape: 'cylinder', size: [2, 2, 30], offset: [-8, 24, 0], rotation: [0, 0, 0.28], color: WOOD, roughness: 0.9 },
      { shape: 'cylinder', size: [2, 2, 30], offset: [8, 24, 0], rotation: [0, 0, -0.28], color: WOOD, roughness: 0.9 },
      // 던지는 팔 — 위에서 봐도 방향이 읽힌다
      { shape: 'cylinder', size: [1.8, 1.8, 40], offset: [0, 33, -8], rotation: [0.9, 0, 0], color: '#5b4632', roughness: 0.9, tag: 'arm' },
      // 팔 끝 바구니
      { shape: 'cylinder', size: [6, 5, 5], offset: [0, 44, -22], color: '#4a3826', roughness: 1, tag: 'basket' },
      // 장전된 돌 — 레벨만큼 쌓인다
      ...stones,
    ],
  };
}

/**
 * 벽력거는 레벨이 올라도 발사체가 계속 1개다 — 이게 궁노 망루와의 결정적 차이다.
 *
 * 궁노의 N발은 서로 다른 적에게 흩어진다. 무리를 상대할 땐 그게 강점이지만,
 * 체력 2400짜리 여포 하나를 상대할 땐 화살 5발 중 1발만 꽂힌다는 뜻이 된다.
 * 실제로 벽력거를 2발로 두었더니 여포가 매번 성까지 도달했다.
 * 한 발에 몰아주는 이 타워가 방패병과 장수 양쪽의 답이 된다.
 */
/** 벽력거도 레벨마다 모델을 바꾸지 않는다 — 팔 하나가 돌아가는 투석기 하나다. */
const CATAPULT_MODEL = 'catapult';

const CATAPULT_LEVELS: TowerLevelDef[] = scaled([
  { arrows: 1, damagePerArrow: 40, fireInterval: 2.4, range: 150, upgradeCost: null, view: { primitive: catapultPrimitive(1), modelId: CATAPULT_MODEL } },
  { arrows: 1, damagePerArrow: 62, fireInterval: 2.3, range: 150, upgradeCost: 160, view: { primitive: catapultPrimitive(2), modelId: CATAPULT_MODEL } },
  { arrows: 1, damagePerArrow: 95, fireInterval: 2.2, range: 150, upgradeCost: 220, view: { primitive: catapultPrimitive(3), modelId: CATAPULT_MODEL } },
  { arrows: 1, damagePerArrow: 145, fireInterval: 2.1, range: 150, upgradeCost: 300, view: { primitive: catapultPrimitive(4), modelId: CATAPULT_MODEL } },
  { arrows: 1, damagePerArrow: 230, fireInterval: 2.0, range: 150, upgradeCost: 380, view: { primitive: catapultPrimitive(5), modelId: CATAPULT_MODEL } },
]);

/**
 * 철질려 진지 — 투사체 없이 사거리 안 적을 감속시킨다.
 * 피해가 0이므로 단독으로는 아무것도 죽이지 못한다. 다른 타워의 사거리를 늘려주는 장치다.
 */
function caltropPrimitive(level: number): PrimitiveSpec {
  const spikes: PrimitiveSpec['parts'] = [];
  const count = 3 + level * 2;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = 13 + (i % 2) * 6;
    spikes.push({
      shape: 'cone',
      size: [2.6, 9],
      offset: [Math.cos(a) * r, 9, Math.sin(a) * r],
      color: '#9aa0a6',
      roughness: 0.5,
      metalness: 0.45,
      tag: `spike_${i}`,
    });
  }
  return {
    parts: [
      { shape: 'cylinder', size: [24, 26, 8], offset: [0, 4, 0], color: '#5a4a35', roughness: 1, tag: 'base' },
      // 가운데 말뚝과 밧줄 고리
      { shape: 'cylinder', size: [3, 3.5, 22], offset: [0, 15, 0], color: WOOD_DARK, roughness: 0.95, tag: 'post' },
      { shape: 'torus', size: [9, 1.6], offset: [0, 20, 0], rotation: [Math.PI / 2, 0, 0], color: '#7d6a4a', roughness: 1, tag: 'rope' },
      ...spikes,
    ],
  };
}

/**
 * 철질려도 레벨마다 모델을 바꾸지 않는다 — 마름쇠를 더 뿌린다고 다른 진지가 되지는 않는다.
 * 프리미티브는 가시 수로 레벨을 보였지만, 모델 쪽은 넓어지는 사거리 고리가 그 일을 한다.
 */
const CALTROP_MODEL = 'caltrop_camp';

/**
 * arrows = 한 번에 감속을 거는 대상 수. 후반 웨이브는 40기가 한꺼번에 지나가므로
 * 레벨이 오르면 사실상 전원을 잡아야 값을 한다.
 */
const CALTROP_LEVELS: TowerLevelDef[] = scaled([
  { arrows: 5, damagePerArrow: 0, fireInterval: 0.5, range: 115, upgradeCost: null, view: { primitive: caltropPrimitive(1), modelId: CALTROP_MODEL } },
  { arrows: 9, damagePerArrow: 0, fireInterval: 0.5, range: 120, upgradeCost: 90, view: { primitive: caltropPrimitive(2), modelId: CALTROP_MODEL } },
  { arrows: 15, damagePerArrow: 0, fireInterval: 0.5, range: 130, upgradeCost: 130, view: { primitive: caltropPrimitive(3), modelId: CALTROP_MODEL } },
  { arrows: 24, damagePerArrow: 0, fireInterval: 0.5, range: 140, upgradeCost: 180, view: { primitive: caltropPrimitive(4), modelId: CALTROP_MODEL } },
  { arrows: 999, damagePerArrow: 0, fireInterval: 0.5, range: 150, upgradeCost: 240, view: { primitive: caltropPrimitive(5), modelId: CALTROP_MODEL } },
]);

/**
 * 화공 망루 — 데크에 대포를 둘러 세우고 소이탄을 쏜다.
 *
 * 이 타워의 피해는 두 겹이다. 직격 피해는 일부러 낮게 두었고, 값은 착탄 지점에
 * 남는 불이 한다. 그래서 "한 마리를 빨리 죽인다"가 아니라 "지나가는 줄 전체를
 * 태운다"가 된다 — 물량으로 밀어붙이는 대열의 답이다.
 *
 * 대신 화염 피해라 fireResist를 정면으로 맞는다. 젖은 형주 수군(5장) 앞에서는
 * 거의 아무 일도 못 한다. 그게 다음 장에 화포가 필요한 이유다.
 *
 * 5장의 화포 진지와 헷갈리지 않는 이유는 피해 종류다. 이쪽은 불(fire)이라
 * 젖은 적에게 막히고 마른 등갑에 두 배로 들어가고, 화포는 공성(siege)이라
 * 저항을 통째로 무시한다. 둘 다 대포를 쏘지만 답이 되는 자리가 정반대다.
 */
function fireTowerPrimitive(level: number): PrimitiveSpec {
  const braziers: PrimitiveSpec['parts'] = [];
  // 가마가 레벨만큼 는다 — 위에서 봐도 몇 개인지 세어진다
  for (let i = 0; i < level; i++) {
    const a = (i / level) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(a) * 17;
    const cz = Math.sin(a) * 17;
    braziers.push({
      shape: 'cylinder',
      size: [4.2, 3.2, 7],
      offset: [cx, 43, cz],
      color: '#3a2a20',
      roughness: 0.9,
      tag: `brazier_${i}`,
    });
    braziers.push({
      shape: 'sphere',
      size: [3.4],
      offset: [cx, 48, cz],
      color: '#ff8a2a',
      roughness: 0.3,
      tag: `ember_${i}`,
    });
  }
  return {
    parts: [
      { shape: 'box', size: [34, 9, 34], offset: [0, 4.5, 0], color: STONE, roughness: 0.95, tag: 'base' },
      // 돌 화덕 — 나무가 아니라 돌이다. 불을 다루는 타워라는 표식.
      { shape: 'cylinder', size: [11, 14, 30], offset: [0, 24, 0], color: '#6a6058', roughness: 0.95, tag: 'body' },
      { shape: 'cylinder', size: [19, 19, 4], offset: [0, 41, 0], color: '#4a3622', roughness: 0.9, tag: 'deck' },
      // 가마솥 — 위에서 보면 이 붉은 원이 먼저 읽힌다
      { shape: 'cylinder', size: [12, 10, 9], offset: [0, 48, 0], color: '#3b2a22', roughness: 0.85, tag: 'cauldron' },
      { shape: 'cylinder', size: [10.5, 10.5, 2], offset: [0, 52.5, 0], color: '#ff6a12', roughness: 0.25, tag: 'oil' },
      ...braziers,
    ],
  };
}

/**
 * 화면에 선 **포문 수는 레벨과 같다**(1레벨 한 문 ~ 5레벨 다섯 문). 그건 뷰가 한다 —
 * TowerView 가 `bowN` 뼈를 레벨 수만큼만 펴고 나머지는 접는다.
 *
 * 그런데 한 번에 나가는 발수(arrows)는 레벨과 같지 않다. 2·2·2·3·3 이다.
 * 둘을 억지로 맞춰 보았다가 되돌렸다 — arrows 를 1~5 로 바꾸면 착탄이 늘어난
 * 만큼 불구덩이도 1~5개로 늘어나서, 4장이 성문 없이도 이기게 되고(교훈이 깨진다)
 * 그걸 불의 성장률로 눌렀더니 이번엔 5장이 11파에서 무너졌다. 이 표는 여섯 장의
 * 밸런스가 얹혀 있는 자리라 연출 때문에 흔들 수 없다.
 *
 * 대신 뷰가 **쏘는 문을 돌려 가며** 고른다(TowerView.fire). 5레벨에서 한 번에
 * 세 발이 나가더라도 다음 발사는 다음 세 문이 맡으므로, 다섯 문이 모두 제 몫을 한다.
 *
 * 레벨이 오르면 던지는 발수가 아니라 **불이 커진다** — 화공 망루는 늘 두세 발을 쏘고,
 * 대신 그 불이 레벨마다 1.5배씩 뜨거워진다(ignite.dpsPerLevel).
 */
/*
 * 화공 망루는 지금 모델이 없다 — 프리미티브로 돈다.
 *
 * 한동안 img/cannon.glb 로 구운 포대를 빌려 썼는데, 그 모델은 대포 진지라
 * 5장 화포와 실루엣이 겹쳤다(같은 데크, 같은 포문 링). 포대는 화포 진지로 넘기고
 * 화공 망루는 불을 다루는 망루로 새로 디자인한다.
 */
const FIRE_TOWER_LEVELS: TowerLevelDef[] = scaled([
  { arrows: 2, damagePerArrow: 9, fireInterval: 1.5, range: 105, upgradeCost: null, view: { modelId: 'fire_tower', primitive: fireTowerPrimitive(1) } },
  { arrows: 2, damagePerArrow: 12, fireInterval: 1.45, range: 110, upgradeCost: 130, view: { modelId: 'fire_tower', primitive: fireTowerPrimitive(2) } },
  { arrows: 2, damagePerArrow: 16, fireInterval: 1.4, range: 115, upgradeCost: 190, view: { modelId: 'fire_tower', primitive: fireTowerPrimitive(3) } },
  { arrows: 3, damagePerArrow: 20, fireInterval: 1.35, range: 120, upgradeCost: 260, view: { modelId: 'fire_tower', primitive: fireTowerPrimitive(4) } },
  { arrows: 3, damagePerArrow: 26, fireInterval: 1.3, range: 125, upgradeCost: 330, view: { modelId: 'fire_tower', primitive: fireTowerPrimitive(5) } },
]);

/**
 * 화포 진지 — 포탄을 곧게 쏘아 지면을 강타한다.
 *
 * 벽력거와 뭐가 다른가. 벽력거는 한 발을 가장 단단한 적에게 몰아주는 대장수용이고,
 * 이쪽은 선두를 노려 **넓게** 터뜨린 뒤 그 자리에 불을 남긴다. 사거리도 더 길다.
 * 값이 비싸고 발사가 느려서 혼자로는 방어선이 되지 않는다 — 뒤를 받치는 대포다.
 */
function cannonPrimitive(level: number): PrimitiveSpec {
  const barrels: PrimitiveSpec['parts'] = [];
  // 포신 수 = 그 레벨의 발사 수. 몇 발 나가는지가 모델에 그대로 보인다.
  const count = level >= 5 ? 3 : level >= 3 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const cx = (i - (count - 1) / 2) * 11;
    barrels.push({
      shape: 'cylinder',
      size: [4.6, 5.4, 34],
      offset: [cx, 26, -6],
      rotation: [1.32, 0, 0],
      color: '#3f4348',
      roughness: 0.45,
      metalness: 0.7,
      tag: `barrel_${i}`,
    });
    // 포구 — 앞을 향한 어두운 점
    barrels.push({
      shape: 'cylinder',
      size: [3.4, 3.4, 3],
      offset: [cx, 30, -21],
      rotation: [1.32, 0, 0],
      color: '#17181a',
      roughness: 1,
      tag: `muzzle_${i}`,
    });
  }
  const shot: PrimitiveSpec['parts'] = [];
  for (let i = 0; i < Math.min(level, 4); i++) {
    shot.push({
      shape: 'sphere',
      size: [3.6],
      offset: [-12 + i * 8, 11, 15],
      color: '#2b2d30',
      roughness: 0.5,
      metalness: 0.6,
      tag: `shot_${i}`,
    });
  }
  return {
    parts: [
      { shape: 'box', size: [42, 9, 42], offset: [0, 4.5, 0], color: STONE, roughness: 0.95, tag: 'base' },
      // 흙자루 방벽 — 포대라는 인상을 준다
      { shape: 'box', size: [40, 10, 8], offset: [0, 12, 17], color: '#6b5a3f', roughness: 1, tag: 'sandbag' },
      { shape: 'box', size: [30, 7, 16], offset: [0, 12, -2], color: WOOD_DARK, roughness: 0.9, tag: 'carriage' },
      { shape: 'cylinder', size: [6, 6, 3], offset: [-15, 10, -2], rotation: [0, 0, Math.PI / 2], color: WOOD, roughness: 0.9, tag: 'wheelL' },
      { shape: 'cylinder', size: [6, 6, 3], offset: [15, 10, -2], rotation: [0, 0, Math.PI / 2], color: WOOD, roughness: 0.9, tag: 'wheelR' },
      ...barrels,
      ...shot,
    ],
  };
}

/**
 * 화포 진지도 레벨마다 모델을 바꾸지 않는다 — 데크의 포문이 레벨 수만큼 보인다.
 * 프리미티브 쪽은 포신 수가 발사 수(1·1·2·2·3)였지만, 모델은 포문 수가 레벨(1~5)이다.
 * 둘을 맞추려면 밸런스 표를 흔들어야 해서 그대로 둔다 — 어느 쪽이든 "레벨이 오르면
 * 포가 는다"로 읽힌다.
 */
const CANNON_MODEL = 'cannon_tower';

/**
 * 화포는 레벨이 오르면 발수가 는다 — 궁노와 달리 한 발 한 발이 폭발이라
 * 2발이 되는 3레벨에서 체감이 크게 꺾인다. 그 지점이 이 타워의 값이다.
 */
const CANNON_LEVELS: TowerLevelDef[] = scaled([
  { arrows: 1, damagePerArrow: 58, fireInterval: 2.6, range: 175, upgradeCost: null, view: { primitive: cannonPrimitive(1), modelId: CANNON_MODEL } },
  { arrows: 1, damagePerArrow: 88, fireInterval: 2.5, range: 180, upgradeCost: 200, view: { primitive: cannonPrimitive(2), modelId: CANNON_MODEL } },
  { arrows: 2, damagePerArrow: 78, fireInterval: 2.4, range: 190, upgradeCost: 280, view: { primitive: cannonPrimitive(3), modelId: CANNON_MODEL } },
  { arrows: 2, damagePerArrow: 112, fireInterval: 2.3, range: 200, upgradeCost: 360, view: { primitive: cannonPrimitive(4), modelId: CANNON_MODEL } },
  { arrows: 3, damagePerArrow: 138, fireInterval: 2.2, range: 210, upgradeCost: 450, view: { primitive: cannonPrimitive(5), modelId: CANNON_MODEL } },
]);

export const TOWERS: Record<string, TowerDef> = {
  archer_tower: {
    id: 'archer_tower',
    displayName: '궁노 망루',
    description: '화살이 서로 다른 적을 노린다. 무리에 두루 강하다.',
    buildCost: 100,
    sellRatio: BALANCE.defaultSellRatio,
    kind: 'projectile',
    damageKind: 'ranged',
    targeting: 'first',
    projectile: { speed: 320, arcHeight: 18 },
    levels: ARCHER_LEVELS,
  },

  catapult: {
    id: 'catapult',
    displayName: '벽력거',
    description: '공성 피해로 범위를 친다. 방패병과 뭉친 적에게 강하다.',
    buildCost: 220,
    sellRatio: BALANCE.defaultSellRatio,
    kind: 'projectile',
    damageKind: 'siege',
    targeting: 'strongest',
    projectile: { speed: 190, arcHeight: 95 },
    levels: CATAPULT_LEVELS,
    effect: { type: 'splash', params: { radius: 62, falloff: 0.55 } },
    unlockedIn: 'level02',
  },

  fire_tower: {
    id: 'fire_tower',
    displayName: '화공 망루',
    description: '용머리가 화염을 내뿜어 지면과 적을 태운다. 레벨마다 용머리가 하나씩 는다.',
    buildCost: 160,
    sellRatio: BALANCE.defaultSellRatio,
    kind: 'projectile',
    damageKind: 'fire',
    // 선두를 노려야 불이 대열의 앞에 깔린다 — 뒤따라오는 줄이 그 위를 지나간다.
    targeting: 'first',
    projectile: { speed: 230, arcHeight: 8 },
    levels: FIRE_TOWER_LEVELS,
    effect: { type: 'splash', params: { radius: 40, falloff: 0.6 } },
    /**
     * 1레벨부터 태운다. 다른 타워와 달리 이게 이 타워의 전부이므로
     * BALANCE.fire 의 "3레벨부터" 기본값을 쓰지 않는다.
     * dpsPerLevel 1.5 — 5레벨이면 불의 화력이 5배가 된다.
     */
    ignite: { fromLevel: 1, radius: 52, dps: 26, duration: 3.6, dpsPerLevel: 1.5, source: 'flame' },
    // 화염은 입의 분사와 지면의 연소로 표현한다. 포탄 폭발은 사용하지 않는다.
    unlockedIn: 'level04',
  },

  cannon_tower: {
    id: 'cannon_tower',
    displayName: '화포 진지',
    description: '포탄이 지면을 강타해 크게 터지고 불구덩이를 남긴다. 사거리가 길다.',
    buildCost: 300,
    sellRatio: BALANCE.defaultSellRatio,
    kind: 'projectile',
    damageKind: 'siege',
    targeting: 'first',
    // 곧게 쏘는 대포다 — 벽력거(95)처럼 높이 뜨지 않는다.
    projectile: { speed: 340, arcHeight: 26 },
    levels: CANNON_LEVELS,
    effect: { type: 'splash', params: { radius: 88, falloff: 0.45 } },
    /** 포탄은 3레벨부터 작렬탄이 된다 — 그때부터 지면에 불구덩이가 남는다. */
    ignite: { fromLevel: 3, radius: 66, dps: 30, duration: 4.6, dpsPerLevel: 1.35, source: 'shell' },
    /** 화공 망루보다 굵은 포다. 섬광도 연기도 크고 화면도 더 흔들린다. */
    muzzleBlast: { flash: 1.4, smoke: 1.6, shake: 0.3 },
    unlockedIn: 'level05',
  },

  caltrop_camp: {
    id: 'caltrop_camp',
    displayName: '철질려 진지',
    description: '피해는 없지만 적을 늦춘다. 기병을 묶어 다른 망루에 시간을 준다.',
    buildCost: 120,
    sellRatio: BALANCE.defaultSellRatio,
    kind: 'aura',
    damageKind: 'ranged',
    targeting: 'first',
    projectile: { speed: 1, arcHeight: 0 },
    levels: CALTROP_LEVELS,
    /**
     * 감속이 진지 밖까지 이어지는 것이 이 타워의 존재 이유다.
     * duration이 짧으면 사거리를 벗어나는 순간 원래 속도로 돌아가 버려서
     * "뒤에 있는 망루에 시간을 벌어준다"가 성립하지 않는다.
     * 실측: 0.55배 1.2초로는 슬롯 하나 값을 못 했다(누수 21 vs 미설치 13).
     */
    effect: { type: 'slow', params: { speedMul: 0.42, duration: 2.6 } },
    unlockedIn: 'level02',
  },
};

export function getTower(id: string): TowerDef {
  const t = TOWERS[id];
  if (!t) throw new Error(`unknown tower id: ${id}`);
  return t;
}

export const TOWER_LIST: TowerDef[] = Object.values(TOWERS);

/** UI 비교 표시용 DPS. arrows * damage / interval. aura 타워는 0이다. */
export function towerDps(def: TowerDef, levelIndex: number): number {
  const lv = def.levels[levelIndex];
  return (lv.arrows * lv.damagePerArrow) / lv.fireInterval;
}

/** level 1..n 까지 올리는 데 든 총 투자액 (건설비 + 업그레이드비) */
export function totalInvestedFor(def: TowerDef, level: number): number {
  let sum = def.buildCost;
  for (let i = 1; i < level; i++) sum += def.levels[i].upgradeCost ?? 0;
  return sum;
}
