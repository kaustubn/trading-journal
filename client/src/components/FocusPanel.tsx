import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Target, TrendingDown, TrendingUp, Brain, Lightbulb, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { buildInsights, Insight, CoachData } from '../utils/coaching';

interface Props {
  token: string;
  account_id: number;
  from?: string | null;
  to?: string | null;
  attempt?: number | null;
  rangeLabel?: string;
  isAdmin?: boolean;
  onNavigate: (view: string) => void;
  title?: string;
  max?: number;
}

const SEV: Record<Insight['severity'], { label: string; icon: React.ComponentType<any> }> = {
  leak: { label: 'Leak', icon: TrendingDown },
  edge: { label: 'Edge', icon: TrendingUp },
  habit: { label: 'Habit', icon: Brain },
  info: { label: 'Tip', icon: Lightbulb },
};

/** Loads the analytics the coach needs (in parallel; any that fail are skipped). */
export async function loadCoachData(token: string, account_id: number, from?: string | null, to?: string | null, attempt?: number | null, isAdmin?: boolean): Promise<CoachData> {
  const h = { headers: { Authorization: `Bearer ${token}` } };
  const q = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams(extra);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (attempt) p.set('attempt', String(attempt));
    return p.toString();
  };
  const get = (url: string) => axios.get(url, h).then(r => r.data.data).catch(() => undefined);
  const [overview, setups, tags, grades, breakdown, emotions] = await Promise.all([
    get(`/api/overview/${account_id}?${q()}`),
    get(`/api/setups/${account_id}?${q({ groupBy: 'setup' })}`),
    get(`/api/setups/${account_id}?${q({ groupBy: 'tag' })}`),
    get(`/api/setups/${account_id}?${q({ groupBy: 'grade' })}`),
    get(`/api/breakdown/${account_id}?${q()}`),
    get(`/api/emotions/${account_id}?${attempt ? `attempt=${attempt}` : ''}`),
  ]);
  return { overview, setups, tags, grades, breakdown, emotions, isAdmin };
}

export function InsightCard({ ins, onNavigate, rank }: { ins: Insight; onNavigate: (v: string) => void; rank?: number }) {
  const S = SEV[ins.severity];
  return (
    <div className={`focus-card sev-${ins.severity}`}>
      <div className="focus-card-top">
        <span className={`focus-tag sev-${ins.severity}`}><S.icon className="ic-sm" /> {S.label}</span>
        {rank != null && <span className="focus-rank">#{rank}</span>}
      </div>
      <div className="focus-title">{ins.title}</div>
      <div className="focus-block">
        <div className="focus-k">Why it matters</div>
        <div className="focus-v">{ins.why}</div>
      </div>
      <div className="focus-block">
        <div className="focus-k">What to do next</div>
        <div className="focus-v strong">{ins.action}</div>
      </div>
      {ins.links.length > 0 && (
        <div className="focus-links">
          {ins.links.map(l => (
            <button key={l.view + l.label} className="focus-link" onClick={() => onNavigate(l.view)}>
              {l.label} <ArrowRight className="ic-sm" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Your focus this week": the top 1–3 things to fix or keep, from Kay's own data. */
export default function FocusPanel({ token, account_id, from, to, attempt, rangeLabel, isAdmin, onNavigate, title = 'Your focus this week', max = 3 }: Props) {
  const [state, setState] = useState<{ loading: boolean; headline: string | null; insights: Insight[] }>({ loading: true, headline: null, insights: [] });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true }));
    loadCoachData(token, account_id, from, to, attempt, isAdmin).then(d => {
      if (!alive) return;
      const r = buildInsights(d);
      setState({ loading: false, headline: r.headline, insights: r.insights });
    });
    return () => { alive = false; };
  }, [token, account_id, from, to, attempt, isAdmin]);

  const list = showAll ? state.insights : state.insights.slice(0, max);
  return (
    <section className="focus-panel" aria-label={title}>
      <div className="focus-head">
        <div>
          <h2 className="focus-h"><Target className="ic-lg" /> {title}</h2>
          <p className="focus-sub">
            The most important things in your own trades{rangeLabel ? ` · ${rangeLabel}` : ''}{attempt ? ' · this run' : ''}. Work on one at a time.
          </p>
        </div>
        <button className="btn-ghost" onClick={() => onNavigate('coach')}>Open coach <ArrowRight className="ic-sm" /></button>
      </div>
      {state.loading ? (
        <div className="focus-grid">{[0, 1, 2].map(i => <div key={i} className="focus-card skeleton" />)}</div>
      ) : (
        <>
          {state.headline && <p className="focus-headline">{state.headline}</p>}
          <div className="focus-grid">
            {list.map((ins, i) => <InsightCard key={ins.id} ins={ins} rank={i + 1} onNavigate={onNavigate} />)}
          </div>
          {state.insights.length > max && (
            <button className="focus-more" onClick={() => setShowAll(s => !s)}>
              {showAll ? <>Show top {max} only <ChevronUp className="ic-sm" /></> : <>Show all {state.insights.length} insights <ChevronDown className="ic-sm" /></>}
            </button>
          )}
        </>
      )}
    </section>
  );
}
