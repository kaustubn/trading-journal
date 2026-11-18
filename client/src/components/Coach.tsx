import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Compass, User, Send, Sparkles } from 'lucide-react';
import { loadCoachData, InsightCard } from './FocusPanel';
import { buildInsights, Insight, CoachData, RULES } from '../utils/coaching';
import { money, num } from '../utils/format';
import { EmptyState } from './ui';
import './Coach.css';

interface Props {
  token: string;
  account_id: number;
  attempt?: number | null;
  isAdmin?: boolean;
  onNavigate?: (view: string) => void;
}

interface Msg { role: 'user' | 'assistant'; content: string; local?: boolean }

const SUGGESTIONS = [
  'Why am I losing money?',
  "What's my single biggest leak?",
  'Which setup should I cut?',
  'What time of day should I avoid?',
  'Am I overtrading?',
  'What would help me pass a prop challenge?',
];

/** Instant, rule-based answers to the suggested questions — no AI, no cost. */
function answerLocally(q: string, d: CoachData, ins: Insight[], headline: string | null, ot: any): string {
  const o = d.overview;
  if (!o?.hasData) return 'There are no trades for this account or run yet. Import your trades first, then ask again.';
  const find = (id: string) => ins.find(i => i.id === id);
  const fmt = (i?: Insight) => i ? `${i.title}.\n${i.why}\nNext step: ${i.action}` : '';
  const leaks = ins.filter(i => i.severity === 'leak' || i.severity === 'habit');
  switch (q) {
    case 'Why am I losing money?':
      if (num(o.netPnl) >= 0) return `You are not losing overall: net ${money(o.netPnl, 0)} over ${o.totalTrades} trades.${leaks[0] ? `\n\nThe biggest thing holding you back:\n${fmt(leaks[0])}` : ''}`;
      return [headline, ...leaks.slice(0, 2).map((l, i) => `${i + 1}. ${fmt(l)}`)].filter(Boolean).join('\n\n');
    case "What's my single biggest leak?":
      return leaks[0] ? fmt(leaks[0]) : 'No clear leak stands out in this data — your losses are spread out. Keep tagging setups, grades and emotions so smaller patterns show up.';
    case 'Which setup should I cut?': {
      const s = find('setup-leak');
      return s ? fmt(s) : `No setup qualifies to cut right now (rule: at least ${RULES.SETUP_MIN_TRADES} trades, profit factor below ${RULES.SETUP_LEAK_PF} and losing money). ${find('setup-edge') ? `Your strongest is: ${find('setup-edge')!.title}.` : ''}`;
    }
    case 'What time of day should I avoid?': {
      const h = find('hour-leak');
      return h ? fmt(h) : `No hour with ${RULES.HOUR_MIN_TRADES}+ trades is losing money. Keep trading your current window.`;
    }
    case 'Am I overtrading?': {
      if (!ot || !ot.days) return 'Not enough trading days to judge yet.';
      const lines = [`You average ${ot.avgPerDay} trades a day (typical day: ${ot.medianPerDay}, busiest: ${ot.maxPerDay}).`,
        `Days with ${ot.threshold}+ trades are flagged as overtrading on the calendar.`];
      if (ot.medianPerDay >= 6) lines.push('That is a lot for discretionary NQ trading. Try a hard cap of 3 trades a day for two weeks and compare your profit factor.');
      else lines.push('Your typical day is reasonable. Watch the flagged days — that is usually where revenge trades hide.');
      return lines.join('\n');
    }
    case 'What would help me pass a prop challenge?': {
      const lines: string[] = [];
      const dd = num(o.maxDrawdown), worst = num(o.worstDay?.pnl), best = num(o.bestDay?.pnl), net = num(o.netPnl);
      lines.push(`Your worst day was ${money(worst, 0)}. Most 50K evaluations allow about $1,000–$2,000 of loss in a day or overall — set your own daily stop below that.`);
      lines.push(`Your biggest drop from a peak was ${money(dd, 0)}. To survive a $2,000 trailing drawdown, size so a normal losing streak costs under half of it.`);
      if (net > 0 && best > 0) lines.push(`Your best day is ${Math.round(best / net * 100)}% of total profit. Many firms cap one day at 30–50% of the profit target (consistency rule) — spread gains over more days.`);
      if (leaks[0]) lines.push(`Fix first: ${leaks[0].title}.`);
      lines.push('Test your rules against real challenge settings in Backtest Lab → Prop-firm challenge simulator.');
      return lines.join('\n\n');
    }
  }
  return '';
}

export default function Coach({ token, account_id, attempt, isAdmin, onNavigate }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<{ d: CoachData; ins: Insight[]; headline: string | null; ot: any } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nav = onNavigate || (() => {});

  useEffect(() => { if (messages.length) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, loading]);
  // Reset the conversation and reload data when the account or attempt changes
  useEffect(() => {
    setMessages([]); setError(''); setData(null);
    let alive = true;
    Promise.all([
      loadCoachData(token, account_id, null, null, attempt, isAdmin),
      axios.get(`/api/overtrading/${account_id}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data.data).catch(() => null),
    ]).then(([d, ot]) => {
      if (!alive) return;
      const r = buildInsights(d);
      setData({ d, ins: r.insights, headline: r.headline, ot });
    });
    return () => { alive = false; };
  }, [account_id, attempt, token, isAdmin]);

  const ask = async (question: string) => {
    if (!question.trim() || loading) return;
    setError('');
    // Suggested questions: answered instantly from your own numbers
    if (data && SUGGESTIONS.includes(question)) {
      const a = answerLocally(question, data.d, data.ins, data.headline, data.ot);
      setMessages(m => [...m, { role: 'user', content: question }, { role: 'assistant', content: a, local: true }]);
      return;
    }
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    setMessages(m => [...m, { role: 'user', content: question }]);
    setInput('');
    setLoading(true);
    try {
      const r = await axios.post('/api/coach', {
        account_id, attempt: attempt || undefined, question, history,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setMessages(m => [...m, { role: 'assistant', content: r.data.answer || 'No response.' }]);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Coach failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="coach">
      <section className="coach-section">
        <div className="coach-sec-head">
          <h2>What to work on</h2>
          <span className="scope-note">{attempt ? 'Run you are viewing' : 'Whole account'} · ranked by money at stake</span>
        </div>
        {!data ? (
          <div className="focus-grid">{[0, 1, 2].map(i => <div key={i} className="focus-card skeleton" />)}</div>
        ) : data.ins.length === 0 ? (
          <EmptyState icon={Compass} title="Nothing urgent found">
            No setup, hour, emotion or habit crosses the warning thresholds. Keep tagging setups, grades and emotions on each trade so smaller patterns can show up.
          </EmptyState>
        ) : (
          <>
            {data.headline && <p className="focus-headline">{data.headline}</p>}
            <div className="focus-grid">
              {data.ins.map((ins, i) => <InsightCard key={ins.id} ins={ins} rank={i + 1} onNavigate={nav} />)}
            </div>
          </>
        )}
      </section>

      <section className="coach-section coach-chat">
        <div className="coach-sec-head">
          <h2>Ask a question</h2>
          <span className="scope-note"><Sparkles className="ic-sm" /> Suggested questions are answered instantly from your numbers</span>
        </div>
        <div className="coach-body">
          <div className="coach-suggestions">
            {SUGGESTIONS.map(s => (
              <button key={s} className="coach-chip" onClick={() => ask(s)} disabled={!data}>{s}</button>
            ))}
          </div>

          {messages.map((m, i) => (
            <div key={i} className={`coach-msg ${m.role}`}>
              <div className="coach-avatar">{m.role === 'user' ? <User /> : <Compass />}</div>
              <div className="coach-bubble">{m.content.split('\n').map((line, j) => <p key={j}>{line}</p>)}</div>
            </div>
          ))}

          {loading && (
            <div className="coach-msg assistant">
              <div className="coach-avatar"><Compass /></div>
              <div className="coach-bubble coach-typing"><span></span><span></span><span></span></div>
            </div>
          )}
          {error && <div className="coach-error">{error}</div>}
          <div ref={endRef} />
        </div>

        <form className="coach-input" onSubmit={e => { e.preventDefault(); ask(input); }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type your own question (uses the AI coach only if it is switched on for this server)"
            disabled={loading}
          />
          <button type="submit" disabled={loading || !input.trim()} aria-label="Send"><Send className="ic-sm" /> Send</button>
        </form>
      </section>
    </div>
  );
}
