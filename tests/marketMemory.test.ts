/// <reference types="node" />
// Market Memory engine: must find a pattern that is really there, and must NOT invent one in pure noise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, dayMap, analog, candleStats, classify, _resetCaches } from '../src/patterns/marketMemory';
import type { Store } from '../src/patterns/timeScan';

function rng(seed: number) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

/** D sessions of 390 1-minute bars. mover(day, minute, rnd) returns the close-to-close change. */
function makeStore(D: number, mover: (d: number, k: number, r: () => number) => number, seed = 1): Store {
  const r = rng(seed), n = D * 390;
  const s: Store = { m: new Int16Array(n), t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n), days: [], loadedAt: seed * 1000 + D };
  let px = 20000, i = 0;
  const day0 = Date.UTC(2021, 0, 4);
  for (let d = 0; d < D; d++) {
    const date = new Date(day0 + Math.floor(d / 5) * 7 * 86400000 + (d % 5) * 86400000).toISOString().slice(0, 10);
    s.days.push({ date, wd: d % 5, start: i, n: 390 });
    for (let k = 0; k < 390; k++, i++) {
      const o = px, c = px + mover(d, k, r);
      s.m[i] = 570 + k; s.t[i] = day0 + d * 86400000 + k * 60000;
      s.o[i] = o; s.c[i] = c; s.h[i] = Math.max(o, c) + r() * 2; s.l[i] = Math.min(o, c) - r() * 2; s.v[i] = 100 + Math.floor(r() * 50);
      px = c;
    }
  }
  return s;
}
const noise = (_d: number, _k: number, r: () => number) => (r() - 0.5) * 4;
// planted: on even days 9:30-10:30 drifts down then 10:30-11:00 rallies; odd days the mirror image
const planted = (d: number, k: number, r: () => number) => {
  const sgn = d % 2 === 0 ? 1 : -1;
  const base = (r() - 0.5) * 2;
  if (k >= 30 && k < 60) return base - sgn * 0.8;
  if (k >= 60 && k < 90) return base + sgn * 1.5;
  return base;
};

test('dayMap: a steady +1 pt per minute day gives an average path of +1 pt per minute and repeats perfectly', () => {
  _resetCaches();
  const g = buildGrid(makeStore(60, () => 1));
  const r = dayMap(g, { wd: -1, gap: 'all', dayType: 'all', unit: 'pts' });
  assert.equal(r.days, 40); // first 20 days are warm-up for the 20-day range
  assert.equal(r.mean[0], 1);
  assert.equal(r.mean[r.mean.length - 1], 390);
  assert.ok(r.repeatScore > 0.99);
  assert.equal(r.hodByQuarterHour[25], 1); // the high always prints in the last quarter hour
});
test('dayMap: weekday filter only keeps that weekday', () => {
  _resetCaches();
  const g = buildGrid(makeStore(100, noise));
  assert.equal(dayMap(g, { wd: 2, gap: 'all', dayType: 'all', unit: 'pts' }).days, 16);
});

test('analog: finds a planted repeating move and its walk-forward score says it is real', () => {
  _resetCaches();
  const g = buildGrid(makeStore(300, planted, 3));
  const day = g.dates[250]; // an even day: down drift into 10:30 then a rally
  const r = analog(g, { date: day, time: '10:30', lookback: 30, ahead: 30, k: 30, tol: 5 });
  assert.ok(r.next.up >= 0.8, `up ${r.next.up}`);
  assert.ok(r.next.mean > 10, `mean ${r.next.mean}`);
  assert.ok(r.matches.every(m => m.date < day), 'memory must only use earlier days');
  assert.ok(r.accuracy.trades >= 30);
  assert.ok(r.accuracy.winRate > 0.8, `win ${r.accuracy.winRate}`);
  assert.ok(r.accuracy.tStat >= 3, `t ${r.accuracy.tStat}`);
  assert.match(r.accuracy.verdict, /Looks real/);
});
test('analog: in pure noise it does NOT claim an edge', () => {
  _resetCaches();
  const g = buildGrid(makeStore(300, noise, 11));
  const r = analog(g, { date: g.dates[280], time: '11:00', lookback: 60, ahead: 30, k: 30, tol: 5 });
  assert.doesNotMatch(r.accuracy.verdict, /Looks real/);
  assert.ok(Math.abs(r.accuracy.tStat) < 3, `t ${r.accuracy.tStat}`);
});
test('analog: bad inputs give clear errors', () => {
  _resetCaches();
  const g = buildGrid(makeStore(80, noise));
  assert.throws(() => analog(g, { date: '1999-01-01', time: '10:30', lookback: 30, ahead: 30, k: 20, tol: 5 }), /No New York session/);
  assert.throws(() => analog(g, { date: g.dates[70], time: '9:40', lookback: 30, ahead: 30, k: 20, tol: 5 }), /time must be between/);
  assert.throws(() => analog(g, { date: g.dates[5], time: '10:30', lookback: 30, ahead: 30, k: 20, tol: 5 }), /later date/);
});

test('classify: textbook candles', () => {
  // o, h, l, c
  const k = (rows: number[][]) => [rows.map(x => x[0]), rows.map(x => x[1]), rows.map(x => x[2]), rows.map(x => x[3])] as const;
  let [o, h, l, c] = k([[10, 10.5, 9, 9.2], [9, 11, 8.9, 10.8]]);
  assert.ok(classify([...o], [...h], [...l], [...c], 1, 1).includes('bullEngulf'));
  [o, h, l, c] = k([[10, 10.1, 7, 10]]);
  assert.ok(classify([...o], [...h], [...l], [...c], 0, 1).includes('hammer'));
  assert.ok(classify([...o], [...h], [...l], [...c], 0, 1).includes('doji'));
  [o, h, l, c] = k([[10, 12, 8, 11], [10.5, 11, 9, 10.6]]);
  assert.ok(classify([...o], [...h], [...l], [...c], 1, 1).includes('inside'));
  [o, h, l, c] = k([[10, 14.5, 9.9, 14.2]]);
  assert.ok(classify([...o], [...h], [...l], [...c], 0, 1).includes('bigBull'));
});
test('candleStats: in pure noise, "repeating" cells are about what the luck baseline gives', () => {
  _resetCaches();
  const g = buildGrid(makeStore(260, noise, 5));
  const r = candleStats(g, { tf: 5, next: 3 });
  assert.ok(r.slotsTested > 50);
  assert.ok(r.repeating <= Math.max(6, r.luckRepeating * 3 + 3), `found ${r.repeating} vs luck ${r.luckRepeating}`);
});
test('candleStats: finds a planted "big green candle at 10:00 keeps going" pattern', () => {
  _resetCaches();
  const mover = (d: number, k: number, r: () => number) => {
    if (k >= 30 && k < 35) return d % 2 === 0 ? 3 : -3;          // 10:00-10:05: big candle (green on even days)
    if (k >= 35 && k < 50) return (d % 2 === 0 ? 1.2 : -1.2) + (r() - 0.5) * 2; // then it keeps going the same way
    return (r() - 0.5) * 2;
  };
  const g = buildGrid(makeStore(260, mover, 9));
  const r = candleStats(g, { tf: 5, next: 3 });
  const big = r.types.find(t => t.key === 'bigBull')!;
  const at10 = big.slots.find(s => s.time === '10:00')!;
  assert.equal(at10.repeats, 1, JSON.stringify(at10));
  assert.ok(r.repeating > r.luckRepeating);
});
