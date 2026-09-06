import * as THREE from 'three';
import { Loop, FIXED_DT } from './core/Loop';
import { World } from './sim/World';
import { getLevel, nextLevelId, isTowerAvailable, LEVELS } from './data/levels';
import { BALANCE, type PerformancePresetName } from './data/balance';
import { TOWER_LIST } from './data/towers';
import { getStratagem } from './data/stratagems';
import { getUnit } from './data/units';
import type { LevelDef } from './types/level';
import { createRenderer, guessPreset, type RendererHandle } from './view/Renderer';
import { AssetRegistry } from './view/AssetRegistry';
import { GameScene } from './view/GameScene';
import { CameraControls } from './view/CameraControls';
import { AudioManager } from './audio/AudioManager';
import { Hud, type HudSettings } from './ui/Hud';
import { TowerPanel } from './ui/TowerPanel';
import { ScreenFx } from './ui/ScreenFx';
import { LevelSelect } from './ui/LevelSelect';
import { recordClear, suggestedLevelId, bindProgress, claimLegacyProgress } from './ui/progress';
import { AccountService } from './account/AccountService';
import { LoginScreen } from './ui/LoginScreen';
import type { RunStats } from './types/events';
import { el } from './ui/dom';
import type { TargetingMode, TowerDef } from './types/towers';

const PRESET_KEY = 'samtd.preset';
const SETTINGS_KEY = 'samtd.settings';

class Game {
  private container: HTMLElement;
  private hudRoot: HTMLElement;
  private fxLayer: HTMLElement;
  private debugPanel: HTMLElement;

  private handle!: RendererHandle;
  private assets = new AssetRegistry();
  private audio!: AudioManager;

  private world!: World;
  private scene!: GameScene;
  private controls!: CameraControls;
  private hud!: Hud;
  private panel!: TowerPanel;
  private fx!: ScreenFx;
  private loop!: Loop;

  private preset: PerformancePresetName;
  private settings: HudSettings;
  private debug = new URLSearchParams(location.search).has('debug');
  /** 그리기가 한 번이라도 터졌는지 — 같은 에러를 매 프레임 찍지 않기 위한 빗장 */
  private renderFailed = false;

  private levelSelect!: LevelSelect;
  /** 계정·진행도·전적의 창구. 저장소는 브라우저 또는 토르소 DB다. */
  private accounts = new AccountService();
  private loginScreen!: LoginScreen;
  private level: LevelDef;
  /** ?level= 로 직접 지정된 경우. 지정됐으면 레벨 선택 화면을 건너뛴다. */
  private readonly forcedLevelId: string | null;
  private selectedSlot: string | null = null;
  private frames = 0;
  private fpsAccum = 0;
  private fps = 0;
  /** 초기 3초 fps 측정으로 프리셋을 자동 보정한다 */
  private autoTuneTime = 0;
  private autoTuned = false;
  private resizeObserver: ResizeObserver | null = null;
  private ambientVignette!: HTMLElement;

  constructor() {
    this.container = document.getElementById('canvas-container')!;
    this.hudRoot = document.getElementById('hud-root')!;
    this.fxLayer = document.getElementById('fx-layer')!;
    this.debugPanel = document.getElementById('debug-panel')!;

    const stored = localStorage.getItem(PRESET_KEY) as PerformancePresetName | null;
    this.preset = stored ?? guessPreset();
    this.settings = this.loadSettings();

    // ?level=2 로 직접 지정할 수 있다 (개발·테스트용). 없으면 진행도가 정한다.
    const asked = new URLSearchParams(location.search).get('level');
    const askedId = asked ? (/^\d+$/.test(asked) ? `level0${asked}` : asked) : null;
    // 없는 id를 물어보면 진행도가 정한 레벨로 조용히 되돌린다 (URL 오타로 흰 화면이 되지 않게).
    this.forcedLevelId = askedId && LEVELS[askedId] ? askedId : null;
    /*
     * 진행도는 계정에 붙으므로 여기서는 아직 알 수 없다.
     * 일단 첫 장(또는 URL이 지목한 장)으로 세우고, 로그인이 끝난 뒤
     * start()에서 그 계정의 진행도에 맞는 장으로 바꾼다.
     */
    this.level = getLevel(this.forcedLevelId ?? suggestedLevelId());
  }

  /** 이 레벨에서 지을 수 있는 타워들 */
  private buildableTowers(): TowerDef[] {
    return TOWER_LIST.filter((t) => isTowerAvailable(t.unlockedIn, this.level.id));
  }

  private loadSettings(): HudSettings {
    const base: HudSettings = {
      bgmVolume: 0.5,
      sfxVolume: 0.8,
      preset: this.preset,
      shake: true,
      damageNumbers: true,
    };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? { ...base, ...(JSON.parse(raw) as Partial<HudSettings>), preset: this.preset } : base;
    } catch {
      return base;
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      localStorage.setItem(PRESET_KEY, this.preset);
    } catch {
      /* 저장 실패는 무시한다 */
    }
  }

  async start(): Promise<void> {
    const loading = this.showLoading();

    this.handle = await createRenderer(this.container);
    this.container.append(
      el('div', { id: 'backend-label', text: `renderer: ${this.handle.backend}` }),
    );

    await this.assets.load((loaded, total, label) => loading.progress(loaded / total, label));
    this.audio = new AudioManager(this.assets);

    // 상시 비네트 — 후처리 패스 대신 CSS 한 겹 (BALANCE.presets.*.postFx로 켜고 끈다)
    this.ambientVignette = el('div', { class: 'ambient-vignette' });
    this.fxLayer.append(this.ambientVignette);

    this.fx = new ScreenFx(this.fxLayer);
    this.fx.showDamageNumbers = this.settings.damageNumbers;

    this.buildHud();
    this.buildWorld();
    this.setupInput();
    this.setupLoop();

    loading.done();

    // 디버그 모드면 씬이 자리를 잡은 뒤 진단 한 줄을 자동으로 찍는다.
    if (this.debug) setTimeout(() => this.dumpDiagnostics(), 2500);

    this.levelSelect = new LevelSelect(this.hudRoot, (id) => this.switchLevel(id));

    if (this.forcedLevelId) {
      // URL이 레벨을 직접 지목했으면 로그인·잠금·선택 화면을 건너뛴다
      // (개발·스모크 테스트 경로). 그 판의 진행도는 어디에도 남지 않는다.
      this.hud.showBanner(this.level.title, false);
      return;
    }

    // 로그인이 끝나기 전에는 게임이 돌지 않는다 — 진행도가 계정에 붙기 때문이다.
    this.setPaused(true, false);
    await this.signIn();

    // 그 계정이 어디까지 깼는지에 맞춰 시작 지점을 다시 정한다.
    // 1장을 깼으면 2장이, 2장까지 깼으면 3장이 열려 있다.
    this.level = getLevel(suggestedLevelId());
    this.panel.setBuildable(this.buildableTowers());
    this.restart();
    this.setPaused(true, false);
    this.levelSelect.open();
  }

  /**
   * 첫 화면. 새로고침이면 저장된 세션을 되살리고, 아니면 아이디·비밀번호를 받는다.
   * 이 브라우저에서 처음 만드는 계정에는 계정 기능 이전의 진행도를 물려준다.
   */
  private async signIn(): Promise<void> {
    bindProgress(this.accounts);
    this.loginScreen = new LoginScreen(this.hudRoot, this.accounts);

    if (!(await this.accounts.restore())) {
      const account = await this.loginScreen.open();
      const legacy = claimLegacyProgress();
      if (legacy) this.accounts.adoptProgress(legacy);
      this.hud.announce(`${account.displayName} 님으로 접속했습니다`);
    }

    const who = this.accounts.current;
    this.levelSelect.setAccount(
      who ? { displayName: who.displayName, onLogout: () => void this.logout() } : null,
    );
  }

  /**
   * 로그아웃 — 계정을 놓고 첫 화면으로 돌아간다.
   * 진행도 캐시도 함께 비워야 다음 사람이 앞사람의 잠금 해제를 물려받지 않는다.
   */
  private async logout(): Promise<void> {
    this.accounts.logout();
    this.audio.stopBgm();
    this.setPaused(true, false);
    await this.signIn();
    this.level = getLevel(suggestedLevelId());
    this.panel.setBuildable(this.buildableTowers());
    this.restart();
    this.setPaused(true, false);
    this.levelSelect.open();
  }

  /** 전적 한 줄을 남긴다. 이겨도 져도 남긴다 (향후 토르소 DB의 전적 테이블). */
  private saveRecord(stats: RunStats, won: boolean): void {
    this.accounts.saveRecord({
      levelId: this.level.id,
      levelTitle: this.level.title,
      won,
      stars: stats.stars,
      wavesCleared: stats.wavesCleared,
      totalWaves: stats.totalWaves,
      kills: stats.kills,
      leaks: stats.leaks,
      castleHp: stats.castleHp,
      castleMaxHp: stats.castleMaxHp,
      castleLevel: stats.castleLevel,
      goldEarned: stats.goldEarned,
      elapsed: stats.elapsed,
    });
  }

  // ── 로딩 화면 ──────────────────────────────────────────────────────

  private showLoading(): { progress: (r: number, label: string) => void; done: () => void } {
    const fill = el('div', { class: 'loading__fill' });
    const label = el('div', { class: 'loading__label', text: '전장을 준비하는 중…' });
    const node = el('div', { id: 'loading' }, [
      el('div', { class: 'loading__art', text: '三國' }),
      el('div', { class: 'loading__bar' }, [fill]),
      label,
    ]);
    document.getElementById('app')!.append(node);
    return {
      progress: (r, l) => {
        fill.style.width = `${Math.round(r * 100)}%`;
        if (l) label.textContent = `불러오는 중: ${l}`;
      },
      done: () => {
        fill.style.width = '100%';
        node.classList.add('done');
        setTimeout(() => node.remove(), 450);
      },
    };
  }

  // ── HUD ────────────────────────────────────────────────────────────

  private buildHud(): void {
    this.hud = new Hud(
      this.hudRoot,
      {
        onSpeed: (s) => {
          this.loop.setSpeed(s);
          this.hud.setSpeed(s);
          void this.audio.unlock();
        },
        onPause: (paused) => this.setPaused(paused),
        onCallWave: () => {
          const bonus = this.world.callWaveEarly();
          if (bonus > 0) this.hud.announce(`조기 소집 보너스 ${bonus} 골드`);
          this.audio.play('ui:tap');
        },
        onRepair: () => {
          const healed = this.world.repairCastle();
          if (healed > 0) {
            this.audio.play('tower:built');
            this.hud.announce(`성벽을 ${healed} 수리했습니다`);
          }
        },
        onCastleUpgrade: () => {
          const before = this.world.castle.level;
          if (this.world.upgradeCastle() !== 'ok') return;
          const def = this.world.castle.levelDef;
          this.audio.play('tower:built');
          this.hud.announce(`성문 ${before} → ${def.level}단계: ${def.title}`);
          this.hud.showBanner(`성문 강화 — ${def.title}`, true);
        },
        onStratagem: (id) => {
          void this.audio.unlock();
          this.world.castStratagem(id);
        },
        onRestart: () => this.restart(),
        onNextLevel: () => {
          const next = nextLevelId(this.level.id);
          if (next) this.switchLevel(next);
        },
        onLevelSelect: () => {
          this.hud.closeOverlay();
          this.setPaused(true, false);
          // 장 선택으로 나가면 그 레벨의 배경음도 끝난다.
          this.audio.stopBgm();
          this.levelSelect.open();
        },
        onOpenSettings: () => {
          this.setPaused(true, false);
          this.hud.showSettings();
        },
        onCloseSettings: () => {
          this.hud.closeOverlay();
          this.setPaused(false);
          this.saveSettings();
        },
        onVolume: (bus, v) => this.audio.setVolume(bus, v),
        onPreset: (p) => this.applyPreset(p),
        onToggleShake: (on) => {
          this.scene.shakeEnabled = on;
        },
        onToggleDamageNumbers: (on) => {
          this.fx.showDamageNumbers = on;
        },
        onResetView: () => this.scene.stage.resetView(),
        onToggleBgm: (on) => {
          this.audio.setBgmEnabled(on);
          this.hud.setBgmOn(on);
        },
      },
      this.settings,
    );

    this.panel = new TowerPanel(this.hudRoot, this.buildableTowers(), {
      onBuild: (slotId, towerId) => {
        const r = this.world.build(slotId, towerId);
        if (r === 'ok') {
          this.audio.play('tower:built');
          this.selectSlot(null);
        } else if (r === 'no_gold') {
          this.hud.announce('골드가 부족합니다');
        }
      },
      onUpgrade: (slotId) => {
        const r = this.world.upgrade(slotId);
        if (r === 'ok') {
          this.audio.play('tower:upgraded');
          this.refreshPanel();
        } else if (r === 'no_gold') {
          this.hud.announce('골드가 부족합니다');
        }
      },
      onSell: (slotId) => {
        const refund = this.world.sell(slotId);
        this.audio.play('tower:sold');
        this.hud.announce(`망루를 판매해 ${refund} 골드를 회수했습니다`);
        this.selectSlot(null);
      },
      onTargeting: (slotId, mode: TargetingMode) => {
        this.world.setTargeting(slotId, mode);
        this.refreshPanel();
      },
      onClose: () => this.selectSlot(null),
    });
  }

  // ── 월드 + 씬 ──────────────────────────────────────────────────────

  private buildWorld(): void {
    this.world = new World({ level: this.level, seed: 1 });

    this.scene = new GameScene(this.world, this.assets, BALANCE.presets[this.preset], {
      onSlotTapped: (slotId, sx, sy) => {
        void this.audio.unlock();
        this.audio.play('ui:tap');
        this.selectSlot(slotId, sx, sy);
      },
      onEmptyTapped: () => this.selectSlot(null),
      onKillReward: (sx, sy, gold, isBoss) => {
        const dest = this.hud.goldScreenPos();
        // 코인이 도착하는 순간 골드 숫자가 오른다.
        const apply = () => {
          this.hud.setGold(this.world.economy.gold);
          this.audio.play('ui:gold');
        };
        if (isBoss) this.fx.flyCoinBurst(sx, sy, dest.x, dest.y, 6, apply);
        else this.fx.flyCoin(sx, sy, dest.x, dest.y, apply, false);
        void gold;
      },
      onCastleHit: (unitId, isBoss) => {
        this.fx.flashVignette();
        /*
         * 성벽을 때린 소리. 보병이면 soldier, 장수면 middle_boss가 난다.
         * 유닛 id를 먼저 찾고 없으면 종류(kind)로 떨어지므로,
         * 새 진영을 추가해도 SOUND_MAP을 건드릴 필요가 없다.
         */
        this.audio.play('enemy:castle-attack', unitId, 0.4, getUnit(unitId).kind);
        void isBoss;
      },
      onCastleSpark: (isBoss) => {
        this.audio.play('castle:spark', undefined, 0.4);
        if (isBoss) this.fx.flashVignette();
      },
    });

    this.scene.applyPreset(BALANCE.presets[this.preset], this.handle.renderer);
    this.ambientVignette.hidden = !BALANCE.presets[this.preset].postFx;
    this.scene.highlightSlots(true);
    this.bindWorldEvents();

    this.hud.setGold(this.world.economy.gold, true);
    this.hud.setCastle(this.world.castle.hp, this.world.castle.maxHp);
    this.hud.setWave(0, this.world.waveRunner.totalWaves);
    this.hud.setLevelTitle(this.level.title);
    this.hud.setRepairAvailable(!!this.level.allowRepair);
    this.hud.setCastleUpgradeAvailable(!!this.level.castleUpgrade);
    this.hud.setStratagems(this.world.stratagems);
    this.hud.setEarlyCallRate(this.level.earlyCallBonusPerSecond ?? BALANCE.earlyCallBonusPerSecond);
    // 배경음은 이 레벨이 끝날 때까지 반복 재생된다. 곡은 숨긴 유튜브 플레이어에서
    // 스트리밍되고, 자동재생이 막혀 있으면 첫 터치/클릭에서 알아서 시작한다.
    this.hud.setBgmOn(this.audio.isBgmEnabled());
    void this.audio.playBgm(this.level.environment.bgmYoutubeId);
  }

  /** 레벨 전환 — 씬을 통째로 새로 만든다 */
  private switchLevel(levelId: string): void {
    this.level = getLevel(levelId);
    this.panel.setBuildable(this.buildableTowers());
    this.restart();
    this.hud.showBanner(this.level.title, false);
  }

  private bindWorldEvents(): void {
    const bus = this.world.bus;

    bus.on('gold:changed', ({ reason, total }) => {
      // 처치 골드는 코인이 도착할 때 반영한다. 그 외(건설·판매·조기소집)는 즉시.
      if (reason !== 'kill') this.hud.setGold(total);
    });

    bus.on('castle:damaged', ({ hp, maxHp }) => this.hud.setCastle(hp, maxHp));
    bus.on('castle:repaired', ({ hp, maxHp }) => this.hud.setCastle(hp, maxHp));
    // 강화하면 최대 체력이 늘어난다 — 게이지가 그 자리에서 늘어나야 이해된다
    bus.on('castle:upgraded', ({ hp, maxHp }) => this.hud.setCastle(hp, maxHp));

    bus.on('stratagem:cast', ({ stratagemId, affected }) => {
      const def = getStratagem(stratagemId);
      this.hud.flashStratagem(stratagemId);
      this.audio.play('stratagem:cast', stratagemId);
      this.fx.flashVignette();
      this.hud.announce(
        def.effect.type === 'rally'
          ? `${def.displayName} — 망루 ${affected}기가 힘을 얻었습니다`
          : `${def.displayName} — 적 ${affected}기에 적중`,
      );
    });

    bus.on('enemy:damaged', ({ enemyId, amount, hpRatio, worldPos }) => {
      const p = this.scene.project(worldPos.x, worldPos.y, worldPos.z);
      this.fx.showDamage(p.x, p.y, amount, amount >= 20);
      const isBoss = this.scene.bossEnemyId === enemyId;
      this.fx.setHealth(enemyId, hpRatio, isBoss);
      if (isBoss) this.hud.showBoss(this.bossName(), hpRatio);
    });

    bus.on('enemy:killed', ({ enemyId, unitId, worldPos }) => {
      this.fx.removeHealth(enemyId);
      this.audio.play('enemy:killed', unitId, this.panOf(worldPos.x));
      if (getUnit(unitId).kind !== 'minion') this.hud.hideBoss();
    });

    bus.on('enemy:leaked', ({ enemyId, unitId }) => {
      this.fx.removeHealth(enemyId);
      if (getUnit(unitId).kind !== 'minion') this.hud.hideBoss();
    });

    bus.on('enemy:spawned', ({ unitId }) => {
      if (getUnit(unitId).kind !== 'minion') this.audio.play('enemy:spawned', unitId);
    });

    bus.on('projectile:fired', ({ towerSlotId, from }) => {
      // 발사음은 쏜 타워 종류로 고른다 — 활 망루는 활, 벽력거는 돌.
      const towerId = this.world.towers.get(towerSlotId)?.def.id;
      if (towerId) this.audio.play('projectile:fired', towerId, this.panOf(from.x));
    });

    /*
     * 성문 사격음. 시뮬은 일제사격 한 번에 이 이벤트를 한 번만 낸다 —
     * 대포 4발마다 굉음이 네 번 겹치면 그건 포성이 아니라 잡음이 된다.
     * 화살 단계는 매핑이 없어 소리가 나지 않는다(SOUND_MAP 주석 참고).
     */
    bus.on('castle:fired', ({ kind }) => {
      const gate = this.world.castlePosition();
      this.audio.play('castle:fired', kind, this.panOf(gate.x));
    });

    bus.on('wave:started', ({ index, total, banner, isBossWave }) => {
      this.hud.setWave(index, total);
      this.hud.showBanner(banner, isBossWave);
      this.hud.setCallEnabled(false);
      this.audio.play(isBossWave ? 'wave:boss' : 'wave:started');
    });

    bus.on('wave:cleared', ({ index }) => {
      this.hud.showBanner(`제 ${index}파 격퇴`, false);
      this.hud.setCallEnabled(true);
    });

    bus.on('wave:countdown', ({ remaining, total }) => this.hud.setCountdown(remaining, total));

    bus.on('level:won', ({ stats }) => {
      this.audio.play('level:won');
      this.audio.stopBgm();
      recordClear(this.level.id, stats.stars);
      this.saveRecord(stats, true);
      const next = nextLevelId(this.level.id);
      this.hud.showResult(true, stats, next ? getLevel(next).title : null);
    });

    bus.on('level:lost', ({ stats }) => {
      this.audio.play('level:lost');
      this.audio.stopBgm();
      this.saveRecord(stats, false);
      this.hud.showResult(false, stats, null);
    });
  }

  private bossName(): string {
    const id = this.scene.bossEnemyId;
    if (id === null) return '';
    const enemy = this.world.enemies.find((e) => e.id === id);
    return enemy ? getUnit(enemy.defId).displayName : '';
  }

  /** 화면 x위치 기반 약한 스테레오 팬 (-1 ~ 1) */
  private panOf(worldX: number): number {
    return Math.max(-1, Math.min(1, (worldX / BALANCE.mapWidth - 0.5) * 2));
  }

  // ── 슬롯 선택 ──────────────────────────────────────────────────────

  private selectSlot(slotId: string | null, sx = 0, sy = 0): void {
    this.selectedSlot = slotId;
    this.scene.setSelected(slotId);
    if (!slotId) {
      this.panel.close();
      return;
    }
    if (sx || sy) this.panel.place(sx, sy);
    this.refreshPanel();
  }

  private refreshPanel(): void {
    const slotId = this.selectedSlot;
    if (!slotId) return;
    const tower = this.world.towers.get(slotId);
    if (tower) this.panel.showTower(tower, this.world.economy.gold);
    else this.panel.showBuild(slotId, this.world.economy.gold);
    this.scene.setSelected(slotId);
  }

  // ── 입력 ───────────────────────────────────────────────────────────

  private setupInput(): void {
    this.controls = new CameraControls(this.handle.domElement, this.scene.stage, {
      parallax: false,
      onTap: (x, y) => {
        void this.audio.unlock();
        this.scene.handleTap(x, y, this.handle.domElement.getBoundingClientRect());
      },
    });

    // 키보드: 1~5 슬롯 선택, U 업그레이드, Space 일시정지, +/- 속도
    window.addEventListener('keydown', this.onKeyDown);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();

    // 첫 사용자 제스처에서 오디오를 깨운다 (모바일 자동재생 정책)
    const unlock = () => void this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const slots = this.world.level.buildSlots;
    // 슬롯 수는 레벨마다 다르다 (레벨 1은 5개, 레벨 2는 6개). 있는 만큼만 잡힌다.
    if (e.key >= '1' && e.key <= '9') {
      const slot = slots[Number(e.key) - 1];
      if (slot) {
        const p = this.scene.project(slot.x, 40, slot.z);
        this.selectSlot(slot.id, p.x, p.y);
      }
      return;
    }
    switch (e.key.toLowerCase()) {
      case 'r':
      case 'home':
        this.scene.stage.resetView();
        break;
      case 'd':
        // 진단 한 줄을 콘솔에 다시 찍는다 (디버그 모드에서만)
        if (this.debug) this.dumpDiagnostics();
        break;
      case 'u':
        if (this.selectedSlot) {
          this.world.upgrade(this.selectedSlot);
          this.refreshPanel();
        }
        break;
      case ' ':
        e.preventDefault();
        this.setPaused(!this.loop.isPaused());
        break;
      case '+':
      case '=':
        this.changeSpeed(1);
        break;
      case '-':
      case '_':
        this.changeSpeed(-1);
        break;
      case 'escape':
        this.selectSlot(null);
        break;
    }
  };

  private changeSpeed(delta: number): void {
    const options = BALANCE.speedOptions;
    const i = options.indexOf(this.loop.getSpeed() as 1 | 2 | 3);
    const next = options[Math.max(0, Math.min(options.length - 1, i + delta))];
    this.loop.setSpeed(next);
    this.hud.setSpeed(next);
  }

  private setPaused(paused: boolean, showOverlay = true): void {
    this.loop.setPaused(paused);
    this.hud.setPaused(paused);
    if (paused && showOverlay) this.hud.showPause();
    else if (!paused) this.hud.closeOverlay();
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.handle.renderer.setSize(w, h, false);
    this.scene.resize(w, h);
  }

  // ── 루프 ───────────────────────────────────────────────────────────

  private setupLoop(): void {
    this.loop = new Loop({
      step: (dt) => this.world.step(dt),
      render: (alpha, dt) => this.render(alpha, dt),
    });
    this.loop.start();
  }

  private render(alpha: number, dt: number): void {
    // 키보드로 누르고 있는 카메라 이동은 프레임 단위로 밀어준다.
    this.controls.update(dt);
    this.scene.render(alpha, dt);
    this.fx.update(dt);
    this.hud.update(dt);

    // 적 체력바를 머리 위 화면 좌표로 따라가게 한다
    this.scene.forEachEnemyScreenPos((enemy, sx, sy) => {
      if (this.fx.hasHealth(enemy.id)) this.fx.positionHealth(enemy.id, sx, sy);
      else if (enemy.kind !== 'minion') this.fx.setHealth(enemy.id, enemy.hpRatio, true);
    });

    // 대기 중일 때만 조기 소집 버튼 활성
    this.hud.setCallEnabled(this.world.waveRunner.isWaiting && this.world.over === 'none');

    // 성벽 수리 버튼 (레벨 2부터)
    if (this.level.allowRepair) {
      this.hud.setRepair(this.world.repairStatus(), this.world.repairQuote(), this.world.repairCooldown);
    }

    // 성문 강화 버튼 (4장부터)
    if (this.level.castleUpgrade) {
      this.hud.setCastleUpgrade(
        this.world.castleUpgradeStatus(),
        this.world.castle.level,
        this.world.castleUpgradeQuote(),
      );
    }

    // 계략 버튼 (레벨이 열어준 것만)
    for (const st of this.world.stratagems) {
      this.hud.setStratagem(
        st.id,
        this.world.stratagemStatus(st.id),
        st.cost,
        this.world.stratagemCooldown(st.id),
        st.id === 'fire_attack' ? this.world.fireStormRemaining : st.id === 'ice_storm' ? this.world.iceStormRemaining : this.world.rallyRemaining,
      );
    }

    // WebGPU 경로는 render()가 비동기로 도는 탓에 info를 프레임 경계에서
    // 스스로 리셋하지 못한다. 그대로 두면 draws/tris가 계속 누적돼
    // (수천 단위로 불어난다) 성능 판단에 못 쓴다. 그리기 직전에 직접 턴다.
    this.handle.renderer.info.reset();
    try {
      this.handle.renderer.render(this.scene.stage.scene, this.scene.stage.camera);
    } catch (err) {
      // 백엔드가 무너지면 매 프레임 같은 에러가 터진다. 한 번만 남기고 삼킨다.
      // (WebGPU 파이프라인 생성 실패 때 콘솔에 수천 줄이 쌓여 브라우저가 멎었다.)
      if (!this.renderFailed) {
        this.renderFailed = true;
        console.error(
          `[renderer] ${this.handle.backend} 백엔드에서 그리기가 실패했습니다. ` +
            '이후 같은 에러는 숨깁니다. ?gpu=1 을 뺀 기본(WebGL2)으로 열어보세요.',
          err,
        );
      }
    }

    this.updateFps(dt);
    if (this.debug) this.updateDebug();
  }

  private updateFps(dt: number): void {
    this.frames++;
    this.fpsAccum += dt;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.frames / this.fpsAccum;
      this.frames = 0;
      this.fpsAccum = 0;
    }
    // 초기 3초 fps 측정으로 프리셋 자동 보정
    if (!this.autoTuned) {
      this.autoTuneTime += dt;
      if (this.autoTuneTime >= 3) {
        this.autoTuned = true;
        if (this.fps < 26 && this.preset !== 'low') this.applyPreset('low');
        else if (this.fps < 45 && this.preset === 'high') this.applyPreset('medium');
      }
    }
  }

  private applyPreset(name: PerformancePresetName): void {
    this.preset = name;
    this.settings.preset = name;
    const p = BALANCE.presets[name];
    this.handle.setPixelRatio(p.maxDpr);
    this.ambientVignette.hidden = !p.postFx;
    this.handle.renderer.toneMappingExposure = p.postFx ? 1.05 : 1.0;
    this.scene.applyPreset(p, this.handle.renderer);
    this.resize();
    this.saveSettings();
    console.log(`[perf] preset: ${name}`);
  }

  /**
   * 진단 한 줄 — `?debug=1` 이면 자동으로 한 번, 그리고 D 키로 언제든 다시 찍는다.
   *
   * "모델이 안 보인다"를 화면만 보고 가려낼 수는 없다. 로드/뷰 생성/그리기 중
   * 어디서 끊겼는지는 이 한 줄이면 갈린다.
   */
  dumpDiagnostics(): void {
    const r = this.handle.renderer as THREE.WebGLRenderer & { isWebGPURenderer?: boolean };
    const canvas = r.domElement;
    console.log(
      '[진단] ' +
        JSON.stringify({
          backend: this.handle.backend,
          isWebGPU: !!r.isWebGPURenderer,
          canvas: `${canvas.width}x${canvas.height}`,
          preset: this.preset,
          level: this.level.id,
          models: this.assets.modelReport(),
          world: {
            enemies: this.world.liveEnemyCount,
            towers: this.world.towers.size,
            wave: `${this.world.waveRunner.displayIndex}/${this.world.waveRunner.totalWaves} ${this.world.waveRunner.state}`,
          },
          scene: this.scene.viewReport(),
        }),
    );
  }

  private updateDebug(): void {
    this.debugPanel.hidden = false;
    document.body.classList.add('debug');
    const info = this.handle.renderer.info;
    const m = this.assets.modelReport();
    // 화면에 실제로 도는 스킨드 메시(= GLB 모델) 수. 0이면 모델이 안 붙은 것이고,
    // 0이 아닌데 안 보이면 그리기 단계의 문제다.
    let live = 0;
    let drawn = 0;
    this.scene.stage.root.traverse((o) => {
      if (!(o as THREE.SkinnedMesh).isSkinnedMesh) return;
      live++;
      if (o.visible) drawn++;
    });
    this.debugPanel.textContent = [
      `fps    ${this.fps.toFixed(0)}`,
      `draws  ${info.render.calls}`,
      `tris   ${info.render.triangles}`,
      `geo    ${info.memory.geometries}  tex ${info.memory.textures}`,
      `model  ${m.loaded}/${m.declared}${m.failed.length ? ` X:${m.failed.join(',')}` : ''}`,
      `skin   ${drawn}/${live} on screen`,
      `enemy  ${this.world.liveEnemyCount}`,
      `proj   ${this.world.liveProjectileCount}`,
      `wave   ${this.world.waveRunner.displayIndex}/${this.world.waveRunner.totalWaves} ${this.world.waveRunner.state}`,
      `speed  ${this.loop.getSpeed()}x  preset ${this.preset}`,
      `sim    ${this.world.elapsed.toFixed(1)}s (dt ${FIXED_DT.toFixed(4)})`,
    ].join('\n');
  }

  // ── 재시작 ─────────────────────────────────────────────────────────

  private restart(): void {
    // 새로고침 없이 완전히 재시작한다. 뷰와 구독을 전부 정리하고 다시 만든다.
    // 배경음은 buildWorld에서 그 레벨의 곡으로 다시 시작한다.
    this.audio.stopBgm();
    this.hud.closeOverlay();
    this.panel.close();
    this.fx.clear();
    this.selectedSlot = null;

    this.scene.dispose();
    this.world.bus.offAll();

    this.buildWorld();
    // buildWorld creates a new Stage. The old controls still reference the disposed camera,
    // so reconnect all pointer gestures to the new active Stage.
    this.controls.dispose();
    this.controls = new CameraControls(this.handle.domElement, this.scene.stage, {
      parallax: false,
      onTap: (x, y) => {
        void this.audio.unlock();
        this.scene.handleTap(x, y, this.handle.domElement.getBoundingClientRect());
      },
    });
    this.scene.resize(this.container.clientWidth, this.container.clientHeight);
    this.hud.reset();
    this.hud.setGold(this.world.economy.gold, true);
    this.hud.setCastle(this.world.castle.hp, this.world.castle.maxHp);
    this.hud.setWave(0, this.world.waveRunner.totalWaves);
    this.hud.setSpeed(this.loop.getSpeed());
    this.loop.setPaused(false);
    this.hud.setPaused(false);
    this.hud.showBanner('다시 시작', false);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.resizeObserver?.disconnect();
    this.loop.stop();
    this.controls.dispose();
    this.scene.dispose();
    this.panel.dispose();
    this.hud.dispose();
    this.fx.dispose();
    this.audio.dispose();
    this.assets.dispose();
    this.handle.dispose();
  }
}

// 부트스트랩
const game = new Game();
void game.start().catch((err) => {
  console.error('[boot] 시작 실패:', err);
  document.getElementById('app')!.append(
    el('div', { class: 'overlay' }, [
      el('div', { class: 'overlay__card' }, [
        el('h2', { class: 'overlay__title', text: '실행할 수 없습니다' }),
        el('p', { class: 'overlay__sub', text: String((err as Error)?.message ?? err) }),
      ]),
    ]),
  );
});

// three가 트리셰이킹으로 사라지지 않도록 (그리고 콘솔 디버깅용)
(window as unknown as { THREE: typeof THREE; game: Game }).THREE = THREE;
(window as unknown as { THREE: typeof THREE; game: Game }).game = game;
