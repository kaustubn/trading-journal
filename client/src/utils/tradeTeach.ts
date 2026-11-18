// "Teach me this trade": explains a backtest trade step by step — what the strategy watches,
// what the market looked like at the entry, why it entered, where the stop and target were and
// why, how the trade played out, and the lesson. Rule-based (no AI): the strategy rules come
// from the RoboQuant code Claude wrote (trading-system/roboquant/*.rq) or, for the third-party
// NQ Precision bot, from what its 315 trades show.

export type Dir = 1 | -1;
export type Bar = [number, number, number, number, number, number]; // ms, o, h, l, c, v

export interface TeachTrade {
  id: number;
  symbol: string;
  setup_tag?: string | null;
  notes?: string | null;
  quantity: number;
  entry_price: number;
  exit_price?: number | null;
  stop_loss?: number | null;
  target?: number | null;
  pnl?: number | null;
}

export interface Playbook {
  key: string;
  name: string;
  who: string;          // who made the rules
  looks: string[];      // what it watches before a trade
  entry: string[];      // the trigger, in order
  stop: string;         // where the stop goes and why
  target: string;       // where the target goes and why
  manage: string[];     // what happens while in the trade
  tested: string;       // what the full backtest found
}

const S1_TESTED = 'Full S1 test (Oct 2025–Sep 2026): only the morning version (10:00–11:59 ET, 5m trend agreeing) made money: +$49,769 on its subset. All S1 signals together lost −$25,187. That is why the journal labels the others "S1 (filtered out)".';

export const PLAYBOOKS: Record<string, Playbook> = {
  nqp: {
    key: 'nqp', name: 'NQ Precision', who: 'A ready-made RoboQuant bot. Its code is hidden. Everything below comes from studying its 315 trades against the real NQ bars.',
    looks: [
      'The first 30 minutes of the New York session: where price is at 9:59 compared with the 9:30 open.',
      'Where 9:59 price sits inside the 9:30–9:59 high-low range. On 312 of its 314 trading days, price was in the upper 40% of that range for a long (lower 40% for a short).',
      'One more filter we could not identify, because it still skips about half of those days.',
    ],
    entry: [
      'Waits until 9:59:55 ET, 5 seconds before the 10:00 candle.',
      'Direction = the direction of the 9:30 → 9:59 move: price above the 9:30 open → long, below → short. True on 315 of 315 trades.',
      'Enters at market with 6 NQ contracts. At most one trade a day.',
    ],
    stop: 'About 0.19% of price away (median 43 points). The stop is a fixed percent of price, not a chart level, and it is ~7× bigger than the target.',
    target: 'About 0.03% of price (median 6 points). It is a quick scalp of the 10:00 push. Winners close in about 5 seconds.',
    manage: [
      'No breakeven or trailing stop.',
      'Time stop: if neither the target nor the stop is hit, it exits after 8 minutes. Most of its losses were these time exits.',
    ],
    tested: '3 years (Oct 2023–Oct 2026): 315 trades, 94.0% wins, +$137,706 with 6 NQ, max drawdown 32.8%. Average win +$789, average loss −$4,888: one loss erases about 6 wins. Biggest loss −$20,370 (169-point stop, 25 Jun 2026). Backtest had zero slippage, and 10:00 ET is when economic news is released.',
  },
  s1simple: {
    key: 's1simple', name: 'S1 Simple', who: 'Your S1 trend-pullback idea, coded by Claude and run as a real RoboQuant backtest.',
    looks: [
      'Bias on 15m and 5m: price above a rising EMA21 = up, below a falling EMA21 = down. Both must agree.',
      'Value areas on the 3m chart: 3m EMA21, 5m EMA21 and session VWAP.',
      'Time: entries 09:30–15:45 ET only, flat by 15:55.',
    ],
    entry: [
      'Pullback: a 3m candle dips into value (EMA21 3m / EMA21 5m / VWAP).',
      'Trigger: within a few candles, a 3m candle closes in the bias direction AND beyond the previous 3m candle’s high (long) / low (short).',
      'Market entry at that close.',
    ],
    stop: 'Below the pullback’s swing low (long) / above its swing high (short), plus a small buffer. That is the point where the pullback idea is wrong.',
    target: 'Depends on the run: 1R or 2R (1× or 2× the risk), or the prior 3m swing high/low. The run name is in the notes.',
    manage: ['Breakeven optional per run (stop to entry once price moves the set R in favour).', 'Daily limits: max trades per day; no new trades after the loss limit.'],
    tested: 'Real runs Oct 2025–Sep 2026: 1R all day +$33,806 (704 trades, 53.1% wins); prior-swing target +$17,464; 2R −$1,703; 1R morning-only −$1,041.',
  },
  s1lab: {
    key: 's1lab', name: 'S1 (research)', who: 'Your S1 trend pullback, coded by Claude in the NQ Lab research scanner (every signal tracked, no real orders).',
    looks: ['15m EMA21 bias (price and slope).', '5m trend (logged; the "S1 Morning" label needs it to agree).', 'Value on 3m: EMA21 3m / EMA21 5m / VWAP.'],
    entry: ['A 3m candle dips into value.', 'Within 6 candles a 3m candle closes beyond the previous 3m candle’s extreme in the bias direction → entry at that close.'],
    stop: 'Pullback extreme − 3 points (long) / + 3 points (short).',
    target: '1.5R. Breakeven rule: once price moves 0.5R in favour, the stop moves to entry + 1 point.',
    manage: ['Breakeven at +0.5R.', '"S1 Morning" = 10:00–11:59 ET with the 5m trend agreeing (the version that made money). Everything else = "S1 (filtered out)".'],
    tested: S1_TESTED,
  },
  s1strict: {
    key: 's1strict', name: 'S1 Strict', who: 'Your written S1 checklist (/s1 command), coded exactly by Claude and run on RoboQuant.',
    looks: ['15m structure: last 3 swing highs and lows rising (long) / falling (short).', '15m EMA21 slope above a minimum.', 'Key level: EMA21 15m, session VWAP, or prior session high/low.', 'ATR(14) on 5m: too low or too high = skip.'],
    entry: ['Pullback 30–60% of the last 15m swing leg.', '5m rejection candle with a wick into the level and the body in its outer part.', 'First 2m candle in trade direction within a few bars → entry.'],
    stop: 'Beyond the 5m rejection candle’s low/high plus a buffer (your locked rule).',
    target: 'A fixed multiple of the risk.',
    manage: ['Flat at end of day.'],
    tested: '3 months (Jun–Sep 2026): only 5 trades, −$2,262. The checklist is so strict it almost never fires — the main finding.',
  },
  s2: {
    key: 's2', name: 'S2 Range Fade', who: 'Your S2 idea, coded by Claude in the NQ Lab research scanner.',
    looks: ['"Magnet" levels: previous day high/low, overnight high/low, today’s RTH high/low so far, round 100s, opening range high/low.'],
    entry: ['A 5m candle’s wick tags a magnet level and the candle closes back inside, in its outer half.', 'First 3m candle closing in the fade direction within 4 candles → entry.'],
    stop: 'The rejection wick + 5 points. Beyond the wick the level has failed.',
    target: '1R, with breakeven once price moves 0.5R in favour.',
    manage: ['Breakeven at +0.5R (stop to entry + 1 point).'],
    tested: 'Research year Oct 2025–Sep 2026: 2,307 signals, −$36,169 → no edge as coded.',
  },
  s3: {
    key: 's3', name: 'S3 Sweep Reversal', who: 'Your S3 idea, coded by Claude in the NQ Lab research scanner.',
    looks: ['The same magnet levels as S2 (where stop orders sit = liquidity).'],
    entry: ['A 5m wick pierces a magnet level (sweeps the stops).', 'That candle or the next closes back on the original side (reclaim).', 'First 3m close back through the level within 4 candles → entry.'],
    stop: 'The sweep wick + 4 points.',
    target: '0.5R (quick take-profit; the best of the tested exits).',
    manage: ['No breakeven (target is too close).'],
    tested: 'Research year: 4,386 signals, −$139,086 → the worst setup as coded.',
  },
  orb: {
    key: 'orb', name: 'ORB (opening range breakout)', who: 'Coded by Claude in the NQ Lab research scanner.',
    looks: ['The opening range: high and low of 9:30–9:45 ET.'],
    entry: ['First 3m candle that closes beyond the opening-range high (long) or low (short) → entry.'],
    stop: 'The middle of the opening range.',
    target: '0.5R.',
    manage: ['No breakeven.'],
    tested: 'Research year: 203 signals, −$2,790; test period −0.098R per trade → dropped.',
  },
  own: {
    key: 'own', name: 'Your trade', who: 'You took this one. The lesson checks it against your entry checklist (ENTRY_CHECKLIST.md) and the market at that moment.',
    looks: [
      'Prime time: the first 2 hours of New York (9:30–11:30 ET) or power hour (15:00–16:00). No lunch chop (12:00–13:00).',
      'Day type at 10:00: trend / expansion → S1 pullback or ORB. Range / reversal → S2 fade or S3 sweep.',
      'A real level for the entry: VWAP, POC, VAH / VAL, previous day high / low, overnight high / low, a prior swing, a round number.',
      'Stop decided before the entry, and risk : reward at least the setup minimum (S1 2.5, S2 1.5, S3 2).',
    ],
    entry: ['Name the setup (S1 / S2 / S3 / ORB) before you click.', 'Entry at the level, on the trigger candle, in the direction of the 15m trend for S1.'],
    stop: 'Beyond the level that proves the idea wrong (rejection wick, sweep wick, or swing), never moved further away.',
    target: 'The next level (VWAP / POC / opposite extreme), at least the setup’s minimum R.',
    manage: ['Partials at T1, stop to break-even only after T1 or a clear structure break, no widening the stop.'],
    tested: 'Keep reviewing: grade each trade A / B / C and tag how you felt, so the Setups and Emotions pages can show which of your trades make money.',
  },
  va80: {
    key: 'va80', name: 'VA80 (80% rule)', who: 'Found by the Edge Hunter (2026-11-18) and frozen for a forward test. It is the only pattern of 18 that was positive in the old, middle AND newest years.',
    looks: [
      'Yesterday’s New York value area: the price band where 70% of yesterday’s 9:30–16:00 volume traded. Top = VAH, bottom = VAL, busiest price = POC (turn on the VA80 indicator: pVAH / pPOC / pVAL).',
      'Today’s 9:30 open: above VAH or below VAL? Only then is there a VA80 setup.',
      'The time: the signal only counts before 13:30 ET. Entries before 11:00 were the strongest in every period.',
    ],
    entry: [
      'The day opens OUTSIDE yesterday’s value area (above VAH or below VAL).',
      'Wait for the first 5-minute candle that CLOSES back inside the value area.',
      'Enter at the open of the next minute, toward the other side: opened above → SHORT, opened below → LONG.',
    ],
    stop: '1 × ATR(14) of the 5-minute candles from the entry (about 30–45 pt on NQ lately). Why: the idea is "price was rejected outside and is back in value"; a full ATR against you means it was not rejected.',
    target: '2R (twice the stop). In the study 2R beat 1R in every period (1R lost money on the newest years); the far side of the value area worked too but no better.',
    manage: ['No breakeven move, no partials: the tested rule holds to the stop, the target, 120 minutes, or 15:55.', 'One VA80 trade per day.'],
    tested: '5 years of NQ, costs included: oldest years +0.15R per trade (199 trades), middle years +0.18R (107), newest years it never saw +0.11R (93). About one trade every 3 days, win rate ~39%. Not proven yet (t = 2.0): it is in a frozen forward test. "Improved" versions picked on old data collapsed on new data, so the simple rule stays.',
  },
  bbe: {
    key: 'bbe', name: 'BBE (Big Bar Engulfing)', who: 'Your BBE rule, coded by Claude (BBE Lab research scanner).',
    looks: ['Trend on 15m and 5m: last candle above a rising EMA18 = up, below a falling one = down (logged in the notes as 15m / 5m: 1 = with the trade, −1 = against, 0 = flat).'],
    entry: ['A 5m engulfing candle: its body covers the previous candle’s body, in the trade direction.', 'Entry at that candle’s close.'],
    stop: 'Stop A = the engulfing candle’s low/high. Stop B = the candle before it (your wording "previous candle").',
    target: 'Measured move: the same number of points as the engulfing candle’s range, projected from entry.',
    manage: ['No breakeven, held to target, stop, or the end of the session.'],
    tested: '2 years, 8,117 trades: no session was positive in both years; the pre-registered retest failed → dropped.',
  },
};

export function playbookFor(t: TeachTrade): Playbook | null {
  const tag = (t.setup_tag || '').trim();
  if (tag === 'NQ Precision') return PLAYBOOKS.nqp;
  if (tag === 'S1 Simple') return PLAYBOOKS.s1simple;
  if (tag === 'S1 Strict') return PLAYBOOKS.s1strict;
  if (tag === 'S1 Morning' || tag === 'S1 (filtered out)') return PLAYBOOKS.s1lab;
  if (tag === 'S2 Range Fade') return PLAYBOOKS.s2;
  if (tag === 'S3 Sweep Reversal') return PLAYBOOKS.s3;
  if (tag === 'ORB') return PLAYBOOKS.orb;
  if (/^BBE stop [AB]/.test(tag)) return PLAYBOOKS.bbe;
  if (/^VA80/i.test(tag)) return PLAYBOOKS.va80;
  // any other NQ trade with a stop: the general lesson against the trader's own checklist
  if (t.stop_loss != null && /(^|[^A-Z])M?NQ/i.test(t.symbol || '')) return PLAYBOOKS.own;
  return null;
}

export interface NoteFacts {
  rule?: string; level?: string; trend5?: string; riskPts?: number; resultR?: number;
  candleRange?: number; t15?: number; t5?: number; run?: string;
}

export function parseNotes(notes?: string | null): NoteFacts {
  const n = notes || '';
  const f: NoteFacts = {};
  const g = (re: RegExp) => n.match(re)?.[1];
  f.rule = g(/rule (\S+)/);
  f.level = g(/level ([^|]+?) \|/);
  f.trend5 = g(/5m trend (\w+)/);
  const risk = g(/risk ([\d.]+)pt/); if (risk) f.riskPts = Number(risk);
  const r = g(/result ([+-][\d.]+)R/); if (r) f.resultR = Number(r);
  const cr = g(/candle range ([\d.]+)pt/); if (cr) f.candleRange = Number(cr);
  const tt = n.match(/15m (-?\d) 5m (-?\d)/); if (tt) { f.t15 = Number(tt[1]); f.t5 = Number(tt[2]); }
  f.run = g(/RoboQuant backtest \| (\S+)/);
  return f;
}

const LEVEL_TEXT: Record<string, string> = {
  'EMA21 3m': 'the 3-minute EMA21', 'EMA21 5m': 'the 5-minute EMA21', 'VWAP': 'the session VWAP',
  'PDH/PDL': 'the previous day’s high/low', 'overnight H/L': 'the overnight high/low', 'RTH H/L': 'today’s regular-session high/low so far',
  'round 100': 'a round 100-point number', 'OR H/L': 'the opening-range high/low',
};
export const levelText = (l?: string) => (l ? LEVEL_TEXT[l.trim()] || l.trim() : '');

// ---------- market context from bars ----------

const ET = 'America/New_York';
const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
const etDay = new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const etParts = new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const etTime = (ms: number) => etFmt.format(new Date(ms));
export const etDate = (ms: number) => etDay.format(new Date(ms));
export function etMinutes(ms: number) {
  const p = etParts.formatToParts(new Date(ms));
  return (Number(p.find(x => x.type === 'hour')?.value) % 24) * 60 + Number(p.find(x => x.type === 'minute')?.value);
}

export function ema(values: number[], n: number): number[] {
  const k = 2 / (n + 1); const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

export type Trend = 'up' | 'down' | 'flat';
export function trendOf(bars: Bar[], len = 21): { trend: Trend; ema: number; slopePts: number } | null {
  if (bars.length < len + 4) return null;
  const e = ema(bars.map(b => b[4]), len);
  const last = e[e.length - 1], prev = e[e.length - 4], close = bars[bars.length - 1][4];
  const slope = last - prev;
  const trend: Trend = close > last && slope > 0 ? 'up' : close < last && slope < 0 ? 'down' : 'flat';
  return { trend, ema: last, slopePts: slope };
}

export function atr(bars: Bar[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const [, , h, l] = bars[i]; const pc = bars[i - 1][4];
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return tr.slice(-n).reduce((a, b) => a + b, 0) / n;
}

export interface Levels {
  prev: { date: string; h: number; l: number; c: number } | null;
  open: number | null; nyOpen: number | null; nyStart: number;
  overnight: { h: number; l: number } | null;
}

export interface Market {
  bars: Bar[];                // 1m bars around the trade (shifted to the backtest's price basis)
  shift: number;              // points added to the chart bars to match the backtest prices (contract roll)
  t15: ReturnType<typeof trendOf>;
  t5: ReturnType<typeof trendOf>;
  atr5: number | null;
  levels: Levels | null;
  nyOpen: number | null;
  rangeHi: number | null; rangeLo: number | null; posInRange: number | null; // 9:30 -> entry, position 0 = low, 1 = high
  move30: number | null;      // last 30 minutes before entry, points
  near: { name: string; price: number; dist: number }[]; // nearest levels to the entry
  mfe: number | null; mae: number | null; minToMfe: number | null; // in points, during the trade
}

export interface Facts {
  dir: Dir; entry: number; exit: number | null; stop: number | null; target: number | null;
  qty: number; pv: number; riskPts: number | null; rewardPts: number | null; rr: number | null;
  riskUsd: number | null; rewardUsd: number | null; beWin: number | null; resultR: number | null;
  pnl: number | null; entryMs: number; exitMs: number | null; holdSec: number | null;
  outcome: 'target' | 'stop' | 'breakeven' | 'time' | 'open';
  notes: NoteFacts;
  notesText?: string | null;
}

export function baseFacts(t: TeachTrade, side: 'long' | 'short' | null, entryMs: number, exitMs: number | null): Facts {
  const notes = parseNotes(t.notes);
  const entry = Number(t.entry_price), exit = t.exit_price != null ? Number(t.exit_price) : null;
  let dir: Dir = side === 'short' ? -1 : 1;
  if (!side && t.stop_loss != null) dir = Number(t.stop_loss) < entry ? 1 : -1;
  const stop = t.stop_loss != null ? Number(t.stop_loss) : notes.riskPts != null ? entry - dir * notes.riskPts : null;
  const target = t.target != null ? Number(t.target) : null;
  const pv = /^MNQ/i.test(t.symbol) ? 2 : 20;
  const qty = Number(t.quantity) || 1;
  const riskPts = stop != null ? Math.abs(entry - stop) : null;
  const rewardPts = target != null ? Math.abs(target - entry) : null;
  const rr = riskPts && rewardPts != null ? rewardPts / riskPts : null;
  const pnl = t.pnl != null ? Number(t.pnl) : null;
  const riskUsd = riskPts != null ? riskPts * pv * qty : null;
  const rewardUsd = rewardPts != null ? rewardPts * pv * qty : null;
  const beWin = riskPts != null && rewardPts != null && riskPts + rewardPts > 0 ? riskPts / (riskPts + rewardPts) : null;
  const resultR = notes.resultR ?? (exit != null && riskPts ? ((exit - entry) * dir) / riskPts : null);
  const tol = Math.max(1, (riskPts ?? 10) * 0.06);
  let outcome: Facts['outcome'] = 'open';
  if (exit != null) {
    if (target != null && Math.abs(exit - target) <= Math.max(tol, (rewardPts ?? 0) * 0.15) && (exit - entry) * dir > 0) outcome = 'target';
    else if (stop != null && Math.abs(exit - stop) <= tol) outcome = 'stop';
    else if (Math.abs(exit - entry) <= 1.5) outcome = 'breakeven';
    else outcome = 'time';
  }
  return {
    dir, entry, exit, stop, target, qty, pv, riskPts, rewardPts, rr, riskUsd, rewardUsd, beWin, resultR, pnl,
    entryMs, exitMs, holdSec: exitMs != null ? Math.max(0, (exitMs - entryMs) / 1000) : null, outcome, notes, notesText: t.notes,
  };
}

/** Market context from 1m / 5m / 15m bars and the session levels (all up to the entry only, except mfe/mae). */
export function buildMarket(f: Facts, m1: Bar[], m5: Bar[], m15: Bar[], levels: Levels | null): Market {
  // match chart prices to the backtest's (contract rolls can differ by a few points)
  const atEntry = [...m1].reverse().find(b => b[0] <= f.entryMs);
  let shift = 0;
  if (atEntry) {
    const lo = atEntry[3], hi = atEntry[2];
    if (f.entry < lo - 3 || f.entry > hi + 3) shift = Math.round((f.entry - atEntry[4]) * 4) / 4;
  }
  const sh = (b: Bar): Bar => [b[0], b[1] + shift, b[2] + shift, b[3] + shift, b[4] + shift, b[5]];
  const bars = shift ? m1.map(sh) : m1;
  const b5 = shift ? m5.map(sh) : m5, b15 = shift ? m15.map(sh) : m15;
  const lv = levels && shift ? {
    ...levels,
    prev: levels.prev && { ...levels.prev, h: levels.prev.h + shift, l: levels.prev.l + shift, c: levels.prev.c + shift },
    open: levels.open != null ? levels.open + shift : null, nyOpen: levels.nyOpen != null ? levels.nyOpen + shift : null,
    overnight: levels.overnight && { h: levels.overnight.h + shift, l: levels.overnight.l + shift },
  } : levels;

  const before = bars.filter(b => b[0] < f.entryMs);
  const nyStart = lv?.nyStart ?? null;
  const rth = nyStart != null ? before.filter(b => b[0] >= nyStart) : [];
  const rangeHi = rth.length ? Math.max(...rth.map(b => b[2])) : null;
  const rangeLo = rth.length ? Math.min(...rth.map(b => b[3])) : null;
  const posInRange = rangeHi != null && rangeLo != null && rangeHi > rangeLo ? (f.entry - rangeLo) / (rangeHi - rangeLo) : null;
  const ago30 = before.find(b => b[0] >= f.entryMs - 30 * 60000);
  const move30 = ago30 ? f.entry - ago30[1] : null;

  const cand: { name: string; price: number }[] = [];
  if (lv?.prev) cand.push({ name: 'Previous day high', price: lv.prev.h }, { name: 'Previous day low', price: lv.prev.l }, { name: 'Previous day close', price: lv.prev.c });
  if (lv?.overnight) cand.push({ name: 'Overnight high', price: lv.overnight.h }, { name: 'Overnight low', price: lv.overnight.l });
  if (lv?.nyOpen != null && nyStart != null && f.entryMs >= nyStart) cand.push({ name: '9:30 open', price: lv.nyOpen });
  const r100 = Math.round(f.entry / 100) * 100; cand.push({ name: `Round number ${r100}`, price: r100 });
  if (rangeHi != null && rangeLo != null) cand.push({ name: 'Today’s high so far', price: rangeHi }, { name: 'Today’s low so far', price: rangeLo });
  const near = cand.map(c => ({ ...c, dist: f.entry - c.price })).sort((a, b) => Math.abs(a.dist) - Math.abs(b.dist)).slice(0, 3);

  let mfe: number | null = null, mae: number | null = null, minToMfe: number | null = null;
  if (f.exitMs != null) {
    const during = bars.filter(b => b[0] + 60000 > f.entryMs && b[0] <= f.exitMs!);
    if (during.length) {
      mfe = 0; mae = 0;
      for (const b of during) {
        const fav = f.dir > 0 ? b[2] - f.entry : f.entry - b[3];
        const adv = f.dir > 0 ? b[3] - f.entry : f.entry - b[2];
        if (fav > mfe) { mfe = fav; minToMfe = Math.max(0, Math.round((b[0] - f.entryMs) / 60000)); }
        if (adv < mae) mae = adv;
      }
      // never claim more favour than the exit itself shows
      if (f.exit != null) mfe = Math.max(mfe, (f.exit - f.entry) * f.dir);
    }
  }
  return {
    bars, shift, t15: trendOf(b15.filter(b => b[0] + 15 * 60000 <= f.entryMs)), t5: trendOf(b5.filter(b => b[0] + 5 * 60000 <= f.entryMs)),
    atr5: atr(b5.filter(b => b[0] + 5 * 60000 <= f.entryMs)), levels: lv, nyOpen: lv?.nyOpen ?? null,
    rangeHi, rangeLo, posInRange, move30, near, mfe, mae, minToMfe,
  };
}

// ---------- the lesson ----------

export interface Step {
  title: string;
  say: string[];                 // short paragraphs / bullets
  facts?: [string, string][];    // label → value rows
  reveal: boolean;               // false = chart shows only what the strategy could see (up to the entry)
}

const p = (n: number | null | undefined, d = 2) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(d));
const pts = (n: number | null | undefined) => (n == null ? '—' : `${Math.abs(n) < 10 ? n.toFixed(2) : n.toFixed(1)} pt`);
const usd = (n: number | null | undefined) => (n == null ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const pc = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`);
const side = (d: Dir) => (d > 0 ? 'long (buy)' : 'short (sell)');
const trendWord = (t: Trend | undefined, d: Dir) => !t ? 'unknown' : t === 'flat' ? 'flat (no clear trend)' : `${t}${(t === 'up') === (d > 0) ? ' — with the trade' : ' — against the trade'}`;
const dur = (s: number | null) => (s == null ? '—' : s < 90 ? `${Math.round(s)} seconds` : s < 5400 ? `${Math.round(s / 60)} minutes` : `${(s / 3600).toFixed(1)} hours`);

export function buildSteps(pb: Playbook, f: Facts, m: Market | null, setupTag: string): Step[] {
  const steps: Step[] = [];
  const dirWord = f.dir > 0 ? 'long' : 'short';

  // 1. The strategy
  steps.push({
    title: `1 · The strategy: ${pb.name}`, reveal: false,
    say: [pb.who, 'What it watches:', ...pb.looks.map(x => '• ' + x)],
  });

  // 2. The market before the entry
  if (m) {
    const facts: [string, string][] = [
      ['Time (New York)', `${etDate(f.entryMs)} · ${etTime(f.entryMs)}`],
      ['15m trend (EMA21)', trendWord(m.t15?.trend, f.dir)],
      ['5m trend (EMA21)', trendWord(m.t5?.trend, f.dir)],
    ];
    if (m.nyOpen != null && m.levels && f.entryMs >= m.levels.nyStart) facts.push(['Move since 9:30 open', `${f.entry - m.nyOpen >= 0 ? '+' : ''}${p(f.entry - m.nyOpen, 2)} pt`]);
    if (m.posInRange != null) facts.push(['Where price sits in today’s range', `${pc(m.posInRange)} of the way up (0% = low, 100% = high)`]);
    if (m.move30 != null) facts.push(['Last 30 minutes', `${m.move30 >= 0 ? '+' : ''}${p(m.move30, 2)} pt`]);
    if (m.atr5 != null) facts.push(['Volatility (ATR 5m)', `${p(m.atr5, 1)} pt per 5m candle`]);
    for (const n of m.near) facts.push([`Near: ${n.name}`, `${p(n.price, 2)} (${n.dist >= 0 ? 'entry is ' + p(n.dist, 1) + ' pt above' : 'entry is ' + p(-n.dist, 1) + ' pt below'})`]);
    steps.push({
      title: '2 · The market just before entry', reveal: false,
      say: ['The chart shows only what the strategy could see at that moment, with no future candles. Read the trend, the levels and the time first.'],
      facts,
    });
  }

  // 3. Why it entered here
  const why: string[] = ['The rule, in order:', ...pb.entry.map((x, i) => `${i + 1}. ${x}`), 'On this trade:'];
  if (pb.key === 'own') {
    const setup = (setupTag || '').trim();
    why.push(setup ? `• Setup tagged: ${setup}.` : '• No setup tagged. Name it (S1 / S2 / S3 / ORB) or it is a C-grade trade.');
    const firstNote = (f.notes.rule ? '' : (f.notesText || '').split('\n').find(x => x.trim() && !/^Bar replay ·/.test(x) && !/^Rule breaks:/.test(x))) || '';
    if (firstNote) why.push(`• Your note: “${firstNote.slice(0, 160)}”`);
    const mins = etMinutes(f.entryMs);
    const prime = (mins >= 570 && mins < 690) || (mins >= 900 && mins < 960);
    why.push(prime ? `• ${etTime(f.entryMs)} ET is inside your prime time ✔` : `• ${etTime(f.entryMs)} ET is OUTSIDE your prime time (9:30–11:30, 15:00–16:00) ✘`);
    if (m?.t15) why.push(`• 15m trend: ${trendWord(m.t15.trend, f.dir)}.`);
    if (m?.near[0]) why.push(`• Nearest level: ${m.near[0].name} ${p(m.near[0].price, 2)}, ${p(Math.abs(m.near[0].dist), 1)} pt away${Math.abs(m.near[0].dist) <= 5 ? ' ✔ (at the level)' : Math.abs(m.near[0].dist) > 20 ? ' ✘ (not at a level)' : ''}.`);
  } else if (pb.key === 'va80') {
    const mins = etMinutes(f.entryMs);
    why.push(`• Entry at ${etTime(f.entryMs)} ET ${mins < 660 ? '— before 11:00, the strongest window ✔' : mins < 810 ? '— after 11:00: allowed, but weaker in the tests' : '— after 13:30: NOT a VA80 signal ✘'}.`);
    if (m?.nyOpen != null) why.push(`• Today opened at ${p(m.nyOpen, 2)}; the trade is ${side(f.dir)} ${f.dir > 0 ? '(the open was below yesterday’s value area)' : '(the open was above yesterday’s value area)'}.`);
    if (m?.t15) why.push(`• 15m trend: ${trendWord(m.t15.trend, f.dir)}. (With the 15m trend looked much better in a small sample — a thing to watch, not yet a rule.)`);
  } else if (pb.key === 'nqp' && m) {
    if (m.nyOpen != null) {
      const mv = f.entry - m.nyOpen;
      why.push(`• Price was ${pts(Math.abs(mv))} ${mv >= 0 ? 'above' : 'below'} the 9:30 open → ${mv * f.dir > 0 ? `it went ${dirWord}, with the move ✔` : `it went ${dirWord}, against the move (unusual)`}.`);
    }
    if (m.posInRange != null) {
      const pos = f.dir > 0 ? m.posInRange : 1 - m.posInRange;
      why.push(`• Price was ${pc(pos)} of the way toward the ${f.dir > 0 ? 'high' : 'low'} of the 9:30 range ${pos >= 0.6 ? '→ strong close near the extreme ✔' : '→ not near the extreme (rare for this bot)'}.`);
    }
  } else {
    if (f.notes.level) why.push(`• The pullback touched ${levelText(f.notes.level)}.`);
    if (f.notes.trend5) why.push(`• The 5m trend ${f.notes.trend5 === 'agrees' ? 'agreed with the trade ✔' : f.notes.trend5 === 'against' ? 'was AGAINST the trade ✘' : 'was flat'}.`);
    if (f.notes.t15 != null) why.push(`• 15m trend: ${f.notes.t15 === 1 ? 'with the trade ✔' : f.notes.t15 === -1 ? 'against ✘' : 'flat'} · 5m trend: ${f.notes.t5 === 1 ? 'with ✔' : f.notes.t5 === -1 ? 'against ✘' : 'flat'}.`);
    if (f.notes.candleRange != null) why.push(`• The engulfing candle was ${pts(f.notes.candleRange)} tall.`);
    if (setupTag === 'S1 Morning') why.push('• It was between 10:00 and 11:59 ET with the 5m trend agreeing, so it counts as the morning version that made money.');
    if (setupTag === 'S1 (filtered out)') why.push('• It is outside the morning window or the 5m trend did not agree, so the filtered plan would SKIP it.');
    if (m?.t15) why.push(`• Measured from the chart: 15m trend ${trendWord(m.t15.trend, f.dir)}.`);
  }
  why.push(`→ Entry: ${side(f.dir)} ${f.qty} × ${p(f.entry, 2)} at ${etTime(f.entryMs)} ET.`);
  steps.push({ title: '3 · Why it entered here', reveal: false, say: why });

  // 4. Risk
  steps.push({
    title: '4 · Risk: where the stop went and why', reveal: false,
    say: [pb.stop, f.riskPts != null ? `Money at risk = stop distance × $${f.pv} per point × ${f.qty} contract${f.qty > 1 ? 's' : ''}.` : 'This run did not record its stop.'],
    facts: [
      ['Stop price', p(f.stop, 2)],
      ['Stop distance', pts(f.riskPts)],
      ['Money at risk (1R)', usd(f.riskUsd)],
      ...(m?.atr5 && f.riskPts ? [['Stop vs volatility', `${p(f.riskPts / m.atr5, 1)} × ATR(5m)`] as [string, string]] : []),
    ],
  });

  // 5. Reward and R:R
  const rrSay = [pb.target];
  if (f.rr != null && f.beWin != null) {
    rrSay.push(f.rr >= 1
      ? `Reward is ${p(f.rr, 2)}× the risk. Win more than ${pc(f.beWin)} of trades and the strategy makes money.`
      : `Reward is only ${p(f.rr, 2)}× the risk: each loss costs ${p(1 / f.rr, 1)} wins. It must win more than ${pc(f.beWin)} of the time just to break even.`);
  }
  steps.push({
    title: '5 · Reward: target and risk:reward', reveal: false, say: rrSay,
    facts: [
      ['Target price', p(f.target, 2)], ['Target distance', pts(f.rewardPts)], ['Money if target hits', usd(f.rewardUsd)],
      ['Risk : reward', f.rr != null ? `1 : ${p(f.rr, 2)}` : '—'], ['Win rate needed to break even', pc(f.beWin)],
    ],
  });

  // 6. How the trade played out
  const play: string[] = [...pb.manage.map(x => '• ' + x)];
  const outText = { target: 'Target hit ✔', stop: 'Stopped out ✘', breakeven: 'Breakeven stop (scratch)', time: pb.key === 'nqp' ? 'Time exit (8-minute limit)' : 'Exited by time / end of session', open: 'Still open' }[f.outcome];
  if (f.holdSec != null && f.holdSec < 60) {
    play.push(`The trade lasted only ${Math.round(f.holdSec)} seconds, too short to see on 1-minute candles. ${f.outcome === 'target' ? 'The target was hit almost instantly.' : ''}`);
  } else if (m?.mfe != null && f.riskPts) {
    play.push(`Best point during the trade: ${pts(m.mfe)} in favour (${p(m.mfe / f.riskPts, 2)}R)${m.minToMfe == null ? '' : m.minToMfe === 0 ? ', in the first minute' : `, about ${m.minToMfe} min after entry`}. Worst: ${pts(m.mae)} against (${p((m.mae ?? 0) / f.riskPts, 2)}R).`);
    if (f.outcome === 'stop' && m.mfe / f.riskPts >= 0.5) play.push(`It was ${p(m.mfe / f.riskPts, 2)}R in profit before it turned and hit the stop. A breakeven rule at +0.5R would have saved this loss.`);
  }
  steps.push({
    title: '6 · How the trade was managed and ended', reveal: true, say: play,
    facts: [
      ['Exit', `${p(f.exit, 2)}${f.exitMs ? ' at ' + etTime(f.exitMs) + ' ET' : ''}`], ['How it ended', outText],
      ['Time in trade', dur(f.holdSec)], ['Result', `${usd(f.pnl)}${f.resultR != null ? ` (${f.resultR >= 0 ? '+' : ''}${p(f.resultR, 2)}R)` : ''}`],
    ],
  });

  // 7. Lesson
  const lesson: string[] = [];
  const win = (f.pnl ?? 0) > 0;
  if (pb.key === 'nqp') {
    lesson.push(win
      ? `A typical win: about ${pts(f.rewardPts)} in seconds. But the stop was ${pts(f.riskPts)}. One loss like this trade’s stop costs about ${f.rr ? Math.round(1 / f.rr) : 7} wins like this.`
      : `This is the hidden cost of a 94% win rate: one loss (${usd(f.pnl)}) erases many small wins. Always ask "how big is the average loss?", not only "how often does it win?".`);
    lesson.push('Precision bots like this live or die on fills: 2 points of slippage per trade would cut its profit by about a third. 10:00 ET is also when economic news is released.');
  } else if (pb.key === 'va80') {
    const mins = etMinutes(f.entryMs);
    if (mins >= 810) lesson.push('This entry was after 13:30, so it was not a VA80 trade. The rule only works as a morning / early-afternoon idea.');
    if (m?.atr5 && f.riskPts && Math.abs(f.riskPts / m.atr5 - 1) > 0.35) lesson.push(`The stop was ${p(f.riskPts / m.atr5, 1)}× ATR instead of 1×. Keep the tested stop: smaller gets shaken out, bigger shrinks the R you earn.`);
    if (f.rr != null && f.rr < 1.8) lesson.push(`Target was ${p(f.rr, 2)}R. The tested rule uses 2R; 1R lost money on the newest years.`);
    lesson.push(win ? 'A winner, but judge VA80 on 30+ trades: it wins only about 4 in 10 and earns its money from the 2R winners.' : 'A loser is normal: about 6 in 10 VA80 trades lose 1R. The edge is that the winners pay 2R. Do not change the rule after one loss.');
  } else if (pb.key === 'own') {
    const mins = etMinutes(f.entryMs);
    const prime = (mins >= 570 && mins < 690) || (mins >= 900 && mins < 960);
    if (!prime) lesson.push('Outside prime time. Most of your rule breaks in replay are trades taken outside 9:30–11:30 / 15:00–16:00 ET.');
    if (!setupTag) lesson.push('No setup named. If you cannot name the setup before the click, it is not a trade.');
    if (m?.atr5 && f.riskPts && f.riskPts < 0.75 * m.atr5) lesson.push(`Stop ${p(f.riskPts, 1)} pt is only ${p(f.riskPts / m.atr5, 1)}× the 5-minute ATR (${p(m.atr5, 1)} pt): normal noise can hit it. Put the stop beyond a real level, and cut the size instead of the stop.`);
    if (f.rr != null && f.rr < 1.5) lesson.push(`Planned reward only ${p(f.rr, 2)}× the risk. Your setups need at least 1.5–2.5R; skip trades whose target is closer than that.`);
    if (m?.t15 && m.t15.trend !== 'flat' && (m.t15.trend === 'up') !== (f.dir > 0)) lesson.push('This was against the 15m trend. For S1 that breaks the rule; for S2 / S3 it needs a clear rejection at a real level.');
    if (f.outcome === 'stop' && m?.mfe != null && f.riskPts && m.mfe / f.riskPts >= 1) lesson.push('It went 1R in your favour before stopping out. Take partials at T1 or move the stop to break-even after T1 next time.');
    if (win && f.outcome === 'target') lesson.push('Planned and executed: the target was hit. Grade it A or B and note what you saw, so you can repeat it.');
  } else {
    if (!win && m?.t15 && m.t15.trend !== 'flat' && (m.t15.trend === 'up') !== (f.dir > 0)) lesson.push('The 15m trend was against this trade. Trading against the higher timeframe is the most common reason pullback trades fail.');
    if (setupTag === 'S1 (filtered out)') lesson.push(win ? 'It won, but this type of trade lost money over the year. One win does not make a setup good. Judge the rule over hundreds of trades.' : 'This is the type of trade the morning filter removes, and this loss is why.');
    if (f.notes.trend5 === 'against') lesson.push('5m trend against the trade = lower odds. The S1 tests showed the 5m-agree trades were the profitable ones.');
    if (f.rr != null && f.rr < 1) lesson.push(`Target smaller than risk (1:${p(f.rr, 2)}): this only works with a high win rate. Check the strategy’s real win rate before trusting it.`);
    if (win && f.outcome === 'target') lesson.push('Clean execution: the plan (entry, stop, target) was set before entry and the trade simply ran to the target. That is the behaviour to copy.');
  }
  lesson.push('What the full test found: ' + pb.tested);
  lesson.push('Try it yourself: press "Open on chart", start Replay a few candles before the entry time, decide whether you would take it, then step forward.');
  steps.push({ title: '7 · The lesson', reveal: true, say: lesson });
  return steps;
}
