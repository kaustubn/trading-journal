/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortTitle, groupNews, asOf, outlook, ChartNews } from '../src/shared/chartNews';

const cpi = { title: 'CPI m/m', n: 100, absMed1: 20, absMed15: 40, absMed60: 60, absPct15: 0.2, up15: 45,
  buckets: { above: { n: 30, up15: 30, med15: -10, held60: 70 }, below: { n: 25, up15: 72, med15: 12, held60: 60 } } };
const ev = (over: Partial<ChartNews>): ChartNews => ({ utc: '2026-12-10T13:30:00.000Z', title: 'CPI m/m', impact: 'high', actual: null, forecast: '0.3%',
  previous: '0.2%', surprise: null, kind: 'data', nq: cpi, ...over });

test('short labels', () => {
  assert.equal(shortTitle('Core CPI m/m'), 'Core CPI');
  assert.equal(shortTitle('CPI (inflation)'), 'CPI');
  assert.equal(shortTitle('Non-Farm Employment Change'), 'NFP');
  assert.equal(shortTitle('Fed rate decision (FOMC) + projections'), 'FOMC');
  assert.equal(shortTitle('NVDA earnings (after the close)'), 'NVDA earn.');
  assert.equal(shortTitle('Average Hourly Earnings m/m'), 'Wages');
  assert.equal(shortTitle('Some very long unknown release name'), 'Some very lon…');
});

test('grouping: one line per release minute, biggest mover named first', () => {
  const g = groupNews([ev({ title: 'Core CPI m/m', nq: { ...cpi, n: 20 } }), ev({}), ev({ utc: '2026-12-11T13:30:00.000Z', title: 'Unemployment Claims', impact: 'medium', nq: null })]);
  assert.equal(g.length, 2);
  assert.equal(g[0].label, 'CPI +1');
  assert.equal(g[0].main.title, 'CPI m/m');
  assert.equal(g[1].impact, 'medium');
});

test('replay: releases after the cursor hide their actual and surprise', () => {
  const e = ev({ actual: '0.5%', surprise: 'above' });
  assert.equal(asOf(e, Date.parse('2026-12-10T13:29:00Z')).actual, null);
  assert.equal(asOf(e, Date.parse('2026-12-10T13:29:00Z')).surprise, null);
  assert.equal(asOf(e, Date.parse('2026-12-10T13:31:00Z')).actual, '0.5%');
  assert.equal(asOf(e, null).surprise, 'above');
});

test('outlook: scenarios before the release, the matching history after it', () => {
  const before = outlook(ev({}), 20000);
  assert.equal(before.bias, 'none');                                   // 45% up = coin flip
  assert.ok(before.lines[0].includes('40 pts'));                       // 0.2% of 20,000
  assert.ok(before.lines.some(l => l.startsWith('If above forecast: higher 30% of 30')));
  assert.ok(before.lines.some(l => l.startsWith('If below forecast: higher 72% of 25')));
  const hot = outlook(ev({ actual: '0.5%', surprise: 'above' }), null);
  assert.equal(hot.bias, 'down'); assert.equal(hot.upPct, 30);
  assert.ok(hot.lines[0].startsWith('Came in above forecast (0.5% vs 0.3%)'));
  assert.ok(hot.lines[1].includes('40 pts'));                          // no price: stored points
  assert.equal(outlook(ev({ nq: null, kind: 'earnings', title: 'NVDA earnings' }), 1).lines[0].startsWith('Earnings'), true);
  assert.equal(outlook(ev({ nq: { ...cpi, n: 5 } }), 1).bias, 'none');
});
