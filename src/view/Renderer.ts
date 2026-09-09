import * as THREE from 'three';
import { BattlePostFx } from './BattlePostFx';
import { outdoorLighting } from './OutdoorLighting';
import { BALANCE, type PerformancePresetName } from '../data/balance';

export type RendererBackend = 'webgpu' | 'webgl2' | 'webgl';

export interface RendererHandle {
  renderer: THREE.WebGLRenderer;
  backend: RendererBackend;
  domElement: HTMLCanvasElement;
  setPixelRatio: (maxDpr: number) => void;
  render: (scene: THREE.Scene, camera: THREE.Camera, dt: number, postFx: boolean) => void;
  dispose: () => void;
}

/**
 * 이 기기에 **메모리 안전장치**를 걸어야 하는가.
 *
 * 여기서 걸리면 안티에일리어싱이 꺼지고, 픽셀 비율이 1.5로 묶이고, 그림자 맵이
 * 2048로 눌린다. 프레임이 아니라 **할당**을 지키는 장치다 — 느린 것은 3초 실측이
 * 잡아 내리지만(main.ts updateFps), 메모리가 모자라 컨텍스트가 날아가면 잴 기회조차 없다.
 *
 * 예전 판정에는 버그가 둘 있었고 둘 다 화면을 흐리게 만드는 쪽으로 틀렸다.
 *
 *   1) `nav.deviceMemory ?? 4` 뒤에 `mem <= 4` 였다. deviceMemory 는 크로뮴에만
 *      있으므로 **사파리와 파이어폭스는 전부 4로 읽혀 저사양으로 떨어졌다.**
 *      맥북이든 아이패드 프로든 예외 없이 픽셀 비율 1.5에 안티에일리어싱이 꺼졌다.
 *      값이 없으면 "모른다"이지 "적다"가 아니다.
 *   2) userAgent 에 iPad 와 Mobile 이 들어 있었다. 태블릿은 폰이 아니다 — 화면이
 *      크고 GPU 도 다르다. 게다가 iPadOS 13 부터 사파리는 자신을 Macintosh 로
 *      보고하므로 /iPad/ 는 요즘 아이패드에 아예 걸리지도 않는다.
 *      아이패드를 알아보려면 Macintosh 이면서 터치가 되는지를 봐야 한다.
 *
 * 지금은 **진짜 폰**과 코어·메모리가 실제로 모자란 기기만 잡는다.
 * 태블릿과 데스크톱은 온전한 화질로 시작하고, 못 버티면 실측이 내려 준다.
 */
export function detectLowEnd(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const ua = nav.userAgent;
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory;
  // Android 는 폰일 때만 UA 에 Mobile 이 붙는다 (태블릿에는 없다).
  const phone = /iPhone|iPod|Windows Phone/i.test(ua) || /Android.*Mobile/i.test(ua);
  if (phone) return true;
  // 값이 있을 때만 믿는다. 2GB 이하면 4096 그림자 맵(67MB)이 위험하다.
  if (mem !== undefined && mem <= 2) return true;
  return cores <= 2;
}

/**
 * 손가락으로 쓰는 큰 화면인가 — 아이패드와 안드로이드 태블릿.
 *
 * iPadOS 사파리는 자신을 Macintosh 로 보고하므로 UA 만으로는 데스크톱과 구별되지
 * 않는다. 터치 포인트가 여럿인 Macintosh 는 아이패드다(맥에는 터치스크린이 없다).
 */
export function isTablet(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints ?? 0;
  if (/iPad/i.test(ua)) return true;
  if (/Macintosh/i.test(ua) && touch > 1) return true;
  return /Android/i.test(ua) && !/Mobile/i.test(ua);
}

/**
 * 처음 켰을 때의 그래픽 프리셋 — **모두 '높음'에서 시작한다.**
 *
 * 예전에는 userAgent 와 코어 수로 짐작했다(모바일이면 보통, 코어 4개 이하도 보통).
 * 그 짐작은 늘 아래로 틀렸다. 코어 수는 GPU 성능과 상관이 거의 없고 — 요즘 폰은
 * 코어가 여덟인데 데스크톱 i5 는 넷이다 — userAgent 는 아이패드 프로와 보급형
 * 안드로이드를 구별하지 못한다. 결과적으로 멀쩡히 60fps 를 낼 기기들이 이유 없이
 * 흐린 화면으로 시작했고, 설정을 열어 본 사람만 제 성능을 봤다.
 *
 * 짐작을 지울 수 있는 이유는 **실측이 이미 있기 때문**이다 (main.ts updateFps):
 *   - 3초간 재서 26fps 미만이면 '낮음', 45fps 미만이면 '보통'으로 내린다.
 *   - 그 뒤에도 적이 나와 있는 동안 38fps 아래가 5초 쌓이면 한 단계 더 내린다.
 *   - 내려간 값은 localStorage 에 남으므로 다음 실행부터는 그 자리에서 시작한다.
 * 그래서 못 버티는 기기가 치르는 값은 "처음 3초"뿐이고, 버틸 수 있는 기기는
 * 아무것도 잃지 않는다. 짐작보다 실측이 낫다.
 *
 * 모바일이라고 예외를 두지 않는다. 다만 프리셋과 무관하게 걸려 있는 하드웨어
 * 안전장치는 그대로다 — detectLowEnd() 가 안티에일리어싱을 끄고 픽셀 비율을
 * 1.5 로 묶으며, 그림자 맵도 아래 maxShadowMapSize() 로 눌린다.
 */
export function guessPreset(): PerformancePresetName {
  return 'high';
}

/**
 * 이 기기가 감당할 그림자 맵의 한 변 — '높음'의 4096 을 저사양에서 눌러 준다.
 *
 * 프리셋과 따로 두는 이유: 프레임이 느려지는 것과 **할당이 실패하는 것**은 다르다.
 * 4096 x 4096 깊이 맵 하나가 67MB 다. 느린 것은 위의 실측이 3초 안에 잡아 내리지만,
 * 메모리가 모자라 컨텍스트가 날아가면 fps 를 잴 기회조차 없다 — 화면이 검게 남는다.
 * 그래서 이쪽만은 짐작이 아니라 보수적으로 간다. 2048 은 같은 맵의 1/4(17MB)이고,
 * 위에서 내려다보는 이 카메라 거리에서는 4096 과 눈으로 구별되지 않는다.
 */
export function maxShadowMapSize(): number {
  return detectLowEnd() ? 2048 : 4096;
}

/**
 * WebGPURenderer를 먼저 시도하고 실패하면 WebGLRenderer로 폴백한다.
 * 어느 백엔드가 선택됐는지 콘솔 1줄 + 우하단 라벨에 남긴다.
 */
export async function createRenderer(container: HTMLElement): Promise<RendererHandle> {
  const lowEnd = detectLowEnd();
  let renderer: THREE.WebGLRenderer | null = null;
  let backend: RendererBackend = 'webgl2';

  /*
   * 1) WebGPU — **명시적으로 요청할 때만** 쓴다 (`?gpu=1`).
   *
   * three 0.180의 WebGPU 백엔드는 실제 GPU에서 우리 스킨드 메시(= GLB 모델 전부)의
   * 렌더 파이프라인을 만들지 못한다. `device.createRenderPipeline()` 이 TypeError로
   * 죽고, 그 뒤로 `setPipeline()` 이 undefined를 받아 매 프레임 × 오브젝트 수만큼
   * 에러를 쏟는다 (콘솔에 수천 줄이 쌓이고 프레임이 무너진다).
   *
   * 이때 화면에서는 **GLB 오브젝트만 사라진다.** 지형·나무·성은 프리미티브라
   * 멀쩡히 그려지므로 "3D 모델만 안 보인다"는 모양이 되고 원인이 잘 안 보인다.
   * swiftshader(헤드리스)에서는 재현되지 않아 자동 테스트로도 안 걸렸다.
   *
   * WebGL2는 같은 장면을 문제없이 그린다. three가 고쳐질 때까지 그쪽이 기본이다.
   * 확인해보고 싶으면 `?gpu=1` 로 켤 수 있다.
   */
  const wantWebGPU = new URLSearchParams(location.search).get('gpu') === '1';
  if (wantWebGPU && 'gpu' in navigator) {
    try {
      const mod = (await import(/* @vite-ignore */ 'three/webgpu')) as unknown as {
        WebGPURenderer: new (params: Record<string, unknown>) => THREE.WebGLRenderer & {
          init: () => Promise<void>;
          backend?: { isWebGPUBackend?: boolean };
        };
      };
      const r = new mod.WebGPURenderer({ antialias: false, alpha: false, forceWebGL: false });
      await r.init();
      renderer = r as unknown as THREE.WebGLRenderer;
      backend = r.backend?.isWebGPUBackend === false ? 'webgl2' : 'webgpu';
    } catch (err) {
      console.warn('[renderer] WebGPU 초기화 실패, WebGL로 폴백합니다:', (err as Error)?.message ?? err);
      renderer = null;
    }
  }

  // 2) WebGL 폴백. antialias는 이때만 켠다 (WebGPU는 자체 처리).
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({
      antialias: !lowEnd,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const ctx = renderer.getContext();
    backend =
      typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext
        ? 'webgl2'
        : 'webgl';
  }

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);

  const setPixelRatio = (maxDpr: number) => {
    // devicePixelRatio 상한 2, 저사양이면 1.5
    const cap = Math.min(maxDpr, lowEnd ? 1.5 : BALANCE.presets.high.maxDpr);
    renderer!.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  };
  setPixelRatio(lowEnd ? 1.5 : 2);

  console.log(`renderer: ${backend}`);

  let post: BattlePostFx | null = null;
  const supportsPostFx = renderer instanceof THREE.WebGLRenderer;
  // Rebuild only for a new chapter's sun. All objects share this outdoor light probe.
  let environment: THREE.WebGLRenderTarget | null = null;
  let environmentScene: THREE.Scene | null = null;
  renderer.info.autoReset = false;
  return {
    renderer,
    backend,
    domElement: canvas,
    setPixelRatio,
    render: (scene, camera, dt, postFx) => {
      if (supportsPostFx && scene !== environmentScene) {
        const sun = scene.children.find(o => o instanceof THREE.DirectionalLight) as THREE.DirectionalLight | undefined;
        if (sun) {
          if (environmentScene && environmentScene.environment === environment?.texture) environmentScene.environment = null;
          environment?.dispose();
          environment = outdoorLighting(renderer!, sun, scene.fog?.color ?? new THREE.Color(0xc3d4dc));
          scene.environment = environment.texture;
          scene.environmentIntensity = .72;
        }
        environmentScene = scene;
      }
      if (postFx && supportsPostFx) {
        post ??= new BattlePostFx(renderer!);
        post.render(scene, camera, dt);
      } else {
        post?.dispose();
        post = null;
        renderer!.render(scene, camera);
      }
    },
    dispose: () => {
      post?.dispose();
      environment?.dispose();
      renderer!.dispose();
      canvas.remove();
    },
  };
}
