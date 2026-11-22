// Size & Pass Lab: replay the breakout pullback research trades (2016-2026) through a prop evaluation with the
// account rules, size and filters you choose. Everything is editable and saved in this browser.
// Engine: src/shared/sizeLab.ts (unit-tested). Trades are uploaded once and kept in the user's account
// (/api/sizelab/trades) so research results stay out of the public code: the breakout pullback file comes from
// trading-system roboquant/journal_import/export_bp_sizelab.py (same rules as the paper bot), or any CSV.
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { PROP_PRESETS } from '../../../src/shared/propRules';
import type { DdType } from '../../../src/shared/propRules';
import { filterTrades, byDay, historical, bootstrap, fullHistory, parseTradesCsv, Account, Sizing, Costs, Filter, LabTrade, POINT_VALUE } from '../../../src/shared/sizeLab';
import { Explain, RangePicker, DateRange } from './MemoryKit';
import '../styles/BacktestLab.css';
import '../styles/PatternFinder.css';
import '../styles/MemoryKit.css';

interface Setup { name: string; preset: string; a: Account; s: Sizing; c: Costs; f: Filter; range: DateRange }
const DEFAULT: Setup = {
  name: 'My setup', preset: 'lucid-25k',
  a: { start: 25000, target: 1250, maxDd: 1000, ddType: 'eod', lockAtStart: false, dailyLoss: null, dailyLossFails: false, consistencyPct: 50, minDays: null, maxContracts: 20 },
  s: { contract: 'MNQ', mode: 'risk', contracts: 1, riskUsd: 150, pctRoom: 15, maxStopUsd: null, halveAfterLosses: 0, myDailyStop: null, myDailyTarget: null, maxTradesDay: null },
  c: { commission: 1, slipPts: 0.5 },
  f: { from: '', to: '', startMin: 575, endMin: 930, skipNews: false },
  range: { dateFrom: '', dateTo: '', label: 'All data' },
};
const KEY = 'sizelab.current', SAVED = 'sizelab.saved';
const load = <T,>(k: string, d: T): T => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const usd = (x: number) => (isFinite(x) ? `${x < 0 ? '−' : ''}$${Math.abs(Math.round(x)).toLocaleString()}` : '—');
const pct = (x: number) => (isFinite(x) ? `${Math.round(x * 100)}%` : '—');
const mo = (x: number) => (isFinite(x) ? `${x < 1 ? x.toFixed(1) : Math.round(x)} mo` : '—');
const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

function Num({ label, value, onChange, blank, step = 1, hint, width = 90 }: { label: string; value: number | null; onChange: (v: number | null) => void; blank?: boolean; step?: number; hint?: string; width?: number }) {
  return (
    <label className="bl-field" title={hint}>{label}
      <input type="number" step={step} value={value ?? ''} placeholder={blank ? 'none' : ''} style={{ width }}
        onChange={e => { const v = e.target.value.trim(); onChange(v === '' ? (blank ? null : 0) : Number(v)); }} />
    </label>
  );
}

export default function SizeLab({ token }: { token: string }) {
  const auth = useMemo(() => ({ headers: { Authorization: `Bearer ${token}` } }), [token]);
  const [doc, setDoc] = useState<{ name: string; source?: string; uploaded?: string; trades: LabTrade[] } | null | undefined>(undefined);
  const [upMsg, setUpMsg] = useState('');
  useEffect(() => { axios.get('/api/sizelab/trades', auth).then(r => setDoc(r.data.doc)).catch(() => setDoc(null)); }, [auth]);
  const TRADES: LabTrade[] = doc?.trades ?? [];
  const upload = async (file: File) => {
    setUpMsg('Reading…');
    try {
      const text = await file.text();
      let next: { name: string; source?: string; trades: LabTrade[] };
      if (/\.json$/i.test(file.name)) {
        const j = JSON.parse(text);
        next = { name: j.strategy || file.name, source: j.source || '', trades: j.trades };
      } else {
        const p = parseTradesCsv(text);
        if (!p.trades.length) { setUpMsg(p.errors.join(' ') || 'No trades found.'); return; }
        next = { name: file.name.replace(/\.[^.]+$/, ''), source: `CSV upload${p.errors.length ? ` (${p.errors.length}+ rows skipped)` : ''}`, trades: p.trades };
      }
      const r = await axios.put('/api/sizelab/trades', { doc: next }, auth);
      const g = await axios.get('/api/sizelab/trades', auth);
      setDoc(g.data.doc); setUpMsg(`Loaded ${r.data.trades} trades.`);
    } catch (e: any) { setUpMsg(e?.response?.data?.error || 'Could not read that file (JSON from export_bp_sizelab.py, or a CSV).'); }
  };
  const [st, setSt] = useState<Setup>(() => { const v = load<Setup>(KEY, DEFAULT); return { ...DEFAULT, ...v, a: { ...DEFAULT.a, ...v.a }, s: { ...DEFAULT.s, ...v.s }, c: { ...DEFAULT.c, ...v.c }, f: { ...DEFAULT.f, ...v.f } }; });
  const [saved, setSaved] = useState<Setup[]>(() => load<Setup[]>(SAVED, []));
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [tStart, setTStart] = useState(hm(st.f.startMin)), [tEnd, setTEnd] = useState(hm(st.f.endMin));
  useEffect(() => save(KEY, st), [st]);
  const A = (p: Partial<Account>) => setSt(x => ({ ...x, preset: 'custom', a: { ...x.a, ...p } }));
  const S = (p: Partial<Sizing>) => setSt(x => ({ ...x, s: { ...x.s, ...p } }));
  const C = (p: Partial<Costs>) => setSt(x => ({ ...x, c: { ...x.c, ...p } }));
  const F = (p: Partial<Filter>) => setSt(x => ({ ...x, f: { ...x.f, ...p } }));
  const pickPreset = (id: string) => {
    const p = PROP_PRESETS.find(x => x.id === id);
    if (!p) { setSt(x => ({ ...x, preset: 'custom' })); return; }
    setSt(x => ({ ...x, preset: id, a: { ...x.a, start: p.size, target: p.target ?? x.a.target, maxDd: p.maxDrawdown ?? x.a.maxDd, ddType: p.ddType, lockAtStart: p.lockAtStart, dailyLoss: p.dailyLoss, consistencyPct: p.consistencyPct, minDays: p.minDays } }));
  };
  const setContract = (c: 'NQ' | 'MNQ') => setSt(x => ({ ...x, s: { ...x.s, contract: c }, c: { ...x.c, commission: c === 'NQ' ? 3.5 : 1 }, a: { ...x.a, maxContracts: c === 'NQ' ? Math.max(1, Math.round(x.a.maxContracts / 10)) : x.a.maxContracts * (x.s.contract === 'NQ' ? 10 : 1) } }));

  // recompute (debounced; the shuffled test takes ~0.5 s)
  useEffect(() => {
    if (!TRADES.length) { setRes(null); return; }
    setBusy(true);
    const id = setTimeout(() => {
      const f = { ...st.f, from: st.range.dateFrom, to: st.range.dateTo };
      const days = byDay(filterTrades(TRADES, f));
      const h = historical(days, st.a, st.s, st.c), b = bootstrap(days, st.a, st.s, st.c, 2000), full = fullHistory(days, st.a, st.s, st.c);
      setRes({ days: days.length, trades: days.reduce((n, d) => n + d.length, 0), from: days[0]?.[0][0], to: days[days.length - 1]?.[0][0], h, b, full });
      setBusy(false);
    }, 350);
    return () => clearTimeout(id);
  }, [st, doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopDist = useMemo(() => {
    const pv = POINT_VALUE[st.s.contract], v = TRADES.map(t => t[3] * pv).sort((x, y) => x - y);
    return { med: v[Math.floor(v.length / 2)] ?? NaN, p90: v[Math.floor(v.length * 0.9)] ?? NaN };
  }, [st.s.contract, doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const gate3 = res ? res.full.maxDdUsd <= 0.5 * st.a.maxDd : false;
  const saveAs = () => {   // the name comes from the "Setup name" field (no browser dialogs)
    const next = [...saved.filter(x => x.name !== st.name), st]; setSaved(next); save(SAVED, next);
  };
  const del = (n: string) => { const next = saved.filter(x => x.name !== n); setSaved(next); save(SAVED, next); };

  return (
    <div className="bl-wrap">
      <div className="bl-card">
        <h3>Size &amp; Pass Lab{doc ? ` · ${doc.name}` : ''}</h3>
        <Explain id="sizelab" title="What is this?" what={`Replays the ${TRADES.length.toLocaleString()} breakout pullback research trades (NQ, 2016–2026, same rules as the paper bot) through a prop evaluation with the account rules, size and filters you choose. Change any number and the results update. Your settings are saved in this browser.`}
          read={['Pass % (real order) = a fresh evaluation started at the start of every month, playing the real trades in order. Shuffled pass % = the same with the trading days in random order, 2,000 times.',
            'Months to pass / fail = the median time. Long times mean small size: the edge is thin, so small size passes slowly. “Still going” = neither passed nor failed when the data ran out (counts as not passed).',
            'Sizes are whole contracts and each trade is checked against the drawdown at its worst point while open, so results are stricter than a simple R calculation.',
            'Whole history at this size = no account limits: total, average per trade, worst drawdown, worst losing streak. Go-live gate step 3: worst drawdown must be 50% or less of the account’s max drawdown.',
            'Skipped = trades whose stop was too wide for your size or your max stop.']}
          filters={[['Account', 'pick a firm preset, then fix any number to match your exact plan (firm rules change: check their site)'], ['Size', 'fixed contracts, a $ risk per trade (contracts = risk ÷ stop), or a % of the drawdown room you have left'], ['Costs', 'commission per contract round trip and extra slippage in points'], ['Which trades', 'dates, entry time window (ET) and whether to skip trades open during big news']]}
          example="Lucid 25K, MNQ, $150 risk per trade: try morning only (9:35–11:30) and compare pass % and months with all day." />
        {doc === undefined && <p className="bl-dim">Loading your trades…</p>}
        {doc && <p className="bl-dim">{TRADES.length.toLocaleString()} trades{doc.source ? ` · ${doc.source}` : ''}. Stop of one {st.s.contract}: median {usd(stopDist.med)}, 1 in 10 trades over {usd(stopDist.p90)}. Research trades, not a promise: the forward paper test (30+ trades) still decides.</p>}
        <div className="bl-rules" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <label className="pf-run" style={{ cursor: 'pointer' }}>{doc ? 'Replace trades' : 'Upload trades'}
            <input type="file" accept=".json,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} /></label>
          <span className="bl-dim">Breakout pullback: <code>trading-system\roboquant\journal_import</code> → run <code>export_bp_sizelab.py</code> (makes <code>bpTrades.json</code>). Any strategy: CSV with <code>date,time,dir,stop_pts,r</code> (+ optional <code>adverse_pts,news</code>), New York time. Kept in your journal account, not in the public code.</span>
          {upMsg && <span className="bl-dim"><b>{upMsg}</b></span>}
        </div>
      </div>
      {doc === null && <div className="bl-card"><p className="bl-dim">No trades yet: upload a file above to start.</p></div>}

      {doc && <>
      <div className="bl-card">
        <div className="bl-head"><b>1. Account</b></div>
        <div className="bl-rules" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <label className="bl-field">Preset<select value={st.preset} onChange={e => pickPreset(e.target.value)}>
            <option value="custom">Custom</option>{PROP_PRESETS.map(p => <option key={p.id} value={p.id}>{p.firm} · {p.plan}</option>)}</select></label>
          <Num label="Start $" value={st.a.start} onChange={v => A({ start: v ?? 0 })} />
          <Num label="Profit target $" value={st.a.target} onChange={v => A({ target: v ?? 0 })} />
          <Num label="Max drawdown $" value={st.a.maxDd} onChange={v => A({ maxDd: v ?? 0 })} />
          <label className="bl-field">Drawdown type<select value={st.a.ddType} onChange={e => A({ ddType: e.target.value as DdType })}>
            <option value="eod">End of day trailing</option><option value="intraday">Intraday trailing</option><option value="static">Static</option></select></label>
          <label className="mk-check"><input type="checkbox" checked={st.a.lockAtStart} onChange={e => A({ lockAtStart: e.target.checked })} /> stops trailing at the start balance</label>
          <Num label="Firm daily loss $" value={st.a.dailyLoss} blank onChange={v => A({ dailyLoss: v })} />
          <label className="mk-check"><input type="checkbox" checked={st.a.dailyLossFails} onChange={e => A({ dailyLossFails: e.target.checked })} /> breaking it fails the account</label>
          <Num label="Consistency % (best day)" value={st.a.consistencyPct} blank onChange={v => A({ consistencyPct: v })} />
          <Num label="Min trading days" value={st.a.minDays} blank onChange={v => A({ minDays: v })} />
          <Num label={`Max ${st.s.contract} contracts`} value={st.a.maxContracts} onChange={v => A({ maxContracts: Math.max(1, v ?? 1) })} />
        </div>
        {st.preset !== 'custom' && <p className="bl-dim">{PROP_PRESETS.find(p => p.id === st.preset)?.note} Checked {PROP_PRESETS.find(p => p.id === st.preset)?.checked}: confirm on the firm’s site.</p>}
      </div>

      <div className="bl-card">
        <div className="bl-head"><b>2. Size</b></div>
        <div className="bl-rules" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <div className="pf-seg">{(['MNQ', 'NQ'] as const).map(c => <button key={c} className={st.s.contract === c ? 'on' : ''} onClick={() => setContract(c)}>{c}</button>)}</div>
          <div className="pf-seg">{([['fixed', 'Fixed contracts'], ['risk', '$ risk per trade'], ['pctRoom', '% of drawdown room']] as const).map(([k, l]) => <button key={k} className={st.s.mode === k ? 'on' : ''} onClick={() => S({ mode: k })}>{l}</button>)}</div>
          {st.s.mode === 'fixed' && <Num label="Contracts" value={st.s.contracts} onChange={v => S({ contracts: Math.max(1, v ?? 1) })} />}
          {st.s.mode === 'risk' && <Num label="Risk $ per trade" value={st.s.riskUsd} onChange={v => S({ riskUsd: v ?? 0 })} hint="contracts = risk ÷ (stop pts × point value), rounded down; 0 = trade skipped" />}
          {st.s.mode === 'pctRoom' && <Num label="% of room left" value={st.s.pctRoom} step={0.5} onChange={v => S({ pctRoom: v ?? 0 })} hint="room = balance − drawdown floor" />}
          <Num label="Max stop $ (skip wider)" value={st.s.maxStopUsd} blank onChange={v => S({ maxStopUsd: v })} hint="for ONE contract" />
          <Num label="Half size after N losses" value={st.s.halveAfterLosses} onChange={v => S({ halveAfterLosses: Math.max(0, v ?? 0) })} hint="0 = off; back to full size after a win" />
          <Num label="My daily stop $" value={st.s.myDailyStop} blank onChange={v => S({ myDailyStop: v })} />
          <Num label="My daily target $" value={st.s.myDailyTarget} blank onChange={v => S({ myDailyTarget: v })} />
          <Num label="Max trades a day" value={st.s.maxTradesDay} blank onChange={v => S({ maxTradesDay: v })} />
        </div>
      </div>

      <div className="bl-card">
        <div className="bl-head"><b>3. Costs and which trades</b></div>
        <div className="bl-rules" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <Num label="Commission $ / contract" value={st.c.commission} step={0.1} onChange={v => C({ commission: v ?? 0 })} />
          <Num label="Extra slippage (pts)" value={st.c.slipPts} step={0.25} onChange={v => C({ slipPts: v ?? 0 })} hint="0.5 = the research default; 1–2 = a bad fill" />
          <label className="bl-field">Entries from (ET)<input value={tStart} style={{ width: 70 }} onChange={e => { setTStart(e.target.value); const m = toMin(e.target.value); if (isFinite(m)) F({ startMin: m }); }} /></label>
          <label className="bl-field">to (ET)<input value={tEnd} style={{ width: 70 }} onChange={e => { setTEnd(e.target.value); const m = toMin(e.target.value); if (isFinite(m)) F({ endMin: m }); }} /></label>
          <button className="mk-chip" onClick={() => { setTStart('9:35'); setTEnd('15:30'); F({ startMin: 575, endMin: 930 }); }}>All day</button>
          <button className="mk-chip" onClick={() => { setTStart('9:35'); setTEnd('11:30'); F({ startMin: 575, endMin: 690 }); }}>Morning only</button>
          <label className="mk-check"><input type="checkbox" checked={st.f.skipNews} onChange={e => F({ skipNews: e.target.checked })} /> skip trades open during big news</label>
        </div>
        <RangePicker value={st.range} onChange={r => setSt(x => ({ ...x, range: r }))} />
        <p className="bl-dim">ET = New York time (BC is 2 hours behind until Mar 14, 2027). Morning only was found by looking at the results: treat it as an idea to forward-test, not a proven rule.</p>
        <div className="bl-rules" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginTop: 6 }}>
          <label className="bl-field">Setup name<input value={st.name} onChange={e => setSt(x => ({ ...x, name: e.target.value }))} style={{ width: 160 }} /></label>
          <button className="pf-run" onClick={saveAs}>Save setup</button>
          <button className="mk-chip" onClick={() => { setSt(DEFAULT); setTStart('9:35'); setTEnd('15:30'); }}>Reset</button>
          {saved.map(x => <span key={x.name} className="mk-chip"><span style={{ cursor: 'pointer' }} onClick={() => { setSt(x); setTStart(hm(x.f.startMin)); setTEnd(hm(x.f.endMin)); }}>{x.name}</span> <span style={{ cursor: 'pointer' }} title="Delete" onClick={() => del(x.name)}>✕</span></span>)}
        </div>
      </div>

      <div className="bl-card">
        <div className="bl-head"><b>Results</b> <span className="bl-dim">{busy ? 'updating…' : res ? `${res.trades} trades on ${res.days} days, ${res.from} → ${res.to}` : ''}</span></div>
        {res && <>
          <div className="bl-tiles">
            <div className="bl-tile"><div className="bl-tile-label">Pass % (real order)</div><div className={`bl-tile-v ${res.h.passRate >= 0.6 ? 'bl-up' : res.h.passRate < 0.4 ? 'bl-down' : ''}`}>{pct(res.h.passRate)}</div><div className="bl-dim" style={{ fontSize: 11 }}>fail {pct(res.h.failRate)}{res.h.open ? ` · still going at the end ${pct(res.h.open / res.h.runs)}` : ''} · {res.h.runs} starts</div></div>
            <div className="bl-tile"><div className="bl-tile-label">Months to pass / fail</div><div className="bl-tile-v">{mo(res.h.monthsToPass)} / {mo(res.h.monthsToFail)}</div><div className="bl-dim" style={{ fontSize: 11 }}>median, real order</div></div>
            <div className="bl-tile"><div className="bl-tile-label">Pass % (shuffled days)</div><div className="bl-tile-v">{pct(res.b.passRate)}</div><div className="bl-dim" style={{ fontSize: 11 }}>{mo(res.b.monthsToPass)} to pass · {mo(res.b.monthsToFail)} to fail</div></div>
            <div className="bl-tile"><div className="bl-tile-label">Why evaluations failed</div><div className="bl-tile-v" style={{ fontSize: 14 }}>{Object.entries(res.h.failReasons).map(([k, v]) => `${v} ${k}`).join(' · ') || 'none'}</div></div>
          </div>
          <div className="bl-head" style={{ marginTop: 10 }}><b>Whole history at this size</b> <span className="bl-dim">no account limits; your daily rules still apply</span></div>
          <div className="bl-tiles">
            <div className="bl-tile"><div className="bl-tile-label">Total / per trade</div><div className={`bl-tile-v ${res.full.totalUsd >= 0 ? 'bl-up' : 'bl-down'}`}>{usd(res.full.totalUsd)}</div><div className="bl-dim" style={{ fontSize: 11 }}>{usd(res.full.avgUsd)} a trade · win {pct(res.full.winRate)}</div></div>
            <div className="bl-tile"><div className="bl-tile-label">Worst drawdown</div><div className={`bl-tile-v ${gate3 ? 'bl-up' : 'bl-down'}`}>{usd(res.full.maxDdUsd)}</div><div className="bl-dim" style={{ fontSize: 11 }}>gate 3 needs ≤ {usd(0.5 * st.a.maxDd)} (50% of max drawdown): {gate3 ? 'OK' : 'too big'}</div></div>
            <div className="bl-tile"><div className="bl-tile-label">Worst losing streak</div><div className="bl-tile-v">{res.full.worstLosingStreak} trades</div></div>
            <div className="bl-tile"><div className="bl-tile-label">Trades taken / skipped</div><div className="bl-tile-v">{res.full.taken} / {res.full.skipped}</div><div className="bl-dim" style={{ fontSize: 11 }}>skipped = stop too wide for the size</div></div>
          </div>
          <Curve pts={res.full.curve} />
          <div className="mm-two" style={{ marginTop: 10 }}>
            <div>
              <div className="bl-head"><b>By year</b></div>
              <table className="pf-grid mm-table"><thead><tr><th>Year</th><th>Trades</th><th>Result</th></tr></thead>
                <tbody>{res.full.years.map((y: any) => <tr key={y.year}><td>{y.year}</td><td>{y.trades}</td><td className={y.usd >= 0 ? 'bl-up' : 'bl-down'}>{usd(y.usd)}</td></tr>)}</tbody></table>
            </div>
            <div>
              <div className="bl-head"><b>Each evaluation (real order)</b> <button className="mm-link" onClick={() => setShowRuns(!showRuns)}>{showRuns ? 'hide' : 'show'}</button></div>
              {showRuns && <div className="pf-scroll" style={{ maxHeight: 280 }}><table className="pf-grid mm-table"><thead><tr><th>Started</th><th>Result</th><th>Trading days</th><th>Ended</th><th>Profit</th></tr></thead>
                <tbody>{res.h.list.map((r: any) => <tr key={r.start}><td>{r.start.slice(0, 7)}</td><td className={r.result === 'pass' ? 'bl-up' : r.result === 'fail' ? 'bl-down' : 'bl-dim'}>{r.result}</td><td>{r.days}</td><td>{r.endDate ?? '—'}</td><td>{usd(r.profit)}</td></tr>)}</tbody></table></div>}
            </div>
          </div>
        </>}
      </div>
      </>}
    </div>
  );
}

function Curve({ pts }: { pts: { d: string; eq: number }[] }) {
  if (pts.length < 2) return null;
  const W = 900, H = 160, lo = Math.min(0, ...pts.map(p => p.eq)), hi = Math.max(0, ...pts.map(p => p.eq)), span = hi - lo || 1;
  const x = (i: number) => (i / (pts.length - 1)) * W, y = (v: number) => H - 6 - ((v - lo) / span) * (H - 12);
  const last = pts[pts.length - 1].eq;
  const years = pts.map((p, i) => ({ y: p.d.slice(0, 4), i })).filter((p, i, a) => i === 0 || p.y !== a[i - 1].y)
    .filter((p, k, a) => k === a.length - 1 || x(a[k + 1].i) - x(p.i) > 36);   // no overlapping labels
  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} style={{ width: '100%', height: 'auto', marginTop: 8 }} aria-label="Equity curve">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border)" />
      <polyline fill="none" strokeWidth={1.6} stroke={last >= 0 ? '#089981' : '#f23645'} points={pts.map((p, i) => `${x(i)},${y(p.eq)}`).join(' ')} />
      {years.map(p => <text key={p.y} x={x(p.i)} y={H + 12} fontSize={10} fill="var(--muted)">{p.y}</text>)}
    </svg>
  );
}
