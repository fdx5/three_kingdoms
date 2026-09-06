import { menuFrame } from './MenuFrame';
import { el, onTap } from './dom';
import type { AccountService } from '../account/AccountService';
import type { PublicAccount } from '../account/types';

/**
 * 첫 화면 — 아이디와 비밀번호.
 *
 * 가입 화면과 로그인 화면을 나누지 않는다. 처음 보는 아이디면 그 자리에서
 * 계정이 만들어지고, 이미 있는 아이디면 비밀번호가 맞아야 들어간다.
 * 화면이 하나뿐이라 "가입인가 로그인인가"를 고르는 단계가 사라진다.
 *
 * 이 화면을 넘기 전에는 게임이 시작되지 않는다 — 진행도가 계정에 붙기 때문이다.
 * 로그인하지 않은 채로 레벨 선택에 들어가면 남의 진행도도 내 진행도도 아닌
 * 빈 상태가 되어, 1장을 깬 사람이 다시 1장부터 하게 된다.
 */
export class LoginScreen {
  private node: HTMLElement | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly accounts: AccountService,
  ) {}

  get isOpen(): boolean {
    return this.node !== null;
  }

  /** 로그인이 끝날 때까지 기다린다. 성공한 계정을 돌려준다. */
  open(): Promise<PublicAccount> {
    this.close();

    return new Promise<PublicAccount>((resolve) => {
      const idInput = el('input', {
        type: 'text',
        id: 'login-id',
        autocomplete: 'username',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        maxlength: 16,
        placeholder: '영문 소문자·숫자 3~16자',
        'aria-label': '아이디',
      }) as HTMLInputElement;

      const pwInput = el('input', {
        type: 'password',
        id: 'login-password',
        autocomplete: 'current-password',
        maxlength: 64,
        placeholder: '4자 이상',
        'aria-label': '비밀번호',
      }) as HTMLInputElement;

      // 오류 문구는 aria-live 로 둔다 — 화면을 못 보는 사람에게도 읽힌다.
      const error = el('p', { class: 'login__error', role: 'alert', 'aria-live': 'assertive', text: '' });
      const hint = el('p', {
        class: 'hint',
        text: '처음 쓰는 아이디면 그대로 계정이 만들어집니다. 이미 있는 아이디는 비밀번호가 맞아야 들어갈 수 있습니다.',
      });

      const submit = el('button', {
        type: 'submit',
        class: 'btn-primary menu-start',
        text: '전장에 입장 →',
      }) as HTMLButtonElement;

      let busy = false;
      const run = async (): Promise<void> => {
        if (busy) return;
        busy = true;
        submit.disabled = true;
        submit.textContent = '확인 중…';
        error.textContent = '';

        const result = await this.accounts.signIn(idInput.value, pwInput.value);

        busy = false;
        submit.disabled = false;
        submit.textContent = '전장에 입장 →';

        if (!result.ok) {
          error.textContent = result.message;
          // 비밀번호가 틀렸으면 아이디는 그대로 두고 비밀번호만 비운다 —
          // 오타를 고치려고 아이디를 다시 치게 만들지 않는다.
          if (result.reason === 'wrong_password' || result.reason === 'invalid_password') {
            pwInput.value = '';
            pwInput.focus();
          } else {
            idInput.focus();
            idInput.select();
          }
          return;
        }

        this.close();
        resolve(result.account);
      };

      const form = el('form', { class: 'login__form', novalidate: 'novalidate' }, [
        el('label', { class: 'login__row' }, [el('span', { text: '아이디' }), idInput]),
        el('label', { class: 'login__row' }, [el('span', { text: '비밀번호' }), pwInput]),
        error,
        el('div', { class: 'overlay__actions' }, [submit]),
      ]) as HTMLFormElement;

      // 폼 제출로도, 버튼 탭으로도 같은 경로를 탄다 (엔터키가 그냥 동작해야 한다).
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        void run();
      });
      onTap(submit, () => void run());

      const panel = el('section', { class: 'menu-panel login-panel' }, [
        el('div', { class: 'menu-panel__heading' }, [el('div', {}, [
          el('p', { class: 'menu-eyebrow', text: 'YOUR CHRONICLE BEGINS' }),
          el('h2', { text: '장수여, 출정을 준비하라' }),
        ])]),
        el('p', { class: 'menu-panel__description', text: '당신의 이름으로 전장의 기록을 이어갑니다.' }),
        form, hint,
      ]);
      this.node = menuFrame('login-screen', panel);
      this.parent.append(this.node);
      idInput.focus();
    });
  }

  close(): void {
    this.node?.remove();
    this.node = null;
  }
}
