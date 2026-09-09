import * as THREE from 'three';
import { BALANCE, type PerformancePreset } from '../../data/balance';
import { Rng } from '../../core/Rng';
import type { LevelEnvironment } from '../../types/level';
import type { Stage } from '../Stage';

const C = BALANCE.fx.weather;

/** Persistent atmosphere owns its clock and random stream, never the simulation's. */
export class ChapterWeather {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private time = { value: 0 };
  private flash = 0;
  private thunder = 0;
  private milestones = new Set<number>();
  private enabled = false;

  constructor(private env: LevelEnvironment, private stage: Stage, preset: PerformancePreset,
    private onThunder: () => void) {
    this.group.name = 'chapter-weather';
    if (env.weather) this.createParticles();
    this.applyPreset(preset);
    this.update(0);
  }

  private createParticles(): void {
    const w = this.env.weather!;
    const ash = w.kind === 'ash';
    const geometry = new THREE.PlaneGeometry(1, 1);
    const rng = new Rng(C.seed);
    const seeds = new Float32Array(C.capacity * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rng.next();
    geometry.setAttribute('weatherSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { weatherTime: this.time, tint: { value: new THREE.Color(w.color) },
        smokeTint: { value: new THREE.Color(C.smokeColor) } },
      vertexShader: `
        attribute vec4 weatherSeed;
        uniform float weatherTime;
        varying vec2 vUv; varying float vFade; varying float vSmoke; varying float vAge;
        void main() {
          vUv = uv;
          vSmoke = 0.0; vAge = 0.0;
          float age = fract(weatherSeed.y + weatherTime * ${C.rainSpeed / C.ceiling});
          vec3 p = vec3(weatherSeed.x * ${BALANCE.mapWidth + C.padding * 2}.0 - ${C.padding}.0,
            (1.0-age) * ${C.ceiling}.0,
            weatherSeed.z * ${BALANCE.mapDepth + C.padding * 2}.0 - ${C.padding}.0);
          p.x += age * ${w.wind.toFixed(1)};
          ${ash ? `
          age = fract(weatherSeed.y + weatherTime * ${C.ashSpeed / C.ceiling});
          p.y = (1.0-age) * ${C.ceiling}.0;
          p.x += sin(weatherTime + weatherSeed.z * 6.283185) * ${w.wind.toFixed(1)};
          vSmoke = step(weatherSeed.w, ${C.smokeFraction});
          if (vSmoke > .5) {
            age = fract(weatherSeed.y + weatherTime * ${C.smokeRise / C.smokeHeight});
            p = vec3((floor(weatherSeed.x * ${C.smokeColumns}.0) + .5) * ${BALANCE.mapWidth / C.smokeColumns}.0,
              ${C.smokeBase}.0 + age * ${C.smokeHeight}.0, ${C.smokeZ}.0);
            p.x += sin(age * 6.283185 + weatherSeed.z * 6.283185) * age * ${w.wind.toFixed(1)};
          }
          vAge = age;
          ` : ''}
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vec2 direction = normalize((modelViewMatrix * vec4(${w.wind.toFixed(1)}, -${C.ceiling}.0, 0.0, 0.0)).xy);
          ${ash ? `mv.xy += position.xy * mix(${C.ashSize}, ${C.smokeSize}.0 * (.5 + age), vSmoke);`
            : `mv.xy += direction * position.y * ${C.rainLength}.0
            + vec2(-direction.y, direction.x) * position.x * ${C.rainWidth};`}
          vFade = smoothstep(${C.nearFade}.0, ${C.fullFade}.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 tint, smokeTint; varying vec2 vUv; varying float vFade, vSmoke, vAge;
        void main() {
          float a = (1.0 - abs(vUv.x * 2.0 - 1.0)) * sin(vUv.y * 3.14159265);
          gl_FragColor = vec4(tint, a * vFade * ${C.rainOpacity});
          ${ash ? `
          vec2 q = vUv * 2.0 - 1.0;
          float edge = length(q) + sin(q.x * 13.0 + vAge * 17.0) * sin(q.y * 11.0 - vAge * 9.0) * .09;
          a = pow(max(0.0, 1.0-edge), 2.0);
          gl_FragColor = vec4(mix(tint, smokeTint, vSmoke), a * vFade
            * mix(${C.ashOpacity}, ${C.smokeOpacity} * sin(vAge * 3.14159265), vSmoke));
          ` : ''}
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, C.capacity);
    this.mesh.name = 'weather-batch';
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  applyPreset(preset: PerformancePreset): void {
    this.enabled = preset.particleScale > BALANCE.presets.low.particleScale;
    if (this.mesh) {
      const capacity = this.env.weather?.kind === 'ash' ? C.ashCount : C.capacity;
      this.mesh.count = this.enabled ? Math.round(capacity * preset.particleScale) : 0;
      this.mesh.visible = this.enabled;
    }
    if (!this.enabled) { this.flash = 0; this.thunder = 0; }
  }

  waveStarted(index: number, total: number): void {
    if (this.env.weather?.kind !== 'rain') return;
    const milestone = C.lightningMilestones.findIndex(p => index === Math.max(1, Math.ceil(total * p)));
    if (milestone < 0 || this.milestones.has(milestone)) return;
    this.milestones.add(milestone);
    if (this.enabled) { this.flash = C.flashSec; this.thunder = C.thunderDelay; }
  }

  update(dt: number): void {
    const w = this.env.weather;
    if (!w) return;
    dt = Math.min(C.maxDt, Math.max(0, dt));
    this.time.value += dt;
    this.flash = Math.max(0, this.flash - dt);
    if (this.thunder > 0) {
      this.thunder -= dt;
      if (this.thunder <= 0) this.onThunder();
    }
    const flash = Math.pow(this.flash / C.flashSec, 2) * C.flashStrength;
    this.stage.sun.color.set(w.sun);
    this.stage.sun.intensity = w.sunIntensity + flash;
    this.stage.setWeatherSky(w.sky, flash);
    const fog = this.stage.scene.fog as THREE.Fog;
    fog.near = w.fogNear; fog.far = w.fogFar;
  }

  dispose(): void {
    this.mesh?.geometry.dispose();
    (this.mesh?.material as THREE.Material | undefined)?.dispose();
    this.mesh?.dispose();
    this.group.removeFromParent(); this.group.clear();
  }
}
