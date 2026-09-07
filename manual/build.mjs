/**
 * 설명서 조판.
 *
 * 수치는 전부 manual/data.json 에서 온다 — 게임 데이터 파일이 유일한 출처다.
 * 여기서 손으로 적는 것은 설명뿐이고, 숫자는 한 개도 손으로 적지 않는다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { levelMap, dpsBars } from './parts.mjs';

const D = JSON.parse(readFileSync('manual/data.json', 'utf8'));
const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
const UNIT = byId(D.units);
const LEVEL = byId(D.levels);

const HANZI = ['一', '二', '三', '四', '五', '六'];
const FACTION_NAME = {
  yellow_turban: '황건적', xiliang: '서량군', yuan: '원소군',
  wu: '동오군', jing: '형주군', shu: '촉한군', han: '한군',
};
const KIND_NAME = { minion: '병졸', elite: '중간보스', boss: '최종보스' };
const DAMAGE_NAME = { ranged: '화살', siege: '공성', fire: '화염' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v) => Number(v).toLocaleString('ko-KR');

/* ── 페이지 틀 ──────────────────────────────────────────────── */
const pages = [];
let folio = 0;
/** 본문 한 쪽. 쪽 번호와 러닝헤드는 여기서만 찍는다. */
function page(runhead, html, cls = '') {
  folio += 1;
  pages.push(`<section class="page ${cls}">
    <div class="runhead">${esc(runhead)}</div>
    ${html}
    <div class="folio"><span>삼국지 Last Stand · 사용 설명서</span><span class="folio__no">${folio}</span></div>
  </section>`);
  return folio;
}
/** 쪽 번호를 매기지 않는 전면 지면 (표지·장 표지) */
function plate(html, cls = '') {
  folio += 1;
  pages.push(`<section class="page ${cls}">${html}</section>`);
  return folio;
}

const sechead = (no, title, sub) => `<header class="h-sec">
  <div class="h-sec__no">${esc(no)}</div>
  <h2 class="h-sec__t">${esc(title)}</h2>
  ${sub ? `<p class="h-sec__sub">${sub}</p>` : ''}
</header>`;

/* ── 특성을 사람 말로 ───────────────────────────────────────── */
function traitChips(t) {
  if (!t) return '<span class="chip chip--minion">특성 없음</span>';
  const out = [];
  if (t.rangedResist) out.push(`<span class="chip chip--ranged">화살 저항 ${Math.round(t.rangedResist * 100)}%</span>`);
  if (t.fireResist) out.push(`<span class="chip chip--fire">화염 저항 ${Math.round(t.fireResist * 100)}%</span>`);
  if (t.fireVuln) out.push(`<span class="chip chip--flame">화염 취약 ×${t.fireVuln}</span>`);
  if (t.slowImmune) out.push(`<span class="chip chip--immune">감속 면역</span>`);
  if (t.healAura) out.push(`<span class="chip chip--heal">회복 오라 ${t.healAura.hps}/초 · 반경 ${t.healAura.radius}</span>`);
  if (t.speedAura) out.push(`<span class="chip chip--speed">가속 오라 ×${t.speedAura.speedMul} · 반경 ${t.speedAura.radius}</span>`);
  if (t.charge) out.push(`<span class="chip chip--charge">돌진 ${t.charge.every}초마다 ×${t.charge.speedMul}</span>`);
  if (t.castleFlame) out.push(`<span class="chip chip--flame">성문 방화</span>`);
  return out.join('') || '<span class="chip chip--minion">특성 없음</span>';
}

/** 이 적의 답이 무엇인가 — 저항을 읽어 한 줄로 옮긴다. */
function counterLine(u) {
  const t = u.traits ?? {};
  const parts = [];
  if (t.fireVuln) parts.push('불에 두 배로 탄다. 화공 망루가 정답이다');
  if (t.rangedResist >= 0.5) parts.push('화살이 거의 통하지 않는다. 벽력거·화포로 친다');
  else if (t.rangedResist >= 0.25) parts.push('화살이 절반쯤 깎인다. 공성 피해를 섞어라');
  if (t.fireResist >= 0.6) parts.push('젖어 있어 불이 듣지 않는다');
  else if (t.fireResist >= 0.4) parts.push('화염이 절반쯤 막힌다');
  if (t.slowImmune) parts.push('철질려로 묶이지 않는다');
  if (t.healAura) parts.push('주변을 되살리므로 이쪽을 먼저 끊어야 앞줄이 죽는다');
  if (t.speedAura) parts.push('무리 전체를 앞당겨 보낸다');
  if (t.charge) parts.push('주기적으로 튀어나가므로 감속이 특히 값지다');
  if (t.castleFlame) parts.push('성문을 때리는 대신 태운다 — 붙기 전에 끊어라');
  if (!parts.length) return u.speed >= 110 ? '빠르다. 철질려로 묶어 두면 사거리 안에 오래 머문다' : '특별한 저항이 없다. 무엇으로든 죽는다';
  return parts.join('. ') + '.';
}


/** 이 망루가 무엇에 듣고 무엇에 막히는가 — 저항 값에서 그대로 뽑는다. */
function matchups(t) {
  const good = [], bad = [];
  for (const u of D.units) {
    const tr = u.traits ?? {};
    if (t.kind === 'aura') {
      if (tr.slowImmune) bad.push({ name: u.name, why: '감속 면역' });
      else if (u.speed >= 110) good.push({ name: u.name, why: `속도 ${u.speed}` });
      continue;
    }
    if (t.damageKind === 'ranged') {
      if (tr.rangedResist >= 0.4) bad.push({ name: u.name, why: `화살 저항 ${Math.round(tr.rangedResist * 100)}%` });
    } else if (t.damageKind === 'fire') {
      if (tr.fireVuln) good.push({ name: u.name, why: `화염 취약 ×${tr.fireVuln}` });
      if (tr.fireResist >= 0.4) bad.push({ name: u.name, why: `화염 저항 ${Math.round(tr.fireResist * 100)}%` });
    } else if (t.damageKind === 'siege') {
      // 공성은 어떤 저항도 받지 않는다 — 저항이 두꺼운 적일수록 이쪽이 답이다
      const wall = Math.max(tr.rangedResist ?? 0, tr.fireResist ?? 0);
      if (wall >= 0.5) good.push({ name: u.name, why: `저항 ${Math.round(wall * 100)}%를 무시` });
    }
  }
  const top = (a) => a.sort((x, y) => y.why.localeCompare(x.why)).slice(0, 5);
  return { good: top(good), bad: top(bad) };
}

const TOWER_PAIR = {
  archer_tower: '짝: 철질려 진지. 늦어진 적에게 다섯 발이 모두 꽂힌다. 방패가 나오면 벽력거를 한 대 섞는다.',
  catapult: '짝: 궁노 망루. 벽력거가 뭉친 무리를 깎고, 궁노가 흩어진 나머지를 정리한다.',
  fire_tower: '짝: 화포 진지. 형주군처럼 젖은 적이 섞여 오는 장에서는 불만으로 버틸 수 없다.',
  cannon_tower: '짝: 철질려 진지. 발사가 느린 만큼, 적이 한자리에 오래 머물수록 값이 오른다.',
  caltrop_camp: '짝: 무엇이든. 이 진지는 스스로 죽이지 않고 옆의 망루를 대신 강하게 만든다.',
};

/* ═══════════════════════════════════════════════════════════
   표지
   ═══════════════════════════════════════════════════════════ */
plate(`
  <div class="cover__art"><img src="print/field-6.jpg" alt=""></div>
  <div class="cover__veil"></div>
  <img class="cover__hero" src="print/cover-hero.png" alt="">
  <div class="cover__hanzi">天下大勢<br>分久必合</div>
  <div class="cover__inner">
    <div class="cover__seal">三國</div>
    <p class="cover__eyebrow">THREE KINGDOMS · TOWER DEFENSE</p>
    <h1 class="cover__title">삼국지<small>Last Stand</small></h1>
    <div class="cover__rule"></div>
    <p class="cover__motto">천하가 무너져도,<br>이 성은 무너지지 않는다.</p>
    <div class="cover__foot">
      <span>공식 사용 설명서</span>
      <span>전 六장 · 망루 五종 · 적 ${D.units.length}종</span>
    </div>
  </div>`, 'page--dark');

/* ═══════════════════════════════════════════════════════════
   목차 (쪽 번호는 조판이 끝난 뒤 채운다)
   ═══════════════════════════════════════════════════════════ */
const tocSlot = pages.push('') - 1;
folio += 1;
const tocPage = folio;
const toc = [];
const mark = (no, title, sub, p) => toc.push({ no, title, sub, p });

/* ═══════════════════════════════════════════════════════════
   1. 이 게임에 대하여
   ═══════════════════════════════════════════════════════════ */
mark('一', '이 게임에 대하여', '한 판의 흐름과 승패', page('머리말', `
${sechead('第一章', '이 게임에 대하여', '길은 하나, 성문도 하나다. 그 사이에 무엇을 세울 것인가.')}

<p class="lead">후한이 무너지고 천하가 갈라졌다. 황건의 무리부터 오장원의 마지막 북벌까지,
여섯 번의 전장에서 당신은 언제나 같은 편에 선다 — 성문을 등지고 선 쪽이다.</p>

<p>적은 정해진 길을 따라 온다. 당신은 그 길가에 망루를 세우고, 적을 처치해 번 골드로
망루를 키운다. 막지 못한 적은 성문에 닿아 성을 깎는다. 성 체력이 0이 되면 그 판은 끝이고,
마지막 웨이브를 넘기면 다음 장이 열린다.</p>

<h3 class="h-sub">한 판의 흐름</h3>
<table class="t-tight">
  <thead><tr><th style="width:22mm">단계</th><th>무슨 일이 벌어지는가</th></tr></thead>
  <tbody>
    <tr><td><b>준비</b></td><td>첫 웨이브까지 ${D.levels[0].firstWaveDelay}~${D.levels[5].firstWaveDelay}초. 시작 골드로 망루를 배치한다. 이 시간은 장마다 다르다.</td></tr>
    <tr><td><b>교전</b></td><td>적이 길을 따라 진군한다. 사거리에 들어온 적을 망루가 자동으로 노린다.</td></tr>
    <tr><td><b>수확</b></td><td>적을 처치할 때마다 골드가 들어온다. 웨이브를 넘길 때마다 보상 골드가 따로 붙는다.</td></tr>
    <tr><td><b>재투자</b></td><td>번 골드로 망루를 올리거나, 새로 짓거나, 성벽을 고치거나, 성문을 강화한다.</td></tr>
    <tr><td><b>보스</b></td><td>장마다 중간보스와 최종보스가 한 번씩 온다. 준비 없이는 넘길 수 없다.</td></tr>
    <tr><td><b>정산</b></td><td>남은 성 체력의 비율로 별 하나에서 셋까지. 클리어하면 다음 장이 열린다.</td></tr>
  </tbody>
</table>

<div class="callout callout--seal">
  <span class="callout__t">한 가지만 기억한다면</span>
  <p>망루를 <b>늘리는 것보다 키우는 것</b>이 대개 낫다. 궁노 망루는 1단계에서 화살 한 발을 쏘지만
  5단계에서는 다섯 발을 쏘고, 그 다섯 발이 <b>서로 다른 적</b>을 노린다.
  같은 골드로 망루를 하나 더 짓는 것과 있는 망루를 올리는 것은 같은 값이 아니다.</p>
</div>
`));

mark('', '', '', page('머리말', `
<h3 class="h-sub" style="margin-top:0">이길 조건 · 질 조건</h3>
<div class="grid2">
  <div class="callout">
    <span class="callout__t">승리</span>
    <p>그 장의 마지막 웨이브까지 전멸시키고 성이 살아남으면 승리한다.
    남은 성 체력의 비율이 곧 별 등급이다.</p>
  </div>
  <div class="callout callout--seal">
    <span class="callout__t">패배</span>
    <p>성 체력이 0이 되는 즉시 패배한다. 성벽 수리도, 성문 강화도 0이 되기 전에만 쓸 수 있다.</p>
  </div>
</div>

<h3 class="h-sub">여섯 장이 가르치는 것</h3>
<table class="t-tight">
  <thead><tr><th style="width:14mm">장</th><th style="width:42mm">전장</th><th>이 장이 요구하는 것</th></tr></thead>
  <tbody>
    <tr><td>제一장</td><td>${esc(LEVEL.level01.title.split('—')[0].trim())}</td><td><b>업그레이드</b> — 망루를 키우지 않으면 중간보스를 넘지 못한다.</td></tr>
    <tr><td>제二장</td><td>${esc(LEVEL.level02.title.split('—')[0].trim())}</td><td><b>조합</b> — 방패병에는 화살이 통하지 않는다. 벽력거와 철질려가 열린다.</td></tr>
    <tr><td>제三장</td><td>${esc(LEVEL.level03.title.split('—')[0].trim())}</td><td><b>시간</b> — 처치 골드가 짜다. 조기 소집으로 시간을 팔아 돈을 산다.</td></tr>
    <tr><td>제四장</td><td>${esc(LEVEL.level04.title.split('—')[0].trim())}</td><td><b>성문</b> — 슬롯이 다섯뿐이다. 일곱 번째 망루는 성문 그 자체다.</td></tr>
    <tr><td>제五장</td><td>${esc(LEVEL.level05.title.split('—')[0].trim())}</td><td><b>속성</b> — 물에 젖은 형주군에게 불은 듣지 않는다.</td></tr>
    <tr><td>제六장</td><td>${esc(LEVEL.level06.title.split('—')[0].trim())}</td><td><b>전부</b> — 앞의 다섯을 한 판에서 동시에 요구한다.</td></tr>
  </tbody>
</table>
`));

/* ═══════════════════════════════════════════════════════════
   2. 화면 보는 법
   ═══════════════════════════════════════════════════════════ */
mark('二', '화면 보는 법', 'HUD와 조작', page('화면과 조작', `
${sechead('第二章', '화면 보는 법', '전장 위에 겹쳐진 것들은 모두 한 번의 탭으로 닿는다.')}

<div class="shot">
  <img src="print/hud-overview.jpg" alt="게임 화면">
  <div class="pin" style="left:11%;top:7%">1</div>
  <div class="pin" style="left:27%;top:7%">2</div>
  <div class="pin" style="left:50%;top:7%">3</div>
  <div class="pin" style="left:92%;top:7%">4</div>
  <div class="pin" style="left:14%;top:94%">5</div>
  <div class="pin" style="left:50%;top:94%">6</div>
  <div class="pin" style="left:88%;top:94%">7</div>
</div>

<ol class="legend" style="margin-top:5mm">
  <li><b>1 골드</b> — 지금 쓸 수 있는 돈. 적을 처치하거나 웨이브를 넘기면 오른다.</li>
  <li><b>2 성 체력</b> — 0이 되면 패배. 성문을 강화하면 최대치가 함께 오른다.</li>
  <li><b>3 웨이브</b> — 지금 몇 번째 파도인가 / 이 장의 전체 파도 수.</li>
  <li><b>4 일시정지 · 설정 · 시점 초기화 · 배경음 · 메뉴</b> — 오른쪽 위 버튼 묶음.</li>
  <li><b>5 망루 목록</b> — 이 장에서 지을 수 있는 망루. 잠긴 것은 뒷장에서 열린다.</li>
  <li><b>6 계략</b> — 화공 · 얼음폭풍 · 원군. 골드를 즉시 전황으로 바꾼다(제二장부터).</li>
  <li><b>7 지금 소집 · 성벽 수리 · 성문 강화</b> — 웨이브 사이에 쓰는 세 가지 소비처.</li>
</ol>
`));

mark('', '', '', page('화면과 조작', `
<h3 class="h-sub" style="margin-top:0">조작 — PC</h3>
<table class="t-tight">
  <tbody>
    <tr><td style="width:44mm"><b>슬롯 탭</b></td><td>건설 · 타워 패널 열기</td></tr>
    <tr><td><b>드래그</b></td><td>카메라 팬 (지면이 커서를 그대로 따라온다)</td></tr>
    <tr><td><b>우클릭 · 휠클릭 · Shift+드래그</b></td><td>시점 회전 (좌우 ±60°, 부감 28~72°)</td></tr>
    <tr><td><b>휠</b></td><td>줌 (커서가 가리키는 지점을 향해)</td></tr>
    <tr><td><b>W A S D · 화살표</b></td><td>카메라 팬</td></tr>
    <tr><td><b>Q · E</b></td><td>시점 회전 &nbsp;/&nbsp; <b>PageUp · PageDown</b> 줌</td></tr>
    <tr><td><b>1 ~ 9</b></td><td>슬롯 선택 &nbsp;/&nbsp; <b>U</b> 선택한 망루 업그레이드</td></tr>
    <tr><td><b>Space</b></td><td>일시정지 &nbsp;/&nbsp; <b>R · ⌂</b> 시점 초기화</td></tr>
  </tbody>
</table>

<h3 class="h-sub">조작 — 모바일</h3>
<table class="t-tight">
  <tbody>
    <tr><td style="width:44mm"><b>한 손가락 드래그</b></td><td>카메라 팬</td></tr>
    <tr><td><b>두 손가락 벌리기 · 오므리기</b></td><td>줌</td></tr>
    <tr><td><b>두 손가락 비틀기</b></td><td>좌우 회전 — 손가락을 돌린 쪽으로 전장이 돈다</td></tr>
    <tr><td><b>두 손가락 나란히 위아래</b></td><td>부감 각도 — 터치에 없는 우클릭·Q·E의 몫이다</td></tr>
    <tr><td><b>두 손가락 함께 밀기</b></td><td>카메라 팬</td></tr>
  </tbody>
</table>
<p class="note" style="margin-top:2.5mm">가로 화면을 권장한다. 세로에서도 모든 조작이 되지만 사거리를 눈으로 가늠하기 어렵다.</p>
`));

/* ═══════════════════════════════════════════════════════════
   3. 피해와 저항 — 이 게임의 중심 규칙
   ═══════════════════════════════════════════════════════════ */
const resistUnits = D.units.filter((u) => u.traits && (u.traits.rangedResist || u.traits.fireResist || u.traits.fireVuln));
mark('三', '피해와 저항', '무엇이 무엇을 이기는가', page('피해와 저항', `
${sechead('第三章', '피해와 저항', '망루를 고르는 일은 취향이 아니라 계산이다.')}

<p class="lead">이 게임의 적은 단순히 단단하지 않다. 어떤 적은 <b>화살만</b> 튕겨내고,
어떤 적은 <b>불만</b> 견딘다. 그리고 어떤 적은 불에 두 배로 탄다.
망루를 무엇으로 채울지는 그 장에 오는 적이 정한다.</p>

<h3 class="h-sub">세 가지 피해</h3>
<table>
  <thead><tr><th style="width:20mm">피해</th><th style="width:40mm">이 피해를 내는 것</th><th>성질</th></tr></thead>
  <tbody>
    <tr><td><span class="chip chip--ranged">화살</span></td><td>궁노 망루 · 성가퀴</td>
      <td>가장 싸고 빠르다. 대신 <b>화살 저항</b>에 그대로 깎인다.</td></tr>
    <tr><td><span class="chip chip--siege">공성</span></td><td>벽력거 · 화포 진지 · 포문</td>
      <td><b>어떤 저항도 받지 않는다.</b> 방패와 젖은 몸, 둘 다의 답이다.</td></tr>
    <tr><td><span class="chip chip--fire">화염</span></td><td>화공 망루 · 화룡구 · 계략 화공</td>
      <td><b>화염 저항</b>에 막히고 <b>화염 취약</b>에 배로 든다. 지면에도 불이 남는다.</td></tr>
  </tbody>
</table>

<div class="callout">
  <span class="callout__t">저항이 겹칠 때</span>
  <p>저항이 먼저 적용되고 취약이 나중에 곱해진다. 등갑병은 화살 저항 65%에 화염 취약 ×2.2이므로,
  화살로는 삼분의 일만 들어가지만 불로는 두 배 넘게 들어간다. 같은 적이 무기에 따라 전혀 다른 적이 된다.</p>
</div>
`));

mark('', '', '', page('피해와 저항', `
<h3 class="h-sub" style="margin-top:0">저항을 가진 적과 그 답</h3>
<table class="t-tight">
  <thead><tr><th style="width:32mm">적</th><th class="num" style="width:16mm">화살저항</th><th class="num" style="width:16mm">화염저항</th><th class="num" style="width:16mm">화염취약</th><th>답</th></tr></thead>
  <tbody>
    ${resistUnits.map((u) => {
      const t = u.traits;
      const answer = t.fireVuln ? '<b>화공 망루</b>' : t.fireResist >= 0.5 ? '<b>공성</b> (벽력거·화포)'
        : t.rangedResist >= 0.5 ? '<b>공성</b> 또는 <b>화염</b>' : '공성을 섞는다';
      return `<tr><td>${esc(u.name)}</td>
        <td class="num">${t.rangedResist ? Math.round(t.rangedResist * 100) + '%' : '—'}</td>
        <td class="num">${t.fireResist ? Math.round(t.fireResist * 100) + '%' : '—'}</td>
        <td class="num">${t.fireVuln ? '×' + t.fireVuln : '—'}</td>
        <td>${answer}</td></tr>`;
    }).join('')}
  </tbody>
</table>
`));

mark('', '', '', page('피해와 저항', `
<h3 class="h-sub" style="margin-top:0">저항 말고도 있는 것들</h3>

<h4 class="h-min">감속과 감속 면역</h4>
<p>철질려 진지는 피해를 한 점도 주지 않는다. 대신 사거리 안의 적을 <b>속도 ${D.towers.find((t) => t.id === 'caltrop_camp').effect.params.speedMul}배</b>로
늦춘다. 늦어진 적은 다른 망루의 사거리 안에 더 오래 머무르므로, 철질려 하나가 옆 망루 전부의 화력을 올린다.
단, <b>감속 면역</b>을 가진 적에게는 통하지 않는다.</p>
<p class="note">감속 면역: ${D.units.filter((u) => u.traits?.slowImmune).map((u) => esc(u.name)).join(' · ')}</p>

<h4 class="h-min">회복 오라 — 먼저 끊어야 하는 적</h4>
<p>주변 아군을 초당 일정량 되살린다. 앞줄이 아무리 맞아도 죽지 않는다면 뒤에 이런 적이 서 있는 것이다.
사거리가 긴 망루로 <b>뒤를 먼저</b> 노리거나, 계략으로 무리 전체를 한 번에 쓸어야 한다.</p>
<table class="t-tight">
  <thead><tr><th style="width:34mm">적</th><th class="num" style="width:20mm">초당 회복</th><th class="num" style="width:20mm">반경</th><th>등장</th></tr></thead>
  <tbody>${D.units.filter((u) => u.traits?.healAura).map((u) => `<tr>
    <td>${esc(u.name)}</td><td class="num">${u.traits.healAura.hps}</td>
    <td class="num">${u.traits.healAura.radius}</td><td>${esc(LEVEL[u.firstSeen]?.title.split('—')[0].trim() ?? '')}</td></tr>`).join('')}
  </tbody>
</table>

<h4 class="h-min">가속 오라 — 웨이브를 앞당기는 적</h4>
<p>회복 오라가 "더 안 죽는다"라면 이쪽은 "더 빨리 온다"다. 무리 전체가 방어선을 지나는 시간이 줄어들어,
끊지 않으면 계산해 둔 화력이 통째로 모자라게 된다.</p>
<table class="t-tight">
  <thead><tr><th style="width:34mm">적</th><th class="num" style="width:20mm">속도 배율</th><th class="num" style="width:20mm">반경</th><th>등장</th></tr></thead>
  <tbody>${D.units.filter((u) => u.traits?.speedAura).map((u) => `<tr>
    <td>${esc(u.name)}</td><td class="num">×${u.traits.speedAura.speedMul}</td>
    <td class="num">${u.traits.speedAura.radius}</td><td>${esc(LEVEL[u.firstSeen]?.title.split('—')[0].trim() ?? '')}</td></tr>`).join('')}
  </tbody>
</table>

<h4 class="h-min">돌진 — 장수의 고유 능력</h4>
<p>이름 있는 장수는 일정 주기마다 짧게 튀어나간다. 감속이 걸려 있으면 그 순간의 위험이 크게 줄어든다.</p>
<table class="t-tight">
  <thead><tr><th style="width:34mm">장수</th><th class="num" style="width:20mm">주기</th><th class="num" style="width:20mm">지속</th><th class="num" style="width:20mm">속도 배율</th></tr></thead>
  <tbody>${D.units.filter((u) => u.traits?.charge).map((u) => `<tr>
    <td>${esc(u.name)}</td><td class="num">${u.traits.charge.every}초</td>
    <td class="num">${u.traits.charge.duration}초</td><td class="num">×${u.traits.charge.speedMul}</td></tr>`).join('')}
  </tbody>
</table>

<div class="callout callout--seal">
  <span class="callout__t">성문 방화 — 제갈량만의 것</span>
  <p>보통의 적은 성문을 때릴 때마다 그 자리에서 피해를 준다. 제갈량은 다르다.
  부채를 휘두르면 화염이 성벽에 붙어 ${UNIT.zhugeliang.traits.castleFlame.duration}초에 걸쳐 타들어 간다.
  서서 버티는 것으로는 막을 수 없다 — 닿기 전에 끊는 수밖에 없다.</p>
</div>
`));

/* ═══════════════════════════════════════════════════════════
   4. 망루 도감
   ═══════════════════════════════════════════════════════════ */
const TOWER_NOTE = {
  archer_tower: '모든 장의 기본. 업그레이드마다 화살이 한 발씩 늘고, 그 화살들은 서로 다른 적을 노린다. 5단계에서는 한 번에 다섯을 동시에 때린다 — 뭉쳐 오는 병졸에게 가장 효율이 높다. 다만 화살 저항 앞에서는 숫자가 그대로 깎인다.',
  catapult: '방패병이 나오는 순간부터 반드시 한 대는 필요하다. 공성 피해는 어떤 저항도 받지 않고, 착탄 지점 반경 62를 함께 친다. 발사가 느려 단일 표적 추격에는 약하니, 길이 꺾이는 자리에 두어 뭉친 무리를 노려야 값을 한다.',
  fire_tower: '레벨마다 용머리가 하나씩 는다. 1단계부터 지면에 불을 남기고, 그 불은 적이 지나간 뒤에도 남아 계속 태운다. 등갑병처럼 잘 타는 적에게는 다른 어떤 망루보다 낫다. 반대로 젖은 형주군에게는 거의 무력하다.',
  cannon_tower: '가장 비싸고 가장 멀리 닿는다. 사거리가 175에서 210까지 늘어 뒷줄의 회복 오라를 직접 노릴 수 있는 유일한 망루다. 3단계부터 착탄 지점에 불구덩이를 남긴다.',
  caltrop_camp: '피해가 0이다. 그래서 이것만으로는 아무것도 죽지 않는다. 대신 사거리 안의 적을 한꺼번에 늦춰, 옆에 선 망루들이 쏠 시간을 만든다. 5단계에서는 사거리 안 전부를 붙잡는다. 기병이 몰려오는 장에서는 사실상 필수다.',
};
const TOWER_PLACE = {
  archer_tower: '길이 여러 번 겹쳐 지나가는 안쪽',
  catapult: '길이 꺾여 적이 뭉치는 자리',
  fire_tower: '적이 반드시 밟고 지나가는 좁은 길목',
  cannon_tower: '뒤쪽 — 사거리로 앞뒤를 모두 덮는 자리',
  caltrop_camp: '다른 망루 서넛의 사거리가 겹치는 한복판',
};

mark('四', '망루 도감', '다섯 종류와 다섯 단계', page('망루 도감', `
${sechead('第四章', '망루 도감', '건설비는 입장료일 뿐이다. 값은 업그레이드가 정한다.')}

<p class="lead">망루는 다섯 종류, 각각 다섯 단계다. 처음 두 종류는 제一장부터 쥐고 시작하고
나머지는 장을 넘기며 하나씩 열린다. 아래 표의 <b>총 투자</b>는 건설비에 5단계까지의 업그레이드 비용을 모두 더한 값이다.</p>

<table>
  <thead><tr><th>망루</th><th class="num">건설비</th><th class="num">총 투자</th><th>피해</th><th>해금</th><th class="num">5단계 초당 피해</th></tr></thead>
  <tbody>
    ${D.towers.map((t) => `<tr>
      <td><b>${esc(t.name)}</b></td>
      <td class="num">${n(t.buildCost)}</td>
      <td class="num">${n(t.totalCost)}</td>
      <td><span class="chip chip--${t.damageKind}">${DAMAGE_NAME[t.damageKind]}</span></td>
      <td>${t.unlockedIn ? '제' + HANZI[+t.unlockedIn.slice(-2) - 1] + '장' : '처음부터'}</td>
      <td class="num">${t.kind === 'aura' ? '—' : n(t.levels[4].dps)}</td></tr>`).join('')}
  </tbody>
</table>

<div class="callout">
  <span class="callout__t">판매</span>
  <p>지은 망루는 언제든 되팔 수 있다. 환급률은 <b>${Math.round(D.towers[0].sellRatio * 100)}%</b>이므로,
  자리를 잘못 잡았다면 즉시 되파는 편이 낫다 — 늦게 팔수록 그 자리에 부은 업그레이드까지 함께 손해다.</p>
</div>

<div class="callout callout--seal">
  <span class="callout__t">불은 저절로 붙는다</span>
  <p>궁노 망루와 벽력거는 <b>${D.balance.fire.unlockLevel}단계부터</b> 무기가 달아올라 착탄 지점에 작은 불을 남긴다.
  화공 망루와 화포 진지는 그것이 곧 정체성이라 자기 값을 따로 갖는다.</p>
</div>
`));

for (const t of D.towers) {
  const isAura = t.kind === 'aura';
  mark('', '', '', page(`망루 도감 · ${t.name}`, `
  <div class="tower">
    <div class="tower__fig"><img src="print/tower-${t.id}-1.jpg" alt="${esc(t.name)}"></div>
    <div>
      <h2 class="tower__name">${esc(t.name)}</h2>
      <div class="tower__cost">건설 ${n(t.buildCost)}골드 · 5단계까지 총 ${n(t.totalCost)}골드 ·
        ${t.unlockedIn ? '제' + HANZI[+t.unlockedIn.slice(-2) - 1] + '장 해금' : '제一장부터'}</div>
      <p style="margin-top:3mm">${esc(t.description)}</p>
      <div>
        <span class="chip chip--${t.damageKind}">${DAMAGE_NAME[t.damageKind]} 피해</span>
        ${t.effect?.type === 'splash' ? `<span class="chip chip--siege">범위 ${t.effect.params.radius}</span>` : ''}
        ${t.effect?.type === 'slow' ? `<span class="chip chip--slow">감속 ×${t.effect.params.speedMul} · ${t.effect.params.duration}초</span>` : ''}
        ${t.ignite ? `<span class="chip chip--fire">${t.ignite.fromLevel}단계부터 점화</span>` : ''}
        <span class="chip chip--minion">환급 ${Math.round(t.sellRatio * 100)}%</span>
      </div>
      <p class="card__note" style="margin-top:3mm">${esc(TOWER_NOTE[t.id])}</p>
    </div>
  </div>

  <h3 class="h-sub">단계별 수치</h3>
  <table>
    <thead><tr>
      <th style="width:14mm">단계</th>
      <th class="num">${isAura ? '동시 대상' : '발수'}</th>
      <th class="num">${isAura ? '' : '발당 피해'}</th>
      <th class="num">발사 간격</th>
      <th class="num">사거리</th>
      <th class="num">${isAura ? '' : '초당 피해'}</th>
      <th class="num">업그레이드</th>
      <th class="num">누적 투자</th>
    </tr></thead>
    <tbody>
      ${t.levels.map((lv, i) => {
        const cum = t.buildCost + t.levels.slice(0, i + 1).reduce((s, x) => s + (x.upgradeCost ?? 0), 0);
        return `<tr>
          <td><b>Lv ${lv.level}</b></td>
          <td class="num">${lv.arrows >= 999 ? '전부' : lv.arrows}</td>
          <td class="num">${isAura ? '—' : lv.damagePerArrow}</td>
          <td class="num">${lv.fireInterval}초</td>
          <td class="num">${lv.range}</td>
          <td class="num">${isAura ? '—' : n(lv.dps)}</td>
          <td class="num">${lv.upgradeCost ? n(lv.upgradeCost) : '건설'}</td>
          <td class="num">${n(cum)}</td></tr>`;
      }).join('')}
    </tbody>
  </table>

  ${isAura ? '' : `<div style="display:flex;align-items:center;gap:5mm;margin-top:4mm">
    ${dpsBars(t.levels)}
    <p class="note" style="margin:0">단계별 초당 피해. 1단계 ${n(t.levels[0].dps)} → 5단계 ${n(t.levels[4].dps)},
    <b>${(t.levels[4].dps / t.levels[0].dps).toFixed(1)}배</b>다.</p>
  </div>`}

  ${t.ignite ? `<div class="callout" style="margin-top:4mm">
    <span class="callout__t">남기는 불</span>
    <p>${t.ignite.fromLevel}단계부터 착탄 지점에 <b>반경 ${t.ignite.radius}</b>의 불이 남는다 —
    초당 ${t.ignite.dps}${t.ignite.dpsPerLevel ? `(단계마다 ×${t.ignite.dpsPerLevel})` : ''},
    ${t.ignite.duration}초간. 적이 지나간 뒤에도 그 자리는 계속 탄다.</p>
  </div>` : ''}

  <div class="callout">
    <span class="callout__t">놓는 자리</span>
    <p>${esc(TOWER_PLACE[t.id])}.</p>
  </div>

  <h3 class="h-sub">이 망루가 만나는 적</h3>
  <div class="grid2">
    <div>
      <h4 class="h-min" style="margin-top:0">잘 듣는다</h4>
      <table class="t-tight"><tbody>
        ${matchups(t).good.map((m) => `<tr><td>${esc(m.name)}</td><td class="num" style="color:var(--jade)">${esc(m.why)}</td></tr>`).join('')
          || '<tr><td colspan="2" class="note">특별히 유리한 상대는 없다. 두루 쓰인다.</td></tr>'}
      </tbody></table>
    </div>
    <div>
      <h4 class="h-min" style="margin-top:0">듣지 않는다</h4>
      <table class="t-tight"><tbody>
        ${matchups(t).bad.map((m) => `<tr><td>${esc(m.name)}</td><td class="num" style="color:var(--seal)">${esc(m.why)}</td></tr>`).join('')
          || '<tr><td colspan="2" class="note">이 망루를 막아서는 저항은 없다.</td></tr>'}
      </tbody></table>
    </div>
  </div>
  <p class="note" style="margin-top:3mm">${esc(TOWER_PAIR[t.id])}</p>
  `));
}

/* ═══════════════════════════════════════════════════════════
   5. 성문
   ═══════════════════════════════════════════════════════════ */
mark('五', '성문', '여섯 단계와 화룡구', page('성문', `
${sechead('第五章', '성문', '지켜야 할 대상이자, 가장 강한 망루다.')}

<p class="lead">성문은 처음부터 스스로 싸운다. 성가퀴의 궁수가 다가온 적에게 화살을 쏘고,
강화할수록 그 무기가 통째로 바뀐다 — 쇠뇌에서 대포로, 대포에서 화룡구로.
성문 강화는 <b>제四장부터</b> 열린다.</p>

<div class="callout callout--seal">
  <span class="callout__t">왜 제四장부터인가</span>
  <p>앞의 세 장은 슬롯이 넉넉하다. 제四장은 슬롯이 다섯뿐인데 적은 ${n(LEVEL.level04.totalSpawns)}마리가 온다.
  여섯 번째 망루를 지을 자리가 없을 때, 성문이 그 자리를 대신한다.</p>
</div>

<table>
  <thead><tr><th style="width:12mm">단계</th><th style="width:26mm">이름</th><th class="num">강화비</th><th class="num">최대 체력</th><th>무기</th><th class="num">사거리</th><th class="num">초당 피해</th></tr></thead>
  <tbody>
    ${D.castle.map((c) => `<tr>
      <td><b>${c.level}</b></td><td>${esc(c.title)}</td>
      <td class="num">${c.upgradeCost ? n(c.upgradeCost) : '기본'}</td>
      <td class="num">${c.hpBonus ? '+' + c.hpBonus : '—'}</td>
      <td>${c.weapon.shots}발 × ${c.weapon.damagePerShot}${c.weapon.splashRadius ? ` · 범위 ${c.weapon.splashRadius}` : ''}</td>
      <td class="num">${c.weapon.range}</td>
      <td class="num">${n(c.dps)}</td></tr>`).join('')}
  </tbody>
  <tfoot><tr><td colspan="2">1단계 → 6단계 전부</td>
    <td class="num">${n(D.castle.reduce((s, c) => s + (c.upgradeCost ?? 0), 0))}</td>
    <td class="num">+${D.castle.reduce((s, c) => s + c.hpBonus, 0)}</td>
    <td colspan="2"></td>
    <td class="num">×${(D.castle[5].dps / D.castle[0].dps).toFixed(1)}</td></tr></tfoot>
</table>

<div class="grid3" style="margin-top:6mm">
  ${[1, 3, 6].map((lv) => {
    const c = D.castle[lv - 1];
    return `<div class="card">
      <div class="card__fig"><img src="print/castle-${lv}.jpg" alt=""></div>
      <h4 class="card__name">${c.level}단계 · ${esc(c.title)}</h4>
      <p class="card__note">${esc(c.description)}</p>
    </div>`;
  }).join('')}
</div>

<h3 class="h-sub">성벽 수리</h3>
<p>제二장부터 웨이브 사이에 성벽을 고칠 수 있다. <b>${D.balance.repair.chunkHp}씩</b> 회복하며
체력 1당 ${D.balance.repair.goldPerHp}골드가 든다 — 한 번에 ${n(D.balance.repair.chunkHp * D.balance.repair.goldPerHp)}골드다.
재사용 대기는 ${D.balance.repair.cooldownSec}초이고, <b>적이 나오는 중에는 쓸 수 없다</b>.
수리는 최대 체력을 넘겨 채울 수 없으므로, 성문 강화로 최대치를 먼저 올리는 편이 대개 이득이다.</p>
`));

for (const lv of [1, 2, 4, 5]) { /* 나머지 단계 이미지는 부록으로 미룬다 */ void lv; }

/* ═══════════════════════════════════════════════════════════
   6. 계략
   ═══════════════════════════════════════════════════════════ */
const STRAT_NOTE = {
  fire_attack: '전장의 모든 적에게 동시에 들어간다. 뭉쳐 오는 웨이브의 중간, 혹은 회복 오라를 두른 무리를 통째로 밀어낼 때 값을 한다. 다만 화염 저항을 가진 형주군에게는 눈에 띄게 약하다.',
  ice_storm: '피해는 없지만 <b>감속 면역과 무관하게</b> 모든 적을 멈춘다. 야습대와 목우처럼 철질려가 통하지 않는 상대에게 유일한 제동이며, 보스의 돌진을 끊는 데도 쓴다.',
  reinforcements: '망루의 피해량 자체를 올린다. 이미 5단계까지 올려 둔 망루가 많을수록 같은 골드로 얻는 것이 커진다 — 판이 끝나갈 무렵의 계략이다.',
};
mark('六', '계략', '지금 이 순간의 답', page('계략', `
${sechead('第六章', '계략', '망루가 미리 놓는 답이라면, 계략은 그 순간에 쓰는 답이다.')}

<p class="lead">계략은 골드를 즉시 전황으로 바꾼다. 망루와 달리 미리 세울 수 없고,
쓰는 순간에만 값을 한다. 제二장부터 열리며 장마다 쓸 수 있는 종류가 다르다.</p>

<div class="stack">
${D.stratagems.map((s) => `
  <div class="callout" style="display:grid;grid-template-columns:16mm 1fr;gap:5mm;align-items:start">
    <div style="font-family:'Ma Shan Zheng','KaiTi',serif;font-size:34pt;line-height:1;color:var(--seal);text-align:center">${esc(s.glyph)}</div>
    <div>
      <h4 style="margin:0;font-size:13pt">${esc(s.name)}</h4>
      <div style="font-family:'Noto Sans KR',sans-serif;font-size:8.4pt;letter-spacing:.1em;color:var(--ink-3);margin:.8mm 0 2mm">
        ${n(s.cost)}골드 · 재사용 대기 ${s.cooldown}초</div>
      <p style="margin:0 0 2mm">${esc(s.description)}</p>
      <p class="card__note" style="margin:0">${STRAT_NOTE[s.id]}</p>
    </div>
  </div>`).join('')}
</div>

<h3 class="h-sub">장마다 쓸 수 있는 계략</h3>
<table class="t-tight">
  <thead><tr><th style="width:40mm">장</th>${D.stratagems.map((s) => `<th class="num">${esc(s.name)}</th>`).join('')}</tr></thead>
  <tbody>
    ${D.levels.map((l, i) => `<tr><td>제${HANZI[i]}장 · ${esc(l.title.split('—')[0].trim())}</td>
      ${D.stratagems.map((s) => `<td class="num">${l.stratagems.includes(s.id) ? '●' : '—'}</td>`).join('')}</tr>`).join('')}
  </tbody>
</table>
<p class="note" style="margin-top:2.5mm">제一장에는 계략이 없다. 배치와 업그레이드라는 기본기를 흐리지 않기 위해서다.</p>
`));

mark('', '', '', page('계략', `
<h3 class="h-sub" style="margin-top:0">골드를 어디에 쓸 것인가</h3>
<table class="t-tight">
  <thead><tr><th style="width:30mm">소비처</th><th style="width:26mm">언제</th><th>무엇을 사는가</th></tr></thead>
  <tbody>
    <tr><td><b>업그레이드</b></td><td>언제나</td><td>가장 확실한 투자. 단계가 오를수록 골드당 효율이 오른다.</td></tr>
    <tr><td><b>새 망루</b></td><td>빈 슬롯이 있을 때</td><td>화력이 닿지 않는 구간을 메운다.</td></tr>
    <tr><td><b>성벽 수리</b></td><td>웨이브 사이</td><td>이미 잃은 체력. 최대치를 넘길 수는 없다.</td></tr>
    <tr><td><b>성문 강화</b></td><td>제四장부터</td><td>최대 체력과 화력을 동시에. 슬롯이 모자랄 때의 답.</td></tr>
    <tr><td><b>계략</b></td><td>웨이브 한복판</td><td>지금 넘기지 못하면 끝나는 순간을 산다.</td></tr>
    <tr><td><b>지금 소집</b></td><td>웨이브 사이</td><td><b>반대다.</b> 남은 대기 시간을 팔아 골드를 번다.</td></tr>
  </tbody>
</table>

<div class="callout callout--seal">
  <span class="callout__t">지금 소집 — 시간을 파는 일</span>
  <p>다음 웨이브까지 남은 초를 골드로 바꾼다. 계수는 장마다 다르며,
  제三장이 <b>초당 ${LEVEL.level03.earlyCallBonusPerSecond}골드</b>로 가장 높다 — 그 장은 처치 골드가 짜서
  조기 소집이 사실상 주 수입원이다. 대신 앞 웨이브가 끝나기 전에 다음 웨이브가 겹쳐 온다.</p>
</div>
`));

/* ═══════════════════════════════════════════════════════════
   7. 적 도감
   ═══════════════════════════════════════════════════════════ */
mark('七', '적 도감', `여섯 진영 ${D.units.length}종`, page('적 도감', `
${sechead('第七章', '적 도감', '적을 아는 것이 곧 망루를 고르는 일이다.')}

<p class="lead">전 ${D.units.length}종. 진영마다 성격이 뚜렷하다 —
서량은 방패로 화살을 막고, 동오는 잘 타는 등갑을 두르고 오며,
형주는 물에 젖어 불이 듣지 않는다. 촉한은 그 모두를 조금씩 갖췄다.</p>

<h3 class="h-sub">진영별 성격</h3>
<table class="t-tight">
  <thead><tr><th style="width:24mm">진영</th><th style="width:20mm">등장</th><th class="num">종류</th><th>이 진영의 특징</th></tr></thead>
  <tbody>
    <tr><td><b>황건적</b></td><td>제一장</td><td class="num">3</td><td>저항이 하나도 없다. 오직 수로만 밀어붙인다.</td></tr>
    <tr><td><b>서량군</b></td><td>제二장</td><td class="num">6</td><td>방패병이 화살을 72% 튕겨낸다. 공성 피해가 처음 필요해지는 장.</td></tr>
    <tr><td><b>원소군</b></td><td>제三장</td><td class="num">5</td><td>기수가 무리 전체를 앞당긴다. 처치 골드가 짜다.</td></tr>
    <tr><td><b>동오군</b></td><td>제四장</td><td class="num">6</td><td>등갑병은 화살을 막지만 불에 두 배로 탄다. 화공 망루가 열린다.</td></tr>
    <tr><td><b>형주군</b></td><td>제五장</td><td class="num">6</td><td>물에 젖어 화염 저항이 높다. 화공이 무력해지고 화포가 열린다.</td></tr>
    <tr><td><b>촉한군</b></td><td>제六장</td><td class="num">6</td><td>모든 저항을 고르게 갖췄다. 조합 없이는 넘길 수 없다.</td></tr>
  </tbody>
</table>

<h3 class="h-sub">보는 법</h3>
<p class="note">카드의 네 숫자는 <b>체력 · 속도 · 처치 골드 · 성 피해</b>다.
성 피해는 그 적 하나가 성문에 닿았을 때 성이 잃는 체력이다.
중간보스와 최종보스는 이름 옆에 표시가 붙는다.</p>

<div class="callout">
  <span class="callout__t">같은 모습, 다른 적</span>
  <p>진영이 달라도 같은 형상을 쓰는 병졸이 있다. 겉이 같아도 체력·속도·저항은 전혀 다르니
  <b>이름과 숫자를 보고</b> 판단해야 한다.</p>
</div>
`));

const FACTION_ORDER = ['yellow_turban', 'xiliang', 'yuan', 'wu', 'jing', 'shu'];
for (const f of FACTION_ORDER) {
  const list = D.units.filter((u) => u.faction === f);
  const chapterNo = FACTION_ORDER.indexOf(f);
  mark('', '', '', page(`적 도감 · ${FACTION_NAME[f]}`, `
  <header class="h-sec" style="margin-bottom:5mm">
    <div class="h-sec__no">제${HANZI[chapterNo]}장의 적</div>
    <h2 class="h-sec__t" style="font-size:17pt">${FACTION_NAME[f]}</h2>
  </header>
  <div class="grid3">
  ${list.map((u) => `
    <div class="card">
      <div class="card__fig"><img src="print/unit-${u.id}.jpg" alt="${esc(u.name)}"></div>
      <h4 class="card__name">${esc(u.name)}</h4>
      <div class="card__meta">
        <span class="chip chip--${u.kind}">${KIND_NAME[u.kind]}</span>
      </div>
      <dl class="card__stats">
        <div><dt>체력</dt><dd>${n(u.hp)}</dd></div>
        <div><dt>속도</dt><dd>${u.speed}</dd></div>
        <div><dt>골드</dt><dd>${n(u.goldOnKill)}</dd></div>
        <div><dt>성 피해</dt><dd>${u.castleDamage}</dd></div>
      </dl>
      <div class="card__traits">${traitChips(u.traits)}</div>
      <p class="card__note">${esc(counterLine(u))}</p>
    </div>`).join('')}
  </div>
  `));
}

/* ═══════════════════════════════════════════════════════════
   8. 전장 — 여섯 장
   ═══════════════════════════════════════════════════════════ */
const LEVEL_LEAD = {
  level01: '황건의 무리가 호뢰관으로 밀려온다. 저항도 계략도 없는 순수한 물량전이다. 이 장이 묻는 것은 하나뿐이다 — 망루를 키웠는가.',
  level02: '동탁의 서량군이 온다. 방패병의 등장으로 "화살만으로는 안 되는 적"이 처음 나타나고, 그 답으로 벽력거와 철질려가 열린다.',
  level03: '관도의 나루. 처치 골드가 유난히 짜고, 대신 조기 소집 계수가 가장 높다. 안전하게 기다릴수록 가난해지는 장이다.',
  level04: '소요진. 슬롯이 다섯뿐인데 적은 천 마리가 넘는다. 여섯 번째 망루를 지을 자리가 없다 — 성문을 올려야 한다.',
  level05: '한수가 범람했다. 물에 젖은 형주군에게 불은 거의 듣지 않는다. 화공 망루를 도배해 온 사람이 처음으로 무너지는 장이다.',
  level06: '오장원. 앞의 다섯 장이 가르친 것을 한 판에서 동시에 요구한다. 제갈량은 성문을 때리는 대신 태운다.',
};
const LEVEL_TIP = {
  level01: ['궁노 망루 두 대를 먼저 5단계 근처까지 올린다. 다섯 대를 1단계로 늘어놓는 것보다 낫다.',
    '길이 겹쳐 지나가는 안쪽 슬롯이 가장 값지다 — 한 망루가 같은 적을 두 번 만난다.',
    '제六파 두목과 제十二파 장각 전에는 반드시 업그레이드를 끝내 둔다.'],
  level02: ['방패병이 보이면 즉시 벽력거를 한 대 세운다. 화살로는 28%만 들어간다.',
    '서량 철기는 속도 112다. 철질려로 묶어 두지 않으면 사거리를 순식간에 빠져나간다.',
    '종군 도사를 먼저 끊어야 앞줄이 죽는다. 사거리가 긴 망루로 뒤를 노려라.',
    '여포는 8초마다 2.6배로 돌진한다. 얼음폭풍을 그 순간에 맞춰 쓴다.'],
  level03: ['처치 골드가 짜다. 안전하게 기다리면 업그레이드 비용이 영영 모이지 않는다.',
    '웨이브 사이마다 지금 소집을 눌러 남은 초를 골드로 바꾼다 — 초당 10골드다.',
    '하북 기수의 가속 오라 반경은 110이다. 무리 한복판에 있으므로 범위 피해로 함께 친다.',
    '원소는 반경 200의 가속 오라를 두른다. 웨이브 전체가 앞당겨 도착한다는 뜻이다.'],
  level04: ['성문 강화가 처음 열린다. 슬롯 다섯이 다 차면 남는 골드는 성문으로 간다.',
    '등갑병은 화염 취약 ×2.2다. 화공 망루 한 대가 궁노 세 대보다 낫다.',
    '강동 야습대는 감속 면역이다. 철질려로 묶이지 않으니 얼음폭풍을 아껴 둔다.',
    '손권은 반경 190으로 초당 55를 회복시킨다. 화력을 나누면 영영 죽지 않는다.'],
  level05: ['형주 수군의 화염 저항은 80%다. 화공 망루만으로 온 판은 여기서 무너진다.',
    '화포 진지가 열린다. 사거리 175~210으로 뒷줄의 위험을 직접 노릴 수 있다.',
    '공성 목우는 체력 380에 감속 면역, 성 피해 60이다. 반드시 길 위에서 끊는다.',
    '관우는 화염 저항 75%에 돌진과 가속 오라를 함께 가진다. 공성으로 답한다.'],
  level06: ['적이 2,300마리를 넘는다. 슬롯 여덟을 모두 채우고 모두 올려야 한다.',
    '촉한군은 화살·화염 저항을 고르게 갖췄다. 공성 피해의 비중을 가장 높게 잡는다.',
    '목우유마는 체력 460에 회복 오라 34, 감속 면역이다. 화포로 뒤에서 끊는다.',
    '제갈량은 성문을 불로 태운다. 성문을 6단계 화룡구까지 올려 최대 체력을 확보해 둔다.'],
};

for (let i = 0; i < D.levels.length; i++) {
  const l = D.levels[i];
  const chapter = `제${HANZI[i]}장`;
  plate(`
    <div class="opener">
      <img src="print/field-${i + 1}.jpg" alt="">
      <div class="opener__veil"></div>
      <div class="opener__body">
        <div class="opener__no">${HANZI[i]}</div>
        <h2 class="opener__t">${esc(l.title)}</h2>
        <p class="opener__lead">${esc(LEVEL_LEAD[l.id])}</p>
        <dl class="opener__facts">
          <div><dt>성 체력</dt><dd>${n(l.castleHp)}</dd></div>
          <div><dt>시작 골드</dt><dd>${n(l.startGold)}</dd></div>
          <div><dt>건설 슬롯</dt><dd>${l.slots}<small> 자리</small></dd></div>
          <div><dt>총 병력</dt><dd>${n(l.totalSpawns)}<small> 마리</small></dd></div>
        </dl>
      </div>
    </div>`, 'page--dark');

  mark(HANZI[i], l.title.split('—')[0].trim(), l.title.split('—')[1]?.trim() ?? '', page(`전장 · ${chapter}`, `
  <header class="h-sec" style="margin-bottom:5mm">
    <div class="h-sec__no">${chapter}</div>
    <h2 class="h-sec__t" style="font-size:18pt">${esc(l.title)}</h2>
  </header>

  ${levelMap(l)}
  <div class="map-key">
    <span><b>敵</b> 적 출현</span><span><b>城</b> 성문</span>
    <span><b>①~${'①②③④⑤⑥⑦⑧'[l.slots - 1]}</b> 건설 슬롯 ${l.slots}자리</span>
    <span>1칸 = 50 · 전장 1200 × 700</span>
  </div>

  <div class="grid2" style="margin-top:4mm">
    <div>
      <h4 class="h-min" style="margin-top:0">이 장의 규칙</h4>
      <table class="t-tight"><tbody>
        <tr><td>웨이브</td><td class="num">${l.waves}파</td></tr>
        <tr><td>첫 웨이브까지</td><td class="num">${l.firstWaveDelay}초</td></tr>
        <tr><td>웨이브 간격</td><td class="num">${l.waveInterval}초</td></tr>
        <tr><td>조기 소집</td><td class="num">초당 ${l.earlyCallBonusPerSecond}골드</td></tr>
        <tr><td>전부 처치 시 골드</td><td class="num">${n(l.killGold)}</td></tr>
        ${l.totalReward ? `<tr><td>웨이브 보상 합계</td><td class="num">${n(l.totalReward)}골드</td></tr>` : ''}
        <tr><td>성벽 수리</td><td class="num">${l.allowRepair ? '가능' : '없음'}</td></tr>
        <tr><td>성문 강화</td><td class="num">${l.castleUpgrade ? '가능' : '없음'}</td></tr>
        <tr><td>별 셋 기준</td><td class="num">성 체력 ${Math.round(l.stars.three * 100)}%</td></tr>
        <tr><td>별 둘 기준</td><td class="num">성 체력 ${Math.round(l.stars.two * 100)}%</td></tr>
      </tbody></table>
    </div>
    <div>
      <h4 class="h-min" style="margin-top:0">편성</h4>
      <table class="t-tight"><thead><tr><th>적</th><th class="num">수</th></tr></thead><tbody>
        ${l.roster.map((r) => `<tr><td>${esc(r.name)}${r.kind !== 'minion' ? ` <span class="chip chip--${r.kind}">${KIND_NAME[r.kind]}</span>` : ''}</td>
          <td class="num">${n(r.count)}</td></tr>`).join('')}
      </tbody>
      <tfoot><tr><td>합계</td><td class="num">${n(l.totalSpawns)}</td></tr></tfoot></table>
      <h4 class="h-min">보스</h4>
      <p class="note" style="margin:0">${l.bossWaves.map((b) => esc(b.banner)).join('<br>')}</p>
    </div>
  </div>

  `));

  page(`전장 · ${chapter}`, `
  <h3 class="h-sub" style="margin-top:0">공략</h3>
  <ol class="legend">
    ${LEVEL_TIP[l.id].map((t) => `<li>${t}</li>`).join('')}
  </ol>

  <h3 class="h-sub">이 장에 처음 나오는 적</h3>
  <div class="debuts">
    ${l.debuts.map((id) => {
      const u = UNIT[id];
      return `<figure class="debut">
        <img src="print/unit-${id}.jpg" alt="${esc(u.name)}">
        <figcaption>${esc(u.name)}<small>체력 ${n(u.hp)} · 속도 ${u.speed}</small></figcaption>
      </figure>`;
    }).join('')}
  </div>

  <table class="t-tight" style="margin-top:5mm">
    <thead><tr><th style="width:26mm">적</th><th style="width:16mm">분류</th><th style="width:56mm">특성</th><th>무엇으로 답하는가</th></tr></thead>
    <tbody>
      ${l.debuts.map((id) => {
        const u = UNIT[id];
        return `<tr>
          <td><b>${esc(u.name)}</b></td>
          <td><span class="chip chip--${u.kind}">${KIND_NAME[u.kind]}</span></td>
          <td>${traitChips(u.traits)}</td>
          <td>${esc(counterLine(u))}</td></tr>`;
      }).join('')}
    </tbody>
  </table>
  `);
}

/* ═══════════════════════════════════════════════════════════
   9. 부록
   ═══════════════════════════════════════════════════════════ */
mark('八', '부록', '별 등급 · 계정 · 성문 도해', page('부록', `
${sechead('附錄', '부록', '알아 두면 좋은 나머지.')}

<h3 class="h-sub">별 등급</h3>
<p>클리어할 때 남은 성 체력의 비율로 별 하나에서 셋까지 받는다. 기준은 장마다 다르다 —
누수가 전제된 장에서 100% 기준을 요구하면 등급이 정보를 주지 못하기 때문이다.</p>
<table class="t-tight">
  <thead><tr><th>장</th><th class="num">★★★</th><th class="num">★★</th><th class="num">★</th></tr></thead>
  <tbody>
    ${D.levels.map((l, i) => `<tr><td>제${HANZI[i]}장 · ${esc(l.title.split('—')[0].trim())}</td>
      <td class="num">${Math.round(l.stars.three * 100)}% 이상</td>
      <td class="num">${Math.round(l.stars.two * 100)}% 이상</td>
      <td class="num">클리어</td></tr>`).join('')}
  </tbody>
</table>

<h3 class="h-sub">진행과 계정</h3>
<p>진행도는 계정에 붙는다. 아이디와 비밀번호로 접속하면 어느 기기에서든 같은 진행도를 이어받고,
새로고침해도 로그인이 유지된다. 앞 장을 클리어해야 다음 장이 열린다.</p>
<p class="note">아이디는 소문자·숫자·밑줄·하이픈 3~16자, 비밀번호는 4자 이상이다.
전적은 이기든 지든 한 줄씩 남는다.</p>
`));

mark('', '', '', page('부록', `
<h3 class="h-sub" style="margin-top:0">성문 여섯 단계</h3>
<div class="grid3">
  ${D.castle.map((c) => `<div class="card">
    <div class="card__fig" style="height:32mm"><img src="print/castle-${c.level}.jpg" alt="" style="max-height:32mm"></div>
    <h4 class="card__name" style="font-size:10.5pt">${c.level}단계 · ${esc(c.title)}</h4>
    <div class="card__meta">${c.upgradeCost ? n(c.upgradeCost) + '골드' : '기본 상태'} · 초당 ${n(c.dps)}</div>
  </div>`).join('')}
</div>

<h3 class="h-sub">숫자로 보는 전 六장</h3>
<table class="t-tight">
  <thead><tr><th>장</th><th class="num">성 체력</th><th class="num">시작 골드</th><th class="num">슬롯</th><th class="num">웨이브</th><th class="num">총 병력</th><th class="num">보상 합계</th></tr></thead>
  <tbody>
    ${D.levels.map((l, i) => `<tr><td>제${HANZI[i]}장</td>
      <td class="num">${n(l.castleHp)}</td><td class="num">${n(l.startGold)}</td>
      <td class="num">${l.slots}</td><td class="num">${l.waves}</td>
      <td class="num">${n(l.totalSpawns)}</td><td class="num">${n(l.totalReward)}</td></tr>`).join('')}
  </tbody>
  <tfoot><tr><td>합계</td><td class="num">—</td><td class="num">—</td>
    <td class="num">${D.levels.reduce((s, l) => s + l.slots, 0)}</td>
    <td class="num">${D.levels.reduce((s, l) => s + l.waves, 0)}</td>
    <td class="num">${n(D.levels.reduce((s, l) => s + l.totalSpawns, 0))}</td>
    <td class="num">${n(D.levels.reduce((s, l) => s + l.totalReward, 0))}</td></tr></tfoot>
</table>
`));

/* ═══════════════════════════════════════════════════════════
   목차를 채운다
   ═══════════════════════════════════════════════════════════ */
pages[tocSlot] = `<section class="page">
  <div class="runhead">목차</div>
  ${sechead('目次', '목차', '')}
  <div class="toc">
    ${toc.filter((t) => t.no).map((t) => `<div class="toc__row">
      <span class="toc__no">${esc(t.no)}</span>
      <span class="toc__t">${esc(t.title)}${t.sub ? `<small>${esc(t.sub)}</small>` : ''}</span>
      <span class="toc__dots"></span>
      <span class="toc__p">${t.p}</span>
    </div>`).join('')}
  </div>
  <div class="callout" style="margin-top:8mm">
    <span class="callout__t">이 설명서의 숫자에 대하여</span>
    <p>이 설명서에 실린 모든 수치는 게임의 데이터 파일에서 그대로 뽑아 조판한 것이다.
    손으로 옮겨 적은 숫자는 한 개도 없다.</p>
  </div>
  <div class="folio"><span>삼국지 Last Stand · 사용 설명서</span><span class="folio__no">${tocPage}</span></div>
</section>`;

/* ═══════════════════════════════════════════════════════════ */
const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8">
<title>삼국지 Last Stand — 사용 설명서</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;700;900&family=Noto+Sans+KR:wght@400;500;700&family=Ma+Shan+Zheng&display=block" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head><body>
${pages.join('\n')}
</body></html>`;

writeFileSync('manual/manual.html', html);
console.log(`쪽 ${folio} · 절 ${toc.filter((t) => t.no).length}`);
