/** 설명서의 조각들 — 지도 SVG와 작은 도식들. */

const MAP_W = 1200, MAP_D = 700, RIBBON = 88;

/** 장의 지도. 경로·추천 자리·성문·적 출현 지점을 한 장에 담는다. */
export function levelMap(level) {
  const pts = level.path;
  const d = pts.map(([x, z], i) => `${i ? 'L' : 'M'}${x} ${z}`).join(' ');
  const [sx, sz] = pts[0];
  const [gx, gz] = pts[pts.length - 1];

  // 진행 방향 화살표 — 각 구간의 중간에 하나씩.
  const arrows = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 90) continue;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const deg = (Math.atan2(bz - az, bx - ax) * 180) / Math.PI;
    arrows.push(`<g transform="translate(${mx} ${mz}) rotate(${deg})">
      <path d="M-13 -11 L15 0 L-13 11 Z" fill="#ffffff" opacity=".5"/></g>`);
  }

  const slots = level.buildSlots.map((s, i) => `
    <g transform="translate(${s.x} ${s.z})">
      <circle r="34" fill="none" stroke="#8f2b20" stroke-width="2.5" stroke-dasharray="7 6" opacity=".75"/>
      <circle r="20" fill="#f6f1e6" stroke="#8f2b20" stroke-width="3"/>
      <text y="7.5" text-anchor="middle" font-size="23" font-weight="700" fill="#8f2b20">${i + 1}</text>
    </g>`).join('');

  return `<svg class="map" viewBox="-30 -30 ${MAP_W + 60} ${MAP_D + 60}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mg-${level.id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${level.environment.highColor}"/>
        <stop offset="1" stop-color="${level.environment.lowColor}"/>
      </linearGradient>
    </defs>
    <rect x="-30" y="-30" width="${MAP_W + 60}" height="${MAP_D + 60}" fill="url(#mg-${level.id})"/>
    <g opacity=".18" stroke="#000" stroke-width="1">
      ${Array.from({ length: 24 }, (_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="${MAP_D}"/>`).join('')}
      ${Array.from({ length: 14 }, (_, i) => `<line x1="0" y1="${i * 50}" x2="${MAP_W}" y2="${i * 50}"/>`).join('')}
    </g>
    <path d="${d}" fill="none" stroke="#2a1d10" stroke-width="${RIBBON + 8}" stroke-linejoin="round" stroke-linecap="round" opacity=".35"/>
    <path d="${d}" fill="none" stroke="#6b4a2a" stroke-width="${RIBBON}" stroke-linejoin="round" stroke-linecap="round"/>
    ${arrows.join('')}
    ${slots}
    <g transform="translate(${sx} ${sz})">
      <circle r="26" fill="#23201b" stroke="#e8d9b0" stroke-width="3"/>
      <text y="9" text-anchor="middle" font-size="26" font-weight="700" fill="#e8d9b0">敵</text>
    </g>
    <g transform="translate(${gx} ${gz})">
      <rect x="-30" y="-30" width="60" height="60" rx="5" fill="#8f2b20" stroke="#f6f1e6" stroke-width="3"/>
      <text y="10" text-anchor="middle" font-size="28" font-weight="700" fill="#f6f1e6">城</text>
    </g>
  </svg>`;
}

/** 타워 레벨별 dps 막대 — 표 옆에서 성장 곡선을 한눈에 보여준다. */
export function dpsBars(levels, max) {
  const top = max ?? Math.max(...levels.map((l) => l.dps), 1);
  return `<svg class="bars" viewBox="0 0 100 40" preserveAspectRatio="none">
    ${levels.map((l, i) => {
      const h = Math.max(2, (l.dps / top) * 36);
      return `<rect x="${i * 20 + 2.5}" y="${38 - h}" width="15" height="${h}" fill="${i === 4 ? '#8f2b20' : '#b08b3e'}" rx="1"/>`;
    }).join('')}
  </svg>`;
}
