// Time & day pattern finder: for every entry time (ET) and weekday, what happens to a fixed trade
// (target $ / stop $ for 1 contract) entered then, plus what the market usually does then
// (move, direction, volume, when the day's high / low prints).
// Data: the chart's own NQ 1-minute bars, New York session (9:30-16:00 ET) only.
// No look-ahead: the direction rule only uses bars that closed before the entry minute; the entry
// is the open of the entry minute; a bar that touches both stop and target counts as a loss.
// Results are split by date: TRAIN = older 60% of days, TEST = newest 40% (never used to pick).
import pool from '../db';

const MIN = 60000;
const POINT_VALUE: Record<string, number> = { NQ: 20, MNQ: 2 };
const COMMISSION: Record<string, number> = { NQ: 3.5, MNQ: 1.0 };
const SLIP_PTS = 0.5;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// ---------------------------------------------------------------- data (cached, packed)
export interface Day { date: string; wd: number; start: number; n: number; } // wd 0=Mon .. 4=Fri; bars [start, start+n)
export interface Store { m: Int16Array; t: Float64Array; o: Float64Array; h: Float64Array; l: Float64Array; c: Float64Array; v: Float64Array; days: Day[]; loadedAt: number; }
let store: Store | null = null;
let loading: Promise<Store> | null = null;

export async function load(): Promise<Store> {
  if (store && Date.now() - store.loadedAt < 6 * 3600 * 1000) return store;
  if (loading) return loading;
  loading = (async () => {
    const yrs = await pool.query(`SELECT extract(year FROM min(ts))::int a, extract(year FROM max(ts))::int b FROM bars_1m WHERE sym = 1`);
    const a = yrs.rows[0].a, b = yrs.rows[0].b;
    const chunks: any[][] = [];
    let total = 0;
    for (let y = a; y <= b; y++) for (const half of [[1, 7], [7, 13]]) {
      const from = `${y}-${String(half[0]).padStart(2, '0')}-01`;
      const to = half[1] === 13 ? `${y + 1}-01-01` : `${y}-${String(half[1]).padStart(2, '0')}-01`;
      const r = await pool.query({
        text: `SELECT extract(epoch FROM ts) * 1000 AS t, o, h, l, c, v,
                      to_char(ts AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d,
                      extract(isodow FROM ts AT TIME ZONE 'America/New_York')::int AS wd,
                      (extract(hour FROM ts AT TIME ZONE 'America/New_York') * 60 + extract(minute FROM ts AT TIME ZONE 'America/New_York'))::int AS mod
                 FROM bars_1m
                WHERE sym = 1 AND ts >= $1::date - interval '1 day' AND ts < $2::date + interval '1 day'
                  AND (ts AT TIME ZONE 'America/New_York')::time >= '09:30' AND (ts AT TIME ZONE 'America/New_York')::time < '16:00'
                  AND (ts AT TIME ZONE 'America/New_York')::date >= $1::date AND (ts AT TIME ZONE 'America/New_York')::date < $2::date
                ORDER BY ts`,
        values: [from, to], rowMode: 'array',
      });
      chunks.push(r.rows); total += r.rows.length;
    }
    const s: Store = { m: new Int16Array(total), t: new Float64Array(total), o: new Float64Array(total), h: new Float64Array(total), l: new Float64Array(total), c: new Float64Array(total), v: new Float64Array(total), days: [], loadedAt: Date.now() };
    let i = 0, cur: Day | null = null;
    for (const rows of chunks) for (const r of rows) {
      s.m[i] = Number(r[8]); s.t[i] = Number(r[0]); s.o[i] = r[1] / 100; s.h[i] = r[2] / 100; s.l[i] = r[3] / 100; s.c[i] = r[4] / 100; s.v[i] = Number(r[5]);
      if (!cur || cur.date !== r[6]) { cur = { date: r[6], wd: Number(r[7]) - 1, start: i, n: 0 }; s.days.push(cur); }
      cur.n++; i++;
    }
    s.days = s.days.filter(d => d.wd >= 0 && d.wd <= 4 && d.n >= 300); // full sessions only (no half days)
    store = s;
    return s;
  })().finally(() => { loading = null; });
  return loading;
}

// ---------------------------------------------------------------- scan
export type DirRule = 'long' | 'short' | 'trend30' | 'fade30' | 'trendOpen' | 'fadeOpen' | 'vwap' | 'antiVwap';
export const DIR_RULES: Record<DirRule, string> = {
  long: 'Always long',
  short: 'Always short',
  trend30: 'With the last 30 minutes (up → long)',
  fade30: 'Against the last 30 minutes (up → short)',
  trendOpen: 'With the move since 9:30 (above the open → long)',
  fadeOpen: 'Against the move since 9:30',
  vwap: 'With VWAP (above → long)',
  antiVwap: 'Against VWAP (above → short)',
};

export interface ScanParams {
  contract: 'NQ' | 'MNQ'; targetUsd: number; stopUsd: number; slotMin: number; maxHoldMin: number;
  dir: DirRule; from?: string; to?: string;
}
export interface CellStats { n: number; wins: number; losses: number; timeouts: number; netUsd: number; avgUsd: number; winRate: number; pf: number | null; }
export interface Cell { slot: string; wd: number; train: CellStats; test: CellStats; all: CellStats; move30: number; up30: number; relVol: number; }
export interface ScanResult {
  params: ScanParams & { targetPts: number; stopPts: number; costUsd: number; breakEvenWinRate: number };
  days: number; trainDays: number; testDays: number; splitDate: string; from: string; to: string;
  slots: string[]; cells: Cell[];              // wd = -1: all weekdays together
  candidates: number;                          // cells that passed (train and test avg > 0, n >= 40 in each)
  expectedFalse: number;                       // how many cells would pass by luck alone (rough)
  dayStats: { wd: number; days: number; avgRange: number; upPct: number; highHour: number[]; lowHour: number[] }[];
}

function emptyStats(): CellStats { return { n: 0, wins: 0, losses: 0, timeouts: 0, netUsd: 0, avgUsd: 0, winRate: 0, pf: null }; }
function finish(s: CellStats & { gw?: number; gl?: number }) {
  s.avgUsd = s.n ? s.netUsd / s.n : 0;
  s.winRate = s.n ? s.wins / s.n : 0;
  const gw = s.gw || 0, gl = s.gl || 0;
  s.pf = gl > 0 ? gw / gl : null;
  delete s.gw; delete s.gl;
  s.netUsd = Math.round(s.netUsd); s.avgUsd = Math.round(s.avgUsd * 100) / 100; s.winRate = Math.round(s.winRate * 1000) / 1000;
  if (s.pf != null) s.pf = Math.round(s.pf * 100) / 100;
  return s;
}

const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

export async function scan(p: ScanParams): Promise<ScanResult> {
  const s = await load();
  const pv = POINT_VALUE[p.contract], qty = 1;
  const tgtPts = p.targetUsd / pv, stopPts = p.stopUsd / pv;
  const cost = COMMISSION[p.contract] + SLIP_PTS * pv;
  let days = s.days.filter(d => (!p.from || d.date >= p.from) && (!p.to || d.date < p.to));
  if (days.length < 50) throw Object.assign(new Error('Fewer than 50 full sessions in that period.'), { status: 400 });
  const split = Math.floor(days.length * 0.6);
  const splitDate = days[split].date;
  // entry slots: 9:30 + k * slotMin, last one leaves room for maxHold before 15:59
  const slotsMin: number[] = [];
  for (let m = 570; m + Math.min(p.maxHoldMin, 30) <= 959; m += p.slotMin) slotsMin.push(m);
  const nS = slotsMin.length;
  type Acc = CellStats & { gw: number; gl: number };
  const mk = (): Acc => ({ ...emptyStats(), gw: 0, gl: 0 });
  const acc: { train: Acc; test: Acc; mv: number; up: number; vol: number; vn: number; cnt: number }[][] =
    Array.from({ length: 6 }, () => Array.from({ length: nS }, () => ({ train: mk(), test: mk(), mv: 0, up: 0, vol: 0, vn: 0, cnt: 0 })));
  const dayStats = Array.from({ length: 6 }, (_, wd) => ({ wd: wd === 5 ? -1 : wd, days: 0, range: 0, up: 0, highHour: new Array(7).fill(0), lowHour: new Array(7).fill(0) }));

  days.forEach((d, di) => {
    const isTest = di >= split;
    const a = d.start, n = d.n;
    // minute of day (ET) for each bar index: bars are in order from 9:30; map minute -> index
    const idx = new Int32Array(390).fill(-1); // minute since 9:30 ET -> bar index
    for (let k = 0; k < n; k++) { const mm = s.m[a + k] - 570; if (mm >= 0 && mm < 390) idx[mm] = a + k; }
    const open = s.o[a];
    let pvSum = 0, vSum = 0, dayHi = -Infinity, dayLo = Infinity, hiAt = 0, loAt = 0, dayVol = 0;
    const vwapAt = new Float64Array(390);
    for (let m = 0; m < 390; m++) {
      const j = idx[m];
      if (j >= 0) {
        pvSum += ((s.h[j] + s.l[j] + s.c[j]) / 3) * s.v[j]; vSum += s.v[j]; dayVol += s.v[j];
        if (s.h[j] > dayHi) { dayHi = s.h[j]; hiAt = m; }
        if (s.l[j] < dayLo) { dayLo = s.l[j]; loAt = m; }
      }
      vwapAt[m] = vSum > 0 ? pvSum / vSum : NaN; // VWAP after minute m closes
    }
    const lastJ = a + n - 1;
    for (const wdKey of [d.wd, 5]) {
      const ds = dayStats[wdKey];
      ds.days++; ds.range += dayHi - dayLo; ds.up += s.c[lastJ] > open ? 1 : 0;
      ds.highHour[Math.min(6, Math.floor(hiAt / 60))]++; ds.lowHour[Math.min(6, Math.floor(loAt / 60))]++;
    }
    const avgMinVol = dayVol / Math.max(1, n);
    // last close before minute m; before the first candle closes, the 9:30 open
    const closeBefore = (m: number) => { for (let q = m - 1; q >= 0; q--) if (idx[q] >= 0) return s.c[idx[q]]; return open; };

    for (let si = 0; si < nS; si++) {
      const m = slotsMin[si] - 570;
      const j0 = idx[m];
      if (j0 < 0) continue;
      const entry = s.o[j0];
      const prev = closeBefore(m);                // last close before the entry minute
      const prev30 = m >= 30 ? closeBefore(m - 30) : open;
      let dir = 0;
      switch (p.dir) {
        case 'long': dir = 1; break;
        case 'short': dir = -1; break;
        case 'trend30': dir = m === 0 ? 0 : Math.sign(prev - prev30); break;
        case 'fade30': dir = m === 0 ? 0 : -Math.sign(prev - prev30); break;
        case 'trendOpen': dir = m === 0 ? 0 : Math.sign(prev - open); break;
        case 'fadeOpen': dir = m === 0 ? 0 : -Math.sign(prev - open); break;
        case 'vwap': dir = m === 0 ? 0 : Math.sign(prev - vwapAt[m - 1]); break;
        case 'antiVwap': dir = m === 0 ? 0 : -Math.sign(prev - vwapAt[m - 1]); break;
      }
      // descriptive: next 30 minutes from the entry
      const j30 = idx[Math.min(389, m + 30)];
      for (const wdKey of [d.wd, 5]) {
        const cell = acc[wdKey][si];
        if (j30 >= 0) { cell.mv += Math.abs(s.c[j30] - entry); cell.up += s.c[j30] > entry ? 1 : 0; cell.cnt++; }
        cell.vol += avgMinVol > 0 ? s.v[j0] / avgMinVol : 1; cell.vn++;
      }
      if (!dir || !Number.isFinite(dir)) continue;
      // walk forward: stop first if both in one bar
      const tgt = entry + dir * tgtPts, stp = entry - dir * stopPts;
      let outcome: 'w' | 'l' | 't' = 't', exitPx = entry;
      const endM = Math.min(389, m + p.maxHoldMin - 1);
      for (let q = m; q <= endM; q++) {
        const j = idx[q];
        if (j < 0) continue;
        const hitStop = dir > 0 ? s.l[j] <= stp : s.h[j] >= stp;
        const hitTgt = dir > 0 ? s.h[j] >= tgt : s.l[j] <= tgt;
        if (hitStop) { outcome = 'l'; exitPx = stp; break; }
        if (hitTgt) { outcome = 'w'; exitPx = tgt; break; }
        exitPx = s.c[j];
      }
      const net = (exitPx - entry) * dir * pv * qty - cost;
      for (const wdKey of [d.wd, 5]) {
        const st = isTest ? acc[wdKey][si].test : acc[wdKey][si].train;
        st.n++; st.netUsd += net;
        if (net > 0) st.gw += net; else st.gl -= net;
        if (outcome === 'w') st.wins++; else if (outcome === 'l') st.losses++; else st.timeouts++;
      }
    }
  });

  const cells: Cell[] = [];
  let candidates = 0, tested = 0;
  for (let wdKey = 0; wdKey < 6; wdKey++) for (let si = 0; si < nS; si++) {
    const c = acc[wdKey][si];
    const all: Acc = { ...emptyStats(), gw: c.train.gw + c.test.gw, gl: c.train.gl + c.test.gl };
    for (const k of ['n', 'wins', 'losses', 'timeouts', 'netUsd'] as const) (all as any)[k] = (c.train as any)[k] + (c.test as any)[k];
    const train = finish({ ...c.train }), test = finish({ ...c.test }), allS = finish(all);
    if (train.n >= 40 && test.n >= 40) {
      tested++;
      if (train.avgUsd > 0 && test.avgUsd > 0) candidates++;
    }
    cells.push({
      slot: hhmm(slotsMin[si]), wd: wdKey === 5 ? -1 : wdKey, train, test, all: allS,
      move30: c.cnt ? Math.round((c.mv / c.cnt) * 10) / 10 : 0, up30: c.cnt ? Math.round((c.up / c.cnt) * 1000) / 1000 : 0,
      relVol: c.vn ? Math.round((c.vol / c.vn) * 100) / 100 : 0, // entry-minute volume vs that day's average minute
    });
  }
  return {
    params: { ...p, targetPts: tgtPts, stopPts, costUsd: cost, breakEvenWinRate: Math.round(((p.stopUsd + cost) / (p.targetUsd + p.stopUsd)) * 1000) / 1000 },
    days: days.length, trainDays: split, testDays: days.length - split, splitDate, from: days[0].date, to: days[days.length - 1].date,
    slots: slotsMin.map(hhmm), cells, candidates,
    // with no real edge, roughly 1 in 4 cells shows a positive average in both halves by chance
    expectedFalse: Math.round(tested * 0.25),
    dayStats: dayStats.map(d => ({
      wd: d.wd, days: d.days, avgRange: d.days ? Math.round((d.range / d.days) * 10) / 10 : 0, upPct: d.days ? Math.round((d.up / d.days) * 1000) / 1000 : 0,
      highHour: d.highHour.map(x => (d.days ? Math.round((x / d.days) * 1000) / 1000 : 0)), lowHour: d.lowHour.map(x => (d.days ? Math.round((x / d.days) * 1000) / 1000 : 0)),
    })),
  };
}

/** The days behind one cell (for replaying them). */
export async function cellDays(p: ScanParams, slot: string, wd: number): Promise<{ date: string; side: string; outcome: string; netUsd: number; test: boolean }[]> {
  const s = await load();
  const pv = POINT_VALUE[p.contract];
  const tgtPts = p.targetUsd / pv, stopPts = p.stopUsd / pv, cost = COMMISSION[p.contract] + SLIP_PTS * pv;
  const [hh, mm] = slot.split(':').map(Number);
  const m = hh * 60 + mm - 570;
  const days = s.days.filter(d => (!p.from || d.date >= p.from) && (!p.to || d.date < p.to));
  const split = Math.floor(days.length * 0.6);
  const out: { date: string; side: string; outcome: string; netUsd: number; test: boolean }[] = [];
  days.forEach((d, di) => {
    if (wd >= 0 && d.wd !== wd) return;
    const idx = new Int32Array(390).fill(-1);
    for (let k = 0; k < d.n; k++) { const q = s.m[d.start + k] - 570; if (q >= 0 && q < 390) idx[q] = d.start + k; }
    const j0 = idx[m]; if (j0 < 0) return;
    const open = s.o[d.start];
    const cb = (x: number) => { for (let q = x - 1; q >= 0; q--) if (idx[q] >= 0) return s.c[idx[q]]; return open; };
    let pvS = 0, vS = 0; for (let q = 0; q < m; q++) { const j = idx[q]; if (j >= 0) { pvS += ((s.h[j] + s.l[j] + s.c[j]) / 3) * s.v[j]; vS += s.v[j]; } }
    const vw = vS ? pvS / vS : NaN, prev = cb(m), prev30 = m >= 30 ? cb(m - 30) : open;
    const rules: Record<DirRule, number> = {
      long: 1, short: -1, trend30: Math.sign(prev - prev30), fade30: -Math.sign(prev - prev30),
      trendOpen: Math.sign(prev - open), fadeOpen: -Math.sign(prev - open), vwap: Math.sign(prev - vw), antiVwap: -Math.sign(prev - vw),
    };
    const dir = m === 0 && !['long', 'short'].includes(p.dir) ? 0 : rules[p.dir];
    if (!dir || !Number.isFinite(dir)) return;
    const entry = s.o[j0], tgt = entry + dir * tgtPts, stp = entry - dir * stopPts;
    let outcome = 'time', exitPx = entry;
    for (let q = m; q <= Math.min(389, m + p.maxHoldMin - 1); q++) {
      const j = idx[q]; if (j < 0) continue;
      if (dir > 0 ? s.l[j] <= stp : s.h[j] >= stp) { outcome = 'stop'; exitPx = stp; break; }
      if (dir > 0 ? s.h[j] >= tgt : s.l[j] <= tgt) { outcome = 'target'; exitPx = tgt; break; }
      exitPx = s.c[j];
    }
    out.push({ date: d.date, side: dir > 0 ? 'long' : 'short', outcome, netUsd: Math.round(((exitPx - entry) * dir * pv - cost) * 100) / 100, test: di >= split });
  });
  return out.reverse();
}

export { WEEKDAYS };
