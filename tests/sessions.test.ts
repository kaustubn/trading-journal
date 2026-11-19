/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionStats, SessRow } from '../src/patterns/sessions';

const BARS = [480, 360, 90, 60, 90, 90, 150];
function rows(days: number, move: (wd: number, s: number, i: number, r: () => number) => number, seed = 1): SessRow[] {
  let sd = seed; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const out: SessRow[] = [];
  let date = Date.UTC(2021, 10, 15), i = 0;
  while (i < days) {
    const d = new Date(date), wd = d.getUTCDay();
    date += 86400000;
    if (wd === 0 || wd === 6) continue;
    const day = d.toISOString().slice(0, 10);
    let p = 16000;
    for (let s = 0; s < 7; s++) { const mv = move(wd - 1, s, i, r); out.push({ day, s, o: p, c: p + mv, h: Math.max(p, p + mv) + 5, l: Math.min(p, p + mv) - 5, n: BARS[s] }); p += mv; }
    i++;
  }
  return out;
}

test('sessions: a planted "Monday NY open hour goes up" tendency repeats, nothing else does', () => {
  const st = sessionStats(rows(1000, (wd, s, _i, r) => (wd === 0 && s === 3 ? 20 + (r() - 0.5) * 30 : (r() - 0.5) * 40)));
  const mon = st.grid[0][3];
  assert.equal(mon.repeats, 1, JSON.stringify(mon));
  assert.ok(mon.up > 0.8);
  const others = st.grid.flat().filter((c, k) => k !== 3 && c.repeats !== 0);
  assert.ok(others.length <= 1, `false positives ${others.length}`);
});
test('sessions: pure noise -> (almost) no repeating cells', () => {
  const st = sessionStats(rows(1000, (_wd, _s, _i, r) => (r() - 0.5) * 40, 9));
  assert.ok(st.repeating <= 1, `repeating ${st.repeating}`);
  assert.equal(st.tested, 35);
});
test('sessions: half days / gaps (too few bars) are skipped', () => {
  const rs = rows(50, () => 10).map(x => (x.s === 6 ? { ...x, n: 20 } : x));
  const st = sessionStats(rs);
  assert.equal(st.grid[0][6].n, 0);
  assert.ok(st.grid[0][3].n > 0);
});
test('calendar: month x week-of-month buckets, week 1 = days 1-7', () => {
  const st = sessionStats(rows(300, () => 10));
  const nov = st.calendar[10];
  assert.ok(nov[0].days > 0 && nov[0].up === 1 && nov[0].trendDays === 1);
});
