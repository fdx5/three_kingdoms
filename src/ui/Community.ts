import { el, onTap } from './dom';
import { LEVEL_ORDER } from '../data/levels';
import type { AccountService } from '../account/AccountService';
import type { GameRecord, GuestbookEntry } from '../account/types';
import './community.css';

/**
 * 방명록과 전적 이력 — 게이머들이 함께 보는 두 화면.
 *
 * 둘 다 **모두의 것**이다. 방명록에는 누구나 한 줄 남기고 모두가 읽으며,
 * 이력에는 모든 계정의 판이 최신순으로 쌓인다. 저장은 계정 저장소가 하므로
 * 토르소 DB가 붙어 있으면 그대로 DB에 남고, 아니면 브라우저에 남는다 — 이 화면은
 * 어느 쪽인지 알지 못한다. [[GameStore]]
 *
 * 한 쪽에 열 줄씩 끊어 읽는다. 전체 수는 저장소가 세어 주므로(Page.total)
 * 여기서 전부 받아 세지 않는다 — 전적이 만 줄이 되어도 한 쪽만 내려받는다.
 */
const PAGE_SIZE = 10;

/** 레벨 id -> "제 3 장". 목록에 원시 id를 그대로 보여줄 수는 없다. */
function chapterOf(levelId: string): string {
  const i = LEVEL_ORDER.findIndex((l) => l.id === levelId);
  return i >= 0 ? `제 ${i + 1} 장` : levelId;
}

/** 초 -> "12분 34초". 한 판은 길어야 수십 분이라 시간 단위는 쓰지 않는다. */
function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}분 ${String(s).padStart(2, '0')}초` : `${s}초`;
}

/** 밀리초 -> "2026-09-07 18:24". 초까지는 목록에서 필요 없다. */
function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function stars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));
}

type View = 'guestbook' | 'history';

export class Community {
  private node: HTMLElement | null = null;
  private page = 0;
  private view: View = 'guestbook';
  /** 지금 뜬 목록이 몇 번째 요청의 것인가 — 늦게 온 응답이 새 화면을 덮지 않게 한다 */
  private request = 0;

  constructor(
    private readonly parent: HTMLElement,
    private readonly accounts: AccountService,
  ) {}

  get isOpen(): boolean {
    return this.node !== null;
  }

  open(view: View): void {
    this.close();
    this.view = view;
    this.page = 0;

    const title = el('h2', { class: 'community__title', text: view === 'guestbook' ? '방명록' : '전적 이력' });
    const subtitle = el('p', {
      class: 'community__sub',
      text: view === 'guestbook'
        ? '한 줄씩 남깁니다. 모든 게이머가 함께 읽습니다.'
        : '모든 게이머의 판이 최신순으로 쌓입니다.',
    });

    const close = el('button', { type: 'button', class: 'btn-ghost community__close', text: '닫기', 'aria-label': '닫기' });
    onTap(close, () => this.close());

    // 두 화면은 서로 오갈 수 있다 — 방명록을 읽다가 그 사람의 전적이 궁금해지는 게 자연스럽다.
    const tabs = el('div', { class: 'community__tabs', role: 'tablist' }, (['guestbook', 'history'] as View[]).map((v) => {
      const tab = el('button', {
        type: 'button',
        role: 'tab',
        class: `community__tab${v === view ? ' is-active' : ''}`,
        'aria-selected': v === view,
        text: v === 'guestbook' ? '방명록' : 'HISTORY',
      });
      if (v !== view) onTap(tab, () => this.open(v));
      return tab;
    }));

    const body = el('div', { class: 'community__body', 'aria-busy': 'true' }, [
      el('p', { class: 'community__empty', text: '불러오는 중…' }),
    ]);
    const pager = el('div', { class: 'community__pager' });

    const children: Node[] = [
      el('header', { class: 'community__head' }, [
        el('div', {}, [el('p', { class: 'menu-eyebrow', text: 'COMMUNITY' }), title, subtitle]),
        el('div', { class: 'community__headright' }, [tabs, close]),
      ]),
    ];
    if (view === 'guestbook') children.push(this.composer(body, pager));
    children.push(body, pager);

    this.node = el('div', { class: 'overlay community', id: 'community' }, [
      el('section', { class: 'community__panel' }, children),
    ]);
    this.parent.append(this.node);
    void this.refresh(body, pager);
  }

  close(): void {
    this.request++; // 날아오는 중인 응답이 사라진 화면에 그리지 않도록
    this.node?.remove();
    this.node = null;
  }

  // ── 방명록 쓰기 ─────────────────────────────────────────────────────

  /**
   * 한 줄 입력. 로그인한 사람의 id로 남는다 —
   * 이름을 직접 적게 하지 않는 것은 남의 이름을 사칭할 수 없게 하려는 것이다.
   */
  private composer(body: HTMLElement, pager: HTMLElement): HTMLElement {
    const who = this.accounts.current;
    if (!who) {
      return el('p', { class: 'community__note', text: '로그인하면 글을 남길 수 있습니다.' });
    }

    const input = el('input', {
      type: 'text',
      class: 'community__input',
      maxlength: 200,
      placeholder: '한 줄 남기기',
      'aria-label': '방명록 내용',
    });
    const submit = el('button', { type: 'button', class: 'btn-primary community__send', text: '남기기' });
    const status = el('span', { class: 'community__status', role: 'status' });

    const send = async (): Promise<void> => {
      const text = input.value.trim();
      if (!text) return;
      submit.disabled = true;
      input.disabled = true;
      status.textContent = '';
      const saved = await this.accounts.postGuestbook(text);
      submit.disabled = false;
      input.disabled = false;
      if (!saved) {
        status.textContent = '남기지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
        return;
      }
      input.value = '';
      // 방금 쓴 글은 첫 쪽 맨 위에 있다.
      this.page = 0;
      await this.refresh(body, pager);
      input.focus();
    };

    onTap(submit, () => void send());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void send();
      }
    });

    return el('form', { class: 'community__composer' }, [
      el('span', { class: 'community__author' }, [document.createTextNode('@'), el('b', { text: who.displayName })]),
      input,
      submit,
      status,
    ]);
  }

  // ── 목록 ────────────────────────────────────────────────────────────

  private async refresh(body: HTMLElement, pager: HTMLElement): Promise<void> {
    const ticket = ++this.request;
    const query = { limit: PAGE_SIZE, offset: this.page * PAGE_SIZE };
    body.setAttribute('aria-busy', 'true');

    let page: { items: (GuestbookEntry | GameRecord)[]; total: number };
    try {
      page = this.view === 'guestbook'
        ? await this.accounts.listGuestbook(query)
        : await this.accounts.listRecords(query);
    } catch (err) {
      console.warn('[community] 목록을 읽지 못했습니다:', err);
      if (ticket !== this.request) return;
      body.replaceChildren(el('p', { class: 'community__empty', text: '목록을 읽지 못했습니다.' }));
      pager.replaceChildren();
      body.setAttribute('aria-busy', 'false');
      return;
    }
    // 그 사이 화면이 닫혔거나 다른 쪽을 눌렀으면 이 응답은 버린다.
    if (ticket !== this.request) return;

    body.setAttribute('aria-busy', 'false');
    if (page.items.length === 0) {
      body.replaceChildren(el('p', {
        class: 'community__empty',
        text: this.view === 'guestbook' ? '아직 남긴 글이 없습니다. 첫 글을 남겨 보세요.' : '아직 기록된 판이 없습니다.',
      }));
      pager.replaceChildren();
      return;
    }

    body.replaceChildren(
      this.view === 'guestbook'
        ? this.guestbookList(page.items as GuestbookEntry[])
        : this.historyTable(page.items as GameRecord[]),
    );
    this.renderPager(pager, page.total, body);
  }

  private guestbookList(entries: GuestbookEntry[]): HTMLElement {
    return el('ul', { class: 'gb' }, entries.map((e) => el('li', { class: 'gb__row' }, [
      el('div', { class: 'gb__meta' }, [
        el('b', { class: 'gb__who', text: e.displayName || e.accountId }),
        el('span', { class: 'gb__when', text: stamp(e.createdAt) }),
      ]),
      el('p', { class: 'gb__msg', text: e.message }),
    ])));
  }

  private historyTable(records: GameRecord[]): HTMLElement {
    const head = el('thead', {}, [el('tr', {}, [
      el('th', { text: '아이디' }),
      el('th', { text: '레벨' }),
      el('th', { text: '결과' }),
      el('th', { text: '별' }),
      el('th', { class: 'num', text: '소요 시간' }),
      el('th', { class: 'num', text: '일시' }),
    ])]);
    const rows = records.map((r) => el('tr', { class: r.won ? 'hist--won' : 'hist--lost' }, [
      el('td', { class: 'hist__who', text: r.accountId }),
      el('td', {}, [
        el('span', { class: 'hist__chapter', text: chapterOf(r.levelId) }),
        el('span', { class: 'hist__title', text: r.levelTitle }),
      ]),
      el('td', {}, [el('span', {
        class: `hist__result hist__result--${r.won ? 'won' : 'lost'}`,
        text: r.won ? '승' : '패',
      })]),
      // 진 판은 별이 0이라 ☆☆☆로 보인다.
      el('td', { class: 'hist__stars', text: stars(r.won ? r.stars : 0) }),
      el('td', { class: 'num', text: duration(r.elapsed) }),
      el('td', { class: 'num hist__when', text: stamp(r.playedAt) }),
    ]));
    return el('div', { class: 'hist__scroll' }, [
      el('table', { class: 'hist' }, [head, el('tbody', {}, rows)]),
    ]);
  }

  private renderPager(pager: HTMLElement, total: number, body: HTMLElement): void {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const go = (n: number) => {
      this.page = Math.min(Math.max(0, n), pages - 1);
      void this.refresh(body, pager);
    };

    const prev = el('button', { type: 'button', class: 'community__page', text: '‹ 이전', disabled: this.page === 0 });
    const next = el('button', { type: 'button', class: 'community__page', text: '다음 ›', disabled: this.page >= pages - 1 });
    if (this.page > 0) onTap(prev, () => go(this.page - 1));
    if (this.page < pages - 1) onTap(next, () => go(this.page + 1));

    /*
     * 쪽 번호는 현재 쪽 둘레로만 다섯 개를 낸다.
     * 전적이 수백 판 쌓이면 번호를 전부 늘어놓을 수 없기 때문이다.
     */
    const from = Math.max(0, Math.min(this.page - 2, pages - 5));
    const numbers: Node[] = [];
    for (let n = from; n < Math.min(pages, from + 5); n++) {
      const b = el('button', {
        type: 'button',
        class: `community__page${n === this.page ? ' is-current' : ''}`,
        'aria-current': n === this.page,
        text: String(n + 1),
      });
      if (n !== this.page) onTap(b, () => go(n));
      numbers.push(b);
    }

    pager.replaceChildren(
      prev,
      ...numbers,
      next,
      el('span', { class: 'community__count', text: `전체 ${total.toLocaleString('ko-KR')}건 · ${this.page + 1}/${pages} 쪽` }),
    );
  }
}
