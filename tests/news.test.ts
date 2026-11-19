/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventRow, summarize, fillForward, FIRST_MIN, DayGrid, NewsEvent, allEvents } from '../src/patterns/news';

const SPAN = 510;
/** A day of 1m bars from 7:30 ET; `move(k)` = close-to-close change of minute k (k = minutes after 7:30). */
function day(move: (k: number) => number, vol: (k: number) => number = () => 100): DayGrid {
  const g: DayGrid = { O: new Float64Array(SPAN), H: new Float64Array(SPAN), L: new Float64Array(SPAN), C: new Float64Array(SPAN), V: new Float64Array(SPAN) };
  let p = 20000;
  for (let k = 0; k < SPAN; k++) { const o = p, c = p + move(k); g.O[k] = o; g.C[k] = c; g.H[k] = Math.max(o, c) + 1; g.L[k] = Math.min(o, c) - 1; g.V[k] = vol(k); p = c; }
  return g;
}
const at830 = 510 - FIRST_MIN; // index of the 8:30 bar
const ev = (date: string): NewsEvent => ({ type: 'CPI', date, min: 510 });

test('eventRow: measures before / first 5 min / after, from the right minutes', () => {
  const g = day(k => (k >= at830 - 5 && k < at830 ? 1 : k >= at830 && k < at830 + 5 ? 4 : k >= at830 + 5 && k < at830 + 35 ? 1 : 0), k => (k === at830 ? 5000 : 100));
  const r = eventRow(ev('2025-03-12'), g)!;
  assert.equal(r.pre5, 5);       // 5 minutes x +1 before the release
  assert.equal(r.first1, 4);
  assert.equal(r.first5, 20);    // 5 x +4
  assert.equal(r.after30, 30);   // 30 x +1 after the first 5 minutes
  assert.equal(r.after60, 30);   // flat after that
  assert.ok(r.volSpike >= 40 && r.dataOk);
});
test('eventRow: no volume spike = flagged (date probably wrong), and dropped from the stats', () => {
  const g = day(() => 0.5); // flat volume = no spike
  const r = eventRow(ev('2025-03-12'), g)!;
  assert.equal(r.dataOk, false);
  assert.equal(summarize([r], [1]).n, 0);
});
test('summarize: "keeps going" release pattern -> follow repeats, fade does not', () => {
  const rows = Array.from({ length: 40 }, (_, i) => {
    const up = i % 2 === 0, s = up ? 1 : -1, noise = ((i * 7) % 5) - 2;
    const g = day(k => (k >= at830 && k < at830 + 5 ? 6 * s : k >= at830 + 5 && k < at830 + 35 ? (1 + noise * 0.1) * s : 0), k => (k === at830 ? 9000 : 100));
    return eventRow(ev(`2024-01-${String(1 + (i % 28)).padStart(2, '0')}`), g)!;
  });
  const s = summarize(rows, Array(100).fill(5));
  assert.equal(s.n, 40);
  assert.equal(s.firstUp, 0.5);
  assert.equal(s.keepsGoing.after30, 1);
  assert.ok(s.follow.repeats, JSON.stringify(s.follow));
  assert.equal(s.fade.repeats, false);
  assert.ok(s.timesNormal > 5);
});
test('summarize: random after-moves -> nothing repeats', () => {
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rows = Array.from({ length: 60 }, (_, i) => {
    const s = rnd() < 0.5 ? 1 : -1, a = rnd() < 0.5 ? 1 : -1;
    const g = day(k => (k >= at830 && k < at830 + 5 ? 5 * s : k >= at830 + 5 && k < at830 + 35 ? a * (0.5 + rnd()) : 0), k => (k === at830 ? 9000 : 100));
    return eventRow(ev(`2023-02-${String(1 + (i % 28)).padStart(2, '0')}`), g)!;
  });
  const s = summarize(rows, Array(100).fill(5));
  assert.equal(s.follow.repeats && s.fade.repeats, false);
  assert.ok(!(s.follow.repeats || s.fade.repeats) || Math.abs(s.follow.tStat) >= 2);
});
test('fillForward: missing minutes become flat bars at the last close', () => {
  const g = day(() => 1);
  g.C[100] = NaN; g.O[100] = NaN; g.H[100] = NaN; g.L[100] = NaN;
  fillForward(g);
  assert.equal(g.C[100], g.C[99]); assert.equal(g.V[100], 0);
});
test('calendar: every release is on a weekday, FOMC has decision + press conference', () => {
  const e = allEvents();
  assert.ok(e.every(x => { const d = new Date(`${x.date}T12:00:00Z`).getUTCDay(); return d >= 1 && d <= 5; }));
  assert.equal(e.filter(x => x.type === 'FOMC').length, e.filter(x => x.type === 'FOMC_PRESSER').length);
  assert.ok(e.filter(x => x.type === 'CPI').length >= 60 && e.filter(x => x.type === 'NFP').length >= 60);
});
