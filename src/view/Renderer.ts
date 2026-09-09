import * as THREE from 'three';
import { BattlePostFx } from './BattlePostFx';
import { outdoorLighting } from './OutdoorLighting';
import { type PerformancePresetName } from '../data/balance';
import { detectLowEnd, isTablet, isAppleTouchDevice, maxShadowMapSize, maxPixelRatio } from './DeviceCapabilities';

export { detectLowEnd, isTablet, isAppleTouchDevice, maxShadowMapSize, maxPixelRatio };

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
      // iOS 는 MSAA 버퍼까지 붙일 여유가 없다 — 탭이 죽는 것보다 계단이 낫다.
      antialias: !lowEnd && !isAppleTouchDevice(),
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
    const cap = Math.min(maxDpr, maxPixelRatio());
    renderer!.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  };
  setPixelRatio(maxPixelRatio());

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
