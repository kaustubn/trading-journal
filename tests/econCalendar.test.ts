/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyToUtc, londonToUtc, utcToNy, parseEventsFile, parseValue, surpriseSign, reactionFor, reactionLine, movePts, parseClock, ReactionTable } from '../src/shared/econCalendar';

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);

test('New York to UTC across daylight saving (2024 switch days)', () => {
  assert.equal(iso(nyToUtc(2024, 3, 8, 8, 30)), '2024-03-08T13:30');   // EST
  assert.equal(iso(nyToUtc(2024, 3, 11, 8, 30)), '2024-03-11T12:30');  // EDT
  assert.equal(iso(nyToUtc(2024, 11, 1, 8, 30)), '2024-11-01T12:30');  // EDT
  assert.equal(iso(nyToUtc(2024, 11, 4, 8, 30)), '2024-11-04T13:30');  // EST
});

test('London to UTC, including the weeks when UK and US clocks differ', () => {
  assert.equal(iso(londonToUtc(2026, 7, 3, 13, 30)), '2026-07-03T12:30');   // BST
  assert.equal(iso(londonToUtc(2026, 1, 9, 13, 30)), '2026-01-09T13:30');   // GMT
  assert.equal(iso(londonToUtc(2026, 10, 29, 12, 30)), '2026-10-29T12:30'); // GMT already (UK changed Oct 25)
});

test('UTC back to New York wall clock', () => {
  assert.deepEqual(utcToNy(Date.parse('2026-07-03T12:30:00Z')), { date: '2026-07-03', time: '08:30' });
  assert.deepEqual(utcToNy(Date.parse('2026-01-09T13:30:00Z')), { date: '2026-01-09', time: '08:30' });
  assert.deepEqual(utcToNy(Date.parse('2026-12-10T19:00:00Z')), { date: '2026-12-10', time: '14:00' });
});

test('ForexFactory history CSV (London time): USD high/medium kept, NFP lands at 08:30 New York', () => {
  const csv = 'Date,Time,Day,Currency,Impact,Event,Actual,Forecast,Previous,Time_Label,Event_ID\n'
    + '2026-07-03,13:30,Friday,USD,High,Non-Farm Employment Change,147K,110K,144K,,1\n'
    + '2026-07-03,13:30,Friday,EUR,High,Something,1,1,1,,2\n'
    + '2026-07-04,00:00,Saturday,USD,Holiday,Bank Holiday,,,,All Day,3\n'
    + '2026-10-29,12:30,Thursday,USD,Medium,"Advance GDP q/q, annualized",3.4%,3.2%,2.2%,,4\n';
  const r = parseEventsFile(csv);
  assert.equal(r.format, 'ForexFactory history CSV');
  assert.equal(r.events.length, 2);
  assert.equal(utcToNy(Date.parse(r.events[0].release_utc)).time, '08:30');
  assert.equal(r.events[0].actual, '147K');
  assert.equal(r.events[1].title, 'Advance GDP q/q, annualized');
  assert.equal(r.events[1].impact, 'medium');
  assert.equal(utcToNy(Date.parse(r.events[1].release_utc)).time, '08:30');
});

test('ForexFactory weekly JSON uses the offsets in the file', () => {
  const json = JSON.stringify([
    { title: 'CPI m/m', country: 'USD', date: '2026-12-10T08:30:00-05:00', impact: 'High', forecast: '0.3%', previous: '0.2%' },
    { title: 'German ZEW', country: 'EUR', date: '2026-12-10T05:00:00-05:00', impact: 'High', forecast: '', previous: '' },
    { title: 'Bank Holiday', country: 'USD', date: '2026-12-25T00:00:00-05:00', impact: 'Holiday', forecast: '', previous: '' },
  ]);
  const r = parseEventsFile(json);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].release_utc, '2026-12-10T13:30:00.000Z');
  assert.equal(r.events[0].forecast, '0.3%');
  assert.equal(r.events[0].actual, null);
});

test('release_datetime_et CSV is New York time', () => {
  const r = parseEventsFile('release_datetime_et,title,actual,forecast,previous\n2026-12-10 08:30,CPI m/m,,0.3%,0.2%\n');
  assert.equal(r.events[0].release_utc, '2026-12-10T13:30:00.000Z');
});

test('clock and values', () => {
  assert.deepEqual(parseClock('8:30am'), [8, 30]);
  assert.deepEqual(parseClock('2:00pm'), [14, 0]);
  assert.equal(parseClock('All Day'), null);
  assert.equal(parseValue('0.3%'), 0.3);
  assert.equal(parseValue('256K'), 256000);
  assert.equal(parseValue('-1.2B'), -1.2e9);
  assert.equal(parseValue(''), null);
  assert.equal(surpriseSign('0.4%', '0.3%'), 'above');
  assert.equal(surpriseSign('140K', '160K'), 'below');
  assert.equal(surpriseSign(null, '0.3%'), null);
});

test('reaction lookup and wording', () => {
  const table: ReactionTable = { period: 'x', source: 'y', events: {
    'CPI m/m': { title: 'CPI m/m', n: 60, absMed1: 70, absMed15: 95, absMed60: 120, up15: 52, buckets: { above: { n: 16, up15: 12, med15: -170, held60: 90 } } },
  } };
  const r = reactionFor(table, 'cpi M/M');
  assert.ok(r);
  assert.match(reactionLine(r), /coin flip/);
  assert.match(reactionLine(r, 'above'), /above forecast \(16 times\): up after 15 min 12%/);
  assert.equal(reactionFor(table, 'Unknown'), null);
});

test('move size: % of price at the current price, points fallback without a price or %', () => {
  const r = { title: 'CPI m/m', n: 100, absMed1: 20, absMed15: 30, absMed60: 40, absPct1: 0.2, absPct15: 0.4, absPct60: 0.5, up15: 50, buckets: {} };
  assert.equal(movePts(r, 1, 25000), 50);          // 0.2% of 25,000
  assert.equal(movePts(r, 15, 25000), 100);
  assert.equal(movePts(r, 60, 20000), 100);
  assert.equal(movePts(r, 15, null), 30);          // no price -> stored points
  const old = { ...r, absPct1: undefined, absPct15: undefined, absPct60: undefined };
  assert.equal(movePts(old, 15, 25000), 30);       // old table without % -> points
  assert.match(reactionLine(r, null, 25000), /50 pts in 1 min, 100 pts by 15 min at today's price/);
  assert.doesNotMatch(reactionLine(r), /today's price/);
});
