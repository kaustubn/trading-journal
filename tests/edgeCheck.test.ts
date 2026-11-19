/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normCdf, normInv, tStat, splitByDate, deflatedSharpe, bestDayShare, byYear, goLiveGate, EcTrade } from '../shared/edgeCheck';
import { parseBacktestCsv, parseMoney, parseWhen } from '../shared/backtestParse';

const day = (i: number) => new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10);

test('normal CDF / inverse are accurate', () => {
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(normInv(0.975) - 1.959964) < 1e-5);
  assert.ok(Math.abs(normInv(0.01) + 2.326348) < 1e-5);
});

test('split is by trading days: 50 / 25 / 25', () => {
  const tr: EcTrade[] = Array.from({ length: 100 }, (_, i) => ({ day: day(i), pnl: i < 50 ? 1 : i < 75 ? 2 : 3 }));
  const p = splitByDate(tr);
  assert.deepEqual(p.map(x => x.n), [50, 25, 25]);
  assert.deepEqual(p.map(x => x.avg), [1, 2, 3]);
});

test('deflated Sharpe falls as more variants were tried', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pnls = Array.from({ length: 200 }, () => 30 + (rnd() - 0.5) * 400);
  const one = deflatedSharpe(pnls, 1)!, many = deflatedSharpe(pnls, 500)!;
  assert.ok(one.prob > many.prob);
  assert.equal(one.sr0, 0);
  assert.ok(many.sr0 > 0);
  assert.equal(deflatedSharpe([1, 2, 3], 1), null); // too few
});

test('best-day share, by-year, t-stat', () => {
  assert.equal(bestDayShare([{ day: 'a', pnl: 300 }, { day: 'b', pnl: 100 }, { day: 'b', pnl: -100 }]), 1);
  assert.equal(bestDayShare([{ day: 'a', pnl: -5 }]), null);
  assert.deepEqual(byYear([{ day: '2024-01-02', pnl: 10 }, { day: '2025-01-02', pnl: -10 }]).map(y => [y.year, y.n]), [['2024', 1], ['2025', 1]]);
  assert.equal(tStat([1, 1, 1]), null);
});

test('go-live gate: reject losers, too-few, pass a strong steady edge, watch a weak one', () => {
  assert.equal(goLiveGate([{ day: day(0), pnl: 5 }], { variants: 1, maxDrawdownLimit: 2000 }).verdict, 'too few');
  const losing = Array.from({ length: 60 }, (_, i) => ({ day: day(i), pnl: i % 2 ? -60 : 40 }));
  assert.equal(goLiveGate(losing, { variants: 1, maxDrawdownLimit: 2000 }).verdict, 'reject');
  const strong = Array.from({ length: 200 }, (_, i) => ({ day: day(i), pnl: i % 3 === 0 ? -100 : 150 }));
  const g = goLiveGate(strong, { variants: 1, maxDrawdownLimit: 2000 });
  assert.equal(g.verdict, 'pass', g.reason);
  const weak = Array.from({ length: 60 }, (_, i) => ({ day: day(i), pnl: i % 2 ? -100 : 110 }));
  assert.equal(goLiveGate(weak, { variants: 50, maxDrawdownLimit: 2000 }).verdict, 'watch');
});

test('parsers: money, dates', () => {
  assert.equal(parseMoney('$1,234.50'), 1234.5);
  assert.equal(parseMoney('($250.00)'), -250);
  assert.equal(parseMoney('−12'), -12);
  assert.equal(parseMoney('1.234,50'), 1234.5);
  assert.equal(parseWhen('2024-03-05 09:35'), Date.UTC(2024, 2, 5, 9, 35));
  assert.equal(parseWhen('3/5/2024 1:05:00 PM'), Date.UTC(2024, 2, 5, 13, 5));
  assert.equal(parseWhen('3/5/2024 12:05:00 AM'), Date.UTC(2024, 2, 5, 0, 5));
});

test('TradingView list-of-trades export (two rows per trade, open trade left out)', () => {
  const csv = [
    'Trade #,Type,Signal,Date/Time,Price USD,Contracts,Profit USD,Profit %,Cumulative profit USD',
    '1,Exit long,TP,2024-03-05 10:10,18010,1,200,0.1,200',
    '1,Entry long,L,2024-03-05 09:35,18000,1,,,',
    '2,Exit short,SL,2024-03-06 10:00,18030,1,-300,-0.2,-100',
    '2,Entry short,S,2024-03-06 09:40,18015,1,,,',
    '3,Exit long,Open,2024-03-07 15:59,18100,1,50,0.1,-50',
    '3,Entry long,L,2024-03-07 09:31,18090,1,,,',
  ].join('\n');
  const r = parseBacktestCsv(csv);
  assert.equal(r.format, 'tradingview');
  assert.equal(r.trades.length, 2);
  assert.deepEqual(r.trades.map(t => [t.side, t.pnl, t.qty]), [['long', 200, 1], ['short', -300, 1]]);
  assert.ok(r.warnings.some(w => /open trade/.test(w)));
});

test('NinjaTrader trades export', () => {
  const csv = [
    'Trade number,Instrument,Account,Strategy,Market pos.,Qty,Entry price,Exit price,Entry time,Exit time,Entry name,Exit name,Profit,Cum. net profit,Commission',
    '1,NQ 03-24,Sim101,ORB,Long,1,18000,18010,3/5/2024 9:35:00 AM,3/5/2024 10:10:00 AM,L,TP,$195.94,$195.94,$4.06',
    '2,NQ 03-24,Sim101,ORB,Short,2,18015,18030,3/6/2024 9:40:00 AM,3/6/2024 10:00:00 AM,S,SL,($608.12),($412.18),$8.12',
  ].join('\n');
  const r = parseBacktestCsv(csv);
  assert.equal(r.format, 'ninjatrader');
  assert.deepEqual(r.trades.map(t => [t.side, t.qty, t.pnl, t.symbol]), [['long', 1, 195.94, 'NQ 03-24'], ['short', 2, -608.12, 'NQ 03-24']]);
});

test('generic CSV and an unreadable one', () => {
  const r = parseBacktestCsv('date,symbol,side,qty,pnl\n2024-01-02,NQ,long,1,125\n2024-01-03,NQ,short,1,-80\nbad,NQ,long,1,x');
  assert.equal(r.format, 'generic');
  assert.equal(r.trades.length, 2);
  assert.equal(r.skipped, 1);
  const bad = parseBacktestCsv('foo,bar\n1,2');
  assert.equal(bad.trades.length, 0);
  assert.match(bad.warnings[0], /Could not find/);
});
