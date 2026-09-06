import type { FireSource } from '../types/towers';

/** 투사체가 착탄 지점에 남기는 지속 화염 지대. 무엇이 남긴 불인지는 source가 안다. */
export class FireZone {
  id = 0;
  x = 0;
  z = 0;
  radius = 0;
  dps = 0;
  duration = 0;
  remaining = 0;
  tickAccumulator = 0;
  source: FireSource = 'arrow';

  init(
    id: number,
    x: number,
    z: number,
    radius: number,
    dps: number,
    duration: number,
    source: FireSource,
  ): void {
    this.id = id;
    this.x = x;
    this.z = z;
    this.radius = radius;
    this.dps = dps;
    this.duration = duration;
    this.remaining = duration;
    this.tickAccumulator = 0;
    this.source = source;
  }

  reset(): void {
    this.remaining = 0;
    this.tickAccumulator = 0;
  }
}
