// Prop-firm news rule banner: shows on every page for the selected account when its blackout window is set.
import { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, Clock } from 'lucide-react';
import '../styles/NewsAnalyzer.css';

interface Up { event: string; name: string; utc: string; shared: string[] }
const mmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return h ? `${h}h ${m}m` : `${m}:${String(r).padStart(2, '0')}`; };

export default function NewsBlackoutBanner({ token, accountId }: { token: string; accountId: number | null }) {
  const [cfg, setCfg] = useState<{ before: number | null; after: number | null; upcoming: Up[] } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); const r = window.setInterval(() => setTick(x => x + 1), 5 * 60000); const on = () => setTick(x => x + 1); window.addEventListener('jc:blackout-changed', on); return () => { window.clearInterval(t); window.clearInterval(r); window.removeEventListener('jc:blackout-changed', on); }; }, []);
  useEffect(() => {
    if (!accountId) { setCfg(null); return; }
    axios.get(`/api/news/blackout/${accountId}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => setCfg(r.data)).catch(() => setCfg(null));
  }, [accountId, token, tick]);
  if (!cfg || (cfg.before == null && cfg.after == null)) return null;
  const before = (cfg.before ?? 0) * 60000, after = (cfg.after ?? 0) * 60000;
  const ev = cfg.upcoming.map(u => ({ ...u, t: Date.parse(u.utc) })).filter(u => u.t + after > now).sort((a, b) => a.t - b.t)[0];
  if (!ev) return null;
  const start = ev.t - before, end = ev.t + after;
  const active = now >= start && now < end;
  const soon = !active && start - now <= 60 * 60000; // show from 1 hour before the window
  if (!active && !soon) return null;
  const when = new Date(ev.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={`nb ${active ? 'nb-active' : 'nb-soon'}`} role="alert">
      {active ? <AlertTriangle className="ic-sm" /> : <Clock className="ic-sm" />}
      {active
        ? <span><b>News blackout active</b> — {ev.name} at {when}{ev.shared.length ? ` (with ${ev.shared.join(', ')})` : ''}. No new trades on this account for <b>{mmss(end - now)}</b>.</span>
        : <span><b>{ev.name}</b> at {when}. Blackout starts in <b>{mmss(start - now)}</b> ({cfg.before ?? 0} min before to {cfg.after ?? 0} min after).</span>}
    </div>
  );
}
