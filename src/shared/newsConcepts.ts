// Reads one news release (or any moment) on NQ 1-minute bars, the way three schools would describe it,
// and merges many releases into "what usually happens". Pure functions: used by the Market Memory page
// (one event's charts) and by the server (combine all listed events).
//
//   Price action (Al Brooks words): first bar type, breakout of the range before the release, follow-through
//     or failed breakout, trend vs trading range after the hour.
//   ICT: liquidity above / below the 30 minutes before the release (buy-side / sell-side), sweeps of it,
//     fair value gaps (3-candle gaps) and whether they were filled, displacement candles.
//   SMC: swing highs / lows, break of structure (BOS) and change of character (CHoCH), order block = the last
//     opposite candle before the displacement.
// These are descriptions of what the candles did, not signals. Nothing here is tested as an edge.

export type Bar = [number, number, number, number, number, number]; // minute start (ms), o, h, l, c, v

const MIN = 60000;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** tf-minute candles from 1-minute bars, buckets aligned to `anchor` (so a candle starts exactly at the release). */
export function bucket(b1: Bar[], tf: number, anchor: number): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null, key = NaN;
  for (const b of b1) {
    const k = Math.floor((b[0] - anchor) / (tf * MIN));
    if (k !== key || !cur) {
      if (cur) out.push(cur);
      key = k; cur = [anchor + k * tf * MIN, b[1], b[2], b[3], b[4], b[5]];
    } else {
      cur[2] = Math.max(cur[2], b[2]); cur[3] = Math.min(cur[3], b[3]); cur[4] = b[4]; cur[5] += b[5];
    }
  }
  if (cur) out.push(cur);
  return out;
}

export interface Zone { t: number; dir: 1 | -1; lo: number; hi: number; filledAt: number | null; touchedAt: number | null; }
export interface Swing { t: number; kind: 'H' | 'L'; price: number; }
export interface Structure { t: number; kind: 'BOS' | 'CHoCH'; dir: 1 | -1; level: number; from: number; }
export interface Read {
  tf: number; anchor: number;
  candles: Bar[];
  pre: { high: number; low: number; from: number } | null;     // range of the 30 minutes before
  firstBar: { dir: 1 | -1 | 0; kind: string; range: number; xNormal: number } | null;
  breakout: { dir: 1 | -1; t: number; follow: boolean; failedAt: number | null } | null;
  sweeps: { side: 'buy' | 'sell'; t: number; reversed: boolean }[];
  fvgs: Zone[];
  displacement: { t: number; dir: 1 | -1; xNormal: number } | null;
  swings: Swing[];
  structure: Structure[];
  orderBlock: Zone | null;
  after60: { move: number; range: number; kind: 'trend up' | 'trend down' | 'trading range' } | null;
  text: { pa: string[]; ict: string[]; smc: string[] };
}

const fmtT = (t: number, anchor: number, at = 'at the release') => { const m = Math.round((t - anchor) / MIN); return m === 0 ? at : m > 0 ? `+${m} min` : `${m} min`; };
const pts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)} pts`;

/**
 * Reads the candles of one event. b1 = 1-minute bars covering about 30 min before to 60 min after `anchor`.
 * Only the window is used, so the description is what a trader would see on that chart.
 */
export function readEvent(b1: Bar[], anchor: number, tf: number, what: 'news' | 'start' = 'news'): Read {
  const before = what === 'news' ? 'before the news' : 'before the start', atT = what === 'news' ? 'at the release' : 'at the start';
  const bars = b1.filter(b => b[0] >= anchor - 30 * MIN && b[0] < anchor + 60 * MIN).sort((a, b) => a[0] - b[0]);
  const c = bucket(bars, tf, anchor);
  const res: Read = { tf, anchor, candles: c, pre: null, firstBar: null, breakout: null, sweeps: [], fvgs: [], displacement: null, swings: [], structure: [], orderBlock: null, after60: null, text: { pa: [], ict: [], smc: [] } };
  const preBars = bars.filter(b => b[0] < anchor), post = c.filter(x => x[0] >= anchor);
  if (!post.length) { res.text.pa.push('No candles after the release in the data.'); return res; }
  const preC = c.filter(x => x[0] < anchor);
  // normal size of a candle before the release (falls back to 1m bars scaled by sqrt(tf))
  const avgR = preC.length >= 2 ? preC.reduce((s, x) => s + x[2] - x[3], 0) / preC.length
    : preBars.length ? (preBars.reduce((s, x) => s + x[2] - x[3], 0) / preBars.length) * Math.sqrt(tf) : 0;
  if (preBars.length) res.pre = { high: Math.max(...preBars.map(b => b[2])), low: Math.min(...preBars.map(b => b[3])), from: preBars[0][0] };

  // ---- first bar
  const f = post[0], fr = f[2] - f[3], fb = Math.abs(f[4] - f[1]);
  const fdir: 1 | -1 | 0 = f[4] > f[1] ? 1 : f[4] < f[1] ? -1 : 0;
  const upW = f[2] - Math.max(f[1], f[4]), dnW = Math.min(f[1], f[4]) - f[3];
  const fkind = fr <= 0 ? 'flat bar' : fb >= 0.5 * fr ? (fdir > 0 ? 'bull trend bar' : 'bear trend bar')
    : upW >= 0.5 * fr ? 'bar with a long upper tail (sellers pushed it down)' : dnW >= 0.5 * fr ? 'bar with a long lower tail (buyers pushed it up)' : 'doji / small body (both sides fought)';
  res.firstBar = { dir: fdir, kind: fkind, range: r2(fr), xNormal: avgR > 0 ? r1(fr / avgR) : 0 };

  // ---- breakout of the pre-release range, follow-through, failure
  if (res.pre) {
    const { high, low } = res.pre, mid = (high + low) / 2;
    for (let i = 0; i < post.length; i++) {
      const x = post[i];
      const dir: 1 | -1 | 0 = x[4] > high ? 1 : x[4] < low ? -1 : 0;
      if (!dir) continue;
      const nxt = post[i + 1];
      const follow = !!nxt && (dir > 0 ? nxt[4] > x[4] : nxt[4] < x[4]);
      let failedAt: number | null = null;
      for (let j = i + 1; j < post.length && post[j][0] < x[0] + 30 * MIN; j++) if (dir > 0 ? post[j][4] < mid : post[j][4] > mid) { failedAt = post[j][0]; break; }
      res.breakout = { dir, t: x[0], follow, failedAt };
      break;
    }
    // ---- ICT liquidity sweeps: price trades beyond the pre-release high / low, then closes back inside within 2 candles
    for (const side of ['buy', 'sell'] as const) {
      for (let i = 0; i < post.length; i++) {
        const x = post[i];
        const took = side === 'buy' ? x[2] > high : x[3] < low;
        if (!took) continue;
        const back = post.slice(i, i + 3).some(y => (side === 'buy' ? y[4] < high : y[4] > low));
        res.sweeps.push({ side, t: x[0], reversed: back });
        break;
      }
    }
  }

  // ---- displacement: first candle after the release at least 2x a normal candle
  for (const x of post) {
    const rg = x[2] - x[3];
    if (avgR > 0 && rg >= 2 * avgR && Math.abs(x[4] - x[1]) >= 0.5 * rg) { res.displacement = { t: x[0], dir: x[4] > x[1] ? 1 : -1, xNormal: r1(rg / avgR) }; break; }
  }

  // ---- fair value gaps (middle candle at or after the release)
  for (let i = 1; i < c.length - 1; i++) {
    if (c[i][0] < anchor) continue;
    const a = c[i - 1], z = c[i + 1];
    let zone: Zone | null = null;
    if (a[2] < z[3]) zone = { t: c[i][0], dir: 1, lo: a[2], hi: z[3], filledAt: null, touchedAt: null };
    else if (a[3] > z[2]) zone = { t: c[i][0], dir: -1, lo: z[2], hi: a[3], filledAt: null, touchedAt: null };
    if (!zone || zone.hi - zone.lo < 0.5) continue;
    for (let j = i + 2; j < c.length; j++) {
      const y = c[j];
      if (zone.touchedAt === null && (zone.dir > 0 ? y[3] <= zone.hi : y[2] >= zone.lo)) zone.touchedAt = y[0];
      if (zone.dir > 0 ? y[3] <= zone.lo : y[2] >= zone.hi) { zone.filledAt = y[0]; break; }
    }
    res.fvgs.push(zone);
  }

  // ---- swings (2 candles each side) and structure breaks on closes
  const k = 2;
  for (let i = k; i < c.length - k; i++) {
    const win = c.slice(i - k, i + k + 1);
    if (c[i][2] >= Math.max(...win.map(x => x[2])) && win.filter(x => x[2] === c[i][2]).length === 1) res.swings.push({ t: c[i][0], kind: 'H', price: c[i][2] });
    if (c[i][3] <= Math.min(...win.map(x => x[3])) && win.filter(x => x[3] === c[i][3]).length === 1) res.swings.push({ t: c[i][0], kind: 'L', price: c[i][3] });
  }
  let trend: 1 | -1 | 0 = 0, lastH: Swing | null = null, lastL: Swing | null = null, seenH = -Infinity, seenL = -Infinity;
  for (let i = 0; i < c.length; i++) {
    const x = c[i];
    // a swing is only known k candles after it formed (no look-ahead); each swing is used once
    for (const s of res.swings) {
      if (s.t > x[0] - k * tf * MIN) continue;
      if (s.kind === 'H' && s.t > seenH) { lastH = s; seenH = s.t; }
      if (s.kind === 'L' && s.t > seenL) { lastL = s; seenL = s.t; }
    }
    if (lastH && x[4] > lastH.price) {
      res.structure.push({ t: x[0], kind: trend === -1 ? 'CHoCH' : 'BOS', dir: 1, level: lastH.price, from: lastH.t });
      trend = 1; lastH = null;
    } else if (lastL && x[4] < lastL.price) {
      res.structure.push({ t: x[0], kind: trend === 1 ? 'CHoCH' : 'BOS', dir: -1, level: lastL.price, from: lastL.t });
      trend = -1; lastL = null;
    }
  }
  // ---- order block: last opposite candle before the displacement
  if (res.displacement) {
    const di = c.findIndex(x => x[0] === res.displacement!.t);
    for (let j = di - 1; j >= 0; j--) {
      const y = c[j], opp = res.displacement.dir > 0 ? y[4] < y[1] : y[4] > y[1];
      if (!opp) continue;
      const ob: Zone = { t: y[0], dir: res.displacement.dir, lo: y[3], hi: y[2], filledAt: null, touchedAt: null };
      for (let q = di + 1; q < c.length; q++) if (ob.dir > 0 ? c[q][3] <= ob.hi : c[q][2] >= ob.lo) { ob.touchedAt = c[q][0]; break; }
      res.orderBlock = ob;
      break;
    }
  }
  // ---- after the hour
  const last = post[post.length - 1], hi = Math.max(...post.map(x => x[2])), lo = Math.min(...post.map(x => x[3]));
  const move = last[4] - post[0][1], rng = hi - lo;
  res.after60 = { move: r2(move), range: r2(rng), kind: rng > 0 && Math.abs(move) >= 0.5 * rng ? (move > 0 ? 'trend up' : 'trend down') : 'trading range' };

  // ---- words
  const T = (t: number) => fmtT(t, anchor, atT);
  const P = res.text.pa, I = res.text.ict, S = res.text.smc;
  P.push(`First ${tf}m bar: ${fkind}, ${r1(fr)} pts${res.firstBar.xNormal ? ` (${res.firstBar.xNormal}× a normal ${tf}m bar ${before})` : ''}.`);
  if (res.breakout) {
    P.push(`Broke ${res.breakout.dir > 0 ? 'above' : 'below'} the 30-minute range ${before} ${T(res.breakout.t)}${res.breakout.follow ? ', and the next bar followed through' : ', but the next bar did not follow through'}.`);
    if (res.breakout.failedAt) P.push(`Failed breakout: back past the middle of that range ${T(res.breakout.failedAt)} (trapped breakout traders).`);
  } else if (res.pre) P.push(`Never closed outside the 30-minute range ${before}: a trading range, no breakout.`);
  P.push(`After the hour: ${res.after60.kind} (${pts(move)}, ${r1(rng)} pts high to low).`);
  if (res.pre) {
    I.push(`Liquidity: buy-side above ${res.pre.high.toFixed(2)}, sell-side below ${res.pre.low.toFixed(2)} (30 min before).`);
    for (const s of res.sweeps) I.push(`${s.side === 'buy' ? 'Buy-side' : 'Sell-side'} liquidity taken ${T(s.t)}${s.reversed ? ', then closed back inside: a sweep (stop run) and reversal' : ' and price kept going (no reversal)'}.`);
    if (!res.sweeps.length) I.push('Neither side of the pre-news range was taken.');
  }
  if (res.displacement) I.push(`Displacement ${T(res.displacement.t)}: ${res.displacement.dir > 0 ? 'up' : 'down'} candle ${res.displacement.xNormal}× normal.`);
  const fv = res.fvgs.slice(0, 3);
  for (const z of fv) I.push(`${z.dir > 0 ? 'Bullish' : 'Bearish'} fair value gap ${T(z.t)} (${z.lo.toFixed(2)}–${z.hi.toFixed(2)}): ${z.filledAt ? `filled ${T(z.filledAt)}` : z.touchedAt ? `touched ${T(z.touchedAt)}, not filled` : 'not revisited in the hour'}.`);
  if (!res.fvgs.length) I.push(`No fair value gap formed after the ${what === 'news' ? 'release' : 'start'}.`);
  const st = res.structure.filter(s => s.t >= anchor);
  for (const s of st.slice(0, 4)) S.push(`${s.kind} ${s.dir > 0 ? 'up' : 'down'} ${T(s.t)}: closed ${s.dir > 0 ? 'above the swing high' : 'below the swing low'} at ${s.level.toFixed(2)}.`);
  if (!st.length) S.push(`No break of structure after the ${what === 'news' ? 'release' : 'start'}.`);
  if (res.orderBlock) S.push(`Order block (last ${res.orderBlock.dir > 0 ? 'down' : 'up'} candle before the move) ${T(res.orderBlock.t)}, ${res.orderBlock.lo.toFixed(2)}–${res.orderBlock.hi.toFixed(2)}: ${res.orderBlock.touchedAt ? `price came back to it ${T(res.orderBlock.touchedAt)}` : 'price did not come back in the hour'}.`);
  return res;
}

// ------------------------------------------------------------------ merge many events
export interface EventBars { anchor: number; date: string; label: string; bars: Bar[]; }

const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const share = (a: boolean[]) => (a.length ? a.filter(Boolean).length / a.length : NaN);

/** Repeated behaviour across releases: by minute after the release, first candles, sequences, concepts, older vs newer half. */
export function combineEvents(evs: EventBars[]) {
  const ok = evs.filter(e => e.bars.some(b => b[0] >= e.anchor) && e.bars.some(b => b[0] < e.anchor)).sort((a, b) => a.anchor - b.anchor);
  const n = ok.length, half = Math.floor(n / 2);
  const OFF = Array.from({ length: 65 }, (_, i) => i - 5); // -5 .. +59 minutes
  const perMin = OFF.map(() => ({ abs: [] as number[], rng: [] as number[], up: [] as boolean[], vx: [] as number[] }));
  const calm: number[] = [];
  const hiAt: number[] = [], loAt: number[] = [], volMaxAt: number[] = [];
  const firstCont: Record<string, { at15: boolean[]; at30: boolean[]; at60: boolean[] }> = {};
  const seqs = new Map<string, { n: number; follow30: number[] }>();
  const concept = { buySweepRev: [] as boolean[], sellSweepRev: [] as boolean[], anySweepRev: [] as boolean[], breakoutFailed: [] as boolean[], fvgFirst15: [] as boolean[], fvgFilled: [] as boolean[], choch60: [] as boolean[], displacement5: [] as boolean[], trendHour: [] as boolean[] };
  const halves = { older: { cont60: [] as boolean[], sweepRev: [] as boolean[] }, newer: { cont60: [] as boolean[], sweepRev: [] as boolean[] } };
  const byTime = new Map<string, { n: number; first5: number[]; range60: number[] }>();
  const byTitle = new Map<string, { n: number; first5: number[]; range60: number[] }>();
  ok.forEach((e, idx) => {
    const m = new Map<number, Bar>(); for (const b of e.bars) m.set(Math.round((b[0] - e.anchor) / MIN), b);
    const pre = [...m.entries()].filter(([o]) => o >= -30 && o <= -6).map(([, b]) => b);
    const preVol = avg(pre.map(b => b[5])) || NaN, preRng = avg(pre.map(b => b[2] - b[3]));
    if (isFinite(preRng)) calm.push(preRng);
    OFF.forEach((o, i) => {
      const b = m.get(o); if (!b) return;
      perMin[i].abs.push(Math.abs(b[4] - b[1])); perMin[i].rng.push(b[2] - b[3]); perMin[i].up.push(b[4] > b[1]);
      if (preVol > 0) perMin[i].vx.push(b[5] / preVol);
    });
    const post = [...m.entries()].filter(([o]) => o >= 0 && o < 60).sort((a, b) => a[0] - b[0]);
    if (!post.length) return;
    let hiO = post[0][0], loO = post[0][0], hi = -Infinity, lo = Infinity, vmax = -1, vO = 0;
    for (const [o, b] of post) { if (b[2] > hi) { hi = b[2]; hiO = o; } if (b[3] < lo) { lo = b[3]; loO = o; } if (b[5] > vmax) { vmax = b[5]; vO = o; } }
    hiAt.push(hiO); loAt.push(loO); volMaxAt.push(vO);
    const open0 = post[0][1][1];
    const closeAt = (o: number) => { let best: Bar | null = null; for (const [k, b] of post) if (k <= o) best = b; return best ? best[4] : NaN; };
    for (const tf of [1, 3, 5]) {
      const end = closeAt(tf - 1), d = Math.sign(end - open0);
      const fc = (firstCont[`${tf}m`] ??= { at15: [], at30: [], at60: [] });
      if (!d) continue;
      // measured from the CLOSE of the first candle: did price keep going its way AFTER it? (measuring from the
      // release open would count the first candle's own move and look like continuation even at random times)
      const kept = (o: number) => { const c = closeAt(o); return isFinite(c) && c !== end ? Math.sign(c - end) === d : null; };
      for (const [k, o] of [['at15', 14], ['at30', 29], ['at60', 59]] as const) { const v = kept(o); if (v !== null) fc[k].push(v); }
      if (tf === 5) { const v = kept(59); if (v !== null) (idx < half ? halves.older : halves.newer).cont60.push(v); }
    }
    // first three 1-minute candles: direction sequence and the next 30 minutes in the direction of the first one
    const f3 = [0, 1, 2].map(o => m.get(o)).filter(Boolean) as Bar[];
    if (f3.length === 3) {
      const key = f3.map(b => (b[4] > b[1] ? 'up' : b[4] < b[1] ? 'down' : 'flat')).join(' → ');
      const s = seqs.get(key) ?? { n: 0, follow30: [] }; s.n++;
      const d1 = Math.sign(f3[0][4] - f3[0][1]) || 1;
      const c30 = closeAt(32); if (isFinite(c30)) s.follow30.push(d1 * (c30 - f3[2][4]));
      seqs.set(key, s);
    }
    // concepts on 5m candles
    const rd = readEvent(e.bars, e.anchor, 5);
    const bs = rd.sweeps.find(s => s.side === 'buy'), ss = rd.sweeps.find(s => s.side === 'sell');
    concept.buySweepRev.push(!!bs?.reversed); concept.sellSweepRev.push(!!ss?.reversed);
    const anyRev = !!(bs?.reversed || ss?.reversed); concept.anySweepRev.push(anyRev);
    (idx < half ? halves.older : halves.newer).sweepRev.push(anyRev);
    if (rd.breakout) concept.breakoutFailed.push(!!rd.breakout.failedAt);
    const fv = rd.fvgs.filter(z => z.t < e.anchor + 15 * MIN);
    concept.fvgFirst15.push(fv.length > 0);
    for (const z of fv) concept.fvgFilled.push(!!z.filledAt);
    concept.choch60.push(rd.structure.some(s => s.t >= e.anchor && s.kind === 'CHoCH'));
    concept.displacement5.push(!!rd.displacement && rd.displacement.t < e.anchor + 5 * MIN);
    concept.trendHour.push(rd.after60?.kind !== 'trading range');
    // groups
    const et = new Date(e.anchor).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: false });
    const f5 = closeAt(4) - open0, r60 = hi - lo;
    for (const [mp, key] of [[byTime, et], [byTitle, e.label]] as const) {
      const g = mp.get(key) ?? { n: 0, first5: [], range60: [] }; g.n++; g.first5.push(Math.abs(f5)); g.range60.push(r60); mp.set(key, g);
    }
  });
  const calmR = avg(calm);
  const minutes = OFF.map((o, i) => ({ off: o, absMove: r2(avg(perMin[i].abs)), range: r2(avg(perMin[i].rng)), xNormal: calmR > 0 ? r1(avg(perMin[i].rng) / calmR) : null, up: r3(share(perMin[i].up)), volX: r1(avg(perMin[i].vx)) }));
  // careful windows: consecutive minutes at 2x+ the normal range (or 3x+ volume)
  const careful: { from: number; to: number; xNormal: number; volX: number }[] = [];
  let cur: { from: number; to: number; xs: number[]; vs: number[] } | null = null;
  for (const mm of minutes) {
    const hot = mm.off >= -5 && ((mm.xNormal ?? 0) >= 2 || (mm.volX ?? 0) >= 3);
    if (hot) { if (!cur) cur = { from: mm.off, to: mm.off, xs: [], vs: [] }; cur.to = mm.off; cur.xs.push(mm.xNormal ?? 0); cur.vs.push(mm.volX ?? 0); }
    else if (cur) { careful.push({ from: cur.from, to: cur.to, xNormal: r1(avg(cur.xs)), volX: r1(avg(cur.vs)) }); cur = null; }
  }
  if (cur) careful.push({ from: cur.from, to: cur.to, xNormal: r1(avg(cur.xs)), volX: r1(avg(cur.vs)) });
  // most violent minutes: candles 3x+ their normal size
  const violent = minutes.filter(mm => mm.off >= -5 && (mm.xNormal ?? 0) >= 3).map(mm => mm.off);
  const hist = (a: number[]) => [[0, 4, '0–4 min'], [5, 14, '5–14 min'], [15, 29, '15–29 min'], [30, 59, '30–59 min']].map(([a0, a1, l]) => ({ label: l as string, share: r3(share(a.map(x => x >= (a0 as number) && x <= (a1 as number)))) }));
  const seqList = [...seqs.entries()].map(([k, v]) => ({ seq: k, n: v.n, share: r3(v.n / Math.max(1, ok.length)), follow30: r1(avg(v.follow30)), kept: r3(share(v.follow30.map(x => x > 0))) })).sort((a, b) => b.n - a.n).slice(0, 8);
  const grp = (mp: Map<string, { n: number; first5: number[]; range60: number[] }>) => [...mp.entries()].map(([k, v]) => ({ key: k, n: v.n, first5: r1(avg(v.first5)), range60: r1(avg(v.range60)) })).sort((a, b) => b.n - a.n).slice(0, 12);
  const cont = Object.fromEntries(Object.entries(firstCont).map(([k, v]) => [k, { n: v.at60.length, at15: r3(share(v.at15)), at30: r3(share(v.at30)), at60: r3(share(v.at60)) }]));
  const cc = Object.fromEntries(Object.entries(concept).map(([k, v]) => [k, { n: v.length, share: r3(share(v)) }]));
  const hv = { older: { cont60: r3(share(halves.older.cont60)), sweepRev: r3(share(halves.older.sweepRev)), n: half }, newer: { cont60: r3(share(halves.newer.cont60)), sweepRev: r3(share(halves.newer.sweepRev)), n: n - half } };
  // plain-English summary
  const say: string[] = [];
  if (careful.length) say.push(`Be careful ${careful.map(w => `${w.from >= 0 ? '+' : ''}${w.from}${w.to !== w.from ? ` to ${w.to >= 0 ? '+' : ''}${w.to}` : ''} min (${w.xNormal}× normal candle size, ${w.volX}× volume)`).join(', ')} after the release.`);
  if (violent.length) say.push(`Most violent: ${violent.length === 1 ? `minute ${violent[0] >= 0 ? '+' : ''}${violent[0]}` : `minutes ${violent[0] >= 0 ? '+' : ''}${violent[0]} to +${violent[violent.length - 1]}`} (candles 3×+ their normal size). Wider stops or wait.`);
  const c5 = cont['5m'];
  if (c5?.n) {
    const p = c5.at60;
    say.push(p >= 0.6 ? `After the first 5 minutes closed, price kept going the same way by +60 min ${Math.round(p * 100)}% of the time: moves tend to continue.`
      : p <= 0.4 ? `After the first 5 minutes closed, price went the other way by +60 min ${Math.round((1 - p) * 100)}% of the time: first moves tend to fade.`
      : `After the first 5 minutes closed, price kept going the same way by +60 min only ${Math.round(p * 100)}% of the time: a coin flip, no edge in following the first move.`);
  }
  const hiEarly = hist(hiAt)[0].share, loEarly = hist(loAt)[0].share;
  say.push(`The hour's high printed in the first 5 minutes ${Math.round(hiEarly * 100)}% of the time, the low ${Math.round(loEarly * 100)}%.`);
  if (cc.anySweepRev?.n) say.push(`One side of the 30-minute range before the news was swept and then reversed in ${Math.round(cc.anySweepRev.share * 100)}% of releases (ICT stop run).`);
  if (hv.older.n >= 10 && hv.newer.n >= 10) say.push(`Repeat check: kept going after the first 5 minutes (to +60) in ${Math.round(hv.older.cont60 * 100)}% of older vs ${Math.round(hv.newer.cont60 * 100)}% of newer releases${Math.abs(hv.older.cont60 - hv.newer.cont60) <= 0.1 ? ' (similar: a stable habit)' : ' (different: not stable)'}.`);
  return {
    n, from: ok[0]?.date ?? null, to: ok[n - 1]?.date ?? null, normalRange1m: r2(calmR), minutes, careful, violent,
    highAt: hist(hiAt), lowAt: hist(loAt), volumePeakAt: hist(volMaxAt), firstCandle: cont, sequences: seqList, concepts: cc, halves: hv,
    byTime: grp(byTime), byTitle: grp(byTitle), say,
  };
}
