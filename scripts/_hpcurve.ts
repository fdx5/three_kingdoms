import { LEVEL_ORDER } from '../src/data/levels';
import { UNITS } from '../src/data/units';
for (const l of LEVEL_ORDER) {
  const rows = l.waves.map((w) => {
    const minions = w.spawns.filter((s) => UNITS[s.unitId]?.kind === 'minion');
    if (!minions.length) return { n: w.index, mul: 0, hp: 0, cnt: 0 };
    const mul = minions.reduce((a, s) => a + s.hpMul, 0) / minions.length;
    const hp = minions.reduce((a, s) => a + UNITS[s.unitId].hp * s.hpMul, 0) / minions.length;
    return { n: w.index, mul, hp, cnt: minions.length };
  });
  const first = rows[0], last = rows[rows.length - 1];
  console.log(`\n${l.id} — 체력배율 ${first.mul.toFixed(2)} → ${last.mul.toFixed(2)} (x${(last.mul / first.mul).toFixed(1)}), 평균체력 ${first.hp.toFixed(0)} → ${last.hp.toFixed(0)}`);
  console.log('  ' + rows.map((r) => `${r.n}:${r.mul.toFixed(2)}`).join(' '));
  console.log('  평균체력 ' + rows.map((r) => `${r.hp.toFixed(0)}`).join(' '));
}
