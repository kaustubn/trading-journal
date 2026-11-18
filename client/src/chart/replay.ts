// Bar replay: hides everything after a chosen moment and reveals the market one
// 1-minute bar at a time. One ReplayEngine (the clock, the 1-minute data, the
// position and the trades) drives every chart window; each window has a ReplayView
// that rebuilds candles of ITS timeframe from the same minutes, so a 1m, 5m and 15m
// chart all grow together, exactly as they did live.
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
  ruleBreaks: string[];              // coach rules broken on this trade (logged with it)
  // scale in / out: every entry and exit is counted, so the saved trade's P&L is exact
  entryQty?: number; entrySum?: number;   // contracts bought (sold for a short) and their total price
  exitQty?: number; exitSum?: number;     // contracts closed so far and their total price
  riskUsd?: number;                       // $ at risk at the first entry (for R)
}
export interface ClosedTrade extends Position {
  id: string; exit: number; exitTime: number; reason: ExitReason; pnl: number; r: number;
  tf: number; saved: 'pending' | 'saved' | 'failed'; error?: string;
  dbId?: number; tags?: string[];   // the journal trade once saved (quick tags at exit write to it)
}
export interface OrderInput {
  side: Side; qty: number; contract: Contract;
  stopPts: number; target: number; targetUnit: 'R' | 'pts';
  setup: string; notes: string;
}

export type OrderType = 'market' | 'limit' | 'stop';
/** A working entry order (forward test): fills when the live price reaches it. */
export interface PendingOrder extends OrderInput { id: string; type: 'limit' | 'stop'; price: number; placed: number; }

export interface ReplayHooks {
  fetch1m: (afterMs: number, limit: number) => Promise<KLineData[]>;
  rth: () => boolean;                    // regular-trading-hours view (shared by all windows)
  stepTf: () => number;                  // timeframe a 'bar' step completes (the active window's)
  onReset: () => void;                   // every window rebuilds its chart around the cursor
  onMinute: (k: KLineData) => void;      // a revealed, shown minute: every window grows its candle
  onOverlays: () => void;                // position or trades changed: every window redraws them
  onChange: () => void;
  onClosed: (t: ClosedTrade) => void;    // log it to the journal
  onStopWidened?: (prevStop: number) => void; // the stop was dragged further from entry
  onLive?: (k: KLineData) => void;       // forward test: the minute being played, as it grows second by second
}

// ---------- forward test: a 60-second price path through a 1-minute bar ----------
function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/**
 * Second-by-second prices for one minute. We only have the minute's open, high, low and
 * close, so the path goes open → first extreme → second extreme → close (low first on an
 * up bar, high first on a down bar) with a little noise, always inside the bar's range and
 * on the tick grid. The same bar always gets the same path.
 */
export function minutePath(k: KLineData): number[] {
  const r = rng(Math.floor(k.timestamp / 60000));
  const up = k.close >= k.open;
  const first = up ? k.low : k.high, second = up ? k.high : k.low;
  const t1 = 3 + Math.floor(r() * 25);
  const t2 = Math.min(56, t1 + 6 + Math.floor(r() * Math.max(1, 50 - t1)));
  const way: [number, number][] = [[0, k.open], [t1, first], [t2, second], [59, k.close]];
  const range = k.high - k.low;
  const out: number[] = new Array(60);
  for (let w = 0; w < way.length - 1; w++) {
    const [s0, p0] = way[w], [s1, p1] = way[w + 1];
    for (let sec = s0; sec <= s1; sec++) {
      const f = s1 === s0 ? 1 : (sec - s0) / (s1 - s0);
      const noise = sec === s0 || sec === s1 ? 0 : (r() - 0.5) * range * 0.25 * Math.sin(Math.PI * f);
      const v = Math.min(k.high, Math.max(k.low, p0 + (p1 - p0) * f + noise));
      out[sec] = Math.round(v / TICK) * TICK;
    }
  }
  out[0] = k.open; out[t1] = first; out[t2] = second; out[59] = k.close;
  return out;
}

const toTick = (v: number) => Math.round(v / TICK) * TICK;
const rthMinute = (t: number) => { const m = etMinutes(t); return m >= 570 && m < 960; };

export function pnlOf(p: Pick<Position, 'side' | 'qty' | 'contract' | 'entry'>, price: number): number {
  const dir = p.side === 'long' ? 1 : -1;
  return Math.round((price - p.entry) * dir * POINT_VALUE[p.contract] * p.qty * 100) / 100;
}
/** P&L of the whole trade at `price`: closed parts + the open part. */
export function totalPnlOf(p: Position, price: number): number {
  const dir = p.side === 'long' ? 1 : -1;
  const es = p.entrySum ?? p.entry * p.qty, xs = p.exitSum ?? 0;
  return Math.round(dir * ((xs + p.qty * price) - es) * POINT_VALUE[p.contract] * 100) / 100;
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
  /** Forward test: play the market second by second (liveSpeed market seconds per real second). */
  live = false;
  liveSpeed = 1;
  pending: PendingOrder[] = [];
  private part: { n: number; k: KLineData; path: number[]; s: number } | null = null;
  private liveTimer: number | undefined;

  private buf: KLineData[] = [];   // 1-minute bars, full session, sorted
  private bufMore = true;          // the server may have bars after the buffer
  private idx = -1;                // index of the cursor bar in buf
  /** True when the cursor sits on a loaded bar (false after a jump past the data). */
  get hasBar(): boolean { return this.idx >= 0 && !!this.buf[this.idx]; }
  private timer: number | undefined;

  constructor(private hooks: ReplayHooks) {}

  get price(): number | null {
    if (this.part) return this.part.path[this.part.s];
    return this.buf[this.idx]?.close ?? null; // the buffer can be reloaded (e.g. a jump past the data) before idx moves
  }
  /** Market time now: the end of the revealed minute, or the current second in a forward test. */
  get nowMs(): number { return this.part ? this.part.k.timestamp + (this.part.s + 1) * 1000 : this.cursor + MIN; }
  /** Start of the minute being shown (the one playing in a forward test). */
  private liveMinute(): number { return this.part ? this.part.k.timestamp : this.cursor; }
  get openPnl(): number { return this.position && this.price !== null ? totalPnlOf(this.position, this.price) : 0; }

  // Daily candles start up to ~24h before their last minute; keep that much history buffered
  private span(tf: number) { return (tf >= 1440 ? 26 * HOUR : tf * MIN) + MIN; }
  private maxSpan() { return 26 * HOUR + MIN; }     // any window may be on the daily chart
  shows(t: number) { return !this.hooks.rth() || rthMinute(t); }
  private key(t: number, tf: number) { return barTime(t, tf, this.hooks.rth()); }

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
    // keep the buffer bounded: drop bars well before the cursor's candles
    const keepFrom = this.cursor - this.maxSpan() - 3 * 24 * HOUR;
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
    if (!this.buf.length || t - this.maxSpan() < this.buf[0].timestamp || t > this.buf[this.buf.length - 1].timestamp) {
      await this.loadFrom(t - this.maxSpan() - 6 * HOUR);
    }
    let i = this.indexAt(t);
    while (i >= 0 && !this.shows(this.buf[i].timestamp)) i--;
    if (i < 0) return false;
    this.idx = i;
    this.cursor = this.buf[i].timestamp;
    return true;
  }

  /** Start (or restart) replay so that the minute at time `t` is the last one shown. */
  async start(t: number) {
    this.pause();
    this.part = null; this.pending = [];
    this.busy = true; this.message = ''; this.ended = false;
    this.hooks.onChange();
    try {
      const ok = await this.placeCursor(t);
      if (!ok) { this.idx = -1; this.message = 'No price data at that point — pick another bar.'; return; }
      this.active = true;
      this.hooks.onReset();
    } catch {
      this.message = 'Could not load price data for replay. Check your connection.';
    } finally {
      this.busy = false;
      this.hooks.onChange();
    }
  }

  /** For a window on timeframe `tf`: history ends where the cursor's candle begins… */
  historyEnd(tf: number): number { return this.key(this.liveMinute(), tf); }
  /** …and that candle is built here from the revealed 1-minute bars. */
  formingCandle(tf: number): KLineData | null {
    const key = this.key(this.liveMinute(), tf);
    let c = null as KLineData | null; // cast: keeps TS from narrowing it to null inside the loop
    for (let i = this.indexAt(this.cursor); i >= 0; i--) {
      const k = this.buf[i];
      if (!this.shows(k.timestamp)) continue;
      if (this.key(k.timestamp, tf) !== key) break;
      // walking backwards: each earlier minute supplies the open
      const prev: KLineData | null = c;
      c = prev
        ? { ...prev, open: k.open, high: Math.max(prev.high, k.high), low: Math.min(prev.low, k.low), volume: (prev.volume ?? 0) + (k.volume ?? 0) }
        : { timestamp: key, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume ?? 0 };
    }
    const lp = this.partial();
    if (lp && this.key(lp.timestamp, tf) === key) {
      const cc: KLineData | null = c;
      c = cc ? { ...cc, high: Math.max(cc.high, lp.high), low: Math.min(cc.low, lp.low), close: lp.close, volume: (cc.volume ?? 0) + (lp.volume ?? 0) }
        : { ...lp, timestamp: key };
    }
    return c;
  }
  /** The forward-test minute so far, as a 1-minute candle. */
  private partial(): KLineData | null {
    const p = this.part;
    if (!p) return null;
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i <= p.s; i++) { hi = Math.max(hi, p.path[i]); lo = Math.min(lo, p.path[i]); }
    return { timestamp: p.k.timestamp, open: p.path[0], high: hi, low: lo, close: p.path[p.s], volume: Math.round(((p.k.volume ?? 0) * (p.s + 1)) / 60) };
  }

  // ---------- forward test (live seconds) ----------
  /** Advance one market second. False at the end of the data. */
  private async liveSecond(): Promise<boolean> {
    if (!this.part) {
      const n = await this.nextIndex();
      if (n < 0) { this.ended = true; this.message = 'End of the data.'; return false; }
      const k = this.buf[n];
      if (!this.shows(k.timestamp)) { this.consume(n); return true; }   // hidden (RTH view): skip it whole
      this.part = { n, k, path: minutePath(k), s: 0 };
    } else {
      this.part.s++;
    }
    const p = this.part;
    this.liveFills(p.path[p.s], p.k.timestamp + (p.s + 1) * 1000);
    const lp = this.partial();
    if (lp) this.hooks.onLive?.(lp);
    if (p.s >= 59) { this.idx = p.n; this.cursor = p.k.timestamp; this.part = null; }
    if (this.position || this.pending.length) this.hooks.onOverlays();
    return true;
  }
  /** Working orders, stops and targets against the live price, every second. */
  private liveFills(px: number, t: number) {
    const minute = this.part?.k.timestamp ?? this.cursor;
    if (!this.position && this.pending.length) {
      const hit = this.pending.find(o => o.side === 'long'
        ? (o.type === 'limit' ? px <= o.price : px >= o.price)
        : (o.type === 'limit' ? px >= o.price : px <= o.price));
      if (hit) {
        this.pending = this.pending.filter(o => o.id !== hit.id);
        const fill = hit.type === 'limit' ? (hit.side === 'long' ? Math.min(px, hit.price) : Math.max(px, hit.price)) : px;
        this.openAt(hit, fill, t, minute);
        return;
      }
    }
    const pos = this.position;
    if (!pos || t <= pos.entryTime) return;
    if (pos.side === 'long') {
      if (px <= pos.stop) this.closePosition(this.part?.s === 0 ? Math.min(px, pos.stop) : pos.stop, t, 'stop');   // a gap at the open fills at the open
      else if (px >= pos.target) this.closePosition(this.part?.s === 0 ? Math.max(px, pos.target) : pos.target, t, 'target');
    } else {
      if (px >= pos.stop) this.closePosition(this.part?.s === 0 ? Math.max(px, pos.stop) : pos.stop, t, 'stop');
      else if (px <= pos.target) this.closePosition(this.part?.s === 0 ? Math.min(px, pos.target) : pos.target, t, 'target');
    }
  }
  /** Finish the minute that is playing (before a manual step or leaving live mode). */
  private async finishMinute() {
    while (this.part) { if (!(await this.liveSecond())) break; }
  }
  setLive(on: boolean) {
    if (on === this.live) return;
    const wasPlaying = this.playing;
    this.pause();
    this.live = on;
    if (!on && this.part) { this.busy = true; this.finishMinute().finally(() => { this.busy = false; this.hooks.onChange(); }); }
    if (wasPlaying && on) this.play();
    this.hooks.onChange();
  }

  // ---------- stepping ----------
  private async nextIndex(): Promise<number> {
    if (this.idx + 1 < this.buf.length) return this.idx + 1;
    if (await this.extend()) return this.idx + 1;
    return -1;
  }

  /** Reveal one minute (1m mode) or finish the next candle of the active window (bar mode). */
  async stepForward(): Promise<boolean> {
    if (!this.active || this.busy) return false;
    if (this.part) {
      this.busy = true;
      try { await this.finishMinute(); } finally { this.busy = false; this.hooks.onChange(); }
      if (this.stepMode === '1m') return true;
    }
    this.busy = true;
    const tf = this.hooks.stepTf();
    try {
      let target: number | null = null; // key of the candle being completed
      for (;;) {
        const n = await this.nextIndex();
        if (n < 0) { this.ended = true; this.pause(); this.message = 'End of the data.'; return false; }
        const k = this.buf[n];
        const shown = this.shows(k.timestamp);
        if (shown) {
          const key = this.key(k.timestamp, tf);
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
    if (this.shows(k.timestamp)) this.hooks.onMinute(k);
    if (this.position) this.hooks.onOverlays(); // live P&L on the bracket
  }

  /** Step back one minute or one candle of the active window. Not allowed past an open position's entry. */
  async stepBack() {
    if (!this.active || this.busy) return;
    if (this.part && !this.position) this.part = null;   // drop the half-played minute
    const tf = this.hooks.stepTf();
    let i = this.idx - 1;
    if (this.stepMode === '1m') {
      while (i >= 0 && !this.shows(this.buf[i].timestamp)) i--;
    } else {
      const key = this.key(this.cursor, tf);
      while (i >= 0 && (!this.shows(this.buf[i].timestamp) || this.key(this.buf[i].timestamp, tf) === key)) i--;
    }
    const t = i >= 0 ? this.buf[i].timestamp : this.cursor - this.span(tf) - MIN;
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
      this.hooks.onReset();
    } finally {
      this.busy = false;
      this.hooks.onChange();
    }
  }

  play() {
    if (!this.active || this.playing || this.ended) return;
    this.playing = true;
    if (this.live) {
      let last = Date.now(), acc = 0;
      const tick = async () => {
        if (!this.playing || !this.live) return;
        const now = Date.now();
        acc += (now - last) * this.liveSpeed; last = now;
        let n = Math.min(240, Math.floor(acc / 1000));
        acc -= n * 1000;
        let moved = false;
        if (!this.busy) {
          this.busy = true;
          try {
            while (n-- > 0) { if (!(await this.liveSecond())) { this.playing = false; break; } moved = true; }
          } finally { this.busy = false; }
        }
        if (moved || !this.playing) this.hooks.onChange();
        if (this.playing) this.liveTimer = window.setTimeout(tick, 100);
      };
      this.liveTimer = window.setTimeout(tick, 100);
      this.hooks.onChange();
      return;
    }
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
    window.clearTimeout(this.liveTimer);
    this.hooks.onChange();
  }

  // ---------- trading ----------
  open(o: OrderInput, ruleBreaks: string[] = []): string | null {
    if (!this.active) return 'Replay is not running.';
    if (this.position) return 'A position is already open.';
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
      entryTime: this.nowMs, entryMinute: this.liveMinute(),
      stop, target, setup: o.setup, notes: o.notes, ruleBreaks: [...ruleBreaks],
      entryQty: o.qty, entrySum: o.qty * price, exitQty: 0, exitSum: 0, riskUsd: Math.abs(price - stop) * POINT_VALUE[o.contract] * o.qty,
    };
    this.message = '';
    this.hooks.onOverlays();
    this.hooks.onChange();
    return null;
  }

  /** Forward test: a limit or stop entry that fills when the live price gets there. */
  placeOrder(o: OrderInput & { type: 'limit' | 'stop'; price: number }): string | null {
    if (!this.active) return 'Replay is not running.';
    const px = this.price;
    if (px === null) return 'No price yet.';
    if (!(o.stopPts > 0) || !(o.target > 0)) return 'Stop and target must be more than 0.';
    const price = toTick(o.price);
    const long = o.side === 'long';
    if (o.type === 'limit' && (long ? price >= px : price <= px)) return `A ${long ? 'buy' : 'sell'} limit must be ${long ? 'below' : 'above'} the price (${px}).`;
    if (o.type === 'stop' && (long ? price <= px : price >= px)) return `A ${long ? 'buy' : 'sell'} stop must be ${long ? 'above' : 'below'} the price (${px}).`;
    if (this.pending.length >= 5) return 'At most 5 working orders.';
    this.pending = [...this.pending, { ...o, price, id: newTradeId(), placed: this.nowMs }];
    this.hooks.onOverlays();
    this.hooks.onChange();
    return null;
  }
  cancelOrder(id: string) {
    this.pending = this.pending.filter(o => o.id !== id);
    this.hooks.onOverlays();
    this.hooks.onChange();
  }
  private openAt(o: OrderInput, fill: number, t: number, minute: number) {
    const dir = o.side === 'long' ? 1 : -1;
    const reward = o.targetUnit === 'R' ? o.stopPts * o.target : o.target;
    this.position = {
      side: o.side, qty: o.qty, contract: o.contract, entry: toTick(fill), entryTime: t, entryMinute: minute,
      stop: toTick(fill - dir * o.stopPts), target: toTick(fill + dir * reward),
      setup: o.setup, notes: o.notes, ruleBreaks: [],
      entryQty: o.qty, entrySum: o.qty * toTick(fill), exitQty: 0, exitSum: 0, riskUsd: o.stopPts * POINT_VALUE[o.contract] * o.qty,
    };
    this.message = `${o.side === 'long' ? 'Bought' : 'Sold'} ${o.qty} ${o.contract} @ ${toTick(fill)} (working order filled)`;
    this.hooks.onOverlays();
  }

  /** Move the stop or target (from dragging the bracket); rejects levels on the wrong side of entry. */
  moveBracket(stop: number, target: number) {
    const p = this.position;
    if (!p) return;
    const dir = p.side === 'long' ? 1 : -1;
    stop = toTick(stop); target = toTick(target);
    const prevStop = p.stop;
    if ((p.entry - stop) * dir > 0) p.stop = stop;
    if (Math.abs(p.entry - p.stop) > Math.abs(p.entry - prevStop) + 1e-9) this.hooks.onStopWidened?.(prevStop);
    if ((target - p.entry) * dir > 0) p.target = target;
    this.hooks.onOverlays();
    this.hooks.onChange();
  }

  /** Add contracts at the current price (scale in). The entry becomes the average. */
  scaleIn(n: number): string | null {
    const p = this.position, price = this.price;
    if (!p || price === null) return 'No open position.';
    if (!Number.isInteger(n) || n < 1 || p.qty + n > 100) return 'Size must stay between 1 and 100.';
    p.entryQty = (p.entryQty ?? p.qty) + n;
    p.entrySum = (p.entrySum ?? p.entry * p.qty) + n * price;
    p.qty += n;
    p.entry = Math.round((p.entrySum / p.entryQty) * 100) / 100;
    this.message = `Added ${n} @ ${price} — average entry ${p.entry}, ${p.qty} open`;
    this.hooks.onOverlays(); this.hooks.onChange();
    return null;
  }
  /** Close part of the position at the current price (scale out). */
  scaleOut(n: number): string | null {
    const p = this.position, price = this.price;
    if (!p || price === null) return 'No open position.';
    if (!Number.isInteger(n) || n < 1) return 'Choose how many contracts to close.';
    if (n >= p.qty) { this.closeAtMarket('manual'); return null; }
    p.exitQty = (p.exitQty ?? 0) + n;
    p.exitSum = (p.exitSum ?? 0) + n * price;
    p.qty -= n;
    this.message = `Closed ${n} @ ${price} — ${p.qty} still open`;
    this.hooks.onOverlays(); this.hooks.onChange();
    return null;
  }
  /** Move the stop to the average entry (break-even). */
  breakEven(): string | null {
    const p = this.position, price = this.price;
    if (!p || price === null) return 'No open position.';
    const be = toTick(p.entry);
    const dir = p.side === 'long' ? 1 : -1;
    if ((price - be) * dir <= 0) return 'Price is not past your entry yet — break-even would stop you out now.';
    p.stop = be;
    this.message = `Stop moved to break-even (${be})`;
    this.hooks.onOverlays(); this.hooks.onChange();
    return null;
  }

  /** Put the stop back (coach: undo a widened stop). */
  setStop(stop: number) {
    const p = this.position;
    if (!p) return;
    const dir = p.side === 'long' ? 1 : -1;
    if ((p.entry - stop) * dir > 0) p.stop = toTick(stop);
    this.hooks.onOverlays();
    this.hooks.onChange();
  }
  /** Record a rule broken while the position is open. */
  addRuleBreak(text: string) {
    if (this.position && !this.position.ruleBreaks.includes(text)) this.position.ruleBreaks.push(text);
  }

  closeAtMarket(reason: ExitReason = 'manual') {
    if (!this.position || this.price === null) return;
    this.closePosition(this.price, this.nowMs, reason);
    this.hooks.onChange();
  }

  private closePosition(exit: number, exitTime: number, reason: ExitReason) {
    const p = this.position!;
    this.position = null;
    // with partial exits / adds: the journal gets the total size, average entry and average exit
    const eq = p.entryQty ?? p.qty, es = p.entrySum ?? p.entry * p.qty;
    const xq = (p.exitQty ?? 0) + p.qty, xs = (p.exitSum ?? 0) + p.qty * exit;
    const avgEntry = Math.round((es / eq) * 100) / 100, avgExit = Math.round((xs / xq) * 100) / 100;
    const pnl = totalPnlOf(p, exit);
    const risk = p.riskUsd ?? Math.abs(p.entry - p.stop) * POINT_VALUE[p.contract] * p.qty;
    const t: ClosedTrade = {
      ...p, qty: eq, entry: avgEntry, id: newTradeId(), exit: avgExit, exitTime, reason,
      pnl, r: risk > 0 ? Math.round((pnl / risk) * 100) / 100 : rOf(p, exit), tf: this.hooks.stepTf(), saved: 'pending',
    };
    this.trades = [...this.trades, t];
    this.hooks.onOverlays();
    this.hooks.onClosed(t);
  }

  markSaved(id: string, saved: ClosedTrade['saved'], error?: string, db?: { dbId?: number; tags?: string[] }) {
    this.trades = this.trades.map(t => (t.id === id ? { ...t, saved, error, ...(db ?? {}) } : t));
    this.hooks.onChange();
  }

  /** Leave replay. An open position is closed at the current price and logged. */
  exit() {
    this.pause();
    if (this.position) this.closeAtMarket('end');
    this.part = null; this.pending = [];
    this.active = false;
    this.hooks.onOverlays();
    this.hooks.onChange();
  }
}

/**
 * One chart window's side of replay: grows that window's newest candle from the
 * revealed minutes, and draws the open position's bracket and the closed trades.
 */
export class ReplayView {
  private cur: KLineData | null = null;

  constructor(
    private chart: Chart,
    private engine: ReplayEngine,
    private view: () => { tf: number; rth: boolean },
    private push: (k: KLineData) => void,
  ) {}

  /** The candle the cursor is in, for this window's timeframe (used when the chart reloads). */
  formingCandle(): KLineData | null {
    this.cur = this.engine.formingCandle(this.view().tf);
    return this.cur;
  }

  private liveBase: KLineData | null = null;
  private liveT = -1;
  /** Forward test: the playing minute grew; merge it into this window's candle. */
  onLive(k: KLineData) {
    const { tf, rth } = this.view();
    const key = barTime(k.timestamp, tf, rth);
    if (k.timestamp !== this.liveT) {
      this.liveT = k.timestamp;
      this.liveBase = this.cur && this.cur.timestamp === key ? this.cur : null;
    }
    const b = this.liveBase;
    this.cur = b
      ? { ...b, high: Math.max(b.high, k.high), low: Math.min(b.low, k.low), close: k.close, volume: (b.volume ?? 0) + (k.volume ?? 0) }
      : { timestamp: key, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume ?? 0 };
    this.push(this.cur);
  }

  onMinute(k: KLineData) {
    this.liveT = -1;
    const { tf, rth } = this.view();
    const key = barTime(k.timestamp, tf, rth);
    if (this.cur && this.cur.timestamp === key) {
      this.cur = { ...this.cur, high: Math.max(this.cur.high, k.high), low: Math.min(this.cur.low, k.low), close: k.close, volume: (this.cur.volume ?? 0) + (k.volume ?? 0) };
    } else {
      this.cur = { timestamp: key, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume ?? 0 };
    }
    this.push(this.cur);
  }

  /** Bracket of the open position and markers of this session's closed trades. */
  drawOverlays() {
    const eng = this.engine;
    if (!eng.active) { this.chart.removeOverlay({ groupId: 'replay' }); this.cur = null; return; }
    const { tf, rth } = this.view();
    const p = eng.position;
    if (!p) this.chart.removeOverlay({ id: BRACKET_ID });
    else {
      const t = barTime(p.entryMinute, tf, rth);
      const spec: OverlayCreate = {
        id: BRACKET_ID, name: 'jc_bracket', groupId: 'replay', paneId: PANE,
        points: [{ timestamp: t, value: p.entry }, { timestamp: t, value: p.stop }, { timestamp: t, value: p.target }],
        extendData: { side: p.side, qty: p.qty, contract: p.contract, entry: p.entry, stop: p.stop, target: p.target, pnl: eng.openPnl },
        onPressedMoveEnd: ({ overlay }) => {
          const [e, s, tg] = overlay.points;
          if (e.value === p.entry && typeof s.value === 'number' && typeof tg.value === 'number') eng.moveBracket(s.value, tg.value);
          else this.drawOverlays(); // dragging the entry line is not allowed: snap back
        },
      };
      if (this.chart.getOverlays({ id: BRACKET_ID }).length) this.chart.overrideOverlay(spec);
      else this.chart.createOverlay(spec);
    }
    // working entry orders (forward test) as dashed lines with a label
    const want = new Set(eng.pending.map(o => `pending_${o.id}`));
    for (const o of this.chart.getOverlays({ groupId: 'replay', name: 'jc_hline' })) if (!want.has(o.id)) this.chart.removeOverlay({ id: o.id });
    for (const o of eng.pending) {
      const id = `pending_${o.id}`;
      if (this.chart.getOverlays({ id }).length) continue;
      const col = o.side === 'long' ? '#089981' : '#f23645';
      this.chart.createOverlay({
        id, name: 'jc_hline', groupId: 'replay', paneId: PANE, lock: true,
        points: [{ timestamp: barTime(eng.cursor, tf, rth), value: o.price }],
        extendData: { id, tool: 'hline', points: [], color: col, width: 1, line: 'dashed', text: `${o.side === 'long' ? 'BUY' : 'SELL'} ${o.type.toUpperCase()} ${o.qty} ${o.contract}`, textColor: col },
      } as OverlayCreate);
    }
    const shown = this.chart.getOverlays({ groupId: 'replay', name: 'jc_trade' }).length;
    if (shown !== eng.trades.length || !eng.trades.length) {
      this.chart.removeOverlay({ groupId: 'replay', name: 'jc_trade' });
      for (const tr of eng.trades) {
        this.chart.createOverlay({
          name: 'jc_trade', groupId: 'replay', paneId: PANE, lock: true,
          points: [{ timestamp: barTime(tr.entryMinute, tf, rth), value: tr.entry }, { timestamp: barTime(tr.exitTime - MIN, tf, rth), value: tr.exit }],
          extendData: { side: tr.side, pnl: tr.pnl, r: tr.r },
        });
      }
    }
  }

  /** Timeframe changed: the trade markers must be re-placed on the new candles. */
  redrawTrades() {
    this.chart.removeOverlay({ groupId: 'replay', name: 'jc_trade' });
    this.drawOverlays();
  }
}

function newTradeId(): string {
  try { return crypto.randomUUID(); } catch { return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`; }
}
