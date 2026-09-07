import * as THREE from 'three';
import { BattlePostFx } from './BattlePostFx';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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

/** 저사양 힌트: 코어 수, 메모리, 모바일 여부 */
export function detectLowEnd(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
  return mobile || cores <= 4 || mem <= 4;
}

/** 초기 프리셋 추정 (실측 fps로 나중에 보정된다) */
export function guessPreset(): PerformancePresetName {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
  if (mobile && cores <= 4) return 'low';
  if (mobile || cores <= 4) return 'medium';
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
  // A shared, prefiltered light probe restores detail on dark metal and armor.
  // Generate once; changing chapters reuses the same GPU texture.
  let environment: THREE.WebGLRenderTarget | null = null;
  if (supportsPostFx) {
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    environment = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
  }
  renderer.info.autoReset = false;
  return {
    renderer,
    backend,
    domElement: canvas,
    setPixelRatio,
    render: (scene, camera, dt, postFx) => {
      if (environment && !scene.environment) {
        scene.environment = environment.texture;
        scene.environmentIntensity = 0.28;
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
