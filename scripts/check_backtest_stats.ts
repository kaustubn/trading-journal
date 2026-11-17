/* Offline checks for client/src/utils/backtestStats.ts (hand-computed expectations). */
import type {
  TradeLite,
  PropRules,
  SimOutcome,
} from '../client/src/utils/backtestStats';

// client/package.json is "type": "module", which makes ts-node refuse to require() the client module
// as CommonJS. The module has no imports, so transpile it to CJS here and evaluate it directly.
declare const require: (id: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
declare const __dirname: string;
type Stats = typeof import('../client/src/utils/backtestStats');
function loadStats(): Stats {
  const fs = require('fs');
  const path = require('path');
  const ts = require('typescript');
  const file = path.join(__dirname, '..', 'client', 'src', 'utils', 'backtestStats.ts');
  const out: string = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function('module', 'exports', out)(mod, mod.exports);
  return mod.exports as unknown as Stats;
}
const { metrics, dailySeries, propSim, monteCarlo } = loadStats();

// Minimal ambient declarations: the root tsconfig has no node/dom types.
declare const console: { log(...args: unknown[]): void };
declare const process: { exit(code?: number): never };

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? '  -> ' + detail : ''}`);
  }
}
function near(a: number | null | undefined, b: number, eps = 1e-9): boolean {
  return typeof a === 'number' && Math.abs(a - b) <= eps;
}
function eq<T>(name: string, got: T, want: T): void {
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// ------------------------------------------------------------------ fixture
// Chronological: +100 +200 -50 | -150 0 -100 | +350 -50   (3 days)
const T0 = Date.UTC(2026, 0, 5, 14, 0, 0);
const seq: Array<[string, number, number | null | undefined]> = [
  ['2026-01-05', 100, 1],
  ['2026-01-05', 200, 2],
  ['2026-01-05', -50, undefined],
  ['2026-01-06', -150, -1],
  ['2026-01-06', 0, undefined],
  ['2026-01-06', -100, null],
  ['2026-01-07', 350, undefined],
  ['2026-01-07', -50, undefined],
];
const chrono: TradeLite[] = seq.map(([day, pnl, r], i) => ({ t: T0 + i * 60000, day, pnl, r }));
// Hand the module a shuffled copy plus junk to prove sorting + finite filtering.
const shuffled: TradeLite[] = [5, 2, 7, 0, 3, 6, 1, 4].map((i) => chrono[i]);
const junk: TradeLite[] = [...shuffled, { t: T0, day: '2026-01-05', pnl: NaN }, { t: T0, day: '2026-01-05', pnl: Infinity }];

// ------------------------------------------------------------------ metrics
{
  const m = metrics(junk, 1000);
  check('metrics: count/wins/losses/breakeven', m.count === 8 && m.wins === 3 && m.losses === 4 && m.breakeven === 1);
  check('metrics: winRate 3/8', near(m.winRate, 0.375));
  check('metrics: net 300', near(m.net, 300));
  check('metrics: grossProfit 650 / grossLoss 350', near(m.grossProfit, 650) && near(m.grossLoss, 350));
  check('metrics: profitFactor 650/350', near(m.profitFactor, 650 / 350));
  check('metrics: avgWin 650/3, avgLoss 87.5', near(m.avgWin, 650 / 3) && near(m.avgLoss, 87.5));
  check('metrics: payoff', near(m.payoff, 650 / 3 / 87.5));
  check('metrics: expectancy 37.5', near(m.expectancy, 37.5));
  check('metrics: expectancyR mean(1,2,-1)=2/3', near(m.expectancyR, 2 / 3));
  check('metrics: tradingDays 3, avg trades/day 8/3', m.tradingDays === 3 && near(m.avgTradesPerDay, 8 / 3));
  check('metrics: greenDays 2 redDays 1 rate 2/3', m.greenDays === 2 && m.redDays === 1 && near(m.greenDayRate, 2 / 3));
  eq('metrics: bestDay', m.bestDay, { day: '2026-01-07', pnl: 300 });
  eq('metrics: worstDay', m.worstDay, { day: '2026-01-06', pnl: -250 });
  check('metrics: best/worst trade 350/-150', m.bestTrade === 350 && m.worstTrade === -150);
  check('metrics: longestWinStreak 2', m.longestWinStreak === 2);
  check('metrics: longestLossStreak 2 (breakeven breaks)', m.longestLossStreak === 2);
  // cum 100,300,250,100,100,0,350,300 ; peak 300 -> trough 0
  check('metrics: maxDrawdown 300', near(m.maxDrawdown, 300));
  check('metrics: maxDrawdownPct 300/(1000+300)', near(m.maxDrawdownPct, 300 / 1300));
  check('metrics: maxDrawdownPct null without startBalance', metrics(chrono).maxDrawdownPct === null);
  check('metrics: maxDrawdownDays 1 (only day 2 below high)', m.maxDrawdownDays === 1);
  check('metrics: recoveryFactor 300/300', near(m.recoveryFactor, 1));
  // daily pnl 250,-250,300: mean 100, sample var (150^2+350^2+200^2)/2 = 92500
  const sd = Math.sqrt(92500);
  check('metrics: dailyStdev', near(m.dailyStdev, sd, 1e-9));
  check('metrics: sharpe', near(m.sharpe, (100 / sd) * Math.sqrt(252), 1e-9));
  const dsd = Math.sqrt(62500 / 3);
  check('metrics: sortino', near(m.sortino, (100 / dsd) * Math.sqrt(252), 1e-9));

  const e = metrics([]);
  check('metrics: empty set is safe', e.count === 0 && e.winRate === 0 && e.profitFactor === null && e.sharpe === null && e.bestDay === null);
  const allWins = metrics([{ t: 1, day: 'a', pnl: 10 }, { t: 2, day: 'b', pnl: 10 }]);
  check('metrics: no losses -> profitFactor null, sharpe null (zero stdev)', allWins.profitFactor === null && allWins.sharpe === null && allWins.sortino === null);
}

// ------------------------------------------------------------------ dailySeries
{
  const d = dailySeries(junk);
  eq('dailySeries: days', d.map((x) => x.day), ['2026-01-05', '2026-01-06', '2026-01-07']);
  eq('dailySeries: pnl', d.map((x) => x.pnl), [250, -250, 300]);
  eq('dailySeries: trades', d.map((x) => x.trades), [3, 3, 2]);
  eq('dailySeries: cum', d.map((x) => x.cum), [250, 0, 300]);
  eq('dailySeries: peak', d.map((x) => x.peak), [250, 250, 300]);
  eq('dailySeries: dd', d.map((x) => x.dd), [0, 250, 0]);
  const neg = dailySeries([{ t: 1, day: '2026-02-01', pnl: -100 }]);
  check('dailySeries: peak starts at 0 (first-day loss gives dd 100)', neg[0].peak === 0 && neg[0].dd === 100);
}

// ------------------------------------------------------------------ propSim helpers
function mk(daysOfPnl: number[][]): TradeLite[] {
  const out: TradeLite[] = [];
  let t = Date.UTC(2026, 1, 1);
  daysOfPnl.forEach((pnls, di) => {
    const day = `2026-02-${String(di + 1).padStart(2, '0')}`;
    pnls.forEach((pnl) => {
      out.push({ t, day, pnl });
      t += 60000;
    });
    t = Date.UTC(2026, 1, di + 2);
  });
  return out;
}
const base: PropRules = {
  start: 50000,
  target: 3000,
  maxDrawdown: 2000,
  trailing: 'static',
  lockAtStart: false,
  dailyLoss: null,
  consistencyPct: null,
  minDays: 1,
};
function first(trades: TradeLite[], rules: PropRules): SimOutcome {
  return propSim(trades, rules, 1).outcomes[0];
}
function show(o: SimOutcome): string {
  return JSON.stringify(o);
}

// (a) pass with target and minDays
{
  const tr = mk([[200], [200], [10]]);
  const r3 = { ...base, target: 300, minDays: 3 };
  const o = first(tr, r3);
  check('propSim a: target hit day 2 but minDays 3 -> passes on day 3', o.result === 'pass' && o.days === 3 && o.trades === 3 && o.reason === 'Target reached' && o.endBalance === 50410, show(o));
  const o1 = first(tr, { ...r3, minDays: 1 });
  check('propSim a: minDays 1 -> passes on day 2', o1.result === 'pass' && o1.days === 2 && o1.trades === 2 && o1.endBalance === 50400, show(o1));
  const o2 = first(tr, { ...r3, target: 5000 });
  check('propSim a: target not reached -> open / Ran out of data', o2.result === 'open' && o2.reason === 'Ran out of data' && o2.days === 3, show(o2));
}

// (b) static max drawdown failure
{
  const rules = { ...base, maxDrawdown: 1000 };
  const o = first(mk([[500], [-800, -800]]), rules);
  check('propSim b: static floor 49000, 50500 -> 49700 ok -> 48900 fails', o.result === 'fail' && o.reason === 'Max drawdown' && o.days === 2 && o.trades === 3 && o.endBalance === 48900, show(o));
  const o2 = first(mk([[-1000]]), rules);
  check('propSim b: landing exactly on floor fails (<=)', o2.result === 'fail' && o2.reason === 'Max drawdown' && o2.endBalance === 49000, show(o2));
  const o3 = first(mk([[2000], [-2500]]), rules);
  check('propSim b: static floor does not trail (50000-1000 stays)', o3.result === 'open' && o3.endBalance === 49500, show(o3));
}

// (c) eod trailing
{
  const eod: PropRules = { ...base, maxDrawdown: 1000, target: 100000, trailing: 'eod' };
  const intr: PropRules = { ...eod, trailing: 'intraday' };
  const stat: PropRules = { ...eod, trailing: 'static' };
  const day1 = [2000, -1500];

  const a = first(mk([day1, [-900]]), eod);
  check('propSim c: EOD ignores intraday peak (floor 49500 after day 1), -900 survives', a.result === 'open' && a.endBalance === 49600, show(a));
  const ai = first(mk([day1, [-900]]), intr);
  check('propSim c: intraday on same data fails on day 1 (high 52000 -> floor 51000)', ai.result === 'fail' && ai.days === 1 && ai.trades === 2 && ai.endBalance === 50500, show(ai));

  const b = first(mk([day1, [-1100]]), eod);
  check('propSim c: day ending higher raises EOD floor to 49500; 49400 fails', b.result === 'fail' && b.reason === 'Max drawdown' && b.days === 2 && b.endBalance === 49400, show(b));
  const bs = first(mk([day1, [-1100]]), stat);
  check('propSim c: same data under static survives (floor stays 49000)', bs.result === 'open' && bs.endBalance === 49400, show(bs));

  const c = first(mk([[1000], [-1200, 2000]]), eod);
  check('propSim c: intraday dip below EOD floor still fails even if day would end higher', c.result === 'fail' && c.days === 2 && c.trades === 2 && c.endBalance === 49800, show(c));
}

// (d) lockAtStart
{
  const r: PropRules = { ...base, maxDrawdown: 1000, target: 100000, trailing: 'eod', lockAtStart: true };
  const noLock: PropRules = { ...r, lockAtStart: false };
  const o = first(mk([[3000], [-2500]]), r);
  check('propSim d: locked floor stays at 50000 (not 52000); 50500 survives', o.result === 'open' && o.endBalance === 50500, show(o));
  const on = first(mk([[3000], [-2500]]), noLock);
  check('propSim d: without lock the floor trails to 52000 and fails day 2', on.result === 'fail' && on.days === 2, show(on));
  const o3 = first(mk([[3000], [-2500], [-500]]), r);
  check('propSim d: lock -> floor exactly start; balance 50000 fails day 3', o3.result === 'fail' && o3.days === 3 && o3.endBalance === 50000, show(o3));
  const oi = first(mk([[3000], [-2500]]), { ...r, trailing: 'intraday' });
  check('propSim d: intraday + lock also capped at start', oi.result === 'open' && oi.endBalance === 50500, show(oi));
}

// (e) consistency rule
{
  const r: PropRules = { ...base, maxDrawdown: 5000, target: 1000, consistencyPct: 50 };
  const o = first(mk([[900], [300], [700]]), r);
  check('propSim e: day 2 profit 1200 but best day 900 > 600 blocks; day 3 (1900, 900<=950) passes', o.result === 'pass' && o.days === 3 && o.trades === 3 && o.endBalance === 51900, show(o));
  const ob = first(mk([[900], [300]]), r);
  check('propSim e: data ends while blocked -> open / consistency reason', ob.result === 'open' && ob.reason === 'Target hit but consistency not met' && ob.days === 2, show(ob));
  const on = first(mk([[900], [300]]), { ...r, consistencyPct: null });
  check('propSim e: no consistency rule -> passes on day 2', on.result === 'pass' && on.days === 2, show(on));
}

// (f) daily loss limit
{
  const r: PropRules = { ...base, maxDrawdown: 5000, target: 100000, dailyLoss: 500 };
  const o = first(mk([[-200, -200], [300, -800]]), r);
  check('propSim f: day running P&L +300 then -500 <= -500 fails', o.result === 'fail' && o.reason === 'Daily loss limit' && o.days === 2 && o.trades === 4 && o.endBalance === 49100, show(o));
  const o2 = first(mk([[-400], [-400]]), r);
  check('propSim f: limit is per day, not cumulative', o2.result === 'open' && o2.endBalance === 49200, show(o2));
  const o3 = first(mk([[-300, 200, -450]]), r);
  check('propSim f: -300+200-450 = -550 fails; -100 mid-day does not', o3.result === 'fail' && o3.trades === 3, show(o3));
}

// summary + start selection
{
  const tr = mk([[100], [100], [100], [100], [100]]);
  const rules: PropRules = { ...base, maxDrawdown: 5000, target: 200 };
  const r = propSim(tr, rules);
  check('propSim summary: 5 starts, 4 pass, 1 open', r.summary.runs === 5 && r.summary.pass === 4 && r.summary.open === 1 && r.summary.fail === 0, JSON.stringify(r.summary));
  check('propSim summary: rates / median / avg', near(r.summary.passRate, 0.8) && near(r.summary.failRate, 0) && r.summary.medianDaysToPass === 2 && r.summary.avgDaysToPass === 2);
  eq('propSim summary: reasons', r.summary.reasons, { 'Target reached': 4, 'Ran out of data': 1 });
  const lim = propSim(tr, rules, 3);
  eq('propSim maxStarts=3 of 5 days: evenly spaced, includes first', lim.outcomes.map((o) => o.startDay), ['2026-02-01', '2026-02-03', '2026-02-05']);
  check('propSim: unsorted input handled', propSim([...tr].reverse(), rules).summary.pass === 4);
}

// ------------------------------------------------------------------ monteCarlo
{
  const pn = chrono.map((x) => x.pnl);
  const a = monteCarlo(pn, { runs: 300, seed: 7, ruinDrawdown: 250 });
  const b = monteCarlo(pn, { runs: 300, seed: 7, ruinDrawdown: 250 });
  check('monteCarlo: final identical for every run (p5=p50=p95=net)', a.final.p5 === 300 && a.final.p50 === 300 && a.final.p95 === 300, JSON.stringify(a.final));
  check('monteCarlo: p5 <= p50 <= p95 (maxDrawdown)', a.maxDrawdown.p5 <= a.maxDrawdown.p50 && a.maxDrawdown.p50 <= a.maxDrawdown.p95);
  check('monteCarlo: maxDrawdown bounded by sum of losses (350) and >= largest loss (150)', a.maxDrawdown.p5 >= 150 && a.maxDrawdown.p95 <= 350, JSON.stringify(a.maxDrawdown));
  check('monteCarlo: loss streak p50 <= p95 and within 1..4', a.longestLossStreak.p50 <= a.longestLossStreak.p95 && a.longestLossStreak.p50 >= 1 && a.longestLossStreak.p95 <= 4);
  check('monteCarlo: deterministic with fixed seed', JSON.stringify(a) === JSON.stringify(b));
  check('monteCarlo: default seed deterministic', JSON.stringify(monteCarlo(pn)) === JSON.stringify(monteCarlo(pn)));
  check('monteCarlo: ruinProb in 0..1', a.ruinProb !== null && a.ruinProb >= 0 && a.ruinProb <= 1, String(a.ruinProb));
  check('monteCarlo: ruinProb 1 when threshold 0, 0 when huge, null when omitted',
    monteCarlo(pn, { runs: 50, ruinDrawdown: 0 }).ruinProb === 1 &&
      monteCarlo(pn, { runs: 50, ruinDrawdown: 1e9 }).ruinProb === 0 &&
      monteCarlo(pn, { runs: 50 }).ruinProb === null);
  check('monteCarlo: 20 sample curves, start 0, end net', a.sampleCurves.length === 20 && a.sampleCurves.every((c) => c[0] === 0 && c[c.length - 1] === 300));
  check('monteCarlo: runs echoed', a.runs === 300 && monteCarlo(pn).runs === 1000);

  // size / downsampling / speed
  const big: number[] = [];
  let s = 1;
  for (let i = 0; i < 10000; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    big.push(Math.round((s / 4294967296 - 0.45) * 400));
  }
  const t0 = Date.now();
  const mb = monteCarlo(big, { runs: 1000 });
  const dt = Date.now() - t0;
  check('monteCarlo: 10k trades x 1000 runs, curves <= 200 points', mb.sampleCurves.every((c) => c.length <= 200 && c.length > 2), `${dt}ms`);
  check('monteCarlo: 10k trades x 1000 runs finishes in < 10s', dt < 10000, `${dt}ms`);
  console.log(`      (monteCarlo 10k x 1000: ${dt}ms)`);

  const bigTrades: TradeLite[] = big.map((pnl, i) => ({ t: i * 3600000, day: new Date(i * 3600000 * 6).toISOString().slice(0, 10), pnl }));
  const t1 = Date.now();
  const ps = propSim(bigTrades, { ...base, target: 2000, maxDrawdown: 3000, trailing: 'eod' });
  const dt1 = Date.now() - t1;
  check('propSim: 10k trades, default maxStarts finishes in < 10s', ps.summary.runs > 0 && dt1 < 10000, `${dt1}ms`);
  console.log(`      (propSim 10k trades: ${dt1}ms, ${ps.summary.runs} runs)`);
  const t2 = Date.now();
  const mm = metrics(bigTrades, 50000);
  console.log(`      (metrics 10k trades: ${Date.now() - t2}ms, net ${mm.net})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
