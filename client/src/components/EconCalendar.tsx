// Economic calendar (News Analyzer page): this week's US releases with impact, forecast / actual / previous, a
// countdown to the next high-impact one, "what NQ usually does" for each event, big-tech earnings, and the file
// import (ForexFactory weekly export or history CSV).
import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { CalendarClock, Upload } from 'lucide-react';
import '../styles/Habits.css';

export interface CalEvent {
  id: number; release_utc: string; title: string; impact: 'high' | 'medium' | 'low'; actual: string | null; forecast: string | null; previous: string | null;
  ny_date: string; ny_time: string; surprise: 'above' | 'below' | 'inline' | null; actual_source?: 'file' | 'FRED' | null;
  nq: { n: number; absMed1: number; absMed15: number; up15: number; line: string } | null;
}
export interface Earning { symbol: string; day: string; timing: string | null; eps_forecast: string | null }

export const localTime = (utc: string) => new Date(utc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const until = (ms: number) => {
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d >= 1 ? `in ${d}d ${h % 24}h` : h >= 1 ? `in ${h}h ${m % 60}m` : `in ${m} min`;
};
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const surpriseCls = (s: CalEvent['surprise']) => (s === 'above' ? 'hb-up' : s === 'below' ? 'hb-down' : '');

export function useCalendar(token: string, days = 7, back = 1, impact = 'high,medium') {
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [coverage, setCoverage] = useState<any>(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setTick(x => x + 1), 5 * 60000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    axios.get('/api/calendar/events', { headers: { Authorization: `Bearer ${token}` }, params: { days, back, impact } })
      .then(r => { setEvents(r.data.events); setCoverage(r.data.coverage); setErr(''); })
      .catch(e => { setErr(e?.response?.data?.error || 'Could not load the calendar.'); setEvents([]); });
  }, [token, days, back, impact, tick]);
  return { events, coverage, err, reload: () => setTick(x => x + 1) };
}
export function useEarnings(token: string) {
  const [data, setData] = useState<{ events: Earning[]; checkedAt: string | null; note?: string; source?: string } | null>(null);
  useEffect(() => {
    axios.get('/api/calendar/earnings', { headers: { Authorization: `Bearer ${token}` } }).then(r => setData(r.data)).catch(() => setData({ events: [], checkedAt: null, note: 'Earnings dates unavailable right now.' }));
  }, [token]);
  return data;
}

export function EarningsList({ data, max = 12 }: { data: ReturnType<typeof useEarnings>; max?: number }) {
  if (!data) return <div className="hb-dim">Loading earnings…</div>;
  if (!data.events.length) return <div className="hb-dim">{data.note || 'No big-tech earnings in the next six weeks.'}</div>;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="hb-row">
      {data.events.slice(0, max).map(e => (
        <span key={e.symbol + e.day} className="hb-pill" title={e.eps_forecast ? `EPS forecast ${e.eps_forecast}` : ''}>
          <b>{e.symbol}</b> {e.day === today ? 'TODAY' : dayLabel(e.day)} · {e.timing ?? 'time not given'}
        </span>
      ))}
    </div>
  );
}

function ImportBox({ token, onDone }: { token: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [tz, setTz] = useState('auto');
  const [preview, setPreview] = useState<any>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const post = async (pre: boolean) => {
    setBusy(true); setMsg(null);
    try {
      const r = await axios.post('/api/calendar/import', { text, tz, preview: pre }, { headers: { Authorization: `Bearer ${token}` } });
      if (pre) setPreview(r.data);
      else { setMsg({ ok: true, t: `Saved ${r.data.saved.toLocaleString()} events. The calendar now runs to ${r.data.coverage?.last?.slice(0, 10)}.` }); setPreview(null); setText(''); setName(''); onDone(); }
    } catch (e: any) { setMsg({ ok: false, t: e?.response?.data?.error || 'Import failed.' }); }
    finally { setBusy(false); }
  };
  const nyTime = (utc: string) => new Date(utc).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <div className="hb-block" style={{ marginTop: 10 }}>
      <div className="hb-dim">Add the coming week: on Sunday evening or Monday morning (the weekly file switches to the new week over the weekend) open ForexFactory's weekly export <b>once</b> (they block repeated loads), save it, and load it here. A history CSV also works. Nothing is fetched from ForexFactory automatically.<br />The weekly file has no actual results: CPI, PPI, retail sales and non-farm payrolls get theirs from FRED (marked ᶠ); other releases stay empty unless your file has them.</div>
      <div className="hb-row" style={{ marginTop: 8 }}>
        <input ref={fileRef} type="file" accept=".json,.csv,.txt" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; setName(f.name); setText(await f.text()); setPreview(null); setMsg(null); }} />
        <button className="hb-btn" onClick={() => fileRef.current?.click()}><Upload size={13} /> Choose file</button>
        <span className="hb-dim">{name || 'no file'}</span>
        <label className="hb-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>Times in the file
          <select value={tz} onChange={e => { setTz(e.target.value); setPreview(null); }}>
            <option value="auto">Detect</option><option value="ny">New York</option><option value="london">London</option><option value="utc">UTC</option>
          </select>
        </label>
        <button className="hb-btn" disabled={!text || busy} onClick={() => post(true)}>Check</button>
        <button className="hb-btn primary" disabled={!preview || busy} onClick={() => post(false)}>Import {preview ? preview.events.toLocaleString() : ''}</button>
      </div>
      {preview && (
        <div className="hb-dim" style={{ marginTop: 6 }}>
          {preview.format}, times read as {preview.tz}: {preview.events.toLocaleString()} US events ({preview.high.toLocaleString()} high impact), {preview.first?.slice(0, 10)} to {preview.last?.slice(0, 10)}.
          {preview.check?.length ? <> Check these land at the usual New York time: {preview.check.map((c: any) => `${c.title} ${nyTime(c.release_utc)}`).join(' · ')}.</> : null}
        </div>
      )}
      {msg && <div className={`hb-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.t}</div>}
    </div>
  );
}

export default function EconCalendar({ token, isAdmin }: { token: string; isAdmin: boolean }) {
  const [range, setRange] = useState<'week' | 'today' | 'past'>('week');
  const [impact, setImpact] = useState('high,medium');
  const [open, setOpen] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(t); }, []);
  const days = range === 'past' ? 1 : range === 'today' ? 1 : 7, back = range === 'past' ? 7 : range === 'today' ? 0 : 1;
  const { events, coverage, err, reload } = useCalendar(token, days, back, impact);
  const earnings = useEarnings(token);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const list = useMemo(() => (events || []).filter(e => (range === 'past' ? Date.parse(e.release_utc) < now : range === 'today' ? e.ny_date === today : e.ny_date >= today)), [events, range, today, now]);
  const next = (events || []).find(e => e.impact === 'high' && Date.parse(e.release_utc) > now);
  let lastDay = '';
  return (
    <div className="hb-card">
      <h3><CalendarClock size={16} /> Economic calendar <span className="hb-dim">US releases · New York time, your time in brackets</span></h3>
      {next && (
        <div className="hb-block" style={{ marginBottom: 10 }}>
          <div className="hb-between"><span><span className="hb-imp high" /><b>Next high impact:</b> {next.title}</span><b>{until(Date.parse(next.release_utc) - now)}</b></div>
          <div className="hb-dim">{dayLabel(next.ny_date)} {next.ny_time} New York ({localTime(next.release_utc)} yours){next.forecast ? ` · forecast ${next.forecast}` : ''}{next.previous ? ` · previous ${next.previous}` : ''}</div>
          {next.nq && <div className="hb-nq">{next.nq.line}</div>}
        </div>
      )}
      <div className="hb-row" style={{ marginBottom: 8 }}>
        {(['today', 'week', 'past'] as const).map(r => <button key={r} className={`hb-btn ${range === r ? 'on' : ''}`} onClick={() => setRange(r)}>{r === 'today' ? 'Today' : r === 'week' ? 'Next 7 days' : 'Last 7 days'}</button>)}
        <select value={impact} onChange={e => setImpact(e.target.value)}>
          <option value="high">High impact</option><option value="high,medium">High + medium</option><option value="high,medium,low">All</option>
        </select>
      </div>
      {err && <div className="hb-msg err">{err}</div>}
      {events === null ? <div className="hb-dim">Loading…</div> : !list.length ? (
        <div className="hb-dim">No releases in this range{coverage?.upcoming === 0 ? ' — the calendar has no upcoming dates yet. Import this week\'s ForexFactory export below.' : '.'}</div>
      ) : (
        <div className="hb-scroll">
          <table className="hb-table">
            <thead><tr><th>Time (NY)</th><th>Release</th><th>Actual</th><th>Forecast</th><th className="hb-hide-sm">Previous</th></tr></thead>
            <tbody>
              {list.map(e => {
                const head = e.ny_date !== lastDay ? <tr key={'d' + e.ny_date}><td className="hb-day" colSpan={5}>{dayLabel(e.ny_date)}</td></tr> : null;
                lastDay = e.ny_date;
                const past = Date.parse(e.release_utc) < now;
                return [head, (
                  <tr key={e.id} className={past ? 'past' : next?.id === e.id ? 'next' : ''} onClick={() => setOpen(open === e.id ? null : e.id)} style={{ cursor: e.nq ? 'pointer' : 'default' }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{e.ny_time} <span className="hb-dim">({localTime(e.release_utc)})</span></td>
                    <td><span className={`hb-imp ${e.impact}`} />{e.title}
                      {e.nq && (open === e.id ? <div className="hb-nq">{e.nq.line}</div> : <div className="hb-nq">NQ: median {e.nq.absMed15.toFixed(0)} pts in 15 min · tap for more</div>)}
                    </td>
                    <td className={surpriseCls(e.surprise)} title={e.actual_source === 'FRED' ? 'First-release value from FRED (the weekly file has no actuals)' : ''}><b>{e.actual ?? ''}</b>{e.actual_source === 'FRED' ? <span className="hb-dim"> ᶠ</span> : null}</td>
                    <td>{e.forecast ?? ''}</td>
                    <td className="hb-hide-sm">{e.previous ?? ''}</td>
                  </tr>
                )];
              })}
            </tbody>
          </table>
        </div>
      )}
      <h4>Big-tech earnings (they move NQ)</h4>
      <EarningsList data={earnings} />
      {earnings?.source && <div className="hb-dim" style={{ marginTop: 4 }}>{earnings.source}</div>}
      <div className="hb-dim" style={{ marginTop: 8 }}>
        Calendar holds {coverage?.n?.toLocaleString() ?? 0} US releases{coverage?.last ? ` up to ${String(coverage.last).slice(0, 10)}` : ''}. "NQ" lines come from 5 years of NQ 1-minute data around each release; green actual = above forecast, red = below.
      </div>
      {isAdmin && <ImportBox token={token} onDone={reload} />}
    </div>
  );
}
