/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEvalStatus, validConfig, type EvalConfig } from '../src/shared/evalGuard';

// LucidFlex 25K-style rules (all values are inputs; nothing is hardcoded in the engine)
const LUCID: EvalConfig = { start: 25000, target: 1250, maxLoss: 1000, lockTrigger: 26100, lockFloor: 25100,
  consistencyPct: 40, dailyLossLimit: null, dailyStop: 200 };
const today = (day: string, pnl: number | null = null) => ({ day, pnl });

test('fresh account: floor is start − max loss, cap is 40% of target, status PUSH', () => {
  const s = computeEvalStatus(LUCID, [], today('2026-11-02'))!;
  assert.equal(s.floor, 24000);
  assert.equal(s.buffer, 1000);
  assert.equal(s.requiredTotal, 1250);
  assert.equal(s.todayCap, 500);
  assert.equal(s.status, 'PUSH');
  assert.equal(s.daysTraded, 0);
});

test('trailing floor rises with the highest END-OF-DAY close and never falls', () => {
  const s = computeEvalStatus(LUCID, [
    { day: '2026-11-02', balance: 25400 },
    { day: '2026-11-03', balance: 25150 },
  ], today('2026-11-04'))!;
  assert.equal(s.highestClose, 25400);
  assert.equal(s.floor, 24400);
  assert.equal(s.buffer, 750);
  assert.equal(s.profit, 150);
});

test('floor locks at 25,100 once a close reaches 26,100', () => {
  const below = computeEvalStatus(LUCID, [{ day: '2026-11-02', balance: 26050 }], today('2026-11-03'))!;
  assert.equal(below.floor, 25050);
  assert.equal(below.floorLocked, false);
  const locked = computeEvalStatus(LUCID, [
    { day: '2026-11-02', balance: 25400 }, { day: '2026-11-03', balance: 25800 }, { day: '2026-11-04', balance: 26300 },
  ], today('2026-11-05'))!;
  assert.equal(locked.floor, 25100);
  assert.equal(locked.floorLocked, true);
  assert.equal(locked.buffer, 1200);
});

test('a $700 day raises the required total to $1,750', () => {
  const s = computeEvalStatus(LUCID, [{ day: '2026-11-02', balance: 25700 }], today('2026-11-03'))!;
  assert.equal(s.largestDay, 700);
  assert.equal(s.requiredTotal, 1750);
  assert.equal(s.toTarget, 1050);
  assert.equal(s.todayCap, 700);      // a day up to the earlier $700 does not raise it further
});

test('profit >= target is not a pass while the consistency rule still needs more', () => {
  const s = computeEvalStatus(LUCID, [
    { day: '2026-11-02', balance: 25700 }, { day: '2026-11-03', balance: 26000 }, { day: '2026-11-04', balance: 26300 },
  ], today('2026-11-05'))!;
  assert.equal(s.profit, 1300);
  assert.equal(s.requiredTotal, 1750);
  assert.notEqual(s.status, 'PASSED');
  const done = computeEvalStatus(LUCID, [
    { day: '2026-11-02', balance: 25450 }, { day: '2026-11-03', balance: 25900 }, { day: '2026-11-04', balance: 26300 },
  ], today('2026-11-05'))!;
  assert.equal(done.requiredTotal, 1250);
  assert.equal(done.status, 'PASSED');
});

test('breach is detected on the close and remembered after a recovery', () => {
  const s = computeEvalStatus(LUCID, [
    { day: '2026-11-02', balance: 25300 }, { day: '2026-11-03', balance: 24300 }, { day: '2026-11-04', balance: 24900 },
  ], today('2026-11-05'))!;
  assert.equal(s.breachDay, '2026-11-03');   // floor was 24,300 after the 25,300 close
  assert.equal(s.status, 'BREACHED');
  const live = computeEvalStatus(LUCID, [], today('2026-11-02', -1000))!;
  assert.equal(live.status, 'BREACHED');
});

test('DONE TODAY at the consistency cap, the personal stop, or the firm daily limit', () => {
  assert.equal(computeEvalStatus(LUCID, [], today('2026-11-02', 500))!.status, 'DONE_TODAY');
  assert.equal(computeEvalStatus(LUCID, [], today('2026-11-02', 499.99))!.status, 'PUSH');
  assert.equal(computeEvalStatus(LUCID, [], today('2026-11-02', -200))!.status, 'DONE_TODAY');
  const dll = { ...LUCID, dailyStop: null, dailyLossLimit: 300 };
  assert.equal(computeEvalStatus(dll, [], today('2026-11-02', -250))!.status, 'PUSH');
  assert.equal(computeEvalStatus(dll, [], today('2026-11-02', -300))!.status, 'DONE_TODAY');
});

test('CAUTION after three green days in a row, or when the buffer is under a quarter of max loss', () => {
  const green = computeEvalStatus(LUCID, [
    { day: '2026-11-02', balance: 25100 }, { day: '2026-11-03', balance: 25250 }, { day: '2026-11-04', balance: 25400 },
  ], today('2026-11-05'))!;
  assert.equal(green.greenStreak, 3);
  assert.equal(green.status, 'CAUTION');
  const thin = computeEvalStatus(LUCID, [{ day: '2026-11-02', balance: 24200 }], today('2026-11-03'))!;
  assert.equal(thin.buffer, 200);
  assert.equal(thin.status, 'CAUTION');
});

test('a typed close for today wins over the journal and counts in the history', () => {
  const s = computeEvalStatus(LUCID, [{ day: '2026-11-02', balance: 25300 }], today('2026-11-02', 999))!;
  assert.equal(s.todayFromClose, true);
  assert.equal(s.todayPnl, 300);
  assert.equal(s.balance, 25300);
  assert.equal(s.daysTraded, 1);
});

test('cents are exact: no float drift across many small days', () => {
  const closes = Array.from({ length: 10 }, (_, i) => ({ day: `2026-11-${String(i + 2).padStart(2, '0')}`, balance: 25000 + 0.1 * (i + 1) }));
  const s = computeEvalStatus({ ...LUCID, consistencyPct: null }, closes, today('2026-11-30'))!;
  assert.equal(s.profit, 1);
  assert.equal(s.lastClose, 25001);
  assert.equal(s.requiredTotal, 1250);
});

test('close vs journal: gaps over $5 and journal days with no close are flagged', () => {
  const s = computeEvalStatus(LUCID, [
    { day: '2026-11-02', balance: 25100 }, { day: '2026-11-03', balance: 25050 },
  ], today('2026-11-05'), { '2026-11-02': 104.5, '2026-11-03': -40, '2026-11-04': 80 })!;
  const by = Object.fromEntries(s.checks.map(c => [c.day, c]));
  assert.equal(by['2026-11-02'].flagged, false);   // $4.50 gap (commissions) is within tolerance
  assert.equal(by['2026-11-03'].gap, -10);
  assert.equal(by['2026-11-03'].flagged, true);
  assert.equal(by['2026-11-04'].closePnl, null);
  assert.equal(by['2026-11-04'].flagged, true);    // traded, but no close typed
  assert.deepEqual(s.checks.map(c => c.day), ['2026-11-04', '2026-11-03', '2026-11-02']);
});

test('invalid configs are refused, not guessed', () => {
  assert.equal(validConfig({ ...LUCID, maxLoss: 0 }), false);
  assert.equal(validConfig({ ...LUCID, consistencyPct: 0 }), false);
  assert.equal(validConfig({ ...LUCID, lockFloor: null }), false);
  assert.equal(computeEvalStatus({ ...LUCID, start: NaN }, [], today('2026-11-02')), null);
});
