// News: one simple page.
//   Upcoming  : only events that move NQ (CPI, jobs, PPI, retail sales, PCE, GDP, Fed decisions, big-tech earnings),
//               dates from the official calendars, with a countdown and what NQ usually does.
//   Headlines : market-moving headlines only (Fed, inflation, tariffs, big tech, big moves); "show all" for the rest.
//   Research  : the old calendar import and the reaction study (owner only).
// Top card: turn on app notifications on this device (Web Push) and choose what to get.
import { ReactNode, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Bell, BellOff, CalendarClock, Newspaper, FlaskConical } from 'lucide-react';
import '../styles/Habits.css';
import '../styles/NewsPage.css';

interface Ev { id: string; utc: string; ny_date: string; ny_time: string; title: string; kind: string; impact: 'high' | 'medium'; why: string; nq: { absMed15: number; up15: number } | null; source: string }
interface Hl { title: string; link: string; pub: number; source: string; score: number; tags: string[]; also: number }
type Tab = 'upcoming' | 'headlines' | 'research';

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
            <div className="hb-dim">Big releases {s.lead_min} min before, breaking market news, and fast NQ moves. Checked every 10 min on weekdays, about 3:00 to 17:00 BC.</div></div>
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
          <label className="np-chk">Warn me <select value={s.lead_min} onChange={e => save({ lead_min: Number(e.target.value) })}>{[5, 10, 15, 30, 60].map(m => <option key={m} value={m}>{m} min</option>)}</select> before</label>
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

function Headlines({ token }: { token: string }) {
  const [d, setD] = useState<{ list: Hl[]; important: number; errors: string[] } | null>(null);
  const [all, setAll] = useState(false);
  const load = () => axios.get('/api/news/headlines', { headers: { Authorization: `Bearer ${token}` } }).then(r => setD(r.data)).catch(() => setD({ list: [], important: 5, errors: ['Could not load headlines.'] }));
  useEffect(() => { load(); const t = window.setInterval(load, 3 * 60000); return () => window.clearInterval(t); }, [token]);
  if (!d) return <div className="hb-card hb-dim">Loading…</div>;
  const list = d.list.filter(h => all || h.score >= d.important);
  return (
    <div className="hb-card">
      <div className="hb-between"><div className="hb-dim">Last 36 hours. Big = Fed / inflation / jobs / tariffs, big tech, or a big move.</div>
        <label className="np-chk"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> show all market news</label></div>
      {!list.length && <div className="hb-dim" style={{ marginTop: 10 }}>No big headlines right now.</div>}
      {list.map(h => (
        <div key={h.title + h.pub} className={`np-hl${h.score >= d.important ? ' big' : ''}`}>
          <div>{h.link ? <a href={h.link} target="_blank" rel="noopener noreferrer">{h.title}</a> : h.title}</div>
          <div className="hb-dim">{ago(h.pub)} · {h.source}{h.also ? ` + ${h.also} more` : ''}{h.tags.filter(t => t !== 'noise').length ? ` · ${h.tags.filter(t => t !== 'noise').join(', ')}` : ''}</div>
        </div>
      ))}
      {d.errors.length > 0 && <div className="hb-dim">Some feeds did not answer: {d.errors.join('; ')}</div>}
    </div>
  );
}

export default function NewsPage({ token, isAdmin, research }: { token: string; isAdmin: boolean; research?: ReactNode }) {
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem('np.tab') as Tab) || 'upcoming'; } catch { return 'upcoming'; } });
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem('np.tab', t); } catch { /* ignore */ } };
  const tabs: [Tab, string, ReactNode][] = [['upcoming', 'Upcoming', <CalendarClock size={15} />], ['headlines', 'Headlines', <Newspaper size={15} />],
    ...(isAdmin ? [['research', 'Research', <FlaskConical size={15} />] as [Tab, string, ReactNode]] : [])];
  return (
    <div className="np">
      <Notifications token={token} />
      <div className="np-tabs">{tabs.map(([t, l, ic]) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => pick(t)}>{ic}{l}</button>)}</div>
      {tab === 'upcoming' && <Upcoming token={token} />}
      {tab === 'headlines' && <Headlines token={token} />}
      {tab === 'research' && isAdmin && research}
    </div>
  );
}
