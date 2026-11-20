// Discipline tools: personal risk rules, post-trade debriefs and the discipline score / XP / streaks.
// Pure functions (no I/O), shared by the server and the tests.

// ------------------------------------------------------------------ personal risk rules
export interface RuleSet {
  max_trades_day?: number | null;    // trades per day
  max_losses_day?: number | null;    // stop after this many losing trades in a day
  max_contracts?: number | null;     // per trade
  max_daily_loss?: number | null;    // $ (positive number); stop once the day is down this much
  start_time?: string | null;        // 'HH:MM' account wall clock: no trades before
  end_time?: string | null;          // 'HH:MM': no trades after
  respect_news?: boolean;            // no trades inside the account's news blackout windows
}
export interface RTrade { id: number; day: string; time: string; utc: number; pnl: number; qty: number }
export interface Window { start: number; end: number; title: string }
export interface Violation { day: string; rule: RuleKey; detail: string; trade_ids: number[] }
export type RuleKey = 'max_trades_day' | 'max_losses_day' | 'max_contracts' | 'max_daily_loss' | 'hours' | 'news';
export const RULE_LABEL: Record<RuleKey, string> = {
  max_trades_day: 'Too many trades', max_losses_day: 'Kept trading after the loss limit', max_contracts: 'Size too big',
  max_daily_loss: 'Daily loss limit', hours: 'Outside your trading hours', news: 'Traded in a news blackout',
};
const pos = (v: number | null | undefined) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** All rule breaks, per day, in time order. Trades are judged in the order they were entered. */
export function checkRules(trades: RTrade[], rules: RuleSet, news: Window[] = []): Violation[] {
  const out: Violation[] = [];
  const byDay = new Map<string, RTrade[]>();
  for (const t of trades) { const a = byDay.get(t.day) ?? []; a.push(t); byDay.set(t.day, a); }
  for (const [day, list] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => a.utc - b.utc || a.id - b.id);
    if (pos(rules.max_trades_day) && list.length > rules.max_trades_day!) {
      const extra = list.slice(rules.max_trades_day!);
      out.push({ day, rule: 'max_trades_day', detail: `${list.length} trades (your limit is ${rules.max_trades_day})`, trade_ids: extra.map(t => t.id) });
    }
    if (pos(rules.max_losses_day)) {
      let losses = 0; const after: RTrade[] = [];
      for (const t of list) { if (losses >= rules.max_losses_day!) after.push(t); if (t.pnl < 0) losses++; }
      if (after.length) out.push({ day, rule: 'max_losses_day', detail: `${after.length} trade${after.length > 1 ? 's' : ''} after ${rules.max_losses_day} losing trade${rules.max_losses_day! > 1 ? 's' : ''}`, trade_ids: after.map(t => t.id) });
    }
    if (pos(rules.max_daily_loss)) {
      let run = 0; const after: RTrade[] = []; let hit = false;
      for (const t of list) { if (hit) after.push(t); run += t.pnl; if (run <= -rules.max_daily_loss!) hit = true; }
      const total = list.reduce((a, t) => a + t.pnl, 0);
      if (after.length || total < -rules.max_daily_loss!) {
        out.push({ day, rule: 'max_daily_loss', trade_ids: after.map(t => t.id),
          detail: after.length ? `${after.length} trade${after.length > 1 ? 's' : ''} after the day was down $${rules.max_daily_loss}` : `day closed at -$${Math.abs(Math.round(total))} (limit $${rules.max_daily_loss})` });
      }
    }
    if (pos(rules.max_contracts)) {
      const big = list.filter(t => t.qty > rules.max_contracts!);
      if (big.length) out.push({ day, rule: 'max_contracts', detail: `${big.length} trade${big.length > 1 ? 's' : ''} above ${rules.max_contracts} contracts (largest ${Math.max(...big.map(t => t.qty))})`, trade_ids: big.map(t => t.id) });
    }
    if (rules.start_time || rules.end_time) {
      const bad = list.filter(t => (rules.start_time && t.time < rules.start_time) || (rules.end_time && t.time > rules.end_time));
      if (bad.length) out.push({ day, rule: 'hours', detail: `${bad.length} trade${bad.length > 1 ? 's' : ''} outside ${rules.start_time || '…'}–${rules.end_time || '…'}`, trade_ids: bad.map(t => t.id) });
    }
    if (rules.respect_news && news.length) {
      const bad = list.filter(t => news.some(w => t.utc >= w.start && t.utc <= w.end));
      if (bad.length) {
        const titles = [...new Set(bad.map(t => news.find(w => t.utc >= w.start && t.utc <= w.end)!.title))];
        out.push({ day, rule: 'news', detail: `${bad.length} trade${bad.length > 1 ? 's' : ''} around ${titles.slice(0, 2).join(', ')}`, trade_ids: bad.map(t => t.id) });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ debriefs
export const EMOTIONS = ['calm', 'confident', 'fomo', 'fearful', 'revenge', 'bored', 'tired', 'greedy'] as const;
export type Emotion = typeof EMOTIONS[number];
export const EMOTION_LABEL: Record<Emotion, string> = {
  calm: 'Calm', confident: 'Confident', fomo: 'FOMO / chasing', fearful: 'Fearful / hesitant', revenge: 'Revenge',
  bored: 'Bored', tired: 'Tired', greedy: 'Greedy',
};
export interface DebriefRow { pnl: number; emotion: string | null; followed_plan: boolean | null; retake: boolean | null; quality: number | null }
export interface Group { key: string; n: number; winRate: number; avgPnl: number; total: number }
const group = (rows: DebriefRow[], key: (r: DebriefRow) => string | null): Group[] => {
  const m = new Map<string, DebriefRow[]>();
  for (const r of rows) { const k = key(r); if (k == null) continue; const a = m.get(k) ?? []; a.push(r); m.set(k, a); }
  return [...m.entries()].map(([k, a]) => {
    const total = a.reduce((s, r) => s + r.pnl, 0);
    return { key: k, n: a.length, winRate: (100 * a.filter(r => r.pnl > 0).length) / a.length, avgPnl: total / a.length, total };
  }).sort((x, y) => y.n - x.n);
};
/** Results by emotion, by "followed my plan" and by "would take it again". */
export function debriefStats(rows: DebriefRow[]) {
  return {
    n: rows.length,
    byEmotion: group(rows, r => r.emotion),
    byPlan: group(rows, r => (r.followed_plan == null ? null : r.followed_plan ? 'followed' : 'broke')),
    byRetake: group(rows, r => (r.retake == null ? null : r.retake ? 'yes' : 'no')),
  };
}

// ------------------------------------------------------------------ discipline score, XP, streaks
export interface DayInfo { day: string; trades: number; debriefed: number; violations: number; plan: boolean; review: boolean }
export const XP = { trade: 10, debrief: 15, plan: 15, review: 50, cleanDay: 20, violation: -25 };
export const LEVELS = [
  { name: 'New', xp: 0 }, { name: 'Learning', xp: 100 }, { name: 'Steady', xp: 250 }, { name: 'Focused', xp: 450 },
  { name: 'Consistent', xp: 700 }, { name: 'Disciplined', xp: 1000 }, { name: 'Professional', xp: 1400 },
  { name: 'Seasoned', xp: 1900 }, { name: 'Elite', xp: 2500 }, { name: 'Master', xp: 3200 },
];
export function dayXp(d: DayInfo): number {
  const trades = Math.min(d.trades, 10);   // no XP for overtrading
  return trades * XP.trade + Math.min(d.debriefed, 10) * XP.debrief + (d.plan ? XP.plan : 0) + (d.review ? XP.review : 0)
    + (d.trades > 0 && d.violations === 0 ? XP.cleanDay : 0) + d.violations * XP.violation;
}
export function levelOf(xp: number) {
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (xp >= LEVELS[k].xp) i = k;
  const next = LEVELS[i + 1] ?? null;
  return { index: i + 1, name: LEVELS[i].name, floor: LEVELS[i].xp, next: next ? next.xp : null, nextName: next?.name ?? null };
}
const weekday = (d: string) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return w !== 0 && w !== 6; };
const prevDay = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

export interface Challenge { key: string; title: string; progress: number; goal: number; done: boolean }
/**
 * days: one entry per day with any activity (trades, plan or review), any order. today: 'YYYY-MM-DD' (account clock).
 * xpFrom: first day that earns XP ('' = all).
 * Score (0-100) over the last 20 trading days: 50% rule-free days, 30% trades debriefed, 20% days reviewed.
 */
export function disciplineSummary(days: DayInfo[], today: string, xpFrom = '') {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  // XP is earned from xpFrom on (imported history does not count), the score and streaks use all days
  const xp = Math.max(0, sorted.filter(d => d.day >= xpFrom).reduce((a, d) => a + dayXp(d), 0));
  const tradingDays = sorted.filter(d => d.trades > 0);
  const last = tradingDays.slice(-20);
  let score: number | null = null;
  if (last.length) {
    const clean = last.filter(d => d.violations === 0).length / last.length;
    const tr = last.reduce((a, d) => a + d.trades, 0);
    const deb = tr ? Math.min(1, last.reduce((a, d) => a + Math.min(d.debriefed, d.trades), 0) / tr) : 0;
    const rev = last.filter(d => d.review).length / last.length;
    score = Math.round(100 * (0.5 * clean + 0.3 * deb + 0.2 * rev));
  }
  // streaks, counted back from the latest trading day
  const streak = (ok: (d: DayInfo) => boolean) => { let n = 0; for (let i = tradingDays.length - 1; i >= 0 && ok(tradingDays[i]); i--) n++; return n; };
  const byDay = new Map(sorted.map(d => [d.day, d]));
  let planStreak = 0;
  for (let d = today, guard = 0; guard < 400; d = prevDay(d), guard++) {
    if (!weekday(d)) continue;
    if (byDay.get(d)?.plan) planStreak++;
    else if (d === today) continue;          // today's plan may still come
    else break;
  }
  const month = today.slice(0, 7);
  const m = sorted.filter(d => d.day.startsWith(month));
  const ch = (key: string, title: string, progress: number, goal: number): Challenge => ({ key, title, progress: Math.min(progress, goal), goal, done: progress >= goal });
  const challenges = [
    ch('debrief', 'Debrief 20 trades this month', m.reduce((a, d) => a + d.debriefed, 0), 20),
    ch('clean', '10 trading days with no rule breaks', m.filter(d => d.trades > 0 && d.violations === 0).length, 10),
    ch('review', 'Write 12 end-of-day reviews', m.filter(d => d.review).length, 12),
    ch('plan', 'Plan 15 sessions before the open', m.filter(d => d.plan).length, 15),
  ];
  return {
    xp, level: levelOf(xp), score,
    scoreParts: last.length ? { days: last.length } : null,
    streaks: {
      ruleFree: streak(d => d.violations === 0),
      journal: streak(d => d.review || (d.trades > 0 && d.debriefed >= d.trades)),
      plan: planStreak,
    },
    challenges,
    today: byDay.get(today) ? dayXp(byDay.get(today)!) : 0,
  };
}
