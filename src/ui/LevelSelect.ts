import { menuFrame } from './MenuFrame';
import { el, onTap } from './dom';
import { LEVEL_ORDER } from '../data/levels';
import { isLevelUnlocked, loadProgress, suggestedLevelId, type LevelProgress } from './progress';

/** 누구로 접속했는지 보여줄 정보. 없으면 계정 줄 자체가 안 뜬다. */
export interface LevelSelectAccount {
  displayName: string;
  onLogout: () => void;
}

/** 메뉴에서 열 수 있는 함께 보는 화면들 */
export interface LevelSelectCommunity {
  onGuestbook: () => void;
  onHistory: () => void;
}

/**
 * 메뉴에서의 배경음 조작.
 *
 * 메뉴에도 그 장의 곡이 흐르는데 여기서는 끌 방법이 없었다 —
 * 전투에 들어가야만 ♪ 버튼이 보였기 때문이다.
 */
export interface LevelSelectAudio {
  isOn: () => boolean;
  onToggle: (on: boolean) => void;
}

/**
 * 레벨 선택 화면.
 * 앞 레벨을 클리어해야 다음이 열린다. 별 등급은 계정에 기록으로 남는다.
 */
export class LevelSelect {
  private node: HTMLElement | null = null;
  private account: LevelSelectAccount | null = null;
  private community: LevelSelectCommunity | null = null;
  private audio: LevelSelectAudio | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly onPick: (levelId: string) => void,
  ) {}

  /** 접속한 계정을 알려준다. 로그아웃 버튼이 여기에 붙는다. */
  setAccount(account: LevelSelectAccount | null): void {
    this.account = account;
  }

  /** 방명록·이력 버튼을 붙인다. 없으면 두 버튼이 뜨지 않는다. */
  setCommunity(community: LevelSelectCommunity | null): void {
    this.community = community;
  }

  /** 배경음 버튼을 붙인다. 없으면 버튼이 뜨지 않는다. */
  setAudio(audio: LevelSelectAudio | null): void {
    this.audio = audio;
  }

  get isOpen(): boolean {
    return this.node !== null;
  }

  open(progress: LevelProgress = loadProgress()): void {
    this.close();

    const suggested = suggestedLevelId(progress);
    const cards = LEVEL_ORDER.map((level) => {
      const unlocked = isLevelUnlocked(level.id, progress);
      const stars = progress.stars[level.id] ?? 0;

      const starRow = el(
        'div',
        { class: 'levelcard__stars', 'aria-label': stars ? `${stars}개의 별` : '미클리어' },
        [0, 1, 2].map((i) => el('span', { class: i < stars ? '' : 'stars__off', text: '★' })),
      );

      const card = el('button', {
        type: 'button',
        class: `levelcard${unlocked ? '' : ' levelcard--locked'}${level.id === suggested ? ' levelcard--suggested' : ''}`,
        disabled: !unlocked,
        'aria-label': `${level.title}${unlocked ? '' : ' (잠김)'}`,
      });
      card.append(
        el('div', { class: 'levelcard__index', text: `제 ${LEVEL_ORDER.indexOf(level) + 1} 장` }),
        el('div', { class: 'levelcard__title', text: level.title }),
        el('div', { class: 'levelcard__meta', text: `성 체력 ${level.castle.hp} · ${level.waves.length}파` }),
        starRow,
      );
      if (!unlocked) {
        card.append(el('div', { class: 'levelcard__lock', text: '앞 장을 먼저 클리어하세요' }));
      } else {
        onTap(card, () => {
          this.close();
          this.onPick(level.id);
        });
      }
      return card;
    });

    const children: Node[] = [];
    const cleared = LEVEL_ORDER.filter(level => (progress.stars[level.id] ?? 0) > 0).length;
    children.push(el('div', { class: 'menu-panel__heading' }, [
      el('div', {}, [el('p', { class: 'menu-eyebrow', text: 'CAMPAIGN' }), el('h2', { text: '천하의 전장' })]),
      el('span', { class: 'menu-progress', text: `${cleared} / ${LEVEL_ORDER.length} 장 정복` }),
    ]));
    children.push(el('p', { class: 'menu-panel__description', text: '승리로 다음 장을 열고, 당신의 전기를 이어가세요.' }));

    // 접속한 계정과 로그아웃. 잠긴 장이 왜 잠겼는지는 "누구로 접속했는가"에 달려 있으므로
    // 이 줄이 카드 위에 있어야 한다.
    if (this.account || this.community || this.audio) {
      const actions: Node[] = [];
      // 배경음부터. 메뉴에 들어오자마자 곡이 흐르므로 가장 먼저 찾게 되는 버튼이다.
      if (this.audio) {
        const audio = this.audio;
        const bgm = el('button', { type: 'button', class: 'btn-ghost bgm-toggle' });
        const paint = (): void => {
          const on = audio.isOn();
          bgm.textContent = on ? '♪' : '🔇';
          bgm.setAttribute('aria-label', on ? '배경음 끄기' : '배경음 켜기');
          bgm.setAttribute('title', on ? '배경음 끄기' : '배경음 켜기');
          bgm.setAttribute('aria-pressed', on ? 'true' : 'false');
        };
        paint();
        onTap(bgm, () => {
          audio.onToggle(!audio.isOn());
          paint();
        });
        actions.push(bgm);
      }
      // 방명록과 이력은 모두가 함께 보는 곳이라 화면을 닫지 않고 위에 겹쳐 띄운다 —
      // 읽고 나면 고르던 자리로 그대로 돌아온다.
      if (this.community) {
        const { onGuestbook, onHistory } = this.community;
        const guestbook = el('button', { type: 'button', class: 'btn-ghost', text: '방명록' });
        const history = el('button', { type: 'button', class: 'btn-ghost', text: 'HISTORY' });
        onTap(guestbook, () => onGuestbook());
        onTap(history, () => onHistory());
        actions.push(guestbook, history);
      }
      if (this.account) {
        const logout = el('button', { type: 'button', class: 'btn-ghost', text: '로그아웃' });
        const { onLogout } = this.account;
        onTap(logout, () => {
          this.close();
          onLogout();
        });
        actions.push(logout);
      }
      children.push(
        el('div', { class: 'accountbar' }, [
          el('span', { class: 'accountbar__who' }, this.account
            ? [document.createTextNode('접속: '), el('b', { text: this.account.displayName })]
            : [document.createTextNode('접속하지 않음')]),
          el('div', { class: 'accountbar__actions' }, actions),
        ]),
      );
    }

    children.push(el('div', { class: 'levelgrid' }, cards));
    const panel = el('section', { class: 'menu-panel campaign-panel' }, children);
    const next = LEVEL_ORDER.find(level => level.id === suggested)!;
    const start = el('button', { class: 'menu-start', type: 'button' }, [
      el('span', { text: cleared ? '전장으로 복귀' : '출정하기' }),
      el('span', { text: '→', 'aria-hidden': 'true' }),
    ]);
    onTap(start, () => { this.close(); this.onPick(suggested); });
    this.node = menuFrame('level-select', panel, [
      el('div', { class: 'menu-deploy' }, [start, el('p', { text: `다음 전장 · ${next.title}` })]),
    ]);
    this.parent.append(this.node);
  }

  close(): void {
    this.node?.remove();
    this.node = null;
  }
}
