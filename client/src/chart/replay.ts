// Bar replay: hides everything after a chosen moment and reveals the market one
// 1-minute bar at a time. Candles of the chart's timeframe are rebuilt from the
// 1-minute bars as they form, so a 5m or 1h candle grows exactly as it did live.
// Orders fill on the 1-minute bars: market orders at the close of the current
// minute, stops and targets on later minutes (stop first when both are touched).
import type { Chart, KLineData, OverlayCreate } from 'klinecharts';
import { barTime, Contract, POINT_VALUE, TICK } from './drawings';
import { etMinutes } from './time';

const MIN = 60000, HOUR = 3600000;
const PANE = 'candle_pane';
const BRACKET_ID = 'jc_replay_bracket';
const CHUNK = 5000;               // 1-minute bars per request (~3.5 trading days)

export type Side = 'long' | 'short';
export type StepMode = 'bar' | '1m';
export type ExitReason = 'target' | 'stop' | 'manual' | 'end';

export interface Position {
  side: Side; qty: number; contract: Contract;
  entry: number; entryTime: number;  // fill price, fill time (close of the entry minute)
  entryMinute: number;               // start of the minute it filled on; exits are checked after it
  stop: number; target: number;
  setup: string; notes: string;
}
export interface ClosedTrade extends Position {
  id: string; exit: number; exitTime: number; reason: ExitReason; pnl: number; r: number;
  tf: number; saved: 'pending' | 'saved' | 'failed'; error?: string;
}
export interface OrderInput {
  side: Side; qty: number; contract: Contract;
  stopPts: number; target: number; targetUnit: 'R' | 'pts';
  setup: string; notes: string;
}

export interface ReplayHooks {
  fetch1m: (afterMs: number, limit: number) => Promise<KLineData[]>;
  view: () => { tf: number; rth: boolean };
  push: (bar: KLineData) => void;        // add or update the newest candle on the chart
  reset: () => void;                     // rebuild the chart around the cursor
  onChange: () => void;
  onClosed: (t: ClosedTrade) => void;    // log it to the journal
}

const toTick = (v: number) => Math.round(v / TICK) * TICK;
const rthMinute = (t: number) => { const m = etMinutes(t); return m >= 570 && m < 960; };

export function pnlOf(p: Pick<Position, 'side' | 'qty' | 'contract' | 'entry'>, price: number): number {
  const dir = p.side === 'long' ? 1 : -1;
  return Math.round((price - p.entry) * dir * POINT_VALUE[p.contract] * p.qty * 100) / 100;
}
export function rOf(p: Pick<Position, 'side' | 'entry' | 'stop'>, price: number): number {
  const risk = Math.abs(p.entry - p.stop);
  const dir = p.side === 'long' ? 1 : -1;
  return risk > 0 ? ((price - p.entry) * dir) / risk : 0;
}

/** Where a stop or target fills on a 1-minute bar, if it does. Gaps fill at the open. */
function fillOn(p: Position, k: KLineData): { price: number; reason: ExitReason } | null {
  if (p.side === 'long') {
    if (k.open <= p.stop) return { price: k.open, reason: 'stop' };
    if (k.open >= p.target) return { price: k.open, reason: 'target' };
    if (k.low <= p.stop) return { price: p.stop, reason: 'stop' };
    if (k.high >= p.target) return { price: p.target, reason: 'target' };
  } else {
    if (k.open >= p.stop) return { price: k.open, reason: 'stop' };
    if (k.open <= p.target) return { price: k.open, reason: 'target' };
    if (k.high >= p.stop) return { price: p.stop, reason: 'stop' };
    if (k.low <= p.target) return { price: p.target, reason: 'target' };
  }
  return null;
}

export class ReplayEngine {
  active = false;
  cursor = 0;              // start time of the last revealed 1-minute bar
  playing = false;
  speed = 2;               // steps per second
  stepMode: StepMode = 'bar';
  busy = false;            // a step or a data fetch is running
  ended = false;           // no more data after the cursor
  message = '';
  position: Position | null = null;
  trades: ClosedTrade[] = [];

  private buf: KLineData[] = [];   // 1-minute bars, full session, sorted
  private bufMore = true;          // the server may have bars after the buffer
  private idx = -1;                // index of the cursor bar in buf
  private cur: KLineData | null = null; // the forming candle on the chart
  private timer: number | undefined;

  constructor(private chart: Chart, private hooks: ReplayHooks) {}

  get price(): number | null { return this.idx >= 0 ? this.buf[this.idx].close : null; }
  get openPnl(): number { return this.position && this.price !== null ? pnlOf(this.position, this.price) : 0; }

  private span(tf: number) { return (tf >= 1440 ? 26 * HOUR : tf * MIN) + MIN; }
  private shows(t: number) { return !this.hooks.view().rth || rthMinute(t); }
  private key(t: number) { const v = this.hooks.view(); return barTime(t, v.tf, v.rth); }

  /** Load 1-minute bars so the buffer covers [from, from + CHUNK minutes of trading]. */
  private async loadFrom(from: number) {
    const bars = await this.hooks.fetch1m(from - 1, CHUNK);
    this.buf = bars;
    this.bufMore = bars.length >= CHUNK;
  }
  private async extend(): Promise<boolean> {
    if (!this.bufMore || !this.buf.length) return false;
    const more = await this.hooks.fetch1m(this.buf[this.buf.length - 1].timestamp, CHUNK);
    this.bufMore = more.length >= CHUNK;
    if (!more.length) return false;
    // keep the buffer bounded: drop bars well before the cursor's candle
    const keepFrom = this.cursor - this.span(this.hooks.view().tf) - 3 * 24 * HOUR;
    const drop = this.buf.findIndex(k => k.timestamp >= keepFrom);
    if (drop > 0) { this.buf = this.buf.slice(drop); this.idx -= drop; }
    this.buf = this.buf.concat(more);
    return true;
  }
  /** Index of the last buffered bar at or before t. */
  private indexAt(t: number): number {
    let lo = 0, hi = this.buf.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.buf[m].timestamp <= t) lo = m + 1; else hi = m; }
    return lo - 1;
  }
  private async placeCursor(t: number): Promise<boolean> {
    const tf = this.hooks.view().tf;
    if (!this.buf.length || t - this.span(tf) < this.buf[0].timestamp || t > this.buf[this.buf.length - 1].timestamp) {
      await this.loadFrom(t - this.span(tf) - 6 * HOUR);
    }
    let i = this.indexAt(t);
    while (i >= 0 && !this.shows(this.buf[i].timestamp)) i--;
    if (i < 0) return false;
    this.idx = i;
    this.cursor = this.buf[i].timestamp;
    return true;
  }

  /** Start (or restart) replay so that the bar at time `t` is the last one shown. */
  async start(t: number) {
    this.pause();
    this.busy = true; this.message = ''; this.ended = false;
    this.hooks.onChange();
    try {
      const ok = await this.placeCursor(t);
      if (!ok) { this.message = 'No price data at that point — pick another bar.'; return; }
      this.active = true;
      this.hooks.reset();
    } catch {
      this.message = 'Could not load price data for replay. Check your connection.';
    } finally {
      this.busy = false;
      this.hooks.onChange();
    }
  }

  /** History ends where the cursor's candle begins; that candle is built here from 1m bars. */
  historyEnd(): number { return this.key(this.cursor); }
  formingCandle(): KLineData | null {
    const key = this.key(this.cursor);
    let c = null as KLineData | null; // cast: keeps TS from narrowing it to null inside the loop
    for (let i = this.indexAt(this.cursor); i >= 0; i--) {
      const k = this.buf[i];
      if (!this.shows(k.timestamp)) continue;
      if (this.key(k.timestamp) !== key) break;
      // walking backwards: each earlier minute supplies the open
      const prev: KLineData | null = c;
      c = prev
        ? { ...prev, open: k.open, high: Math.max(prev.high, k.high), low: Math.min(prev.low, k.low), volume: (prev.volume ?? 0) + (k.volume ?? 0) }
        : { timestamp: key, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume ?? 0 };
    }
    this.cur = c;
    return c;
  }

  // ---------- stepping ----------
  private async nextIndex(): Promise<number> {
    if (this.idx + 1 < this.buf.length) return this.idx + 1;
    if (await this.extend()) return this.idx + 1;
    return -1;
  }

  /** Reveal one minute (1m mode) or finish the next candle (bar mode). */
  async stepForward(): Promise<boolean> {
    if (!this.active || this.busy) return false;
    this.busy = true;
    try {
      let target: number | null = null; // key of the candle being completed
      for (;;) {
        const n = await this.nextIndex();
        if (n < 0) { this.ended = true; this.pause(); this.message = 'End of the data.'; return false; }
        const k = this.buf[n];
        const shown = this.shows(k.timestamp);
        if (shown) {
          const key = this.key(k.timestamp);
          if (target === null) target = key;
          else if (key !== target) break;  // the next minute starts another candle: stop here
        }
        this.consume(n);
        if (shown && this.stepMode === '1m') break;
      }
      return true;
    } finally {
      this.busy = false;
      this.hooks.onChange();
    }
  }

  private consume(n: number) {
    const k = this.buf[n];
    this.idx = n;
    this.cursor = k.timestamp;
    // stops and targets work on every minute, including ones hidden in RTH view
    const p = this.position;
    if (p && k.timestamp > p.entryMinute) {
      const f = fillOn(p, k);
      if (f) this.closePosition(f.price, k.timestamp + MIN, f.reason);
    }
    if (!this.shows(k.timestamp)) return;
    const key = this.key(k.timestamp);
    if (this.cur && this.cur.timestamp === key) {
      this.cur = { ...this.cur, high: Math.max(this.cur.high, k.high), low: Math.min(this.cur.low, k.low), close: k.close, volume: (this.cur.volume ?? 0) + (k.volume ?? 0) };
    } else {
      this.cur = { timestamp: key, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume ?? 0 };
    }
    this.hooks.push(this.cur);
    if (this.position) this.syncBracket();
  }

  /** Step back one minute or one candle. Not allowed past an open position's entry. */
  async stepBack() {
    if (!this.active || this.busy) return;
    let i = this.idx - 1;
    if (this.stepMode === '1m') {
      while (i >= 0 && !this.shows(this.buf[i].timestamp)) i--;
    } else {
      const key = this.key(this.cursor);
      while (i >= 0 && (!this.shows(this.buf[i].timestamp) || this.key(this.buf[i].timestamp) === key)) i--;
    }
    const t = i >= 0 ? this.buf[i].timestamp : this.cursor - this.span(this.hooks.view().tf) - MIN;
    if (this.position && t < this.position.entryMinute) {
      this.message = 'Close the open position before stepping back past its entry.';
      this.hooks.onChange();
      return;
    }
    this.pause();
    this.busy = true;
    try {
      const ok = await this.placeCursor(t);
      if (!ok) { this.message = 'This is the start of the data.'; return; }
      this.ended = false; this.message = '';
      this.hooks.reset();
    } finally {
      this.busy = false;
      this.hooks.onChange();
    }
  }

  play() {
    if (!this.active || this.playing || this.ended) return;
    this.playing = true;
    const tick = async () => {
      if (!this.playing) return;
      const t0 = Date.now();
      await this.stepForward();
      if (this.playing) this.timer = window.setTimeout(tick, Math.max(0, 1000 / this.speed - (Date.now() - t0)));
    };
    this.timer = window.setTimeout(tick, 0);
    this.hooks.onChange();
  }
  pause() {
    this.playing = false;
    window.clearTimeout(this.timer);
    this.hooks.onChange();
  }

  /** After the chart rebuilt itself (timeframe, RTH, step back): put the overlays back. */
  afterReset() { this.syncBracket(); }

  // ---------- trading ----------
  open(o: OrderInput): string | null {
    if (!this.active || this.position) return 'A position is already open.';
    const price = this.price;
    if (price === null) return 'No price yet.';
    const dir = o.side === 'long' ? 1 : -1;
    if (!(o.stopPts > 0)) return 'Stop must be more than 0 points.';
    if (!(o.target > 0)) return 'Target must be more than 0.';
    const stop = toTick(price - dir * o.stopPts);
    const reward = o.targetUnit === 'R' ? o.stopPts * o.target : o.target;
    const target = toTick(price + dir * reward);
    this.position = {
      side: o.side, qty: o.qty, contract: o.contract, entry: price,
      entryTime: this.cursor + MIN, entryMinute: this.cursor,
      stop, target, setup: o.setup, notes: o.notes,
    };
    this.message = '';
    this.syncBracket();
    this.hooks.onChange();
    return null;
  }

  /** Move the stop or target (from dragging the bracket); rejects levels on the wrong side of entry. */
  moveBracket(stop: number, target: number) {
    const p = this.position;
    if (!p) return;
    const dir = p.side === 'long' ? 1 : -1;
    stop = toTick(stop); target = toTick(target);
    if ((p.entry - stop) * dir > 0) p.stop = stop;
    if ((target - p.entry) * dir > 0) p.target = target;
    this.syncBracket();
    this.hooks.onChange();
  }

  closeAtMarket(reason: ExitReason = 'manual') {
    if (!this.position || this.price === null) return;
    this.closePosition(this.price, this.cursor + MIN, reason);
    this.hooks.onChange();
  }

  private closePosition(exit: number, exitTime: number, reason: ExitReason) {
    const p = this.position!;
    this.position = null;
    const t: ClosedTrade = {
      ...p, id: newTradeId(), exit, exitTime, reason,
      pnl: pnlOf(p, exit), r: rOf(p, exit), tf: this.hooks.view().tf, saved: 'pending',
    };
    this.trades = [...this.trades, t];
    this.syncBracket();
    this.drawTrades();
    this.hooks.onClosed(t);
  }

  markSaved(id: string, saved: ClosedTrade['saved'], error?: string) {
    this.trades = this.trades.map(t => (t.id === id ? { ...t, saved, error } : t));
    this.hooks.onChange();
  }

  /** Leave replay. An open position is closed at the current price and logged. */
  exit() {
    this.pause();
    if (this.position) this.closeAtMarket('end');
    this.active = false;
    this.chart.removeOverlay({ groupId: 'replay' });
    this.cur = null;
    this.hooks.onChange();
  }

  // ---------- overlays ----------
  private syncBracket() {
    const p = this.position;
    if (!p) { this.chart.removeOverlay({ id: BRACKET_ID }); return; }
    const v = this.hooks.view();
    const t = barTime(p.entryMinute, v.tf, v.rth);
    const spec: OverlayCreate = {
      id: BRACKET_ID, name: 'jc_bracket', groupId: 'replay', paneId: PANE,
      points: [{ timestamp: t, value: p.entry }, { timestamp: t, value: p.stop }, { timestamp: t, value: p.target }],
      extendData: { side: p.side, qty: p.qty, contract: p.contract, entry: p.entry, stop: p.stop, target: p.target, pnl: this.openPnl },
      onPressedMoveEnd: ({ overlay }) => {
        const [e, s, tg] = overlay.points;
        if (e.value === p.entry && typeof s.value === 'number' && typeof tg.value === 'number') this.moveBracket(s.value, tg.value);
        else this.syncBracket(); // dragging the entry line is not allowed: snap back
      },
    };
    if (this.chart.getOverlays({ id: BRACKET_ID }).length) this.chart.overrideOverlay(spec);
    else this.chart.createOverlay(spec);
  }

  /** Entry/exit markers for this session's closed trades (redrawn after a timeframe change). */
  drawTrades() {
    const v = this.hooks.view();
    this.chart.removeOverlay({ groupId: 'replay', name: 'jc_trade' });
    for (const t of this.trades) {
      this.chart.createOverlay({
        name: 'jc_trade', groupId: 'replay', paneId: PANE, lock: true,
        points: [{ timestamp: barTime(t.entryMinute, v.tf, v.rth), value: t.entry }, { timestamp: barTime(t.exitTime - MIN, v.tf, v.rth), value: t.exit }],
        extendData: { side: t.side, pnl: t.pnl, r: t.r },
      });
    }
  }
}

function newTradeId(): string {
  try { return crypto.randomUUID(); } catch { return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`; }
}
