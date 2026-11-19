// Market Memory, part 2: candle odds in a time window, news reaction, sessions & calendar.
// Server: src/patterns/marketMemory.ts (candleOdds), news.ts, sessions.ts.
import { useEffect, useState } from 'react';
import axios from 'axios';
import { Search, AlertTriangle } from 'lucide-react';
import { openReplayDay } from '../utils/chartLink';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number | null | undefined, d = 1) => (x == null || !isFinite(x) ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ------------------------------------------------------------------ candle odds in a window
export function Odds({ auth }: { auth: any }) {
  const [f, setF] = useState({ tf: 5, from: '9:30', to: '10:30' });
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true); setErr('');
    axios.get('/api/patterns/memory/odds', { ...auth, params: f }).then(x => setR(x.data)).catch(e => setErr(e.response?.data?.error || 'Failed')).finally(() => setBusy(false));
  };
  useEffect(() => { run(); }, [auth]); // eslint-disable-line react-hooks/exhaustive-deps
  const stable = (a: number, b: number) => Math.abs(a - b) <= 0.08;
  const cell = (t: any, k: string) => (
    <td key={k} title={`older years ${pct(t.older[k])}, newer ${pct(t.newer[k])}`}>
      <b>{pct(t.all[k])}</b> <span className={stable(t.older[k], t.newer[k]) ? 'bl-up' : 'bl-dim'} style={{ fontSize: 10.5 }}>{pct(t.older[k])}→{pct(t.newer[k])}</span>
    </td>
  );
  return (
    <div className="bl-card">
      <div className="bl-rules">
        <label className="bl-field">Candle<select value={f.tf} onChange={e => setF({ ...f, tf: Number(e.target.value) })}>{[1, 3, 5, 15, 30, 60].map(x => <option key={x} value={x}>{x}m</option>)}</select></label>
        <label className="bl-field">From (ET)<input value={f.from} onChange={e => setF({ ...f, from: e.target.value })} style={{ width: 70 }} /></label>
        <label className="bl-field">To (ET)<input value={f.to} onChange={e => setF({ ...f, to: e.target.value })} style={{ width: 70 }} /></label>
      </div>
      <button className="pf-run" disabled={busy} onClick={run}><Search size={14} /> {busy ? 'Counting…' : 'Count candles'}</button>
      {err && <p className="bl-bad">{err}</p>}
      {r && <>
        <p className="bl-dim">{r.days.toLocaleString()} days ({r.from} → {r.to}), window {r.window} ET = {r.candlesInWindow} candles of {r.tf}m. Each cell: share of days, then <b>older → newer years</b> (green = about the same in both = a stable habit).</p>
        <div className="pf-scroll">
          <table className="pf-grid mm-table mm-odds">
            <thead><tr><th style={{ textAlign: 'left' }}>Candle</th><th>Avg per day</th><th>At least 1</th><th>At least 2</th><th>At least 3</th><th>2 in a row</th><th>3 in a row</th></tr></thead>
            <tbody>{r.types.map((t: any) => (
              <tr key={t.key}>
                <td style={{ textAlign: 'left' }}>{t.name}</td><td>{t.all.avgCount.toFixed(1)}</td>
                {['atLeast1', 'atLeast2', 'atLeast3', 'twoInARow', 'threeInARow'].map(k => cell(t, k))}
              </tr>))}</tbody>
          </table>
        </div>
        <p className="pf-note"><AlertTriangle size={14} style={{ flexShrink: 0 }} /><span>{r.note} To see what happens <i>after</i> a candle, use “Candles by time”. The data covers 9:30–16:00 ET only, so a 9:00 start is not possible yet.</span></p>
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ news reaction
export function News({ auth }: { auth: any }) {
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { axios.get('/api/patterns/memory/news', auth).then(x => setR(x.data)).catch(e => setErr(e.response?.data?.error || 'Failed to load')); }, [auth]);
  if (err) return <div className="bl-card"><p className="bl-bad">{err}</p></div>;
  if (!r) return <div className="bl-card"><p className="bl-dim">Loading every release since 2021 (first time ~5 s)…</p></div>;
  const verdict = (t: any) => {
    if (t.n < 20) return { ok: false, text: `Only ${t.n} releases: too few to judge.` };
    if (t.follow.repeats) return { ok: true, text: `Following the first 5 minutes worked in older AND newer years (t ${t.follow.tOlder} / ${t.follow.tNewer}). Paper-test it.` };
    if (t.fade.repeats) return { ok: true, text: `Fading the first 5 minutes worked in older AND newer years (t ${t.fade.tOlder} / ${t.fade.tNewer}). Paper-test it.` };
    if (Math.sign(t.follow.older) !== Math.sign(t.follow.newer) && Math.abs(t.follow.tOlder) >= 2 && Math.abs(t.follow.tNewer) >= 2)
      return { ok: false, text: `The pattern FLIPPED: following worked in older years (${pts(t.follow.older)} pts per trade) but fading worked in newer years (${pts(t.fade.newer)}). Not a stable edge.` };
    if (Math.sign(t.fade.older) === Math.sign(t.fade.newer) && t.fade.older !== 0) {
      const side = t.fade.older > 0 ? 'fading (going against)' : 'following';
      return { ok: false, text: `Leans toward ${side} the first 5 minutes in BOTH older and newer years, but not strongly enough to prove (t ${t.fade.older > 0 ? t.fade.tOlder : t.follow.tOlder} / ${t.fade.older > 0 ? t.fade.tNewer : t.follow.tNewer}; need 2+ in each). Worth watching, not trading yet.` };
    }
    return { ok: false, text: 'After the first 5 minutes, neither following nor fading repeats: the direction after the release is close to a coin flip.' };
  };
  return (
    <div className="bl-card">
      <p className="bl-dim">{r.sources} {r.from} → {r.to}. Costs {r.costPts} pt per trade. “Follow” = enter at the end of the first 5 minutes in their direction, exit 30 min later; “Fade” = the opposite.</p>
      {r.types.map((t: any) => {
        const v = verdict(t);
        return (
          <div key={t.type} className="mm-news">
            <div className="bl-head"><b>{t.name}</b> <span className="bl-dim">{t.time} ET · {t.n} releases{t.dropped ? ` (${t.dropped} skipped: no volume spike in the data)` : ''}</span></div>
            <div className="bl-tiles">
              <div className="bl-tile"><div className="bl-tile-label">First 5 min: up / down</div><div className="bl-tile-v">{pct(t.firstUp)} / {pct(t.firstDown)}</div></div>
              <div className="bl-tile"><div className="bl-tile-label">Typical first-5-min move</div><div className="bl-tile-v">{t.medianAbsFirst5} pts</div><div className="bl-dim" style={{ fontSize: 11 }}>{t.timesNormal}× a normal day at that time · range {t.avgRange5}</div></div>
              <div className="bl-tile"><div className="bl-tile-label">Kept going (30m / 1h / close)</div><div className="bl-tile-v">{pct(t.keepsGoing.after30)} / {pct(t.keepsGoing.after60)} / {pct(t.keepsGoing.toClose)}</div></div>
              <div className="bl-tile"><div className="bl-tile-label">Follow · Fade (avg pts, after costs)</div><div className="bl-tile-v"><span className={t.follow.avgPts >= 0 ? 'bl-up' : 'bl-down'}>{pts(t.follow.avgPts)}</span> · <span className={t.fade.avgPts >= 0 ? 'bl-up' : 'bl-down'}>{pts(t.fade.avgPts)}</span></div><div className="bl-dim" style={{ fontSize: 11 }}>follow: older {pts(t.follow.older)} / newer {pts(t.follow.newer)}</div></div>
            </div>
            <p className={`pf-verdict ${v.ok ? 'ok' : 'no'}`}>{v.text} The 5 minutes before the release went the same way as the release {pct(t.preSameDir)} of the time.</p>
            <button className="mm-link" onClick={() => setOpen(open === t.type ? null : t.type)}>{open === t.type ? 'Hide' : 'Show'} every release</button>
            {open === t.type && (
              <div className="pf-scroll" style={{ marginTop: 6 }}>
                <table className="pf-grid mm-table">
                  <thead><tr><th>Day</th><th>5 min before</th><th>1st min</th><th>First 5 min</th><th>Range</th><th>Next 30m</th><th>1h</th><th>To 16:00</th><th></th></tr></thead>
                  <tbody>{[...t.events].reverse().map((e: any) => (
                    <tr key={e.date} style={{ opacity: e.dataOk ? 1 : 0.45 }} title={e.dataOk ? '' : `No volume spike (x${e.volSpike}): skipped`}>
                      <td>{e.date} <span className="bl-dim">{DOW[e.wd]}</span></td>
                      <td>{pts(e.pre5)}</td><td>{pts(e.first1)}</td><td className={e.first5 >= 0 ? 'bl-up' : 'bl-down'}>{pts(e.first5)}</td><td>{e.range5.toFixed(0)}</td>
                      <td className={(e.after30 ?? 0) * e.first5 >= 0 ? 'bl-up' : 'bl-down'}>{pts(e.after30)}</td><td>{pts(e.after60)}</td><td>{pts(e.toClose)}</td>
                      <td><button className="mm-link" onClick={() => openReplayDay(e.date)}>Chart</button></td>
                    </tr>))}</tbody>
                </table>
                <p className="bl-dim">Green “Next 30m” = kept going the same way as the first 5 minutes; red = reversed.</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ sessions & calendar
export function Sessions({ auth }: { auth: any }) {
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<any>(null);
  useEffect(() => { axios.get('/api/patterns/memory/sessions', auth).then(x => setR(x.data)).catch(e => setErr(e.response?.data?.error || 'Failed to load')); }, [auth]);
  if (err) return <div className="bl-card"><p className="bl-bad">{err}</p></div>;
  if (!r) return <div className="bl-card"><p className="bl-dim">Summing every session since 2021 (~5 s)…</p></div>;
  const bg = (up: number) => { const a = Math.min(1, Math.abs(up - 0.5) / 0.15); return up >= 0.5 ? `rgba(8,153,129,${0.08 + 0.5 * a})` : `rgba(242,54,69,${0.08 + 0.5 * a})`; };
  return (
    <div className="bl-card">
      <div className={`pf-verdict ${r.repeating ? 'ok' : 'no'}`}>
        {r.repeating} of {r.tested} weekday × session cells lean the same way in BOTH older and newer years strongly enough to count (luck alone: ~{r.luckExpected}).
        {' '}{r.repeating ? 'Outlined cells are the ones that repeat.' : 'So no weekday has a session that reliably goes one way: the % below are mild tendencies, not edges.'}
      </div>
      <p className="bl-dim">{r.from} → {r.to}, split at {r.splitDate}. Each cell: % of sessions that closed up, and the average move in points. Asia starts the evening before (Monday's Asia = Sunday 18:00 ET). Click a cell.</p>
      <div className="pf-scroll">
        <table className="pf-grid mm-table">
          <thead><tr><th></th>{r.sessions.map((s: any) => <th key={s.key}>{s.name}<br /><span className="bl-dim" style={{ fontWeight: 400 }}>{s.time}</span></th>)}</tr></thead>
          <tbody>{r.grid.map((row: any[], wi: number) => (
            <tr key={wi}><td className="pf-slot">{r.weekdays[wi]}</td>
              {row.map((c: any, si: number) => (
                <td key={si} className={`pf-cell ${c.repeats ? 'pass' : ''} ${sel === c ? 'sel' : ''}`} style={{ background: bg(c.up) }} onClick={() => setSel(c)}>
                  <b>{pct(c.up)}</b> <span style={{ fontSize: 10.5 }}>{pts(c.avgPts, 0)}</span>
                </td>))}
            </tr>))}</tbody>
        </table>
      </div>
      {sel && <div className="mm-detail">
        <b>{sel.weekday} · {sel.session}</b><span>{sel.n} sessions</span><span>closed up {pct(sel.up)} (older {pct(sel.upOlder)}, newer {pct(sel.upNewer)})</span>
        <span>avg {pts(sel.avgPts)} pts ({sel.avgPct}%)</span><span>trended {pct(sel.trendShare)} · avg range {sel.avgRange} pts</span>
        <span className={sel.repeats ? 'bl-up' : 'bl-dim'}>{sel.repeats ? 'Repeats in both halves' : `Does not repeat reliably (t ${sel.tOlder} / ${sel.tNewer})`}</span>
      </div>}
      <div className="bl-head" style={{ marginTop: 14 }}><b>Month × week of the month</b> <span className="bl-dim">New York session · % trend days (close far from the open) · all days: {pct(r.baseline.trendDays)} trend, {pct(r.baseline.up)} up</span></div>
      <div className="pf-scroll">
        <table className="pf-grid mm-table">
          <thead><tr><th></th>{[1, 2, 3, 4, 5].map(w => <th key={w}>Week {w}<br /><span className="bl-dim" style={{ fontWeight: 400 }}>days {(w - 1) * 7 + 1}–{w === 5 ? 31 : w * 7}</span></th>)}</tr></thead>
          <tbody>{r.calendar.map((weeks: any[], m: number) => (
            <tr key={m}><td className="pf-slot">{MONTHS[m]}</td>
              {weeks.map((c: any) => (
                <td key={c.week} title={`${c.days} days over ${c.years} years · up ${pct(c.up)} · avg range ${c.avgRange} pts`}
                  style={{ background: c.days ? `rgba(41,98,255,${0.06 + 0.5 * Math.max(0, Math.min(1, (c.trendDays - r.baseline.trendDays + 0.25) / 0.5))})` : 'var(--card)', opacity: c.days >= 15 ? 1 : 0.5 }}>
                  {c.days ? <><b>{pct(c.trendDays)}</b> <span style={{ fontSize: 10.5 }}>up {pct(c.up)}</span></> : '—'}
                </td>))}
            </tr>))}</tbody>
        </table>
      </div>
      <p className="pf-note"><AlertTriangle size={14} style={{ flexShrink: 0 }} /><span>{r.note}</span></p>
    </div>
  );
}
