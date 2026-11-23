/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseFredCalendar, parseFomc, parseRss, scoreHeadline, dedupe, headlineKey, recentMove, IMPORTANT } from '../src/shared/newsFeed';

const fx = (f: string) => readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

test('FRED calendar: CPI Dec 10 2026 7:30 am Central = 8:30 New York = 13:30 UTC', () => {
  const r = parseFredCalendar(fx('fred_cpi.html'));
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { rid: 10, date: '2026-12-10', utc: '2026-12-10T13:30:00.000Z' });
});

test('FRED calendar: weekly claims rows; rows without a time (daily data updates) are skipped', () => {
  const c = parseFredCalendar(fx('fred_claims.html'));
  assert.ok(c.length >= 4);
  assert.equal(c[0].date, '2026-11-25');               // Wednesday before Thanksgiving
  assert.equal(c[0].utc, '2026-11-25T13:30:00.000Z');
  assert.ok(c.every(x => x.rid === 180));
  assert.equal(parseFredCalendar(fx('fred_fomc_daily.html')).length, 0);
});

test('FOMC: decision on the last meeting day at 2:00 pm New York; month pairs and notation votes', () => {
  const f = parseFomc(fx('fomc.html'));
  const d26 = f.filter(x => x.date.startsWith('2026'));
  assert.equal(d26.length, 8);
  assert.deepEqual(d26.find(x => x.date === '2026-12-09'), { date: '2026-12-09', utc: '2026-12-09T19:00:00.000Z', projections: true });
  assert.equal(d26.find(x => x.date === '2026-07-29')?.utc, '2026-07-29T18:00:00.000Z');   // summer time
  assert.ok(f.some(x => x.date === '2024-05-01'), 'Apr/May 30-1 -> May 1');
  assert.ok(!f.some(x => x.date === '2025-08-22'), 'notation vote skipped');
  assert.ok(f.some(x => x.date === '2027-11-17'));
});

test('RSS + scoring: market movers pass, personal-finance and lifestyle noise does not', () => {
  const items = parseRss(fx('cnbc_top.xml'), 'sample');
  assert.equal(items.length, 4, 'item without a date dropped');
  const s = items.map(scoreHeadline);
  const by = (w: string) => s.find(x => x.title.includes(w))!;
  assert.ok(by('reinstated').score >= IMPORTANT, JSON.stringify(by('reinstated')));
  assert.ok(by('Powell').score >= IMPORTANT, JSON.stringify(by('Powell')));
  assert.ok(by('married').score < 0);
  assert.ok(by('recipes').score < IMPORTANT);
  assert.equal(by('Powell').title, "Fed's Powell signals rate cuts could come in December");
});

test('dedupe: the same story from two feeds becomes one entry', () => {
  const t0 = Date.UTC(2026, 10, 23, 17);
  const a = scoreHeadline({ title: 'Jensen Huang reinstated as Nvidia CEO, stock skyrockets 33%', link: '', pub: t0, source: 'a' });
  const b = scoreHeadline({ title: 'Nvidia stock skyrockets 33% as Jensen Huang reinstated CEO', link: '', pub: t0 + 60000, source: 'b' });
  const c = scoreHeadline({ title: 'Powell says the Fed is in no hurry to cut rates', link: '', pub: t0 + 120000, source: 'a' });
  const d = dedupe([a, b, c]);
  assert.equal(d.length, 2);
  assert.equal(d.find(x => x.title.startsWith('Jensen'))?.also, 1);
  assert.equal(headlineKey(a.title), headlineKey('Jensen Huang reinstated as Nvidia CEO, stock skyrockets 33%'));
});

test('recentMove: change over the last 15 minutes of 1-minute closes', () => {
  const t = Array.from({ length: 30 }, (_, i) => i * 60000);
  const c: (number | null)[] = t.map((_, i) => 20000 + i * 10);
  c[29] = null;                                            // unfinished last bar
  const m = recentMove(t, c, 15)!;
  assert.equal(m.to, 20280); assert.equal(m.from, 20130); assert.equal(m.pts, 150);
  assert.ok(Math.abs(m.pct - 0.745) < 0.01);
  assert.equal(recentMove([], [], 15), null);
});

test('headlineTopic: stories about the same company / theme share one topic', () => {
  const { headlineTopic } = require('../src/shared/newsFeed');
  assert.equal(headlineTopic('Jensen Huang Is Back as Nvidia CEO'), 'nvidia');
  assert.equal(headlineTopic('Stocks climb as Huang\'s stunning return lifts optimism'), 'nvidia');
  assert.equal(headlineTopic('Powell says no hurry to cut rates'), 'fed');
  assert.equal(headlineTopic('Mystery story'), headlineTopic('Mystery story'));
  assert.ok(headlineTopic('Mystery story').startsWith('h'));
  assert.ok(scoreHeadline({ title: "Stocks climb as Huang's stunning return to Nvidia lifts optimism", link: '', pub: 0, source: 'x' }).score >= IMPORTANT);
});
