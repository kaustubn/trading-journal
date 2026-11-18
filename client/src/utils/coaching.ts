// Rule-based coaching: turns the journal's own analytics into
// "Insight -> Why it matters -> What to do next" cards.
// No AI / no paid API: every rule is a plain threshold on Kay's data.
// Thresholds are named constants so they are easy to tune (and are
// documented in DESIGN_REVIEW.md).
import { money, num } from './format';

export const RULES = {
  MIN_TRADES: 20,            // below this, numbers are noise: ask for more data
  SETUP_MIN_TRADES: 10,      // a setup needs this many trades before we judge it
  SETUP_LEAK_PF: 0.9,        // losing setup: PF below this and net < 0
  SETUP_EDGE_PF: 1.3,        // edge setup: PF at/above this and net > 0
  HOUR_MIN_TRADES: 10,       // hour bucket needs this many trades
  DOW_MIN_TRADES: 10,
  DOW_SHARE_OF_LOSS: 0.25,   // weekday must hold >=25% of all losing-weekday losses
  EMOTION_MIN_TRADES: 3,
  GRADE_C_MIN_TRADES: 5,
  PAYOFF_GAP: 1.15,          // avg loss > 1.15x avg win ...
  PAYOFF_MAX_WINRATE: 60,    // ... and win rate under 60%
  UNTAGGED_SHARE: 0.5,       // >50% of trades without a setup tag
  RULE_BREAK_RE: /rule.?break|broke.?(my.?)?rules?|mistake/i,
};

export type Severity = 'leak' | 'edge' | 'habit' | 'info';
export interface CoachLink { label: string; view: string }
export interface Insight {
  id: string;
  severity: Severity;
  title: string;      // Insight
  why: string;        // Why it matters
  action: string;     // What to do next
  impact: number;     // $ size used for ranking (bigger first)
  links: CoachLink[];
}

export interface CoachData {
  overview?: any;             // /api/overview
  setups?: any[];             // /api/setups?groupBy=setup
  tags?: any[];               // /api/setups?groupBy=tag
  grades?: any[];             // /api/setups?groupBy=grade
  breakdown?: any;            // /api/breakdown  { symbols, dows, hours }
  emotions?: any;             // /api/emotions   { rows, summary }
  isAdmin?: boolean;          // Market Chart is owner-only
}

const pf = (v: any) => (num(v) >= 999 ? '∞' : num(v).toFixed(2));
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;

export function buildInsights(d: CoachData): { headline: string | null; insights: Insight[]; enoughData: boolean } {
  const o = d.overview;
  const total = num(o?.totalTrades);
  const out: Insight[] = [];
  const practice: CoachLink[] = d.isAdmin ? [{ label: 'Practise on Market Chart', view: 'marketchart' }] : [];

  if (!o || !o.hasData || total < RULES.MIN_TRADES) {
    out.push({
      id: 'more-data', severity: 'info', impact: 0,
      title: total ? `Only ${total} trades so far — keep logging` : 'No trades logged yet',
      why: `Patterns only become reliable after about ${RULES.MIN_TRADES}–30 trades. Before that, one lucky or unlucky trade swings every number.`,
      action: 'Import your broker CSV or add each trade after you close it. Tag the setup and how you felt — that is what the coach reads.',
      links: [{ label: 'Open trade log', view: 'data' }, { label: 'Plan tomorrow', view: 'premarket' }],
    });
    return { headline: null, insights: out, enoughData: false };
  }

  // Headline: one sentence on where he stands overall
  const exp = num(o.expectancy);
  const headline = exp >= 0
    ? `Each trade is worth ${money(exp, 0)} on average (profit factor ${pf(o.profitFactor)}). Protect what works and trim what doesn't.`
    : `Each trade currently loses ${money(Math.abs(exp), 0)} on average (profit factor ${pf(o.profitFactor)}). Fix the biggest leak below first — one change at a time.`;

  // 1. Rule breaks (tagged by Kay) — avoidable losses get priority
  const rb = (d.tags || []).filter((t: any) => RULES.RULE_BREAK_RE.test(String(t.key)));
  if (rb.length) {
    const n = rb.reduce((s: number, t: any) => s + num(t.trades), 0);
    const net = rb.reduce((s: number, t: any) => s + num(t.totalPnl), 0);
    if (net < 0) out.push({
      id: 'rule-break', severity: 'habit', impact: Math.abs(net) * 1.5,
      title: `Rule breaks cost you ${money(Math.abs(net), 0)} over ${n} trade${n === 1 ? '' : 's'}`,
      why: `These are trades you tagged as breaking your own rules — about ${money(Math.abs(net / n), 0)} lost each. They are the easiest money to get back.`,
      action: 'Before every entry, run the Entry checklist. If any gate fails, there is no trade — write down why you wanted it instead.',
      links: [{ label: 'Open checklist', view: 'checklist' }, { label: 'See emotions', view: 'emotions' }],
    });
  }

  // 2. Losing setup
  const minSetup = Math.max(RULES.SETUP_MIN_TRADES, Math.min(30, Math.round(total * 0.02)));
  const realSetups = (d.setups || []).filter((s: any) => s.key !== 'Untagged' && num(s.trades) >= minSetup);
  const leak = realSetups.filter((s: any) => num(s.totalPnl) < 0 && num(s.profitFactor) < RULES.SETUP_LEAK_PF)
    .sort((a: any, b: any) => num(a.totalPnl) - num(b.totalPnl))[0];
  if (leak) {
    const without = num(o.netPnl) - num(leak.totalPnl);
    out.push({
      id: 'setup-leak', severity: 'leak', impact: Math.abs(num(leak.totalPnl)),
      title: `"${leak.key}" is losing ${money(Math.abs(num(leak.totalPnl)), 0)} over ${leak.trades} trades`,
      why: `Profit factor ${pf(leak.profitFactor)}, win rate ${num(leak.winRate).toFixed(0)}% — an average ${leak.key} trade costs ${money(Math.abs(num(leak.expectancy)), 0)}. Without it, net P&L would be ${money(without, 0)}.`,
      action: `Pause ${leak.key} for the next 2 weeks (or take it only when it grades A). Re-test its rules in Backtest Lab before trading it live again.`,
      links: [{ label: 'Setup results', view: 'setups' }, { label: 'Backtest Lab', view: 'backtestlab' }],
    });
  }

  // 3. Edge setup (positive reinforcement)
  const edge = realSetups.filter((s: any) => num(s.totalPnl) > 0 && num(s.profitFactor) >= RULES.SETUP_EDGE_PF && num(s.expectancy) > 0)
    .sort((a: any, b: any) => num(b.totalPnl) - num(a.totalPnl))[0];
  if (edge) out.push({
    id: 'setup-edge', severity: 'edge', impact: num(edge.totalPnl) * 0.6,
    title: `Your edge: "${edge.key}" makes ${money(edge.expectancy, 0)} per trade`,
    why: `Profit factor ${pf(edge.profitFactor)} and ${num(edge.winRate).toFixed(0)}% wins over ${edge.trades} trades. This setup is paying for the rest.`,
    action: `Make ${edge.key} your A-setup: look for it first each session and size it fully; size everything else down until it proves itself.`,
    links: [{ label: 'Setup results', view: 'setups' }, ...practice],
  });

  // 4. Time-of-day leak
  const hours = (d.breakdown?.hours || []).filter((h: any) => num(h.trades) >= RULES.HOUR_MIN_TRADES);
  const worstH = [...hours].sort((a: any, b: any) => num(a.pnl) - num(b.pnl))[0];
  const bestH = [...hours].sort((a: any, b: any) => num(b.pnl) - num(a.pnl))[0];
  if (worstH && num(worstH.pnl) < 0) out.push({
    id: 'hour-leak', severity: 'leak', impact: Math.abs(num(worstH.pnl)),
    title: `${hourLabel(num(worstH.hour))} is your costliest hour: ${money(num(worstH.pnl), 0)}`,
    why: `${worstH.trades} trades in that hour with a ${num(worstH.winRate).toFixed(0)}% win rate.${bestH && num(bestH.pnl) > 0 ? ` Your best hour, ${hourLabel(num(bestH.hour))}, made ${money(bestH.pnl, 0)}.` : ''}`,
    action: `Stop opening new trades during ${hourLabel(num(worstH.hour))} for two weeks, then compare. Times are in the clock your trades were recorded in.`,
    links: [{ label: 'Time & sessions', view: 'breakdown' }],
  });

  // 5. Weekday leak (only if it carries a big share of losses)
  const dows = (d.breakdown?.dows || []).filter((x: any) => num(x.trades) >= RULES.DOW_MIN_TRADES);
  const lossSum = dows.filter((x: any) => num(x.pnl) < 0).reduce((s: number, x: any) => s + Math.abs(num(x.pnl)), 0);
  const worstD = [...dows].sort((a: any, b: any) => num(a.pnl) - num(b.pnl))[0];
  if (worstD && num(worstD.pnl) < 0 && lossSum > 0 && Math.abs(num(worstD.pnl)) / lossSum >= RULES.DOW_SHARE_OF_LOSS && dows.length >= 3) out.push({
    id: 'dow-leak', severity: 'leak', impact: Math.abs(num(worstD.pnl)) * 0.7,
    title: `${worstD.key}s cost you ${money(Math.abs(num(worstD.pnl)), 0)}`,
    why: `${Math.round(Math.abs(num(worstD.pnl)) / lossSum * 100)}% of all your losing-weekday losses happen on ${worstD.key} (${worstD.trades} trades, ${num(worstD.winRate).toFixed(0)}% wins).`,
    action: `On ${worstD.key}s, trade half size or only your A-setup until the day turns positive.`,
    links: [{ label: 'Time & sessions', view: 'breakdown' }],
  });

  // 6. Negative emotion
  const emo = (d.emotions?.rows || []).filter((r: any) => r.neg && num(r.trades) >= RULES.EMOTION_MIN_TRADES && num(r.net) < 0)
    .sort((a: any, b: any) => num(a.net) - num(b.net))[0];
  if (emo) out.push({
    id: 'emotion', severity: 'habit', impact: Math.abs(num(emo.net)) * 1.2,
    title: `Trades tagged "${emo.label}" lost ${money(Math.abs(num(emo.net)), 0)}`,
    why: `${emo.trades} trades, ${num(emo.winRate).toFixed(0)}% win rate, ${money(num(emo.avg), 0)} per trade. The setup was not the problem — the state of mind was.`,
    action: `When you notice "${emo.label}", stand up and step away for 10 minutes before the next order. Keep tagging it so you can watch the number shrink.`,
    links: [{ label: 'Emotions', view: 'emotions' }],
  });

  // 7. C-grade trades
  const c = (d.grades || []).find((g: any) => g.key === 'C-grade');
  if (c && num(c.trades) >= RULES.GRADE_C_MIN_TRADES && num(c.totalPnl) < 0) out.push({
    id: 'grade-c', severity: 'habit', impact: Math.abs(num(c.totalPnl)),
    title: `C-grade trades lost ${money(Math.abs(num(c.totalPnl)), 0)} (${c.trades} trades)`,
    why: 'Your checklist already says C = no trade. These are losses your own rules predicted.',
    action: 'Only take A and B setups. If you catch yourself grading a trade C after entry, close it at the first chance.',
    links: [{ label: 'Discipline', view: 'discipline' }, { label: 'Checklist', view: 'checklist' }],
  });

  // 8. Payoff: losers bigger than winners
  const aw = num(o.avgWin), al = Math.abs(num(o.avgLoss)), wr = num(o.winRate);
  if (aw > 0 && al > aw * RULES.PAYOFF_GAP && wr < RULES.PAYOFF_MAX_WINRATE) {
    const be = (al / (aw + al)) * 100;
    out.push({
      id: 'payoff', severity: 'leak', impact: (al - aw) * Math.min(num(o.wins), num(o.losses)) * 0.5,
      title: 'Your losing trades are bigger than your winners',
      why: `Average loss ${money(al, 0)} vs average win ${money(aw, 0)}. At that size you need a ${be.toFixed(0)}% win rate just to break even — you are at ${wr.toFixed(0)}%.`,
      action: 'Place the stop before you enter and never widen it. Aim for targets at least 1.5× your stop. Save the stop on each trade so the journal can show R.',
      links: [{ label: 'Risk & sizing', view: 'risk' }, ...practice],
    });
  }

  out.sort((a, b) => b.impact - a.impact);

  // 9. Data hygiene (only if there's room)
  const untagged = (d.setups || []).find((s: any) => s.key === 'Untagged');
  if (untagged && num(untagged.trades) / total > RULES.UNTAGGED_SHARE && out.length < 3) out.push({
    id: 'untagged', severity: 'info', impact: 0,
    title: `${Math.round(num(untagged.trades) / total * 100)}% of trades have no setup tag`,
    why: 'Without setup tags the coach cannot tell which of your setups works and which is costing you.',
    action: 'Open the trade log, tick several trades and tag them in one go. Two minutes after each session is enough.',
    links: [{ label: 'Open trade log', view: 'data' }],
  });

  return { headline, insights: out, enoughData: true };
}
