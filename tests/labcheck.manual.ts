/// <reference types="node" />
// Manual cross-check of the Size & Pass Lab engine against the earlier Python prop simulation
// (run: node --require ts-node/register tests/labcheck.manual.ts). Not part of npm test.
import { filterTrades, byDay, historical, bootstrap, fullHistory, Account, Sizing } from '../src/shared/sizeLab';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const data = require('../client/src/data/bpTrades.json');
const T = data.trades;
// Python sim (2026-11-21): 50K, $3k target, $2k EOD trailing, +1 pt slippage -> pass 57% / 43% / 39% at $100 / $200 / $300
const a: Account = { start: 50000, target: 3000, maxDd: 2000, ddType: 'eod', lockAtStart: false, dailyLoss: null, dailyLossFails: false, consistencyPct: null, minDays: null, maxContracts: 100 };
for (const risk of [100, 200, 300]) {
  const s: Sizing = { contract: 'MNQ', mode: 'risk', contracts: 1, riskUsd: risk, pctRoom: 0, maxStopUsd: null, halveAfterLosses: 0, myDailyStop: null, myDailyTarget: null, maxTradesDay: null };
  for (const morning of [false, true]) {
    const days = byDay(filterTrades(T, { from: '', to: '', startMin: 575, endMin: morning ? 690 : 930, skipNews: false }));
    const c = { commission: 1, slipPts: 1.5 };
    const h = historical(days, a, s, c), b = bootstrap(days, a, s, c, 1500), f = fullHistory(days, a, s, c);
    console.log(`$${risk} MNQ ${morning ? 'morning' : 'all day'}: real-order pass ${Math.round(h.passRate * 100)}% (${h.runs}) ${h.monthsToPass.toFixed(0)}mo | shuffled ${Math.round(b.passRate * 100)}% ${b.monthsToPass.toFixed(0)}mo | total $${Math.round(f.totalUsd)} maxDD $${Math.round(f.maxDdUsd)} skipped ${f.skipped}`);
  }
}
