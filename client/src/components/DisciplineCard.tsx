// Dashboard card: discipline score (last 20 trading days), XP level, streaks and this month's challenges.
// XP: +10 per logged trade, +15 per debrief, +15 plan, +50 end-of-day review, +20 rule-free trading day, -25 per rule break.
import { useEffect, useState } from 'react';
import axios from 'axios';
import { Trophy } from 'lucide-react';
import '../styles/Habits.css';

export default function DisciplineCard({ token, accountId, refreshKey = 0, onNavigate }: { token: string; accountId: number; refreshKey?: number; onNavigate?: (v: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    axios.get(`/api/habits/score/${accountId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setD(r.data); setErr(''); }).catch(e => setErr(e?.response?.data?.error || 'Could not load the discipline score.'));
  }, [token, accountId, refreshKey]);
  if (err) return <div className="hb-card"><div className="hb-msg err">{err}</div></div>;
  if (!d) return <div className="hb-card"><div className="hb-dim">Loading discipline score…</div></div>;
  const lvl = d.level;
  const pct = lvl.next ? Math.round(100 * (d.xp - lvl.floor) / (lvl.next - lvl.floor)) : 100;
  const scoreCls = d.score == null ? '' : d.score >= 75 ? 'hb-up' : d.score >= 50 ? 'hb-warn' : 'hb-down';
  return (
    <div className="hb-card">
      <h3><Trophy size={16} /> Discipline <span className="hb-dim">rules followed, trades debriefed, days reviewed</span></h3>
      <div className="hb-grid">
        <div className="hb-block">
          <div className="hb-dim">Score (last {d.scoreParts?.days ?? 0} trading days)</div>
          <div className={`hb-big ${scoreCls}`}>{d.score ?? '–'}<span className="hb-dim" style={{ fontSize: 14 }}> / 100</span></div>
          <div className="hb-dim">50% days with no rule break · 30% trades debriefed · 20% days reviewed.</div>
        </div>
        <div className="hb-block">
          <div className="hb-between"><span className="hb-dim">Level {lvl.index}</span><span className="hb-dim">{d.xp.toLocaleString()} XP{d.today ? ` (+${d.today} today)` : ''}</span></div>
          <div style={{ fontSize: 18, fontWeight: 650 }}>{lvl.name}</div>
          <div className="hb-bar"><span style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></div>
          <div className="hb-dim">{lvl.next ? `${(lvl.next - d.xp).toLocaleString()} XP to ${lvl.nextName}` : 'Top level'} · XP counts from {d.xpFrom}.</div>
        </div>
        <div className="hb-block">
          <div className="hb-dim">Streaks</div>
          <div className="hb-streaks" style={{ marginTop: 6 }}>
            <span className="hb-streak" title="Trading days in a row with no rule break"><b>{d.streaks.ruleFree}</b>rule-free</span>
            <span className="hb-streak" title="Trading days in a row with every trade debriefed or a review written"><b>{d.streaks.journal}</b>journaled</span>
            <span className="hb-streak" title="Weekdays in a row with a pre-market plan"><b>{d.streaks.plan}</b>planned</span>
          </div>
        </div>
      </div>
      <h4>This month's challenges</h4>
      <div className="hb-grid">
        {d.challenges.map((c: any) => (
          <div key={c.key} className="hb-block">
            <div className="hb-between"><span style={{ fontSize: 13 }}>{c.done ? '✅ ' : ''}{c.title}</span><span className="hb-dim">{c.progress}/{c.goal}</span></div>
            <div className={`hb-bar ${c.done ? 'done' : ''}`}><span style={{ width: `${Math.round(100 * c.progress / c.goal)}%` }} /></div>
          </div>
        ))}
      </div>
      {d.recentViolations?.length > 0 && (
        <div className="hb-dim" style={{ marginTop: 8 }}>
          Latest rule break: {d.recentViolations[0].day} — {d.recentViolations[0].detail}. <button className="hb-btn" onClick={() => onNavigate?.('risk')}>Your rules</button>
        </div>
      )}
    </div>
  );
}
