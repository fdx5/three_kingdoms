import { el, svg, onTap, setPressed, CountUp, formatSeconds, prefersReducedMotion } from './dom';
import { BALANCE, type PerformancePresetName } from '../data/balance';
import type { RunStats } from '../types/events';
import type { StratagemDef, StratagemStatus } from '../types/stratagems';

export interface HudCallbacks {
  onSpeed: (speed: number) => void;
  onPause: (paused: boolean) => void;
  onCallWave: () => void;
  onRepair: () => void;
  onCastleUpgrade: () => void;
  onStratagem: (id: string) => void;
  onRestart: () => void;
  onNextLevel: () => void;
  onLevelSelect: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onVolume: (bus: 'bgm' | 'sfx', value: number) => void;
  onPreset: (preset: PerformancePresetName) => void;
  onToggleShake: (on: boolean) => void;
  onToggleDamageNumbers: (on: boolean) => void;
  onResetView: () => void;
  /** 배경음 켜기/끄기 */
  onToggleBgm: (on: boolean) => void;
}

export interface HudSettings {
  bgmVolume: number;
  sfxVolume: number;
  preset: PerformancePresetName;
  shake: boolean;
  damageNumbers: boolean;
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 10;

/**
 * 상단 바 / 하단 조작 / 배너 / 보스 체력바 / 승패·설정 오버레이.
 * 전부 DOM이라 한글 렌더링과 접근성이 공짜다.
 */
export class Hud {
  readonly root: HTMLElement;

  private goldValue: HTMLElement;
  private goldChip: HTMLElement;
  private castleChip: HTMLElement;
  private castleValue: HTMLElement;
  private castleFill: HTMLElement;
  private castleLag: HTMLElement;
  private waveValue: HTMLElement;
  private ringBar: SVGElement;
  private speedButtons: HTMLElement[] = [];
  private pauseButton: HTMLElement;
  private bgmButton: HTMLElement;
  private callButton: HTMLElement;
  private callBonus: HTMLElement;
  private repairButton: HTMLElement;
  private repairCost: HTMLElement;
  private gateButton: HTMLElement;
  private gateLabel: HTMLElement;
  private gateNote: HTMLElement;
  private gateAvailable = false;
  private gateEnabled: boolean | null = null;
  private gateLastText = '';
  private levelTitle: HTMLElement;
  private earlyCallRate: number = BALANCE.earlyCallBonusPerSecond;
  private repairAvailable = false;
  private repairEnabled: boolean | null = null;
  private stratagemBar: HTMLElement;
  /** 계략 id -> 버튼과 마지막으로 그린 상태 (매 프레임 DOM을 건드리지 않으려고) */
  private stratagemCards = new Map<
    string,
    { button: HTMLButtonElement; note: HTMLElement; lastLabel: string; lastEnabled: boolean | null }
  >();
  private banner: HTMLElement;
  private bossBar: HTMLElement;
  private bossFill: HTMLElement;
  private bossName: HTMLElement;
  private live: HTMLElement;

  private overlay: HTMLElement | null = null;
  private goldCounter: CountUp;
  private bannerTimer = 0;
  private callEnabled: boolean | null = null;
  private reduced = prefersReducedMotion();

  constructor(
    parent: HTMLElement,
    private readonly cb: HudCallbacks,
    private settings: HudSettings,
  ) {
    this.root = parent;
    this.goldCounter = new CountUp(0, BALANCE.fx.goldCountUpDuration);

    // ── 상단 바 ──
    this.goldValue = el('span', { class: 'chip__value', text: '0' });
    this.goldChip = el('div', { class: 'chip', id: 'gold-chip' }, [
      el('span', { class: 'chip__icon', text: '🪙' }),
      el('span', { class: 'chip__label', text: '골드' }),
      this.goldValue,
    ]);

    this.castleFill = el('div', { class: 'castle-bar__fill' });
    this.castleLag = el('div', { class: 'castle-bar__lag' });
    this.castleValue = el('span', { class: 'chip__value', text: '1000' });
    this.castleChip = el('div', { class: 'chip', id: 'castle-chip' }, [
      el('span', { class: 'chip__icon', text: '🏯' }),
      el('div', { class: 'castle-bar' }, [this.castleLag, this.castleFill]),
      this.castleValue,
    ]);

    this.ringBar = svg('circle', {
      class: 'bar',
      cx: 13,
      cy: 13,
      r: 10,
      'stroke-dasharray': RING_CIRCUMFERENCE,
      'stroke-dashoffset': 0,
    });
    const ring = svg('svg', { class: 'countdown-ring', viewBox: '0 0 26 26', 'aria-hidden': 'true' }, [
      svg('circle', { class: 'track', cx: 13, cy: 13, r: 10 }),
      this.ringBar,
    ]);
    this.waveValue = el('span', { class: 'chip__value', text: '0/20' });
    const waveChip = el('div', { class: 'chip', id: 'wave-chip' }, [
      el('span', { class: 'chip__label', text: '웨이브' }),
      this.waveValue,
      ring as unknown as Node,
    ]);

    this.levelTitle = el('div', { class: 'leveltitle', text: '' });

    const topbar = el('div', { class: 'topbar' }, [
      this.goldChip,
      this.castleChip,
      waveChip,
      el('div', { class: 'topbar__spacer' }),
    ]);

    // ── 하단 조작 (엄지 도달 범위) ──
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': '게임 속도' });
    for (const s of BALANCE.speedOptions) {
      const b = el('button', { type: 'button', text: `${s}x`, 'aria-label': `속도 ${s}배` });
      setPressed(b, s === 1);
      onTap(b, () => this.cb.onSpeed(s));
      this.speedButtons.push(b);
      seg.append(b);
    }

    this.pauseButton = el('button', { type: 'button', class: 'btn-ghost', text: '⏸', 'aria-label': '일시정지' });
    onTap(this.pauseButton, () => this.cb.onPause(this.pauseButton.textContent === '⏸'));

    const settingsButton = el('button', { type: 'button', class: 'btn-ghost', text: '⚙', 'aria-label': '설정' });
    onTap(settingsButton, () => this.cb.onOpenSettings());
    const resetViewButton = el('button', { type: 'button', class: 'btn-ghost', text: '⌂', 'aria-label': '시점 초기화', title: '시점 초기화 (R)' });
    onTap(resetViewButton, () => this.cb.onResetView());

    // 배경음 on/off — 플레이어는 보이지 않고 이 버튼 하나로만 조작한다.
    this.bgmButton = el('button', { type: 'button', class: 'btn-ghost', text: '♪', 'aria-label': '배경음' });
    onTap(this.bgmButton, () => this.cb.onToggleBgm(this.bgmButton.textContent !== '♪'));

    this.callBonus = el('span', { class: 'call-wave__bonus', text: '' });
    this.callButton = el('button', { type: 'button', id: 'call-wave', class: 'btn-primary call-wave' }, [
      el('span', { text: '지금 소집' }),
      this.callBonus,
    ]);
    onTap(this.callButton, () => this.cb.onCallWave());

    // 성벽 수리 — 레벨 2부터의 골드 소비처
    this.repairCost = el('span', { class: 'call-wave__bonus', text: '' });
    this.repairButton = el('button', { type: 'button', id: 'repair-wall', class: 'btn-ghost call-wave' }, [
      el('span', { text: '🧱 성벽 수리' }),
      this.repairCost,
    ]);
    onTap(this.repairButton, () => this.cb.onRepair());
    this.repairButton.style.display = 'none';

    /*
     * 성문 강화 — 4장부터의 소비처.
     *
     * 수리 버튼과 나란히 두되 글이 두 줄이다: 위는 "무엇이 되는가"(다음 단계 이름),
     * 아래는 "얼마인가". 성문은 팔 수 없는 지출이라, 누르기 전에 무엇을 사는지
     * 이름으로 알 수 있어야 한다.
     */
    this.gateLabel = el('span', { text: '🏯 성문 강화' });
    this.gateNote = el('span', { class: 'call-wave__bonus', text: '' });
    this.gateButton = el('button', { type: 'button', id: 'upgrade-gate', class: 'btn-ghost call-wave' }, [
      this.gateLabel,
      this.gateNote,
    ]);
    onTap(this.gateButton, () => this.cb.onCastleUpgrade());
    this.gateButton.style.display = 'none';

    // 계략 바 — 레벨이 계략을 열어줄 때만 채워진다
    this.stratagemBar = el('div', { class: 'stratagems', role: 'group', 'aria-label': '계략' });
    this.stratagemBar.style.display = 'none';

    const bottombar = el('div', { class: 'bottombar' }, [
      el('div', { class: 'bottombar__left' }, [seg, this.pauseButton, resetViewButton, this.bgmButton, settingsButton]),
      el('div', { class: 'bottombar__center' }, [this.stratagemBar]),
      el('div', { class: 'bottombar__right' }, [this.gateButton, this.repairButton, this.callButton]),
    ]);

    // ── 배너 / 보스바 / aria-live ──
    this.banner = el('div', { class: 'banner', 'aria-hidden': 'true' });
    this.bossFill = el('div', { class: 'bossbar__fill' });
    this.bossName = el('div', { class: 'bossbar__name', text: '' });
    this.bossBar = el('div', { class: 'bossbar' }, [
      this.bossName,
      el('div', { class: 'bossbar__track' }, [this.bossFill]),
    ]);
    this.bossBar.style.display = 'none';

    this.live = el('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });

    // 세로 모드 안내
    const rotate = el('div', { class: 'overlay', id: 'rotate-notice' }, [
      el('div', { class: 'overlay__card', style: 'text-align:center' }, [
        el('div', { class: 'rotate-icon', text: '📱' }),
        el('h2', { class: 'overlay__title', text: '가로로 돌려주세요' }),
        el('p', { class: 'overlay__sub', text: '전장을 한눈에 보려면 가로 화면이 필요합니다.' }),
      ]),
    ]);

    parent.append(topbar, this.levelTitle, bottombar, this.banner, this.bossBar, rotate, this.live);
  }

  // ── 골드 ────────────────────────────────────────────────────────────

  /** 코인이 도착하는 순간 호출한다 — 그때부터 숫자가 오른다. */
  setGold(value: number, instant = false): void {
    this.goldCounter.set(value, instant || this.reduced);
    if (!instant) {
      this.goldChip.classList.add('pop');
      setTimeout(() => this.goldChip.classList.remove('pop'), 130);
    }
  }

  /** 상단 골드 표시의 화면 좌표 — 코인 비행의 목적지 */
  goldScreenPos(): { x: number; y: number } {
    const r = this.goldChip.getBoundingClientRect();
    const p = this.root.getBoundingClientRect();
    return { x: r.left - p.left + r.width / 2, y: r.top - p.top + r.height / 2 };
  }

  // ── 성 체력 ────────────────────────────────────────────────────────

  setCastle(hp: number, maxHp: number): void {
    const ratio = Math.max(0, hp / maxHp);
    this.castleValue.textContent = String(Math.max(0, Math.round(hp)));
    this.castleFill.style.transform = `scaleX(${ratio})`;
    // 지연 게이지는 CSS transition이 알아서 0.5초 뒤따라온다
    this.castleLag.style.transform = `scaleX(${ratio})`;
    this.castleChip.classList.toggle('warn', ratio <= 0.3);
    if (ratio <= 0.3) this.announce(`성 체력 위험: ${Math.round(hp)}`);
  }

  // ── 웨이브 ─────────────────────────────────────────────────────────

  setWave(index: number, total: number): void {
    this.waveValue.textContent = `${index}/${total}`;
  }

  setLevelTitle(title: string): void {
    this.levelTitle.textContent = title;
  }

  // ── 계략 ────────────────────────────────────────────────────────────

  /**
   * 이 레벨의 계략 카드를 만든다. 목록이 비면 바 자체가 사라진다.
   * 레벨이 바뀔 때마다 다시 호출되므로 이전 카드는 버린다.
   */
  setStratagems(defs: StratagemDef[]): void {
    this.stratagemCards.clear();
    this.stratagemBar.replaceChildren();
    this.stratagemBar.style.display = defs.length > 0 ? '' : 'none';
    if (defs.length === 0) return;

    for (const def of defs) {
      const note = el('span', { class: 'stratcard__note', text: `${def.cost}G` });
      const button = el('button', {
        type: 'button',
        class: 'stratcard',
        'aria-label': `${def.displayName} — ${def.description} (${def.cost} 골드)`,
        title: `${def.displayName} · ${def.description}`,
      }, [
        el('span', { class: 'stratcard__glyph', text: def.glyph }),
        el('span', { class: 'stratcard__name', text: def.displayName }),
        note,
      ]) as HTMLButtonElement;
      onTap(button, () => this.cb.onStratagem(def.id));
      this.stratagemBar.append(button);
      this.stratagemCards.set(def.id, { button, note, lastLabel: '', lastEnabled: null });
    }
  }

  /**
   * 계략 버튼 상태. 매 프레임 호출되므로 값이 바뀔 때만 DOM을 건드린다.
   * 못 쓰는 이유를 버튼에 적는다 — "왜 안 눌리지"를 남기지 않는다.
   */
  setStratagem(id: string, status: StratagemStatus, cost: number, cooldown: number, active = 0): void {
    const card = this.stratagemCards.get(id);
    if (!card) return;
    const enabled = status === 'ok';
    if (card.lastEnabled !== enabled) {
      card.lastEnabled = enabled;
      card.button.disabled = !enabled;
      card.button.classList.toggle('stratcard--ready', enabled);
    }
    let label: string;
    switch (status) {
      case 'cooldown':
        label = active > 0 ? `발동 중 ${Math.ceil(active)}초` : `${Math.ceil(cooldown)}초`;
        break;
      case 'no_gold':
        label = '골드 부족';
        break;
      case 'no_target':
        label = '대상 없음';
        break;
      case 'disabled':
        label = '-';
        break;
      default:
        label = `${cost}G`;
    }
    if (card.lastLabel !== label) {
      card.lastLabel = label;
      card.note.textContent = label;
    }
  }

  /** 발동 순간의 짧은 반응 — 눌린 것이 눌렸다고 보이게 */
  flashStratagem(id: string): void {
    const card = this.stratagemCards.get(id);
    if (!card) return;
    card.button.classList.add('stratcard--cast');
    setTimeout(() => card.button.classList.remove('stratcard--cast'), 420);
  }

  /** 이 레벨에서 성벽 수리를 쓸 수 있는가 */
  setRepairAvailable(available: boolean): void {
    this.repairAvailable = available;
    this.repairButton.style.display = available ? '' : 'none';
    this.repairEnabled = null;
  }

  /**
   * 수리 버튼 상태. 매 프레임 호출되므로 값이 바뀔 때만 DOM을 건드린다.
   * quote가 null이면 지금은 못 고친다(스폰 중이거나 쿨다운이거나 성이 멀쩡하다).
   */
  setRepair(
    status: 'ok' | 'disabled' | 'full' | 'spawning' | 'cooldown' | 'no_gold',
    quote: { hp: number; cost: number } | null,
    cooldown: number,
  ): void {
    if (!this.repairAvailable) return;
    const enabled = status === 'ok';
    if (this.repairEnabled !== enabled) {
      this.repairEnabled = enabled;
      (this.repairButton as HTMLButtonElement).disabled = !enabled;
      this.repairButton.style.opacity = enabled ? '1' : '0.45';
    }
    let label: string;
    switch (status) {
      case 'ok':
        label = `+${quote!.hp}HP / ${quote!.cost}G`;
        break;
      case 'full':
        label = '성벽 온전';
        break;
      case 'spawning':
        label = '웨이브 중';
        break;
      case 'cooldown':
        label = `${Math.ceil(cooldown)}초 후`;
        break;
      case 'no_gold':
        label = '골드 부족';
        break;
      default:
        label = '';
    }
    if (this.repairCost.textContent !== label) this.repairCost.textContent = label;
  }

  // ── 성문 강화 ───────────────────────────────────────────────────────

  /** 이 레벨에서 성문을 강화할 수 있는가 */
  setCastleUpgradeAvailable(available: boolean): void {
    this.gateAvailable = available;
    this.gateButton.style.display = available ? '' : 'none';
    this.gateEnabled = null;
    this.gateLastText = '';
  }

  /**
   * 성문 버튼 상태. 매 프레임 호출되므로 값이 바뀔 때만 DOM을 건드린다.
   * quote가 null이면 만렙이다 — 그때는 "화룡구"라고 적어 끝까지 올렸음을 남긴다.
   */
  setCastleUpgrade(
    status: 'ok' | 'disabled' | 'max_level' | 'no_gold',
    level: number,
    quote: { level: number; title: string; description: string; cost: number } | null,
  ): void {
    if (!this.gateAvailable) return;
    const enabled = status === 'ok';
    if (this.gateEnabled !== enabled) {
      this.gateEnabled = enabled;
      (this.gateButton as HTMLButtonElement).disabled = !enabled;
      this.gateButton.style.opacity = enabled ? '1' : '0.45';
    }
    const label = quote ? `🏯 성문 Lv${level} → ${quote.title}` : `🏯 성문 Lv${level} 최종`;
    const note =
      status === 'max_level' ? '완성' : status === 'no_gold' ? `골드 부족 (${quote?.cost ?? 0}G)` : `${quote?.cost ?? 0}G`;
    const text = `${label}|${note}`;
    if (this.gateLastText === text) return;
    this.gateLastText = text;
    this.gateLabel.textContent = label;
    this.gateNote.textContent = note;
    this.gateButton.setAttribute(
      'title',
      quote ? `${quote.title} — ${quote.description} (${quote.cost} 골드)` : '성문을 끝까지 강화했습니다',
    );
  }

  /**
   * 조기 소집 보너스 계수. 레벨마다 다르다 —
   * 레벨 3은 이게 주 수입원이라 버튼에 뜨는 액수가 그 레벨의 값이어야 한다.
   */
  setEarlyCallRate(rate: number): void {
    this.earlyCallRate = rate;
  }

  setCountdown(remaining: number, total: number): void {
    const k = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
    this.ringBar.setAttribute('stroke-dashoffset', String(RING_CIRCUMFERENCE * (1 - k)));
    const bonus = Math.floor(remaining * this.earlyCallRate);
    this.callBonus.textContent = bonus > 0 ? `+${bonus} G` : '';
  }

  /** 매 프레임 호출되므로 값이 바뀔 때만 DOM을 건드린다. */
  setCallEnabled(enabled: boolean): void {
    if (this.callEnabled === enabled) return;
    this.callEnabled = enabled;
    (this.callButton as HTMLButtonElement).disabled = !enabled;
    this.callButton.style.opacity = enabled ? '1' : '0.4';
  }

  showBanner(text: string, isBoss: boolean): void {
    this.banner.textContent = text;
    this.banner.className = `banner show${isBoss ? ' banner--boss' : ''}`;
    this.bannerTimer = BALANCE.fx.bannerDuration;
    this.announce(text);
  }

  // ── 보스 체력바 ────────────────────────────────────────────────────

  showBoss(name: string, ratio: number): void {
    this.bossName.textContent = name;
    this.bossFill.style.transform = `scaleX(${Math.max(0, ratio)})`;
    this.bossBar.style.display = 'block';
  }

  hideBoss(): void {
    this.bossBar.style.display = 'none';
  }

  // ── 속도 / 일시정지 ────────────────────────────────────────────────

  setSpeed(speed: number): void {
    BALANCE.speedOptions.forEach((s, i) => setPressed(this.speedButtons[i], s === speed));
  }

  /** 배경음 버튼 표시 갱신 (설정을 불러왔거나 다른 곳에서 껐을 때) */
  setBgmOn(on: boolean): void {
    this.bgmButton.textContent = on ? '♪' : '🔇';
    this.bgmButton.setAttribute('aria-label', on ? '배경음 끄기' : '배경음 켜기');
    this.bgmButton.setAttribute('title', on ? '배경음 끄기' : '배경음 켜기');
    setPressed(this.bgmButton, on);
  }

  setPaused(paused: boolean): void {
    this.pauseButton.textContent = paused ? '▶' : '⏸';
    this.pauseButton.setAttribute('aria-label', paused ? '재개' : '일시정지');
  }

  announce(text: string): void {
    this.live.textContent = text;
  }

  update(dt: number): void {
    const g = this.goldCounter.update(dt);
    this.goldValue.textContent = String(Math.round(g));
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
  }

  // ── 오버레이 ───────────────────────────────────────────────────────

  private openOverlay(card: HTMLElement): void {
    this.closeOverlay();
    this.overlay = el('div', { class: 'overlay' }, [card]);
    this.root.append(this.overlay);
  }

  closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  get hasOverlay(): boolean {
    return this.overlay !== null;
  }

  showResult(won: boolean, stats: RunStats, nextLevelTitle: string | null): void {
    const starRow = el(
      'div',
      { class: 'stars', 'aria-label': `${stats.stars}개의 별` },
      [0, 1, 2].map((i) => el('span', { class: i < stats.stars ? '' : 'stars__off', text: '★' })),
    );

    const dl = el('dl', { class: 'statlist' }, [
      el('dt', { text: '처치' }),
      el('dd', { text: String(stats.kills) }),
      el('dt', { text: '누수' }),
      el('dd', { text: String(stats.leaks) }),
      el('dt', { text: '최종 성 체력' }),
      el('dd', { text: `${stats.castleHp} / ${stats.castleMaxHp}` }),
      el('dt', { text: '성문 단계' }),
      el('dd', { text: `Lv${stats.castleLevel}` }),
      el('dt', { text: '남은 골드' }),
      el('dd', { text: String(stats.goldLeft) }),
      el('dt', { text: '소요 시간' }),
      el('dd', { text: formatSeconds(stats.elapsed) }),
    ]);

    const retry = el('button', { type: 'button', class: won ? 'btn-ghost' : 'btn-primary', text: '다시하기' });
    onTap(retry, () => this.cb.onRestart());

    // 이겼고 다음 장이 있으면 그리로 넘어갈 수 있다
    const nextBtn = el('button', {
      type: 'button',
      class: 'btn-primary',
      text: nextLevelTitle ? '다음 장' : '다음 장 (준비 중)',
      disabled: !won || !nextLevelTitle,
    });
    if (won && nextLevelTitle) onTap(nextBtn, () => this.cb.onNextLevel());

    const selectBtn = el('button', { type: 'button', class: 'btn-ghost', text: '장 선택' });
    onTap(selectBtn, () => this.cb.onLevelSelect());

    const actions = el('div', { class: 'overlay__actions' }, [retry, nextBtn, selectBtn]);

    const children: Node[] = [
      el('h2', { class: 'overlay__title', text: won ? '승리' : '패배' }),
      el('p', {
        class: 'overlay__sub',
        text: won ? '호뢰관을 지켜냈습니다.' : `제 ${stats.wavesCleared + 1}파에서 관문이 무너졌습니다.`,
      }),
    ];
    if (won) children.push(starRow);
    children.push(dl);
    if (won && nextLevelTitle) {
      children.push(el('p', { class: 'hint', text: `다음 장: ${nextLevelTitle}` }));
    }
    if (!won) {
      children.push(
        el('p', {
          class: 'hint',
          text: '💡 망루를 업그레이드하면 화살이 여러 발 나갑니다. 화살은 서로 다른 적을 노리므로 업그레이드 한 번이 처치 속도를 크게 올립니다.',
        }),
      );
    }
    children.push(actions);

    this.openOverlay(el('div', { class: 'overlay__card' }, children));
    this.announce(won ? '승리했습니다' : '패배했습니다');
  }

  showPause(): void {
    const resume = el('button', { type: 'button', class: 'btn-primary', text: '계속하기' });
    onTap(resume, () => this.cb.onPause(false));
    const restart = el('button', { type: 'button', class: 'btn-ghost', text: '처음부터' });
    onTap(restart, () => this.cb.onRestart());
    this.openOverlay(
      el('div', { class: 'overlay__card' }, [
        el('h2', { class: 'overlay__title', text: '일시정지' }),
        el('p', { class: 'overlay__sub', text: 'Space로도 재개할 수 있습니다.' }),
        el('div', { class: 'overlay__actions' }, [resume, restart]),
      ]),
    );
  }

  showSettings(): void {
    const mkRange = (label: string, value: number, onInput: (v: number) => void) => {
      const input = el('input', {
        type: 'range',
        min: 0,
        max: 100,
        value: Math.round(value * 100),
        'aria-label': label,
      }) as HTMLInputElement;
      input.addEventListener('input', () => onInput(Number(input.value) / 100));
      return el('div', { class: 'setting-row' }, [el('label', { text: label }), input]);
    };

    const presetSeg = el('div', { class: 'seg', role: 'group', 'aria-label': '그래픽 프리셋' });
    const presetLabels: Record<PerformancePresetName, string> = { high: '높음', medium: '보통', low: '낮음' };
    for (const name of Object.keys(presetLabels) as PerformancePresetName[]) {
      const b = el('button', { type: 'button', text: presetLabels[name] });
      setPressed(b, this.settings.preset === name);
      onTap(b, () => {
        this.settings.preset = name;
        this.cb.onPreset(name);
        for (const child of Array.from(presetSeg.children)) {
          setPressed(child as HTMLElement, child === b);
        }
      });
      presetSeg.append(b);
    }

    const mkToggle = (label: string, value: boolean, onChange: (v: boolean) => void) => {
      const b = el('button', { type: 'button', text: value ? '켜짐' : '꺼짐' });
      setPressed(b, value);
      onTap(b, () => {
        value = !value;
        b.textContent = value ? '켜짐' : '꺼짐';
        setPressed(b, value);
        onChange(value);
      });
      return el('div', { class: 'setting-row' }, [el('label', { text: label }), b]);
    };

    const close = el('button', { type: 'button', class: 'btn-primary', text: '닫기' });
    onTap(close, () => this.cb.onCloseSettings());

    this.openOverlay(
      el('div', { class: 'overlay__card' }, [
        el('h2', { class: 'overlay__title', text: '설정' }),
        mkRange('배경음 볼륨', this.settings.bgmVolume, (v) => {
          this.settings.bgmVolume = v;
          this.cb.onVolume('bgm', v);
        }),
        mkRange('효과음 볼륨', this.settings.sfxVolume, (v) => {
          this.settings.sfxVolume = v;
          this.cb.onVolume('sfx', v);
        }),
        el('div', { class: 'setting-row' }, [el('label', { text: '그래픽' }), presetSeg]),
        mkToggle('화면 흔들림', this.settings.shake, (v) => {
          this.settings.shake = v;
          this.cb.onToggleShake(v);
        }),
        mkToggle('피해 숫자 표시', this.settings.damageNumbers, (v) => {
          this.settings.damageNumbers = v;
          this.cb.onToggleDamageNumbers(v);
        }),
        el('div', { class: 'overlay__actions' }, [close]),
      ]),
    );
  }

  reset(): void {
    this.closeOverlay();
    this.hideBoss();
    this.banner.classList.remove('show');
    this.bannerTimer = 0;
    this.goldCounter.set(0, true);
  }

  dispose(): void {
    this.closeOverlay();
    this.root.replaceChildren();
  }
}
