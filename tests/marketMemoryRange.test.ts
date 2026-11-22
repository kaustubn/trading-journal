/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, dayMap, dayIdx, dayKind, oddsDays, candleOdds, _resetCaches } from '../src/patterns/marketMemory';
import type { Store } from '../src/patterns/timeScan';

/** 60 synthetic New York sessions: kind cycles up / down / range; 1-minute bars 9:30-16:00. */
function makeStore(): Store {
  const D = 60, N = D * 390;
  const s: Store = { m: new Int16Array(N), t: new Float64Array(N), o: new Float64Array(N), h: new Float64Array(N), l: new Float64Array(N), c: new Float64Array(N), v: new Float64Array(N), days: [], loadedAt: 12345 };
  for (let d = 0; d < D; d++) {
    const date = new Date(Date.UTC(2026, 0, 1) + d * 864e5).toISOString().slice(0, 10);
    s.days.push({ date, wd: d % 5, start: d * 390, n: 390 });
    const kind = d % 3; // 0 up, 1 down, 2 range
    let prev = 1000;
    for (let k = 0; k < 390; k++) {
      const i = d * 390 + k;
      const c = kind === 0 ? 1000 + k * 0.5 : kind === 1 ? 1000 - k * 0.5 : 1000 + 20 * Math.sin(k / 20);
      s.m[i] = 570 + k; s.t[i] = i * 60000; s.o[i] = prev; s.c[i] = c;
      s.h[i] = Math.max(prev, c) + 0.25; s.l[i] = Math.min(prev, c) - 0.25; s.v[i] = 100;
      // plant a hammer at 9:35 (the 5m candle 9:35-9:40) on every range day: long lower wick
      if (kind === 2 && k >= 5 && k < 10) { s.l[i] = Math.min(s.l[i], c - 15); }
      prev = c;
    }
  }
  return s;
}

test('day indexes for a date range, and too-small ranges are refused', () => {
  _resetCaches();
  const g = buildGrid(makeStore());
  assert.deepEqual(dayIdx(g), [20, 60]);
  const [a, b] = dayIdx(g, g.dates[30], g.dates[49]);
  assert.equal(b - a, 20);
  assert.throws(() => dayIdx(g, g.dates[30], g.dates[33]), /Fewer than 10 days/);
});

test('day kinds and the up / down / range table', () => {
  _resetCaches();
  const g = buildGrid(makeStore());
  assert.equal(dayKind(g, 21), 'up');      // 21 % 3 = 0
  assert.equal(dayKind(g, 22), 'down');
  assert.equal(dayKind(g, 23), 'range');
  const r = dayMap(g, { wd: -1, gap: 'all', dayType: 'up', unit: 'pts' });
  assert.ok(r.days > 0 && r.days < 40);
  const up = r.regimes.find((x: any) => x.kind === 'up')!, down = r.regimes.find((x: any) => x.kind === 'down')!;
  assert.ok(up.avgMove > 150 && down.avgMove < -150, 'trend days move ~195 pts');
  assert.ok(up.avgAgainst < 5, 'up days barely went below the open');
  assert.equal(up.medianHigh, '15:59');
  // size: whole-session range ~195 on trend days, candle ranges grow with the timeframe
  assert.ok(r.size.avg > 150);
  const tf = r.size.byTf.map((x: any) => x.avgRange);
  for (let i = 1; i < tf.length; i++) assert.ok(tf[i] > tf[i - 1]);
  assert.equal(r.size.windows[r.size.windows.length - 1].label, 'Whole session');
  // date range reaches the server filter
  const r2 = dayMap(g, { wd: -1, gap: 'all', dayType: 'all', unit: 'pts', from: g.dates[40], to: g.dates[59] });
  assert.equal(r2.days, 20);
});

test('candle odds date range and the days behind one row', () => {
  _resetCaches();
  const g = buildGrid(makeStore());
  const o = candleOdds(g, { tf: 5, from: '9:30', to: '10:30', dateFrom: g.dates[30] });
  assert.equal(o.days, 30); assert.equal(o.from, g.dates[30]);
  const d = oddsDays(g, { tf: 5, from: '9:30', to: '10:30', type: 'hammer', dateFrom: g.dates[30] });
  assert.equal(d.daysTested, 30);
  assert.ok(d.days.length >= 9, 'the planted hammer on every range day is found');
  assert.ok(d.days.every((x: any) => x.times.includes('9:35')));
  assert.equal(d.days[0].date > d.days[d.days.length - 1].date, true);   // newest first
  assert.ok(d.merge.bySlot.find((x: any) => x.time === '9:30'));
  assert.throws(() => oddsDays(g, { tf: 5, from: '9:30', to: '10:30', type: 'nope' }), /Unknown candle type/);
});
