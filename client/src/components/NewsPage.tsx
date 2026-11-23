// News: one simple page.
//   Brief     : what happened / why / what now / what next in a few lines (AI from the headlines, the crowd's odds and
//               the calendar), plus the crowd's odds (prediction markets) on Fed, inflation, big tech, India, Canada.
//   Upcoming  : only events that move NQ (CPI, jobs, PPI, retail sales, PCE, GDP, Fed decisions, big-tech earnings),
//               dates from the official calendars, with a countdown and what NQ usually does.
//   Headlines : market-moving headlines only (Fed, inflation, tariffs, big tech, big moves); "show all" for the rest.
//   Research  : the old calendar import and the reaction study (owner only).
// Top card: turn on app notifications on this device (Web Push) and choose what to get.
import { ReactNode, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Bell, BellOff, CalendarClock, Newspaper, FlaskConical, Sparkles, RefreshCw, CheckCircle2, Landmark } from 'lucide-react';
import '../styles/Habits.css';
import '../styles/NewsPage.css';

interface Ev { id: string; utc: string; ny_date: string; ny_time: string; title: string; kind: string; impact: 'high' | 'medium'; why: string; nq: { absMed15: number; up15: number } | null; source: string }
interface Hl { title: string; link: string; pub: number; source: string; score: number; tags: string[]; also: number; region?: 'US' | 'IN' | 'CA'; topic?: string }
type Tab = 'brief' | 'economy' | 'upcoming' | 'headlines' | 'research';
interface Brief {
  headline: string; happened: { text: string; src: number[] }[]; why: string[]; now: string[]; next: string[];
  regions: { US?: string; India?: string; Canada?: string }; impact: { NQ?: string; Nifty?: string; CAD?: string }; watch: string[];
  sources: { i: number; title: string; link: string | null; source: string; region: string; ts: string }[];
  odds: { title: string; url: string; line: string }[]; generated_at: string; engine: string; note?: string;
}
interface Odds { id: string; title: string; url: string; region: string; ends: string | null; volume24h: number; outcomes: { label: string; pct: number; change1d: number | null }[] }
const FLAG: Record<string, string> = { US: '🇺🇸', IN: '🇮🇳', CA: '🇨🇦', World: '🌍', USA: '🇺🇸', India: '🇮🇳', Canada: '🇨🇦' };

const ago = (ms: number) => { const m = Math.round((Date.now() - ms) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const until = (ms: number, now: number) => {
  const s = Math.round((ms - now) / 1000);
  if (s <= 0) return s > -3600 ? 'now' : 'done';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `in ${d}d ${h}h` : h ? `in ${h}h ${m}m` : `in ${m} min`;
};
const b64ToBytes = (b64: string) => { const p = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
const deviceLabel = () => { const u = navigator.userAgent; return /iPhone|iPad/.test(u) ? 'iPhone / iPad' : /Android/.test(u) ? 'Android' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : 'Browser'; };

function Notifications({ token }: { token: string }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIos = /iPhone|iPad/.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  const [s, setS] = useState<any>(null);
  const [here, setHere] = useState<boolean | null>(null);   // this device subscribed?
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    axios.get('/api/alerts/settings', auth).then(r => setS(r.data.settings)).catch(() => setS(null));
    if (supported) navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(x => setHere(!!x)).catch(() => setHere(false));
    else setHere(false);
  }, [token]);
  const save = async (patch: any) => {
    const next = { ...s, ...patch }; setS(next); setMsg(null);
    try { setS((await axios.put('/api/alerts/settings', { ...next, token: '' }, auth)).data.settings); } catch (e: any) { setMsg({ ok: false, t: e?.response?.data?.error || 'Could not save.' }); }
  };
  const turnOn = async () => {
    setBusy(true); setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in the browser / phone settings, then try again.');
      const reg = await navigator.serviceWorker.ready;
      const key = (await axios.get('/api/alerts/push/key', auth)).data.key;
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      const r = await axios.post('/api/alerts/push/subscribe', { subscription: sub.toJSON(), label: deviceLabel() }, auth);
      setS(r.data.settings); setHere(true);
      await axios.post('/api/alerts/push/test', {}, auth).catch(() => null);
      setMsg({ ok: true, t: 'On. A test notification is on its way.' });
    } catch (e: any) { setMsg({ ok: false, t: e?.response?.data?.error || e?.message || 'Could not turn notifications on.' }); }
    setBusy(false);
  };
  const turnOff = async () => {
    setBusy(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await axios.post('/api/alerts/push/unsubscribe', { endpoint: sub.endpoint }, auth); await sub.unsubscribe(); }
      setHere(false); setMsg({ ok: true, t: 'Off on this device.' });
    } catch (e: any) { setMsg({ ok: false, t: e?.message || 'Could not turn off.' }); }
    setBusy(false);
  };
  const test = async () => {
    setMsg(null);
    try { await axios.post('/api/alerts/push/test', {}, auth); setMsg({ ok: true, t: 'Test sent.' }); } catch (e: any) { setMsg({ ok: false, t: e?.response?.data?.error || 'Test failed.' }); }
  };
  if (!s) return null;
  const on = here && s.push_enabled;
  const chk = (k: string, label: string) => (
    <label className="np-chk"><input type="checkbox" checked={!!s[k]} onChange={e => save({ [k]: e.target.checked })} /> {label}</label>
  );
  return (
    <div className={`hb-card np-notify${on ? ' on' : ''}`}>
      <div className="hb-between">
        <div className="np-notify-h">{on ? <Bell size={18} /> : <BellOff size={18} />}
          <div><b>{on ? 'Notifications on for this device' : 'Get notified on this device'}</b>
            <div className="hb-dim">Big releases {s.lead_min}–{Math.max(0, s.lead_min - 10)} min before, breaking market news, and fast NQ moves. Checked every 10 min on weekdays, about 3:00 to 17:00 BC.</div></div>
        </div>
        <div className="hb-row">
          {on ? (<><button className="hb-btn" onClick={test}>Test</button><button className="hb-btn" onClick={() => setOpen(!open)}>Choose</button><button className="hb-btn" disabled={busy} onClick={turnOff}>Turn off</button></>)
            : <button className="hb-btn primary" disabled={busy || !supported || (isIos && !standalone)} onClick={turnOn}>Turn on</button>}
        </div>
      </div>
      {!supported && <div className="hb-msg err">This browser can't show app notifications. Use Chrome / Edge / Safari 16.4+.</div>}
      {supported && isIos && !standalone && !on && <div className="hb-msg">iPhone: tap Share → <b>Add to Home Screen</b>, open the journal from that icon, then tap Turn on (Apple only allows notifications for home-screen apps).</div>}
      {on && open && (
        <div className="np-choose">
          {chk('news', 'Big scheduled releases (CPI, jobs, Fed…)')}
          <label className="np-chk">Warn me <select value={s.lead_min} onChange={e => save({ lead_min: Number(e.target.value) })}>{[10, 15, 30, 60].map(m => <option key={m} value={m}>{m} min</option>)}</select> before <span className="hb-dim">(arrives {s.lead_min}–{Math.max(0, s.lead_min - 10)} min before: checks run every 10 min)</span></label>
          {chk('headlines', 'Breaking market-moving headlines')}
          {chk('bigmove', 'NQ moves fast')}
          <label className="np-chk">Fast = <select value={s.bigmove_pct} onChange={e => save({ bigmove_pct: Number(e.target.value) })}>{[0.4, 0.6, 0.8, 1, 1.5].map(p => <option key={p} value={p}>{p}%</option>)}</select> in 15 min</label>
          {chk('brief', 'Morning brief (7:30 New York)')}
          {chk('rules', 'Rule breaks')}
          {chk('prop', 'Prop limit warnings')}
        </div>
      )}
      {msg && <div className={`hb-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.t}</div>}
    </div>
  );
}

function Upcoming({ token }: { token: string }) {
  const [d, setD] = useState<{ events: Ev[]; errors: string[] } | null>(null);
  const [err, setErr] = useState('');
  const [all, setAll] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    axios.get('/api/news/upcoming?days=21', { headers: { Authorization: `Bearer ${token}` } }).then(r => setD(r.data)).catch(e => setErr(e?.response?.data?.error || 'Could not load the calendar.'));
  }, [token]);
  const days = useMemo(() => {
    const list = (d?.events ?? []).filter(e => (all || e.impact === 'high') && Date.parse(e.utc) > now - 3 * 3600000);
    const by = new Map<string, Ev[]>();
    for (const e of list) { const k = new Date(e.utc).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); by.set(k, [...(by.get(k) ?? []), e]); }
    return [...by.entries()];
  }, [d, all, now]);
  if (err) return <div className="hb-card hb-msg err">{err}</div>;
  if (!d) return <div className="hb-card hb-dim">Loading…</div>;
  const nextId = (d.events.filter(e => (all || e.impact === 'high')).find(e => Date.parse(e.utc) > now))?.id;
  const today = new Date(now).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  return (
    <div className="hb-card">
      <div className="hb-between"><div className="hb-dim">Your time. Only things that move NQ.</div>
        <label className="np-chk"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> include medium (GDP, JOLTS, claims, smaller earnings)</label></div>
      {!days.length && <div className="hb-dim" style={{ marginTop: 10 }}>Nothing big in the next 3 weeks.</div>}
      {days.map(([day, list]) => (
        <div key={day} className="np-day">
          <div className="np-day-h">{day === today ? 'Today' : day}</div>
          {list.map(e => {
            const ms = Date.parse(e.utc);
            return (
              <div key={e.id} className={`np-ev${e.id === nextId ? ' next' : ''}${ms < now ? ' past' : ''}`}>
                <div className="np-time">{new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}<span>{until(ms, now)}</span></div>
                <div className="np-what">
                  <div><span className={`np-imp ${e.impact}`} />{e.title}{e.kind === 'earnings' && <span className="hb-dim"> · time approx.</span>}</div>
                  <div className="hb-dim">{e.why}{e.nq ? ` NQ usually moves ~${e.nq.absMed15.toFixed(0)} pts in 15 min.` : ''}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <div className="hb-dim" style={{ marginTop: 10 }}>Dates: FRED release calendar, federalreserve.gov, Nasdaq earnings calendar.{d.errors.length ? ` Some sources did not answer: ${d.errors.join('; ')}.` : ''}</div>
    </div>
  );
}

function BriefCard({ b, reviewed, onRefresh, busy }: { b: Brief; reviewed?: string[]; onRefresh?: () => void; busy?: boolean }) {
  const [showSrc, setShowSrc] = useState(false);
  const srcOf = (n: number) => b.sources.find(x => x.i === n);
  const Sec = ({ title, items }: { title: string; items: string[] }) => (items.length ? <div className="np-bsec"><h4>{title}</h4><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null);
  return (
      <div className={`hb-card np-brief${reviewed ? ' reviewed' : ''}`}>
        <div className="hb-between">
          <div className="np-bhead">{reviewed ? <CheckCircle2 size={16} /> : <Sparkles size={16} />} {b.headline}</div>
          {onRefresh && <button className="hb-btn" disabled={busy} onClick={onRefresh} title="Make a fresh brief (at most every 5 minutes)"><RefreshCw size={13} /> {busy ? 'Updating…' : 'Refresh'}</button>}
        </div>
        {reviewed && <div className="np-revtag">Checked by Claude · {new Date(b.generated_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>}
        <div className="np-bgrid">
          <div className="np-bsec"><h4>What happened</h4><ul>{b.happened.map((h, i) => (
            <li key={i}>{h.text}{h.src.map(n => { const s = srcOf(n); return s ? <a key={n} className="np-cite" href={s.link ?? undefined} target="_blank" rel="noopener noreferrer" title={`${s.source}: ${s.title}`}>{FLAG[s.region] ?? ''}{n}</a> : null; })}</li>
          ))}</ul></div>
          <Sec title="Why" items={b.why} />
          <Sec title="What's happening now" items={b.now} />
          <Sec title="What could happen next" items={b.next} />
        </div>
        {(b.impact.NQ || b.impact.Nifty || b.impact.CAD) && (
          <div className="np-impact">
            {(['NQ', 'Nifty', 'CAD'] as const).map(k => b.impact[k] ? <div key={k}><b>{k}</b> {b.impact[k]}</div> : null)}
          </div>
        )}
        {(b.regions.US || b.regions.India || b.regions.Canada) && (
          <div className="np-regions">{(['US', 'India', 'Canada'] as const).map(k => b.regions[k] ? <div key={k}><span>{FLAG[k]}</span> {b.regions[k]}</div> : null)}</div>
        )}
        {b.watch.length > 0 && <div className="np-watch"><b>Watch:</b> {b.watch.join(' · ')}</div>}
        <div className="hb-dim np-bfoot">
          {new Date(b.generated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {reviewed ? 'checked and corrected by Claude against the web' : b.engine === 'basic' ? 'plain summary' : `AI summary (${b.engine})`} from {b.sources.length} sources{reviewed ? '' : " and the crowd's odds"}. Not advice: check the facts before you act.
          {b.note ? <> · {b.note}</> : null}
          {' '}<button className="np-link" onClick={() => setShowSrc(!showSrc)}>{showSrc ? 'Hide' : 'Show'} the headlines used</button>
        </div>
        {reviewed && reviewed.length > 0 && <div className="np-corr"><b>What I corrected or added:</b><ul>{reviewed.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
        {showSrc && <ol className="np-srcs">{b.sources.map(s => <li key={s.i} value={s.i}>{FLAG[s.region] ?? ''} {s.link ? <a href={s.link} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title} <span className="hb-dim">· {s.source} · {ago(Date.parse(s.ts))}</span></li>)}</ol>}
      </div>
  );
}

interface EconCountry { headline: string; happened: { text: string; src: number[] }[]; why: string[]; now: string[]; next: string[]; people: string }
interface EconBrief { countries: { US?: EconCountry; India?: EconCountry; Canada?: EconCountry }; sources: Brief['sources']; generated_at: string; engine: string; note?: string; corrections?: string[] }

function EconomyTab({ token }: { token: string }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [d, setD] = useState<{ brief: EconBrief | null; reviewed: EconBrief | null; items: Hl[] } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [showSrc, setShowSrc] = useState(false);
  const load = (refresh = false) => {
    setBusy(true);
    axios.get('/api/news/economy', { ...auth, params: { refresh: refresh ? 1 : undefined } }).then(r => setD(r.data)).catch(() => setD(null)).finally(() => setBusy(false));
  };
  useEffect(() => { load(); const t = window.setInterval(() => load(), 20 * 60000); return () => window.clearInterval(t); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (d === undefined) return <div className="hb-card hb-dim">Reading the economy news… (first time can take 20 seconds)</div>;
  if (!d || !d.brief) return <div className="hb-card hb-dim">No economy summary yet. <button className="hb-btn" onClick={() => load(true)}>Make one now</button></div>;
  const b = d.reviewed ?? d.brief;
  const reviewed = !!d.reviewed;
  const srcOf = (n: number) => b.sources.find(x => x.i === n);
  const Sec = ({ title, items }: { title: string; items: string[] }) => (items.length ? <div className="np-bsec"><h4>{title}</h4><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null);
  const cols = [['US', 'USA', 'US'], ['India', 'India', 'IN'], ['Canada', 'Canada', 'CA']] as const;
  return (
    <>
      <div className="hb-card np-brief np-econ-head">
        <div className="hb-between">
          <div className="np-bhead">{reviewed ? <CheckCircle2 size={16} /> : <Landmark size={16} />} The economy, not the markets: jobs, prices, growth, budgets, trade, housing</div>
          <button className="hb-btn" disabled={busy} onClick={() => load(true)} title="Make a fresh summary (at most every 10 minutes)"><RefreshCw size={13} /> {busy ? 'Updating…' : 'Refresh'}</button>
        </div>
        {reviewed && <div className="np-revtag">Checked by Claude · {new Date(b.generated_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>}
        {reviewed && (b.corrections?.length ?? 0) > 0 && <div className="np-corr"><b>What I corrected or added:</b><ul>{b.corrections!.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
      </div>
      <div className="np-econ">
        {cols.map(([k, name, r]) => {
          const c = b.countries[k];
          const more = d.items.filter(h => h.region === r).slice(0, 6);
          return (
            <div key={k} className="hb-card np-econ-col">
              <div className="np-econ-flag">{FLAG[r]} {name}</div>
              {!c ? <div className="hb-dim">No big economy news in the last 2 days.</div> : (
                <>
                  <div className="np-econ-h">{c.headline}</div>
                  <div className="np-bsec"><h4>What happened</h4><ul>{c.happened.map((h, i) => (
                    <li key={i}>{h.text}{h.src.map(n => { const sx = srcOf(n); return sx ? <a key={n} className="np-cite" href={sx.link ?? undefined} target="_blank" rel="noopener noreferrer" title={`${sx.source}: ${sx.title}`}>{n}</a> : null; })}</li>
                  ))}</ul></div>
                  <Sec title="Why" items={c.why} />
                  <Sec title="Now" items={c.now} />
                  <Sec title="What's likely next" items={c.next} />
                  {c.people && <div className="np-econ-people"><b>For people and businesses:</b> {c.people}</div>}
                </>
              )}
              {more.length > 0 && (
                <details className="np-econ-more"><summary>More {name} economy news ({more.length})</summary>
                  <ul>{more.map(h => <li key={h.title}>{h.link ? <a href={h.link} target="_blank" rel="noopener noreferrer">{h.title}</a> : h.title} <span className="hb-dim">· {h.source} · {ago(h.pub)}</span></li>)}</ul>
                </details>
              )}
            </div>
          );
        })}
      </div>
      <div className="hb-dim np-bfoot">
        {new Date(b.generated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {reviewed ? 'checked and corrected by Claude' : b.engine === 'basic' ? 'plain summary' : `AI summary (${b.engine})`} from {b.sources.length} economy headlines, refreshed every 2 hours.
        {!reviewed && b.note ? <> {b.note}</> : null}
        {' '}<button className="np-link" onClick={() => setShowSrc(!showSrc)}>{showSrc ? 'Hide' : 'Show'} the headlines used</button>
      </div>
      {showSrc && <ol className="np-srcs hb-card">{b.sources.map(sx => <li key={sx.i} value={sx.i}>{FLAG[sx.region] ?? ''} {sx.link ? <a href={sx.link} target="_blank" rel="noopener noreferrer">{sx.title}</a> : sx.title} <span className="hb-dim">· {sx.source} · {ago(Date.parse(sx.ts))}</span></li>)}</ol>}
    </>
  );
}

function BriefTab({ token }: { token: string }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [b, setB] = useState<Brief | null | undefined>(undefined);
  const [rev, setRev] = useState<(Brief & { corrections?: string[] }) | null>(null);
  const [odds, setOdds] = useState<Odds[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [region, setRegion] = useState('all');
  const load = (refresh = false) => {
    setBusy(true);
    axios.get('/api/news/brief', { ...auth, params: { refresh: refresh ? 1 : undefined } }).then(r => { setB(r.data.brief); setRev(r.data.reviewed ?? null); }).catch(() => setB(null)).finally(() => setBusy(false));
  };
  useEffect(() => {
    load();
    axios.get('/api/news/odds', auth).then(r => setOdds(r.data.list)).catch(() => setOdds([]));
    const t = window.setInterval(() => load(), 10 * 60000);
    return () => window.clearInterval(t);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (b === undefined) return <div className="hb-card hb-dim">Writing the brief… (first one can take 20 seconds)</div>;
  const shownOdds = (odds ?? []).filter(o => region === 'all' || o.region === region).slice(0, 12);
  return (
    <>
      {rev && <BriefCard b={rev} reviewed={rev.corrections ?? []} />}
      {!b ? <div className="hb-card hb-dim">No brief yet. <button className="hb-btn" onClick={() => load(true)}>Make one now</button></div>
        : <BriefCard b={b} onRefresh={() => load(true)} busy={busy} />}
      <div className="hb-card">
        <div className="hb-between">
          <h3 style={{ margin: 0 }}>What the crowd expects <span className="hb-dim">prediction markets: people put money on these outcomes</span></h3>
          <div className="np-regionpick">{['all', 'US', 'IN', 'CA', 'World'].map(r => <button key={r} className={region === r ? 'on' : ''} onClick={() => setRegion(r)}>{r === 'all' ? 'All' : `${FLAG[r]} ${r === 'IN' ? 'India' : r === 'CA' ? 'Canada' : r === 'US' ? 'USA' : 'World'}`}</button>)}</div>
        </div>
        {odds === null ? <div className="hb-dim">Loading…</div> : !shownOdds.length ? <div className="hb-dim" style={{ marginTop: 8 }}>No open markets here right now.</div> : (
          <div className="np-odds">
            {shownOdds.map(o => (
              <a key={o.id} className="np-odd" href={o.url} target="_blank" rel="noopener noreferrer">
                <div className="np-odd-t">{FLAG[o.region] ?? ''} {o.title}</div>
                {o.outcomes.map((x, i) => (
                  <div key={i} className="np-odd-row">
                    <span className="np-odd-l">{x.label}</span>
                    <span className="np-odd-bar"><span style={{ width: `${Math.max(2, Math.min(100, x.pct))}%` }} /></span>
                    <b>{x.pct}%</b>
                    {x.change1d ? <span className={x.change1d > 0 ? 'up' : 'down'}>{x.change1d > 0 ? '+' : ''}{x.change1d}</span> : null}
                  </div>
                ))}
                <div className="hb-dim">${Math.round(o.volume24h / 1000)}k traded today{o.ends ? ` · ends ${new Date(o.ends).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}</div>
              </a>
            ))}
          </div>
        )}
        <div className="hb-dim" style={{ marginTop: 8 }}>From Polymarket. Odds are what traders are betting, not a fact; they change fast.</div>
      </div>
    </>
  );
}

function Headlines({ token }: { token: string }) {
  const [d, setD] = useState<{ list: Hl[]; important: number; errors: string[] } | null>(null);
  const [all, setAll] = useState(false);
  const [region, setRegion] = useState('all');
  const load = () => axios.get('/api/news/headlines', { headers: { Authorization: `Bearer ${token}` } }).then(r => setD(r.data)).catch(() => setD({ list: [], important: 5, errors: ['Could not load headlines.'] }));
  useEffect(() => { load(); const t = window.setInterval(load, 3 * 60000); return () => window.clearInterval(t); }, [token]);
  if (!d) return <div className="hb-card hb-dim">Loading…</div>;
  const isIpo = (h: Hl) => h.topic === 'ipo' || h.tags.includes('ipo') || h.tags.includes('grey market');
  const list = d.list.filter(h => region === 'IPO' ? isIpo(h) : (all || h.score >= d.important) && (region === 'all' || h.region === region));
  return (
    <div className="hb-card">
      <div className="hb-between"><div className="hb-dim">Last 36 hours from US, Indian and Canadian news. Big = central banks, inflation, jobs, tariffs, big companies, or a big move.</div>
        <label className="np-chk"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> show all market news</label></div>
      <div className="np-regionpick" style={{ marginTop: 6 }}>{['all', 'US', 'IN', 'CA', 'IPO'].map(r => <button key={r} className={region === r ? 'on' : ''} onClick={() => setRegion(r)}>{r === 'all' ? 'All' : r === 'IPO' ? 'IPO & grey market' : `${FLAG[r]} ${r === 'IN' ? 'India' : r === 'CA' ? 'Canada' : 'USA'}`}</button>)}</div>
      {region === 'IPO' && <div className="hb-dim" style={{ marginTop: 6 }}>Grey market premium (GMP) = the unofficial price of IPO shares before listing. It is not regulated (Sebi has asked players to stop publishing it) and often wrong on listing day.</div>}
      {!list.length && <div className="hb-dim" style={{ marginTop: 10 }}>No big headlines right now.</div>}
      {list.map(h => (
        <div key={h.title + h.pub} className={`np-hl${h.score >= d.important ? ' big' : ''}`}>
          <div>{h.region ? <span className="np-flag">{FLAG[h.region]}</span> : null}{h.link ? <a href={h.link} target="_blank" rel="noopener noreferrer">{h.title}</a> : h.title}</div>
          <div className="hb-dim">{ago(h.pub)} · {h.source}{h.also ? ` + ${h.also} more` : ''}{h.tags.filter(t => t !== 'noise').length ? ` · ${h.tags.filter(t => t !== 'noise').join(', ')}` : ''}</div>
        </div>
      ))}
      {d.errors.length > 0 && <div className="hb-dim">Some feeds did not answer: {d.errors.join('; ')}</div>}
    </div>
  );
}

export default function NewsPage({ token, isAdmin, research }: { token: string; isAdmin: boolean; research?: ReactNode }) {
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem('np.tab2') as Tab) || 'brief'; } catch { return 'brief'; } });
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem('np.tab2', t); } catch { /* ignore */ } };
  const tabs: [Tab, string, ReactNode][] = [['brief', 'Brief', <Sparkles size={15} />], ['economy', 'Economy', <Landmark size={15} />], ['upcoming', 'Upcoming', <CalendarClock size={15} />], ['headlines', 'Headlines', <Newspaper size={15} />],
    ...(isAdmin ? [['research', 'Research', <FlaskConical size={15} />] as [Tab, string, ReactNode]] : [])];
  return (
    <div className="np">
      <Notifications token={token} />
      <div className="np-tabs">{tabs.map(([t, l, ic]) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => pick(t)}>{ic}{l}</button>)}</div>
      {tab === 'brief' && <BriefTab token={token} />}
      {tab === 'economy' && <EconomyTab token={token} />}
      {tab === 'upcoming' && <Upcoming token={token} />}
      {tab === 'headlines' && <Headlines token={token} />}
      {tab === 'research' && isAdmin && research}
    </div>
  );
}
