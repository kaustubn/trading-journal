/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucket, readEvent, combineEvents, Bar } from '../src/shared/newsConcepts';

const MIN = 60000;
const T0 = Date.UTC(2026, 0, 13, 13, 30); // 8:30 ET release
/** 1m bars from -30 to +59 min: flat 100 before, then a path given as closes per minute after the release. */
function makeBars(after: number[], pre = 100, preWiggle = 1): Bar[] {
  const out: Bar[] = [];
  for (let m = -30; m < 0; m++) out.push([T0 + m * MIN, pre, pre + preWiggle, pre - preWiggle, pre, 100]);
  let prev = pre;
  after.forEach((c, i) => { out.push([T0 + i * MIN, prev, Math.max(prev, c) + 0.25, Math.min(prev, c) - 0.25, c, 1000]); prev = c; });
  return out;
}

test('bucket aligns candles to the release minute', () => {
  const b = makeBars(Array.from({ length: 60 }, (_, i) => 100 + i));
  const c5 = bucket(b, 5, T0);
  assert.equal(c5.find(x => x[0] === T0)?.[1], 100);          // the 5m candle starting at the release opens at 100
  assert.equal(c5.find(x => x[0] === T0)?.[4], 104);          // and closes at minute 4
  assert.equal(c5.filter(x => x[0] >= T0).length, 12);
  assert.equal(c5.filter(x => x[0] < T0).length, 6);
});

test('breakout up with follow-through, buy-side taken without reversal, trend hour', () => {
  const r = readEvent(makeBars(Array.from({ length: 60 }, (_, i) => 102 + i)), T0, 1);
  assert.equal(r.breakout?.dir, 1);
  assert.equal(r.breakout?.follow, true);
  assert.equal(r.breakout?.failedAt, null);
  assert.equal(r.sweeps.find(s => s.side === 'buy')?.reversed, false);
  assert.equal(r.after60?.kind, 'trend up');
  assert.ok(r.text.pa.length && r.text.ict.length && r.text.smc.length);
});

test('stop run: buy-side swept then reversed, failed breakout', () => {
  // spike to 106, then straight back down to 90
  const path = [106, 104, 100, ...Array.from({ length: 57 }, (_, i) => 99 - i * 0.2)];
  const r = readEvent(makeBars(path), T0, 1);
  const buy = r.sweeps.find(s => s.side === 'buy');
  assert.ok(buy && buy.reversed, 'buy-side sweep with reversal');
  assert.ok(r.breakout && r.breakout.dir === 1 && r.breakout.failedAt !== null, 'failed upside breakout');
});

test('fair value gap is found and marked filled', () => {
  // 3 candles: 100 -> gap up (candle 2 jumps), candle 3 above candle 1 high, later back down through it
  const path = [100, 110, 112, 113, 105, 99, ...Array.from({ length: 54 }, () => 99)];
  const r = readEvent(makeBars(path, 100, 0.25), T0, 1);
  const z = r.fvgs.find(f => f.dir === 1);
  assert.ok(z, 'bullish FVG');
  assert.ok(z!.filledAt !== null, 'filled later');
});

test('combine: careful window at the release and first-move continuation', () => {
  const evs = Array.from({ length: 12 }, (_, k) => {
    const dir = k % 3 === 0 ? -1 : 1;
    const bars = makeBars(Array.from({ length: 60 }, (_, i) => 100 + dir * (i < 3 ? (i + 1) * 8 : 24 + i * 0.1)));
    return { anchor: T0, date: `2026-01-${String(k + 1).padStart(2, '0')}`, label: k % 2 ? 'CPI m/m' : 'Non-Farm Employment Change', bars };
  });
  const c = combineEvents(evs);
  assert.equal(c.n, 12);
  assert.ok(c.careful.length >= 1 && c.careful[0].from <= 0, 'big candles right after the release are flagged');
  assert.equal(c.firstCandle['5m'].at60, 1);                 // every event kept going
  assert.ok(c.say.length >= 2);
  assert.equal(c.byTitle.length, 2);
});
