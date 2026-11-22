// Market Memory, part 2: candle odds in a time window, news reaction, sessions & calendar.
// Server: src/patterns/marketMemory.ts (candleOdds), news.ts, sessions.ts.
import { useEffect, useState } from 'react';
import axios from 'axios';
import { Search, AlertTriangle } from 'lucide-react';
import { openReplayDay } from '../utils/chartLink';
import { DateRange, rangeParams, Explain, EventCharts, CombinePanel } from './MemoryKit';

/** 9:30-style New York time on a date -> UTC ms. */
function nyMs(date: string, hm: string) {
  const [h, m] = hm.split(':').map(Number);
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, m);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).map(x => [x.type, x.value]));
  const off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - guess;
  return guess - off;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number | null | undefined, d = 1) => (x == null || !isFinite(x) ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ------------------------------------------------------------------ candle odds in a window
export function Odds({ auth, range }: { auth: any; range: DateRange }) {
  const [f, setF] = useState({ tf: 5, from: '9:30', to: '10:30' });
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<string | null>(null);
  const run = () => {
    setBusy(true); setErr(''); setType(null);
    axios.get('/api/patterns/memory/odds', { ...auth, params: { ...f, ...rangeParams(range) } }).then(x => setR(x.data)).catch(e => { setR(null); setErr(e.response?.data?.error || 'Failed'); }).finally(() => setBusy(false));
  };
  useEffect(() => { run(); }, [auth, range.dateFrom, range.dateTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const stable = (a: number, b: number) => Math.abs(a - b) <= 0.08;
  const cell = (t: any, k: string) => (
    <td key={k} title={`older years ${pct(t.older[k])}, newer ${pct(t.newer[k])}`}>
      <b>{pct(t.all[k])}</b> <span className={stable(t.older[k], t.newer[k]) ? 'bl-up' : 'bl-dim'} style={{ fontSize: 10.5 }}>{pct(t.older[k])}→{pct(t.newer[k])}</span>
    </td>
  );
  return (
    <div className="bl-card">
      <Explain id="odds" title="Candle odds" what="For a time window you choose (for example 9:30–10:30 ET), counts on how many days each candle type showed up at least once, twice, three times, or two / three in a row."
        read={['Big number = share of days. Small "older→newer" = the same share in older and newer days; green when they match (a stable habit).', 'Click a candle type to list every day it happened, see each day as 1m / 3m / 5m charts (the candles are boxed in yellow), and a merged summary of all those days.', 'It says how OFTEN a candle forms, not whether it predicts anything (that is “Candles by time”).']}
        filters={[['Candle', 'timeframe of the candles counted'], ['From / To (ET)', 'the time window inside 9:30–16:00 New York time']]} />
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
              <tr key={t.key} className={`mk-row${type === t.key ? ' sel' : ''}`} onClick={() => setType(type === t.key ? null : t.key)} title="Click: list the days, see the charts">
                <td style={{ textAlign: 'left' }}><span className="mm-link">{t.name}</span></td><td>{t.all.avgCount.toFixed(1)}</td>
                {['atLeast1', 'atLeast2', 'atLeast3', 'twoInARow', 'threeInARow'].map(k => cell(t, k))}
              </tr>))}</tbody>
          </table>
        </div>
        <p className="pf-note"><AlertTriangle size={14} style={{ flexShrink: 0 }} /><span>{r.note} To see what happens <i>after</i> a candle, use “Candles by time”. The data covers 9:30–16:00 ET only, so a 9:00 start is not possible yet.</span></p>
        {type && <OddsDays auth={auth} range={range} f={f} type={type} />}
      </>}
    </div>
  );
}

function OddsDays({ auth, range, f, type }: { auth: any; range: DateRange; f: { tf: number; from: string; to: string }; type: string }) {
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState('');
  const [day, setDay] = useState<any>(null);
  useEffect(() => {
    setR(null); setErr(''); setDay(null);
    axios.get('/api/patterns/memory/odds/days', { ...auth, params: { ...f, type, ...rangeParams(range) } }).then(x => setR(x.data)).catch(e => setErr(e.response?.data?.error || 'Failed'));
  }, [type, f.tf, f.from, f.to, range.dateFrom, range.dateTo]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <p className="bl-bad">{err}</p>;
  if (!r) return <p className="bl-dim">Listing the days…</p>;
  const m = r.merge;
  const winStart = (d: string) => nyMs(d, f.from);
  const winMin = (() => { const [a, b] = [f.from, f.to].map(x => { const [h, mm] = x.split(':').map(Number); return h * 60 + mm; }); return b - a; })();
  return (
    <div className="mk-sub">
      <div className="bl-head"><b>{r.name}</b> <span className="bl-dim">{r.tf}m candles, {r.window} ET, {r.from} → {r.to}</span></div>
      <div className="bl-tiles">
        <div className="bl-tile"><div className="bl-tile-label">Days with it</div><div className="bl-tile-v">{m.daysWith} of {r.daysTested}</div><div className="bl-dim" style={{ fontSize: 11 }}>{m.occurrences} candles in total</div></div>
        <div className="bl-tile"><div className="bl-tile-label">Next 3 candles went the candle's way</div><div className="bl-tile-v">{pct(m.wentCandleWay)}</div><div className="bl-dim" style={{ fontSize: 11 }}>50% = coin flip</div></div>
        <div className="bl-tile"><div className="bl-tile-label">Next 3 candles: up / avg</div><div className="bl-tile-v">{pct(m.next3Up)} · {pts(m.next3Avg)} pts</div></div>
        <div className="bl-tile"><div className="bl-tile-label">Volume of that candle</div><div className="bl-tile-v">{m.volX}×</div><div className="bl-dim" style={{ fontSize: 11 }}>vs that day's normal {r.tf}m candle</div></div>
      </div>
      <div className="mk-careful"><b>Forms most at:</b>{[...m.bySlot].sort((a: any, b: any) => b.n - a.n).slice(0, 8).map((x: any) => <span key={x.time}>{x.time} · {x.n}×</span>)}</div>
      <div className="pf-scroll" style={{ maxHeight: 300, marginTop: 6 }}>
        <table className="pf-grid mm-table"><thead><tr><th>Day</th><th>At (ET)</th><th>Next 3 candles</th><th></th></tr></thead>
          <tbody>{r.days.map((d: any) => (
            <tr key={d.date} className={`mk-row${day?.date === d.date ? ' sel' : ''}`} onClick={() => setDay(d)}>
              <td>{d.date} <span className="bl-dim">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][d.wd]}</span></td><td>{d.times.join(', ')}</td>
              <td>{d.next3.map((x: number) => pts(x)).join(', ')}</td><td><span className="mm-link">Charts</span></td>
            </tr>))}</tbody></table>
      </div>
      {day && <EventCharts auth={auth} anchor={winStart(day.date)} title={`${r.name} · ${r.window} ET`} sub={`${day.times.length}× in the window`}
        highlights={{ tf: r.tf, times: day.times.map((t: string) => nyMs(day.date, t)) }} after={Math.max(15, winMin + 15)} onClose={() => setDay(null)} what="start" />}
    </div>
  );
}

// ------------------------------------------------------------------ news reaction
export function News({ auth, range }: { auth: any; range: DateRange }) {
  const [view, setView] = useState<'explore' | 'study'>('explore');
  return (
    <div className="bl-card">
      <Explain id="news" title="News reaction" what="Lists every high-impact US news release in your date range (from the calendar you imported). Click one to see NQ from 5 minutes before to 60 minutes after as 1m, 3m and 5m candles, with Price action, ICT or SMC read-outs, and save it as an image. “Merge all” combines every listed release into one summary."
        read={['Merge all → “Be careful” = minutes where candles were 2×+ their normal size or volume 3×+: the dangerous part of the release.', '“Did the first candle’s direction last?” 50% = coin flip; 60%+ moves tend to continue; 40%− they tend to reverse.', 'Repeated first 3 one-minute candles = the most common opening sequences and what happened next.', 'Concepts table = how often each ICT / SMC / price-action event happened across all the releases.']}
        filters={[['Dates', 'the date range at the top'], ['Search', 'only releases whose name contains the text, e.g. CPI, Non-Farm, FOMC, PPI, Retail'], ['Impact', 'high only, or high + medium']]}
        example="Search “CPI”, Last 12 months, Merge all: shows when CPI candles are biggest, whether the first move held, and how often the pre-news range was swept first." />
      <div className="pf-tabs" style={{ marginTop: 6 }}>
        <button className={view === 'explore' ? 'on' : ''} onClick={() => setView('explore')}>Every release (charts + merge)</button>
        <button className={view === 'study' ? 'on' : ''} onClick={() => setView('study')}>CPI / jobs / FOMC follow-or-fade test</button>
      </div>
      {view === 'explore' ? <NewsExplorer auth={auth} range={range} /> : <NewsStudy auth={auth} range={range} />}
    </div>
  );
}

function NewsExplorer({ auth, range }: { auth: any; range: DateRange }) {
  const [q, setQ] = useState('');
  const [impact, setImpact] = useState('high');
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<any>(null);
  const [comb, setComb] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const params = () => ({ ...rangeParams(range), q: q.trim() || undefined, impact });
  const load = () => {
    setErr(''); setComb(null); setSel(null);
    axios.get('/api/patterns/memory/news/list', { ...auth, params: params() }).then(x => setList(x.data)).catch(e => setErr(e.response?.data?.error || 'Failed'));
  };
  useEffect(() => { load(); }, [range.dateFrom, range.dateTo, impact]); // eslint-disable-line react-hooks/exhaustive-deps
  const merge = () => {
    setBusy(true); setErr('');
    axios.get('/api/patterns/memory/news/combine', { ...auth, params: params() }).then(x => setComb(x.data)).catch(e => setErr(e.response?.data?.error || 'Merge failed')).finally(() => setBusy(false));
  };
  return (
    <div>
      <div className="bl-rules" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="bl-field">Search<input value={q} placeholder="CPI, Non-Farm, FOMC…" onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} style={{ width: 170 }} /></label>
        <label className="bl-field">Impact<select value={impact} onChange={e => setImpact(e.target.value)}><option value="high">High only</option><option value="medium">High + medium</option></select></label>
        <button className="pf-run" onClick={load}><Search size={14} /> List releases</button>
        <button className="pf-run" disabled={busy || !list?.items?.length} onClick={merge}>{busy ? 'Merging…' : `Merge all ${list?.items?.length ?? ''}`}</button>
      </div>
      {err && <p className="bl-bad">{err}</p>}
      {list && !list.items.length && <p className="bl-dim">No releases in this range. The calendar comes from your ForexFactory import (News → Economic calendar); NQ candles cover {list.barsFrom} → {list.barsTo}.</p>}
      {comb && <CombinePanel r={comb} />}
      {list && list.items.length > 0 && <>
        <p className="bl-dim">{list.items.length} release times{list.truncated ? ' (newest 400 shown: narrow the dates)' : ''}. Releases at the same minute are one row. Click a row for the charts.</p>
        <div className="pf-scroll" style={{ maxHeight: 340 }}>
          <table className="pf-grid mm-table">
            <thead><tr><th>Day</th><th>ET</th><th style={{ textAlign: 'left' }}>Release</th><th>Actual</th><th>Forecast</th><th>Previous</th></tr></thead>
            <tbody>{list.items.map((it: any) => (
              <tr key={it.t} className={`mk-row${sel?.t === it.t ? ' sel' : ''}`} onClick={() => setSel(it)}>
                <td>{it.date} <span className="bl-dim">{DOW[new Date(`${it.date}T12:00:00Z`).getUTCDay()]}</span></td><td>{it.timeEt}</td>
                <td style={{ textAlign: 'left' }}>{it.titles.join(' · ')}</td><td>{it.actual ?? '—'}</td><td>{it.forecast ?? '—'}</td><td>{it.previous ?? '—'}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </>}
      {sel && <EventCharts auth={auth} anchor={sel.t} title={sel.titles[0] + (sel.titles.length > 1 ? ` + ${sel.titles.length - 1} more` : '')}
        sub={sel.actual ? `actual ${sel.actual} vs forecast ${sel.forecast ?? '—'}` : undefined} onClose={() => setSel(null)} />}
    </div>
  );
}

function NewsStudy({ auth, range }: { auth: any; range: DateRange }) {
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setR(null); setErr(''); axios.get('/api/patterns/memory/news', { ...auth, params: rangeParams(range) }).then(x => setR(x.data)).catch(e => setErr(e.response?.data?.error || 'Failed to load')); }, [auth, range.dateFrom, range.dateTo]);
  if (err) return <p className="bl-bad">{err}</p>;
  if (!r) return <p className="bl-dim">Loading every release (first time ~5 s)…</p>;
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
    <div>
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
export function Sessions({ auth, range }: { auth: any; range: DateRange }) {
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<any>(null);
  useEffect(() => { setR(null); setErr(''); setSel(null); axios.get('/api/patterns/memory/sessions', { ...auth, params: rangeParams(range) }).then(x => setR(x.data)).catch(e => setErr(e.response?.data?.error || 'Failed to load')); }, [auth, range.dateFrom, range.dateTo]);
  const help = <Explain id="sessions" title="Sessions & calendar" what="Splits every trading day into sessions (Asia, London, pre-market, NY open hour, NY morning, lunch, NY afternoon) and shows, per weekday, how often each session closed up and its average move; then by month and week of the month, how often the New York session trended."
    read={['Each cell: % of those sessions that closed up, then the average move in points. Green = mostly up, red = mostly down.', 'An outlined cell leaned the same way in older AND newer days strongly enough to count. Everything else is a mild tendency.', 'Click a cell for its numbers. Month × week table: % of New York sessions that were trend days (closed far from the open).']}
    filters={[['Dates', 'the range at the top; at least ~50 sessions are needed']]} />;
  if (err) return <div className="bl-card">{help}<p className="bl-bad">{err}</p></div>;
  if (!r) return <div className="bl-card">{help}<p className="bl-dim">Summing every session (~5 s)…</p></div>;
  const bg = (up: number) => { const a = Math.min(1, Math.abs(up - 0.5) / 0.15); return up >= 0.5 ? `rgba(8,153,129,${0.08 + 0.5 * a})` : `rgba(242,54,69,${0.08 + 0.5 * a})`; };
  return (
    <div className="bl-card">
      {help}
      {r.tested === 0 ? <div className="pf-verdict no">This date range is too short to test whether anything repeats (each cell needs 30+ sessions in both the older and the newer half). The % below are plain counts for these dates.</div> :
      <div className={`pf-verdict ${r.repeating ? 'ok' : 'no'}`}>
        {r.repeating} of {r.tested} weekday × session cells lean the same way in BOTH older and newer years strongly enough to count (luck alone: ~{r.luckExpected}).
        {' '}{r.repeating ? 'Outlined cells are the ones that repeat.' : 'So no weekday has a session that reliably goes one way: the % below are mild tendencies, not edges.'}
      </div>}
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
