// News Event Analyzer: economic calendar + how NQ reacted to past releases, by surprise bucket.
// All numbers are computed deterministically on the server (src/news/econStats.ts). Research only.
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, Upload } from 'lucide-react';
import '../styles/NewsAnalyzer.css';

type Code = 'CPI' | 'NFP' | 'PPI' | 'RETAIL' | 'FOMC';
interface Rel { event: Code; date: string; time: string; utc: string; period: string; actual: number | null; forecast?: number | null; previous: number | null; revised: number | null; unit: string; shared: string[]; impact: string; currency: string }
interface Ci { p: number; lo: number; hi: number }
interface WS { n: number; insufficient: boolean; up: Ci | null; down: Ci | null; medianPts: number | null; meanPts: number | null; meanPct: number | null; avgRange: number | null; minPts: number | null; maxPts: number | null }
interface BucketStats { n: number; windows: Record<string, WS>; reversal: { n: number; insufficient: boolean; rate: Ci | null }; first15VsAvg: number | null }
interface Study {
  event: Code; info: { name: string; measures: string; time: string }; sigma: number; includeShared: boolean; lessPrecise: boolean;
  counts: { releases: number; withForecast: number; used: number; sharedExcluded: number; noData: number; rollExcluded: number };
  buckets: Record<'all' | 'above' | 'inline' | 'below', BucketStats>;
  rows: { date: string; time: string; period: string; actual: number | null; forecast: number | null; previous: number | null; revised: number | null; surprise: number | null; z: number | null; bucket: string; shared: string[]; rollExcluded: boolean; m5: number | null; m60: number | null; first15VsAvg: number | null; reversal: boolean | null }[];
  method: string;
}
interface PSide { n: number; days: number; winRate: Ci | null; pnl: number; avgPnl: number | null; avgR: number | null; insufficient: boolean }

const WIN_ORDER = ['pre15', 'm1', 'm5', 'm15', 'm30', 'm60', 'session', 'nextDay'];
const WIN_LABEL: Record<string, string> = { pre15: '15 min before', m1: '+1 min', m5: '+5 min', m15: '+15 min', m30: '+30 min', m60: '+60 min', session: 'Rest of session', nextDay: 'Next day close' };
const BUCKET_LABEL: Record<string, string> = { above: 'Above consensus', inline: 'In line', below: 'Below consensus', all: 'All releases' };
const ci = (c: Ci | null) => (c ? `${Math.round(c.p * 100)}% (${Math.round(c.lo * 100)}–${Math.round(c.hi * 100)})` : '—');
const pts = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(d)}`);
const val = (x: number | null | undefined) => (x == null ? '—' : String(x));
const usd = (x: number | null | undefined) => (x == null ? '—' : `${x < 0 ? '−' : ''}$${Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);

function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m ${String(r).padStart(2, '0')}s`;
}

export default function NewsAnalyzer({ token, account_id }: { token: string; account_id: number | null }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [rels, setRels] = useState<Rel[] | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<'ALL' | Code>('ALL');
  const [sel, setSel] = useState<Code>('CPI');
  const [sigma, setSigma] = useState(0.5);
  const [shared, setShared] = useState(false);
  const [study, setStudy] = useState<Study | null>(null);
  const [studyErr, setStudyErr] = useState('');
  const [personal, setPersonal] = useState<Record<string, { event: PSide; normal: PSide }> | null>(null);
  const [summary, setSummary] = useState<{ bullets: string[]; source: string; label: string; model?: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [reload, setReload] = useState(0);

  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    axios.get('/api/news/calendar', auth).then(r => { setRels(r.data.releases); setErr(''); }).catch(() => setErr('Could not load the calendar.'));
  }, [token, reload]);
  useEffect(() => {
    setStudy(null); setStudyErr('');
    axios.get(`/api/news/study/${sel}`, { ...auth, params: { sigma, shared: shared ? 1 : 0 } })
      .then(r => setStudy(r.data)).catch(e => setStudyErr(e?.response?.data?.error || 'Could not compute the study.'));
    setSummary(null);
    axios.get(`/api/news/summary/${sel}`, { ...auth, params: { sigma, shared: shared ? 1 : 0 } }).then(r => setSummary(r.data)).catch(() => setSummary(null));
  }, [sel, sigma, shared, reload]);
  useEffect(() => {
    if (!account_id) return;
    axios.get('/api/news/personal', { ...auth, params: { account_id } }).then(r => setPersonal(r.data.byEvent)).catch(() => setPersonal(null));
  }, [account_id, reload]);

  const upcoming = useMemo(() => (rels || []).filter(r => Date.parse(r.utc) > now - 3600000 && (filter === 'ALL' || r.event === filter)).slice(0, 10), [rels, now, filter]);
  const past = useMemo(() => (rels || []).filter(r => Date.parse(r.utc) <= now && r.actual != null && (filter === 'ALL' || r.event === filter)).reverse().slice(0, 60), [rels, now, filter]);

  if (err) return <div className="na"><p className="na-err">{err}</p></div>;
  if (!rels) return <div className="na"><p className="na-dim">Loading…</p></div>;

  const vol = study?.buckets.all.first15VsAvg ?? null;
  return (
    <div className="na">
      <div className="na-disclaimer"><AlertTriangle className="ic-sm" /> Historical results only. Not financial advice. Past reactions don't guarantee future results; every number below is scenario research, not a trade signal.</div>

      <div className="na-filters">
        <span className="na-dim">Currency</span><span className="na-chip on">USD</span>
        <span className="na-dim">Impact</span><span className="na-chip on">High</span>
        <span className="na-dim">Event</span>
        {(['ALL', 'CPI', 'NFP', 'PPI', 'RETAIL', 'FOMC'] as const).map(c => (
          <button key={c} className={`na-chip ${filter === c ? 'on' : ''}`} onClick={() => setFilter(c)}>{c === 'ALL' ? 'All' : c === 'RETAIL' ? 'Retail sales' : c}</button>
        ))}
      </div>

      <section className="na-card">
        <h3>Upcoming <span className="na-dim">New York times shown in your local time · forecasts come from your imported CSV</span></h3>
        {upcoming.length === 0 ? <p className="na-dim">No upcoming dates known for this filter. FOMC dates are built in; add CPI / NFP / PPI / retail-sales dates with the forecast import below.</p> : (
          <div className="na-table-wrap"><table className="na-table">
            <thead><tr><th>When (local)</th><th>Event</th><th>Impact</th><th className="r">Previous</th><th className="r">Forecast</th><th>Countdown</th></tr></thead>
            <tbody>{upcoming.map(r => (
              <tr key={r.event + r.date} className="na-click" onClick={() => setSel(r.event)}>
                <td className="nowrap">{new Date(r.utc).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{r.event}{r.shared.length ? <span className="na-shared" title={`Same minute as: ${r.shared.join(', ')}`}>+{r.shared.length}</span> : null}</td>
                <td><span className="na-impact">High</span></td>
                <td className="r">{val(r.previous)}</td><td className="r">{val(r.forecast)}</td>
                <td className="nowrap strong">{countdown(Date.parse(r.utc) - now)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="na-card">
        <div className="na-head">
          <h3>{study?.info.name ?? sel}: how NQ reacted {vol != null && vol >= 1.5 && <span className="na-vol" title="First 15 minutes after the release vs the average of the same 15 minutes on the previous 20 trading days">Volatility ×{vol.toFixed(1)} normal</span>}</h3>
          <div className="na-controls">
            <label>Event <select value={sel} onChange={e => setSel(e.target.value as Code)}>{(['CPI', 'NFP', 'PPI', 'RETAIL', 'FOMC'] as Code[]).map(c => <option key={c} value={c}>{c}</option>)}</select></label>
            <label title="A release is 'above' / 'below' when its surprise is this many standard deviations from the event's past surprises">Bucket ±<input type="number" step={0.1} min={0.1} max={3} value={sigma} onChange={e => setSigma(Math.min(3, Math.max(0.1, Number(e.target.value) || 0.5)))} />σ</label>
            <label className="na-check"><input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} /> Include releases that shared the minute with another release</label>
          </div>
        </div>
        {studyErr && <p className="na-err">{studyErr}</p>}
        {!study ? !studyErr && <p className="na-dim">Computing…</p> : (
          <>
            <p className="na-dim">{study.info.measures} {study.lessPrecise && <b>FOMC buckets compare the decision with the expected decision only — less precise than data surprises.</b>}</p>
            <p className="na-dim">{study.counts.releases} releases with first-release values · {study.counts.used} used · {study.counts.sharedExcluded} left out because another release came at the same minute ·
              {' '}{study.counts.noData} without NQ data · {study.counts.rollExcluded} next-day values left out (contract roll) · forecasts for {study.counts.withForecast}.</p>
            {summary && (
              <div className="na-summary">
                <div className="na-summary-label">{summary.label} · {summary.source === 'ai' ? `written by ${summary.model} from the stats below, numbers checked` : 'written from the stats below by fixed rules (no AI)'}</div>
                <ul>{summary.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
              </div>
            )}
            {study.counts.withForecast === 0 && <p className="na-warn">No forecasts imported for {sel} yet, so surprise buckets are empty. The "All releases" table works now; import consensus forecasts below to split by surprise.</p>}
            {(['all', 'above', 'inline', 'below'] as const).filter(b => b === 'all' || study.counts.withForecast > 0).map(b => {
              const s = study.buckets[b];
              return (
                <div key={b} className="na-bucket">
                  <h4>{BUCKET_LABEL[b]} <span className="na-dim">n = {s.n}</span></h4>
                  {s.n < 10 ? <p className="na-insufficient">Insufficient evidence (n = {s.n}, needs 10+).</p> : (
                    <>
                      <div className="na-table-wrap"><table className="na-table">
                        <thead><tr><th>Window</th><th className="r">n</th><th>Up (95% range)</th><th>Down (95% range)</th><th className="r">Median pts</th><th className="r">Average pts</th><th className="r">Avg %</th><th className="r">Avg range</th><th className="r">Min / max</th></tr></thead>
                        <tbody>{WIN_ORDER.map(w => { const x = s.windows[w]; if (!x) return null; return (
                          <tr key={w}><td className="nowrap">{WIN_LABEL[w]}</td><td className="r">{x.n}</td>
                            {x.insufficient ? <td colSpan={7} className="na-insufficient">Insufficient evidence (n &lt; 10)</td> : <>
                              <td className="nowrap">{ci(x.up)}</td><td className="nowrap">{ci(x.down)}</td>
                              <td className="r">{pts(x.medianPts)}</td><td className="r">{pts(x.meanPts)}</td><td className="r">{pts(x.meanPct, 2)}</td>
                              <td className="r">{x.avgRange == null ? '—' : x.avgRange.toFixed(1)}</td><td className="r nowrap">{pts(x.minPts, 0)} / {pts(x.maxPts, 0)}</td></>}
                          </tr>); })}</tbody>
                      </table></div>
                      <p className="na-dim">Reversal (first-5-min direction opposite to the 60-min direction): {s.reversal.insufficient ? 'insufficient evidence' : ci(s.reversal.rate)} of {s.reversal.n}.
                        {' '}First 15 minutes vs the same window on the previous 20 days: {s.first15VsAvg == null ? '—' : `×${s.first15VsAvg.toFixed(1)}`}.</p>
                    </>
                  )}
                </div>
              );
            })}
            <details className="na-details"><summary>Every release ({study.rows.length})</summary>
              <div className="na-table-wrap"><table className="na-table">
                <thead><tr><th>Date</th><th>Period</th><th className="r">Previous</th><th className="r">Forecast</th><th className="r">Actual (1st)</th><th className="r">Revised</th><th className="r">Surprise</th><th>Bucket</th><th className="r">+5 min</th><th className="r">+60 min</th><th>Notes</th></tr></thead>
                <tbody>{study.rows.map(r => (
                  <tr key={r.date}><td className="nowrap">{r.date}</td><td>{r.period}</td><td className="r">{val(r.previous)}</td><td className="r">{val(r.forecast)}</td><td className="r strong">{val(r.actual)}</td><td className="r">{val(r.revised)}</td>
                    <td className="r">{r.surprise == null ? '—' : pts(r.surprise, 2)}</td><td>{r.bucket === 'unknown' ? '—' : BUCKET_LABEL[r.bucket]}</td>
                    <td className="r">{pts(r.m5)}</td><td className="r">{pts(r.m60)}</td>
                    <td className="na-dim">{[r.shared.length ? `same minute: ${r.shared.join(', ')}` : '', r.rollExcluded ? 'roll before next close' : ''].filter(Boolean).join(' · ')}</td></tr>
                ))}</tbody>
              </table></div>
            </details>
            <p className="na-method">{study.method}</p>
          </>
        )}
      </section>

      <section className="na-card">
        <h3>Your trading on news days <span className="na-dim">selected account · event days vs days with none of the five releases</span></h3>
        {!account_id ? <p className="na-dim">Choose an account.</p> : !personal ? <p className="na-dim">Loading…</p> : (
          <div className="na-table-wrap"><table className="na-table">
            <thead><tr><th>Event</th><th>Days</th><th className="r">Trades</th><th>Win rate (95% range)</th><th className="r">P&L</th><th className="r">Avg / trade</th><th className="r">Avg R</th></tr></thead>
            <tbody>{(Object.keys(personal) as Code[]).flatMap(k => (['event', 'normal'] as const).map(side => {
              const p = personal[k][side];
              return (
                <tr key={k + side} className={side === 'normal' ? 'na-sub' : ''}>
                  <td>{side === 'event' ? `${k} days` : 'normal days'}</td><td>{p.days}</td><td className="r">{p.n}</td>
                  <td className="nowrap">{p.insufficient ? <span className="na-insufficient">n &lt; 10</span> : ci(p.winRate)}</td>
                  <td className={`r ${p.pnl >= 0 ? 'na-up' : 'na-down'}`}>{usd(p.pnl)}</td><td className="r">{usd(p.avgPnl)}</td><td className="r">{p.avgR == null ? '—' : p.avgR.toFixed(2)}</td>
                </tr>
              );
            }))}</tbody>
          </table></div>
        )}
      </section>

      {account_id && <BlackoutSettings token={token} accountId={account_id} />}
      <ForecastImport token={token} onDone={() => setReload(x => x + 1)} />
    </div>
  );
}

function BlackoutSettings({ token, accountId }: { token: string; accountId: number }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [b, setB] = useState<{ before: string; after: string }>({ before: '', after: '' });
  const [msg, setMsg] = useState('');
  useEffect(() => {
    axios.get(`/api/news/blackout/${accountId}`, auth).then(r => setB({ before: r.data.before == null ? '' : String(r.data.before), after: r.data.after == null ? '' : String(r.data.after) })).catch(() => undefined);
  }, [accountId]);
  const save = async () => {
    const n = (v: string) => (v.trim() === '' ? null : Math.round(Number(v)));
    try { await axios.put(`/api/news/blackout/${accountId}`, { before: n(b.before), after: n(b.after) }, auth); setMsg('Saved. The banner shows on every page for this account.'); window.dispatchEvent(new Event('jc:blackout-changed')); }
    catch (e: any) { setMsg(e?.response?.data?.error || 'Could not save.'); }
  };
  return (
    <section className="na-card">
      <h3>Prop-firm news rule <span className="na-dim">this account · leave empty to turn off</span></h3>
      <p className="na-dim">Many firms ban trading a few minutes around high-impact releases. Set your firm's window and a banner with a countdown appears while it is active.</p>
      <div className="na-controls">
        <label>Minutes before <input type="number" min={0} max={240} value={b.before} onChange={e => setB({ ...b, before: e.target.value })} /></label>
        <label>Minutes after <input type="number" min={0} max={240} value={b.after} onChange={e => setB({ ...b, after: e.target.value })} /></label>
        <button className="na-btn" onClick={save}>Save</button>
        {msg && <span className="na-dim">{msg}</span>}
      </div>
    </section>
  );
}

function ForecastImport({ token, onDone }: { token: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const send = async (csv: string) => {
    try {
      const r = await axios.post('/api/news/forecasts', { csv }, { headers: { Authorization: `Bearer ${token}` } });
      setMsg(`Imported ${r.data.imported} row${r.data.imported === 1 ? '' : 's'}.${r.data.errors?.length ? ` Skipped: ${r.data.errors.join('; ')}` : ''}`);
      setText(''); onDone();
    } catch (e: any) { setMsg(e?.response?.data?.error ? `${e.response.data.error}${e.response.data.errors ? ': ' + e.response.data.errors.join('; ') : ''}` : 'Import failed.'); }
  };
  return (
    <section className="na-card">
      <h3><Upload className="ic-sm" /> Import consensus forecasts / upcoming dates</h3>
      <p className="na-dim">Paste CSV with columns <code>event,date,time,forecast,source</code> — event = CPI, NFP, PPI, RETAIL or FOMC; date YYYY-MM-DD; time HH:MM New York (optional);
        forecast in the same unit as the actuals (CPI/PPI/retail: % m/m like 0.3; NFP: thousands like 150; FOMC: expected change in bp like -25). Use the consensus as it stood <b>before</b> each release, from a source you are allowed to use. Rows without a forecast just add a date to the calendar.</p>
      <textarea className="na-text" rows={5} value={text} onChange={e => setText(e.target.value)} placeholder={'event,date,time,forecast,source\nCPI,2026-12-10,08:30,0.3,my notes\nNFP,2026-12-04,08:30,,'} />
      <div className="na-controls">
        <button className="na-btn" onClick={() => send(text)} disabled={!text.trim()}>Import</button>
        <label className="na-btn">Choose a CSV file<input type="file" accept=".csv,text/csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) f.text().then(send); }} /></label>
        {msg && <span className="na-dim">{msg}</span>}
      </div>
    </section>
  );
}
