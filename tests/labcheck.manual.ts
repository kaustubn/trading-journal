/// <reference types="node" />
// Manual check of the Size & Pass Lab on the breakout pullback trades (run: node --require ts-node/register tests/labcheck.manual.ts).
// Not part of npm test (needs client/src/data/bpTrades.json, which is private and not in the repo).
import { filterTrades, byDay, historical, byEra, noEdgeTrades, Account, Sizing, Costs } from '../src/shared/sizeLab';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const data = require('../client/src/data/bpTrades.json');
const costs: Costs = { commission: 1, slipEntry: 0.5, slipExit: 0.5 };
const accounts: [string, Account][] = [
  ['50K $3k/$2k EOD', { start: 50000, target: 3000, maxDd: 2000, ddType: 'eod', lockAtStart: false, dailyLoss: null, dailyLossFails: false, consistencyPct: null, minDays: null, maxContracts: 100 }],
  ['25K $1.25k/$1k EOD 50% consistency', { start: 25000, target: 1250, maxDd: 1000, ddType: 'eod', lockAtStart: false, dailyLoss: null, dailyLossFails: false, consistencyPct: 50, minDays: null, maxContracts: 20 }],
];
for (const strict of [false, true]) {
  const T = strict ? data.tradesStrict : data.trades;
  for (const [name, a] of accounts) for (const risk of [100, 200]) for (const morning of [false, true]) {
    const s: Sizing = { contract: 'MNQ', mode: 'risk', contracts: 1, riskUsd: risk, pctRoom: 0, maxStopUsd: null, halveAfterLosses: 0, myDailyStop: null, myDailyTarget: null, maxTradesDay: null, oneAtATime: true };
    const picked = filterTrades(T, { from: '', to: '', startMin: 575, endMin: morning ? 690 : 930, skipNews: false });
    const days = byDay(picked);
    const h = historical(days, a, s, costs, { payoutEvery: 1000, buffer: 500, split: 90, months: 12 });
    const luck = historical(byDay(noEdgeTrades(picked, s, costs)), a, s, costs);
    const eras = byEra(days, a, s, costs).map(e => `${e.label} ${Math.round(e.passRate * 100)}%`).join(' ');
    console.log(`${strict ? 'strict' : 'touch '} | ${name} | $${risk} ${morning ? 'morning' : 'all day'}: pass ${Math.round(h.passRate * 100)}% (6mo ${Math.round(h.passIn6 * 100)}%) vs luck ${Math.round(luck.passRate * 100)}% | ${h.monthsToPass.toFixed(0)} mo | ${eras} | funded paid $${Math.round(h.funded?.avgPaid ?? 0)} lost ${Math.round((h.funded?.lostRate ?? 0) * 100)}%`);
  }
}
