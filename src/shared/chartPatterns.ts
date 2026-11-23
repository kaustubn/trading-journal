// Shared with the client (client/src/chart) and tests/patterns.test.ts: pure logic, no chart library.
// Auto chart patterns: double / triple tops and bottoms, head & shoulders (and inverse), triangles, wedges, flags and
// channels, found on swing points and scored 0-100% by how close they are to the textbook shape ("similarity").
// A pattern is shown when its similarity >= the setting (default 75%).
//
// No repainting: a swing point only exists once price has moved back by `sensitivity x ATR` from it, and a pattern is
// only known at the bar that confirmed its last swing point. So it works the same live and in Replay (backtesting):
// the chart only holds bars up to the replay time.
// Backtest stats: for every pattern found in the loaded data, how often price then moved the pattern's way over the
// next N bars (shown in the indicator's legend).
/** The bar fields the pattern logic needs (Bar from klinecharts fits). */
export interface Bar { timestamp: number; open: number; high: number; low: number; close: number; }

export type PatType = 'dt' | 'db' | 'tt' | 'tb' | 'hs' | 'ihs' | 'asc' | 'desc' | 'sym' | 'rwedge' | 'fwedge' | 'bflag' | 'beflag' | 'chup' | 'chdn';
export const PAT_INFO: Record<PatType, { label: string; short: string; bias: 1 | -1 | 0; group: string }> = {
  dt: { label: 'Double top', short: 'DT', bias: -1, group: 'Reversal' },
  db: { label: 'Double bottom', short: 'DB', bias: 1, group: 'Reversal' },
  tt: { label: 'Triple top', short: 'TT', bias: -1, group: 'Reversal' },
  tb: { label: 'Triple bottom', short: 'TB', bias: 1, group: 'Reversal' },
  hs: { label: 'Head & shoulders', short: 'H&S', bias: -1, group: 'Reversal' },
  ihs: { label: 'Inverse head & shoulders', short: 'iH&S', bias: 1, group: 'Reversal' },
  asc: { label: 'Ascending triangle', short: 'Asc△', bias: 1, group: 'Triangle' },
  desc: { label: 'Descending triangle', short: 'Desc△', bias: -1, group: 'Triangle' },
  sym: { label: 'Symmetrical triangle', short: 'Sym△', bias: 0, group: 'Triangle' },
  rwedge: { label: 'Rising wedge', short: 'R-Wedge', bias: -1, group: 'Wedge' },
  fwedge: { label: 'Falling wedge', short: 'F-Wedge', bias: 1, group: 'Wedge' },
  bflag: { label: 'Bull flag', short: 'Bull flag', bias: 1, group: 'Flag' },
  beflag: { label: 'Bear flag', short: 'Bear flag', bias: -1, group: 'Flag' },
  chup: { label: 'Rising channel', short: 'Ch↑', bias: 1, group: 'Channel' },
  chdn: { label: 'Falling channel', short: 'Ch↓', bias: -1, group: 'Channel' },
};
export const PAT_TYPES = Object.keys(PAT_INFO) as PatType[];

export interface CpatOpts {
  types: Partial<Record<PatType, boolean>>;
  minSim: number;        // 50-100: show patterns at least this similar to the textbook shape
  sens: number;          // swing size in ATR(14) multiples (bigger = fewer, larger patterns)
  lookback: number;      // bars back to search
  ahead: number;         // bars after a pattern for the backtest stats
  lines: boolean; labels: boolean; stats: boolean;
}
export const CPAT_DEFAULT: CpatOpts = {
  types: Object.fromEntries(PAT_TYPES.map(t => [t, true])) as Record<PatType, boolean>,
  minSim: 75, sens: 1.5, lookback: 1500, ahead: 10, lines: true, labels: true, stats: true,
};
export function sanitizeCpat(o: any): CpatOpts {
  const d = { ...CPAT_DEFAULT, types: { ...CPAT_DEFAULT.types } };
  if (!o || typeof o !== 'object') return d;
  const num = (v: any, lo: number, hi: number, def: number) => (Number.isFinite(v) && v >= lo && v <= hi ? Number(v) : def);
  d.minSim = num(o.minSim, 50, 100, d.minSim); d.sens = num(o.sens, 0.3, 6, d.sens);
  d.lookback = num(o.lookback, 100, 10000, d.lookback); d.ahead = num(o.ahead, 1, 100, d.ahead);
  for (const k of ['lines', 'labels', 'stats'] as const) if (typeof o[k] === 'boolean') d[k] = o[k];
  if (o.types && typeof o.types === 'object') for (const t of PAT_TYPES) if (typeof o.types[t] === 'boolean') d.types[t] = o.types[t];
  return d;
}

export interface Pivot { i: number; p: number; kind: 'H' | 'L'; conf: number; }
export interface Found { type: PatType; score: number; pts: Pivot[]; conf: number; lines?: [number, number, number, number][]; }

function atr14(d: Bar[]): number[] {
  const out: number[] = []; let a = 0;
  for (let i = 0; i < d.length; i++) {
    const tr = i ? Math.max(d[i].high - d[i].low, Math.abs(d[i].high - d[i - 1].close), Math.abs(d[i].low - d[i - 1].close)) : d[i].high - d[i].low;
    a = i < 14 ? (a * i + tr) / (i + 1) : a + (tr - a) / 14;
    out.push(a);
  }
  return out;
}

/** Zigzag swing points, each confirmed when price moved back by sens x ATR from it (conf = confirming bar). */
export function pivots(d: Bar[], sens: number, from = 0): Pivot[] {
  const atr = atr14(d), out: Pivot[] = [];
  let dir = 0, hiI = from, loI = from, ext = from;
  for (let i = from + 1; i < d.length; i++) {
    const th = sens * atr[i];
    if (dir === 0) {                                   // until the first swing: track both sides
      if (d[i].high >= d[hiI].high) hiI = i;
      if (d[i].low <= d[loI].low) loI = i;
      if (hiI < i && d[hiI].high - d[i].low >= th) { out.push({ i: hiI, p: d[hiI].high, kind: 'H', conf: i }); dir = -1; ext = i; }
      else if (loI < i && d[i].high - d[loI].low >= th) { out.push({ i: loI, p: d[loI].low, kind: 'L', conf: i }); dir = 1; ext = i; }
    } else if (dir === 1) {                            // rising leg: follow the high until price drops th from it
      if (d[i].high >= d[ext].high) ext = i;
      else if (d[ext].high - d[i].low >= th) { out.push({ i: ext, p: d[ext].high, kind: 'H', conf: i }); dir = -1; ext = i; }
    } else {                                           // falling leg: follow the low until price rises th from it
      if (d[i].low <= d[ext].low) ext = i;
      else if (d[i].high - d[ext].low >= th) { out.push({ i: ext, p: d[ext].low, kind: 'L', conf: i }); dir = 1; ext = i; }
    }
  }
  return out;
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const TEMPLATES: Partial<Record<PatType, { first: 'H' | 'L'; v: number[] }>> = {
  dt: { first: 'L', v: [0, 1, 0.45, 1] },
  db: { first: 'H', v: [1, 0, 0.55, 0] },
  tt: { first: 'L', v: [0, 1, 0.45, 1, 0.45, 1] },
  tb: { first: 'H', v: [1, 0, 0.55, 0, 0.55, 0] },
  hs: { first: 'L', v: [0, 0.75, 0.35, 1, 0.35, 0.75] },
  ihs: { first: 'H', v: [1, 0.25, 0.65, 0, 0.65, 0.25] },
};

function templateScore(P: Pivot[], v: number[]) {
  const lo = Math.min(...P.map(x => x.p)), hi = Math.max(...P.map(x => x.p)), h = hi - lo || 1;
  const diff = P.reduce((s, x, k) => s + Math.abs((x.p - lo) / h - v[k]), 0) / P.length;
  return clamp(1 - diff / 0.35);
}

function fit(pts: Pivot[]) {
  const n = pts.length, mx = pts.reduce((s, p) => s + p.i, 0) / n, my = pts.reduce((s, p) => s + p.p, 0) / n;
  let sxy = 0, sxx = 0;
  for (const p of pts) { sxy += (p.i - mx) * (p.p - my); sxx += (p.i - mx) ** 2; }
  const slope = sxx ? sxy / sxx : 0, icept = my - slope * mx;
  const res = pts.reduce((s, p) => s + Math.abs(p.p - (icept + slope * p.i)), 0) / n;
  return { slope, at: (i: number) => icept + slope * i, res };
}

/** Triangles, wedges and channels on a window of 5-6 alternating swing points. */
function geometric(P: Pivot[]): { type: PatType; score: number; lines: [number, number, number, number][] }[] {
  const H = P.filter(p => p.kind === 'H'), L = P.filter(p => p.kind === 'L');
  if (H.length < 2 || L.length < 2) return [];
  const fh = fit(H), fl = fit(L);
  const i0 = P[0].i, i1 = P[P.length - 1].i, span = i1 - i0 || 1;
  const lo = Math.min(...P.map(x => x.p)), hi = Math.max(...P.map(x => x.p)), h = hi - lo || 1;
  const dH = fh.slope * span / h, dL = fl.slope * span / h;                  // change of each line over the pattern, in pattern heights
  const w0 = fh.at(i0) - fl.at(i0), w1 = fh.at(i1) - fl.at(i1);
  if (w0 <= 0 || w1 <= 0) return [];
  const fq = clamp(1 - (fh.res + fl.res) / 2 / h / 0.15);                  // how well the points sit on the two lines
  const flat = (d: number) => clamp(1 - Math.abs(d) / 0.3), up = (d: number) => clamp((d - 0.05) / 0.3), down = (d: number) => up(-d);
  const conv = clamp((w0 - w1) / w0 / 0.3), par = clamp(1 - Math.abs(dH - dL) / 0.35);
  const g = (...m: number[]) => Math.pow(m.reduce((a, b) => a * b, 1), 1 / m.length) * (0.5 + 0.5 * fq);
  const lines: [number, number, number, number][] = [[i0, fh.at(i0), i1, fh.at(i1)], [i0, fl.at(i0), i1, fl.at(i1)]];
  return ([
    ['asc', g(flat(dH), up(dL), conv)], ['desc', g(down(dH), flat(dL), conv)], ['sym', g(down(dH), up(dL), conv)],
    ['rwedge', g(up(dH), up(dL), conv, clamp((dL - dH) / 0.2))], ['fwedge', g(down(dH), down(dL), conv, clamp((dL - dH) / 0.2))],
    ['chup', g(up(dH), up(dL), par)], ['chdn', g(down(dH), down(dL), par)],
  ] as [PatType, number][]).map(([type, score]) => ({ type, score, lines }));
}

/** Bull / bear flag: a strong leg (pole) then a small counter-drift that retraces less than half of it. */
function flag(pole0: Pivot, P: Pivot[]): { type: PatType; score: number } | null {
  const poleTop = P[0], pole = poleTop.p - pole0.p, bull = pole > 0;
  const ext = P.map(x => x.p), fh = Math.max(...ext) - Math.min(...ext);
  const retr = bull ? (poleTop.p - Math.min(...ext)) / pole : (Math.max(...ext) - poleTop.p) / -pole;
  const drift = fit(P).slope * (P[P.length - 1].i - P[0].i) / (Math.abs(pole) || 1);   // small, against the pole
  const against = bull ? clamp(1 - Math.max(0, drift) / 0.15) : clamp(1 - Math.max(0, -drift) / 0.15);
  const score = Math.cbrt(clamp(1 - retr / 0.6) * against * clamp(Math.abs(pole) / (2.5 * (fh || 1))));
  return { type: bull ? 'bflag' : 'beflag', score };
}

export function findPatterns(d: Bar[], o: CpatOpts): Found[] {
  const from = Math.max(0, d.length - o.lookback);
  const P = pivots(d, o.sens, from);
  const out: Found[] = [];
  const min = o.minSim / 100;
  for (let j = 3; j < P.length; j++) {
    for (const [type, tpl] of Object.entries(TEMPLATES) as [PatType, { first: 'H' | 'L'; v: number[] }][]) {
      if (!o.types[type]) continue;
      const n = tpl.v.length, s = j - n + 1;
      if (s < 0 || P[s].kind !== tpl.first) continue;
      const pts = P.slice(s, j + 1), score = templateScore(pts, tpl.v);
      if (score >= min) out.push({ type, score, pts, conf: P[j].conf });
    }
    for (const n of [5, 6]) {
      const s = j - n + 1;
      if (s < 0) continue;
      const pts = P.slice(s, j + 1);
      for (const g of geometric(pts)) if (o.types[g.type] && g.score >= min) out.push({ type: g.type, score: g.score, pts, conf: P[j].conf, lines: g.lines });
    }
    if (j >= 4) {
      const pts = P.slice(j - 3, j + 1), f = flag(P[j - 4], pts);
      if (f && o.types[f.type] && f.score >= min) out.push({ ...f, pts: [P[j - 4], ...pts], conf: P[j].conf });
    }
  }
  // best first; drop patterns that overlap a better one in time
  out.sort((a, b) => b.score - a.score);
  const kept: Found[] = [];
  for (const f of out) {
    const a = f.pts[0].i, b = f.pts[f.pts.length - 1].i;
    if (kept.some(k => !(b <= k.pts[0].i || a >= k.pts[k.pts.length - 1].i))) continue;
    kept.push(f);
  }
  return kept.sort((a, b) => a.conf - b.conf);
}

/** Backtest on the loaded bars: after each pattern was confirmed, did price move its way over the next N bars? */
export function patternStats(d: Bar[], found: Found[], ahead: number) {
  const by: Partial<Record<PatType, { n: number; ok: number; pts: number }>> = {};
  for (const f of found) {
    const e = f.conf + ahead;
    if (e >= d.length) continue;
    const bias = PAT_INFO[f.type].bias || Math.sign(d[f.conf].close - f.pts[0].p) || 1;
    const mv = (d[e].close - d[f.conf].close) * bias;
    const s = (by[f.type] ??= { n: 0, ok: 0, pts: 0 }); s.n++; if (mv > 0) s.ok++; s.pts += mv;
  }
  return by;
}
