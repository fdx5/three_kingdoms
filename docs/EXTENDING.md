# 확장하기

각 절차가 10줄 안에 끝나지 않으면 확장성 5원칙 중 뭔가가 깨진 것이다.

| 하고 싶은 것    | 손대는 곳                                       | 분량            |
| --------------- | ----------------------------------------------- | --------------- |
| 새 적 유닛      | `data/units.ts` + 웨이브 `inserts`              | 항목 1개        |
| 3D 모델 교체    | `public/assets/manifest.json`                   | 1줄             |
| 밸런스 조정     | `data/balance.ts`, `data/levels/*.ts`           | 숫자만          |
| 새 레벨         | `data/levels/levelNN.ts`                        | 파일 1개        |
| 새 타워 종류    | `data/towers.ts` + `sim/effects/` 함수 1개      | 항목 1 + 함수 1 |
| BGM/효과음 교체 | `manifest.json` + `audio/soundMap.ts`           | 1~2줄           |
| 맵 분위기       | `levels/*.ts` 의 `environment` + 텍스처         | 색상값 + 텍스처 |

---

## 확장성 5원칙

이 다섯 가지가 위 표를 성립시킨다.

1. **모든 밸런스 수치는 `src/data/` 안에만 있다.** 다른 곳의 매직넘버는 버그다.
2. **`src/sim/`, `src/core/`, `src/data/` 는 three를 import하지 않는다.**
   ESLint `no-restricted-imports` 가 강제한다 — 위반하면 `npm run lint` 가 실패한다.
   덕분에 렌더 없이 헤드리스로 20웨이브를 돌려 밸런스를 검증할 수 있다.
3. **모든 시각 표현은 `EntityView` 인터페이스 뒤에 있다.**
   프리미티브 → GLTF 교체가 `AssetRegistry` 한 곳에서 끝난다.
4. **sim은 이벤트만 발행한다.** VFX/오디오/HUD는 구독만 한다. 역방향 의존 금지.
5. **에셋이 없어도 게임이 돈다.** 모델 없으면 프리미티브, 음원 없으면 무음.

---

## 새 적 유닛 추가

`src/data/units.ts` 에 항목 하나:

```ts
yt_cavalry: {
  id: 'yt_cavalry',
  displayName: '황건 기병',
  faction: 'yellow_turban',
  hp: 40, speed: 90,            // 고속·저체력
  goldOnKill: 15, castleDamage: 30,
  scale: 1.2, kind: 'minion',
  view: { primitive: infantryPrimitive('#5a3b2a', '#d4a017') },
  audio: { die: 'sfx_die_small' },
},
```

그다음 `src/data/levels/level01.ts` 의 `inserts` 에 끼워 넣는다:

```ts
inserts: {
  7:  [{ unitId: 'yt_cavalry', atRatio: 0.3 }, { unitId: 'yt_cavalry', atRatio: 0.6 }],
  10: [{ unitId: 'yt_captain', atRatio: 0.5 }],
}
```

`inserts` 로 넣은 유닛은 웨이브 성장 배율을 받지 않고 **원본 스탯 그대로** 나온다.
성장시키고 싶다면 `unitId` 를 `generateWaves` 의 기본 유닛으로 바꿔야 한다.

모델을 붙이려면 `view.modelId: 'yt_cavalry'` 를 추가하고 manifest에 한 줄.

---

## 새 타워 종류 추가

`src/data/towers.ts` 에 항목 하나. 레벨 배열 길이는 자유다(코드는 `levels.length` 를 본다).

```ts
catapult: {
  id: 'catapult',
  displayName: '투석기',
  buildCost: 220,
  sellRatio: BALANCE.defaultSellRatio,
  targeting: 'strongest',
  projectile: { speed: 180, arcHeight: 90 },
  levels: [ /* TowerLevelDef 배열 */ ],
  effect: { type: 'splash', params: { radius: 60, falloff: 0.5 } },
},
```

`effect` 는 확장 지점이다. `src/sim/effects/` 에 함수 하나를 만들고
`World.damageEnemy` 에서 분기하면 된다:

```ts
// src/sim/effects/splash.ts
export function applySplash(world: World, x: number, z: number, damage: number, params) { ... }
```

`targeting` 네 종류(`first` / `last` / `strongest` / `closest`)는 이미 전부 구현되어 있고
타워 패널에 노출된다. 새 타워는 그대로 재사용하면 된다.

**해금 레벨** — `unlockedIn: 'level02'` 를 넣으면 그 장부터 지을 수 있다.
없으면 처음부터다. 건설 패널은 지을 수 있는 타워가 둘 이상이면 선택 행을
자동으로 띄우므로(`TowerPanel.setBuildable`), 타워를 추가하는 데 UI 작업은 없다.

**발사체의 모습은 `damageKind` 가 정한다.** `siege` 면 굴러가는 바위, 그 외면 화살이다
(`ProjectileView.setKind`). 그리고 쏜 타워의 레벨이 같이 넘어가므로,
Lv3부터 달군 바위, Lv5에서 불덩이가 된다 — 발사체가 1개뿐인 타워에서
업그레이드를 눈으로 보여주는 유일한 수단이다. 단계 기준은 `heatOf()` 한 곳에 있다.

**여러 발을 쏘는 타워는 뷰가 알아서 흩는다.** 시뮬이 화살마다 `salvoIndex/salvoSize`
를 붙여 주고, 뷰가 그 값으로 출발점·포물선 높이·출발 시점을 어긋나게 해
N발이 N발로 보이게 한다. 타워 쪽에서 할 일은 없다.

**`kind: 'aura'`** 는 투사체 없이 사거리 안 대상에게 `effect` 를 바로 건다.
철질려 진지가 이 방식이다. 이때 `arrows` 는 화살 수가 아니라 동시 대상 수이고,
패널도 그렇게 표시한다.

---

## 새 레벨 추가

`src/data/levels/level03.ts` 파일 하나 (`level02.ts` 가 실제 예시다):

```ts
export const LEVEL_03: LevelDef = {
  id: 'level03',
  title: '...',
  castle: { id: 'chang_an', hp: 500 },     // 누수가 실제 위협이 되도록 낮춘다
  startGold: 600,
  waveInterval: 18,        // 없으면 BALANCE.waveInterval
  allowRepair: true,       // 성벽 수리 해금
  stars: { three: 0.6, two: 0.35 },        // 없으면 BALANCE.stars
  path: [[0, 350], /* ... */],
  buildSlots: [{ id: 's3_a', x: 210, z: 220 }, /* ... */],  // 추천 자리(지형 평탄화 + 한도 기본값)
  maxTowers: 7,            // 없으면 buildSlots.length. 자리는 자유, 개수만 레벨이 정한다
  waves: generateWaves({ /* ... */ }),
  environment: { skyColor: '...', groundColor: '...', /* ... */ },
};
```

그리고 `src/data/levels/index.ts` 의 `LEVEL_ORDER` 배열에 한 줄 추가한다.
배열 순서가 곧 진행 순서이자 해금 순서다 (`ui/progress.ts`).

### 경로 설계 규칙

- 총 길이 1800~2200 u (보병이 40초 안팎에 통과한다)
- 최소 4회 크게 꺾을 것
- **좋은 자리를 만들려면 헤어핀(U턴)이 필요하다.** 두 평행 구간의 간격을
  120 u 로 두고 그 사이에 망루를 놓으면 약 380 u 를 덮는다.
  직각 모퉁이는 이론상 최대 283 u 라 300 u 기준을 넘지 못한다
- 타워는 이제 **빈 땅 아무 데나** 세운다. 레벨이 정하는 것은 자리가 아니라 개수(`maxTowers`)이고,
  어디가 빈 땅인지는 `BALANCE.placement` 가 정한다(길에서 46 u, 성문에서 100 u,
  타워끼리 44 u, 가장자리 40 u). 그러므로 경로를 설계할 때 생각할 것은
  "좋은 자리를 몇 개 만들 것인가"가 아니라 **"몇 기로 이 길을 감당하게 할 것인가"**다.
- `buildSlots` 는 남아 있다 — 추천 자리이자 지형을 평탄하게 깎는 지점이고,
  헤드리스 시뮬(`npm run sim`)의 기본 배치이기도 하다. 여기 적은 자리는
  `tests/placement.test.ts` 가 전부 실제로 지을 수 있는지 검사한다.

`tests/data.test.ts` 를 새 레벨에도 돌리면 이 규칙들이 자동으로 검사된다.

---

## 새 계략 추가

`src/data/stratagems.ts` 에 항목 하나:

```ts
scorched_earth: {
  id: 'scorched_earth',
  displayName: '청야',
  glyph: '野',
  description: '...',
  cost: 300,
  cooldown: 40,
  effect: { type: 'field_slow', params: { speedMul: 0.5, duration: 5 } },
},
```

그리고 그 계략을 쓸 레벨의 `stratagems: [...]` 배열에 id를 넣는다.
HUD 카드와 상태 표시(쿨다운·골드 부족·대상 없음)는 자동으로 붙는다.

효과 종류가 새로 필요하면 `src/types/stratagems.ts` 의 `StratagemEffect` 유니온에
한 줄, `World.castStratagem` 의 switch에 한 갈래를 더한다. 이때 두 가지를 지킬 것:

- **타워를 대신하면 안 된다.** 계략 한 장이 그 레벨의 정답 타워를 무의미하게 만들면
  레벨이 가르치려던 것이 통째로 사라진다 (docs/BALANCE.md "계략" 참고)
- **쓸 수 없는 상황은 상태로 알린다.** 즉발 계략을 빈 경로에 쓰면 `no_target` 이다.
  골드만 사라지는 선택지는 선택지가 아니다

---

## 새 이벤트 추가

`src/types/events.ts` 의 `GameEvents` 에 한 줄:

```ts
'tower:overheated': { slotId: string; duration: number };
```

`EventBus` 는 이름 → 페이로드 타입 맵이라, 이 한 줄로 `emit`/`on` 양쪽 모두
타입 검사를 받는다. 오타는 컴파일 에러가 된다.

발행은 `sim/` 에서, 구독은 `view/` `ui/` `audio/` 에서만 한다. 역방향 금지.
**구독은 반드시 `Subscriptions` 에 모아 `dispose()` 에서 끊을 것** —
재시작할 때 리스너가 쌓이면 이벤트가 두 번씩 처리된다.

---

## 새 파티클 프리셋

`src/view/vfx/Particles.ts` 의 `PRESETS` 에 한 줄:

```ts
freeze_shard: { count: 12, color: 0x9fd8ff, size: 4, life: [0.3, 0.6],
                speed: [40, 90], up: 0.5, gravity: -120, spread: 1 },
```

`particles.emit('freeze_shard', x, y, z)` 로 쓴다.
용량은 성능 프리셋 비율에 따라 자동으로 조절되고, 죽은 입자 슬롯을 재사용하므로
새 프리셋을 추가해도 할당이 늘지 않는다.

---

## 프로젝트 구조

```
src/
  core/   EventBus  Loop  ObjectPool  SpatialGrid  Rng      ← three 금지
  sim/    World  Path  WaveRunner  Enemy  Tower              ← three 금지
          Projectile  Economy  Castle  effects/
  view/   Renderer  Stage  Terrain  PathRibbon  GameScene
          AssetRegistry  CameraControls  EntityView
          views/  vfx/
  ui/     Hud  TowerPanel  ScreenFx  dom  hud.css            ← DOM 오버레이
  audio/  AudioManager  soundMap
  data/   balance  units  towers  waves  levels/             ← three 금지
  types/
scripts/  sim.ts        ← npm run sim
tests/    데이터 / 시뮬 / 뷰 / 수명주기
```

`World.step()` 안의 순서는 고정이다. 바꾸면 결과가 달라진다 — `World.ts` 의 주석 참고.

## 성문 단계 추가·수정

성문은 `src/data/castle.ts` 의 `CASTLE_LEVELS` 배열 하나다. 단계를 늘리려면 항목을 하나
더하면 되고, `MAX_CASTLE_LEVEL` 은 배열 길이에서 자동으로 나온다. 지켜야 할 규칙 둘:

1. **초당 피해가 앞 단계보다 낮아지면 안 된다.** 무기가 바뀌는 단계(활 -> 대포 -> 화염)에서
   특히 쉽게 깨진다 — 발수가 줄면서 한 발 피해를 안 올리면 강화가 함정이 된다.
   `tests/castle.test.ts` 가 매 단계 검사한다.
2. **`fireSource` 는 뷰의 연출을 고른다.** `shell` 은 깊은 불구덩이, `flame` 은 넓게
   퍼지는 기름불이다 (`GroundFireView` 의 `FIRE_STYLE`).

레벨에서 성문을 열려면 `LevelDef.castleUpgrade: true` 한 줄이면 된다.

## 새 타워가 불을 남기게 하기

`TowerDef.ignite` 에 `{ fromLevel, radius, dps, duration, dpsPerLevel, source }` 를 적으면
그 타워만의 화염 지대가 생긴다. 없으면 `BALANCE.fire` 의 기본값(3레벨부터 무기가 달아오른다)을
쓴다 — 궁노 망루와 벽력거가 그쪽이다.

화염 피해(`damageKind: 'fire'`)는 적의 `fireResist` 로 막히고 `fireVuln` 으로 증폭된다.
공성 피해(`siege`)는 어떤 저항도 받지 않으므로, 새 저항을 만들 때는
"이 저항의 답이 되는 타워가 무엇인가"를 먼저 정해야 한다.

## 저장소 갈아 끼우기 (계정 / 전적 / 방명록)

게임은 `src/account/GameStore.ts` 인터페이스만 본다. 새 저장소는 그 인터페이스를 구현하고
`createGameStore()` 에 한 줄 추가하면 된다. 지금 있는 구현은 둘이다:

| 구현              | 언제                                  |
| ----------------- | ------------------------------------- |
| `LocalGameStore`  | 기본값. 브라우저 localStorage         |
| `TorsoGameStore`  | `?api=` 또는 `VITE_API_BASE` 가 있을 때 |

`TorsoGameStore` 파일 맨 위 주석이 곧 서버 API 명세다. 서버가 생기면
**비밀번호 검증을 서버로 옮겨야 한다** — 지금은 클라이언트가 해시를 비교하므로
로컬 저장소에서는 진짜 인증이 아니다.
