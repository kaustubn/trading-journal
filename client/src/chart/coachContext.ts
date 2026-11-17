// What Claude sees when it coaches: the candles on each open window (only up to the
// replay cursor — the future stays hidden), simple indicator values, the day's levels,
// the order or position, today's trades and the instant rule checks.
import type { KLineData } from 'klinecharts';
import type { ClosedTrade, OrderInput, Position, ReplayEngine } from './replay';
import { tfLabel } from './config';
import { fmtWall } from './time';
import { tradesToday, fmtWindows, CoachRules } from './coach';

export interface PaneData { tf: number; bars: KLineData[]; }

const round2 = (v: number) => Math.round(v * 100) / 100;

function ema(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  const k = 2 / (n + 1);
  let e = closes.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return round2(e);
}
function atr(bars: KLineData[], n: number): number | null {
  if (bars.length < n + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], pc = bars[i - 1].close;
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)));
  }
  let a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return round2(a);
}

const brief = (t: ClosedTrade) => ({
  side: t.side, qty: t.qty, contract: t.contract, entry: t.entry, exit: t.exit, stop: t.stop, target: t.target,
  entryET: fmtWall(t.entryTime, 'ET'), exitET: fmtWall(t.exitTime, 'ET'), reason: t.reason,
  pnl: t.pnl, r: round2(t.r), setup: t.setup || null, ruleBreaks: t.ruleBreaks,
});

export interface ContextInput {
  mode: 'replay' | 'live';
  now: number;                       // replay cursor end (or wall clock) in ms
  panes: PaneData[];
  levels: unknown;
  rules: CoachRules;
  engine: ReplayEngine | null;
  order?: OrderInput | null;
  ruleChecks?: string[];
  trade?: ClosedTrade | null;
}

export function buildContext(x: ContextInput) {
  const windows = x.panes.map(p => {
    const n = p.tf <= 5 ? 60 : p.tf <= 60 ? 40 : 20;
    const last = p.bars.slice(-n);
    const closes = p.bars.map(b => b.close);
    return {
      timeframe: tfLabel(p.tf),
      candles_note: 'oldest first: [time ET, open, high, low, close, volume]; the last candle may still be forming',
      candles: last.map(b => [fmtWall(b.timestamp, 'ET'), b.open, b.high, b.low, b.close, b.volume ?? 0]),
      ema21: ema(closes, 21), ema9: ema(closes, 9), atr14: atr(p.bars, 14),
    };
  });
  const e = x.engine;
  const trades = e ? tradesToday(e.trades, x.now) : [];
  const p: Position | null = e?.position ?? null;
  return {
    mode: x.mode === 'replay' ? 'bar replay (backtesting)' : 'live chart (forward testing)',
    symbol: 'NQ (E-mini Nasdaq-100), 1 point = $20 per NQ, $2 per MNQ',
    timeET: fmtWall(x.now, 'ET'),
    lastPrice: e?.price ?? (x.panes[0]?.bars.length ? x.panes[0].bars[x.panes[0].bars.length - 1].close : null),
    levels: x.levels,
    windows,
    rules: {
      primeWindowsET: fmtWindows(x.rules.windows), minRR: x.rules.minRR, maxRiskUsd: x.rules.maxRiskUsd,
      maxTradesPerDay: x.rules.maxTradesPerDay, maxLossesPerDay: x.rules.maxLossesPerDay,
      dailyLossUsd: x.rules.dailyLossUsd, cooldownMin: x.rules.cooldownMin,
    },
    ruleCheckResults: x.ruleChecks ?? [],
    order: x.order ? {
      side: x.order.side, qty: x.order.qty, contract: x.order.contract, stopPts: x.order.stopPts,
      target: x.order.targetUnit === 'R' ? `${x.order.target}R (${round2(x.order.stopPts * x.order.target)} pts)` : `${x.order.target} pts`,
      setup: x.order.setup || null, note: x.order.notes || null,
    } : null,
    openPosition: p ? {
      side: p.side, qty: p.qty, contract: p.contract, entry: p.entry, stop: p.stop, target: p.target,
      entryET: fmtWall(p.entryTime, 'ET'), openPnl: e?.openPnl ?? null, setup: p.setup || null, ruleBreaks: p.ruleBreaks,
    } : null,
    closedTrade: x.trade ? brief(x.trade) : null,
    tradesToday: trades.map(brief),
    dayPnl: round2(trades.reduce((s, t) => s + t.pnl, 0)),
  };
}
