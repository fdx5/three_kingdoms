import * as THREE from 'three';
import type { Terrain } from '../Terrain';
import type { Spot } from '../../sim/Placement';

/**
 * "여기 지을 수 있다" 표시.
 *
 * 자유 배치의 유일한 불친절은 어디가 빈 땅인지 눈에 안 보인다는 것이었다.
 * 규칙(길에서 46, 성문에서 100, 타워끼리 44)은 눈으로 계산할 수 있는 것이 아니다.
 *
 * 자리마다 얇은 고리 하나를 지면에 눕힌다. 원판이 아니라 고리인 이유는 전장을
 * 덮어 가리면 안 되기 때문이다 — 표시는 배경으로 물러나 있고 대열과 길이 그 위로 읽혀야 한다.
 * 어느 자리를 그릴지는 시뮬(World.buildableSpots)이 정한다. 뷰가 규칙을 다시
 * 구현하지 않으므로, **표시된 자리는 반드시 실제로 지어진다.**
 *
 * 수백 개를 각각 Mesh 로 두면 드로우콜이 그만큼 늘어난다. InstancedMesh 하나로
 * 그리고, 자리가 바뀔 때(건설·판매) 인스턴스 수만 다시 쓴다.
 */
export class BuildableField {
  readonly mesh: THREE.InstancedMesh;
  private geo: THREE.RingGeometry;
  private mat: THREE.MeshBasicMaterial;
  private dummy = new THREE.Object3D();
  private capacity: number;
  private pulseT = 0;
  private shown = false;

  constructor(private readonly terrain: Terrain, capacity = 512, radius = 15) {
    this.capacity = capacity;
    this.geo = new THREE.RingGeometry(radius - 2.2, radius, 24);
    this.geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0x3fd0c9, // RangeRing 의 "지을 수 있다" 청록과 같은 색
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    // 길 리본(0.6)과 핏자국(0.9) 위, 사거리 링(1.2) 아래에 눕는다.
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /** 시뮬이 준 자리들로 다시 그린다. 용량을 넘으면 앞에서부터 그만큼만 그린다. */
  setSpots(spots: readonly Spot[]): void {
    const n = Math.min(spots.length, this.capacity);
    for (let i = 0; i < n; i++) {
      const s = spots[i];
      // 지형 위 1유닛 — 굴곡진 땅에 묻히지 않을 만큼만 띄운다.
      this.dummy.position.set(s.x, this.terrain.heightAt(s.x, s.z) + 1, s.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = this.shown && n > 0;
  }

  setVisible(on: boolean): void {
    this.shown = on;
    this.mesh.visible = on && this.mesh.count > 0;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  /**
   * 아주 느린 맥동. 정지한 표시는 UI 로 읽히지 않고 지형 무늬로 보인다 —
   * 숨 쉬듯 밝기가 오르내리면 "누를 수 있는 것"으로 읽힌다.
   */
  update(dt: number): void {
    if (!this.mesh.visible) return;
    this.pulseT += dt;
    this.mat.opacity = 0.24 + Math.sin(this.pulseT * 1.6) * 0.08;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}
