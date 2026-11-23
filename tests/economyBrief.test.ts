/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreEconomy } from '../src/shared/newsFeed';
import { pickEconSources, buildEconomyPrompt, cleanEconCountry, basicEconomy, cleanEconomyReview } from '../src/news/economyBrief';

const now = Date.UTC(2026, 10, 23, 18);
const it = (title: string, region: 'US' | 'IN' | 'CA', ageH = 2) => ({ ...scoreEconomy({ title, link: 'https://x.test', pub: now - ageH * 3600000, source: 'Feed' }), also: 0, region });

test('economy score: the real economy ranks above stock-market stories and noise', () => {
  const jobs = scoreEconomy({ title: 'Canada adds 40,000 jobs, unemployment rate falls to 6.5%', link: '', pub: 0, source: 'x' });
  const budget = scoreEconomy({ title: 'India budget deficit widens as government spending rises', link: '', pub: 0, source: 'x' });
  const stocks = scoreEconomy({ title: 'Sensex jumps 800 points as banking shares rally', link: '', pub: 0, source: 'x' });
  const noise = scoreEconomy({ title: 'How to save on groceries: my wife and I share tips', link: '', pub: 0, source: 'x' });
  assert.ok(jobs.score >= 4 && budget.score >= 4, `${jobs.score} ${budget.score}`);
  assert.ok(stocks.score < 3, String(stocks.score));
  assert.ok(noise.score < 0);
});

test('economy sources: up to 10 per country, last 48 hours only', () => {
  const list = [it('US inflation cools to 2.8% in October', 'US'), it('India GDP growth slows to 6.2%', 'IN'), it('Bank of Canada warns on housing costs', 'CA'), it('Old: US retail sales rise', 'US', 60)];
  const p = pickEconSources(list as any, now);
  assert.deepEqual(p.map(x => x.region), ['US', 'IN', 'CA']);
  const prompt = buildEconomyPrompt(p as any);
  assert.ok(prompt.includes('[2] (India,'));
  assert.ok(/not the stock market/i.test(prompt));
  const basic = basicEconomy(p as any);
  assert.equal(basic.India?.headline, 'India GDP growth slows to 6.2%');
  assert.deepEqual(basic.Canada?.happened[0].src, [3]);
});

test('economy country card and Claude review are cleaned', () => {
  const c = cleanEconCountry({ headline: 'Prices rise more slowly', happened: [{ text: 'Inflation 2.8%', src: [1, 7] }], why: ['Cheaper fuel'], now: ['Fed watching'], next: ['Rate cut odds up'], people: 'Groceries still pricey' }, 3)!;
  assert.deepEqual(c.happened[0].src, [1]);
  assert.equal(c.people, 'Groceries still pricey');
  assert.equal(cleanEconCountry({ headline: '' }, 3), null);
  const r = cleanEconomyReview({ countries: { India: { headline: 'GDP slows', happened: [{ text: 'Growth 6.2%', src: [1] }] } }, sources: [{ title: 'GDP', link: 'https://e.test', region: 'IN' }], corrections: ['Added GDP'] });
  assert.equal(typeof r, 'object');
  assert.equal((r as any).countries.India.headline, 'GDP slows');
  assert.equal(typeof cleanEconomyReview({ countries: {} }), 'string');
});
