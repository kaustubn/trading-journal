/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachFindings, CTrade } from '../src/services/coachRules';

const T = (id: number, day: string, hhmm: string, pnl: number, qty = 1, minutes = 10, tags: string[] = []): CTrade => {
  const entry = Date.parse(`${day}T${hhmm}:00Z`);
  return { id, day, entry, exit: entry + minutes * 60000, pnl, qty, tags };
};

test('finds size-up after a loss, revenge entries, past-limit trades, tagged rule breaks; ranks by cost', () => {
  const tr = [
    T(1, '2026-11-02', '14:00', -300),
    T(2, '2026-11-02', '14:12', -500, 2),            // 2 min after the loss closed, bigger size
    T(3, '2026-11-02', '15:00', -200),               // day already at -800 with a 600 limit
    T(4, '2026-11-03', '14:00', 400, 1, 10, ['Rule break']),
    T(5, '2026-11-04', '14:00', 100),
  ];
  const f = coachFindings(tr, { dailyLossLimit: 600, blackout: null, releasesUtc: [] });
  const by = Object.fromEntries(f.map(x => [x.key, x]));
  assert.deepEqual(by.size.tradeIds, [2]);
  assert.deepEqual(by.revenge.tradeIds, [2]);
  assert.deepEqual(by.limit.tradeIds, [3]);
  assert.deepEqual(by.tagged.tradeIds, [4]);
  assert.equal(f[0].pnl <= f[f.length - 1].pnl, true);          // most costly first
  assert.ok(Math.abs(by.size.lossShare! - 500 / 1000) < 1e-9);  // 500 of 1000 total losses
  assert.equal(by.size.smallSample, true);
});

test('news blackout and overtrading', () => {
  const rel = Date.parse('2026-11-10T13:30:00Z');
  const tr = [T(1, '2026-11-10', '13:25', -100), T(2, '2026-11-10', '13:50', 50)];
  const f = coachFindings(tr, { dailyLossLimit: null, blackout: { before: 10, after: 10 }, releasesUtc: [rel] });
  assert.deepEqual(f.find(x => x.key === 'news')!.tradeIds, [1]);
  const many = Array.from({ length: 8 }, (_, i) => T(i + 1, '2026-11-11', `1${i}:00`, -10));
  const g = coachFindings([...many, T(20, '2026-11-12', '14:00', 5)], { dailyLossLimit: null, blackout: null, releasesUtc: [] });
  assert.equal(g.find(x => x.key === 'over')!.n, 8 - 3); // usual = 1 per day (median of [1, 8]) -> trades 4+ count
  assert.deepEqual(coachFindings([], { dailyLossLimit: null, blackout: null, releasesUtc: [] }), []);
});
