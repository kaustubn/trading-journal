import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { num } from '../utils/format';
import '../styles/Discipline.css';

interface DisciplineProps { token: string; account_id: number; }

export default function Discipline({ token, account_id }: DisciplineProps) {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    axios.get(`/api/discipline?account_id=${account_id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setD(r.data.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }, [account_id]);

  if (loading) return <div className="discipline loading">Loading…</div>;
  if (!d) return <div className="discipline"><p className="empty">No discipline data yet.</p></div>;

  const score = num(d.disciplineScore);
  const scoreColor = score >= 70 ? '#22c55e' : score >= 45 ? '#f5a623' : '#ef4444';
  const trend = num(d.trend);
  const maxA = Math.max(1, ...d.byWeek.map((w: any) => num(w.aPct)));

  const hasData = d.notesTotal > 0 || d.gradedTotal > 0;

  return (
    <div className="discipline">
      <div className="disc-top">
        <div className="disc-score" style={{ borderColor: scoreColor }}>
          <div className="disc-score-num" style={{ color: scoreColor }}>{hasData ? score : '—'}</div>
          <div className="disc-score-lbl">Discipline Score</div>
          {trend !== 0 && (
            <div className={`disc-trend ${trend > 0 ? 'up' : 'down'}`}>
              {trend > 0 ? '▲' : '▼'} {Math.abs(trend)} pts vs prior weeks
            </div>
          )}
        </div>

        <div className="disc-metrics">
          <div className="disc-metric">
            <div className="dm-label">Plan adherence</div>
            <div className="dm-bar"><div className="dm-fill blue" style={{ width: `${num(d.adherencePct)}%` }} /></div>
            <div className="dm-val">{d.notesTotal ? `${num(d.adherencePct)}% · ${d.notesFollowed}/${d.notesTotal} days` : 'log pre-market plans to track'}</div>
          </div>
          <div className="disc-metric">
            <div className="dm-label">A-grade trades</div>
            <div className="dm-bar"><div className="dm-fill green" style={{ width: `${num(d.aPct)}%` }} /></div>
            <div className="dm-val">{d.gradedTotal ? `${num(d.aPct)}% of graded` : 'grade trades to track'}</div>
          </div>
          <div className="disc-metric">
            <div className="dm-label">C-grade trades <span className="dm-warn">(the killers)</span></div>
            <div className="dm-bar"><div className="dm-fill red" style={{ width: `${num(d.cPct)}%` }} /></div>
            <div className="dm-val">{d.gradedTotal ? `${num(d.cPct)}% of graded` : '—'}</div>
          </div>
        </div>
      </div>

      {d.byWeek.filter((w: any) => w.aPct != null).length > 1 && (
        <div className="disc-trend-chart">
          <h3>A-grade % by week</h3>
          <div className="disc-weeks">
            {d.byWeek.map((w: any) => (
              <div key={w.week} className="disc-week">
                <div className="dw-bar-wrap">
                  <div className="dw-bar" style={{ height: `${w.aPct != null ? (num(w.aPct) / maxA) * 100 : 0}%` }} />
                </div>
                <div className="dw-val">{w.aPct != null ? `${w.aPct}%` : '-'}</div>
                <div className="dw-week">{w.week.split('-')[1]}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="disc-note">
        Discipline = did you plan the day (Pre-Market) and take only checklist-graded setups. Rising score = the paper→real gap closing.
      </p>
    </div>
  );
}
