/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toOdds } from '../src/news/odds';

const mk = (over: any = {}) => ({ id: 1, title: 'Fed Decision in December?', slug: 'fed-dec', endDate: '2026-12-10T05:00:00Z', volume24hr: 1e6, tags: [{ slug: 'fed-rates' }],
  markets: [
    { active: true, closed: false, groupItemTitle: 'No change', outcomePrices: '["0.30","0.70"]', oneDayPriceChange: -0.05 },
    { active: true, closed: false, groupItemTitle: '25 bps increase', outcomePrices: '["0.65","0.35"]', oneDayPriceChange: 0.04 },
    { active: true, closed: false, groupItemTitle: '50+ bps increase', outcomePrices: '["0.04","0.96"]' },
    { active: false, closed: true, groupItemTitle: 'Old', outcomePrices: '["0.99","0.01"]' },
  ], ...over });

test('crowd odds: most likely outcomes first, closed markets dropped, region from tags', () => {
  const o = toOdds(mk(), 'fed-rates')!;
  assert.deepEqual(o.outcomes.map(x => x.label), ['25 bps increase', 'No change', '50+ bps increase']);
  assert.equal(o.outcomes[0].pct, 65); assert.equal(o.outcomes[0].change1d, 4);
  assert.equal(o.region, 'US');
  assert.equal(o.url, 'https://polymarket.com/event/fed-dec');
  assert.equal(toOdds(mk({ tags: [{ slug: 'india' }] }), 'economy')!.region, 'IN');
  assert.equal(toOdds(mk({ markets: [{ active: true, closed: false, question: 'Q?', outcomePrices: '["0.999","0.001"]' }] }), 'x'), null);   // decided
  assert.equal(toOdds(mk({ markets: [] }), 'x'), null);
});
