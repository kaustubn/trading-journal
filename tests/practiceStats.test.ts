/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kpis, heatmap, timePerSetup, weekStart, filterSessions, sessionsCsv, SessionRow } from '../shared/practiceStats';

const sess = (o: Partial<SessionRow>): SessionRow => ({
  id: 1, started_at: '2026-11-18T14:00:00Z', ended_at: '2026-11-18T15:00:00Z', status: 'stopped', active_sec: 1800, idle_sec: 0,
  pause_sec: 0, setup_tag: 'VA80', instrument: 'NQ', timeframe: '5m', hist_from: null, hist_to: null, trades_logged: 4, edited: false, note: null, ...o,
});

test('weekStart is Monday', () => {
  assert.equal(weekStart('2026-11-19'), '2026-11-16'); // Thursday -> Monday
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
  assert.equal(weekStart('2026-11-22'), '2026-11-16'); // Sunday belongs to the week that started Monday
});

test('kpis: today/week/month/all, both averages, trades per hour, streaks', () => {
  const daily = [{ d: '2026-10-30', sec: 600 }, { d: '2026-11-17', sec: 1200 }, { d: '2026-11-18', sec: 1800 }, { d: '2026-11-19', sec: 3600 }];
  const sessions = [sess({ id: 1, active_sec: 3600, trades_logged: 6 }), sess({ id: 2, active_sec: 1800, trades_logged: 3 }), sess({ id: 3, active_sec: 1800, status: 'running', trades_logged: 0 })];
  const k = kpis(daily, sessions, '2026-11-19');
  assert.equal(k.todaySec, 3600);
  assert.equal(k.weekSec, 6600);
  assert.equal(k.monthSec, 6600);
  assert.equal(k.allSec, 7200);
  assert.equal(k.activeDays, 4);
  assert.equal(k.calendarDays, 21);                // Oct 30 .. Nov 19 inclusive
  assert.equal(k.avgActiveDaySec, 1800);
  assert.equal(Math.round(k.avgCalendarDaySec!), Math.round(7200 / 21));
  assert.equal(k.tradesPerHour, 9 / 2);            // 9 trades over 7200 s of session time
  assert.equal(k.longest!.id, 1);                  // running session ignored
  assert.equal(k.shortest!.id, 2);
  assert.equal(k.currentStreak, 3);
  assert.equal(k.bestStreak, 3);
});

test('current streak still counts when today has no practice yet', () => {
  const k = kpis([{ d: '2026-11-17', sec: 120 }, { d: '2026-11-18', sec: 120 }], [], '2026-11-19');
  assert.equal(k.currentStreak, 2);
  assert.equal(kpis([{ d: '2026-11-16', sec: 120 }], [], '2026-11-19').currentStreak, 0);
});

test('heatmap: 53 Monday-first weeks ending this week, levels by minutes, future days flagged', () => {
  const g = heatmap([{ d: '2026-11-19', sec: 50 * 60 }, { d: '2026-11-18', sec: 5 * 60 }], '2026-11-19');
  assert.equal(g.length, 53);
  const last = g[52];
  assert.equal(last[0].d, '2026-11-16');
  assert.equal(last[3].level, 3);   // 50 min
  assert.equal(last[2].level, 1);   // 5 min
  assert.equal(last[6].future, true);
});

test('timePerSetup groups and sorts; filters and CSV', () => {
  const rows = [sess({ id: 1, setup_tag: 'VA80', active_sec: 100 }), sess({ id: 2, setup_tag: null, active_sec: 300 }), sess({ id: 3, setup_tag: 'VA80', active_sec: 50 })];
  assert.deepEqual(timePerSetup(rows).map(r => [r.setup, r.sec, r.sessions]), [['(no setup)', 300, 1], ['VA80', 150, 2]]);
  const local = (iso: string) => iso.slice(0, 10);
  assert.equal(filterSessions(rows, { setup: 'VA80' }, local).length, 2);
  assert.equal(filterSessions(rows, { from: '2026-11-19' }, local).length, 0);
  const csv = sessionsCsv([sess({ note: 'said "hi"' })], local);
  assert.ok(csv.split('\n')[1].includes('"said ""hi"""'));
});
