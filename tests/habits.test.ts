/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRules, debriefStats, disciplineSummary, levelOf, dayXp, RTrade } from '../src/shared/habits';

const T = (id: number, day: string, time: string, pnl: number, qty = 1): RTrade => ({ id, day, time, utc: Date.parse(`${day}T${time}:00Z`), pnl, qty });

test('max trades per day flags only the extra trades', () => {
  const v = checkRules([T(1, 'd1', '09:40', 100), T(2, 'd1', '09:50', -50), T(3, 'd1', '10:10', 20)], { max_trades_day: 2 });
  assert.equal(v.length, 1);
  assert.deepEqual(v[0].trade_ids, [3]);
});

test('stop after N losses: trades after the Nth loss are breaks', () => {
  const v = checkRules([T(1, 'd1', '09:40', -100), T(2, 'd1', '09:50', -50), T(3, 'd1', '10:10', 200), T(4, 'd1', '10:20', -10)], { max_losses_day: 2 });
  assert.deepEqual(v[0].trade_ids, [3, 4]);
  assert.equal(v[0].rule, 'max_losses_day');
});

test('daily loss limit: trades after the limit, or a day that closed below it', () => {
  const after = checkRules([T(1, 'd1', '09:40', -600), T(2, 'd1', '09:50', 100)], { max_daily_loss: 500 });
  assert.deepEqual(after[0].trade_ids, [2]);
  const closed = checkRules([T(1, 'd2', '09:40', -300), T(2, 'd2', '09:50', -300)], { max_daily_loss: 500 });
  assert.equal(closed[0].rule, 'max_daily_loss');
  assert.deepEqual(closed[0].trade_ids, []);
  assert.match(closed[0].detail, /-\$600/);
  assert.equal(checkRules([T(1, 'd3', '09:40', -400)], { max_daily_loss: 500 }).length, 0);
});

test('size, hours and news blackout', () => {
  const news = [{ start: Date.parse('d1T13:20:00Z'), end: Date.parse('d1T13:45:00Z'), title: 'CPI m/m' }].map(w => w);
  const tr = [T(1, 'd1', '09:20', 10, 3), T(2, 'd1', '16:30', 10), { ...T(3, 'd1', '09:35', 10), utc: Date.parse('2026-01-01T13:30:00Z') }];
  const v = checkRules(tr, { max_contracts: 2, start_time: '09:30', end_time: '16:00' });
  assert.deepEqual(v.find(x => x.rule === 'max_contracts')!.trade_ids, [1]);
  assert.deepEqual(v.find(x => x.rule === 'hours')!.trade_ids.sort(), [1, 2]);
  const w = [{ start: Date.parse('2026-01-01T13:20:00Z'), end: Date.parse('2026-01-01T13:45:00Z'), title: 'CPI m/m' }];
  const nv = checkRules(tr, { respect_news: true }, w);
  assert.deepEqual(nv[0].trade_ids, [3]);
  assert.match(nv[0].detail, /CPI m\/m/);
  assert.equal(news.length, 1);
});

test('no rules set = no breaks', () => {
  assert.equal(checkRules([T(1, 'd1', '09:40', -100, 50)], {}).length, 0);
});

test('debrief stats group by emotion and plan', () => {
  const s = debriefStats([
    { pnl: 100, emotion: 'calm', followed_plan: true, retake: true, quality: 4 },
    { pnl: -200, emotion: 'fomo', followed_plan: false, retake: false, quality: 2 },
    { pnl: 50, emotion: 'calm', followed_plan: true, retake: true, quality: 4 },
  ]);
  const calm = s.byEmotion.find(g => g.key === 'calm')!;
  assert.equal(calm.n, 2);
  assert.equal(calm.winRate, 100);
  assert.equal(s.byPlan.find(g => g.key === 'broke')!.total, -200);
});

test('XP, levels, score, streaks and challenges', () => {
  assert.equal(dayXp({ day: 'x', trades: 2, debriefed: 2, violations: 0, plan: true, review: true }), 20 + 30 + 15 + 50 + 20);
  assert.equal(dayXp({ day: 'x', trades: 1, debriefed: 0, violations: 2, plan: false, review: false }), 10 - 50);
  assert.equal(levelOf(0).name, 'New');
  assert.equal(levelOf(260).name, 'Steady');
  assert.equal(levelOf(99999).next, null);
  const days = [
    { day: '2026-11-16', trades: 2, debriefed: 2, violations: 0, plan: true, review: true },
    { day: '2026-11-17', trades: 3, debriefed: 1, violations: 1, plan: true, review: false },
    { day: '2026-11-18', trades: 1, debriefed: 1, violations: 0, plan: true, review: true },
    { day: '2026-11-19', trades: 2, debriefed: 2, violations: 0, plan: true, review: false },
  ];
  const s = disciplineSummary(days, '2026-11-20');   // Friday, no plan yet today
  assert.equal(s.streaks.ruleFree, 2);
  assert.equal(s.streaks.journal, 2);
  assert.equal(s.streaks.plan, 4);
  // clean 3/4, debriefed 6/8, reviewed 2/4 -> 0.5*0.75 + 0.3*0.75 + 0.2*0.5 = 0.7
  assert.equal(s.score, 70);
  assert.equal(s.challenges.find(c => c.key === 'debrief')!.progress, 6);
  assert.equal(disciplineSummary([], '2026-11-20').score, null);
});
