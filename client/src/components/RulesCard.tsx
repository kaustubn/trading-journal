// Risk & Sizing page: your own trading rules for this account (on top of the prop firm's) and every time you broke
// one. Breaks show as a banner on every page the same day, cost XP, and can be sent to Telegram.
import { useEffect, useState } from 'react';
import axios from 'axios';
import { ShieldCheck } from 'lucide-react';
import '../styles/Habits.css';

const LABEL: Record<string, string> = {
  max_trades_day: 'Too many trades', max_losses_day: 'Kept trading after the loss limit', max_contracts: 'Size too big',
  max_daily_loss: 'Daily loss limit', hours: 'Outside your trading hours', news: 'Traded in a news blackout',
};
const EMPTY = { max_trades_day: '', max_losses_day: '', max_contracts: '', max_daily_loss: '', start_time: '', end_time: '', respect_news: false };

export default function RulesCard({ token, accountId }: { token: string; accountId: number }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [f, setF] = useState<any>(EMPTY);
  const [v, setV] = useState<any[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const load = () => {
    axios.get(`/api/habits/rules/${accountId}`, auth).then(r => { const x = r.data.rules || {}; setF({ ...EMPTY, ...Object.fromEntries(Object.entries(x).map(([k, val]) => [k, val ?? ''])) }); }).catch(() => {});
    axios.get(`/api/habits/violations/${accountId}`, { ...auth, params: { days: 30 } }).then(r => setV(r.data.violations)).catch(() => setV([]));
  };
  useEffect(() => { load(); }, [token, accountId]);
  const save = async () => {
    setMsg(null);
    try {
      await axios.put(`/api/habits/rules/${accountId}`, f, auth);
      setMsg({ ok: true, t: 'Saved. Breaks are checked on every trade you log or import.' });
      load(); window.dispatchEvent(new Event('jc:rules-changed'));
    } catch (e: any) { setMsg({ ok: false, t: e?.response?.data?.error || 'Could not save.' }); }
  };
  const num = (k: string, label: string, hint: string, step = '1') => (
    <label className="hb-field">{label}<input className="hb-input num" type="number" min="0" step={step} value={f[k]} placeholder="off" title={hint} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <div className="hb-card">
      <h3><ShieldCheck size={16} /> Your trading rules <span className="hb-dim">empty = not checked</span></h3>
      <div className="hb-row" style={{ alignItems: 'flex-end' }}>
        {num('max_trades_day', 'Max trades a day', 'Trades after this number are breaks')}
        {num('max_losses_day', 'Stop after losses', 'Any trade after this many losing trades in a day is a break')}
        {num('max_daily_loss', 'Daily loss limit $', 'Stop once the day is down this much', '50')}
        {num('max_contracts', 'Max contracts', 'Bigger trades are breaks')}
        <label className="hb-field">Trade from<input className="hb-input" type="time" value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} /></label>
        <label className="hb-field">until<input className="hb-input" type="time" value={f.end_time} onChange={e => setF({ ...f, end_time: e.target.value })} /></label>
        <label className="hb-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={!!f.respect_news} onChange={e => setF({ ...f, respect_news: e.target.checked })} /> No trades in the news blackout
        </label>
        <button className="hb-btn primary" onClick={save}>Save rules</button>
      </div>
      <div className="hb-dim" style={{ marginTop: 4 }}>Times use the account's clock. The news blackout uses the minutes set in the prop banner (default 2 before / 2 after) around high-impact US releases.</div>
      {msg && <div className={`hb-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.t}</div>}
      <h4>Breaks in the last 30 days</h4>
      {v === null ? <div className="hb-dim">Loading…</div> : !v.length ? <div className="hb-dim">None. ✅</div> : (
        <div className="hb-scroll">
          <table className="hb-table">
            <thead><tr><th>Day</th><th>Rule</th><th>What happened</th></tr></thead>
            <tbody>{v.slice(0, 40).map((x, i) => <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{x.day}</td><td>{LABEL[x.rule] ?? x.rule}</td><td>{x.detail}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Banner on every page when today has a rule break on the selected account. */
export function RuleBreakBanner({ token, accountId, onNavigate }: { token: string; accountId: number | null; onNavigate?: (v: string) => void }) {
  const [today, setToday] = useState<any[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick(x => x + 1);
    const t = window.setInterval(on, 5 * 60000);
    window.addEventListener('jc:rules-changed', on);
    return () => { window.clearInterval(t); window.removeEventListener('jc:rules-changed', on); };
  }, []);
  useEffect(() => {
    if (!accountId) { setToday([]); return; }
    axios.get(`/api/habits/violations/${accountId}`, { headers: { Authorization: `Bearer ${token}` }, params: { days: 1 } })
      .then(r => {
        setToday((r.data.violations || []).filter((x: any) => x.day === r.data.today));
      }).catch(() => setToday([]));
  }, [token, accountId, tick]);
  if (!today.length) return null;
  return (
    <div className="hb-banner">
      <b>Rule break today:</b>
      <span>{today.map(x => `${LABEL[x.rule] ?? x.rule} (${x.detail})`).join(' · ')}</span>
      <span className="hb-dim">Step away before the next trade.</span>
      {onNavigate && <button className="hb-btn" onClick={() => onNavigate('risk')}>Your rules</button>}
    </div>
  );
}
