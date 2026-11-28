/// <reference types="node" />
// Independent check of computeEvalStatus. Expected values were written by the reviewer (Kay's Brain, Mission 002),
// not by the engine's author, and are copied here unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEvalStatus, type EvalConfig } from '../src/shared/evalGuard';

const CFG: EvalConfig = { start: 25000, target: 1250, maxLoss: 1000, lockTrigger: 26100, lockFloor: 25100,
  consistencyPct: 40, dailyLossLimit: null, dailyStop: null };
const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
// closes on consecutive days; "today" is the day after the last close unless a live P&L is given for it
const run = (balances: number[], live: number | null = null) => computeEvalStatus(CFG,
  balances.map((balance, i) => ({ day: days[i], balance })), { day: days[balances.length], pnl: live })!;

test('case 1: [25300, 25500]', () => {
  const s = run([25300, 25500]);
  assert.deepEqual([s.profit, s.floor, s.buffer, s.largestDay, s.requiredTotal, s.toTarget], [500, 24500, 1000, 300, 1250, 750]);
});
test('case 2: [25700, 25800]', () => {
  const s = run([25700, 25800]);
  assert.deepEqual([s.profit, s.floor, s.buffer, s.requiredTotal, s.toTarget], [800, 24800, 1000, 1750, 950]);
});
test('case 3: [25600, 26100, 25700] locks at 25,100', () => {
  const s = run([25600, 26100, 25700]);
  assert.deepEqual([s.floor, s.floorLocked, s.buffer, s.profit, s.requiredTotal, s.toTarget], [25100, true, 600, 700, 1500, 800]);
});
test('case 4: [25400, 24400] breaches on day 2', () => {
  const s = run([25400, 24400]);
  assert.equal(s.status, 'BREACHED');
  assert.equal(s.breachDay, days[1]);
});
test('case 5: [25500, 26000, 26250] target met', () => {
  const s = run([25500, 26000, 26250]);
  assert.deepEqual([s.profit, s.largestDay, s.requiredTotal, s.status], [1250, 500, 1250, 'PASSED']);
});
test('case 6: [25501, 25901, 26250] not met by $2.50', () => {
  const s = run([25501, 25901, 26250]);
  assert.deepEqual([s.profit, s.largestDay, s.requiredTotal, s.toTarget], [1250, 501, 1252.5, 2.5]);
  assert.notEqual(s.status, 'PASSED');
});
test('case 7: [25600, 24700, 25100] a big loss is not the largest day', () => {
  const s = run([25600, 24700, 25100]);
  assert.equal(s.breachDay, null);
  assert.deepEqual([s.profit, s.largestDay, s.requiredTotal, s.toTarget, s.floor, s.buffer], [100, 600, 1500, 1400, 24600, 500]);
});
test('case 8: [25000.01] exact cents', () => {
  const s = run([25000.01]);
  assert.deepEqual([s.profit, s.floor, s.buffer, s.toTarget], [0.01, 24000.01, 1000, 1249.99]);
});
test('case 9: [25150] + live +120: live never raises the floor', () => {
  const s = run([25150], 120);
  assert.deepEqual([s.balance, s.floor, s.buffer], [25270, 24150, 1120]);
});
test('case 10: [25150] + live -1200: below the floor intraday', () => {
  const s = run([25150], -1200);
  assert.equal(s.balance, 23950);
  assert.ok(s.balance < s.floor);
  assert.equal(s.breachDay, null, 'no end-of-day breach is recorded from a live number');
  // Reviewer decision (Mission 003): status DANGER, no breach day, reason says "closing here".
  assert.equal(s.status, 'DANGER');
  assert.ok(s.reasons.some(r => r.includes('closing here')), s.reasons.join(' '));
});
