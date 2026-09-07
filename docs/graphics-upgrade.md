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
새 패키지·외부 CDN·추가 이미지 다운로드는 필요하지 않다. 무거운 SSAO/DOF는
전장 가독성과 저사양 비용을 고려해 추가하지 않았다. 실험적 WebGPU 렌더러에는
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
