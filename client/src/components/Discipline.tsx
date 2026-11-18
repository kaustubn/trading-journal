import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { num } from '../utils/format';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { InfoTip } from './ui';
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
  const scoreColor = score >= 70 ? 'var(--success)' : score >= 45 ? 'var(--warning)' : 'var(--danger)';
  const trend = num(d.trend);
  const maxA = Math.max(1, ...d.byWeek.map((w: any) => num(w.aPct)));

  // A score from 1 plan or a handful of grades is noise (it used to show 100 from a single day)
  const hasData = d.notesTotal >= 5 || d.gradedTotal >= 10;

  return (
    <div className="discipline">
      <div className="disc-top">
        <div className="disc-score" style={{ borderColor: hasData ? scoreColor : 'var(--border)' }}>
          <div className="disc-score-num" style={{ color: hasData ? scoreColor : 'var(--muted)' }}>{hasData ? score : '—'}</div>
          <div className="disc-score-lbl">Discipline score <InfoTip term="discipline" /></div>
          {!hasData && <div className="disc-need">Needs 5+ daily plans or 10+ graded trades. So far: {d.notesTotal} plan{d.notesTotal === 1 ? '' : 's'}, {d.gradedTotal} graded.</div>}
          {trend !== 0 && (
            <div className={`disc-trend ${trend > 0 ? 'up' : 'down'}`}>
              {trend > 0 ? <TrendingUp className="ic-sm" /> : <TrendingDown className="ic-sm" />} {Math.abs(trend)} pts vs prior weeks
            </div>
          )}
        </div>

        <div className="disc-metrics">
          <div className="disc-metric">
            <div className="dm-label">Plan adherence <InfoTip term="adherence" /></div>
            <div className="dm-bar"><div className="dm-fill blue" style={{ width: `${num(d.adherencePct)}%` }} /></div>
            <div className="dm-val">{d.notesTotal ? `${num(d.adherencePct)}% · ${d.notesFollowed}/${d.notesTotal} days` : 'Fill in Daily Plan and answer "Did I follow my checklist?"'}</div>
          </div>
          <div className="disc-metric">
            <div className="dm-label">A-grade trades <InfoTip term="gradeA" /></div>
            <div className="dm-bar"><div className="dm-fill green" style={{ width: `${num(d.aPct)}%` }} /></div>
            <div className="dm-val">{d.gradedTotal ? `${num(d.aPct)}% of graded` : 'Grade trades A/B/C in the trade popup'}</div>
          </div>
          <div className="disc-metric">
            <div className="dm-label">C-grade trades <InfoTip term="gradeC" /></div>
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
        Discipline = did you plan the day (Daily Plan) and take only A/B setups from your Entry Checklist. A rising score usually shows up as smaller losses a few weeks later.
      </p>
    </div>
  );
}
