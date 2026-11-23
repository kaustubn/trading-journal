/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSources, cleanBrief, buildPrompt, basicBrief, oddsLine } from '../src/news/brief';
import { scoreHeadline, headlineRegion, splitPublisher, headlineTopic } from '../src/shared/newsFeed';
import { labelOf } from '../src/shared/chartNews';

const now = Date.UTC(2026, 10, 23, 18);
const h = (title: string, region: 'US' | 'IN' | 'CA', ageH = 1, also = 0) => {
  const s = scoreHeadline({ title, link: 'https://x.test/a', pub: now - ageH * 3600000, source: 'Feed' });
  return { ...s, also, region, topic: headlineTopic(title) };
};

test('regions: India and Canada words win, US macro / big tech stay US, Google News publisher split off', () => {
  assert.equal(headlineRegion('RBI keeps repo rate unchanged', 'US'), 'IN');
  assert.equal(headlineRegion('Bank of Canada cuts rate, loonie slides', 'US'), 'CA');
  assert.equal(headlineRegion('Nvidia shares jump', 'IN'), 'US');
  assert.equal(headlineRegion('Local factory opens', 'CA'), 'CA');
  assert.deepEqual(splitPublisher('Jensen Huang is back as Nvidia CEO - Reuters'), { title: 'Jensen Huang is back as Nvidia CEO', publisher: 'Reuters' });
  assert.ok(scoreHeadline({ title: 'RBI keeps repo rate unchanged, Sensex jumps', link: '', pub: 0, source: 'x' }).score >= 5);
  assert.ok(scoreHeadline({ title: 'Jensen Huang is back as Nvidia CEO', link: '', pub: 0, source: 'x' }).score >= 4);
});

test('pickSources: fresh, strong, a few per country, old news dropped', () => {
  const list = [
    h('Jensen Huang is back as Nvidia CEO, stock soars 8%', 'US', 1, 3),
    h('RBI keeps repo rate unchanged, Sensex jumps', 'IN', 2),
    h('Bank of Canada cuts rate, loonie slides', 'CA', 3),
    h('Fed minutes show split on rate cuts', 'US', 30),          // older than 18 h
    h('Celebrity wedding photos', 'US', 1),                       // noise
  ];
  const p = pickSources(list, now);
  assert.deepEqual(p.map(x => x.region), ['US', 'IN', 'CA']);
  assert.equal(p[0].title.startsWith('Jensen'), true);
});

test('cleanBrief: keeps the shape, trims, drops bad source numbers; rejects junk', () => {
  const ok = cleanBrief({ headline: 'Huang back at Nvidia; NQ gaps up', happened: [{ text: 'Huang returned as CEO', src: [1, 9, 'x'] }, 'plain string item'],
    why: ['Investors trust him'], now: ['NQ +1.2%'], next: ['Fed hike odds 93%'], regions: { US: 'Tech leads', India: '', Canada: 'TSX follows' },
    impact: { NQ: 'Gap may hold', Nifty: 'IT stocks up' }, watch: ['PCE Wed 8:30'] }, 3)!;
  assert.deepEqual(ok.happened[0].src, [1]);
  assert.equal(ok.happened[1].text, 'plain string item');
  assert.deepEqual(Object.keys(ok.regions), ['US', 'Canada']);
  assert.equal(cleanBrief({ headline: '', happened: [] }, 3), null);
  assert.equal(cleanBrief('nope', 3), null);
});

test('prompt carries numbered headlines, odds and the no-advice rule; plain brief without AI', () => {
  const src = pickSources([h('Jensen Huang is back as Nvidia CEO, stock soars 8%', 'US', 1)], now);
  const odds = [{ id: '1', title: 'Fed Decision in December?', url: 'u', region: 'US' as const, ends: null, volume24h: 1, outcomes: [{ label: '25 bps increase', pct: 93.5, change1d: null }] }];
  const p = buildPrompt(src, odds, [{ title: 'PCE inflation', utc: '2026-11-25T13:30:00Z' }], '+120 pts');
  assert.ok(p.includes('[1] (US,'));
  assert.ok(p.includes('Fed Decision in December?: 25 bps increase 93.5%'));
  assert.ok(/Never tell the reader to buy or sell/.test(p));
  assert.equal(oddsLine(odds[0]), 'Fed Decision in December?: 25 bps increase 93.5%');
  const b = basicBrief(src, odds, [], null);
  assert.equal(b.headline, src[0].title);
  assert.equal(b.next[0], oddsLine(odds[0]));
});

test('chart labels for headlines: topic or first words, with country tag', () => {
  const base = { utc: '', impact: 'high' as const, actual: null, forecast: null, previous: null, surprise: null, nq: null, kind: 'headline' as const };
  assert.equal(labelOf({ ...base, title: 'Jensen Huang back', topic: 'nvidia', region: 'US' }), 'NVDA');
  assert.equal(labelOf({ ...base, title: 'RBI holds', topic: 'rbi', region: 'IN' }), 'IN RBI');
  assert.equal(labelOf({ ...base, title: 'Strike shuts ports nationwide', topic: 'habc', region: 'CA' }), 'CA Strike shuts');
});

test('reviewed brief from Claude Code: cleaned, https links only, corrections kept, bad input refused', () => {
  const { cleanReview } = require('../src/news/brief');
  const r = cleanReview({
    headline: 'Nvidia rehires Huang; NQ best day since April', happened: [{ text: 'Board reinstated Jensen Huang as CEO', src: [1, 2] }],
    why: ['Board turmoil ended'], now: ['Nasdaq +6%'], next: ['Fed hike odds 93% for December'], regions: { India: 'Nifty fell 1.7%' }, impact: { NQ: 'Gap up may hold' },
    watch: ['PCE Wed 8:30 NY'], corrections: ['Added the Nifty fall the AI missed', 'Fixed NQ move: +6%, not +3.6%'],
    sources: [{ title: 'Nvidia reinstates Huang', link: 'https://example.com/a', source: 'Reuters', region: 'US', ts: '2026-11-23T14:00:00Z' },
      { title: 'Bad link', link: 'javascript:alert(1)', source: 'x', region: 'Mars' }],
  });
  assert.equal(typeof r, 'object');
  assert.equal(r.engine, 'claude (reviewed)');
  assert.deepEqual(r.happened[0].src, [1, 2]);
  assert.equal(r.sources[1].link, null);          // not https -> dropped
  assert.equal(r.sources[1].region, 'US');
  assert.equal(r.corrections.length, 2);
  assert.equal(typeof cleanReview({ headline: 'x' }), 'string');
});
