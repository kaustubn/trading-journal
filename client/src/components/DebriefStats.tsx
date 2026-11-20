// Mindset page: what your debriefs say — results by how you felt, by "followed the plan" and by "would take it again".
import { useEffect, useState } from 'react';
import axios from 'axios';
import { HeartPulse } from 'lucide-react';
import '../styles/Habits.css';

const LABEL: Record<string, string> = {
  calm: 'Calm', confident: 'Confident', fomo: 'FOMO / chasing', fearful: 'Fearful / hesitant', revenge: 'Revenge', bored: 'Bored', tired: 'Tired', greedy: 'Greedy',
  followed: 'Followed the plan', broke: 'Broke the plan', yes: 'Would take again', no: 'Would not take again',
};
interface G { key: string; n: number; winRate: number; avgPnl: number; total: number }
const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

function Table({ title, rows }: { title: string; rows: G[] }) {
  if (!rows.length) return null;
  return (
    <div className="hb-block">
      <div className="hb-dim" style={{ marginBottom: 4 }}>{title}</div>
      <table className="hb-table">
        <thead><tr><th></th><th>Trades</th><th>Win %</th><th>Avg</th><th>Total</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.key}><td>{LABEL[r.key] ?? r.key}</td><td>{r.n}</td><td>{r.winRate.toFixed(0)}%</td>
            <td className={r.avgPnl >= 0 ? 'hb-up' : 'hb-down'}>{money(r.avgPnl)}</td><td className={r.total >= 0 ? 'hb-up' : 'hb-down'}>{money(r.total)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function DebriefStats({ token, accountId, attempt }: { token: string; accountId: number; attempt: number | null }) {
  const [s, setS] = useState<{ n: number; byEmotion: G[]; byPlan: G[]; byRetake: G[] } | null>(null);
  useEffect(() => {
    axios.get(`/api/habits/debriefs/stats/${accountId}`, { headers: { Authorization: `Bearer ${token}` }, params: { attempt: attempt || undefined } })
      .then(r => setS(r.data)).catch(() => setS(null));
  }, [token, accountId, attempt]);
  if (!s) return null;
  const worst = [...s.byEmotion].filter(g => g.n >= 3).sort((a, b) => a.avgPnl - b.avgPnl)[0];
  return (
    <div className="hb-card">
      <h3><HeartPulse size={16} /> What your debriefs say <span className="hb-dim">{s.n} debriefed trade{s.n === 1 ? '' : 's'}</span></h3>
      {!s.n ? <div className="hb-dim">No debriefs yet. Answer the four questions on the dashboard after each trade; this table fills in as you go.</div> : (
        <>
          {worst && worst.avgPnl < 0 && <div className="hb-msg err" style={{ marginBottom: 8 }}>Most costly state: {LABEL[worst.key] ?? worst.key} — {worst.n} trades, {money(worst.total)} in total.</div>}
          {s.n < 20 && <div className="hb-dim" style={{ marginBottom: 8 }}>Fewer than 20 debriefs: treat these as early signs, not conclusions.</div>}
          <div className="hb-grid">
            <Table title="By how you felt" rows={s.byEmotion} />
            <Table title="By your plan" rows={s.byPlan} />
            <Table title="Would you take it again?" rows={s.byRetake} />
          </div>
        </>
      )}
    </div>
  );
}
