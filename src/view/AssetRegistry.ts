import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { PrimitivePart, PrimitiveSpec } from '../types/primitives';

export interface ModelEntry {
  url: string;
  scale?: number;
  yOffset?: number;
  rotY?: number;
}

export interface Manifest {
  models?: Record<string, ModelEntry>;
  textures?: Record<string, string>;
  audio?: Record<string, string>;
}

interface LoadedModel {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  entry: ModelEntry;
}

/**
 * 에셋 레지스트리 — 이 프로젝트에서 가장 중요한 파일.
 *
 * 규칙: 모델이 없는 것은 에러가 아니다. 경고 한 줄 찍고 프리미티브로 폴백한다.
 * public/assets/manifest.json 에 항목을 한 줄 추가하면 그 유닛이 GLTF로 바뀌고,
 * 지우면 프리미티브로 돌아온다. 코드 수정은 필요 없다.
 */
export class AssetRegistry {
  private manifest: Manifest = {};
  private models = new Map<string, LoadedModel>();
  private modelLoads = new Map<string, Promise<LoadedModel>>();
  private textures = new Map<string, THREE.Texture>();
  private audioBuffers = new Map<string, ArrayBuffer>();
  private failed = new Set<string>();

  /** 프리미티브 조립에서 재사용하는 지오메트리/머티리얼 캐시 */
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private matCache = new Map<string, THREE.Material>();

  private gltfLoader: GLTFLoader;
  private texLoader = new THREE.TextureLoader();
  private baseUrl: string;

  constructor(baseUrl = 'assets/') {
    this.baseUrl = baseUrl;
    this.gltfLoader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.gltfLoader.setDRACOLoader(draco);
  }

  /**
   * 매니페스트를 읽고 선언된 에셋을 미리 로드한다.
   * 실패한 에셋은 목록으로 콘솔에 남기고 폴백으로 계속 진행한다.
   */
  async load(onProgress?: (loaded: number, total: number, label: string) => void): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}manifest.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.manifest = (await res.json()) as Manifest;
    } catch (err) {
      console.warn('[assets] manifest.json 을 읽지 못했습니다. 전부 프리미티브/무음으로 진행합니다.', err);
      this.manifest = {};
      onProgress?.(1, 1, '');
      return;
    }

    const tasks: { kind: string; id: string; run: () => Promise<void> }[] = [];

    for (const [id, entry] of Object.entries(this.manifest.models ?? {})) {
      tasks.push({ kind: 'model', id, run: () => this.loadModel(id, entry) });
    }
    for (const [id, url] of Object.entries(this.manifest.textures ?? {})) {
      tasks.push({ kind: 'texture', id, run: () => this.loadTexture(id, url) });
    }
    for (const [id, url] of Object.entries(this.manifest.audio ?? {})) {
      tasks.push({ kind: 'audio', id, run: () => this.loadAudio(id, url) });
    }

    const total = Math.max(1, tasks.length);
    let done = 0;
    onProgress?.(0, total, '');

    await Promise.all(
      tasks.map(async (t) => {
        try {
          await t.run();
        } catch (err) {
          this.failed.add(`${t.kind}:${t.id}`);
          console.warn(`[assets] ${t.kind} "${t.id}" 로드 실패 — 폴백으로 진행합니다.`, (err as Error)?.message ?? err);
        } finally {
          done++;
          onProgress?.(done, total, t.id);
        }
      }),
    );

    if (this.failed.size > 0) {
      console.warn('[assets] 로드 실패 목록:', [...this.failed].join(', '));
    }

    // 성공했을 때도 한 줄 남긴다. "모델이 안 보인다"는 신고가 들어왔을 때
    // 로드 문제인지 렌더 문제인지 이 줄 하나로 갈린다.
    const r = this.modelReport();
    console.log(
      `[assets] 모델 ${r.loaded}/${r.declared} 로드 (스킨드 ${r.skinned})` +
        (r.failed.length ? ` — 실패: ${r.failed.join(', ')}` : ''),
    );
  }

  private async loadModel(id: string, entry: ModelEntry): Promise<void> {
    let pending = this.modelLoads.get(entry.url);
    if (!pending) {
      pending = this.gltfLoader.loadAsync(this.resolve(entry.url)).then((gltf) => {
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        return { scene: gltf.scene, animations: gltf.animations, entry };
      });
      this.modelLoads.set(entry.url, pending);
    }
    const loaded = await pending;
    this.models.set(id, { ...loaded, entry });
  }

  private async loadTexture(id: string, url: string): Promise<void> {
    const tex = await this.texLoader.loadAsync(this.resolve(url));
    tex.colorSpace = /_(normal|roughness|ao|height)$/.test(id) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    this.textures.set(id, tex);
  }

  private async loadAudio(id: string, url: string): Promise<void> {
    const res = await fetch(this.resolve(url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    this.audioBuffers.set(id, await res.arrayBuffer());
  }

  private resolve(url: string): string {
    return /^(https?:)?\/\//.test(url) ? url : `${this.baseUrl}${url}`;
  }

  // ── 조회 ────────────────────────────────────────────────────────────

  /** 매니페스트에 없거나 로드 실패면 null */
  /**
   * 진단용 요약 — 모델이 실제로 몇 개 붙었는지.
   *
   * "3D 모델이 하나도 안 보인다" 같은 신고는 원인이 (1) 로드 실패 (2) 렌더 실패로
   * 갈리는데, 화면만 봐서는 구분이 안 된다. 그래서 숫자로 남긴다.
   */
  modelReport(): { declared: number; loaded: number; failed: string[]; skinned: number } {
    const declaredIds = Object.keys(this.manifest?.models ?? {});
    const declared = declaredIds.length;
    // 매니페스트에 아예 없는 id(예: hulao_gate)는 "실패"가 아니라 의도한 프리미티브다.
    const failed = [...this.failed]
      .filter((k) => k.startsWith('model:'))
      .map((k) => k.slice('model:'.length))
      .filter((id) => declaredIds.includes(id));
    let skinned = 0;
    for (const m of this.models.values()) {
      if (this.hasSkinnedMesh(m.scene)) skinned++;
    }
    return { declared, loaded: this.models.size, failed, skinned };
  }

  getModel(id: string | undefined): LoadedModel | null {
    if (!id) return null;
    return this.models.get(id) ?? null;
  }

  getTexture(id: string | undefined): THREE.Texture | null {
    if (!id) return null;
    return this.textures.get(id) ?? null;
  }

  getAudioBuffer(id: string | undefined): ArrayBuffer | null {
    if (!id) return null;
    return this.audioBuffers.get(id) ?? null;
  }

  hasAudio(id: string | undefined): boolean {
    return !!id && this.audioBuffers.has(id);
  }

  /**
   * 모델이 있으면 clone(스킨드면 SkeletonUtils.clone), 없으면 프리미티브를 조립해 반환한다.
   * 반환 객체에는 animations가 붙어 있어 뷰가 AnimationMixer를 걸 수 있다.
   */
  getMesh(id: string | undefined, spec: PrimitiveSpec): THREE.Object3D & { animations?: THREE.AnimationClip[] } {
    const model = this.getModel(id);
    if (model) {
      const isSkinned = this.hasSkinnedMesh(model.scene);
      const obj = (isSkinned ? skeletonClone(model.scene) : model.scene.clone(true)) as THREE.Object3D & {
        animations?: THREE.AnimationClip[];
      };
      if (isSkinned) this.unleashSkinnedMeshes(obj);
      const wrapper = new THREE.Group() as THREE.Group & { animations?: THREE.AnimationClip[] };
      const s = model.entry.scale ?? 1;
      obj.scale.setScalar(s);
      obj.position.y = model.entry.yOffset ?? 0;
      obj.rotation.y = model.entry.rotY ?? 0;
      wrapper.add(obj);
      wrapper.animations = model.animations;
      return wrapper;
    }
    if (id && !this.failed.has(`model:${id}`) && !this.models.has(id)) {
      // 매니페스트에 아예 없는 경우 — 조용히 폴백 (에러가 아니다)
      this.failed.add(`model:${id}`);
      console.warn(`[assets] 모델 "${id}" 이(가) manifest에 없습니다. 프리미티브로 그립니다.`);
    }
    return this.buildPrimitive(spec);
  }

  /**
   * 스킨 메시의 프러스텀 컬링을 끈다. **이걸 안 하면 GLB 모델이 통째로 안 보인다.**
   *
   * 우리 모델은 크기를 전부 뼈(stand)가 들고 있고 메시 노드 자체는 스케일 1이다.
   * 그래서 three가 재는 바인드 포즈 바운딩 스피어는 1유닛짜리 점이 된다.
   * 게다가 three는 그 값을 **첫 프러스텀 판정 때 한 번만** 재고 영영 캐시하므로,
   * 하필 그 순간 뼈 행렬이 아직 서 있지 않으면 점 크기로 굳어 버린다.
   * 카메라가 1000유닛 밖에 있는 부감 뷰에서 1유닛짜리 점은 사실상 항상 화면 밖이라,
   * 병사도 망루도 화면 한가운데 있는데 그려지지 않는다.
   * (지형·나무·성은 프리미티브라 멀쩡하니 "GLB만 안 보이는" 모양으로 나타난다.)
   *
   * 매 프레임 정확한 스피어를 다시 재는 건 비싸고, 화면에 도는 스킨 메시는
   * 많아야 수십 개다. 컬링을 끄는 편이 싸고 확실하다.
   */
  private unleashSkinnedMeshes(root: THREE.Object3D): void {
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
    });
  }

  private hasSkinnedMesh(root: THREE.Object3D): boolean {
    let found = false;
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) found = true;
    });
    return found;
  }

  // ── 프리미티브 조립 ─────────────────────────────────────────────────

  buildPrimitive(spec: PrimitiveSpec): THREE.Group {
    const group = new THREE.Group();
    for (const part of spec.parts) {
      const mesh = new THREE.Mesh(this.geometryFor(part), this.materialFor(part));
      if (part.offset) mesh.position.set(part.offset[0], part.offset[1], part.offset[2]);
      if (part.rotation) mesh.rotation.set(part.rotation[0], part.rotation[1], part.rotation[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      if (part.tag) mesh.name = part.tag;
      group.add(mesh);
    }
    if (spec.scale && spec.scale !== 1) group.scale.setScalar(spec.scale);
    return group;
  }

  private geometryFor(part: PrimitivePart): THREE.BufferGeometry {
    const key = `${part.shape}|${part.size.join(',')}`;
    const cached = this.geoCache.get(key);
    if (cached) return cached;

    const s = part.size;
    let geo: THREE.BufferGeometry;
    switch (part.shape) {
      case 'box':
        geo = new THREE.BoxGeometry(s[0], s[1], s[2]);
        break;
      case 'sphere':
        geo = new THREE.SphereGeometry(s[0], 14, 10);
        break;
      case 'capsule':
        geo = new THREE.CapsuleGeometry(s[0], s[1], 4, 10);
        break;
      case 'cylinder':
        geo = new THREE.CylinderGeometry(s[0], s[1], s[2], 12);
        break;
      case 'cone':
        geo = new THREE.ConeGeometry(s[0], s[1], 12);
        break;
      case 'torus':
        geo = new THREE.TorusGeometry(s[0], s[1], 6, 14);
        break;
      case 'plane':
        geo = new THREE.PlaneGeometry(s[0], s[1]);
        break;
    }
    this.geoCache.set(key, geo);
    return geo;
  }

  private materialFor(part: PrimitivePart): THREE.Material {
    const key = `${part.color}|${part.roughness ?? 0.9}|${part.metalness ?? 0}|${part.opacity ?? 1}|${part.doubleSided ? 1 : 0}`;
    const cached = this.matCache.get(key);
    if (cached) return cached;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(part.color),
      roughness: part.roughness ?? 0.9,
      metalness: part.metalness ?? 0,
      transparent: (part.opacity ?? 1) < 1,
      opacity: part.opacity ?? 1,
      side: part.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    this.matCache.set(key, mat);
    return mat;
  }

  /** 프리미티브 머티리얼은 캐시 공유라 개별 뷰가 dispose하면 안 된다. 레지스트리가 끝낼 때만 지운다. */
  dispose(): void {
    for (const g of this.geoCache.values()) g.dispose();
    for (const m of this.matCache.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.geoCache.clear();
    this.matCache.clear();
    this.textures.clear();
    this.models.clear();
    this.modelLoads.clear();
    this.audioBuffers.clear();
  }

  get failedList(): string[] {
    return [...this.failed];
  }
}
