import * as THREE from 'three';
import type { Terrain } from '../Terrain';

export type RingMode = 'buildable' | 'selected' | 'insufficient';

const COLORS: Record<RingMode, number> = {
  buildable: 0x3fd0c9, // 청록
  selected: 0xffffff, // 흰색
  insufficient: 0xe05a5a, // 적색
};

/**
 * 사거리 링. 반투명 원판 + 조금 더 진한 테두리.
 * 지형 굴곡을 따르도록 세분화된 원판을 쓰고, 정점 y를 지형에서 샘플링한다.
 */
export class RangeRing {
  readonly group = new THREE.Group();
  private disk: THREE.Mesh;
  private edge: THREE.Mesh;
  private diskMat: THREE.MeshBasicMaterial;
  private edgeMat: THREE.MeshBasicMaterial;
  private radius: number;
  private pulseT = 0;
  private wasVisible = false;

  constructor(radius: number, private readonly terrain: Terrain) {
    this.radius = radius;

    this.diskMat = new THREE.MeshBasicMaterial({
      color: COLORS.buildable,
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.edgeMat = new THREE.MeshBasicMaterial({
      color: COLORS.buildable,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.disk = new THREE.Mesh(this.makeDiskGeometry(radius), this.diskMat);
    this.edge = new THREE.Mesh(this.makeEdgeGeometry(radius), this.edgeMat);
    this.disk.renderOrder = 3;
    this.edge.renderOrder = 4;
    this.group.add(this.disk, this.edge);
  }

  private makeDiskGeometry(r: number): THREE.BufferGeometry {
    const geo = new THREE.CircleGeometry(r, 56, 0, Math.PI * 2);
    geo.rotateX(-Math.PI / 2);
    this.conformToTerrain(geo);
    return geo;
  }

  private makeEdgeGeometry(r: number): THREE.BufferGeometry {
    const geo = new THREE.RingGeometry(r - 2.5, r, 56);
    geo.rotateX(-Math.PI / 2);
    this.conformToTerrain(geo);
    return geo;
  }

  /** 원판 정점 y를 지형 높이에 맞춘다 — 굴곡 위에서 링이 파묻히지 않게. */
  private conformToTerrain(geo: THREE.BufferGeometry): void {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const cx = this.group.position.x;
    const cz = this.group.position.z;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.terrain.heightAt(cx + pos.getX(i), cz + pos.getZ(i)) + 1.2);
    }
    pos.needsUpdate = true;
  }

  setRadius(r: number): void {
    if (r === this.radius) return;
    this.radius = r;
    this.disk.geometry.dispose();
    this.edge.geometry.dispose();
    this.disk.geometry = this.makeDiskGeometry(r);
    this.edge.geometry = this.makeEdgeGeometry(r);
  }

  setMode(mode: RingMode): void {
    this.diskMat.color.setHex(COLORS[mode]);
    this.edgeMat.color.setHex(COLORS[mode]);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
    this.wasVisible = v;
  }

  /**
   * 업그레이드 시 한 번 밝게 번쩍.
   * 선택 상태가 아니었다면 번쩍임이 끝난 뒤 다시 숨긴다 —
   * 그러지 않으면 업그레이드한 타워의 링이 영원히 켜진 채로 남는다.
   */
  pulse(): void {
    // 이미 번쩍이는 중이면 원래 가시성을 다시 잡지 않는다.
    // 연속 업그레이드로 pulse가 겹칠 때 "번쩍임이 켜둔 상태"를
    // 원래 상태로 착각해 링이 영원히 남는 것을 막는다.
    if (this.pulseT <= 0) this.wasVisible = this.group.visible;
    this.pulseT = 1;
    this.group.visible = true;
  }

  update(dt: number): void {
    if (this.pulseT > 0) {
      this.pulseT = Math.max(0, this.pulseT - dt * 2.2);
      this.diskMat.opacity = 0.13 + this.pulseT * 0.35;
      this.edgeMat.opacity = 0.55 + this.pulseT * 0.45;
      if (this.pulseT === 0 && !this.wasVisible) this.group.visible = false;
    }
  }

  /** 지형에 맞춰 다시 계산 (위치를 옮긴 뒤 호출) */
  refresh(): void {
    this.conformToTerrain(this.disk.geometry);
    this.conformToTerrain(this.edge.geometry);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.disk.geometry.dispose();
    this.edge.geometry.dispose();
    this.diskMat.dispose();
    this.edgeMat.dispose();
    this.group.clear();
  }
}
