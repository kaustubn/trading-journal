// Practice log: dashboard for the Backtest Session Tracker (time spent practising on Market Chart replay).
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Download, Pencil, Trash2, X } from 'lucide-react';
import { kpis, heatmap, timePerSetup, filterSessions, sessionsCsv, SessionRow, DayRow, addDays } from '../../../shared/practiceStats';
import { fmtDuration } from '../utils/sessionTimer';
import { EmptyState } from './ui';
import { Timer } from 'lucide-react';
import '../styles/PracticeLog.css';

interface Stats {
  tz: string; daily: DayRow[]; sessions: SessionRow[];
  samples: { setup: string; n: number }[]; targets: { setup_tag: string; target: number }[];
  coverage: { date: string; sessions: number; tag: string | null }[];
}

const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
const localDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA');
const localTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const hours = (sec: number | null | undefined) => (sec == null ? '—' : sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(sec >= 36000 ? 0 : 1)} h`);
const TAG_NEXT: Record<string, string | null> = { '': 'trend', trend: 'range', range: 'news', news: null };
const TAG_LABEL: Record<string, string> = { trend: 'Trend', range: 'Range', news: 'News day' };

export default function PracticeLog({ token }: { token: string }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState('');
  const [reload, setReload] = useState(0);
  const [f, setF] = useState({ from: '', to: '', setup: '', instrument: '' });
  const [edit, setEdit] = useState<SessionRow | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    axios.get('/api/bt-sessions/stats', { ...auth, params: { tz: TZ } })
      .then(r => { setS(r.data); setErr(''); })
      .catch(() => setErr('Could not load the practice log.'));
  }, [token, reload]);

  const today = new Date().toLocaleDateString('en-CA');
  const k = useMemo(() => (s ? kpis(s.daily, s.sessions, today) : null), [s, today]);
  const grid = useMemo(() => (s ? heatmap(s.daily, today) : []), [s, today]);
  const perSetup = useMemo(() => (s ? timePerSetup(s.sessions) : []), [s]);
  const rows = useMemo(() => (s ? filterSessions(s.sessions, f, localDate) : []), [s, f]);
  useEffect(() => setPage(0), [f]);

  if (err) return <div className="pl"><p className="pl-err">{err}</p></div>;
  if (!s || !k) return <div className="pl"><p className="pl-dim">Loading…</p></div>;
  if (!s.sessions.length) {
    return (
      <div className="pl">
        <EmptyState icon={Timer} title="No practice sessions yet">
          Start a replay on the <b>Market Chart</b> (or a day from <b>S1 Practice</b>). The timer starts by itself, pauses after 5 minutes
          without activity, and every session shows up here.
        </EmptyState>
      </div>
    );
  }

  const targetOf = (setup: string) => s.targets.find(t => t.setup_tag === setup)?.target ?? 100;
  const setTarget = async (setup: string) => {
    const v = window.prompt(`Sample-size target for ${setup} (trades)`, String(targetOf(setup)));
    if (v == null) return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) { alert('Enter a whole number of trades, 1 or more.'); return; }
    await axios.put('/api/bt-sessions/targets', { setup_tag: setup, target: n }, auth).catch(() => alert('Could not save the target.'));
    setReload(r => r + 1);
  };
  const cycleTag = async (date: string, cur: string | null) => {
    const next = TAG_NEXT[cur ?? ''];
    await axios.put(`/api/bt-sessions/coverage/${date}`, { tag: next }, auth).catch(() => alert('Could not save the tag.'));
    setReload(r => r + 1);
  };
  const exportCsv = () => {
    const blob = new Blob([sessionsCsv(rows, localTime)], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `practice_sessions_${today}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const del = async (r: SessionRow) => {
    if (!window.confirm(`Delete the session that started ${localTime(r.started_at)}? Its time is removed from every total. This cannot be undone.`)) return;
    await axios.delete(`/api/bt-sessions/${r.id}`, auth).catch(() => alert('Could not delete the session.'));
    setReload(x => x + 1);
  };

  // coverage calendar: months that contain tested or tagged dates, newest first
  const cov = new Map(s.coverage.map(c => [c.date, c]));
  const months = Array.from(new Set(s.coverage.map(c => c.date.slice(0, 7)))).sort().reverse();
  const setups = Array.from(new Set(s.sessions.map(x => x.setup_tag || '(no setup)')));
  const instruments = Array.from(new Set(s.sessions.map(x => x.instrument).filter(Boolean))) as string[];
  const PAGE = 50, shown = rows.slice(page * PAGE, page * PAGE + PAGE), pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const maxSetupSec = Math.max(1, ...perSetup.map(p => p.sec));

  return (
    <div className="pl">
      <div className="pl-kpis">
        <Kpi label="Today" value={hours(k.todaySec)} />
        <Kpi label="This week" value={hours(k.weekSec)} />
        <Kpi label="This month" value={hours(k.monthSec)} />
        <Kpi label="All time" value={hours(k.allSec)} sub={`${k.activeDays} practice day${k.activeDays === 1 ? '' : 's'}`} />
        <Kpi label="Avg per practice day" value={hours(k.avgActiveDaySec)} sub="days with practice only" />
        <Kpi label="Avg per calendar day" value={hours(k.avgCalendarDaySec)} sub={`over ${k.calendarDays} days since your first session`} />
        <Kpi label="Trades per hour" value={k.tradesPerHour == null ? '—' : k.tradesPerHour.toFixed(1)} sub="trades logged ÷ active hours" />
        <Kpi label="Longest session" value={k.longest ? fmtDuration(k.longest.active_sec) : '—'} sub={k.longest ? localDate(k.longest.started_at) : ''} />
        <Kpi label="Shortest session" value={k.shortest ? fmtDuration(k.shortest.active_sec) : '—'} sub={k.shortest ? localDate(k.shortest.started_at) : ''} />
        <Kpi label="Streak" value={`${k.currentStreak} day${k.currentStreak === 1 ? '' : 's'}`} sub={`best ${k.bestStreak} · a day counts from 1 min`} />
      </div>

      <section className="pl-card">
        <h3>Practice heatmap <span className="pl-dim">last 12 months · active minutes per day · {s.tz}</span></h3>
        <div className="pl-heat-wrap">
          <svg className="pl-heat" viewBox={`0 0 ${grid.length * 13 + 24} ${7 * 13 + 4}`} role="img" aria-label="Practice minutes per day for the last 12 months">
            {['Mon', 'Wed', 'Fri'].map((l, i) => <text key={l} x={0} y={i * 26 + 10} className="pl-heat-lbl">{l}</text>)}
            {grid.map((col, w) => col.map((c, d) => (
              <rect key={c.d} x={24 + w * 13} y={d * 13} width={11} height={11} rx={2} className={c.future ? 'pl-h-future' : `pl-h${c.level}`}>
                <title>{`${c.d}: ${Math.round(c.sec / 60)} min`}</title>
              </rect>
            )))}
          </svg>
        </div>
        <div className="pl-legend">Less {[0, 1, 2, 3, 4].map(l => <span key={l} className={`pl-sw pl-h${l}`} />)} More <span className="pl-dim">(&lt;15, &lt;45, &lt;90, 90+ min)</span></div>
      </section>

      <div className="pl-two">
        <section className="pl-card">
          <h3>Sample size per setup <span className="pl-dim">replay trades · click a target to change it</span></h3>
          {s.samples.length === 0 ? <p className="pl-dim">No replay trades yet.</p> : s.samples.map(x => {
            const t = targetOf(x.setup), pct = Math.min(100, (x.n / t) * 100);
            return (
              <div key={x.setup} className="pl-bar-row">
                <span className="pl-bar-name">{x.setup}</span>
                <div className="pl-bar"><div className={`pl-bar-fill ${pct >= 100 ? 'done' : ''}`} style={{ width: `${pct}%` }} /></div>
                <button className="pl-bar-num" onClick={() => setTarget(x.setup)} title="Change the target">{x.n} / {t}</button>
              </div>
            );
          })}
        </section>
        <section className="pl-card">
          <h3>Time per strategy</h3>
          {perSetup.map(p => (
            <div key={p.setup} className="pl-bar-row">
              <span className="pl-bar-name">{p.setup}</span>
              <div className="pl-bar"><div className="pl-bar-fill alt" style={{ width: `${(p.sec / maxSetupSec) * 100}%` }} /></div>
              <span className="pl-bar-num plain">{hours(p.sec)} · {p.sessions}</span>
            </div>
          ))}
        </section>
      </div>

      <section className="pl-card">
        <h3>Coverage calendar <span className="pl-dim">historical days you replayed · click a day to tag it (trend → range → news → none)</span></h3>
        {months.length === 0 ? <p className="pl-dim">No replayed days yet.</p> : (
          <div className="pl-months">
            {months.map(m => {
              const first = `${m}-01`, startWd = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7;
              const n = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
              return (
                <div key={m} className="pl-month">
                  <div className="pl-month-name">{new Date(first + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</div>
                  <div className="pl-days">
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x, i) => <span key={i} className="pl-wd">{x}</span>)}
                    {Array.from({ length: startWd }).map((_, i) => <span key={'b' + i} />)}
                    {Array.from({ length: n }).map((_, i) => {
                      const d = addDays(first, i), c = cov.get(d);
                      return (
                        <button key={d} className={`pl-day ${c?.sessions ? 'tested' : ''} ${c?.tag ? 'tag-' + c.tag : ''}`} disabled={!c}
                          onClick={() => c && cycleTag(d, c.tag)} title={c ? `${d}: ${c.sessions} session${c.sessions === 1 ? '' : 's'}${c.tag ? ' · ' + TAG_LABEL[c.tag] : ''}` : d}>
                          {i + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="pl-legend"><span className="pl-sw tested" /> replayed <span className="pl-sw tag-trend" /> trend <span className="pl-sw tag-range" /> range <span className="pl-sw tag-news" /> news day</div>
      </section>

      <section className="pl-card">
        <div className="pl-hist-head">
          <h3>Session history</h3>
          <button className="pl-btn" onClick={exportCsv} disabled={!rows.length}><Download className="ic-sm" /> Export CSV ({rows.length})</button>
        </div>
        <div className="pl-filters">
          <label>From <input type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></label>
          <label>To <input type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></label>
          <label>Setup <select value={f.setup} onChange={e => setF({ ...f, setup: e.target.value })}><option value="">All</option>{setups.map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Instrument <select value={f.instrument} onChange={e => setF({ ...f, instrument: e.target.value })}><option value="">All</option>{instruments.map(x => <option key={x}>{x}</option>)}</select></label>
        </div>
        <div className="pl-table-wrap">
          <table className="pl-table">
            <thead><tr><th>Started</th><th>Ended</th><th className="r">Active</th><th className="r">Idle</th><th className="r">Paused</th><th>Setup</th><th>TF</th><th>Days tested</th><th className="r">Trades</th><th /></tr></thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.id}>
                  <td className="nowrap">{localTime(r.started_at)}{r.edited && <span className="pl-edited" title="Edited by hand">edited</span>}</td>
                  <td className="nowrap">{r.ended_at ? localTime(r.ended_at) : <span className="pl-live">{r.status}</span>}</td>
                  <td className="r strong">{fmtDuration(r.active_sec)}</td>
                  <td className="r">{fmtDuration(r.idle_sec)}</td>
                  <td className="r">{fmtDuration(r.pause_sec)}</td>
                  <td>{r.setup_tag || ''}</td>
                  <td>{r.timeframe || ''}</td>
                  <td className="nowrap">{r.hist_from ? (r.hist_from === r.hist_to ? r.hist_from : `${r.hist_from} → ${r.hist_to}`) : ''}</td>
                  <td className="r">{r.trades_logged}</td>
                  <td className="nowrap">
                    <button className="pl-icon" onClick={() => setEdit(r)} aria-label="Edit session" title="Edit"><Pencil className="ic-sm" /></button>
                    <button className="pl-icon" onClick={() => del(r)} aria-label="Delete session" title="Delete"><Trash2 className="ic-sm" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="pl-pager">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Prev</button>
            <span>Page {page + 1} of {pages}</span>
            <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>Next</button>
          </div>
        )}
      </section>

      {edit && <EditSession row={edit} token={token} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setReload(r => r + 1); }} />}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="pl-kpi"><div className="pl-kpi-label">{label}</div><div className="pl-kpi-value">{value}</div>{sub && <div className="pl-kpi-sub">{sub}</div>}</div>;
}

/** datetime-local value in the browser's zone <-> ISO */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function EditSession({ row, token, onClose, onSaved }: { row: SessionRow; token: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    started_at: toLocalInput(row.started_at), ended_at: toLocalInput(row.ended_at),
    active: String(Math.round(row.active_sec / 60)), idle: String(Math.round(row.idle_sec / 60)), pause: String(Math.round(row.pause_sec / 60)),
    setup_tag: row.setup_tag || '', timeframe: row.timeframe || '', hist_from: row.hist_from || '', hist_to: row.hist_to || '', note: row.note || '',
  });
  const [err, setErr] = useState('');
  const save = async () => {
    const mins = (x: string) => { const n = Number(x); return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : NaN; };
    const body: Record<string, unknown> = {
      started_at: v.started_at ? new Date(v.started_at).toISOString() : undefined,
      ended_at: v.ended_at ? new Date(v.ended_at).toISOString() : undefined,
      active_sec: mins(v.active), idle_sec: mins(v.idle), pause_sec: mins(v.pause),
      setup_tag: v.setup_tag, timeframe: v.timeframe || undefined, hist_from: v.hist_from || undefined, hist_to: v.hist_to || undefined, note: v.note,
    };
    if ([body.active_sec, body.idle_sec, body.pause_sec].some(x => Number.isNaN(x))) { setErr('Minutes must be numbers, 0 or more.'); return; }
    try { await axios.patch(`/api/bt-sessions/${row.id}`, body, { headers: { Authorization: `Bearer ${token}` } }); onSaved(); }
    catch (e: any) { setErr(e?.response?.data?.error || 'Could not save.'); }
  };
  const field = (k: keyof typeof v, label: string, type = 'text') => (
    <label className="pl-field">{label}<input type={type} value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })} /></label>
  );
  return (
    <div className="pl-modal-bg" onClick={onClose}>
      <div className="pl-modal" role="dialog" aria-label="Edit session" onClick={e => e.stopPropagation()}>
        <div className="pl-modal-head"><h3>Edit session</h3><button className="pl-icon" onClick={onClose} aria-label="Close"><X className="ic-sm" /></button></div>
        <p className="pl-dim">Times are in your local time zone. Edited sessions are marked “edited”.</p>
        <div className="pl-form">
          {field('started_at', 'Started', 'datetime-local')}
          {field('ended_at', 'Ended', 'datetime-local')}
          {field('active', 'Active minutes', 'number')}
          {field('idle', 'Idle minutes', 'number')}
          {field('pause', 'Paused minutes', 'number')}
          {field('setup_tag', 'Setup')}
          {field('timeframe', 'Timeframe')}
          {field('hist_from', 'Tested from', 'date')}
          {field('hist_to', 'Tested to', 'date')}
          {field('note', 'Note')}
        </div>
        {err && <p className="pl-err">{err}</p>}
        <div className="pl-modal-foot"><button className="pl-btn" onClick={onClose}>Cancel</button><button className="pl-btn primary" onClick={save}>Save</button></div>
      </div>
    </div>
  );
}
