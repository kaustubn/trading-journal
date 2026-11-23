// Shared with the client (client/src/chart) and tests/patterns.test.ts: pure logic, no chart library.
// Candle patterns: mark the candle patterns you pick, alone or N in a row (e.g. 2 engulfing candles one after the
// other), on the chart's timeframe or a higher one (e.g. 5-minute patterns on a 1-minute chart, marked on the bar
// that closes the 5-minute candle). Only finished candles count, so nothing repaints, live or in Replay.
// Backtest stats: how often each pattern was followed by a move its way over the next N candles, and by how much.
/** The bar fields the pattern logic needs (Bar from klinecharts fits). */
export interface Bar { timestamp: number; open: number; high: number; low: number; close: number; }

export type CType = 'bullEngulf' | 'bearEngulf' | 'hammer' | 'star' | 'doji' | 'inside' | 'outside' | 'bigBull' | 'bigBear' | 'threeBull' | 'threeBear' | 'morningStar' | 'eveningStar' | 'tweezerBottom' | 'tweezerTop' | 'pinBull' | 'pinBear';
export const CANDLE_INFO: Record<CType, { label: string; short: string; bias: 1 | -1 | 0 }> = {
  bullEngulf: { label: 'Bullish engulfing', short: 'BuE', bias: 1 },
  bearEngulf: { label: 'Bearish engulfing', short: 'BeE', bias: -1 },
  hammer: { label: 'Hammer (long lower wick)', short: 'Ham', bias: 1 },
  star: { label: 'Shooting star (long upper wick)', short: 'SS', bias: -1 },
  pinBull: { label: 'Bullish pin bar (wick ≥ 2/3, close top third)', short: 'PinB', bias: 1 },
  pinBear: { label: 'Bearish pin bar', short: 'PinS', bias: -1 },
  doji: { label: 'Doji (tiny body)', short: 'Doji', bias: 0 },
  inside: { label: 'Inside bar', short: 'IB', bias: 0 },
  outside: { label: 'Outside bar', short: 'OB', bias: 0 },
  bigBull: { label: 'Big green candle (2× normal body)', short: 'Big↑', bias: 1 },
  bigBear: { label: 'Big red candle (2× normal body)', short: 'Big↓', bias: -1 },
  threeBull: { label: 'Three green in a row', short: '3G', bias: 1 },
  threeBear: { label: 'Three red in a row', short: '3R', bias: -1 },
  morningStar: { label: 'Morning star', short: 'MStar', bias: 1 },
  eveningStar: { label: 'Evening star', short: 'EStar', bias: -1 },
  tweezerBottom: { label: 'Tweezer bottom', short: 'TwzB', bias: 1 },
  tweezerTop: { label: 'Tweezer top', short: 'TwzT', bias: -1 },
};
export const CANDLE_TYPES = Object.keys(CANDLE_INFO) as CType[];

export interface CndlOpts {
  types: Partial<Record<CType, boolean>>;
  run: number;                 // how many in a row (1 = single candle)
  runMode: 'same' | 'any';     // in a row: the same pattern each time, or any of the picked patterns
  // body: body covers the previous body, any colour before (Kay's BBE rule); classic: opposite colour before;
  // close: closes past the previous high (bull) / low (bear) after opening inside its body
  engulf: 'body' | 'classic' | 'close';
  tf: number;                  // 0 = chart timeframe, else minutes (must be a multiple of the chart's)
  ahead: number;               // candles after the pattern for the stats
  labels: boolean; stats: boolean;
}
export const CNDL_DEFAULT: CndlOpts = {
  types: { bullEngulf: true, bearEngulf: true }, run: 1, runMode: 'same', engulf: 'body', tf: 0, ahead: 3, labels: true, stats: true,
};
export function sanitizeCndl(o: any): CndlOpts {
  const d: CndlOpts = { ...CNDL_DEFAULT, types: {} };
  if (!o || typeof o !== 'object') return { ...CNDL_DEFAULT, types: { ...CNDL_DEFAULT.types } };
  const num = (v: any, lo: number, hi: number, def: number) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.round(Number(v)) : def);
  d.run = num(o.run, 1, 6, 1); d.tf = num(o.tf, 0, 1440, 0); d.ahead = num(o.ahead, 1, 50, 3);
  d.runMode = o.runMode === 'any' ? 'any' : 'same';
  d.engulf = o.engulf === 'classic' || o.engulf === 'close' ? o.engulf : 'body';
  for (const k of ['labels', 'stats'] as const) if (typeof o[k] === 'boolean') d[k] = o[k];
  if (o.types && typeof o.types === 'object') for (const t of CANDLE_TYPES) if (o.types[t] === true) d.types[t] = true;
  if (!Object.keys(d.types).length) d.types = { ...CNDL_DEFAULT.types };
  return d;
}

export interface C { o: number; h: number; l: number; c: number; last: number; t: number; }   // last = index of the chart bar that closes it

/** Candles of `tf` minutes built from the chart's bars (clock-aligned); the unfinished last one is dropped. */
export function toTf(d: Bar[], chartTf: number, tf: number, now: number): C[] {
  const out: C[] = [];
  const step = (tf || chartTf) * 60000;
  for (let i = 0; i < d.length; i++) {
    const b = d[i], key = Math.floor(b.timestamp / step) * step;
    const cur = out[out.length - 1];
    if (cur && cur.t === key) { cur.h = Math.max(cur.h, b.high); cur.l = Math.min(cur.l, b.low); cur.c = b.close; cur.last = i; }
    else out.push({ o: b.open, h: b.high, l: b.low, c: b.close, last: i, t: key });
  }
  // drop the last candle if it is not finished: still forming live, or (Replay / higher timeframe) the chart does not
  // yet hold its last minute
  const end = out[out.length - 1];
  if (end) {
    const lastBarEnd = d[end.last].timestamp + chartTf * 60000;
    if (end.t + step > now || lastBarEnd < end.t + step) out.pop();
  }
  return out;
}

/** All patterns of candle k (uses candles <= k only). */
export function classify(c: C[], k: number, avgBody: number, engulf: CndlOpts['engulf'] = 'classic'): CType[] {
  const x = c[k], out: CType[] = [];
  const body = Math.abs(x.c - x.o), rng = x.h - x.l, up = x.h - Math.max(x.o, x.c), dn = Math.min(x.o, x.c) - x.l;
  if (!(rng > 0)) return out;
  if (body <= 0.1 * rng) out.push('doji');
  if (dn >= 0.6 * rng && up <= 0.15 * rng) out.push('hammer');
  if (up >= 0.6 * rng && dn <= 0.15 * rng) out.push('star');
  if (dn >= (2 / 3) * rng && x.c >= x.l + (2 / 3) * rng) out.push('pinBull');
  if (up >= (2 / 3) * rng && x.c <= x.h - (2 / 3) * rng) out.push('pinBear');
  if (avgBody > 0 && body >= 2 * avgBody) out.push(x.c > x.o ? 'bigBull' : 'bigBear');
  if (k >= 1) {
    const p = c[k - 1], pb = Math.abs(p.c - p.o);
    const pTop = Math.max(p.o, p.c), pBot = Math.min(p.o, p.c);
    if (engulf === 'classic') {
      if (p.c < p.o && x.c > x.o && x.c >= p.o && x.o <= p.c && body > pb) out.push('bullEngulf');
      if (p.c > p.o && x.c < x.o && x.c <= p.o && x.o >= p.c && body > pb) out.push('bearEngulf');
    } else if (engulf === 'close') {
      if (x.c > x.o && x.c > p.h && x.o <= pTop) out.push('bullEngulf');
      if (x.c < x.o && x.c < p.l && x.o >= pBot) out.push('bearEngulf');
    } else {
      // body covers the previous body after a candle of either colour (Kay's BBE rule)
      if (x.c > x.o && x.c >= pTop && x.o <= pBot && body > pb) out.push('bullEngulf');
      if (x.c < x.o && x.o >= pTop && x.c <= pBot && body > pb) out.push('bearEngulf');
    }
    if (x.h < p.h && x.l > p.l) out.push('inside');
    if (x.h > p.h && x.l < p.l) out.push('outside');
    const tol = 0.05 * Math.max(rng, p.h - p.l);
    if (p.c < p.o && x.c > x.o && Math.abs(x.l - p.l) <= tol) out.push('tweezerBottom');
    if (p.c > p.o && x.c < x.o && Math.abs(x.h - p.h) <= tol) out.push('tweezerTop');
  }
  if (k >= 2) {
    const a = c[k - 2], b = c[k - 1], ab = Math.abs(a.c - a.o), bb = Math.abs(b.c - b.o);
    if (x.c > x.o && b.c > b.o && a.c > a.o) out.push('threeBull');
    if (x.c < x.o && b.c < b.o && a.c < a.o) out.push('threeBear');
    if (a.c < a.o && ab > 1.2 * avgBody && bb < 0.5 * ab && x.c > x.o && x.c > (a.o + a.c) / 2) out.push('morningStar');
    if (a.c > a.o && ab > 1.2 * avgBody && bb < 0.5 * ab && x.c < x.o && x.c < (a.o + a.c) / 2) out.push('eveningStar');
  }
  return out;
}

export interface Hit { last: number; k: number; types: CType[]; label: string; bias: number; }

/** Candles where the picked pattern(s) formed `run` times in a row. */
export function findCandles(c: C[], o: CndlOpts): Hit[] {
  const picked = CANDLE_TYPES.filter(t => o.types[t]);
  const per: CType[][] = [];
  const bodies: number[] = [];
  for (let k = 0; k < c.length; k++) {
    const avg = bodies.length ? bodies.slice(-20).reduce((s, b) => s + b, 0) / Math.min(20, bodies.length) : 0;
    per.push(classify(c, k, avg, o.engulf).filter(t => o.types[t]));
    bodies.push(Math.abs(c[k].c - c[k].o));
  }
  const out: Hit[] = [];
  for (let k = o.run - 1; k < c.length; k++) {
    const win = per.slice(k - o.run + 1, k + 1);
    if (win.some(w => !w.length)) continue;
    let types: CType[];
    if (o.run === 1 || o.runMode === 'any') types = win[win.length - 1];
    else { types = picked.filter(t => win.every(w => w.includes(t))); if (!types.length) continue; }
    // don't mark every candle of a longer streak: only where the streak first reaches `run`
    if (o.run > 1 && k - o.run >= 0 && (o.runMode === 'same' ? per[k - o.run].some(t => types.includes(t)) : per[k - o.run].length > 0)) continue;
    const bias = Math.sign(types.reduce((s, t) => s + CANDLE_INFO[t].bias, 0));
    const label = (o.run > 1 ? `${o.run}× ` : '') + types.map(t => CANDLE_INFO[t].short).join('/');
    out.push({ last: c[k].last, k, types, label, bias });
  }
  return out;
}

export function candleStats(c: C[], hits: Hit[], ahead: number) {
  const by: Record<string, { n: number; ok: number; pts: number }> = {};
  for (const h of hits) {
    const e = h.k + ahead;
    if (e >= c.length) continue;
    const dir = h.bias || 1, mv = (c[e].c - c[h.k].c) * dir;
    const s = (by[h.label] ??= { n: 0, ok: 0, pts: 0 }); s.n++; if (mv > 0) s.ok++; s.pts += mv;
  }
  return by;
}
