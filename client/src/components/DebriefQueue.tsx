// Dashboard card: post-trade debrief. Four quick questions for each recent trade without one (followed the plan?
// how did you feel? would you take it again? how good was the execution?) plus a one-line lesson.
import { useEffect, useState } from 'react';
import axios from 'axios';
import { MessageSquareText } from 'lucide-react';
import '../styles/Habits.css';

const EMO_LABEL: Record<string, string> = {
  calm: 'Calm', confident: 'Confident', fomo: 'FOMO / chasing', fearful: 'Fearful / hesitant', revenge: 'Revenge', bored: 'Bored', tired: 'Tired', greedy: 'Greedy',
};
interface PTrade { id: number; symbol: string; entry: string; entry_price: number; exit_price: number | null; quantity: number; pnl: number; setup_tag: string | null }

export default function DebriefQueue({ token, accountId, attempt, onSaved }: { token: string; accountId: number; attempt: number | null; onSaved?: () => void }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [list, setList] = useState<PTrade[] | null>(null);
  const [emotions, setEmotions] = useState<string[]>(Object.keys(EMO_LABEL));
  const [i, setI] = useState(0);
  const [f, setF] = useState<{ followed_plan: boolean | null; emotion: string | null; retake: boolean | null; quality: number | null; lesson: string }>({ followed_plan: null, emotion: null, retake: null, quality: null, lesson: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => axios.get(`/api/habits/debriefs/pending/${accountId}`, { ...auth, params: { attempt: attempt || undefined } })
    .then(r => { setList(r.data.trades); if (r.data.emotions?.length) setEmotions(r.data.emotions); setI(0); }).catch(() => setList([]));
  useEffect(() => { load(); }, [token, accountId, attempt]);
  if (list === null) return null;
  if (!list.length) return (
    <div className="hb-card"><h3><MessageSquareText size={16} /> Trade debrief</h3><div className="hb-dim">All trades from the last 14 days are debriefed. ✅</div></div>
  );
  const t = list[Math.min(i, list.length - 1)];
  const reset = () => setF({ followed_plan: null, emotion: null, retake: null, quality: null, lesson: '' });
  const save = async () => {
    setBusy(true); setMsg('');
    try {
      await axios.put(`/api/habits/debriefs/${t.id}`, f, auth);
      reset(); onSaved?.();
      const rest = list.filter(x => x.id !== t.id);
      setList(rest); setI(0);
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Could not save.'); }
    finally { setBusy(false); }
  };
  const yn = (key: 'followed_plan' | 'retake', yes: string, no: string) => (
    <div className="hb-chips">
      <button className={`hb-btn ${f[key] === true ? 'on' : ''}`} onClick={() => setF({ ...f, [key]: true })}>{yes}</button>
      <button className={`hb-btn ${f[key] === false ? 'on' : ''}`} onClick={() => setF({ ...f, [key]: false })}>{no}</button>
    </div>
  );
  const ready = f.followed_plan != null && f.emotion != null;
  return (
    <div className="hb-card">
      <h3><MessageSquareText size={16} /> Trade debrief <span className="hb-dim">{list.length} trade{list.length > 1 ? 's' : ''} to debrief · +15 XP each</span></h3>
      <div className="hb-block">
        <div className="hb-between"><b>{t.symbol} · {t.entry}</b><span className={Number(t.pnl) >= 0 ? 'hb-up' : 'hb-down'}>{Number(t.pnl) >= 0 ? '+' : '−'}${Math.abs(Number(t.pnl)).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span></div>
        <div className="hb-dim">{t.quantity} @ {t.entry_price}{t.exit_price != null ? ` → ${t.exit_price}` : ''}{t.setup_tag ? ` · ${t.setup_tag}` : ''}</div>
        <div className="hb-q"><div>Did you follow your plan?</div>{yn('followed_plan', 'Yes', 'No')}</div>
        <div className="hb-q"><div>How did you feel taking it?</div>
          <div className="hb-chips">{emotions.map(e => <button key={e} className={`hb-btn ${f.emotion === e ? 'on' : ''}`} onClick={() => setF({ ...f, emotion: e })}>{EMO_LABEL[e] ?? e}</button>)}</div>
        </div>
        <div className="hb-q"><div>Would you take this trade again?</div>{yn('retake', 'Yes', 'No')}</div>
        <div className="hb-q"><div>Execution quality</div>
          <div className="hb-stars">{[1, 2, 3, 4, 5].map(n => <button key={n} className={(f.quality ?? 0) >= n ? 'on' : ''} onClick={() => setF({ ...f, quality: n })} aria-label={`${n} of 5`}>★</button>)}</div>
        </div>
        <div className="hb-q"><div>One lesson (optional)</div><textarea className="hb-textarea" maxLength={1000} value={f.lesson} onChange={e => setF({ ...f, lesson: e.target.value })} placeholder="e.g. waited for the close above the level" /></div>
        <div className="hb-row" style={{ marginTop: 8 }}>
          <button className="hb-btn primary" disabled={!ready || busy} onClick={save}>{busy ? 'Saving…' : 'Save debrief'}</button>
          {list.length > 1 && <button className="hb-btn" onClick={() => { reset(); setI((i + 1) % list.length); }}>Skip for now</button>}
          {!ready && <span className="hb-dim">Answer the plan and feeling questions to save.</span>}
        </div>
        {msg && <div className="hb-msg err">{msg}</div>}
      </div>
    </div>
  );
}
