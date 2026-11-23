/// <reference types="node" />
// Pure logic of the chart-pattern and candle-pattern indicators (client/src/chart).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pivots, findPatterns, sanitizeCpat, CPAT_DEFAULT, PAT_TYPES } from '../src/shared/chartPatterns';
import { toTf, findCandles, sanitizeCndl, CNDL_DEFAULT } from '../src/shared/candlePatterns';

type Bar = { timestamp: number; open: number; high: number; low: number; close: number; volume: number };
const T0 = Date.UTC(2026, 0, 5, 14, 30);
const bar = (i: number, o: number, h: number, l: number, c: number, tf = 1): Bar => ({ timestamp: T0 + i * tf * 60000, open: o, high: h, low: l, close: c, volume: 1 });

/** Bars that walk through the given price waypoints in straight lines (small, even candles). */
function path(points: number[], stepsPer = 10): Bar[] {
  const out: Bar[] = [];
  let prev = points[0];
  for (let k = 1; k < points.length; k++) {
    for (let s = 1; s <= stepsPer; s++) {
      const p = points[k - 1] + ((points[k] - points[k - 1]) * s) / stepsPer;
      out.push(bar(out.length, prev, Math.max(prev, p) + 0.5, Math.min(prev, p) - 0.5, p));
      prev = p;
    }
  }
  return out;
}

test('pivots: zigzag alternates H / L and is confirmed only after the swing point', () => {
  const d = path([100, 140, 110, 150, 105, 145, 100]);
  const pv = pivots(d as any, 1.5);
  assert.ok(pv.length >= 4, `got ${pv.length} pivots`);
  for (let i = 1; i < pv.length; i++) assert.notEqual(pv[i].kind, pv[i - 1].kind);
  for (const p of pv) assert.ok(p.conf > p.i, 'confirmed after the pivot bar (no look-ahead)');
  const hi = pv.filter(p => p.kind === 'H').map(p => Math.round(p.p));
  assert.ok(hi.includes(140) || hi.includes(141), `highs ${hi}`);
});

test('findPatterns: clean double top is found, scored high, and respects the similarity cut', () => {
  // up, top, pullback, equal top, then the drop that confirms the second top
  const d = path([100, 150, 125, 150, 100, 110], 12);
  const all = findPatterns(d as any, sanitizeCpat({ ...CPAT_DEFAULT, minSim: 50 }));
  const dt = all.filter(f => f.type === 'dt');
  assert.ok(dt.length >= 1, `types found: ${all.map(f => f.type + ':' + f.score.toFixed(2)).join(' ')}`);
  assert.ok(dt[0].score >= 0.75, `score ${dt[0].score}`);
  // only double-bottom enabled -> no double top
  const none = findPatterns(d as any, sanitizeCpat({ ...CPAT_DEFAULT, minSim: 50, types: Object.fromEntries(PAT_TYPES.map(t => [t, t === 'db'])) as any }));
  assert.equal(none.filter(f => f.type === 'dt').length, 0);
  // found patterns never overlap
  const s = [...all].sort((a, b) => a.pts[0].i - b.pts[0].i);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].pts[0].i >= s[i - 1].pts[s[i - 1].pts.length - 1].i);
});

test('findPatterns: lopsided tops score lower than equal tops', () => {
  const eq = findPatterns(path([100, 150, 125, 150, 100, 110], 12) as any, sanitizeCpat({ ...CPAT_DEFAULT, minSim: 50 })).find(f => f.type === 'dt');
  const lop = findPatterns(path([100, 150, 125, 141, 100, 110], 12) as any, sanitizeCpat({ ...CPAT_DEFAULT, minSim: 50 })).find(f => f.type === 'dt');
  assert.ok(eq);
  if (lop) assert.ok(lop.score < eq!.score, `${lop.score} vs ${eq!.score}`);
});

test('sanitize: bad values fall back to defaults; candle types never empty', () => {
  const c = sanitizeCpat({ minSim: 20, sens: 'x', lookback: 5, types: { dt: false, zz: true } });
  assert.equal(c.minSim, 75); assert.equal(c.sens, 1.5); assert.equal(c.lookback, 1500); assert.equal(c.types.dt, false);
  const k = sanitizeCndl({ run: 9, tf: -3, types: {} });
  assert.equal(k.run, 1); assert.equal(k.tf, 0); assert.deepEqual(k.types, CNDL_DEFAULT.types);
  assert.equal(sanitizeCndl({ runMode: 'any' }).runMode, 'any');
});

test('toTf: clock-aligned 5m candles from 1m bars; unfinished last candle dropped', () => {
  const d: Bar[] = [];
  for (let i = 0; i < 12; i++) d.push(bar(i, 100 + i, 101 + i, 99 + i, 100.5 + i));
  const now = d[11].timestamp + 30000;                       // bar 11 still forming
  const c = toTf(d as any, 1, 5, now);
  assert.equal(c.length, 2);                                 // 0-4, 5-9 complete; 10-11 dropped
  assert.equal(c[0].o, 100); assert.equal(c[0].c, 104.5); assert.equal(c[0].h, 105); assert.equal(c[0].l, 99); assert.equal(c[0].last, 4);
  // Replay: data stops mid-candle even though "now" is far later -> still dropped
  assert.equal(toTf(d as any, 1, 5, now + 86400000).length, 2);
  // chart timeframe (tf 0) with a finished last bar keeps every bar
  assert.equal(toTf(d as any, 1, 0, d[11].timestamp + 60000).length, 12);
});

test('findCandles: 2 bullish engulfing in a row (same mode) marks only where the streak reaches 2', () => {
  const d: Bar[] = [
    bar(0, 105, 106, 99, 100),     // red
    bar(1, 99, 107, 98, 106),      // bull engulf
    bar(2, 106, 107, 103, 104),    // small red
    bar(3, 103.5, 109, 103, 108),  // bull engulf
    bar(4, 108, 108.5, 105, 106),  // red
    bar(5, 105.5, 111, 105, 110),  // bull engulf -> streak? no: bar 4 is not engulfing
  ];
  const c = toTf(d as any, 1, 0, d[5].timestamp + 60000);
  const single = findCandles(c as any, sanitizeCndl({ types: { bullEngulf: true }, run: 1 }));
  assert.deepEqual(single.map((h: any) => h.k), [1, 3, 5]);
  const two = findCandles(c as any, sanitizeCndl({ types: { bullEngulf: true }, run: 2 }));
  assert.equal(two.length, 0, 'engulfings separated by red candles are not "in a row"');
  // classic rule needs a red candle before: 1, 3, 5 all follow a red candle
  assert.deepEqual(findCandles(c as any, sanitizeCndl({ types: { bullEngulf: true }, engulf: 'classic' })).map((h: any) => h.k), [1, 3, 5]);
  // back-to-back engulfings
  const e: Bar[] = [bar(0, 105, 106, 99, 100), bar(1, 99, 107, 98, 106), bar(2, 98.5, 112, 98, 111), bar(3, 98, 117, 97.5, 116)];
  const ce = toTf(e as any, 1, 0, e[3].timestamp + 60000);
  const two2 = findCandles(ce as any, sanitizeCndl({ types: { bullEngulf: true }, run: 2 }));
  assert.deepEqual(two2.map((h: any) => h.k), [2], 'marked once where the run first reaches 2');
  // a third one extends the streak: not marked again
  const e3 = [...e, bar(4, 97.5, 124, 97, 123)];
  const c3 = toTf(e3 as any, 1, 0, e3[4].timestamp + 60000);
  assert.deepEqual(findCandles(c3 as any, sanitizeCndl({ types: { bullEngulf: true }, run: 2 })).map((h: any) => h.k), [2]);
  // classic rule: green-after-green is not engulfing, so no run of 2
  assert.equal(findCandles(ce as any, sanitizeCndl({ types: { bullEngulf: true }, run: 2, engulf: 'classic' })).length, 0);
});

test('findCandles: "closes past previous high" rule catches back-to-back strong candles', () => {
  // each green candle opens at the previous close and closes above the previous high
  const d: Bar[] = [bar(0, 105, 106, 99, 100), bar(1, 100, 107, 99.5, 106.5), bar(2, 106.5, 113, 106, 112), bar(3, 112, 118, 111.5, 117)];
  const c = toTf(d as any, 1, 0, d[3].timestamp + 60000);
  assert.equal(findCandles(c as any, sanitizeCndl({ types: { bullEngulf: true }, run: 2, engulf: 'body' })).length, 0);
  assert.deepEqual(findCandles(c as any, sanitizeCndl({ types: { bullEngulf: true }, run: 2, engulf: 'close' })).map((h: any) => h.k), [2]);
  // 'any' mode: a streak of 3 qualifying candles with run 2 is marked once
  assert.deepEqual(findCandles(c as any, sanitizeCndl({ types: { bullEngulf: true }, run: 2, runMode: 'any', engulf: 'close' })).map((h: any) => h.k), [2]);
});

test('findCandles on a higher timeframe marks the chart bar that closes the candle', () => {
  const d: Bar[] = [];
  // 5m candle 1 red (105 -> 100), 5m candle 2 green 99 -> 107 (engulfs), built from 1m bars
  const seq = [[105, 104], [104, 103], [103, 102], [102, 101], [101, 100], [99, 101], [101, 103], [103, 104], [104, 106], [106, 107]];
  seq.forEach(([o, cl], i) => d.push(bar(i, o, Math.max(o, cl) + 0.2, Math.min(o, cl) - 0.2, cl)));
  const c = toTf(d as any, 1, 5, d[9].timestamp + 60000);
  assert.equal(c.length, 2);
  const h = findCandles(c as any, sanitizeCndl({ types: { bullEngulf: true } }));
  assert.equal(h.length, 1); assert.equal(h[0].last, 9);
});
