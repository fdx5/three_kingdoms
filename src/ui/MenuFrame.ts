import { el } from './dom';
import './menu.css';

/** Shared title-screen composition for sign-in and campaign selection. */
export function menuFrame(id: string, panel: HTMLElement, actions: Node[] = []): HTMLElement {
  const brand = el('div', { class: 'menu-brand' }, [
    el('p', { class: 'menu-eyebrow', text: 'THREE KINGDOMS · TOWER DEFENSE' }),
    el('h1', { class: 'menu-title', 'aria-label': '삼국지 Last Stand' }, [
      el('span', { class: 'menu-title__ko', text: '삼국지' }),
      el('span', { class: 'menu-title__en', text: 'Last Stand' }),
    ]),
    el('div', { class: 'menu-rule', 'aria-hidden': 'true' }, [el('span', { text: '◆' })]),
    el('p', { class: 'menu-motto' }, ['천하가 무너져도,', el('br'), '이 성은 무너지지 않는다.']),
    el('p', { class: 'menu-description', text: '망루를 세우고, 계략을 펼쳐라.\n끝없는 진군에 맞서는 최후의 방어선.' }),
    ...actions,
  ]);
  return el('div', { class: 'overlay main-menu', id }, [
    el('div', { class: 'menu-atmosphere', 'aria-hidden': 'true' }),
    el('header', { class: 'menu-header' }, [
      el('div', { class: 'menu-signature' }, [el('span', { class: 'menu-seal', text: '三國' }), el('span', { text: 'LAST STAND' })]),
      el('span', { class: 'menu-edition', text: 'THE THREE KINGDOMS CHRONICLES' }),
    ]),
    el('div', { class: 'menu-layout' }, [brand, panel]),
    el('footer', { class: 'menu-footer' }, [
      el('span', { text: '삼국지 Last Stand' }),
      el('span', { text: '한 번의 배치. 하나의 계략. 마지막까지 지켜낼 성.' }),
    ]),
  ]);
}
