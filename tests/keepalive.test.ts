import { describe, expect, it } from 'vitest';
import { planKeepAlive } from '../server/keepalive';

/**
 * 스핀다운 방지의 판단만 검사한다.
 *
 * 여기가 틀리면 **아무 일도 안 일어난 채 조용히 지나간다** — render.com 은
 * 인스턴스를 재울 때 오류를 남기지 않으므로, 15분 뒤에 사용자가 못 들어와야
 * 비로소 안다. 그래서 켜고 끄는 조건을 순수 함수로 떼어 두고 여기서 본다.
 */
describe('keepalive 계획', () => {
  it('render.com 이 준 주소로 /api/health 를 두드린다', () => {
    const plan = planKeepAlive({ RENDER_EXTERNAL_URL: 'https://three-kingdoms-cmus.onrender.com' });
    expect(plan.url).toBe('https://three-kingdoms-cmus.onrender.com/api/health');
  });

  it('기본 간격은 15분 창 안이다', () => {
    const plan = planKeepAlive({ RENDER_EXTERNAL_URL: 'https://x.onrender.com' });
    expect(plan.intervalMs).toBeLessThan(15 * 60_000);
    expect(plan.intervalMs).toBeGreaterThan(60_000);
  });

  it('간격이 이상하면 기본값으로 문다 — 창을 못 지키는 값이 들어오면 안 된다', () => {
    const base = { RENDER_EXTERNAL_URL: 'https://x.onrender.com' };
    const fallback = planKeepAlive(base).intervalMs;
    for (const KEEPALIVE_MINUTES of ['0', '-5', '20', 'abc', '']) {
      expect(planKeepAlive({ ...base, KEEPALIVE_MINUTES }).intervalMs).toBe(fallback);
    }
    expect(planKeepAlive({ ...base, KEEPALIVE_MINUTES: '5' }).intervalMs).toBe(5 * 60_000);
  });

  it('로컬에서는 켜지지 않는다 — 개발 중에 밖으로 요청을 보내지 않는다', () => {
    const plan = planKeepAlive({});
    expect(plan.url).toBeNull();
    expect(plan.reason).toContain('RENDER_EXTERNAL_URL');
  });

  it('KEEPALIVE 로 끌 수 있다 — 무료 750시간이 모자랄 때 쓴다', () => {
    for (const KEEPALIVE of ['off', '0', 'false', 'OFF']) {
      expect(planKeepAlive({ RENDER_EXTERNAL_URL: 'https://x.onrender.com', KEEPALIVE }).url).toBeNull();
    }
    expect(planKeepAlive({ RENDER_EXTERNAL_URL: 'https://x.onrender.com', KEEPALIVE: 'on' }).url).not.toBeNull();
  });

  it('주소가 망가져 있으면 조용히 켜지 않고 이유를 남긴다', () => {
    for (const RENDER_EXTERNAL_URL of ['그냥문자열', 'ftp://x', '  ']) {
      const plan = planKeepAlive({ RENDER_EXTERNAL_URL });
      expect(plan.url).toBeNull();
      expect(plan.reason).not.toBe('');
    }
  });

  it('KEEPALIVE_URL 이 render 주소를 이긴다', () => {
    const plan = planKeepAlive({
      RENDER_EXTERNAL_URL: 'https://render.example',
      KEEPALIVE_URL: 'https://custom.example',
    });
    expect(plan.url).toBe('https://custom.example/api/health');
  });
});
