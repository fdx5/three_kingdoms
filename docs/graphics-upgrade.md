# 그래픽·전투 연출 개선 (2026-09-08)

- 고품질: HDR 버퍼 → 은은한 Bloom → OutputPass 색상 변환. MSAA 최대 4샘플,
  후처리 버퍼 최대 1920×1200, Bloom은 별도 저해상도로 처리한다.
- 중간·낮음: 후처리 버퍼를 해제하고 직접 렌더링한다.
- 환경광: Three.js RoomEnvironment/PMREM을 한 번 생성해 금속·갑옷 반사에
  0.28 강도로 적용한다. 챕터를 바꿔도 공유한다.
- 범위 착탄: 흙먼지와 뜨거운 충격파를 색상으로 구분한다. 포탄에는 추가 불티가
  튄다. 지형 높이를 반영하며 최대 32개 충격파를 InstancedMesh 한 번으로 그린다.
- 파티클: 살아 있는 슬롯만 연속 저장·계산·전송·그리기한다. 600개 버퍼를 재사용하고
  실제 동시 입자 수는 고품질 600 / 중간 360 / 낮음 180으로 제한한다.
- 적이 있는 전투에서 약 38fps 미만 상태가 누적 5초 지속되면 품질을 한 단계
  낮춘다. 변경 후 15초 유예를 두며, 일시정지·백그라운드·긴 재개 지연은 제외한다.
- 그림자 크기가 같으면 기존 맵을 재사용하고, 그림자를 끄면 맵을 해제한다.

## 라이브러리 검토

[pmndrs/postprocessing](https://pmndrs.github.io/postprocessing/public/docs/)과
[Three.js 공식 애드온](https://threejs.org/manual/en/post-processing.html)을 검토했다.
이번에 필요한 효과는 Bloom과 최종 색 변환이므로 기존 Three.js 0.180에 포함된
EffectComposer, UnrealBloomPass, OutputPass, RoomEnvironment를 사용했다.
초기 Bloom 구성은 새 패키지·외부 CDN·추가 이미지 다운로드 없이 구현했다.
이후 지면 개선에서 로컬 PBR 이미지와 고품질 전용 GTAO를 추가했다(아래 참조).
실험적 WebGPU 렌더러에는
WebGL 전용 후처리를 적용하지 않는다.

## 검증

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

Vite를 5178 포트로 실행한 뒤:

```sh
node scripts/smoke-quality.mjs
node scripts/smoke-battle-fx.mjs
```

Chrome 자동 검증은 실제 셰이더 컴파일, 재시작, 고품질↔중간↔낮음 전환,
GPU 자원 해제, 일시정지/3배속, 적응 품질, 화면 크기 변경을 확인한다.
새 검증의 스크린샷과 JSON 보고서는 `artifacts/battle-fx-*`로 생성된다.
품질 전환 검증에서 중간 텍스처 92개, 고품질 104개가 반복 전환 후에도 유지됐다.
이는 해당 테스트 장면의 값이며 하드웨어별 FPS 향상률을 의미하지 않는다.

## 지형·표면 개선 마무리

- 1~6장에 각각 배치한 구릉과 능선을 적용한다. 1장은 낮은 구릉, 2장은 높은 바위 능선,
  3장은 넓은 숲 언덕, 4장은 호수 주변 둔덕, 5장은 북쪽·동쪽 제방, 6장은 황토 단구다.
  길 주변 44u와 건설 기반은 평탄하게 유지하고 108u까지 완만하게 지형에 연결한다.
- 전체 가장자리를 일괄 상승시키는 대신 외곽의 두 후방 능선과 측면 구릉 사이에
  낮은 통로를 둔다. 전경 구릉은 낮게 두어 기본·회전 시점의 시야를 확보한다.
  6장은 10u 간격의 둥근 단차를 원래 경사와 혼합한다.
- 나무껍질·바위·지면의 색상, 법선, 거칠기 텍스처를 로컬 WebP로 연결했다.
  원본 출처와 변환 방법은 `public/assets/textures/SOURCES.md`에 기록했다.
- 고품질에서는 지면의 반복 무늬를 분산하고 일부 장에서 숲 지면을 섞는다.
  반해상도 GTAO는 최대 960×600이며 투명 효과·히트 영역·작은 식생을 제외한다.
  중간·낮음에서는 혼합 셰이더와 후처리를 끄고 일반 PBR 재질을 사용한다.
- `scripts/smoke-surfaces.mjs`는 1~6장 고품질 셰이더, 지면 혼합 분기,
  경로·건설 위치 높이, 실제 건설 및 기본·확대·작은 화면을 검증한다.
  지형이 다시 평탄해지는 것을 막기 위해 최고 높이와 10u 이상 지형의 면적을 검사한다.
  단위 검사에서는 급경사 상한과 회전 시점에서 건설 표시의 가림 여부도 확인한다.
- 전투 효과 스모크의 건설 호출을 현재 좌표 기반 API에 맞췄다.
  건설과 업그레이드의 성공 여부도 검사한다.

빌드 결과를 검증하려면 `npm run build` 후 `npm run preview -- --port 5188`을
실행하고, `REVIEW_URL=http://localhost:5188` 환경 변수를 지정해
`node scripts/smoke-surfaces.mjs`와 `node scripts/smoke-battle-fx.mjs`를 실행한다.
화면과 검사 결과는 `artifacts/surfaces-*`, `artifacts/battle-fx-*`에 저장된다.
