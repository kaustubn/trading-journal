// Site guide: what every page is for and how to use it, a daily workflow, and a quick tour that
// highlights each menu item in turn. Opened from the "Guide" button at the top right.
import { useEffect, useMemo, useState } from 'react';
import { X, Search, ArrowRight, Play, ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';
import '../styles/SiteGuide.css';

interface Topic { key: string; group: string; title: string; what: string; how: string[]; tip?: string; adminOnly?: boolean }

const TOPICS: Topic[] = [
  { key: 'dashboard', group: 'Journal', title: 'Dashboard',
    what: 'Your results at a glance: P&L, win rate, profit factor, streaks, "your focus this week" coaching cards and the trading calendar.',
    how: ['Pick the account at the top of the sidebar and the run under "Viewing" (each prop challenge or backtest is a run).',
      'Use the date buttons (All time, 2026, Last 30d…) to change the period.',
      'Click a day on the calendar to see that day\'s trades, then click a trade to review it.'],
    tip: 'Every analytics page follows the run you pick here.' },
  { key: 'review', group: 'Journal', title: 'Reviewing a trade',
    what: 'The trade popup: tag the setup, grade it A/B/C, log how you felt, add the stop and screenshots. Backtest trades and your own trades with a stop also get "Teach me this trade".',
    how: ['Open a trade from the calendar or the Trade Log.',
      'Teach me this trade: press Next through 7 steps: strategy, market before entry (future hidden), why it entered, risk, reward, how it ended, lesson.',
      'Fill the 4 review checks (setup, grade, feeling, stop) and press Save review.',
      'Open on chart shows the trade on the Market Chart.'],
    tip: 'The R badge next to the P&L is the result in risk units (P&L ÷ money risked to the stop).' },
  { key: 'data', group: 'Journal', title: 'Trade Log',
    what: 'Every trade in a table you can sort, filter and select.',
    how: ['Filter by date, setup or symbol; click a row to review it.', 'Tick rows to edit or delete several trades at once.', 'Import (top right) loads a broker CSV; Add trade logs one by hand.'] },
  { key: 'premarket', group: 'Journal', title: 'Daily Plan',
    what: 'Pre-market plan for the day: bias, key levels, news, the one rule you focus on.',
    how: ['Fill it before the New York open (07:30 BC until Mar 14, 2027).', 'After the session, write what happened against the plan.'] },
  { key: 'challenges', group: 'Journal', title: 'Challenges',
    what: 'Prop firm challenge runs: profit target, drawdown and daily-loss progress for each attempt.',
    how: ['Start a new run when you start a new evaluation (Dashboard → New run).', 'Mark it Passed or Blown when it ends, so the runs can be compared.'] },
  { key: 'coach', group: 'Review', title: 'Coach',
    what: 'Rule-based coaching from your own numbers: your biggest leaks and edges, ranked, with what to do next.',
    how: ['Review a handful of trades first (setup, grade, feeling): the coach learns from those tags.', 'Work on the #1 card for a week, then check again.'] },
  { key: 'analytics', group: 'Review', title: 'Performance',
    what: 'Equity curve, drawdown, R distribution, monthly results and the full report.',
    how: ['Use it weekly: is the equity curve rising and is the drawdown within your plan?'] },
  { key: 'setups', group: 'Review', title: 'Setups',
    what: 'Results per setup, tag and grade: which setups actually make money.',
    how: ['Tag every trade with its setup, then compare win rate, expectancy and average R here.', 'Stop trading a setup that loses over 30+ trades.'] },
  { key: 'breakdown', group: 'Review', title: 'Time & Sessions',
    what: 'Results by hour, weekday and session (Asia, London, New York).',
    how: ['Find the hours where you lose and stop trading them.'] },
  { key: 'discipline', group: 'Review', title: 'Mindset',
    what: 'Rule breaks and emotions (FOMO, revenge, hesitation…) against your results.',
    how: ['Tag feelings on each trade (or the quick tags after a replay exit).', 'See what each emotion costs you in dollars.'] },
  { key: 'compare', group: 'Review', title: 'Paper vs Real',
    what: 'Compares two accounts or runs side by side, e.g. paper trading against real money.',
    how: ['Pick the two accounts; look for where real results drift from paper (usually execution and emotion).'] },
  { key: 'marketchart', group: 'Practice', title: 'Market Chart', adminOnly: true,
    what: 'A TradingView-style NQ chart with your data: drawings, indicators (NQ-SYS, volume profiles, VWAP), alerts, bar replay and forward testing.',
    how: ['Timeframes and chart type at the top; Layout for 1–4 windows (they scroll together).',
      'Drawing tools on the left (lines, zones, Fib, patterns…); click a drawing to edit, lock, clone or put an alert on it (bell).',
      'Replay: pick a candle, a random date or the Day finder (trend days, gap days, your losing days); trade with B / S, add A, half H, break-even E, flatten F.',
      'Use "By risk" in the order ticket so the size comes from your risk %, and tag each exit.'],
    tip: 'Replay trades save to the account picked in the replay bar, with a chart screenshot.' },
  { key: 'backtestlab', group: 'Practice', title: 'Backtest Lab',
    what: 'Stress-tests a run before you risk money: stats, prop-challenge pass rate, Monte Carlo, robustness (slippage, 95% ranges, walk-forward) and edge over time.',
    how: ['Pick the run (Attempt) at the top.', 'Robustness: add slippage and read the verdict (holds / losing / not proven).', 'Edge over time: a setup marked Fading or Edge gone needs a review before you trade it again.'],
    tip: 'Never trust a result whose 95% range includes zero.' },
  { key: 'strategy', group: 'Practice', title: 'Strategy Rules',
    what: 'Your written rules for each setup, so trades can be checked against them.',
    how: ['Write the entry, stop, target and skip rules for each setup; keep them short and testable.'] },
  { key: 'checklist', group: 'Plan', title: 'Entry Checklist',
    what: 'The pre-entry checklist and A/B/C score: day type, real level, stop, R:R, confluence.',
    how: ['Run through it before every entry. A and B grades are trades; C is no trade.'] },
  { key: 'risk', group: 'Plan', title: 'Risk & Sizing',
    what: 'Position size from your risk per trade, risk metrics and a circuit breaker for losing days.',
    how: ['Set risk per trade from the account\'s drawdown, not the profit target.', 'Stop for the day when the daily loss limit is hit.'] },
  { key: 'propfirms', group: 'Plan', title: 'Prop Firms',
    what: 'Firm rules (drawdown type, daily loss, consistency, payouts) for your accounts.',
    how: ['Check the firm\'s own help centre: rules change often. Date every rule you record.'] },
];

const WORKFLOW: { t: string; d: string; key?: string }[] = [
  { t: 'Before the open', d: 'Daily Plan: bias, levels, news. Read your Entry Checklist.', key: 'premarket' },
  { t: 'Practise', d: 'Market Chart → Replay → Day finder. Trade 3–5 setups with your rules, size "By risk".', key: 'marketchart' },
  { t: 'Log', d: 'Real trades come in by Import or Add trade; replay trades save themselves.', key: 'data' },
  { t: 'Review', d: 'Dashboard calendar → click each trade → Teach me / grade / feelings / stop.', key: 'dashboard' },
  { t: 'Weekly', d: 'Coach #1 card, Setups, Backtest Lab robustness and edge over time.', key: 'coach' },
];

interface Props { open: boolean; onClose: () => void; onGo: (key: string) => void; isAdmin: boolean; onTourMenu: (open: boolean) => void; }

export default function SiteGuide({ open, onClose, onGo, isAdmin, onTourMenu }: Props) {
  const [q, setQ] = useState('');
  const [tour, setTour] = useState<number | null>(null);
  const topics = useMemo(() => TOPICS.filter(t => !t.adminOnly || isAdmin), [isAdmin]);
  const tourSteps = useMemo(() => topics.filter(t => t.key !== 'review'), [topics]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? topics.filter(t => `${t.title} ${t.what} ${t.how.join(' ')}`.toLowerCase().includes(s)) : topics;
  }, [q, topics]);

  // tour: highlight the menu item of the current step
  const [box, setBox] = useState<DOMRect | null>(null);
  useEffect(() => {
    document.querySelectorAll('.nav-item.guide-spot').forEach(el => el.classList.remove('guide-spot'));
    if (tour === null) { setBox(null); return; }
    const key = tourSteps[tour]?.key;
    const place = () => {
      const el = document.querySelector(`.nav-item[data-nav="${key}"]`) as HTMLElement | null;
      if (!el) { setBox(null); return; }
      el.classList.add('guide-spot');
      el.scrollIntoView({ block: 'nearest' });
      setBox(el.getBoundingClientRect());
    };
    const t = window.setTimeout(place, 260); // let the phone menu slide in
    window.addEventListener('resize', place);
    return () => { window.clearTimeout(t); window.removeEventListener('resize', place); };
  }, [tour, tourSteps]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (tour !== null) endTour(); else if (open) onClose(); }
      if (tour !== null && e.key === 'ArrowRight') setTour(i => Math.min(tourSteps.length - 1, (i ?? 0) + 1));
      if (tour !== null && e.key === 'ArrowLeft') setTour(i => Math.max(0, (i ?? 0) - 1));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const startTour = () => { onClose(); onTourMenu(true); setTour(0); };
  const endTour = () => { setTour(null); onTourMenu(false); };

  const step = tour !== null ? tourSteps[tour] : null;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const tipStyle = box
    ? (vw < 640 ? { left: 12, right: 12, bottom: 16 } : { left: Math.min(box.right + 14, vw - 380), top: Math.max(70, Math.min(box.top - 20, window.innerHeight - 260)) })
    : { left: 24, bottom: 24 };

  return (
    <>
      {open && <div className="guide-backdrop" onClick={onClose} />}
      <aside className={`guide${open ? ' open' : ''}`} aria-hidden={!open} aria-label="Site guide">
        <div className="guide-head">
          <div className="guide-title"><BookOpen className="ic-sm" /> Guide</div>
          <button className="guide-x" onClick={onClose} aria-label="Close the guide"><X className="ic-sm" /></button>
        </div>
        <div className="guide-body">
          <button className="guide-tour" onClick={startTour}><Play className="ic-sm" /> Take the 1-minute tour of the menu</button>
          <h3 className="guide-h">Start here: your daily flow</h3>
          <ol className="guide-flow">
            {WORKFLOW.filter(w => w.key !== 'marketchart' || isAdmin).map(w => (
              <li key={w.t}>
                <b>{w.t}</b><span>{w.d}</span>
                {w.key && <button className="guide-go" onClick={() => { onGo(w.key!); onClose(); }}>Open <ArrowRight className="ic-sm" /></button>}
              </li>
            ))}
          </ol>
          <h3 className="guide-h">Every page</h3>
          <label className="guide-search"><Search className="ic-sm" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search: replay, alerts, R, slippage…" />
          </label>
          {shown.map(t => (
            <details key={t.key} className="guide-topic" open={!!q}>
              <summary><span className="guide-group">{t.group}</span>{t.title}</summary>
              <p>{t.what}</p>
              <ul>{t.how.map(h => <li key={h}>{h}</li>)}</ul>
              {t.tip && <p className="guide-tip">Tip: {t.tip}</p>}
              {t.key !== 'review' && <button className="guide-go" onClick={() => { onGo(t.key); onClose(); }}>Go to {t.title} <ArrowRight className="ic-sm" /></button>}
            </details>
          ))}
          {!shown.length && <p className="guide-dim">Nothing matches “{q}”.</p>}
        </div>
      </aside>

      {step && (
        <div className="guide-tip-card" style={tipStyle} role="dialog" aria-label={`Tour: ${step.title}`}>
          <div className="guide-tip-top">
            <span className="guide-group">{step.group}</span>
            <span className="guide-dim">{(tour ?? 0) + 1} / {tourSteps.length}</span>
            <button className="guide-x" onClick={endTour} aria-label="End the tour"><X className="ic-sm" /></button>
          </div>
          <b>{step.title}</b>
          <p>{step.what}</p>
          <div className="guide-tip-nav">
            <button disabled={tour === 0} onClick={() => setTour((tour ?? 0) - 1)}><ChevronLeft className="ic-sm" /> Back</button>
            <button className="guide-open" onClick={() => { const k = step.key; endTour(); onGo(k); }}>Open it</button>
            {(tour ?? 0) < tourSteps.length - 1
              ? <button className="primary" onClick={() => setTour((tour ?? 0) + 1)}>Next <ChevronRight className="ic-sm" /></button>
              : <button className="primary" onClick={endTour}>Done</button>}
          </div>
        </div>
      )}
    </>
  );
}
