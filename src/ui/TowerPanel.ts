import type { TowerDef, TargetingMode } from '../types/towers';
import type { Tower } from '../sim/Tower';
import { el, onTap, setPressed } from './dom';
import { towerDps } from '../data/towers';

export interface TowerPanelCallbacks {
  onBuild: (slotId: string, towerId: string) => void;
  onUpgrade: (slotId: string) => void;
  onSell: (slotId: string) => void;
  onTargeting: (slotId: string, mode: TargetingMode) => void;
  onClose: () => void;
}

const TARGETING_LABELS: Record<TargetingMode, string> = {
  first: '선두',
  last: '후미',
  strongest: '강적',
  closest: '근접',
};

/**
 * 건설 / 업그레이드 패널.
 * 데스크톱은 슬롯 옆 팝오버, 모바일은 하단 시트 (CSS가 전환한다).
 * hover로만 정보를 주는 UI는 없다 — 모든 정보는 탭 한 번으로 도달한다.
 */
export class TowerPanel {
  readonly root: HTMLElement;
  private slotId: string | null = null;
  private sellConfirming = false;
  private disposers: (() => void)[] = [];

  /** 이 레벨에서 지을 수 있는 타워들. 둘 이상이면 건설 패널에 선택 행이 뜬다. */
  private buildable: TowerDef[];
  /** 건설 패널에서 지금 고른 타워 */
  private picked: TowerDef;
  /** place()가 요청한 화면 좌표. 화면 밖 보정은 이 값 기준으로 다시 계산한다. */
  private anchor: { x: number; y: number } | null = null;

  constructor(
    parent: HTMLElement,
    buildable: TowerDef[],
    private readonly cb: TowerPanelCallbacks,
  ) {
    this.buildable = buildable;
    this.picked = buildable[0];
    this.root = el('div', { class: 'panel panel--popover', role: 'dialog', 'aria-label': '타워 패널' });
    this.root.style.display = 'none';
    parent.append(this.root);
  }

  /** 레벨이 바뀌면 지을 수 있는 타워 목록도 바뀐다 */
  setBuildable(buildable: TowerDef[]): void {
    this.buildable = buildable;
    this.picked = buildable[0];
  }

  get isOpen(): boolean {
    return this.slotId !== null;
  }
  get openSlotId(): string | null {
    return this.slotId;
  }

  /** 화면 좌표에 패널을 놓는다 (데스크톱 팝오버). 모바일은 CSS가 하단 시트로 덮어쓴다. */
  place(screenX: number, screenY: number): void {
    this.anchor = { x: screenX, y: Math.max(120, screenY - 16) };
    this.root.style.left = `${this.anchor.x}px`;
    this.root.style.top = `${this.anchor.y}px`;
  }

  /**
   * 내용이 들어간 뒤 실제 크기를 재서 화면 안으로 밀어 넣는다.
   *
   * 슬롯이 화면 가장자리에 있으면 translate(-50%,-100%) 때문에 패널의 절반이
   * 화면 밖으로 나간다 — 레벨 2의 북쪽 슬롯(s2_a)에서 건설 버튼이 아예 눌리지
   * 않는 것으로 드러났다. 모바일에서는 CSS가 left/top을 !important로 덮으므로
   * 여기서 계산한 보정값은 아무 일도 하지 않는다(rect가 이미 화면 안이라 delta=0).
   */
  private clampIntoView(): void {
    if (!this.anchor) return;
    const m = 8;
    const r = this.root.getBoundingClientRect();
    if (r.width === 0) return;

    let dx = 0;
    let dy = 0;
    if (r.left < m) dx = m - r.left;
    else if (r.right > window.innerWidth - m) dx = window.innerWidth - m - r.right;
    if (r.top < m) dy = m - r.top;
    else if (r.bottom > window.innerHeight - m) dy = window.innerHeight - m - r.bottom;

    if (dx === 0 && dy === 0) return;
    this.root.style.left = `${this.anchor.x + dx}px`;
    this.root.style.top = `${this.anchor.y + dy}px`;
  }

  close(): void {
    this.slotId = null;
    this.sellConfirming = false;
    this.root.style.display = 'none';
    this.clearHandlers();
  }

  private clearHandlers(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }

  /** 미건설 슬롯 — 건설 패널 */
  showBuild(slotId: string, gold: number): void {
    this.slotId = slotId;
    this.sellConfirming = false;
    this.clearHandlers();

    const def = this.picked;
    const lv = def.levels[0];
    const affordable = gold >= def.buildCost;
    const short = def.buildCost - gold;
    const isAura = def.kind === 'aura';

    const children: Node[] = [];

    // 타워 종류가 둘 이상이면 먼저 고르게 한다 (레벨 2부터)
    if (this.buildable.length > 1) {
      children.push(
        el(
          'div',
          { class: 'towerpick', role: 'group', 'aria-label': '타워 종류' },
          this.buildable.map((t) => {
            const b = el('button', { type: 'button' }, [
              el('span', { class: 'towerpick__name', text: t.displayName }),
              el('span', { class: 'towerpick__cost', text: `${t.buildCost}G` }),
            ]);
            setPressed(b, t.id === def.id);
            this.disposers.push(
              onTap(b, () => {
                this.picked = t;
                this.showBuild(slotId, gold);
              }),
            );
            return b;
          }),
        ),
      );
    }

    children.push(
      el('div', { class: 'panel__title' }, [
        el('span', { text: def.displayName }),
        el('span', { class: 'panel__level', text: `${def.buildCost} G` }),
      ]),
      el('p', { class: 'panel__desc', text: def.description }),
    );

    // aura 타워는 화살 개념이 없다 — 대신 감속 수치를 보여준다
    if (isAura) {
      const slow = def.effect?.type === 'slow' ? def.effect.params : null;
      children.push(
        el('div', { class: 'statgrid' }, [
          el('span', { class: 'statgrid__label', text: '감속' }),
          el('span', { class: 'statgrid__now', text: slow ? `${Math.round((1 - slow.speedMul) * 100)}%` : '-' }),
          el('span', { class: 'statgrid__label', text: '지속' }),
          el('span', { class: 'statgrid__now', text: slow ? `${slow.duration.toFixed(1)}s` : '-' }),
          el('span', { class: 'statgrid__label', text: '동시 대상' }),
          el('span', { class: 'statgrid__now', text: `${lv.arrows}` }),
          el('span', { class: 'statgrid__label', text: '사거리' }),
          el('span', { class: 'statgrid__now', text: String(lv.range) }),
        ]),
      );
    } else {
      children.push(
        this.bowRow(lv.arrows, lv.arrows, def),
        el('div', { class: 'statgrid' }, [
          el('span', { class: 'statgrid__label', text: def.damageKind === 'siege' ? '투석' : '화살' }),
          el('span', { class: 'statgrid__now', text: `${lv.arrows}발` }),
          el('span', { class: 'statgrid__label', text: '피해' }),
          el('span', { class: 'statgrid__now', text: String(lv.damagePerArrow) }),
          el('span', { class: 'statgrid__label', text: '간격' }),
          el('span', { class: 'statgrid__now', text: `${lv.fireInterval.toFixed(2)}s` }),
          el('span', { class: 'statgrid__label', text: '사거리' }),
          el('span', { class: 'statgrid__now', text: String(lv.range) }),
        ]),
      );
    }

    children.push(
      el('div', { class: 'panel__actions' }, [
        this.button('건설', 'btn-primary', !affordable, () => this.cb.onBuild(slotId, def.id)),
        this.button('취소', 'btn-ghost', false, () => this.cb.onClose()),
      ]),
      affordable
        ? el('p', { class: 'panel__note', text: '경로가 꺾이는 안쪽에 지으면 더 넓게 덮습니다.' })
        : el('p', { class: 'panel__note panel__note--warn', text: `⚠ 골드 ${short} 부족` }),
    );

    this.root.replaceChildren(...children);
    this.root.style.display = 'block';
    this.clampIntoView();
  }

  /** 건설된 타워 — 업그레이드/판매 패널 */
  showTower(tower: Tower, gold: number): void {
    const slotId = tower.slotId;
    this.slotId = slotId;
    this.clearHandlers();

    // 타워마다 정의가 다르다 — 슬롯에 실제로 서 있는 타워의 def를 쓴다
    const def = tower.def;
    const isAura = def.kind === 'aura';
    const cur = tower.levelDef;
    const nextIndex = tower.level; // 0-base로 다음 레벨
    const next = tower.isMaxLevel ? null : def.levels[nextIndex];
    const cost = tower.nextUpgradeCost;
    const affordable = cost !== null && gold >= cost;
    const short = cost !== null ? cost - gold : 0;

    const rows: Node[] = [];
    const addRow = (label: string, now: string, nextVal: string | null) => {
      rows.push(el('span', { class: 'statgrid__label', text: label }));
      rows.push(el('span', { class: 'statgrid__now', text: now }));
      rows.push(el('span', { class: 'statgrid__arrow', text: nextVal ? '→' : '' }));
      rows.push(el('span', { class: 'statgrid__next', text: nextVal ?? '' }));
    };

    if (isAura) {
      const slow = def.effect?.type === 'slow' ? def.effect.params : null;
      addRow('감속', slow ? `${Math.round((1 - slow.speedMul) * 100)}%` : '-', null);
      addRow('지속', slow ? `${slow.duration.toFixed(1)}s` : '-', null);
      addRow('동시 대상', `${cur.arrows}`, next ? `${next.arrows}` : null);
      addRow('사거리', String(cur.range), next ? String(next.range) : null);
    } else {
      const shotLabel = def.damageKind === 'siege' ? '투석' : '화살';
      addRow(shotLabel, `${cur.arrows}발`, next ? `${next.arrows}발` : null);
      addRow('피해', String(cur.damagePerArrow), next ? String(next.damagePerArrow) : null);
      addRow('간격', `${cur.fireInterval.toFixed(2)}s`, next ? `${next.fireInterval.toFixed(2)}s` : null);
      addRow(
        'DPS',
        String(Math.round(towerDps(def, tower.level - 1))),
        next ? String(Math.round(towerDps(def, nextIndex))) : null,
      );
    }

    // 감속 타워는 피해를 주지 않으므로 타게팅 선택이 의미가 없다
    const targetingRow = isAura
      ? null
      : el(
          'div',
          { class: 'targeting', role: 'group', 'aria-label': '타게팅' },
          (Object.keys(TARGETING_LABELS) as TargetingMode[]).map((mode) => {
            const b = el('button', { type: 'button', text: TARGETING_LABELS[mode] });
            setPressed(b, tower.targeting === mode);
            this.disposers.push(onTap(b, () => this.cb.onTargeting(slotId, mode)));
            return b;
          }),
        );

    const sellValue = tower.sellValue();

    this.root.replaceChildren(
      ...([
        el('div', { class: 'panel__title' }, [
          el('span', { text: def.displayName }),
          el('span', { class: 'panel__level', text: tower.isMaxLevel ? '최대 레벨' : `Lv ${tower.level}` }),
        ]),
        isAura ? null : this.bowRow(cur.arrows, def.levels.length, def),
        el('div', { class: 'statgrid' }, rows),
        targetingRow,
      el('div', { class: 'panel__actions' }, [
        tower.isMaxLevel
          ? this.button('최대', 'btn-ghost', true, () => {})
          : this.button(`업그레이드 ${cost} G`, 'btn-primary', !affordable, () => this.cb.onUpgrade(slotId)),
        this.button(
          this.sellConfirming ? `정말 판매? +${sellValue} G` : `판매 +${sellValue} G`,
          'btn-danger',
          false,
          () => {
            // 한 번 더 확인받는다
            if (!this.sellConfirming) {
              this.sellConfirming = true;
              this.showTower(tower, gold);
              return;
            }
            this.cb.onSell(slotId);
          },
        ),
      ]),
        tower.isMaxLevel
          ? el('p', { class: 'panel__note', text: '이 진지는 더 강해질 수 없습니다.' })
          : affordable
            ? el('p', { class: 'panel__note', text: this.upgradeHint(def, next!) })
            : el('p', { class: 'panel__note panel__note--warn', text: `⚠ 골드 ${short} 부족` }),
      ].filter(Boolean) as Node[]),
    );

    this.root.style.display = 'block';
    this.addCloseButton();
    this.clampIntoView();
  }

  /** 다음 레벨에서 무엇이 좋아지는지 한 줄로 */
  private upgradeHint(def: TowerDef, next: { arrows: number; damagePerArrow: number }): string {
    if (def.kind === 'aura') return `한 번에 ${next.arrows}기까지 묶습니다.`;
    if (def.damageKind === 'siege') return `한 발에 ${next.damagePerArrow} — 범위로 함께 터집니다.`;
    return `화살이 ${next.arrows}발로 늘어 서로 다른 적을 노립니다.`;
  }

  private addCloseButton(): void {
    const close = this.button('닫기', 'btn-ghost panel__close', false, () => this.cb.onClose());
    this.root.querySelector('.panel__title')?.append(close);
  }

  /** 아이콘을 발사체 수만큼 — 몇 발인지 시각적으로 즉시 보인다 */
  private bowRow(active: number, total: number, def: TowerDef): HTMLElement {
    const icon = def.damageKind === 'siege' ? '🪨' : '🏹';
    const label = def.damageKind === 'siege' ? '투석' : '화살';
    const icons: Node[] = [];
    for (let i = 0; i < total; i++) {
      icons.push(el('span', { class: i < active ? 'bows__on' : 'bows__off', text: icon }));
    }
    return el('div', { class: 'bows', 'aria-label': `${label} ${active}발` }, icons);
  }

  private button(text: string, cls: string, disabled: boolean, fn: () => void): HTMLElement {
    const b = el('button', { type: 'button', class: cls, text, disabled });
    this.disposers.push(onTap(b, fn));
    return b;
  }

  dispose(): void {
    this.clearHandlers();
    this.root.remove();
  }
}
