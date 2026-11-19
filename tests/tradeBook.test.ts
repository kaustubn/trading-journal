/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCtx, replayTrade, propGate, summarize, COST_PTS } from '../src/patterns/tradeBook';
import type { Store } from '../src/patterns/timeScan';

let seq = 1;
/** D sessions of 390 1m bars; bar(d, k) returns [o, h, l, c]. */
function store(D: number, bar: (d: number, k: number) => [number, number, number, number]): Store {
  const n = D * 390;
  const s: Store = { m: new Int16Array(n), t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n), days: [], loadedAt: seq++ };
  let i = 0;
  const day0 = Date.UTC(2024, 0, 1);
  for (let d = 0; d < D; d++) {
    const date = new Date(day0 + Math.floor(d / 5) * 7 * 86400000 + (d % 5) * 86400000).toISOString().slice(0, 10);
    s.days.push({ date, wd: d % 5, start: i, n: 390 });
    for (let k = 0; k < 390; k++, i++) { const [o, h, l, c] = bar(d, k); s.m[i] = 570 + k; s.o[i] = o; s.h[i] = h; s.l[i] = l; s.c[i] = c; s.v[i] = 100; s.t[i] = day0 + d * 86400000 + k * 60000; }
  }
  return s;
}
const flat = (p: number) => [p, p + 1, p - 1, p] as [number, number, number, number];

test('replay: long hits target -> +targetR minus costs, exit at the target price and time', () => {
  // flat at 100 until 10:00 (k=30), then +2 pt per minute
  const s = store(30, (_d, k) => (k < 30 ? flat(100) : [100 + (k - 30) * 2, 100 + (k - 29) * 2, 100 + (k - 30) * 2 - 0.5, 100 + (k - 29) * 2]));
  const t = replayTrade(s, buildCtx(s), { date: s.days[25].date, entryMin: 30, dir: 1, stopPts: 10, targetR: 2, holdMin: 120 })!;
  assert.equal(t.exit.reason, 'target');
  assert.equal(t.grossR, 2);
  assert.equal(t.netR, Math.round((2 - COST_PTS / 10) * 1000) / 1000);
  assert.equal(t.exit.price, 120);
  assert.equal(t.entry.time, '10:00');
  assert.equal(t.exit.time, '10:09'); // high of the 10:09 bar reaches 120
  assert.ok(t.management.some(m => /\+1R reached/.test(m.event)));
});
test('replay: a bar touching both stop and target counts as the stop (worst case)', () => {
  const s = store(30, (_d, k) => (k === 31 ? [100, 130, 85, 100] : flat(100)));
  const t = replayTrade(s, buildCtx(s), { date: s.days[25].date, entryMin: 31, dir: 1, stopPts: 10, targetR: 2, holdMin: 120 })!;
  assert.equal(t.exit.reason, 'stop');
  assert.equal(t.grossR, -1);
  assert.equal(t.exit.price, 90);
});
test('replay: short, nothing hit -> out after the hold time at the last close', () => {
  const s = store(30, (_d, k) => flat(100 - (k >= 60 ? 3 : 0)));
  const t = replayTrade(s, buildCtx(s), { date: s.days[25].date, entryMin: 50, dir: -1, stopPts: 10, targetR: 3, holdMin: 30 })!;
  assert.equal(t.exit.reason, 'time');
  assert.equal(t.grossR, 0.3);   // 3 pt in favour / 10 pt stop
  assert.equal(t.exit.time, '10:49');
  assert.equal(t.minutesHeld, 30);
});
test('replay: matches the backtest R when given, flags a mismatch', () => {
  const s = store(30, () => flat(100));
  const c = buildCtx(s);
  const a = replayTrade(s, c, { date: s.days[25].date, entryMin: 60, dir: 1, stopPts: 10, targetR: 2, holdMin: 10, refR: -COST_PTS / 10 })!;
  assert.equal(a.matches, true);
  const b = replayTrade(s, c, { date: s.days[25].date, entryMin: 60, dir: 1, stopPts: 10, targetR: 2, holdMin: 10, refR: 1.5 })!;
  assert.equal(b.matches, false);
});
test('confluence: steady uptrend -> 5m / 15m / 1h / daily trends up and agree with a long; no look-ahead', () => {
  const up = (d: number, k: number) => { const p = 1000 + d * 50 + k * 0.1; return [p, p + 0.2, p - 0.2, p + 0.1] as [number, number, number, number]; };
  const s1 = store(40, up);
  const t1 = replayTrade(s1, buildCtx(s1), { date: s1.days[35].date, entryMin: 200, dir: 1, stopPts: 20, targetR: 1, holdMin: 60 })!;
  for (const tf of ['5m', '15m', '1h', 'Daily']) assert.equal(t1.confluence.timeframes.find(x => x.tf === tf)!.trend, 'up', tf);
  assert.equal(t1.confluence.vwap.side, 'above');
  assert.equal(t1.confluence.score, t1.confluence.of);
  // crash AFTER the entry: confluence must not change
  const s2 = store(40, (d, k) => (d === 35 && k >= 201 ? [500, 501, 499, 500] : up(d, k)));
  const t2 = replayTrade(s2, buildCtx(s2), { date: s2.days[35].date, entryMin: 200, dir: 1, stopPts: 20, targetR: 1, holdMin: 60 })!;
  assert.deepEqual(t2.confluence, t1.confluence);
  assert.equal(t2.exit.reason, 'stop');
});
test('replay: unknown day or minute outside the session -> null', () => {
  const s = store(25, () => flat(100));
  const c = buildCtx(s);
  assert.equal(replayTrade(s, c, { date: '1999-01-01', entryMin: 30, dir: 1, stopPts: 5, targetR: 1, holdMin: 30 }), null);
  assert.equal(replayTrade(s, c, { date: s.days[20].date, entryMin: 389, dir: 1, stopPts: 5, targetR: 1, holdMin: 30 }), null);
});
test('propGate: all five checks must pass', () => {
  const good = { n: 120, tStat: 3.4, hold: { n: 30, avgR: 0.1 }, val: { avgR: 0.12 }, maxDdR: -4.2, maxLosingStreak: 5, perDay: 0.3 };
  assert.equal(propGate(good).propReady, true);
  assert.equal(propGate({ ...good, tStat: 2.5 }).propReady, false);
  assert.equal(propGate({ ...good, maxDdR: -9 }).propReady, false);
  assert.equal(propGate({ ...good, hold: { n: 10, avgR: 0.5 } }).propReady, false);
});
test('summarize: win rate, exit reasons, factor split', () => {
  const s = store(30, (_d, k) => (k < 30 ? flat(100) : [100 + (k - 30) * 2, 100 + (k - 29) * 2, 100 + (k - 30) * 2 - 0.5, 100 + (k - 29) * 2]));
  const c = buildCtx(s);
  const ds = [replayTrade(s, c, { date: s.days[25].date, entryMin: 30, dir: 1, stopPts: 10, targetR: 2, holdMin: 120 })!,
    replayTrade(s, c, { date: s.days[26].date, entryMin: 30, dir: -1, stopPts: 10, targetR: 2, holdMin: 120 })!];
  const sm = summarize(ds);
  assert.equal(sm.winRate, 0.5);
  assert.deepEqual(sm.exitReasons, { target: 1, stop: 1 });
  assert.ok(sm.factors.length >= 8);
});
