import * as THREE from 'three';
import { Loop, FIXED_DT } from './core/Loop';
import { World } from './sim/World';
import { getLevel, nextLevelId, isTowerAvailable, LEVELS } from './data/levels';
import { BALANCE, type PerformancePresetName } from './data/balance';
import { placementReason, spotKey } from './sim/Placement';
import { TOWER_LIST, getTower } from './data/towers';
import { getStratagem } from './data/stratagems';
import { getUnit } from './data/units';
import type { LevelDef } from './types/level';
import { createRenderer, guessPreset, type RendererHandle } from './view/Renderer';
import { AssetRegistry } from './view/AssetRegistry';
import { GameScene } from './view/GameScene';
import { CameraControls } from './view/CameraControls';
import { AudioManager } from './audio/AudioManager';
import { Hud, type HudSettings } from './ui/Hud';
import { trackViewport } from './ui/viewport';
import { TowerPanel, type RepairState } from './ui/TowerPanel';
import { ScreenFx } from './ui/ScreenFx';
import { LevelSelect } from './ui/LevelSelect';
import { Community } from './ui/Community';
import { recordClear, suggestedLevelId, bindProgress, claimLegacyProgress, isLevelCleared } from './ui/progress';
import { AccountService } from './account/AccountService';
import { LoginScreen } from './ui/LoginScreen';
import type { RunStats } from './types/events';
import { el, isTypingTarget } from './ui/dom';
import type { TargetingMode, TowerDef } from './types/towers';

const PRESET_KEY = 'samtd.preset';
const SETTINGS_KEY = 'samtd.settings';

/**
 * 저장된 프리셋을 **한 번만** 버리게 하는 표식.
 *
 * 기본 프리셋을 '높음'으로 바꿨는데, 그것만으로는 이미 플레이한 기기에 닿지 않는다.
 * 예전에는 userAgent 와 코어 수로 짐작해 시작 프리셋을 정했고(모바일이면 보통,
 * 코어 넷 이하도 보통), 그 짐작이 곧 localStorage 에 저장돼 굳었다. 그래서
 * 60fps 를 낼 수 있는 기기가 "한 번 흐리게 시작했다"는 이유만으로 계속 흐렸다.
 * 좋아진 화면을 보여 주려면 그 굳은 값을 한 번은 놓아 줘야 한다.
 *
 * 영구히 무시하지 않고 표식을 쓰는 이유: 무시해 버리면 "낮음이 좋다"고 직접 고른
 * 사람의 선택도, 실측으로 내려간 결과도 매번 덮어쓴다. 표식이 맞은 뒤부터는
 * 저장값이 다시 이긴다 — 딱 한 번만 비운다.
 *
 * 느린 기기가 손해 보지 않는 것도 같은 이유다. 비워도 3초 실측이 다시 돌아
 * 제자리로 내려가고(updateFps), 그 값이 새 표식과 함께 저장된다.
 *
 * 기본값을 또 크게 바꿀 때만 이 문자열을 올린다.
 */
const PRESET_EPOCH_KEY = 'samtd.preset.epoch';
const PRESET_EPOCH = '2';

/**
 * 열어 둔 망루 패널을 다시 그리는 주기(초).
 *
 * 짧으면 손가락 밑에서 버튼이 다시 만들어져 탭이 씹히고, 길면 수리비를 낼 수
 * 있게 된 뒤에도 버튼이 회색으로 남는다. 0.35초면 사람이 버튼을 누르는 동작
 * 한 번보다 길고, 내구도가 눈에 띄게 달라지기 전에 한 번은 돈다.
 */
const PANEL_REFRESH_SEC = 0.35;

/**
 * 이번 실행을 시작할 프리셋 — 저장값이 있으면 그것, 없으면 guessPreset().
 *
 * PRESET_EPOCH 가 바뀐 첫 실행에서는 저장값을 버리고 기본값으로 되돌린다
 * (위 PRESET_EPOCH_KEY 주석 참조). localStorage 를 아예 못 쓰는 환경
 * (사생활 보호 모드 등)에서는 접근 자체가 던지므로 기본값으로 넘어간다.
 */
function startingPreset(): PerformancePresetName {
  let stored: string | null = null;
  try {
    if (localStorage.getItem(PRESET_EPOCH_KEY) === PRESET_EPOCH) {
      stored = localStorage.getItem(PRESET_KEY);
    } else {
      localStorage.setItem(PRESET_EPOCH_KEY, PRESET_EPOCH);
      localStorage.removeItem(PRESET_KEY);
    }
  } catch {
    /* 저장소를 못 읽으면 짐작 없이 기본값으로 간다 */
  }
  return stored === 'low' || stored === 'medium' || stored === 'high' ? stored : guessPreset();
}

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
  private community!: Community;
  /** 계정·진행도·전적의 창구. 저장소는 브라우저 또는 토르소 DB다. */
  private accounts = new AccountService();
  private loginScreen!: LoginScreen;
  private level: LevelDef;
  /** ?level= 로 직접 지정된 경우. 지정됐으면 레벨 선택 화면을 건너뛴다. */
  private readonly forcedLevelId: string | null;
  /** 지금 고른 타워의 자리 id. 없으면 null. */
  private selectedSlot: string | null = null;
  /**
   * 아직 안 지은 후보 자리 — 빈 땅을 눌렀을 때의 좌표다.
   * 자유 배치라 "고른 자리"가 곧 좌표이고, 지어지는 순간 자리 id 를 얻는다.
   */
  private pendingSpot: { x: number; z: number } | null = null;
  /** 열린 망루 패널을 다시 그릴 때까지 모아 둔 시간 */
  private panelRefreshTimer = 0;
  /** 그 패널이 마지막으로 그린 내용의 서명 — 같으면 다시 그리지 않는다 */
  private panelSignature = '';
  private frames = 0;
  private fpsAccum = 0;
  private fps = 0;
  /** 초기 3초 fps 측정으로 프리셋을 자동 보정한다 */
  private autoTuneTime = 0;
  private autoTuned = false;
  private slowFrameTime = 0;
  private qualityCooldown = 12;
  private resizeObserver: ResizeObserver | null = null;
  private ambientVignette!: HTMLElement;

  constructor() {
    this.container = document.getElementById('canvas-container')!;
    this.hudRoot = document.getElementById('hud-root')!;
    this.fxLayer = document.getElementById('fx-layer')!;
    this.debugPanel = document.getElementById('debug-panel')!;

    this.preset = startingPreset();
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
      buildSpots: true,
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

    // 디버그 모드면 씬이 자리를 잡은 뒤 진단 한 줄을 자동으로 찍는다.
    if (this.debug) setTimeout(() => this.dumpDiagnostics(), 2500);

    this.levelSelect = new LevelSelect(this.hudRoot, (id) => this.switchLevel(id));
    // 방명록과 전적 이력. 메뉴를 덮고 뜨며, 닫으면 고르던 자리로 그대로 돌아온다.
    this.community = new Community(this.hudRoot, this.accounts);
    this.levelSelect.setCommunity({
      onGuestbook: () => this.community.open('guestbook'),
      onHistory: () => this.community.open('history'),
    });
    // 메뉴에도 그 장의 곡이 흐른다. 여기서도 끌 수 있어야 한다.
    this.levelSelect.setAudio({
      isOn: () => this.audio.isBgmEnabled(),
      onToggle: (on) => {
        this.audio.setBgmEnabled(on);
        this.hud.setBgmOn(on);
      },
    });

    if (this.forcedLevelId) {
      // URL이 레벨을 직접 지목했으면 로그인·잠금·선택 화면을 건너뛴다
      // (개발·스모크 테스트 경로). 그 판의 진행도는 어디에도 남지 않는다.
      this.hud.showBanner(this.level.title, false);
      loading.done();
      return;
    }

    // 로그인이 끝나기 전에는 게임이 돌지 않는다 — 진행도가 계정에 붙기 때문이다.
    this.setPaused(true, false);
    /*
     * 로딩 막은 여기서 걷지 않는다. 세션 복원은 서버를 한 번 다녀오는 일이라
     * 막을 먼저 걷으면 그 왕복 동안 1장 전장이 그대로 드러난다.
     * 첫 화면(로그인 또는 장 선택)이 실제로 덮은 뒤에 걷는다.
     */
    await this.signIn(loading.done);

    // 그 계정이 어디까지 깼는지에 맞춰 시작 지점을 다시 정한다.
    // 1장을 깼으면 2장이, 2장까지 깼으면 3장이 열려 있다.
    this.level = getLevel(suggestedLevelId());
    this.panel.setBuildable(this.buildableTowers());
    this.restart();
    this.setPaused(true, false);
    this.levelSelect.open();
    loading.done();
  }

  /**
   * 첫 화면. 새로고침이면 저장된 세션을 되살리고, 아니면 아이디·비밀번호를 받는다.
   * 이 브라우저에서 처음 만드는 계정에는 계정 기능 이전의 진행도를 물려준다.
   */
  private async signIn(onScreenUp: () => void = () => {}): Promise<void> {
    bindProgress(this.accounts);
    this.loginScreen = new LoginScreen(this.hudRoot, this.accounts);

    if (!(await this.accounts.restore())) {
      // open()은 화면을 먼저 세우고 로그인이 끝나기를 기다린다.
      // 그 사이에 로딩 막을 걷어야 아래 전장이 새어 보이지 않는다.
      const signedIn = this.loginScreen.open();
      onScreenUp();
      const account = await signedIn;
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
    this.community?.close();
    this.accounts.logout();
    this.audio.stopBgm();
    this.audio.stopAllLoops();
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
      el('div', { class: 'loading__art', text: '三國志' }),
      el('div', { class: 'loading__bar' }, [fill]),
      label,
    ]);
    document.getElementById('app')!.append(node);
    // 첫 화면이 로그인이냐 장 선택이냐에 따라 걷는 자리가 달라서 두 번 불릴 수 있다.
    let dismissed = false;
    return {
      progress: (r, l) => {
        fill.style.width = `${Math.round(r * 100)}%`;
        if (l) label.textContent = `불러오는 중: ${l}`;
      },
      done: () => {
        if (dismissed) return;
        dismissed = true;
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
          if (!this.fastForwardAllowed() && s > 1) return;
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
          this.audio.stopAllLoops();
          this.levelSelect.open();
        },
        onRequestExitToMenu: () => {
          this.setPaused(true, false);
          this.hud.showExitConfirm();
        },
        onExitToMenu: () => {
          this.hud.closeOverlay();
          this.setPaused(true, false);
          this.audio.stopBgm();
          this.audio.stopAllLoops();
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
        onToggleBuildSpots: (on) => {
          this.settings.buildSpots = on;
          this.scene.showBuildableSpots(on);
          this.hud.setBuildSpotsOn(on);
          this.saveSettings();
        },
      },
      this.settings,
    );

    this.panel = new TowerPanel(this.hudRoot, this.buildableTowers(), {
      onBuild: (_key, towerId) => {
        const spot = this.pendingSpot;
        if (!spot) return;
        const r = this.world.build(spot, towerId);
        if (r === 'ok') {
          this.audio.play('tower:built');
          this.clearSelection();
        } else if (r === 'no_gold') {
          this.hud.announce('골드가 부족합니다');
        } else if (r !== 'game_over' && r !== 'locked') {
          this.hud.announce(placementReason(r));
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
        this.clearSelection();
      },
      onRepair: (slotId) => {
        const healed = this.world.repairTower(slotId);
        if (healed <= 0) {
          this.hud.announce('지금은 수리할 수 없습니다');
          return;
        }
        this.audio.play('tower:built');
        const tower = this.world.towers.get(slotId);
        this.hud.announce(
          `${tower?.def.displayName ?? '망루'} 내구도를 ${healed} 회복했습니다`,
        );
        // 남은 골드가 줄었으므로 업그레이드 버튼의 판정도 다시 그려야 한다.
        this.refreshPanel();
      },
      onTargeting: (slotId, mode: TargetingMode) => {
        this.world.setTargeting(slotId, mode);
        this.refreshPanel();
      },
      onClose: () => this.clearSelection(),
    });
  }

  // ── 월드 + 씬 ──────────────────────────────────────────────────────

  private buildWorld(): void {
    this.world = new World({ level: this.level, seed: 1 });

    this.scene = new GameScene(this.world, this.assets, BALANCE.presets[this.preset], {
      onWeatherThunder: () => this.audio.playThunder(),
      onTowerTapped: (slotId, sx, sy) => {
        void this.audio.unlock();
        this.audio.play('ui:tap');
        this.selectTower(slotId, sx, sy);
      },
      onGroundTapped: (x, z, sx, sy) => {
        void this.audio.unlock();
        this.audio.play('ui:tap');
        this.selectSpot(x, z, sx, sy);
      },
      onEmptyTapped: () => this.clearSelection(),
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
      onTowerHit: (unitId, isBoss, sx, sy, amount) => {
        /*
         * 망루가 맞은 것도 피해 숫자로 띄운다 — 적이 맞을 때와 같은 어휘다.
         * 붉게 칠하는 이유: 같은 숫자라도 **내가 잃는 쪽**은 색이 달라야
         * 전장 한가운데서 한눈에 갈린다 (fire 플래그를 그 색으로 쓴다).
         */
        this.fx.showDamage(sx, sy, amount, isBoss, true);
        /*
         * 타격음은 무기 계열이 정한다 — 유닛 id 가 먼저 잡히고 없으면 종류로
         * 떨어진다(성벽을 칠 때와 같은 표다).
         */
        const pan = Math.max(-.85, Math.min(.85, sx / Math.max(1, this.container.clientWidth) * 2 - 1));
        this.audio.play('tower:damaged', unitId, pan, getUnit(unitId).kind);
      },
      onTowerDestroyed: (towerId, level, lostGold) => {
        const name = getTower(towerId).displayName;
        this.audio.play('tower:destroyed');
        this.fx.flashVignette();
        // 배너까지 띄운다. 망루 한 기를 잃는 것은 웨이브가 바뀌는 것만큼 큰 사건이다.
        this.hud.showBanner(`${name} 파괴 — ${lostGold} 골드 손실`, true);
        this.hud.announce(`Lv${level} ${name}이(가) 무너졌습니다`);
        // 세워 둔 망루 수가 줄었으니 다시 지을 수 있다.
        this.hud.setTowers(this.world.towerCount, this.world.maxTowers);
      },
    });

    this.scene.applyPreset(BALANCE.presets[this.preset], this.handle.renderer);
    this.ambientVignette.hidden = !BALANCE.presets[this.preset].postFx;
    this.bindWorldEvents();

    this.hud.setGold(this.world.economy.gold, true);
    this.hud.setCastle(this.world.castle.hp, this.world.castle.maxHp);
    this.hud.setWave(0, this.world.waveRunner.totalWaves);
    this.hud.setTowers(this.world.towerCount, this.world.maxTowers);
    this.hud.setLevelTitle(this.level.title);
    // 지을 수 있는 자리 표시 — 레벨이 바뀔 때마다 씬이 새로 만들어지므로 다시 켠다.
    this.scene.showBuildableSpots(this.settings.buildSpots);
    this.hud.setBuildSpotsOn(this.settings.buildSpots);
    /*
     * 자리 표시가 사라졌으므로 "어디에 지으라"는 안내도 사라졌다.
     * 첫 웨이브 전에 한 줄로 대신한다 — 규칙은 하나뿐이라 한 줄이면 된다.
     */
    this.hud.announce(`빈 땅을 눌러 망루를 세우세요 (최대 ${this.world.maxTowers}기)`);
    this.hud.setRepairAvailable(!!this.level.allowRepair);
    this.hud.setCastleUpgradeAvailable(!!this.level.castleUpgrade);
    this.hud.setStratagems(this.world.stratagems);
    this.hud.setEarlyCallRate(this.level.earlyCallBonusPerSecond ?? BALANCE.earlyCallBonusPerSecond);
    // 배경음은 이 레벨이 끝날 때까지 반복 재생된다. 곡은 숨긴 유튜브 플레이어에서
    // 스트리밍되고, 자동재생이 막혀 있으면 첫 터치/클릭에서 알아서 시작한다.
    this.hud.setBgmOn(this.audio.isBgmEnabled());
    // 배속은 이미 깬 장에서만 열린다. 레벨이 바뀔 때마다 다시 판단해야 한다.
    this.syncFastForward();
    void this.audio.playBgm(this.level.environment.bgmYoutubeId);
  }

  /** 레벨 전환 — 씬을 통째로 새로 만든다 */
  private switchLevel(levelId: string): void {
    this.community?.close();
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

    /*
     * 성벽이 타는 동안 불소리를 **계속** 튼다.
     *
     * 한 방짜리 효과음으로는 안 된다 — 제갈량은 2초마다 불을 붙이는데 그때마다
     * 한 번 "훅" 하고 마니까, 정작 성이 깎이고 있는 사이에는 아무 소리도 안 난다.
     * 붙는 순간부터 꺼질 때까지 이어져야 "타고 있다"가 들린다.
     */
    bus.on('castle:ignited', () => void this.audio.startLoop('sfx_fire_burn'));
    bus.on('castle:burn-ended', () => this.audio.stopLoop('sfx_fire_burn'));
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

    bus.on('enemy:damaged', ({ enemyId, amount, hpRatio, worldPos, kind }) => {
      const p = this.scene.project(worldPos.x, worldPos.y, worldPos.z);
      if (amount > 0) this.fx.showDamage(p.x, p.y, amount, amount >= 20, kind === 'fire');
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

    bus.on('projectile:fired', ({ projectileId, towerSlotId, from }) => {
      // 발사음은 쏜 타워 종류로 고른다 — 활 망루는 활, 벽력거는 돌.
      const towerId = this.world.towers.get(towerSlotId)?.def.id;
      if (towerId === 'fire_tower' && this.world.projectiles.find(p => p.id === projectileId)?.salvoIndex !== 0) return;
      if (towerId) this.audio.play('projectile:fired', towerId, this.panOf(from.x));
    });

    /*
     * 성문 사격음. 시뮬은 일제사격 한 번에 이 이벤트를 한 번만 낸다 —
     * 대포 4발마다 굉음이 네 번 겹치면 그건 포성이 아니라 잡음이 된다.
     * SOUND_MAP에서 활·대포·화염을 각각 arrow.mp3·cannon.mp3·fire_burn.mp3로 연결한다.
     */
    bus.on('castle:fired', ({ kind }) => {
      const gate = this.world.castlePosition();
      this.audio.play('castle:fired', kind, this.panOf(gate.x));
    });

    // 망루 수는 짓거나 팔거나 무너질 때 바뀐다.
    bus.on('tower:built', () => this.hud.setTowers(this.world.towerCount, this.world.maxTowers));
    bus.on('tower:sold', () => this.hud.setTowers(this.world.towerCount, this.world.maxTowers));
    bus.on('tower:destroyed', ({ slotId }) => {
      // 고르고 있던 망루가 무너졌으면 패널을 닫는다 — 없는 것의 수리비를 물을 수는 없다.
      if (this.selectedSlot === slotId) this.clearSelection();
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
      this.audio.stopAllLoops();
      recordClear(this.level.id, stats.stars);
      // 방금 깼으니 이 장의 배속이 열린다 — 다시하기를 눌렀을 때 바로 쓸 수 있어야 한다.
      this.syncFastForward();
      this.saveRecord(stats, true);
      const next = nextLevelId(this.level.id);
      this.hud.showResult(true, stats, next ? getLevel(next).title : null);
    });

    bus.on('level:lost', ({ stats }) => {
      this.audio.play('level:lost');
      this.audio.stopBgm();
      this.audio.stopAllLoops();
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

  // ── 자리 선택 ──────────────────────────────────────────────────────

  /** 세워진 타워를 고른다 (업그레이드·판매·타게팅 패널) */
  private selectTower(slotId: string, sx = 0, sy = 0): void {
    this.pendingSpot = null;
    this.panelSignature = '';
    this.scene.hideBuildPreview();
    this.selectedSlot = slotId;
    this.scene.setSelected(slotId);
    if (sx || sy) this.panel.place(sx, sy);
    this.refreshPanel();
  }

  /**
   * 빈 땅을 고른다 = 그 자리에 지을지 묻는다.
   *
   * 못 짓는 자리면 패널을 열지 않고 **왜 안 되는지**만 말한다 — 길 위를 누르고
   * 건설 버튼이 회색으로 떠 있는 것보다, 누른 즉시 이유를 듣는 편이 빠르다.
   */
  private selectSpot(x: number, z: number, sx = 0, sy = 0): void {
    const check = this.world.canBuildAt(x, z);
    if (check !== 'ok') {
      this.clearSelection();
      this.hud.announce(placementReason(check));
      return;
    }
    this.selectedSlot = null;
    this.scene.setSelected(null);
    this.pendingSpot = { x, z };
    if (sx || sy) this.panel.place(sx, sy);
    this.refreshPanel();
  }

  private clearSelection(): void {
    this.selectedSlot = null;
    this.panelSignature = '';
    this.pendingSpot = null;
    this.scene.setSelected(null);
    this.scene.hideBuildPreview();
    this.panel.close();
  }

  private refreshPanel(): void {
    const slotId = this.selectedSlot;
    if (slotId) {
      const tower = this.world.towers.get(slotId);
      // 고른 망루가 그 사이에 무너졌으면 패널을 닫는다 — 없는 것을 고칠 수는 없다.
      if (!tower) {
        this.clearSelection();
        return;
      }
      this.panel.showTower(tower, this.world.economy.gold, this.repairState(slotId));
      this.scene.setSelected(slotId);
      this.scene.hideBuildPreview();
      return;
    }
    const spot = this.pendingSpot;
    if (!spot) return;
    this.panel.showBuild(spotKey(spot.x, spot.z), this.world.economy.gold);
    // 고른 타워의 사거리를 그 자리에 그려 준다. 골드가 모자라면 붉게.
    const def = this.panel.pickedTower;
    this.scene.showBuildPreview(spot.x, spot.z, def.id, this.world.economy.canAfford(def.buildCost));
  }

  /**
   * 수리 버튼이 지금 어떤 상태인가.
   *
   * 판정은 전부 시뮬(World.repairTowerStatus)이 한다. 여기서는 그 답을 버튼이
   * 읽을 모양으로 옮기기만 한다 — UI가 자기만의 조건을 다시 쓰면
   * "눌리는데 아무 일도 안 일어나는" 버튼이 생긴다.
   */
  private repairState(slotId: string): RepairState {
    const tower = this.world.towers.get(slotId);
    if (!tower) return { kind: 'hidden' };
    const status = this.world.repairTowerStatus(slotId);
    switch (status) {
      case 'ok': {
        const quote = this.world.repairTowerQuote(slotId)!;
        return { kind: 'ok', cost: quote.cost, hp: quote.hp };
      }
      case 'no_gold': {
        const cost = tower.repairCost;
        return { kind: 'no_gold', cost, short: cost - this.world.economy.gold };
      }
      case 'cooldown':
        return { kind: 'cooldown' };
      case 'full':
        return { kind: 'full' };
      default:
        return { kind: 'hidden' };
    }
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
    // 방명록에 글을 쓰는 중이라면 이 키들은 그 사람의 글자다.
    // 특히 스페이스 — 이 가드가 없으면 띄어쓰기가 일시정지가 된다.
    if (isTypingTarget(e.target)) return;
    // 1~9 는 **세운 순서대로** 타워를 고른다. 자리가 고정이 아니게 되면서
    // "슬롯 번호"가 사라졌으므로, 번호가 가리키는 것은 내가 세운 n번째 망루다.
    if (e.key >= '1' && e.key <= '9') {
      const tower = [...this.world.towers.values()][Number(e.key) - 1];
      if (tower) {
        const p = this.scene.project(tower.x, 40, tower.z);
        this.selectTower(tower.slotId, p.x, p.y);
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
        this.clearSelection();
        break;
    }
  };

  /**
   * 이 장에서 배속을 쓸 수 있는가 — 한 번이라도 깬 장에서만 열린다.
   *
   * URL이 레벨을 직접 지목한 개발 경로(?level=N)는 진행도를 보지 않으므로 늘 열어 둔다.
   * 그 경로에는 애초에 진행도가 남지 않는다.
   */
  private fastForwardAllowed(): boolean {
    return this.forcedLevelId !== null || isLevelCleared(this.level.id);
  }

  private changeSpeed(delta: number): void {
    const options = BALANCE.speedOptions;
    const i = options.indexOf(this.loop.getSpeed() as 1 | 2 | 3);
    const wanted = options[Math.max(0, Math.min(options.length - 1, i + delta))];
    const next = this.fastForwardAllowed() ? wanted : 1;
    this.loop.setSpeed(next);
    this.hud.setSpeed(next);
  }

  /**
   * 배속 버튼의 잠금을 지금 레벨에 맞춘다.
   * 잠긴 장에 배속인 채로 들어오지 않도록 속도도 1배로 되돌린다.
   */
  private syncFastForward(): void {
    const allowed = this.fastForwardAllowed();
    this.hud.setFastForwardAllowed(allowed);
    /*
     * 부팅 중에는 루프가 아직 없다 — start()가 buildWorld()를 setupLoop()보다 먼저 부른다.
     * 그때는 속도가 기본값(1배)이므로 되돌릴 것도 없다.
     */
    if (!allowed && this.loop && this.loop.getSpeed() !== 1) {
      this.loop.setSpeed(1);
      this.hud.setSpeed(1);
    }
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
    this.scene.render(alpha, this.loop.isPaused() ? 0 : dt * this.loop.getSpeed(), dt);
    this.fx.update(dt);
    this.hud.update(dt);

    // 적 체력바를 머리 위 화면 좌표로 따라가게 한다
    this.scene.forEachEnemyScreenPos((enemy, sx, sy) => {
      if (this.fx.hasHealth(enemy.id)) this.fx.positionHealth(enemy.id, sx, sy);
      else if (enemy.kind !== 'minion') this.fx.setHealth(enemy.id, enemy.hpRatio, true);
    });

    // 대기 중일 때만 조기 소집 버튼 활성
    this.hud.setCallEnabled(this.world.waveRunner.isWaiting && this.world.over === 'none');

    /*
     * 열어 둔 망루 패널을 살아 있게 유지한다.
     *
     * 공성이 붙으면 내구도가 초당 몇 번씩 깎이고 수리비를 낼 수 있는지도 그때마다
     * 달라진다. 그런데 tower:damaged 마다 다시 그리면 여덟 기가 때릴 때 패널 DOM 을
     * 초당 스무 번 갈아 끼우게 되어 버튼이 손가락 밑에서 사라진다.
     * 그래서 이벤트가 아니라 여기서 일정 간격으로만 다시 그린다.
     */
    if (this.selectedSlot && this.panel.isOpen) {
      this.panelRefreshTimer += dt;
      if (this.panelRefreshTimer >= PANEL_REFRESH_SEC) {
        this.panelRefreshTimer = 0;
        /*
         * 달라진 것이 없으면 그리지 않는다. 다시 그리는 순간 버튼이 새 노드로
         * 갈리므로, 마침 손가락이 올라가 있던 탭이 통째로 사라진다. 서명이
         * 같으면 화면도 같으니 그대로 두는 편이 언제나 낫다.
         */
        const tower = this.world.towers.get(this.selectedSlot);
        const sig = tower ? `${Math.ceil(tower.hp)}/${tower.maxHp}/${this.world.economy.gold}/${tower.repairCooldown > 0}` : '';
        if (sig !== this.panelSignature) {
          this.panelSignature = sig;
          this.refreshPanel();
        }
      }
    }

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
      this.handle.render(this.scene.stage.scene, this.scene.stage.camera, dt, BALANCE.presets[this.preset].postFx);
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
    // Background tabs, pause and resume stalls are not useful performance samples.
    if (document.hidden || this.loop.isPaused() || dt <= 0 || dt >= 0.25) return;
    this.qualityCooldown = Math.max(0, this.qualityCooldown - dt);
    if (this.autoTuned && this.qualityCooldown === 0 && this.world.liveEnemyCount > 0) {
      this.slowFrameTime = dt > 1 / 38 ? this.slowFrameTime + dt : Math.max(0, this.slowFrameTime - dt * 2);
      if (this.slowFrameTime >= 5 && this.preset !== 'low') {
        this.applyPreset(this.preset === 'high' ? 'medium' : 'low');
      }
    }
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
    this.slowFrameTime = 0;
    this.qualityCooldown = 15;
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
    this.audio.stopAllLoops();
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
    this.hud.setTowers(this.world.towerCount, this.world.maxTowers);
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
const stopViewportTracking = trackViewport();
if (import.meta.hot) import.meta.hot.dispose(stopViewportTracking);
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
