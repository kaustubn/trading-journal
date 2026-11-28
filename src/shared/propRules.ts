// Prop-firm drawdown rules + firm presets. Pure (no imports): used by the server (prop status) and the browser
// (rule editor). Tested in tests/propRules.test.ts.

export type DdType = 'eod' | 'intraday' | 'static';

export interface PropPreset {
  id: string; firm: string; plan: string; size: number;
  target: number | null; maxDrawdown: number | null; ddType: DdType; lockAtStart: boolean;
  dailyLoss: number | null; consistencyPct: number | null; minDays: number | null;
  note: string; checked: string; source: string;
  /** Eval Guard: once an end-of-day close reaches lockTrigger, the max-loss floor stops at lockFloor. */
  lockTrigger?: number; lockFloor?: number;
}

/**
 * Evaluation rules as numbers, taken from the app's Prop Firms page (client/src/data/propfirms.ts, verified June 2026).
 * Firms change rules often: the editor tells you to confirm with the firm. Unknown values are null (fill them in);
 * where the drawdown lock is not documented there, lockAtStart is false (the stricter assumption).
 */
const PF = 'Prop Firms page (firm sites, Jun 2026)';
export const PROP_PRESETS: PropPreset[] = [
  { id: 'topstep-50k', firm: 'Topstep', plan: '$50K Combine (Standard)', size: 50000, target: 3000, maxDrawdown: 2000, ddType: 'eod', lockAtStart: true, dailyLoss: 1000, consistencyPct: 50, minDays: null, note: 'EOD trailing, freezes at the start balance.', checked: '2026-06-12', source: PF },
  { id: 'apex-50k-eod', firm: 'Apex Trader Funding', plan: '$50K EOD (4.0)', size: 50000, target: 3000, maxDrawdown: 2500, ddType: 'eod', lockAtStart: false, dailyLoss: 1000, consistencyPct: null, minDays: null, note: 'EOD version has a daily loss limit.', checked: '2026-06-01', source: PF },
  { id: 'apex-50k-intraday', firm: 'Apex Trader Funding', plan: '$50K Intraday (4.0)', size: 50000, target: 3000, maxDrawdown: 2500, ddType: 'intraday', lockAtStart: false, dailyLoss: null, consistencyPct: null, minDays: null, note: 'Intraday trailing (follows open profit); no daily loss limit.', checked: '2026-06-01', source: PF },
  { id: 'apex-25k-intraday', firm: 'Apex Trader Funding', plan: '$25K Intraday (4.0)', size: 25000, target: 1500, maxDrawdown: 1500, ddType: 'intraday', lockAtStart: false, dailyLoss: null, consistencyPct: null, minDays: null, note: 'Intraday trailing; no daily loss limit.', checked: '2026-06-01', source: PF },
  { id: 'lucid-50k', firm: 'Lucid Trading', plan: '$50K LucidFlex', size: 50000, target: 3000, maxDrawdown: 2000, ddType: 'eod', lockAtStart: false, dailyLoss: 1200, consistencyPct: 40, minDays: null, lockTrigger: 52100, lockFloor: 50100, note: 'EOD trailing max loss locks at $50,100 once a close reaches $52,100. Consistency 40% (50% with the add-on). Daily loss limit is an on/off choice at checkout — clear it if yours is off; confirm the amount.', checked: '2026-11-28', source: 'Lucid help center: LucidFlex Drawdown + Evaluation (Nov 2026)' },
  { id: 'lucid-25k', firm: 'Lucid Trading', plan: '$25K LucidFlex', size: 25000, target: 1250, maxDrawdown: 1000, ddType: 'eod', lockAtStart: false, dailyLoss: null, consistencyPct: 40, minDays: null, lockTrigger: 26100, lockFloor: 25100, note: 'EOD trailing max loss locks at $25,100 once a close reaches $26,100. Consistency 40% (50% with the add-on). Daily loss limit is an on/off choice at checkout — enter it if yours is on.', checked: '2026-11-28', source: 'Lucid help center: LucidFlex Drawdown + Evaluation (Nov 2026)' },
  { id: 'tradeify-50k', firm: 'Tradeify', plan: '$50K Growth', size: 50000, target: 3000, maxDrawdown: null, ddType: 'eod', lockAtStart: true, dailyLoss: 1000, consistencyPct: 35, minDays: null, note: 'Max drawdown amount not recorded — enter it from your plan. Consistency 35% applies funded.', checked: '2026-06-01', source: PF },
  { id: 'mff-50k', firm: 'My Funded Futures', plan: '$50K Core', size: 50000, target: 3000, maxDrawdown: 2000, ddType: 'eod', lockAtStart: false, dailyLoss: null, consistencyPct: 40, minDays: null, note: 'No daily loss limit.', checked: '2026-06-01', source: PF },
  { id: 'tpt-50k', firm: 'Take Profit Trader', plan: '$50K PRO (evaluation)', size: 50000, target: 3000, maxDrawdown: 2000, ddType: 'eod', lockAtStart: false, dailyLoss: null, consistencyPct: null, minDays: null, note: 'EOD in the evaluation; becomes INTRADAY when funded.', checked: '2026-06-01', source: PF },
];

export interface EquityPoint { day: string; pnl: number }   // closed trades in time order

export interface Floor { equity: number; peak: number; floor: number; locked: boolean; buffer: number }

/**
 * Drawdown floor after a sequence of closed trades.
 * - static:   floor = start − maxDrawdown, never moves
 * - eod:      floor trails the highest END-OF-DAY balance
 * - intraday: floor trails the highest balance after any closed trade (open-trade excursions are not in the
 *             journal, so a firm's true intraday floor can be higher than this — treat it as a best case)
 * - lockAtStart: the trailing floor stops rising once it reaches the starting balance
 */
export function drawdownFloor(trades: EquityPoint[], start: number, maxDrawdown: number, type: DdType, lockAtStart: boolean): Floor {
  let equity = start, peakTrade = start, peakEod = start;
  for (let i = 0; i < trades.length; i++) {
    equity += trades[i].pnl;
    peakTrade = Math.max(peakTrade, equity);
    const lastOfDay = i === trades.length - 1 || trades[i + 1].day !== trades[i].day;
    if (lastOfDay) peakEod = Math.max(peakEod, equity);
  }
  const peak = type === 'static' ? start : type === 'eod' ? peakEod : peakTrade;
  let floor = peak - maxDrawdown;
  let locked = false;
  if (type !== 'static' && lockAtStart && floor >= start) { floor = start; locked = true; }
  return { equity, peak, floor, locked, buffer: equity - floor };
}

/** Warning level for the breach banner: share of the drawdown room that is left. */
export function bufferLevel(buffer: number, maxDrawdown: number): 'ok' | 'watch' | 'danger' | 'breached' {
  if (buffer <= 0) return 'breached';
  const left = buffer / maxDrawdown;
  return left < 0.25 ? 'danger' : left < 0.5 ? 'watch' : 'ok';
}
