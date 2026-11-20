// Loads trades / notes / debriefs for the discipline tools and runs the pure checks in shared/habits.
import pool from '../db';
import { checkRules, RuleSet, RTrade, Window, Violation, disciplineSummary, DayInfo } from '../shared/habits';


/** XP counts from the day the discipline tools shipped; imported history does not earn levels. */
export const XP_START = '2026-11-20';
export async function getRules(accountId: number): Promise<RuleSet> {
  const r = await pool.query('SELECT * FROM account_rules WHERE account_id = $1', [accountId]);
  const x = r.rows[0];
  if (!x) return {};
  const num = (v: unknown) => (v == null ? null : Number(v));
  return { max_trades_day: num(x.max_trades_day), max_losses_day: num(x.max_losses_day), max_contracts: num(x.max_contracts),
    max_daily_loss: num(x.max_daily_loss), start_time: x.start_time, end_time: x.end_time, respect_news: !!x.respect_news };
}

/** Trades of the last `days` days (account wall clock) as rule-check rows. */
export async function ruleTrades(accountId: number, days: number, attempt: number | null = null): Promise<RTrade[]> {
  const r = await pool.query(
    `SELECT t.id, to_char(t.entry_time, 'YYYY-MM-DD') AS day, to_char(t.entry_time, 'HH24:MI') AS time,
            journal_wall_to_utc(t.entry_time, a.timezone) AS utc, COALESCE(t.pnl, 0) AS pnl, COALESCE(t.quantity, 1) AS qty
       FROM trades t JOIN accounts a ON a.id = t.account_id
      WHERE t.account_id = $1 AND t.entry_time >= (NOW() AT TIME ZONE COALESCE(a.timezone, 'America/New_York'))::date - $2::int
        AND ($3::int IS NULL OR t.attempt_id = $3)`, [accountId, days, attempt]);
  return r.rows.map(x => ({ id: x.id, day: x.day, time: x.time, utc: new Date(x.utc).getTime(), pnl: Number(x.pnl), qty: Math.abs(Number(x.qty)) || 1 }));
}

/** News blackout windows (high-impact USD events) around the given trades, from the account's before/after minutes. */
export async function newsWindows(accountId: number, trades: RTrade[]): Promise<Window[]> {
  if (!trades.length) return [];
  const a = await pool.query('SELECT news_blackout_before_min AS b, news_blackout_after_min AS a FROM accounts WHERE id = $1', [accountId]);
  const before = Number(a.rows[0]?.b ?? 2), after = Number(a.rows[0]?.a ?? 2);
  const lo = Math.min(...trades.map(t => t.utc)) - 86400000, hi = Math.max(...trades.map(t => t.utc)) + 86400000;
  const ev = await pool.query(`SELECT release_utc, title FROM econ_events WHERE impact = 'high' AND currency = 'USD' AND release_utc BETWEEN $1 AND $2`,
    [new Date(lo).toISOString(), new Date(hi).toISOString()]);
  return ev.rows.map(e => { const t = new Date(e.release_utc).getTime(); return { start: t - before * 60000, end: t + after * 60000, title: e.title }; });
}

export async function violations(accountId: number, days: number, attempt: number | null = null): Promise<{ rules: RuleSet; list: Violation[] }> {
  const rules = await getRules(accountId);
  const trades = await ruleTrades(accountId, days, attempt);
  const news = rules.respect_news ? await newsWindows(accountId, trades) : [];
  return { rules, list: checkRules(trades, rules, news) };
}

export async function accountToday(accountId: number): Promise<string> {
  const r = await pool.query(`SELECT to_char((NOW() AT TIME ZONE COALESCE(timezone, 'America/New_York'))::date, 'YYYY-MM-DD') AS d FROM accounts WHERE id = $1`, [accountId]);
  return r.rows[0]?.d ?? new Date().toISOString().slice(0, 10);
}

export async function score(userId: number, accountId: number) {
  const DAYS = 400;
  const { list } = await violations(accountId, DAYS);
  const t = await pool.query(
    `SELECT to_char(t.entry_time, 'YYYY-MM-DD') AS day, count(*)::int AS trades, count(d.trade_id)::int AS debriefed
       FROM trades t JOIN accounts a ON a.id = t.account_id LEFT JOIN trade_debriefs d ON d.trade_id = t.id
      WHERE t.account_id = $1 AND t.entry_time >= (NOW() AT TIME ZONE COALESCE(a.timezone, 'America/New_York'))::date - $2::int
      GROUP BY 1`, [accountId, DAYS]);
  const n = await pool.query(
    `SELECT to_char(note_date, 'YYYY-MM-DD') AS day, (COALESCE(TRIM(plan), '') <> '' OR COALESCE(TRIM(setups), '') <> '' OR COALESCE(TRIM(bias), '') <> '') AS plan,
            COALESCE(TRIM(review), '') <> '' AS review
       FROM daily_notes WHERE user_id = $1 AND note_date >= CURRENT_DATE - $2::int`, [userId, DAYS]);
  const days = new Map<string, DayInfo>();
  const get = (d: string) => { let x = days.get(d); if (!x) days.set(d, (x = { day: d, trades: 0, debriefed: 0, violations: 0, plan: false, review: false })); return x; };
  for (const r of t.rows) { const x = get(r.day); x.trades = r.trades; x.debriefed = r.debriefed; }
  for (const r of n.rows) { const x = get(r.day); x.plan = !!r.plan; x.review = !!r.review; }
  for (const v of list) get(v.day).violations++;
  const today = await accountToday(accountId);
  return { ...disciplineSummary([...days.values()], today, XP_START), xpFrom: XP_START, todayDate: today, recentViolations: list.slice(-8).reverse() };
}
