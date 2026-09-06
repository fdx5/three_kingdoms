# 삼국지 TD (sam-td) — 개발 프롬프트 팩

Three Kingdoms 타워 디펜스 레벨 1 구현용 단계별 프롬프트.
각 Phase 앞에 반드시 `00 전제 블록`을 먼저 전달할 것.

**사용법**
1. `00 전제 블록`을 AI 코딩 도구에 전달
2. `Phase 0` 프롬프트 전달 → 완료 확인
3. Phase 1 → 2 → 3 → 4 → 5 → 6 순서로 반복
4. 각 Phase의 "완료 확인" 항목을 통과해야 다음으로 넘어간다

Phase 순서를 건너뛰지 말 것. Phase 2(헤드리스 시뮬)를 Phase 3(렌더) 뒤로
미루면 밸런스를 눈으로만 확인하게 되고, 그 시점부터 수치 조정이 추측이 된다.

---

## 00 · 전제 블록 (모든 Phase 앞에 붙일 것)

```text
[프로젝트 전제 — 이 블록은 이후 모든 작업 지시의 전제다]

## 프로젝트
저장소명: sam-td
삼국지(황건적의 난)를 배경으로 한 웹 타워 디펜스. 이번 범위는 레벨 1(20웨이브)이며,
레벨/유닛/맵/음향을 계속 추가·교체할 수 있는 구조가 결과물의 핵심 요구사항이다.

## 기술 스택 (확정, 변경 금지)
- Vite + TypeScript (strict: true)
- Three.js: WebGPURenderer를 우선 시도하고 실패 시 WebGLRenderer로 폴백
- HUD/UI: canvas 위에 DOM+CSS 오버레이 (three 안에 UI를 그리지 않는다)
- 상태관리 라이브러리 없음. 자체 EventBus + 순수 시뮬레이션
- 테스트: Vitest
- 배포: 정적 빌드 하나 (SPA)

## 좌표계·단위 규약 (모든 수치의 기준)
- 1 타일 = 50 world unit. 맵 격자 24 x 14 = 1200 x 700 u
- Y축이 높이. 지형은 y=0 평면에 낮은 높이 변조를 준다
- 경로(path)는 폴리라인이며 총 길이 약 2000 u
- 적은 위치를 xyz로 갖지 않고 "경로 누적거리(distance) 스칼라"만 갖는다.
  월드 좌표는 Path.positionAt(distance)로 파생한다
- 보병 기본 속도 50 u/s (= 1타일/초, 경로 통과 40초)
- 타워 사거리 100 u (= 2타일). 직선 구간은 경로 200u를 덮지만
  꺾인 모퉁이에 놓으면 350u 이상을 덮는다 -> 배치 전략의 핵심이므로 맵 설계 시 보장할 것
- 카메라: PerspectiveCamera fov 35, 약 45도 부감.
  "평면 맵이지만 3D로 보이는" 연출이 목표

## 확장성 5원칙 (위반 시 리팩터링 대상)
1. 모든 밸런스 수치는 src/data/ 안에만 존재한다. 다른 곳의 매직넘버는 버그다.
2. src/sim/ 은 three를 import하지 않는다. ESLint no-restricted-imports로 강제한다.
   덕분에 렌더 없이 헤드리스로 20웨이브를 돌려 밸런스를 검증할 수 있다.
3. 모든 시각 표현은 EntityView 인터페이스 뒤에 있다.
   프리미티브 메시 -> GLTF 모델 교체가 파일 하나 수정으로 끝나야 한다.
4. sim은 이벤트만 발행한다. VFX/오디오/HUD는 구독만 한다. 역방향 의존 금지.
5. 에셋은 없어도 게임이 돌아간다. 모델 없으면 프리미티브 폴백, 음원 없으면 무음.

## 폴더 구조
src/
  core/   EventBus.ts Loop.ts ObjectPool.ts SpatialGrid.ts Rng.ts
  sim/    World.ts Path.ts WaveRunner.ts Enemy.ts Tower.ts Projectile.ts Economy.ts Castle.ts
  view/   Stage.ts Terrain.ts PathRibbon.ts AssetRegistry.ts views/ vfx/
  ui/     DOM HUD
  audio/
  data/   balance.ts units.ts towers.ts levels/level01.ts
  types/
public/assets/{models,textures,audio}/manifest.json

## 레벨 1 밸런스 (확정 수치)
경제: 시작골드 500 / 보병처치 10G / 중간보스 200G / 최종보스 500G
성:   체력 1000, 보병 도달 시 -20, 보스 도달 시 -100. 도달한 적은 즉시 소멸
적:   보병 HP 20, 속도 50u/s. 웨이브마다 HP x1.14, 속도 x1.02 누적
      중간보스(10웨이브): HP 500 고정, 크기 2배, 일반 보병과 섞여 등장
      최종보스(20웨이브): HP 1000 고정, 중간보스와 같은 형상
웨이브: n번째 보병 수 = 10 + 2*(n-1) (1웨이브 10기 ~ 20웨이브 48기, 총 580기)
      스폰 간격 = max(0.40, 1.10 - 0.03*n) 초
건설: 경로변 고정 슬롯 5개. 궁노 망루 건설비 100G

## 궁노 망루 레벨 표
Lv1  화살 1발  피해 10  간격 1.00s   (건설 100G)
Lv2  화살 2발  피해 13  간격 0.95s   업그레이드 100G
Lv3  화살 3발  피해 17  간격 0.90s   업그레이드 150G
Lv4  화살 4발  피해 22  간격 0.85s   업그레이드 200G
Lv5  화살 5발  피해 28  간격 0.80s   업그레이드 250G
판매 시 총 투자액의 70% 환급.

[핵심 규칙] N발의 화살은 서로 다른 적을 노린다. 한 마리에 몰아 쏘면
체력 낮은 보병에게 화살이 낭비되어 업그레이드가 체감되지 않는다.
사거리 안 적 수가 화살 수보다 적을 때만 선두 적에게 중복 사격한다.

## 세계관 (에셋 교체를 염두에 둔 명명 규칙)
레벨 1 = 황건적의 난. 적 id는 yt_infantry(황건적 보병),
yt_captain(황건적 두목, 중간보스), zhangjiao(장각, 최종보스).
타워 id는 archer_tower(궁노 망루). 성 id는 hulao_gate.
지금은 전부 프리미티브 도형으로 표현하되, id와 애니메이션 클립명
(idle/walk/attack/die)을 고정해 두어 나중에 GLTF만 얹으면 되게 한다.

## 대상 플랫폼
데스크톱 + 모바일/태블릿 웹. 터치 우선 설계.
hover에 의존하는 UI 금지, 최소 터치 타깃 44px, safe-area-inset 대응.
```

---

## Phase 0 · 스캐폴딩과 렌더 부트스트랩

```text
[Phase 0] 프로젝트 스캐폴딩과 렌더 부트스트랩

위 전제 블록을 따라 프로젝트 골격을 만들어라. 게임 로직은 아직 작성하지 않는다.

## 할 일
1. Vite + TypeScript(strict) 프로젝트 생성. three 설치.
   package.json 스크립트: dev / build / preview / test / sim / lint

2. 전제 블록의 폴더 구조를 전부 생성한다. 아직 구현이 없는 파일도
   빈 export와 TODO 주석을 넣어 만들어 둔다. 구조가 먼저 보여야 한다.

3. ESLint 설정에 다음 규칙을 넣어라 (5원칙 2번의 강제):
   src/sim/** 에서 'three' 및 'three/*' import를 금지.
   위반 시 빌드가 실패해야 한다.

4. src/view/Renderer.ts — 렌더러 부트스트랩
   - WebGPURenderer를 동적 import해 초기화 시도, 예외 시 WebGLRenderer로 폴백
   - 어떤 백엔드가 선택됐는지 콘솔 1줄 + 화면 우하단 디버그 라벨에 표시
   - devicePixelRatio는 2로 상한. 저사양 감지 시 1.5
   - antialias는 WebGL 폴백일 때만

5. src/view/Stage.ts — 씬/카메라/조명
   - Scene, 안개(fog)는 원경 정리용으로 약하게
   - PerspectiveCamera fov 35, near 1, far 5000
   - 카메라는 월드 중심(600, 0, 350)을 바라보고 약 45도 부감이 되도록 배치
   - HemisphereLight(하늘/땅 색) + DirectionalLight(주광, 그림자 캐스터)
   - 그림자는 옵션 플래그로 켜고 끌 수 있게 (모바일 자동 off)
   - 임시 확인용: 1200x700 PlaneGeometry에 격자 머티리얼

6. 반응형 캔버스
   - ResizeObserver로 컨테이너 크기를 추적
   - 월드 1200x700이 항상 화면에 들어오도록 카메라 거리를 계산해 조정한다
     (세로가 긴 화면이면 더 멀리, 가로가 긴 화면이면 상하 여백을 남긴다)
   - 창 비율이 어떻든 맵 전체가 잘리지 않는 것이 조건이다

7. src/core/Loop.ts — 고정 타임스텝 루프 (지금은 렌더만 호출)
   - 시뮬 스텝 1/60초 고정, accumulator 방식
   - 프레임 지연 시 최대 5스텝까지만 캐치업 (나선형 지연 방지)
   - 렌더 시점에 보간용 alpha(0~1)를 넘긴다
   - setSpeed(1|2|3): 프레임당 시뮬 스텝 수 배율. 렌더 fps와 무관해야 한다

8. index.html: 캔버스 컨테이너 + HUD 오버레이용 빈 div.
   viewport meta에 viewport-fit=cover, user-scalable=no
   CSS는 100dvh 사용, safe-area-inset padding 예약

9. 좌상단에 FPS/드로우콜 표시 디버그 패널. `?debug=1` 쿼리로만 노출.

## 완료 확인
npm run dev 로 격자 평면이 45도 부감으로 보인다.
창을 세로로 좁혀도 평면 전체가 화면에 남는다.
콘솔에 "renderer: webgpu" 또는 "renderer: webgl2" 가 찍힌다.
src/sim/ 에 three를 import하는 코드를 넣으면 lint가 실패한다.
```

---

## Phase 1 · 데이터 스키마와 레벨 1 콘텐츠

```text
[Phase 1] 데이터 스키마와 레벨 1 콘텐츠

이 단계의 목표는 "코드를 고치지 않고 숫자만 바꿔 밸런스를 조정할 수 있는 상태"다.
게임 로직은 아직 만들지 않는다. 타입과 데이터만 만든다.

## 1. src/types/ 에 정의할 타입

UnitDef {
  id, displayName, faction
  hp, speed, goldOnKill, castleDamage
  scale                      // 중간보스는 2.0
  kind: 'minion' | 'elite' | 'boss'
  view: { primitive: PrimitiveSpec, modelId?: string }  // 모델 없으면 primitive
  audio?: { spawn?, hit?, die? }                        // 없으면 무음
}

TowerLevelDef {
  arrows, damagePerArrow, fireInterval, range
  upgradeCost                // level 1은 null
  view: { primitive: PrimitiveSpec, modelId?: string }
}

TowerDef {
  id, displayName, buildCost, sellRatio
  targeting: 'first' | 'last' | 'strongest' | 'closest'
  projectile: { speed, arcHeight, modelId? }
  levels: TowerLevelDef[]    // 길이 5
  // 확장 지점: 나중에 splash / slow / dot 타워를 위한 자리
  effect?: { type: string, params: Record<string, number> }
}

WaveDef {
  index
  spawns: { unitId, at, hpMul, speedMul }[]   // at = 웨이브 시작 후 초
  reward?: number
  banner: string             // "제 10파 — 황건적 두목"
}

LevelDef {
  id, title
  castle: { id, hp }
  startGold
  path: [x, z][]             // 폴리라인. y는 지형에서 샘플링
  buildSlots: { id, x, z }[]
  waves: WaveDef[]
  environment: { skyColor, groundColor, bgmId }
}

## 2. src/data/balance.ts — 전역 상수
게임 속도 배율 옵션, 웨이브 간 대기시간, 조기소집 보너스 계수,
누수 판정 거리, 타워 판매 환급률, 최대 동시 투사체 수 등.
"이 파일만 열면 밸런스가 다 보인다"가 목표.

## 3. src/data/units.ts
yt_infantry  HP 20   속도 50  골드 10   성피해 20   scale 1.0  kind minion
yt_captain   HP 500  속도 40  골드 200  성피해 100  scale 2.0  kind elite
zhangjiao    HP 1000 속도 38  골드 500  성피해 100  scale 2.2  kind boss

primitive 스펙은 지금은 도형 조합으로:
- 보병: 캡슐 몸통 + 원뿔 삿갓, 황색(#d4a017) 두건 링
- 두목/장각: 같은 형상 scale 확대 + 진홍색 + 등 뒤 깃발 판(plane)
나중에 modelId만 채우면 GLTF로 대체되도록 필드를 미리 비워 둔다.

## 4. src/data/towers.ts
archer_tower: buildCost 100, sellRatio 0.7, targeting 'first'
levels 5개를 전제 블록의 레벨 표 그대로.
range는 5레벨 전부 100으로 동일 (사거리 증가는 향후 다른 타워의 차별점으로 남긴다)
primitive: 사각 기단 박스 + 원기둥 몸통 + 원뿔 지붕.
레벨에 따라 지붕에 활 표식 오브젝트를 N개 배치할 수 있게 스펙에 arrows 반영.

## 5. 웨이브 생성기 — 하드코딩 금지
src/data/waves.ts 에 generateWaves(params): WaveDef[] 를 만든다.
params: count, unitId, baseCount, countStep, hpGrowth, speedGrowth,
        spawnInterval(n), inserts { [waveIndex]: { unitId, atRatio }[] }

n번째 웨이브:
  보병 수 = baseCount + countStep * (n-1)
  hpMul    = (1 + hpGrowth) ** (n-1)
  speedMul = (1 + speedGrowth) ** (n-1)
  스폰 시각 = i * spawnInterval(n)
inserts로 지정된 유닛은 hpMul/speedMul을 적용하지 않고 원본 스탯으로 넣는다
(보스는 고정 체력이어야 한다 — 성장시키면 20웨이브에서 16000이 된다).
atRatio 0.5는 그 웨이브 스폰 구간의 중간 시점에 끼워 넣는다는 뜻이다.

## 6. src/data/levels/level01.ts
- path: 24x14 격자 위를 구불구불 지나가는 폴리라인.
  총 길이가 약 2000u가 되도록 하고, 최소 4번 크게 꺾이게 한다.
- buildSlots 5개: 이 중 최소 3개는 꺾이는 모퉁이 안쪽에 두어,
  사거리 100으로도 경로를 넓게 덮을 수 있는 "좋은 자리"가 되게 한다.
  나머지 2개는 직선 구간에 두어 배치 판단에 우열이 생기게 한다.
  각 슬롯이 실제로 덮는 경로 길이를 주석에 계산해 적어라.
- waves: 위 generateWaves로 생성. inserts로 10웨이브 yt_captain,
  20웨이브 zhangjiao 삽입.

## 7. Vitest 검증 테스트
- 모든 UnitDef/TowerDef id가 유일한가
- level01.waves 길이가 20인가
- 20웨이브 총 보병 수가 580인가
- 10/20웨이브에 보스가 정확히 1기씩 있는가
- path 총 길이가 1800~2200u 범위인가
- 각 buildSlot에서 사거리 100 안에 들어오는 경로 길이를 계산해 출력
  (최소 3개 슬롯이 300u 이상을 덮어야 통과)

## 완료 확인
npm test 통과. data/ 파일 열어서 숫자 하나 바꾸면 테스트 수치가 따라 바뀐다.
```

---

## Phase 2 · 헤드리스 코어 시뮬레이션

```text
[Phase 2] 헤드리스 코어 시뮬레이션

three를 전혀 쓰지 않고 게임 규칙 전체를 구현한다.
이 단계가 끝나면 렌더 없이 20웨이브를 돌려 밸런스를 검증할 수 있어야 한다.

## 1. src/core/Rng.ts
시드 기반 난수 (mulberry32 등). 시뮬 안에서 Math.random 사용 금지.
같은 시드 + 같은 입력이면 결과가 완전히 동일해야 한다(결정론).

## 2. src/sim/Path.ts
- 폴리라인 좌표 배열을 받아 세그먼트별 길이와 누적거리 LUT를 만든다
- totalLength
- positionAt(d): 누적거리 d에서의 {x, z}
- directionAt(d): 진행 방향 벡터 (모델 회전용)
- 이진 탐색으로 O(log n) 조회

## 3. src/sim/Enemy.ts
필드: id, defId, hp, maxHp, distance, speed, alive, scale, kind
위치는 저장하지 않는다. distance 하나로 전부 파생된다.
(이 설계 덕분에 세이브/리플레이/네트워크 동기화가 자동으로 가벼워진다)

## 4. src/sim/Tower.ts
필드: slotId, defId, level, cooldown, totalInvested
- acquire(): SpatialGrid로 사거리 내 적을 찾고 targeting 규칙으로 정렬
- fire(): 레벨 수만큼의 화살을 서로 다른 적에게 배정.
  대상 수 < 화살 수일 때만 선두 적에게 중복 배정.
  각 화살마다 Projectile을 풀에서 꺼내 발사.
- upgrade(): 다음 레벨 비용 확인 후 레벨 상승, totalInvested 누적
- sellValue(): floor(totalInvested * sellRatio)

## 5. src/sim/Projectile.ts
- 오브젝트 풀 사용. 웨이브당 수백 발이므로 GC 압력을 만들면 안 된다
- 리드 타겟팅: 목표의 현재 속도로 도달 시점 위치를 예측해 그 지점을 향한다
- 대상이 도착 전에 죽으면 마지막 예측 지점까지 날아가 소멸(빗나감 연출)
- 명중 시 damage 이벤트 발행

## 6. src/sim/WaveRunner.ts
상태: idle -> spawning -> clearing -> cleared
- WaveDef의 spawns를 시간순 큐로 만들어 소비
- 마지막 적이 죽거나 누수되면 웨이브 클리어
- 웨이브 간 대기 카운트다운 (balance.ts 값)
- callWaveEarly(): 남은 대기시간 * 보너스계수 만큼 골드 지급 후 즉시 시작
- 20웨이브 클리어 시 level:won

## 7. src/sim/Economy.ts / Castle.ts
- Economy: gold, add(amount, reason), trySpend(amount) -> boolean
- Castle: hp, takeDamage(amount) -> hp 0 이하면 level:lost

## 8. src/core/SpatialGrid.ts
셀 크기 100u(= 타워 사거리)인 균등 격자.
매 스텝 적 위치로 갱신, 타워는 인접 9셀만 조회.
적이 50기 넘어가면 전수 검사와 체감 차이가 난다.

## 9. src/sim/World.ts — 통합
step(dt) 안의 순서를 고정한다:
  1) 스폰 큐 소비
  2) 적 이동 (distance += speed * dt)
  3) 누수 판정 (distance >= path.totalLength) -> 성 피해 -> 적 제거
  4) SpatialGrid 갱신
  5) 타워 쿨다운 감소 및 발사
  6) 투사체 이동 및 명중 판정
  7) 사망 처리 -> 골드 지급 -> 풀 반환
  8) 웨이브 상태 갱신
순서를 바꾸면 결과가 달라지므로 이 순서를 주석으로 명시할 것.

## 10. 이벤트 (src/core/EventBus.ts)
enemy:spawned  { enemyId, unitId, distance }
enemy:damaged  { enemyId, amount, hpRatio, worldPos }
enemy:killed   { enemyId, unitId, gold, worldPos }
enemy:leaked   { enemyId, unitId, castleDamage }
projectile:fired / projectile:hit
tower:built / tower:upgraded / tower:sold
gold:changed   { total, delta, reason, worldPos? }
castle:damaged { hp, maxHp, amount }
wave:started   { index, total, banner }
wave:cleared   { index }
level:won / level:lost  { stats }
타입 안전한 EventBus로 만들 것 (이벤트명 -> 페이로드 타입 맵).

## 11. 게임 속도
Loop.setSpeed(1|2|3)은 프레임당 step() 호출 횟수를 바꾼다.
dt를 늘리지 않는다 — dt를 늘리면 투사체가 적을 관통한다.

## 12. npm run sim — 헤드리스 러너
tsx로 실행되는 CLI. 인자로 전략을 받는다:
  --towers 3|5      초기 건설 수
  --upgrade greedy|none
  --seed <n>
출력: 웨이브별 표 (웨이브 / 적 수 / 보병HP / 종료골드 / 성체력 / 누수)
      최종 결과 (승패, 남은 성체력, 총 누수, 남은 골드, 타워 레벨)

## 13. Vitest 밸런스 테스트
- 업그레이드를 하는 플레이는 20웨이브를 클리어한다
- 업그레이드를 전혀 안 하면 10웨이브 이전에 패배한다
- 같은 시드로 두 번 돌리면 결과가 완전히 동일하다 (결정론)

## 완료 확인
npm run sim 이 20줄짜리 표를 출력하고 VICTORY로 끝난다.
아직 화면에는 아무것도 안 보인다. 정상이다.
```

---

## Phase 3 · 3D 씬과 뷰 계층

```text
[Phase 3] 3D 씬과 뷰 계층

Phase 2의 시뮬레이션을 화면에 그린다. 모든 유닛은 프리미티브 도형이지만,
GLTF 교체가 파일 하나로 끝나는 구조여야 한다.

## 1. src/view/AssetRegistry.ts — 프로젝트에서 가장 중요한 파일
public/assets/manifest.json 을 읽는다:
{
  "models": { "yt_infantry": { "url": "...", "scale": 1, "yOffset": 0 } },
  "textures": { ... },
  "audio": { ... }
}
API:
  getModel(id): Object3D | null   // 매니페스트에 없거나 로드 실패면 null
  getMesh(id, primitiveSpec): Object3D
      -> 모델이 있으면 clone(스킨드면 SkeletonUtils.clone)
      -> 없으면 primitiveSpec으로 도형을 조립해 반환
규칙: 모델이 없는 것은 에러가 아니다. 경고 1줄 찍고 폴백한다.
GLTF는 GLTFLoader + DRACOLoader, 같은 id 재요청은 캐시에서.

## 2. src/view/Terrain.ts — "평면이지만 3D처럼"
- 1200x700 PlaneGeometry를 48x28로 세분화
- 정점 y에 낮은 진폭(0~12u)의 값 노이즈를 준다. 경로 주변은 평탄하게 마스킹
- 정점 컬러로 고도별 색 변화 (낮은 곳 짙은 흙, 높은 곳 마른 풀)
- MeshStandardMaterial, roughness 높게 metalness 0
- 맵 경계 밖으로 낮은 산맥 실루엣 (단순 저폴리 메시) — 배경 깊이감용
- 장식 InstancedMesh: 나무, 바위, 깃발. 경로에서 일정 거리 밖에만 배치.
  개수는 성능 프리셋에 따라 조절 가능하게.

## 3. src/view/PathRibbon.ts
- 폴리라인을 따라 폭 44u의 평평한 리본 메시를 생성 (TubeGeometry 아님)
- 지형 y보다 살짝 위(+0.5u)에 놓아 z-fighting 방지
- 흙길 텍스처를 경로 길이에 비례해 반복 UV
- 진행 방향 화살표 데칼을 일정 간격으로 (첫 웨이브 전에만 밝게 표시)

## 4. EntityView 인터페이스 — 5원칙 3번
interface EntityView<T> {
  readonly object3d: Object3D
  mount(scene: Scene): void
  sync(entity: T, alpha: number): void   // alpha = 시뮬 스텝 간 보간
  playState(state: 'idle'|'walk'|'attack'|'die'): void
  dispose(): void
}
구현: EnemyView, TowerView, ProjectileView, CastleView

## 5. src/view/views/EnemyView.ts
- 시뮬의 distance를 Path.positionAt으로 월드 좌표로 변환
- 이전 스텝 위치와 alpha로 선형 보간 (60fps 시뮬 / 가변 fps 렌더 사이 부드럽게)
- directionAt으로 진행 방향을 바라보게 회전
- 걷는 느낌: 모델이 없을 때는 상하 미세 바운스 + 좌우 스웨이로 대체
- GLTF가 있으면 AnimationMixer를 붙이고 'walk' 클립 재생.
  클립명 규약 idle/walk/attack/die 를 고정한다.
- 사망 연출: 0.35초 동안 스케일 축소 + 아래로 가라앉으며 페이드,
  끝나면 풀에 반환. 시뮬은 이미 죽였고 뷰만 남아 연출하는 구조.
- enemy:spawned / enemy:killed 이벤트로 뷰 생성·해제를 관리

## 6. src/view/views/TowerView.ts
- 프리미티브: 사각 기단(BoxGeometry) + 원기둥 몸통 + 원뿔 지붕
- 레벨에 따라 지붕 둘레에 활 표식(작은 박스)을 N개 배치.
  업그레이드 시 새 표식이 팝 인 되는 스케일 애니메이션
- 발사 시 몸통이 진행 방향으로 살짝 회전 + 반동(짧은 뒤로 밀림)
- 선택 상태: 사거리 링 표시 (별도 반투명 원판 메시, 그림자와 무관하게)

## 7. src/view/views/ProjectileView.ts
- 화살 프리미티브: 얇은 원기둥 + 원뿔 촉
- 포물선 궤적 (arcHeight만큼 y를 sin 곡선으로)
- 진행 방향으로 정렬
- 오브젝트 풀. 최대 동시 투사체 수를 balance.ts에서 제한

## 8. 카메라 컨트롤
- 기본: 고정 부감 뷰
- 드래그로 약간의 팬(맵 경계 내로 클램프)
- 휠/핀치로 줌 (최소·최대 거리 클램프, 맵 전체가 항상 화면에 남는 범위)
- 마우스 이동에 따른 아주 미세한 패럴랙스 (모바일에서는 비활성)
- 성이 피격되면 짧은 카메라 셰이크 (prefers-reduced-motion이면 생략)

## 9. 성능
- 같은 유닛 타입은 InstancedMesh 검토 (단, 개별 애니메이션이 필요하면 제외)
- 프러스텀 컬링 활성, 그림자맵 해상도는 프리셋으로
- 성능 프리셋: high / medium / low. 초기 프레임레이트 측정으로 자동 선택,
  설정에서 수동 변경 가능

## 완료 확인
npm run dev 로 첫 웨이브가 시작되면 보병들이 흙길을 따라 걷는다.
아직 타워를 지을 수는 없고, 적들이 성에 도달해 성 체력이 깎이는 것까지 보인다.
```

---

## Phase 4 · 타워 · 전투 · 업그레이드

```text
[Phase 4] 타워 건설, 전투, 업그레이드

여기서 게임이 실제로 플레이 가능해진다. 터치 우선으로 설계한다.

## 1. 건설 슬롯 표현
- 미건설 슬롯: 지면에 반투명 육각 링 + 중앙에 망치 아이콘.
  느리게 맥동(pulse)해서 "여기 지을 수 있다"를 알린다
- 골드가 부족하면 링이 회색으로 흐려진다
- 첫 웨이브 시작 전에는 링을 더 밝게 강조 (튜토리얼 유도)

## 2. 건설 인터랙션 (터치 우선)
- 슬롯 탭 -> 하단(모바일) 또는 슬롯 옆(데스크톱)에 건설 패널
- 패널 내용: 타워 이름 / 비용 / Lv1 스펙(화살 1 · 피해 10 · 사거리 100)
- 패널이 열린 동안 해당 슬롯의 사거리 링을 지면에 미리보기로 표시
- [건설] 버튼으로 확정. 빈 곳 탭하면 취소
- hover로만 정보를 보여주는 UI는 금지 (모바일에 hover가 없다)

## 3. 사거리 링
- 반투명 원판 메시(별도 오브젝트), 테두리는 조금 더 진하게
- 지형 굴곡을 따르도록 살짝 세분화된 원판 사용
- 색: 건설 가능 = 청록, 선택됨 = 흰색, 골드 부족 = 적색

## 4. 타게팅
targeting 규칙을 구현하고 타워별로 바꿀 수 있게 한다:
  first    경로를 가장 많이 지난 적 (기본값)
  last     가장 뒤처진 적
  strongest 현재 hp가 가장 높은 적
  closest  타워에서 가장 가까운 적
타워 선택 패널에 이 옵션을 노출한다 (레벨 1에서는 first 기본,
다른 옵션도 동작해야 한다 — 향후 타워 종류가 늘 때 재사용된다).

## 5. 다중 화살 배분 — 반드시 이 규칙대로
사거리 내 적을 targeting 순으로 정렬한 배열 T,
타워 레벨 L(= 화살 수)일 때:
  i번째 화살(i = 0..L-1)의 목표 = T[i] (T의 길이를 넘으면 T[0])
즉 서로 다른 적에게 분산 발사하고, 적이 모자랄 때만 선두 적에게 겹친다.
한 마리에 몰아 쏘면 체력 20 보병에게 화살 5발이 낭비되어
업그레이드가 전혀 체감되지 않는다. 이건 밸런스의 핵심이다.

## 6. 업그레이드 UI
- 건설된 타워 탭 -> 타워 패널
- 현재 레벨과 다음 레벨을 나란히 비교:
    화살 3발 -> 4발 / 피해 17 -> 22 / 간격 0.90s -> 0.85s / DPS 57 -> 104
- 활 아이콘을 레벨 수만큼 표시 (사용자가 "활 2개 이미지를 고르면 2발"이라고
  하신 요구를 이렇게 구현한다 — 시각적으로 몇 발인지 즉시 보인다)
- 업그레이드 비용 표시, 골드 부족 시 버튼 비활성 + 부족액 표시
- 5레벨 도달 시 "최대" 표시
- [판매] 버튼: 환급액을 미리 보여주고 한 번 더 확인받는다

## 7. 업그레이드 연출
- 골드 차감 -> 타워에서 위로 빛 기둥 짧게
- 지붕의 활 표식이 하나 더 팝 인 (스케일 0 -> 1.2 -> 1, 0.25s)
- 사거리 링이 한 번 밝게 번쩍
- 업그레이드 사운드 (없으면 무음)

## 8. 전투 피드백
- 명중 시 적 위치에 짧은 스파크 + 적 모델 흰색 플래시 0.08s
- 적 체력바: 평소 숨김, 피해를 받으면 2초간 표시.
  보스는 항상 표시 + 화면 상단에 대형 보스 체력바
- 피해 숫자: 작게, 위로 떠오르며 0.6초 페이드. 풀링 필수
- 적 사망: Phase 3의 사망 연출 + 먼지 파티클

## 9. 성 피격
- 적이 경로 끝 도달 -> 즉시 소멸 + 성에 충돌 이펙트
- 화면 가장자리에 붉은 비네트 0.3초
- 카메라 셰이크 (보스는 더 강하게)
- 성 체력바가 감소하며 붉게 깜빡임
- 체력 30% 이하면 성 체력바가 상시 경고 상태

## 10. 승패 처리
- 성 체력 0 -> level:lost -> 패배 화면
- 20웨이브 클리어 -> level:won -> 승리 화면
- 통계: 처치 수, 누수 수, 최종 성 체력, 남은 골드, 소요 시간
- 별 등급: 성 체력 100% = 3별, 70% 이상 = 2별, 그 외 1별
  (남는 골드를 쓸 곳이 없다는 문제를 등급으로 흡수한다)

## 완료 확인
처음부터 끝까지 플레이해서 이길 수 있다.
업그레이드를 한 번도 안 하면 10웨이브에서 진다.
Phase 2의 npm run sim 결과와 실제 플레이 결과가 대체로 일치한다.
```

---

## Phase 5 · HUD와 모바일 UX

```text
[Phase 5] HUD와 모바일 UX

HUD는 three 안이 아니라 canvas 위 DOM 오버레이로 만든다.
한글 렌더링, 터치 타깃, safe-area, 접근성이 전부 공짜로 해결된다.

## 1. 상단 바
[골드]  [성 체력바]  [웨이브 n/20]  [속도 1x/2x/3x]  [일시정지]
- 골드: 숫자가 즉시 바뀌지 않고 0.4초 동안 카운트업(easeOutQuad)
- 성 체력바: 실제 값은 즉시, 뒤에 지연 게이지(흰색)가 0.5초 뒤따라 줄어들며
  "얼마나 깎였는지"를 시각화한다
- 웨이브 표시 옆에 다음 웨이브 카운트다운 링

## 2. 골드 획득 연출 — 요청하신 핵심 연출
enemy:killed 이벤트의 worldPos를 카메라로 화면 좌표에 투영한다.
그 위치에 골드 코인 DOM 요소를 만들고, 상단 골드 표시까지
베지어 곡선으로 0.55초간 날려 보낸다. 도착하는 순간 골드 숫자가 증가한다.
- 코인 요소는 풀링한다. 한 웨이브에 48개가 동시에 날 수 있다
- 여러 개가 동시에 죽으면 20ms씩 시차를 둬서 흐름이 보이게 한다
- 도착 시 골드 표시가 살짝 튀는 스케일 펄스
- 보스 처치는 코인 여러 개 + 더 크게 + 전용 사운드

## 3. 웨이브 연출
- 웨이브 시작: 화면 중앙 상단에 배너 슬라이드 인
  "제 10파 — 황건적 두목" (WaveDef.banner). 1.2초 후 슬라이드 아웃
- 보스 등장 웨이브는 배너 색과 사운드를 다르게
- 웨이브 클리어: "제 n파 격퇴" 짧게

## 4. 다음 웨이브 대기
- 카운트다운 링 + [지금 소집] 버튼
- 조기 소집 보너스: 남은 초 * 계수 만큼 골드 즉시 지급.
  버튼에 예상 보너스를 미리 표시한다
- 이건 숙련자에게 속도감과 추가 보상을 주는 표준 장치다.
  "게임에 속도감이 있어야 한다"는 요구를 여기서 해결한다

## 5. 게임 속도
1x / 2x / 3x 토글. 시뮬 스텝 수만 바뀌고 렌더는 그대로.
현재 배속을 버튼에 명확히 표시. 배속 중에도 UI 애니메이션 속도는 유지.

## 6. 모바일/태블릿 (필수 요구사항)
- 최소 터치 타깃 44x44px. 인접 버튼 간 최소 8px 간격
- hover 의존 정보 전달 금지. 모든 정보는 탭으로 도달 가능
- safe-area-inset-* 을 padding에 반영 (노치/홈 인디케이터)
- 100dvh 사용 (100vh는 모바일 주소창 때문에 잘린다)
- 주요 조작 버튼(속도/일시정지/건설 확정)은 화면 하단에 배치 — 엄지 도달 범위
- 세로 모드 감지 시 "가로로 돌려주세요" 안내 오버레이
- touch-action: none 으로 캔버스에서 브라우저 제스처 차단.
  단 HUD 스크롤 영역은 예외
- 더블탭 줌 방지, 롱프레스 컨텍스트 메뉴 방지

## 7. 반응형
- HUD 크기는 rem + clamp()로. 태블릿에서 과하게 커지지 않게 상한
- 좁은 화면: 상단 바를 2줄로 접거나 아이콘만 남긴다
- 타워 패널: 데스크톱은 슬롯 옆 팝오버, 모바일은 하단 시트

## 8. 접근성
- 색만으로 정보 전달 금지 (골드 부족은 색 + 아이콘 + 텍스트)
- prefers-reduced-motion: 카메라 셰이크, 코인 비행, 배너 슬라이드를
  즉시 전환으로 대체
- 키보드: 1~5 슬롯 선택, U 업그레이드, Space 일시정지, +/- 속도
- 포커스 표시(focus-visible) 명확하게
- 중요 상태 변화는 aria-live로 알림

## 9. 승리/패배 화면
- 통계 카드 + 별 등급
- [다시하기] [다음 레벨(잠김)] 버튼
- 패배 시 "몇 웨이브까지 버텼는지"와 힌트 한 줄
  (예: "망루를 업그레이드하면 화살이 여러 발 나갑니다")

## 10. 일시정지 / 설정
- 일시정지 시 시뮬 정지, 렌더는 계속
- 설정: BGM/효과음 볼륨, 그래픽 프리셋(high/medium/low),
  화면 흔들림 on/off, 피해 숫자 표시 on/off

## 완료 확인
휴대폰 브라우저에서 한 손으로 전체 플레이가 가능하다.
적을 죽이면 코인이 날아와 상단 골드가 카운트업한다.
세로로 들면 안내가 뜬다.
```

---

## Phase 6 · 연출 · 오디오 · 에셋 파이프라인

```text
[Phase 6] 연출, 오디오, 에셋 교체 파이프라인

여기서 "계속 업그레이드 가능한 구조"를 완성한다.
목표: 개발자가 코드를 건드리지 않고도 모델과 음원을 교체할 수 있다.

## 1. 파티클 시스템 (src/view/vfx/)
가벼운 자체 구현. 라이브러리 도입 금지.
- Points + 커스텀 셰이더 또는 인스턴싱된 빌보드
- 이미터 풀링, 최대 동시 파티클 수 제한 (프리셋별)
- 프리셋:
    hit_spark   명중 시 짧은 불꽃 8입자
    death_dust  사망 시 흙먼지 16입자, 아래로 퍼짐
    castle_hit  성 피격 시 파편 24입자
    upgrade_ray 업그레이드 시 상승하는 빛 입자
- 화살 트레일: 짧은 리본 또는 페이드하는 점 3개

## 2. 후처리 (선택, 저사양에서 자동 off)
- 약한 비네트
- 톤매핑 ACESFilmic, exposure 조정
- Bloom은 쓰지 않는다 (모바일 비용 대비 효과가 낮다)

## 3. 오디오 매니저 (src/audio/)
- 버스: bgm / sfx / ui. 각각 볼륨과 음소거
- 첫 사용자 터치에서 AudioContext.resume() (모바일 자동재생 정책)
- 동시 재생 제한: 같은 sfx가 50ms 내 중복되면 합치거나 스킵
  (48마리가 동시에 죽을 때 소리가 터지는 것 방지)
- 3D 위치 기반 팬닝은 하지 않는다 (부감 뷰에서는 혼란만 준다).
  대신 화면 x위치에 따른 약한 스테레오 팬만
- 매니페스트에 음원이 없으면 조용히 넘어간다. 절대 에러를 던지지 않는다

사운드 이벤트 매핑 테이블을 데이터로 둔다:
  { "enemy:killed": { "yt_infantry": "sfx_die_small", "yt_captain": "sfx_die_boss" },
    "tower:upgraded": "sfx_upgrade", ... }

## 4. 에셋 매니페스트 규약 — 교체 파이프라인의 핵심
public/assets/manifest.json:
{
  "models": {
    "yt_infantry": { "url": "models/yt_infantry.glb", "scale": 1.0, "yOffset": 0, "rotY": 0 },
    "archer_tower_lv1": { "url": "models/tower_a1.glb", "scale": 1.0 }
  },
  "audio": { "sfx_die_small": "audio/die_small.ogg" },
  "textures": { "path_dirt": "textures/dirt.webp" }
}

모델 제작 규약 문서를 docs/ASSETS.md 로 만들어라:
- 단위: 1 world unit = 게임 내 1. 보병 키는 약 34u가 기준
- 정면은 +Z, 발바닥이 y=0
- 애니메이션 클립명은 반드시 idle / walk / attack / die
- 폴리곤 예산: 보병 3k tri 이하, 보스 12k tri 이하
- 텍스처: 1024 이하, KTX2 권장, 알파는 가능하면 피할 것
- glTF 2.0 (.glb), Draco 압축 권장
- 모델을 넣고 manifest.json에 항목을 추가하면 끝. 코드 수정 불필요

## 5. 로딩 화면
- 매니페스트 파싱 -> 필요한 에셋 프리로드 -> 진행률 표시
- 실패한 에셋은 목록으로 콘솔에 남기고 폴백으로 계속 진행한다
- 로딩 화면은 삼국지 분위기의 정적 일러스트 자리(placeholder)를 마련해 둔다

## 6. 성능 프리셋과 자동 감지
초기 3초간 fps를 측정해 프리셋 자동 선택:
  high    그림자 on, 파티클 100%, 장식 오브젝트 100%, 후처리 on
  medium  그림자 on(저해상도), 파티클 60%, 장식 60%, 후처리 off
  low     그림자 off, 파티클 30%, 장식 30%, 후처리 off, DPR 1.0
설정 화면에서 수동 변경 가능. 선택은 localStorage에 저장한다.

## 7. 최종 점검 항목
- 20웨이브 연속 플레이 시 메모리가 계속 증가하지 않는다 (풀링 확인)
- 48마리 + 투사체 200개 동시에 60fps 유지 (데스크톱) / 30fps 이상 (모바일)
- 모든 이벤트 구독이 dispose에서 해제된다
- 새로고침 없이 재시작(다시하기)이 정상 동작한다
- three 객체의 geometry/material이 dispose된다

## 8. docs/ 문서 3종
- docs/ASSETS.md    위 모델·음원 제작 규약
- docs/BALANCE.md   data/ 수치의 의미와 npm run sim 사용법
- docs/EXTENDING.md 새 적/새 타워/새 레벨 추가 절차 (각각 10줄 이내로 끝나야 함)

## 완료 확인
아무 GLTF 파일이나 public/assets/models/ 에 넣고
manifest.json에 한 줄 추가하면 해당 유닛이 즉시 그 모델로 바뀐다.
매니페스트에서 그 줄을 지우면 프리미티브로 되돌아간다.
```

---

## 부록 · 확장 레시피

| 하고 싶은 것 | 손대는 곳 | 분량 |
|---|---|---|
| 새 적 유닛 추가 | `data/units.ts` + 웨이브 `inserts` | 항목 1개 |
| 3D 모델 교체 | `public/assets/manifest.json` | 1줄 |
| 밸런스 조정 | `data/balance.ts`, `data/levels/*.ts` | 숫자만 |
| 새 레벨 추가 | `data/levels/levelNN.ts` | 파일 1개 |
| 새 타워 종류 | `data/towers.ts` + `sim/effects/` 함수 1개 | 항목 1개 + 함수 1개 |
| BGM/효과음 교체 | `manifest.json` + 사운드 매핑 테이블 | 1~2줄 |
| 맵 분위기 변경 | `levels/*.ts`의 `environment` + 텍스처 | 색상값 + 텍스처 |

어느 하나라도 이보다 크게 번지면 확장성 5원칙 중 뭔가가 깨진 것이다.

## 부록 · 밸런스 검증 결과

Python 이산 시뮬레이션(스텝 0.05초)으로 20웨이브 × 5시나리오 검증 완료.

| 플레이 방식 | 결과 | 남은 성 체력 | 누수 |
|---|---|---:|---:|
| 모퉁이 3기 + 적극 업그레이드 | 승리 | 1000 / 1000 | 0 |
| 슬롯 5개 전부 + 업그레이드 | 승리 | 1000 / 1000 | 0 |
| 직선 3기(배치 실패) + 업그레이드 | 승리 | 1000 / 1000 | 0 |
| 5개 건설, **업그레이드 안 함** | 10웨이브 패배 | 0 | 46 |
| 3개 건설, 업그레이드 안 함 | 10웨이브 패배 | 0 | 50 |

**해석** — 업그레이드를 하면 배치가 나빠도 이기고, 안 하면 중간보스가 나오는
10웨이브에서 반드시 진다. 레벨 1이 가르쳐야 할 것이 정확히 하나(업그레이드)라는 뜻이고,
튜토리얼 레벨로서 올바른 형태다.

### 총량
- 20웨이브 총 보병: 580기
- 획득 가능 총 골드: 7,000 G
- 타워 5기 만렙 비용: 4,000 G
- 잉여 골드: 3,000 G (43%) → **레벨 2부터는 소비처 필요** (성벽 수리, 계략 카드 등)
- 패배까지 허용 누수: 보병 50기 (전체의 8.6%)

### 레벨 2 이후 메모
- 성 체력을 500~600으로 낮춰야 누수가 실제 위협이 된다
- 골드 잉여를 소비처로 흡수: 성벽 수리(2G당 1HP), 일회성 계략 카드, 정예병 소환
- 사거리를 늘리기보다 타워 종류를 늘려라 (투석기=범위, 함정=감속)
- 적 속성 도입: 방패병(원거리 저항), 기병(고속·저체력), 도사(주변 회복)
- 이름 있는 장수(여포·관우·장비)의 고유 능력이 이 소재의 가장 큰 자산이다
