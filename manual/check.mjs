/** 넘친 지면을 찾는다 — 한 쪽에 담기지 않은 내용은 잘려서 사라진다. */
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 800, height: 1120 } });
page.on('requestfailed', (r) => console.log('[404]', r.url().split('/').pop()));
await page.goto('http://localhost:5173/manual/manual.html', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);
const bad = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('.page').forEach((p, i) => {
    if (p.classList.contains('page--dark')) return; // 전면 지면은 가장자리까지 쓴다
    // 마지막 자식의 아래끝이 쪽 안쪽 경계를 넘었는가
    const box = p.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(p).paddingBottom) || 0;
    let deepest = 0;
    p.querySelectorAll(':scope > *:not(.folio):not(.runhead)').forEach((c) => {
      deepest = Math.max(deepest, c.getBoundingClientRect().bottom - box.top);
    });
    const limit = box.height - Math.max(pad, 60);
    if (deepest > limit) out.push({ page: i + 1, over: Math.round(deepest - limit),
      head: p.querySelector('.runhead')?.textContent ?? p.className });
  });
  return out;
});
console.log(bad.length ? bad.map((b) => `${b.page}쪽 (${b.head}) — ${b.over}px 넘침`).join('\n') : '넘친 쪽 없음');
await browser.close();
