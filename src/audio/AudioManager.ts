import type { AssetRegistry } from '../view/AssetRegistry';
import { BALANCE } from '../data/balance';
import { Rng } from '../core/Rng';
import { SOUND_MAP, SOUND_BUS, SOUND_CLIPS, type SoundMapping } from './soundMap';
import { YoutubeBgm } from './YoutubeBgm';

export type BusName = 'bgm' | 'sfx' | 'ui';

interface BusState {
  gain: GainNode | null;
  volume: number;
  muted: boolean;
}

/**
 * 오디오 매니저.
 *
 * 규칙: 매니페스트에 음원이 없으면 조용히 넘어간다. 절대 에러를 던지지 않는다.
 * 첫 사용자 터치에서 AudioContext.resume()을 부른다 (모바일 자동재생 정책).
 * 같은 sfx가 50ms 안에 겹치면 스킵한다 — 48마리가 동시에 죽어도 소리가 터지지 않는다.
 * 3D 팬닝은 하지 않는다. 부감 뷰에서는 혼란만 준다. 화면 x위치 기반 약한 스테레오만 준다.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<BusName, BusState> = {
    bgm: { gain: null, volume: 0.5, muted: false },
    sfx: { gain: null, volume: 0.8, muted: false },
    ui: { gain: null, volume: 0.9, muted: false },
  };

  private decoded = new Map<string, AudioBuffer>();
  /** 음원별 앞 묵음 길이(초). 디코드할 때 한 번만 잰다 */
  private leadIn = new Map<string, number>();
  private lastPlayed = new Map<string, number>();
  /** 돌고 있는 반복 재생 (타는 성벽 같은 상태음) */
  private loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  /** 디코드를 기다리는 중인 반복 재생 — 기다리는 사이의 stopLoop 를 놓치지 않는다 */
  private loopPending = new Set<string>();
  /**
   * 배경음은 효과음과 경로가 완전히 다르다.
   * 곡 파일을 우리가 서빙하면 접속자마다 수 MB가 나가므로 유튜브에서 스트리밍한다.
   * 그래서 WebAudio 버스가 아니라 숨겨 둔 플레이어의 볼륨을 조절한다.
   */
  private youtube: YoutubeBgm | null = null;
  /** 지금 레벨의 배경음 (유튜브 영상 id). 껐다 켜면 이걸 다시 튼다 */
  private bgmId: string | null = null;
  private unlocked = false;
  private readonly dedupeMs = 50;

  constructor(private readonly assets: AssetRegistry) {
    this.loadSettings();
  }

  /** 첫 사용자 제스처에서 호출한다. 실패해도 게임은 계속된다. */
  async unlock(): Promise<void> {
    if (this.unlocked) return;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      for (const name of Object.keys(this.buses) as BusName[]) {
        const g = this.ctx.createGain();
        g.connect(this.master);
        this.buses[name].gain = g;
        this.applyBusGain(name);
      }
      await this.ctx.resume();
      this.unlocked = true;
    } catch (err) {
      console.warn('[audio] AudioContext 초기화 실패 — 무음으로 진행합니다.', err);
      this.ctx = null;
    }
  }

  private async decode(id: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const cached = this.decoded.get(id);
    if (cached) return cached;
    const raw = this.assets.getAudioBuffer(id);
    if (!raw) return null;
    try {
      // decodeAudioData가 버퍼를 소유하므로 사본을 넘긴다.
      const buf = await this.ctx.decodeAudioData(raw.slice(0));
      this.decoded.set(id, buf);
      if (SOUND_CLIPS[id]?.trimLead) this.leadIn.set(id, this.measureLeadIn(buf));
      return buf;
    } catch {
      return null;
    }
  }

  /** Distant filtered rumble uses the existing SFX bus, so mute and volume still apply. */
  playThunder(): void {
    const ctx = this.ctx, bus = this.buses.sfx.gain;
    if (!ctx || !bus || ctx.state !== 'running') return;
    const c = BALANCE.fx.weather;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * c.thunderSec), ctx.sampleRate);
    const data = buffer.getChannelData(0), rng = new Rng(c.seed);
    for (let i = 0; i < data.length; i++) data[i] = (rng.next() * 2 - 1) * Math.sin(Math.PI * i / data.length);
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = c.thunderHz;
    gain.gain.value = c.thunderGain;
    source.connect(filter); filter.connect(gain); gain.connect(bus);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start();
  }

  /**
   * 이벤트 이름으로 소리를 낸다. 매핑이 없거나 음원이 없으면 아무 일도 없다.
   * @param key    SOUND_MAP의 키 (보통 이벤트명)
   * @param variant unitId 등 하위 선택자
   * @param panX   -1(왼쪽) ~ 1(오른쪽). 화면 x위치.
   * @param fallbackVariant variant로 못 찾았을 때 다시 찾아볼 선택자.
   *   "이 유닛만의 소리가 있으면 그것, 없으면 종류별 기본음"을 한 줄로 쓰게 해 준다.
   */
  play(key: string, variant?: string, panX = 0, fallbackVariant?: string): void {
    const mapping: SoundMapping | undefined = SOUND_MAP[key];
    if (!mapping) return;
    const id =
      typeof mapping === 'string'
        ? mapping
        : (variant ? mapping[variant] : undefined) ??
          (fallbackVariant ? mapping[fallbackVariant] : undefined);
    if (!id) return;
    void this.playId(id, SOUND_BUS[key] ?? 'sfx', panX);
  }

  /**
   * 반복 재생을 건다 — 성벽이 타는 동안처럼 **상태가 이어지는** 소리.
   *
   * play() 로는 안 된다. 그쪽은 한 방짜리라 50ms 중복 차단에 걸려 두 번째부터
   * 조용해지고, 끊길 때마다 딸깍거린다. 여기서는 소스 하나를 loop 로 걸어 두고
   * stopLoop 가 페이드로 내린다.
   *
   * 이미 같은 id 가 돌고 있으면 아무 일도 하지 않는다 — 불이 두 번 붙어도
   * 소리가 두 겹으로 겹치면 안 된다.
   */
  async startLoop(id: string, bus: BusName = 'sfx'): Promise<void> {
    if (this.loops.has(id) || this.loopPending.has(id)) return;
    if (!this.ctx || !this.assets.hasAudio(id)) return;
    this.loopPending.add(id);
    try {
      const buf = await this.decode(id);
      // 기다리는 사이에 stopLoop 가 왔을 수 있다 — 그러면 시작하지 않는다
      if (!buf || !this.ctx || !this.loopPending.delete(id)) return;
      const busGain = this.buses[bus].gain;
      if (!busGain) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      /*
       * 앞뒤 묵음을 빼고 돈다. 안 그러면 한 바퀴마다 소리가 끊겨 "타는 중"이
       * 아니라 "반복 재생"으로 들린다.
       */
      const lead = this.leadIn.get(id) ?? 0;
      src.loopStart = lead;
      src.loopEnd = Math.max(lead + 0.1, buf.duration - 0.05);
      const gain = this.ctx.createGain();
      // 시작도 페이드로 — 갑자기 붙으면 딸깍 소리가 난다
      gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 0.12);
      src.connect(gain).connect(busGain);
      src.start(0, lead);
      this.loops.set(id, { src, gain });
    } catch {
      this.loopPending.delete(id);
    }
  }

  /** 반복 재생을 페이드로 내린다. 안 돌고 있으면 아무 일도 없다. */
  stopLoop(id: string, fadeSec = 0.25): void {
    // 아직 디코드를 기다리는 중이면 시작 자체를 취소한다
    this.loopPending.delete(id);
    const loop = this.loops.get(id);
    if (!loop || !this.ctx) return;
    this.loops.delete(id);
    const t0 = this.ctx.currentTime;
    loop.gain.gain.cancelScheduledValues(t0);
    loop.gain.gain.setValueAtTime(loop.gain.gain.value, t0);
    loop.gain.gain.linearRampToValueAtTime(0.0001, t0 + fadeSec);
    try {
      loop.src.stop(t0 + fadeSec);
    } catch {
      // 이미 멈춘 소스 — 그냥 넘어간다
    }
  }

  /** 돌고 있는 반복 재생을 전부 내린다 (레벨을 나갈 때) */
  stopAllLoops(): void {
    for (const id of [...this.loops.keys()]) this.stopLoop(id, 0.1);
    this.loopPending.clear();
  }

  async playId(id: string, bus: BusName = 'sfx', panX = 0): Promise<void> {
    if (!this.ctx || !this.assets.hasAudio(id)) return;

    const clip = SOUND_CLIPS[id];
    const now = performance.now();
    const last = this.lastPlayed.get(id) ?? -Infinity;
    if (now - last < (clip?.dedupeMs ?? this.dedupeMs)) return;
    this.lastPlayed.set(id, now);

    const buf = await this.decode(id);
    if (!buf || !this.ctx) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const busGain = this.buses[bus].gain;
    if (!busGain) return;

    // 잘라 쓰는 음원이면 구간과 끝맺음을 계산한다.
    const offset = clip?.trimLead ? (this.leadIn.get(id) ?? 0) : 0;
    const room = Math.max(0, buf.duration - offset);
    const length = clip ? Math.min(clip.duration, room) : room;

    let tail: AudioNode = src;
    if (clip && (clip.gain !== undefined || clip.fadeOut)) {
      const env = this.ctx.createGain();
      const level = clip.gain ?? 1;
      const t0 = this.ctx.currentTime;
      env.gain.setValueAtTime(level, t0);
      if (clip.fadeOut) {
        // 뚝 끊으면 딸깍 소리가 난다. 끝 fadeOut 구간 동안 0으로 내린다.
        const fade = Math.min(clip.fadeOut, length);
        env.gain.setValueAtTime(level, t0 + length - fade);
        env.gain.linearRampToValueAtTime(0.0001, t0 + length);
      }
      src.connect(env);
      tail = env;
    }

    if (Math.abs(panX) > 0.02 && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-0.6, Math.min(0.6, panX * 0.6));
      tail.connect(panner).connect(busGain);
    } else {
      tail.connect(busGain);
    }

    if (clip) src.start(0, offset, length);
    else src.start();
  }

  /**
   * 앞쪽 묵음 길이를 잰다.
   *
   * mp3는 인코딩 특성상 앞에 수십 ms의 묵음이 붙는다. 그대로 틀면 발사 순간과
   * 소리가 어긋나 타격감이 밀린다. 첫 유효 샘플까지를 건너뛸 만큼으로 잡되,
   * 어택을 깎지 않도록 5ms 앞에서 끊는다.
   */
  private measureLeadIn(buf: AudioBuffer): number {
    const data = buf.getChannelData(0);
    const limit = Math.min(data.length, buf.sampleRate); // 앞 1초만 본다
    for (let i = 0; i < limit; i++) {
      if (Math.abs(data[i]) > 0.01) return Math.max(0, i / buf.sampleRate - 0.005);
    }
    return 0;
  }

  /**
   * 레벨 배경음을 반복 재생한다. 인자는 유튜브 영상 id다.
   *
   * 화면 밖에 숨긴 유튜브 플레이어가 소리를 낸다 — 우리 서버는 곡을 전송하지 않는다.
   * 자동재생이 막혀 있으면 플레이어가 다음 사용자 조작에서 알아서 다시 시도한다.
   */
  async playBgm(videoId: string | undefined): Promise<void> {
    if (!videoId) return;
    this.bgmId = videoId;
    if (this.buses.bgm.muted) return;
    this.youtube ??= new YoutubeBgm();
    this.youtube.setVolume(this.buses.bgm.volume);
    this.youtube.setMuted(false);
    await this.youtube.play(videoId);
  }

  /** 재생 중인 배경음을 멈춘다. 어느 곡이었는지는 기억한다. */
  stopBgm(): void {
    this.youtube?.stop();
  }

  /** 배경음 켜기/끄기. 끄면 재생을 멈추고, 켜면 이 레벨의 곡을 다시 튼다. */
  setBgmEnabled(on: boolean): void {
    this.setMuted('bgm', !on);
    if (on) void this.playBgm(this.bgmId ?? undefined);
    else this.stopBgm();
  }

  isBgmEnabled(): boolean {
    return !this.buses.bgm.muted;
  }

  // ── 볼륨 ────────────────────────────────────────────────────────────
  setVolume(bus: BusName, v: number): void {
    this.buses[bus].volume = Math.max(0, Math.min(1, v));
    this.applyBusGain(bus);
    if (bus === 'bgm') this.youtube?.setVolume(this.buses.bgm.volume);
    this.saveSettings();
  }
  getVolume(bus: BusName): number {
    return this.buses[bus].volume;
  }
  setMuted(bus: BusName, muted: boolean): void {
    this.buses[bus].muted = muted;
    this.applyBusGain(bus);
    if (bus === 'bgm') this.youtube?.setMuted(muted);
    this.saveSettings();
  }
  isMuted(bus: BusName): boolean {
    return this.buses[bus].muted;
  }

  private applyBusGain(bus: BusName): void {
    const s = this.buses[bus];
    if (s.gain) s.gain.gain.value = s.muted ? 0 : s.volume;
  }

  private loadSettings(): void {
    try {
      const raw = localStorage.getItem('samtd.audio');
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<BusName, { volume: number; muted: boolean }>>;
      for (const name of Object.keys(this.buses) as BusName[]) {
        const s = parsed[name];
        if (s) {
          this.buses[name].volume = s.volume;
          this.buses[name].muted = s.muted;
        }
      }
    } catch {
      /* localStorage 접근 불가 — 기본값으로 진행 */
    }
  }

  private saveSettings(): void {
    try {
      const out: Record<string, { volume: number; muted: boolean }> = {};
      for (const name of Object.keys(this.buses) as BusName[]) {
        out[name] = { volume: this.buses[name].volume, muted: this.buses[name].muted };
      }
      localStorage.setItem('samtd.audio', JSON.stringify(out));
    } catch {
      /* 저장 실패는 무시 */
    }
  }

  dispose(): void {
    this.youtube?.dispose();
    this.youtube = null;
    this.decoded.clear();
    void this.ctx?.close();
    this.ctx = null;
  }
}
