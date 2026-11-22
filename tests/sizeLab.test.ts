/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEval, contractsFor, tradeUsd, byDay, filterTrades, historical, fullHistory, LabTrade, Account, Sizing, Costs } from '../src/shared/sizeLab';

const acct: Account = { start: 25000, target: 1250, maxDd: 1000, ddType: 'eod', lockAtStart: false, dailyLoss: null, dailyLossFails: false, consistencyPct: null, minDays: null, maxContracts: 20 };
const fixed1: Sizing = { contract: 'MNQ', mode: 'fixed', contracts: 1, riskUsd: 0, pctRoom: 0, maxStopUsd: null, halveAfterLosses: 0, myDailyStop: null, myDailyTarget: null, maxTradesDay: null };
const free: Costs = { commission: 0, slipPts: 0 };
// one trade a day: 40 pt stop, result +2R (win) or -1R (loss); adverse 10 pts on wins, full stop on losses
const tr = (d: string, r: number): LabTrade => [d, 600, 1, 40, r, r > 0 ? 10 : 40, 0];
const day = (k: number) => `2026-01-${String(k).padStart(2, '0')}`;

test('size modes: fixed, $ risk, % of room, max stop, halving, max contracts', () => {
  const t = tr(day(2), 2);
  assert.equal(contractsFor(t, fixed1, acct, 0, 1000), 1);
  assert.equal(contractsFor(t, { ...fixed1, mode: 'risk', riskUsd: 250 }, acct, 0, 1000), 3);       // 40 pts x $2 = $80 a contract
  assert.equal(contractsFor(t, { ...fixed1, mode: 'pctRoom', pctRoom: 20 }, acct, 0, 1000), 2);     // $200 of $1,000 room
  assert.equal(contractsFor(t, { ...fixed1, maxStopUsd: 50 }, acct, 0, 1000), 0);                  // $80 stop > $50 -> skip
  assert.equal(contractsFor(t, { ...fixed1, mode: 'risk', riskUsd: 250, halveAfterLosses: 2 }, acct, 2, 1000), 1);
  assert.equal(contractsFor(t, { ...fixed1, contracts: 50 }, acct, 0, 1000), 20);
  assert.equal(tradeUsd(t, 2, fixed1, { commission: 1, slipPts: 0.5 }), 2 * (2 * 40 * 2 - 0.5 * 2 - 1));
});

test('passes after enough wins; consistency rule delays the pass', () => {
  const days = byDay([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => tr(day(k), 2)));                     // +$160 a day at 1 MNQ
  const p = runEval(days, { ...acct, target: 600 }, fixed1, free);
  assert.equal(p.result, 'pass'); assert.equal(p.days, 4);                                          // 4 x 160 = 640
  const big = byDay([tr(day(1), 10), ...[2, 3, 4, 5, 6, 7, 8].map(k => tr(day(k), 2))]);          // day 1 = $800
  const c = runEval(big, { ...acct, target: 600, consistencyPct: 50 }, fixed1, free);
  assert.equal(c.result, 'pass'); assert.ok(c.days > 1, 'had to keep trading until the best day was <= 50%');
});

test('fails on the drawdown, including the adverse move inside a winning trade (intraday)', () => {
  const losses = byDay([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(k => tr(day(k), -1)));  // -$80 a day
  const f = runEval(losses, acct, fixed1, free);
  assert.equal(f.result, 'fail'); assert.equal(f.why, 'hit the max drawdown');
  // a winner that first went 600 pts against: 600 x $2 = $1,200 > $1,000 room
  const deep: LabTrade = [day(1), 600, 1, 700, 1, 600, 0];
  assert.equal(runEval(byDay([deep]), acct, fixed1, free).result, 'fail');
});

test('filters, history and full curve', () => {
  const all: LabTrade[] = [[day(1), 580, 1, 40, 2, 10, 0], [day(1), 800, 1, 40, -1, 40, 1], [day(2), 600, -1, 40, 2, 5, 0]];
  assert.equal(filterTrades(all, { from: '', to: '', startMin: 570, endMin: 690, skipNews: false }).length, 2);
  assert.equal(filterTrades(all, { from: '', to: '', startMin: 0, endMin: 2000, skipNews: true }).length, 2);
  const h = historical(byDay(all), { ...acct, target: 100 }, fixed1, free);
  assert.equal(h.runs, 1); assert.equal(h.passRate, 1);
  const fh = fullHistory(byDay(all), acct, fixed1, free);
  assert.equal(fh.taken, 3); assert.equal(fh.totalUsd, 160 - 80 + 160); assert.equal(fh.maxDdUsd, 80);
});

test('CSV trades: flexible header, direction words, default adverse move, bad rows skipped', () => {
  const { parseTradesCsv } = require('../src/shared/sizeLab');
  const csv = 'Date,Time,Side,Stop_pts,R,News\n2026-01-05,10:15,Long,40,2,0\n2026-01-02,9:45,short,30,-1,1\nbad,row,x,1,1,0\n';
  const r = parseTradesCsv(csv);
  assert.equal(r.trades.length, 2);
  assert.deepEqual(r.trades[0], ['2026-01-02', 585, -1, 30, -1, 30, 1]);   // sorted; loser's adverse = its stop
  assert.deepEqual(r.trades[1], ['2026-01-05', 615, 1, 40, 2, 0, 0]);
  assert.equal(r.errors.length, 1);
  assert.equal(parseTradesCsv('a,b\n1,2').trades.length, 0);
});

test('costs per fill: targets (limit) have no exit slippage, stops and time exits do', () => {
  const { tradeUsd: tu } = require('../src/shared/sizeLab');
  const c = { commission: 1, slipEntry: 0.5, slipExit: 0.5 };
  const tgt: LabTrade = [day(1), 600, 1, 40, 2, 5, 0, 0, 640, 80];
  const stp: LabTrade = [day(1), 600, 1, 40, -1, 40, 0, 1, 620, 3];
  assert.equal(tu(tgt, 1, fixed1, c), 2 * 40 * 2 - 0.5 * 2 - 1);            // entry slip + commission only
  assert.equal(tu(stp, 1, fixed1, c), -40 * 2 - (0.5 + 0.5) * 2 - 1);       // + exit slip on the stop
});

test('one trade at a time skips a signal while the previous trade is open', () => {
  const t1: LabTrade = [day(1), 600, 1, 40, 2, 5, 0, 0, 660, 80];
  const t2: LabTrade = [day(1), 630, 1, 40, 2, 5, 0, 0, 690, 80];            // starts at 10:30, t1 open until 11:00
  const t3: LabTrade = [day(1), 700, 1, 40, -1, 40, 0, 1, 720, 2];
  const days = byDay([t1, t2, t3]);
  assert.equal(fullHistory(days, acct, fixed1, free).taken, 3);
  const one = fullHistory(days, acct, { ...fixed1, oneAtATime: true }, free);
  assert.equal(one.taken, 2); assert.equal(one.skipped, 1);
});

test('firm daily loss is checked while a trade is open; intraday trailing uses the best open profit', () => {
  const big: LabTrade = [day(1), 600, 1, 100, -1, 100, 0, 1, 630, 0];       // -$200 at 1 MNQ
  const a2 = { ...acct, dailyLoss: 150, dailyLossFails: true };
  assert.equal(runEval(byDay([big]), a2, fixed1, free).why, 'hit the daily loss limit');
  const soft = runEval(byDay([big, [day(2), 600, 1, 40, 2, 5, 0, 0, 640, 80] as LabTrade]), { ...a2, dailyLossFails: false, target: 99999 }, fixed1, free);
  assert.equal(soft.result, 'open'); assert.equal(Math.round(soft.profit), -150 + 160);   // flattened at -150, then +160
  // intraday trailing: a trade ran +600 pts ($1,200) open, then closed flat -> floor rose to +200 above start -> breach
  const giveBack: LabTrade = [day(1), 600, 1, 700, 0, 5, 0, 2, 700, 600];
  const intr = { ...acct, ddType: 'intraday' as const };
  assert.equal(runEval(byDay([giveBack]), intr, fixed1, free).result, 'fail');
  assert.equal(runEval(byDay([giveBack]), acct, fixed1, free).result, 'open');           // EOD trailing: fine
});

test('no-edge control has zero average after costs; eras and funded payouts', () => {
  const { noEdgeTrades, byEra, runFunded } = require('../src/shared/sizeLab');
  const c = { commission: 1, slipEntry: 0.5, slipExit: 0.5 };
  const tr: LabTrade[] = [1, 2, 3, 4, 5, 6].map(k => [day(k), 600, 1, 40, k % 2 ? 2 : -1, 10, 0, k % 2 ? 0 : 1, 640, 5]);
  const z = noEdgeTrades(tr, fixed1, c);
  const net = z.reduce((s2: number, t: LabTrade) => s2 + tradeUsd(t, 1, fixed1, c), 0);
  assert.ok(Math.abs(net) < 1e-6, `net ${net}`);
  const eras = byEra(byDay(tr), acct, fixed1, c);
  assert.equal(eras.length, 3); assert.equal(eras[2].days, 6);
  // funded: +$160 a day, payout every $300 above a $100 buffer, 80% split -> withdrawals happen, no breach
  const wins = byDay([1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => tr2(k)));
  function tr2(k: number): LabTrade { return [day(k), 600, 1, 40, 2, 5, 0, 0, 640, 80]; }
  const f = runFunded(wins, acct, fixed1, free, { payoutEvery: 300, buffer: 100, split: 80, months: 12 });
  assert.equal(f.lost, false); assert.ok(f.payouts >= 3); assert.equal(f.paid, f.payouts * 240);
});
