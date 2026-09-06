import * as THREE from 'three';
import type { BuildSlotDef } from '../../types/level';
import type { Terrain } from '../Terrain';

/**
 * 미건설 슬롯 표시 — 지면의 반투명 육각 링 + 중앙 망치 아이콘.
 * 느리게 맥동해서 "여기 지을 수 있다"를 알린다.
 * 골드가 부족하면 회색으로 흐려지고, 첫 웨이브 전에는 더 밝게 강조한다.
 */
export class SlotMarker {
  readonly group = new THREE.Group();
  private ringMesh: THREE.Mesh;
  private hammer: THREE.Group;
  private mat: THREE.MeshBasicMaterial;
  private hammerMat: THREE.MeshBasicMaterial;
  private phase = 0;

  private affordable = true;
  private highlighted = false;

  constructor(readonly slot: BuildSlotDef, terrain: Terrain) {
    const y = terrain.heightAt(slot.x, slot.z);
    this.group.position.set(slot.x, y + 1.4, slot.z);

    // 육각 링
    const geo = new THREE.RingGeometry(19, 25, 6);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.PI / 6);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0x3fd0c9,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ringMesh = new THREE.Mesh(geo, this.mat);
    this.ringMesh.renderOrder = 5;
    this.group.add(this.ringMesh);

    // 망치 아이콘 (자루 + 머리)
    this.hammerMat = new THREE.MeshBasicMaterial({
      color: 0xe8f6f5,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.hammer = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 15), this.hammerMat);
    handle.rotation.y = Math.PI / 5;
    const head = new THREE.Mesh(new THREE.BoxGeometry(9, 0.8, 5), this.hammerMat);
    head.position.set(-4.2, 0, -5.2);
    head.rotation.y = Math.PI / 5;
    this.hammer.add(handle, head);
    this.hammer.position.y = 0.5;
    this.hammer.renderOrder = 6;
    this.group.add(this.hammer);
  }

  setAffordable(v: boolean): void {
    if (this.affordable === v) return;
    this.affordable = v;
    this.mat.color.setHex(v ? 0x3fd0c9 : 0x6f7570);
    this.hammerMat.color.setHex(v ? 0xe8f6f5 : 0x9aa09b);
  }

  /** 첫 웨이브 전 튜토리얼 강조 */
  setHighlighted(v: boolean): void {
    this.highlighted = v;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.phase += dt * (this.highlighted ? 2.6 : 1.5);
    const pulse = 0.5 + Math.sin(this.phase) * 0.5;
    const base = this.affordable ? (this.highlighted ? 0.55 : 0.38) : 0.2;
    this.mat.opacity = base + pulse * (this.highlighted ? 0.35 : 0.18);
    const s = 1 + pulse * (this.highlighted ? 0.07 : 0.035);
    this.ringMesh.scale.set(s, 1, s);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.ringMesh.geometry.dispose();
    this.mat.dispose();
    this.hammer.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.hammerMat.dispose();
    this.group.clear();
  }
}
