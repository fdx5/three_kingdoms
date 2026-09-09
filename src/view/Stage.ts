import * as THREE from 'three';
import { BALANCE, type PerformancePreset } from '../data/balance';
import type { LevelEnvironment } from '../types/level';

/** 줌 한계 — 1은 맵 전체가 들어오는 거리 */
const ZOOM_MIN = 0.42;
const ZOOM_MAX = 1.45;
/** 좌우 회전 한계 (라디안) */
const YAW_LIMIT = THREE.MathUtils.degToRad(60);

/**
 * 씬 / 카메라 / 조명 / 반응형 카메라 거리.
 * "평면 맵이지만 3D로 보이는" 연출이 목표 — fov 35, 약 45도 부감.
 */
export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
  readonly root = new THREE.Group();

  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fill: THREE.DirectionalLight;
  private skyDome: THREE.Mesh;
  private skyTexture: THREE.Texture | null = null;
  private disposed = false;

  /** 카메라가 바라보는 월드 중심 */
  readonly target = new THREE.Vector3(BALANCE.mapWidth / 2, 0, BALANCE.mapDepth / 2);

  /** 팬 오프셋 (드래그) */
  private pan = new THREE.Vector2(0, 0);
  /** 줌 배율 (1 = 맵 전체가 딱 들어오는 거리) */
  private zoom = 1;
  /** 휠 줌이 향하는 목표 배율. 실제 zoom은 여기로 따라간다 (관성 있는 느낌) */
  private zoomTarget = 1;
  /**
   * 휠 줌이 진행되는 동안 커서 밑에 붙잡아 둘 지면 좌표.
   * 이게 없으면 커서가 어디를 가리키든 화면 중앙으로만 확대돼 "엉뚱한 곳이 커진다".
   */
  private zoomAnchor: { x: number; z: number; ndcX: number; ndcY: number } | null = null;
  /** 반응형으로 계산된 기본 거리 */
  private baseDistance = 1200;
  /** 미세 패럴랙스 오프셋 */
  private parallax = new THREE.Vector2(0, 0);
  /** 카메라 셰이크 */
  private shake = 0;
  private shakeSeed = 0;

  /** 부감각 (라디안). 45도. */
  pitch = THREE.MathUtils.degToRad(45);
  private yaw = 0;

  private ray = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(env: LevelEnvironment) {
    this.scene.background = new THREE.Color(env.skyColor);
    // 안개는 원경 정리용으로 약하게
    this.scene.fog = new THREE.Fog(env.fogColor, 1550, 3700);
    this.scene.add(this.root);

    const skyGeo = new THREE.SphereGeometry(3600, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      color: new THREE.Color(env.skyColor),
      fog: false,
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.skyDome.rotation.y = Math.PI * 0.18;
    this.skyDome.frustumCulled = false;
    this.scene.add(this.skyDome);
    new THREE.TextureLoader().load('/assets/backgrounds/custom-china-panorama-v3.png', (texture) => {
      if (this.disposed) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      this.skyTexture = texture;
      skyMat.map = texture;
      skyMat.color.set(0xffffff);
      skyMat.needsUpdate = true;
    });

    this.hemi = new THREE.HemisphereLight(new THREE.Color(env.skyColor).lerp(new THREE.Color(0xc4ddf1), .55), new THREE.Color(env.groundColor), .65);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff1df, 3.2);
    this.sun.position.set(-620, 740, 250);
    if (env.landscape === 'floodplain') { this.sun.color.set(0xd8e7f0); this.sun.intensity = 2.1; }
    if (env.landscape === 'lakeside') { this.sun.color.set(0xffebc8); this.sun.intensity = 2.55; }
    if (env.landscape === 'loess') { this.sun.color.set(0xffd09b); this.sun.position.set(-650, 650, 180); }
    this.sun.target.position.copy(this.target);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // Fix the light to the battlefield. Following camera panning made shadows
    // swim and also overwrote the chapter-specific sunset direction every frame.
    this.sun.position.add(this.target);

    this.fill = new THREE.DirectionalLight(new THREE.Color(env.skyColor).lerp(new THREE.Color(0x9dc9ff), 0.35), 0.16);
    this.fill.position.set(700, 420, -600);
    this.scene.add(this.fill);

    this.sun.shadow.camera.left = -800;
    this.sun.shadow.camera.right = 800;
    this.sun.shadow.camera.top = 700;
    this.sun.shadow.camera.bottom = -700;
    this.sun.shadow.camera.near = 200;
    this.sun.shadow.camera.far = 2200;
    this.sun.shadow.bias = -0.00012;
    this.sun.shadow.normalBias = 0.3;
  }

  applyPreset(preset: PerformancePreset, renderer: THREE.WebGLRenderer): void {
    renderer.shadowMap.enabled = preset.shadows;
    this.sun.castShadow = preset.shadows;
    if (!preset.shadows || this.sun.shadow.mapSize.x !== preset.shadowMapSize) {
      this.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      // Free disabled/resized maps, but keep an unchanged map on repeated settings.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }

  /**
   * 월드 1200x700이 어떤 화면 비율에서도 잘리지 않도록 카메라 거리를 계산한다.
   * 세로가 긴 화면이면 더 멀리, 가로가 긴 화면이면 상하 여백을 남긴다.
   */
  resize(width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    this.camera.aspect = aspect;

    const halfW = BALANCE.mapWidth / 2;
    // 45도 부감이므로 깊이 방향(z)은 화면에서 cos(pitch)만큼 눌려 보인다.
    const halfD = (BALANCE.mapDepth / 2) * Math.cos(this.pitch) + 120;

    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    // 세로 방향으로 halfD가 들어갈 거리
    const distForHeight = halfD / Math.tan(vFov / 2);
    // 가로 방향으로 halfW가 들어갈 거리
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const distForWidth = halfW / Math.tan(hFov / 2);

    // 둘 중 먼 쪽을 택해야 어느 축도 잘리지 않는다. 여백 8%.
    this.baseDistance = Math.max(distForHeight, distForWidth) * 1.08;
    this.camera.updateProjectionMatrix();
    this.updateCamera();
  }

  /** 즉시 줌 (핀치처럼 손가락을 따라가야 하는 조작용) */
  setZoom(z: number): void {
    this.zoom = THREE.MathUtils.clamp(z, ZOOM_MIN, ZOOM_MAX);
    this.zoomTarget = this.zoom;
    this.updateCamera();
  }
  getZoom(): number {
    return this.zoom;
  }

  /**
   * 커서를 중심으로 부드럽게 줌. 휠 한 칸이 곧바로 튀지 않고 목표를 향해 미끄러진다.
   * @param ndcX,ndcY 커서의 정규화 좌표(-1~1). 그 지점의 지면이 제자리에 남는다.
   */
  zoomBy(factor: number, ndcX: number, ndcY: number): void {
    const target = THREE.MathUtils.clamp(this.zoomTarget * factor, ZOOM_MIN, ZOOM_MAX);
    if (target === this.zoomTarget) return;
    const hit = this.groundPointAt(ndcX, ndcY);
    this.zoomTarget = target;
    this.zoomAnchor = hit ? { x: hit.x, z: hit.z, ndcX, ndcY } : null;
  }

  rotate(deltaYaw: number, deltaPitch: number): void {
    // 시점을 잃지 않도록 좌우 회전은 정면 기준 ±60도로 묶는다.
    this.yaw = THREE.MathUtils.clamp(this.yaw + deltaYaw, -YAW_LIMIT, YAW_LIMIT);
    this.pitch = THREE.MathUtils.clamp(this.pitch + deltaPitch, THREE.MathUtils.degToRad(28), THREE.MathUtils.degToRad(72));
    this.updateCamera();
  }

  resetView(): void {
    this.zoom = 1;
    this.zoomTarget = 1;
    this.zoomAnchor = null;
    this.yaw = 0;
    this.pitch = THREE.MathUtils.degToRad(45);
    this.pan.set(0, 0);
    this.parallax.set(0, 0);
    this.shake = 0;
    this.updateCamera();
  }

  /** 화면 1픽셀이 지면에서 몇 월드 단위인지 (화면 중앙 기준) */
  private worldPerPixel(viewportHeight: number): number {
    const dist = this.baseDistance * this.zoom;
    return (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / Math.max(1, viewportHeight);
  }

  /**
   * 드래그한 픽셀만큼 지면이 손끝을 따라오게 팬한다.
   *
   * 예전에는 화면 높이에 대한 고정 계수(1400/h)를 썼기 때문에 줌 배율이나
   * 부감각이 바뀌면 지면이 커서보다 빠르거나 느리게 미끄러졌다.
   * 이제는 카메라 거리·fov·부감각에서 직접 환산하고, 회전한 시점에서도
   * 화면 오른쪽으로 끌면 지면이 화면 오른쪽으로 간다.
   */
  panByScreen(dxPx: number, dyPx: number, viewportHeight: number): void {
    const wpp = this.worldPerPixel(viewportHeight);
    // 부감각이 얕을수록 세로 드래그 1px이 지면에서는 더 멀리 간다.
    const depthPerPx = wpp / Math.max(0.35, Math.sin(this.pitch));
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    // 화면 오른쪽 = (cos, -sin), 화면 안쪽(멀어지는 방향) = (-sin, -cos)
    const dx = -dxPx * wpp * cos - dyPx * depthPerPx * sin;
    const dz = dxPx * wpp * sin - dyPx * depthPerPx * cos;
    this.addPan(dx, dz);
  }

  /** 월드 축 기준 팬 누적. 맵이 화면 밖으로 빠져나가지 않게 클램프한다. */
  addPan(dxWorld: number, dzWorld: number): void {
    // 가까이 당길수록 구석까지 갈 수 있어야 하고, 멀리 빼면 갈 곳이 없어야 한다.
    const dist = this.baseDistance * this.zoom;
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const halfW = halfH * this.camera.aspect;
    const maxX = THREE.MathUtils.clamp(BALANCE.mapWidth * 0.5 - halfW * 0.45, 40, BALANCE.mapWidth * 0.5);
    const depthSpan = halfH / Math.max(0.35, Math.sin(this.pitch));
    const maxZ = THREE.MathUtils.clamp(BALANCE.mapDepth * 0.5 - depthSpan * 0.45, 40, BALANCE.mapDepth * 0.5);
    this.pan.x = THREE.MathUtils.clamp(this.pan.x + dxWorld, -maxX, maxX);
    this.pan.y = THREE.MathUtils.clamp(this.pan.y + dzWorld, -maxZ, maxZ);
    this.updateCamera();
  }

  /** 화면 좌표(정규화)가 가리키는 지면 위 지점 */
  groundPointAt(ndcX: number, ndcY: number): THREE.Vector3 | null {
    this.ray.setFromCamera(_ndc.set(ndcX, ndcY), this.camera);
    return this.ray.ray.intersectPlane(this.groundPlane, _groundHit);
  }

  setParallax(nx: number, ny: number): void {
    // 아주 미세하게. 모바일에서는 호출하지 않는다.
    this.parallax.set(nx * 18, ny * 12);
    this.updateCamera();
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
    this.shakeSeed = Math.random() * 1000;
  }

  /** 매 프레임 호출 — 줌 보간과 셰이크 감쇠 */
  update(dt: number): void {
    this.skyDome.position.copy(this.camera.position);

    if (Math.abs(this.zoomTarget - this.zoom) > 1e-4) {
      // 프레임 레이트와 무관한 감쇠. 약 0.1초면 목표에 붙는다.
      this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-dt * 18));
      this.updateCamera();
      // 확대하는 동안 커서가 가리키던 지면이 커서 밑에 남도록 팬을 보정한다.
      const anchor = this.zoomAnchor;
      if (anchor) {
        const now = this.groundPointAt(anchor.ndcX, anchor.ndcY);
        if (now) this.addPan(anchor.x - now.x, anchor.z - now.z);
      }
    } else if (this.zoom !== this.zoomTarget) {
      this.zoom = this.zoomTarget;
      this.zoomAnchor = null;
      this.updateCamera();
    }

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.4);
      this.updateCamera();
    }
  }

  /** 현재 팬/줌/셰이크로 카메라 위치를 다시 계산한다. */
  private updateCamera(): void {
    const dist = this.baseDistance * this.zoom;
    const cx = this.target.x + this.pan.x + this.parallax.x;
    const cz = this.target.z + this.pan.y + this.parallax.y;

    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      const t = performance.now() * 0.05 + this.shakeSeed;
      const amp = this.shake * this.shake * 26;
      sx = Math.sin(t * 1.7) * amp;
      sy = Math.cos(t * 2.3) * amp;
    }

    const horizontal = dist * Math.cos(this.pitch);
    this.camera.position.set(
      cx + Math.sin(this.yaw) * horizontal + sx,
      dist * Math.sin(this.pitch) + sy,
      cz + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(cx, 0, cz);
  }

  /** 월드 좌표를 화면 픽셀 좌표로 투영 (HUD 코인 연출용) */
  projectToScreen(x: number, y: number, z: number, width: number, height: number, out: { x: number; y: number }): { x: number; y: number } {
    const v = _projVec.set(x, y, z).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * width;
    out.y = (-v.y * 0.5 + 0.5) * height;
    return out;
  }

  dispose(): void {
    this.disposed = true;
    this.sun.shadow.dispose();
    this.skyDome.geometry.dispose();
    (this.skyDome.material as THREE.Material).dispose();
    this.skyTexture?.dispose();
    this.scene.clear();
  }
}

const _projVec = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _groundHit = new THREE.Vector3();
