// Phone alerts through your own Telegram bot: high-impact releases a few minutes before, a morning brief,
// rule breaks and prop-limit warnings. The bot token is stored encrypted and never shown again.
import { useEffect, useState } from 'react';
import axios from 'axios';
import { BellRing } from 'lucide-react';
import '../styles/Habits.css';

interface Acc { id: number; account_name: string }

export default function AlertSettings({ token, accounts, defaultAccount }: { token: string; accounts: Acc[]; defaultAccount: number | null }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [s, setS] = useState<any>(null);
  const [tok, setTok] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [brief, setBrief] = useState('');
  useEffect(() => { axios.get('/api/alerts/settings', auth).then(r => setS({ ...r.data.settings, account_id: r.data.settings.account_id ?? defaultAccount })).catch(() => setS(null)); }, [token]);
  if (!s) return null;
  const save = async (extra: any = {}) => {
    setMsg(null);
    try {
      const r = await axios.put('/api/alerts/settings', { ...s, ...extra, token: tok }, auth);
      setS(r.data.settings); setTok('');
      setMsg({ ok: true, t: r.data.settings.enabled ? 'Saved. Alerts are on.' : 'Saved. Turn alerts on once the bot token and chat id are in.' });
    } catch (e: any) { setMsg({ ok: false, t: e?.response?.data?.error || 'Could not save.' }); }
  };
  const test = async () => {
    setMsg(null);
    try { await axios.post('/api/alerts/test', {}, auth); setMsg({ ok: true, t: 'Test sent. Check Telegram.' }); }
    catch (e: any) { setMsg({ ok: false, t: e?.response?.data?.error || 'Test failed.' }); }
  };
  const preview = async () => {
    try { setBrief((await axios.post('/api/alerts/preview-brief', { account_id: s.account_id }, auth)).data.text); } catch { setBrief('Could not build the brief.'); }
  };
  const tog = (k: string, label: string) => (
    <label className="hb-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <input type="checkbox" checked={!!s[k]} onChange={e => setS({ ...s, [k]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <div className="hb-card">
      <h3><BellRing size={16} /> Phone alerts (Telegram) <span className={s.enabled ? 'hb-up' : 'hb-dim'}>{s.enabled ? 'on' : 'off'}</span></h3>
      <div className="hb-dim">
        Use your own Telegram bot (the one your HQ already uses works): paste its token and your chat id, save, then press Test.
        New bot: message @BotFather, send /newbot, copy the token; then send your bot any message and get your chat id from @userinfobot.
      </div>
      <div className="hb-row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
        <label className="hb-field">Bot token {s.hasToken ? '(saved — leave empty to keep)' : ''}
          <input className="hb-input" type="password" autoComplete="off" value={tok} placeholder={s.hasToken ? '••••••••' : '123456789:ABC…'} onChange={e => setTok(e.target.value)} style={{ width: 260 }} />
        </label>
        <label className="hb-field">Chat id<input className="hb-input" value={s.chat ?? ''} placeholder="123456789" onChange={e => setS({ ...s, chat: e.target.value })} style={{ width: 140 }} /></label>
        <label className="hb-field">Account for rule / prop alerts
          <select value={s.account_id ?? ''} onChange={e => setS({ ...s, account_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">None</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
          </select>
        </label>
        <label className="hb-field">Minutes before a release<input className="hb-input num" type="number" min={5} max={120} value={s.lead_min} onChange={e => setS({ ...s, lead_min: Number(e.target.value) })} /></label>
      </div>
      <div className="hb-row" style={{ marginTop: 8 }}>
        {tog('news', 'High-impact releases')}{tog('brief', 'Morning brief (7:30–9:25 NY)')}{tog('earnings', 'Earnings in the brief')}{tog('rules', 'Rule breaks')}{tog('prop', 'Prop limit near')}
      </div>
      <div className="hb-row" style={{ marginTop: 10 }}>
        <button className="hb-btn primary" onClick={() => save({ enabled: true })}>Save and turn on</button>
        <button className="hb-btn" onClick={() => save({ enabled: false })}>Save, keep off</button>
        <button className="hb-btn" disabled={!s.hasToken || !s.chat} onClick={test}>Send test</button>
        <button className="hb-btn" onClick={preview}>Preview morning brief</button>
      </div>
      {msg && <div className={`hb-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.t}</div>}
      {brief && <pre className="hb-block" style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, marginTop: 8 }}>{brief}</pre>}
      <div className="hb-dim" style={{ marginTop: 8 }}>
        Checked every 10 minutes on US weekdays (6:00–18:00 New York) by a scheduled job, so a release alert arrives roughly {s.lead_min}–{s.lead_min - 10 > 0 ? s.lead_min - 10 : 0} minutes before. Each alert is sent once.
      </div>
    </div>
  );
}
