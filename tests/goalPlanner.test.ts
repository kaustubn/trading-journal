/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseline, tradingDays, estimateWinRate, coinFlipWinRate, plan, simulate, styleLevels, STYLES, progress, TradeLite } from '../src/shared/goalPlanner';

const nq = (pnl: number, qty: number, day: string): TradeLite => ({ pnl, qty, pv: 20, day });

test('baseline: win rate, points from money, trades per day, size step', () => {
  // 3 wins of 20 pts on 1 NQ, 2 losses of 10 pts on 2 NQ, over 2 days
  const b = baseline([nq(400, 1, 'a'), nq(400, 1, 'a'), nq(-400, 2, 'a'), nq(400, 1, 'b'), nq(-400, 2, 'b'), nq(0, 1, 'b')]);
  assert.equal(b.trades, 5);                      // the scratch trade is ignored
  assert.equal(b.days, 2);
  assert.equal(b.winRate, 0.6);
  assert.equal(b.avgWinPts, 20); assert.equal(b.avgLossPts, 10);
  assert.equal(b.tradesPerDay, 2.5);
  assert.equal(b.sizeStep, 1); assert.equal(b.lotPv, 20);
  // Indian lots: quantities in multiples of 75, 1 rupee per point per unit
  const i = baseline([{ pnl: 750, qty: 75, pv: 1, day: 'x' }, { pnl: -1500, qty: 150, pv: 1, day: 'x' }]);
  assert.equal(i.sizeStep, 75); assert.equal(i.lotPv, 75); assert.equal(i.avgWinPts, 10); assert.equal(i.avgLossPts, 10);
});

test('tradingDays: weekdays only, inclusive', () => {
  assert.equal(tradingDays('2026-11-23', '2026-12-04'), 10);   // two full weeks
  assert.equal(tradingDays('2026-11-28', '2026-11-29'), 0);    // weekend
  assert.equal(tradingDays('2026-12-04', '2026-11-23'), 0);
});

test('win rate estimate keeps your edge over a coin flip when target:stop changes', () => {
  assert.equal(coinFlipWinRate(10, 10), 0.5);
  const b = baseline(Array.from({ length: 20 }, (_, k) => nq(k % 2 ? 400 : -200, 1, 'd' + (k >> 2))));   // 50% at 20:10
  // coin flip at 2:1 is 33%, so edge = +17%; at 1:1 the estimate is 50% + 17%
  assert.ok(Math.abs(estimateWinRate(b, 10, 10)! - (0.5 + 0.5 - 1 / 3)) < 1e-9);
  assert.equal(estimateWinRate(baseline([nq(400, 1, 'a')]), 10, 10), null);   // too few trades
});

test('plan: size needed, win rate needed, and the loss-limit cap', () => {
  // goal 2000 in 10 days, 1 trade/day, 20 pt target, 10 pt stop, NQ, no costs, 50% win rate:
  // EV per lot = .5*400 - .5*200 = 100/trade -> need 200/day -> 2 lots
  const r = plan({ goal: 2000, days: 10, targetPts: 20, stopPts: 10, tradesPerDay: 1, lots: null, winRate: 0.5, lotPv: 20, costPerLot: 0 });
  assert.equal(r.lotsNeeded, 2); assert.equal(r.lots, 2);
  assert.equal(r.perDay, 200); assert.equal(r.riskPerTrade, 400);
  assert.ok(Math.abs(r.winRateNeeded! - 0.5) < 1e-9);
  assert.ok(r.pReach! > 0.3 && r.pReach! < 0.8, String(r.pReach));
  // daily loss limit 300 -> a 2-lot loss is 400 -> capped to 1 lot
  const c = plan({ goal: 2000, days: 10, targetPts: 20, stopPts: 10, tradesPerDay: 1, lots: null, winRate: 0.5, lotPv: 20, costPerLot: 0, dailyLossLimit: 300 });
  assert.equal(c.maxLotsByRisk, 1); assert.equal(c.lots, 1); assert.ok(c.capped);
  // asking for 3 lots by hand with that limit is flagged
  assert.equal(plan({ goal: 2000, days: 10, targetPts: 20, stopPts: 10, tradesPerDay: 1, lots: 3, winRate: 0.5, lotPv: 20, costPerLot: 0, dailyLossLimit: 300 }).verdict, 'dangerous');
  // no edge measured
  assert.equal(plan({ goal: 2000, days: 10, targetPts: 20, stopPts: 10, tradesPerDay: 1, lots: null, winRate: null, lotPv: 20, costPerLot: 0 }).verdict, 'no-edge');
  // losing system
  assert.equal(plan({ goal: 2000, days: 10, targetPts: 10, stopPts: 10, tradesPerDay: 2, lots: 1, winRate: 0.4, lotPv: 20, costPerLot: 5 }).verdict, 'unrealistic');
  assert.equal(plan({ goal: 0, days: 10, targetPts: 10, stopPts: 10, tradesPerDay: 1, lots: 1, winRate: 0.5, lotPv: 20, costPerLot: 0 }).verdict, 'invalid');
});

test('simulate: seeded (same answer twice), certain win and certain loss', () => {
  const p = { goal: 1000, days: 10, tradesPerDay: 2, win: 100, loss: 100, winRate: 0.55 };
  assert.deepEqual(simulate(p, 500), simulate(p, 500));
  assert.equal(simulate({ ...p, winRate: 1 }, 100).pReach, 1);
  const lose = simulate({ ...p, winRate: 0, maxDrawdown: 500 }, 100);
  assert.equal(lose.pReach, 0); assert.equal(lose.pLimit, 1); assert.equal(lose.medianEnd, -500);
});

test('styles scale from your usual stop; progress pace', () => {
  const b = baseline(Array.from({ length: 12 }, (_, k) => nq(k % 2 ? 600 : -300, 1, 'd')));   // stop 15 pts
  const steady = styleLevels(STYLES[0], b, 10), runner = styleLevels(STYLES[2], b, 10);
  assert.deepEqual(steady, { stopPts: 9, targetPts: 9 });
  assert.deepEqual(runner, { stopPts: 18, targetPts: 63 });
  assert.equal(progress(1000, 600, 5, 10).status, 'ahead');
  assert.equal(progress(1000, 300, 5, 10).status, 'behind');
  assert.equal(progress(1000, 300, 5, 10).needPerDay, 140);
  assert.equal(progress(1000, 1200, 2, 10).status, 'done');
  assert.equal(progress(1000, 100, 0, 10).status, 'missed');
});

test('day targets: green-day rate + profit factor -> money per green day and the most per red day', () => {
  const { dayTargets } = require('../src/shared/goalPlanner');
  // goal 2000 in 10 days, 60% green days, PF 2 -> lost 2000, won 4000; 6 green days 666.67, 4 red days 500
  const t = dayTargets(2000, 10, 0.6, 2);
  assert.ok(t.ok);
  assert.ok(Math.abs(t.perGreenDay - 4000 / 6) < 1e-9);
  assert.equal(t.perRedDay, 500);
  assert.equal(t.won - t.lost, 2000);
  assert.equal(dayTargets(2000, 10, 0.6, 1).ok, false);
  assert.equal(dayTargets(2000, 10, 0, 2), null);
});

test('baseline day stats and currency conversion', () => {
  const { convert } = require('../src/shared/goalPlanner');
  const b = baseline([nq(400, 1, 'a'), nq(-200, 1, 'a'), nq(-300, 1, 'b'), nq(600, 1, 'c')]);   // days: +200, -300, +600
  assert.ok(Math.abs(b.greenDayRate! - 2 / 3) < 1e-9);
  assert.ok(Math.abs(b.dayProfitFactor! - 800 / 300) < 1e-9);
  assert.equal(b.avgGreenDay, 400); assert.equal(b.avgRedDay, 300);
  assert.equal(b.profitFactor, 1000 / 500);
  const cad = { CAD: 1, USD: 1.4, INR: 0.016 };
  assert.ok(Math.abs(convert(1000, 'CAD', 'USD', cad) - 714.2857) < 1e-3);
  assert.ok(Math.abs(convert(1000, 'CAD', 'INR', cad) - 62500) < 1e-6);
  assert.ok(Number.isNaN(convert(1, 'EUR', 'CAD', cad)));
});
