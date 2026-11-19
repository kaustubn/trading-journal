// AI Trade Book: when the AI's backtests find a strategy worth trading on a prop account, record EVERY trade it
// would have taken, with how it entered, how the trade was managed and why it exited, plus what each timeframe
// and the key levels looked like at the moment of entry ("confluence"). Trades are saved into a separate journal
// account ("AI Playbook", one attempt per strategy), so "Open on chart" takes you straight to each trade.
//
// Engine: the same 1-minute walk as Edge Hunter (entry = open of the first minute after the signal candle;
// a bar that touches the stop counts as stopped before anything else in that bar; target hit when the best
// excursion reaches target x stop; otherwise out after `holdMin` minutes or at 15:55 ET; costs NQ $3.50 + 0.5 pt).
// Every replayed trade is compared with the backtest's own R; the match rate is stored with the strategy.
import pool from '../db';
import type { Store } from './timeScan';
import { load } from './timeScan';
import { CPI_DATES, NFP_DATES, FOMC_DATES } from './newsCalendar';

export const COST_PTS = 3.5 / 20 + 0.5;
const PV = { NQ: 20, MNQ: 2 };
const FLAT = 385;            // 15:55 ET, minute index from 9:30
const NEWS = new Map<string, string>();
for (const d of CPI_DATES) NEWS.set(d, 'CPI 8:30');
for (const d of NFP_DATES) NEWS.set(d, (NEWS.get(d) ? NEWS.get(d) + ' + ' : '') + 'Jobs report 8:30');

export interface TradeSpec { date: string; entryMin: number; dir: 1 | -1; stopPts?: number; stopAtr?: number; targetR: number; holdMin: number; refR?: number; }

// ------------------------------------------------------------------ per-day context (built once per data load)
interface Ctx {
  key: number;
  dayIdx: Map<string, number>;
  idx: Int32Array[];                 // per day: minute -> store index (-1 = no bar)
  atrAt: Float64Array[];             // per day: Wilder ATR(14) of 5m candles known at minute m (after candle end)
  dayAtr: Float64Array;              // per day: average 5m ATR of the day (for the volatility regime)
  ema: Record<'m5' | 'm15' | 'm60', { val: Float64Array[]; prev: Float64Array[] }>; // EMA20 at each minute (last closed candle) and 3 candles before
  emaD: Float64Array; emaDPrev: Float64Array; // daily EMA20 of closes up to the previous day, and 3 days earlier
  hi: Float64Array; lo: Float64Array; open: Float64Array; close: Float64Array;
}
let ctxCache: Ctx | null = null;

const ema = (prev: number, x: number, n: number) => (Number.isNaN(prev) ? x : prev + (2 / (n + 1)) * (x - prev));

export function buildCtx(s: Store): Ctx {
  if (ctxCache && ctxCache.key === s.loadedAt) return ctxCache;
  const D = s.days.length;
  const c: Ctx = {
    key: s.loadedAt, dayIdx: new Map(s.days.map((d, i) => [d.date, i])), idx: [], atrAt: [], dayAtr: new Float64Array(D),
    ema: { m5: { val: [], prev: [] }, m15: { val: [], prev: [] }, m60: { val: [], prev: [] } },
    emaD: new Float64Array(D).fill(NaN), emaDPrev: new Float64Array(D).fill(NaN),
    hi: new Float64Array(D), lo: new Float64Array(D), open: new Float64Array(D), close: new Float64Array(D),
  };
  let atr = NaN, prevC5 = NaN;
  const tfState = { m5: { e: NaN, hist: [] as number[] }, m15: { e: NaN, hist: [] as number[] }, m60: { e: NaN, hist: [] as number[] } };
  const tfMin = { m5: 5, m15: 15, m60: 60 } as const;
  let eD = NaN; const eDHist: number[] = [];
  s.days.forEach((d, di) => {
    const idx = new Int32Array(390).fill(-1);
    for (let k = 0; k < d.n; k++) { const q = s.m[d.start + k] - 570; if (q >= 0 && q < 390) idx[q] = d.start + k; }
    c.idx.push(idx);
    let hi = -Infinity, lo = Infinity, first = -1, last = -1;
    for (let q = 0; q < 390; q++) { const j = idx[q]; if (j < 0) continue; if (first < 0) first = j; last = j; hi = Math.max(hi, s.h[j]); lo = Math.min(lo, s.l[j]); }
    c.hi[di] = hi; c.lo[di] = lo; c.open[di] = first >= 0 ? s.o[first] : NaN; c.close[di] = last >= 0 ? s.c[last] : NaN;
    // daily EMA known before today's open
    c.emaD[di] = eD; c.emaDPrev[di] = eDHist.length >= 3 ? eDHist[eDHist.length - 3] : NaN;
    // ATR(14) on 5m candles, exactly as Edge Hunter (carried across days, missing minutes skipped)
    const atrAt = new Float64Array(391).fill(NaN);
    let atrSum = 0, atrN = 0;
    for (let k = 0; k < 78; k++) {
      let o = NaN, h = -Infinity, l = Infinity, cl = NaN;
      for (let q = k * 5; q < k * 5 + 5; q++) { const j = idx[q]; if (j < 0) continue; if (Number.isNaN(o)) o = s.o[j]; h = Math.max(h, s.h[j]); l = Math.min(l, s.l[j]); cl = s.c[j]; }
      if (!Number.isNaN(o)) {
        const tr = Number.isNaN(prevC5) ? h - l : Math.max(h - l, Math.abs(h - prevC5), Math.abs(l - prevC5));
        atr = Number.isNaN(atr) ? tr : atr + (tr - atr) / 14;
        atrSum += atr; atrN++;
        prevC5 = cl;
      }
      atrAt[k * 5 + 5] = atr;
    }
    for (let m = 1; m <= 390; m++) if (Number.isNaN(atrAt[m])) atrAt[m] = atrAt[m - 1];
    c.atrAt.push(atrAt);
    c.dayAtr[di] = atrN ? atrSum / atrN : NaN;
    // EMA20 on 5m / 15m / 60m closes, continuous across days; value known at minute m = after the last closed candle
    for (const key of ['m5', 'm15', 'm60'] as const) {
      const tf = tfMin[key], st = tfState[key];
      const val = new Float64Array(391).fill(NaN), prev = new Float64Array(391).fill(NaN);
      const startVal = st.e, startPrev = st.hist.length >= 3 ? st.hist[st.hist.length - 3] : NaN;
      val[0] = startVal; prev[0] = startPrev;
      for (let k = 0; k * tf < 390; k++) {
        let cl = NaN;
        for (let q = k * tf; q < Math.min(390, (k + 1) * tf); q++) { const j = idx[q]; if (j >= 0) cl = s.c[j]; }
        if (!Number.isNaN(cl)) { st.hist.push(st.e); st.e = ema(st.e, cl, 20); }
        const end = Math.min(390, (k + 1) * tf);
        val[end] = st.e; prev[end] = st.hist.length >= 3 ? st.hist[st.hist.length - 3] : NaN;
      }
      for (let m = 1; m <= 390; m++) { if (Number.isNaN(val[m])) val[m] = val[m - 1]; if (Number.isNaN(prev[m])) prev[m] = prev[m - 1]; }
      c.ema[key].val.push(val); c.ema[key].prev.push(prev);
    }
    if (!Number.isNaN(c.close[di])) { eDHist.push(eD); eD = ema(eD, c.close[di], 20); }
  });
  ctxCache = c;
  return c;
}

// ------------------------------------------------------------------ replay one trade in full detail
const r2 = (x: number) => Math.round(x * 100) / 100, r3 = (x: number) => Math.round(x * 1000) / 1000;
const hhmm = (m: number) => { const t = 570 + m; return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const trendOf = (px: number, e: number, ep: number): 'up' | 'down' | 'flat' =>
  !isFinite(e) || !isFinite(ep) ? 'flat' : px > e && e > ep ? 'up' : px < e && e < ep ? 'down' : 'flat';

export interface TradeDetail {
  date: string; weekday: string; dir: 'long' | 'short';
  entry: { time: string; minute: number; price: number };
  stop: { price: number; pts: number }; target: { price: number; r: number; pts: number };
  exit: { time: string; price: number; reason: 'target' | 'stop' | 'time' | 'flat' };
  minutesHeld: number; grossR: number; netR: number; netUsdNQ: number; netUsdMNQ: number;
  mfeR: number; maeR: number; refR: number | null; matches: boolean | null;
  management: { time: string; event: string }[];
  confluence: {
    score: number; of: number;
    timeframes: { tf: string; trend: 'up' | 'down' | 'flat'; agrees: boolean }[];
    vwap: { side: 'above' | 'below'; distPts: number; agrees: boolean };
    levels: { name: string; price: number; distPts: number; near: boolean }[];
    context: { time: string; gapPts: number | null; news: string | null; volatility: 'quiet' | 'normal' | 'wild' | 'unknown'; atr5m: number; dayRangeSoFar: number };
  };
}

const WDN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function replayTrade(s: Store, c: Ctx, t: TradeSpec): TradeDetail | null {
  const di = c.dayIdx.get(t.date);
  if (di === undefined) return null;
  const idx = c.idx[di], m0 = t.entryMin;
  if (m0 < 1 || m0 > FLAT - 1 || idx[m0] < 0) return null;
  const atr = c.atrAt[di][m0];
  const stopPts = t.stopPts ?? Math.max(2, (t.stopAtr ?? 1) * atr);
  if (!(stopPts > 0)) return null;
  const dir = t.dir, entry = s.o[idx[m0]];
  const stopPx = entry - dir * stopPts, tgtPts = t.targetR * stopPts, tgtPx = entry + dir * tgtPts;
  const end = Math.min(FLAT, m0 + t.holdMin - 1);
  const mg: { time: string; event: string }[] = [{ time: hhmm(m0), event: `Entered ${dir > 0 ? 'long' : 'short'} at ${r2(entry)} (open of the ${hhmm(m0)} bar). Stop ${r2(stopPx)} (${r2(stopPts)} pt), target ${r2(tgtPx)} (${t.targetR}R). Bracket stays fixed: no stop moves.` }];
  let mfe = 0, mae = 0, stopped = false, last = entry, exitM = end, hitHalf = false, hitOne = false, tgtM = -1, mfeM = m0, maeM = m0;
  for (let q = m0; q <= end; q++) {
    const j = idx[q]; if (j < 0) continue;
    const adverse = dir > 0 ? entry - s.l[j] : s.h[j] - entry;
    if (adverse > mae) { mae = adverse; maeM = q; }
    if (adverse >= stopPts) { stopped = true; exitM = q; break; }
    const fav = dir > 0 ? s.h[j] - entry : entry - s.l[j];
    if (fav > mfe) { mfe = fav; mfeM = q; }
    if (!hitHalf && fav >= 0.5 * stopPts) { hitHalf = true; mg.push({ time: hhmm(q), event: `+0.5R reached (${r2(entry + dir * 0.5 * stopPts)}).` }); }
    if (!hitOne && fav >= stopPts) { hitOne = true; mg.push({ time: hhmm(q), event: `+1R reached (${r2(entry + dir * stopPts)}).` }); }
    if (tgtM < 0 && fav >= tgtPts) tgtM = q;
    last = s.c[j]; exitM = q;
  }
  // Edge Hunter's scoring: target counts if the best excursion before any stop reached it
  let grossR: number, reason: TradeDetail['exit']['reason'], exitPx: number;
  if (mfe >= tgtPts) { grossR = t.targetR; reason = 'target'; exitPx = tgtPx; exitM = tgtM; }
  else if (stopped) { grossR = -1; reason = 'stop'; exitPx = stopPx; }
  else { grossR = Math.max(-1, Math.min(t.targetR, ((last - entry) * dir) / stopPts)); reason = end === FLAT && exitM >= FLAT - 1 ? 'flat' : 'time'; exitPx = last; }
  const netR = grossR - COST_PTS / stopPts;
  const ptsNet = grossR * stopPts - COST_PTS;
  mg.push({ time: hhmm(mfeM), event: `Best point: +${r2(mfe / stopPts)}R (${r2(mfe)} pt in favour).` });
  if (mae > 0) mg.push({ time: hhmm(maeM), event: `Worst point: −${r2(Math.min(mae, stopPts) / stopPts)}R (${r2(Math.min(mae, stopPts))} pt against).` });
  mg.push({ time: hhmm(exitM), event: reason === 'target' ? `Target hit at ${r2(exitPx)}: +${t.targetR}R.` : reason === 'stop' ? `Stopped at ${r2(exitPx)}: −1R.` : reason === 'flat' ? `Flat before the close at ${r2(exitPx)}: ${r2(grossR)}R.` : `Out after ${t.holdMin} min at ${r2(exitPx)}: ${r2(grossR)}R.` });
  mg.sort((a, b) => toMin(a.time) - toMin(b.time));

  // ---- confluence at entry (only candles closed before the entry minute)
  const px = s.c[idx[m0 - 1] >= 0 ? idx[m0 - 1] : idx[m0]];
  const tfs: TradeDetail['confluence']['timeframes'] = [];
  for (const [key, label] of [['m5', '5m'], ['m15', '15m'], ['m60', '1h']] as const) {
    const tr = trendOf(px, c.ema[key].val[di][m0], c.ema[key].prev[di][m0]);
    tfs.push({ tf: label, trend: tr, agrees: tr === (dir > 0 ? 'up' : 'down') });
  }
  const trD = trendOf(px, c.emaD[di], c.emaDPrev[di]);
  tfs.push({ tf: 'Daily', trend: trD, agrees: trD === (dir > 0 ? 'up' : 'down') });
  // 1m: last 10 minutes direction
  const j10 = idx[Math.max(0, m0 - 10)];
  const tr1: 'up' | 'down' | 'flat' = j10 >= 0 ? (px - s.o[j10] > 0.1 * atr ? 'up' : px - s.o[j10] < -0.1 * atr ? 'down' : 'flat') : 'flat';
  tfs.unshift({ tf: '1m (last 10 min)', trend: tr1, agrees: tr1 === (dir > 0 ? 'up' : 'down') });
  let pv = 0, vv = 0, hiSoFar = -Infinity, loSoFar = Infinity, orH = -Infinity, orL = Infinity;
  for (let q = 0; q < m0; q++) { const j = idx[q]; if (j < 0) continue; pv += ((s.h[j] + s.l[j] + s.c[j]) / 3) * s.v[j]; vv += s.v[j]; hiSoFar = Math.max(hiSoFar, s.h[j]); loSoFar = Math.min(loSoFar, s.l[j]); if (q < 15) { orH = Math.max(orH, s.h[j]); orL = Math.min(orL, s.l[j]); } }
  const vwap = vv > 0 ? pv / vv : px;
  const vwSide: 'above' | 'below' = px >= vwap ? 'above' : 'below';
  const levels: TradeDetail['confluence']['levels'] = [];
  const lv = (name: string, p: number) => { if (isFinite(p)) levels.push({ name, price: r2(p), distPts: r2(px - p), near: Math.abs(px - p) <= 0.5 * atr }); };
  if (di > 0) { lv('Prior day high', c.hi[di - 1]); lv('Prior day low', c.lo[di - 1]); lv('Prior day close', c.close[di - 1]); }
  lv('Today open', c.open[di]);
  if (m0 >= 15) { lv('Opening range high (9:30-9:45)', orH); lv('Opening range low', orL); }
  lv('Session high so far', hiSoFar); lv('Session low so far', loSoFar);
  const norm = (() => { let sum = 0, n = 0; for (let x = Math.max(0, di - 20); x < di; x++) if (isFinite(c.dayAtr[x])) { sum += c.dayAtr[x]; n++; } return n >= 10 ? sum / n : NaN; })();
  const vol = !isFinite(norm) ? 'unknown' : atr < 0.8 * norm ? 'quiet' : atr > 1.25 * norm ? 'wild' : 'normal';
  const agreeList = [...tfs.slice(1).map(x => x.agrees), (vwSide === 'above') === (dir > 0)];
  const fomc = FOMC_SET.has(t.date) ? 'FOMC 14:00' : null;
  const news = [NEWS.get(t.date), fomc].filter(Boolean).join(' + ') || null;

  const wd = new Date(`${t.date}T12:00:00Z`).getUTCDay();
  return {
    date: t.date, weekday: WDN[wd], dir: dir > 0 ? 'long' : 'short',
    entry: { time: hhmm(m0), minute: m0, price: r2(entry) }, stop: { price: r2(stopPx), pts: r2(stopPts) }, target: { price: r2(tgtPx), r: t.targetR, pts: r2(tgtPts) },
    exit: { time: hhmm(exitM), price: r2(exitPx), reason }, minutesHeld: exitM - m0 + 1,
    grossR: r3(grossR), netR: r3(netR), netUsdNQ: r2(ptsNet * PV.NQ), netUsdMNQ: r2(grossR * stopPts * PV.MNQ - (1.0 + 0.5 * PV.MNQ)),
    mfeR: r2(mfe / stopPts), maeR: r2(Math.min(mae, stopPts) / stopPts),
    refR: t.refR ?? null, matches: t.refR == null ? null : Math.abs(t.refR - netR) <= 0.002,
    management: mg,
    confluence: {
      score: agreeList.filter(Boolean).length, of: agreeList.length, timeframes: tfs,
      vwap: { side: vwSide, distPts: r2(px - vwap), agrees: (vwSide === 'above') === (dir > 0) }, levels,
      context: { time: hhmm(m0), gapPts: di > 0 ? r2(c.open[di] - c.close[di - 1]) : null, news, volatility: vol, atr5m: r2(atr), dayRangeSoFar: r2(hiSoFar - loSoFar) },
    },
  };
}
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const FOMC_SET = new Set<string>(FOMC_DATES);

// ------------------------------------------------------------------ prop-firm gate
export interface GateInput { n: number; tStat: number; hold: { n: number; avgR: number }; val: { avgR: number }; maxDdR: number; maxLosingStreak: number; perDay: number; }
export function propGate(g: GateInput) {
  const checks = [
    { name: '50+ trades', pass: g.n >= 50, value: String(g.n) },
    { name: 'Strong enough (t >= 3)', pass: g.tStat >= 3, value: String(g.tStat) },
    { name: 'Positive on validation days', pass: g.val.avgR > 0, value: `${g.val.avgR}R` },
    { name: 'Positive on untouched holdout (20+ trades)', pass: g.hold.n >= 20 && g.hold.avgR > 0, value: `${g.hold.avgR}R on ${g.hold.n}` },
    // risk 10% of the account's max drawdown per trade -> worst drawdown must stay within 50% of it (go-live rule 3)
    { name: 'Worst drawdown <= 5R (fits a prop drawdown at 10% risk/trade)', pass: g.maxDdR >= -5, value: `${g.maxDdR}R` },
  ];
  return { propReady: checks.every(c => c.pass), checks };
}

// ------------------------------------------------------------------ storage
export async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_playbooks (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, account_id INTEGER NOT NULL, attempt_id INTEGER,
      source TEXT NOT NULL, rule_key TEXT NOT NULL, name TEXT NOT NULL, rule TEXT NOT NULL, status TEXT NOT NULL,
      stats JSONB NOT NULL, gate JSONB NOT NULL, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (user_id, rule_key));
    CREATE TABLE IF NOT EXISTS ai_playbook_trades (
      id SERIAL PRIMARY KEY, playbook_id INTEGER NOT NULL REFERENCES ai_playbooks(id) ON DELETE CASCADE,
      trade_id INTEGER, seq INTEGER NOT NULL, date DATE NOT NULL, detail JSONB NOT NULL);
    CREATE INDEX IF NOT EXISTS ai_playbook_trades_pb ON ai_playbook_trades (playbook_id, seq);`);
}

async function playbookAccount(userId: number): Promise<number> {
  const r = await pool.query(`SELECT id FROM accounts WHERE user_id = $1 AND broker = 'AI' AND account_name = 'AI Playbook' ORDER BY id LIMIT 1`, [userId]);
  if (r.rows.length) return r.rows[0].id;
  const ins = await pool.query(
    `INSERT INTO accounts (user_id, broker, account_number, account_name, status, account_type, currency, timezone)
     VALUES ($1, 'AI', 'ai-playbook', 'AI Playbook', 'active', 'paper', 'USD', 'America/New_York') RETURNING id`, [userId]);
  return ins.rows[0].id;
}

export interface RecordInput {
  userId: number; source: string; ruleKey: string; name: string; rule: string;
  stats: Record<string, unknown> & GateInput; trades: TradeSpec[];
}

/** Replays every trade, stores the strategy + trades (journal account "AI Playbook", one attempt). Re-recording replaces only its own rows. */
export async function recordStrategy(inp: RecordInput) {
  await ensureTables();
  const s = await load();
  const c = buildCtx(s);
  const details = inp.trades.map(t => replayTrade(s, c, t)).filter((x): x is TradeDetail => !!x);
  if (!details.length) throw Object.assign(new Error('None of the trades could be replayed on the chart data.'), { status: 400 });
  const checked = details.filter(d => d.matches !== null);
  const matchRate = checked.length ? checked.filter(d => d.matches).length / checked.length : null;
  const gate = propGate(inp.stats);
  const status = gate.propReady ? 'prop-ready' : 'watch';
  const accountId = await playbookAccount(inp.userId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const old = await client.query(`SELECT id, attempt_id FROM ai_playbooks WHERE user_id = $1 AND rule_key = $2`, [inp.userId, inp.ruleKey]);
    let pbId: number, attemptId: number;
    const summary = summarize(details);
    const stats = { ...inp.stats, replayed: details.length, requested: inp.trades.length, replayMatch: matchRate == null ? null : r3(matchRate), ...summary };
    if (old.rows.length) {
      pbId = old.rows[0].id; attemptId = old.rows[0].attempt_id;
      // replace only the journal trades this playbook created
      await client.query(`DELETE FROM trades WHERE account_id = $1 AND broker_trade_id LIKE $2`, [accountId, `ai_${pbId}_%`]);
      await client.query(`DELETE FROM ai_playbook_trades WHERE playbook_id = $1`, [pbId]);
      await client.query(`UPDATE ai_playbooks SET name = $2, rule = $3, status = $4, stats = $5, gate = $6, source = $7, updated_at = NOW() WHERE id = $1`,
        [pbId, inp.name, inp.rule, status, JSON.stringify(stats), JSON.stringify(gate), inp.source]);
      await client.query(`UPDATE account_attempts SET label = $2, note = $3 WHERE id = $1`, [attemptId, `AI: ${inp.name}`.slice(0, 250), inp.rule]);
    } else {
      const seq = await client.query(`SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM account_attempts WHERE account_id = $1`, [accountId]);
      const at = await client.query(`INSERT INTO account_attempts (account_id, seq, label, status, note) VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
        [accountId, seq.rows[0].s, `AI: ${inp.name}`.slice(0, 250), inp.rule]);
      attemptId = at.rows[0].id;
      const pb = await client.query(`INSERT INTO ai_playbooks (user_id, account_id, attempt_id, source, rule_key, name, rule, status, stats, gate)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [inp.userId, accountId, attemptId, inp.source, inp.ruleKey, inp.name, inp.rule, status, JSON.stringify(stats), JSON.stringify(gate)]);
      pbId = pb.rows[0].id;
    }
    for (let k = 0; k < details.length; k++) {
      const d = details[k];
      const wall = (hm: string) => `${d.date} ${hm.padStart(5, '0')}:00`;
      const exitWall = d.exit.time === d.entry.time ? `${d.date} ${d.exit.time.padStart(5, '0')}:59` : wall(d.exit.time);
      const notes = [
        `AI playbook · ${inp.name}`,
        `${d.dir === 'long' ? 'Long' : 'Short'} 1 NQ at ${d.entry.price} (${d.entry.time} ET) · stop ${d.stop.price} · target ${d.target.price} (${d.target.r}R) · exit ${d.exit.reason} ${d.exit.price} (${d.exit.time}) · ${d.netR}R after costs`,
        `Confluence ${d.confluence.score}/${d.confluence.of}: ` + d.confluence.timeframes.map(x => `${x.tf} ${x.trend}`).join(', ') + `, VWAP ${d.confluence.vwap.side}`,
        ...d.management.map(m => `${m.time} ${m.event}`),
      ].join('\n');
      const tr = await client.query(
        `INSERT INTO trades (account_id, broker_trade_id, symbol, entry_time, exit_time, entry_price, exit_price, quantity, pnl, setup_tag, notes, tags, stop_loss, target, attempt_id, timeframe, planned_rr)
         VALUES ($1, $2, 'NQ', $3, $4, $5, $6, 1, $7, $8, $9, $10, $11, $12, $13, '5m', $14) RETURNING id`,
        [accountId, `ai_${pbId}_${k}`, wall(d.entry.time), exitWall, d.entry.price, d.exit.price, d.netUsdNQ, inp.name.slice(0, 100), notes,
          ['AI playbook', d.dir === 'long' ? 'Long' : 'Short', `exit ${d.exit.reason}`], d.stop.price, d.target.price, attemptId, `1:${d.target.r}`]);
      await client.query(`INSERT INTO ai_playbook_trades (playbook_id, trade_id, seq, date, detail) VALUES ($1, $2, $3, $4, $5)`,
        [pbId, tr.rows[0].id, k, d.date, JSON.stringify(d)]);
    }
    await client.query('COMMIT');
    return { id: pbId, status, trades: details.length, replayMatch: matchRate, gate };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** What the trades looked like overall, and which confluence factors went with better results. */
export function summarize(ds: TradeDetail[]) {
  const n = ds.length, wins = ds.filter(d => d.netR > 0).length;
  const sumR = ds.reduce((a, d) => a + d.netR, 0);
  const gw = ds.filter(d => d.netR > 0).reduce((a, d) => a + d.netR, 0), gl = -ds.filter(d => d.netR <= 0).reduce((a, d) => a + d.netR, 0);
  const reasons: Record<string, number> = {};
  for (const d of ds) reasons[d.exit.reason] = (reasons[d.exit.reason] || 0) + 1;
  const factor = (name: string, f: (d: TradeDetail) => boolean) => {
    const yes = ds.filter(f), no = ds.filter(d => !f(d));
    const avg = (a: TradeDetail[]) => (a.length ? r3(a.reduce((x, d) => x + d.netR, 0) / a.length) : null);
    const wr = (a: TradeDetail[]) => (a.length ? r3(a.filter(d => d.netR > 0).length / a.length) : null);
    return { name, withN: yes.length, withAvgR: avg(yes), withWin: wr(yes), withoutN: no.length, withoutAvgR: avg(no), withoutWin: wr(no) };
  };
  const tfNames = ds[0]?.confluence.timeframes.map(t => t.tf) ?? [];
  const factors = [
    ...tfNames.map(tf => factor(`${tf} trend agrees`, d => !!d.confluence.timeframes.find(x => x.tf === tf)?.agrees)),
    factor('VWAP on the trade side', d => d.confluence.vwap.agrees),
    factor('Confluence 3+ of 5', d => d.confluence.score >= 3),
    factor('Near a key level (<= 0.5 ATR)', d => d.confluence.levels.some(l => l.near)),
    factor('News day', d => !!d.confluence.context.news),
    factor('Wild volatility', d => d.confluence.context.volatility === 'wild'),
  ];
  const byDay = new Map<string, number>();
  for (const d of ds) byDay.set(d.date, (byDay.get(d.date) || 0) + d.netUsdNQ);
  const dayVals = [...byDay.values()], profit = dayVals.reduce((a, x) => a + x, 0), bestDay = Math.max(...dayVals);
  return {
    winRate: r3(n ? wins / n : 0), avgNetR: r3(n ? sumR / n : 0), totalNetR: r2(sumR), profitFactor: gl > 0 ? r2(gw / gl) : null,
    avgMinutesHeld: Math.round(ds.reduce((a, d) => a + d.minutesHeld, 0) / (n || 1)), exitReasons: reasons,
    netUsdNQ: r2(ds.reduce((a, d) => a + d.netUsdNQ, 0)), netUsdMNQ: r2(ds.reduce((a, d) => a + d.netUsdMNQ, 0)),
    // prop consistency: share of all profit that came from the single best day (many firms cap it at 30-50%)
    bestDayShare: profit > 0 ? r3(bestDay / profit) : null,
    factors,
  };
}
