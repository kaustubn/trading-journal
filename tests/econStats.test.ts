/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, reaction, wilson, windowStats, reversalStats, sharedWith, nyToUtc, personalStats, minuteIndex, Release, Grid, MIN_N } from '../src/news/econStats';

// ---- small fake dataset
const rel = (date: string, actual: number, forecast: number | null, event: Release['event'] = 'CPI'): Release =>
  ({ event, date, time: event === 'FOMC' ? '14:00' : '08:30', period: date.slice(0, 7), actual, previous: null, revised: null, unit: '', forecast });

function grid(fn: (i: number) => number): Grid {
  const n = 510, O = new Float64Array(n), H = new Float64Array(n), L = new Float64Array(n), C = new Float64Array(n);
  for (let i = 0; i < n; i++) { const p = fn(i); O[i] = i ? fn(i - 1) : p; C[i] = p; H[i] = Math.max(O[i], p) + 1; L[i] = Math.min(O[i], p) - 1; }
  return { O, H, L, C };
}

test('surprise uses the pre-release forecast; z uses only EARLIER surprises (no look-ahead)', () => {
  const rs = [0.1, -0.1, 0.2, -0.2, 0.1, -0.1, 0.0, 0.2, -0.2].map((s, i) => rel(`2024-0${1 + Math.floor(i / 3)}-1${i % 3}`, 3 + s, 3));
  rs.push(rel('2024-06-12', 3.5, 3)); // big upside surprise
  const c = classify(rs);
  assert.equal(c[0].bucket, 'unknown');                // no history yet
  assert.equal(c[7].bucket, 'unknown');                // only 7 earlier surprises
  assert.notEqual(c[8].bucket, 'unknown');             // 8 earlier surprises: enough
  const last = c[c.length - 1];
  assert.ok(Math.abs(last.surprise! - 0.5) < 1e-9);
  assert.equal(last.bucket, 'above');
  // the big surprise must not change the z of earlier rows
  const without = classify(rs.slice(0, -1));
  assert.deepEqual(without.map(r => r.z), c.slice(0, -1).map(r => r.z));
});

test('no forecast -> unknown bucket; FOMC buckets by sign and is flagged less precise', () => {
  assert.equal(classify([rel('2024-01-10', 3, null)])[0].bucket, 'unknown');
  const f = classify([rel('2024-03-20', 0, 25, 'FOMC'), rel('2024-05-01', 0, 0, 'FOMC'), rel('2024-06-12', 25, 0, 'FOMC')]);
  assert.deepEqual(f.map(x => x.bucket), ['below', 'inline', 'above']);
  assert.ok(f.every(x => x.lessPrecise));
});

test('reaction windows: points, %, MFE/MAE, range, reversal', () => {
  const r = minuteIndex('08:30'); // 60
  // flat 100 before; +10 over the first 5 minutes; then falls to 90 by +60
  const g = grid(i => (i < r ? 100 : i < r + 5 ? 100 + (i - r + 1) * 2 : Math.max(90, 110 - (i - r - 4) * 0.4)));
  const x = reaction(g, r, 95, 10)!;
  assert.equal(x.p0, 100);
  assert.equal(x.windows.m1!.pts, 2);
  assert.equal(x.windows.m5!.pts, 10);
  assert.ok(Math.abs(x.windows.m5!.pct - 10) < 1e-9);
  assert.equal(x.windows.m5!.mfe, 11);       // high of the 5th minute = 110 + 1
  assert.ok(x.windows.m60!.pts < 0);
  assert.equal(x.reversal, true);
  assert.equal(x.windows.nextDay!.pts, -5);
  assert.ok(x.first15VsAvg! > 1);
  assert.equal(x.windows.pre15!.pts, 0);
});

test('Wilson interval and the n < 10 rule', () => {
  const w = wilson(7, 10)!;
  assert.ok(Math.abs(w.p - 0.7) < 1e-12 && w.lo > 0.39 && w.lo < 0.40 && w.hi > 0.89 && w.hi < 0.90);
  const few = windowStats(Array.from({ length: MIN_N - 1 }, () => ({ pts: 1, pct: 1, mfe: 1, mae: 0, range: 1 })));
  assert.equal(few.insufficient, true);
  assert.equal(few.up, null);
  const ok = windowStats(Array.from({ length: 12 }, (_, i) => ({ pts: i < 9 ? 5 : -5, pct: 0, mfe: 0, mae: 0, range: 10 })));
  assert.equal(ok.insufficient, false);
  assert.equal(ok.up!.p, 0.75);
  assert.equal(ok.medianPts, 5);
  assert.equal(reversalStats([null, null]).insufficient, true);
});

test('simultaneous releases are flagged (own events + Thursday jobless claims)', () => {
  const m = sharedWith([
    { event: 'PPI', date: '2024-03-14', time: '08:30' },    // Thursday
    { event: 'RETAIL', date: '2024-03-14', time: '08:30' },
    { event: 'NFP', date: '2024-03-08', time: '08:30' },    // Friday
  ]);
  assert.deepEqual(m.get('PPI 2024-03-14'), ['RETAIL', 'Jobless claims (weekly)']);
  assert.deepEqual(m.get('NFP 2024-03-08'), []);
});

test('New York -> UTC handles daylight saving', () => {
  assert.equal(nyToUtc('2024-01-11', '08:30').toISOString(), '2024-01-11T13:30:00.000Z'); // EST
  assert.equal(nyToUtc('2024-07-11', '08:30').toISOString(), '2024-07-11T12:30:00.000Z'); // EDT
  assert.equal(nyToUtc('2024-03-12', '08:30').toISOString(), '2024-03-12T12:30:00.000Z'); // 2 days after the March switch
  assert.equal(nyToUtc('2024-11-04', '14:00').toISOString(), '2024-11-04T19:00:00.000Z'); // day after the November switch
});

test('personal stats: event days vs normal days', () => {
  const tr = [...Array.from({ length: 12 }, (_, i) => ({ day: 'E', pnl: i < 3 ? 100 : -50, r: i < 3 ? 2 : -1 })),
    ...Array.from({ length: 12 }, () => ({ day: 'N', pnl: 20, r: 0.5 }))];
  const p = personalStats(tr, new Set(['E']));
  assert.equal(p.event.n, 12);
  assert.equal(p.event.winRate!.p, 0.25);
  assert.equal(p.event.pnl, 300 - 450);
  assert.equal(p.normal.avgR, 0.5);
});

import { ruleSummary, numbersOk, digest } from '../src/news/summary';
test('summary: rule-based bullets quote n, flag coin-flip results, and the number check blocks invented numbers', () => {
  const ws = (n: number, p: number, lo: number, hi: number) => ({ n, insufficient: false, up: { p, lo, hi }, medianPts: 12.34, meanPts: -3.21 });
  const study: any = {
    event: 'CPI', info: { name: 'CPI', measures: 'Monthly change in consumer prices.' }, counts: { used: 45, withForecast: 0 },
    buckets: { all: { n: 45, windows: { m5: ws(45, 0.6, 0.45, 0.73), m60: ws(45, 0.55, 0.4, 0.69), session: ws(45, 0.5, 0.36, 0.64) },
      reversal: { n: 45, insufficient: false, rate: { p: 0.18, lo: 0.09, hi: 0.31 } }, first15VsAvg: 4.2 } },
    rows: [{ date: '2021-06-10', m5: null, shared: [] }, { date: '2022-01-12', m5: 5, shared: [] }, { date: '2026-11-10', m5: -3, shared: [] }],
  };
  const b = ruleSummary(study);
  assert.ok(b.length >= 3 && b.length <= 5);
  assert.ok(b.some(x => /45 releases \(2022-01-12 to 2026-11-10\)/.test(x)));  // range of releases with NQ data only
  assert.ok(b.some(x => /NOT support: a reliable direction/.test(x)));
  assert.ok(numbersOk(b.join(' '), digest(study)));
  assert.equal(numbersOk('NQ rose 87% of the time (n 45)', digest(study)), false);
});
