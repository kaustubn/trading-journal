import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import pool from '../db';
import { requirePro } from '../middleware/plan';

const router = Router();

// Build a compact, factual summary of the account's trading for the model to reason over.
async function buildContext(accountId: number, attempt?: any): Promise<string> {
  const params: any[] = [accountId];
  let f = '';
  if (attempt) { params.push(attempt); f = ` AND attempt_id = $${params.length}`; }

  const overall = await pool.query(
    `SELECT COUNT(*)::int n,
            SUM(CASE WHEN pnl>0 THEN 1 ELSE 0 END)::int wins,
            SUM(CASE WHEN pnl<0 THEN 1 ELSE 0 END)::int losses,
            COALESCE(SUM(pnl),0)::numeric net,
            COALESCE(SUM(CASE WHEN pnl>0 THEN pnl ELSE 0 END),0)::numeric gwin,
            COALESCE(SUM(CASE WHEN pnl<0 THEN pnl ELSE 0 END),0)::numeric gloss,
            MAX(pnl) best, MIN(pnl) worst,
            COUNT(DISTINCT DATE(entry_time))::int days
     FROM trades WHERE account_id=$1 AND pnl IS NOT NULL${f}`, params);
  const o = overall.rows[0];
  if (!o || o.n === 0) return 'NO_DATA';

  const bySetup = await pool.query(
    `SELECT COALESCE(NULLIF(setup_tag,''),'(untagged)') setup, COUNT(*)::int n,
            SUM(CASE WHEN pnl>0 THEN 1 ELSE 0 END)::int wins, COALESCE(SUM(pnl),0)::numeric net
     FROM trades WHERE account_id=$1 AND pnl IS NOT NULL${f}
     GROUP BY 1 ORDER BY net ASC`, params);

  const byHour = await pool.query(
    `SELECT EXTRACT(HOUR FROM entry_time)::int hr, COUNT(*)::int n, COALESCE(SUM(pnl),0)::numeric net
     FROM trades WHERE account_id=$1 AND pnl IS NOT NULL${f}
     GROUP BY 1 ORDER BY net ASC`, params);

  const byDow = await pool.query(
    `SELECT EXTRACT(DOW FROM entry_time)::int d, COUNT(*)::int n, COALESCE(SUM(pnl),0)::numeric net
     FROM trades WHERE account_id=$1 AND pnl IS NOT NULL${f}
     GROUP BY 1 ORDER BY net ASC`, params);

  const byGrade = await pool.query(
    `SELECT grade, COUNT(*)::int n, COALESCE(SUM(pnl),0)::numeric net
     FROM trades WHERE account_id=$1 AND pnl IS NOT NULL AND grade IS NOT NULL AND grade<>''${f}
     GROUP BY 1 ORDER BY grade`, params);

  const perDay = await pool.query(
    `SELECT to_char(DATE(entry_time),'YYYY-MM-DD') d, COUNT(*)::int n, COALESCE(SUM(pnl),0)::numeric net
     FROM trades WHERE account_id=$1 AND pnl IS NOT NULL${f}
     GROUP BY 1 ORDER BY d DESC LIMIT 10`, params);

  const n = o.n, wins = o.wins, losses = o.losses;
  const net = Number(o.net), gwin = Number(o.gwin), gloss = Number(o.gloss);
  const pf = gloss !== 0 ? (gwin / Math.abs(gloss)).toFixed(2) : '∞';
  const winRate = n ? ((wins / n) * 100).toFixed(0) : '0';
  const avgWin = wins ? (gwin / wins).toFixed(2) : '0';
  const avgLoss = losses ? (gloss / losses).toFixed(2) : '0';
  const tradesPerDay = o.days ? (n / o.days).toFixed(1) : '0';
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const lines: string[] = [];
  lines.push(`OVERALL: ${n} trades over ${o.days} days (${tradesPerDay}/day). Net $${net.toFixed(2)}. Win rate ${winRate}% (${wins}W/${losses}L). Profit factor ${pf}. Avg win $${avgWin}, avg loss $${avgLoss}. Best $${Number(o.best).toFixed(2)}, worst $${Number(o.worst).toFixed(2)}.`);
  lines.push(`BY SETUP (worst→best net): ` + bySetup.rows.map((r: any) => `${r.setup} ${r.n}t ${r.n ? Math.round((r.wins / r.n) * 100) : 0}%wr $${Number(r.net).toFixed(0)}`).join(' | '));
  lines.push(`BY HOUR (worst→best net, local server hour): ` + byHour.rows.map((r: any) => `${r.hr}:00 ${r.n}t $${Number(r.net).toFixed(0)}`).join(' | '));
  lines.push(`BY WEEKDAY: ` + byDow.rows.map((r: any) => `${DOW[r.d]} ${r.n}t $${Number(r.net).toFixed(0)}`).join(' | '));
  if (byGrade.rows.length) lines.push(`BY GRADE: ` + byGrade.rows.map((r: any) => `${r.grade} ${r.n}t $${Number(r.net).toFixed(0)}`).join(' | '));
  lines.push(`LAST 10 DAYS: ` + perDay.rows.map((r: any) => `${r.d}: ${r.n}t $${Number(r.net).toFixed(0)}`).join(' | '));
  return lines.join('\n');
}

const SYSTEM = `You are a sharp, direct trading coach for a retail futures scalper trading NQ/MNQ (and prop-firm challenges). You are given the trader's REAL aggregated statistics. Coach from the numbers only — cite specific figures. Be concrete and blunt, not generic. Prioritize the single biggest leak. Give 2-4 specific, actionable changes. Prop context: consistency, drawdown discipline, and overtrading are what blow challenges. Keep replies under ~220 words. Never invent numbers not present in the data. If asked something the data can't answer, say so.`;

router.post('/coach', requirePro('the AI coach'), async (req: Request, res: Response) => {
  try {
    const user_id = req.userId!;
    const { account_id, attempt, question, history } = req.body || {};
    if (!account_id || !question) return res.status(400).json({ error: 'account_id and question required' });

    const own = await pool.query('SELECT id, account_name FROM accounts WHERE id=$1 AND user_id=$2', [account_id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.json({ configured: false, answer: 'AI coach is not configured yet. The server needs an ANTHROPIC_API_KEY environment variable set on Railway. Once that is added, I can analyze your trades and answer questions.' });
    }

    const context = await buildContext(Number(account_id), attempt);
    if (context === 'NO_DATA') {
      return res.json({ configured: true, answer: "There's no trade data for this account/attempt yet. Import your trades first, then ask me anything." });
    }

    const priorTurns = Array.isArray(history)
      ? history.filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
              .slice(-8)
              .map((m: any) => ({ role: m.role, content: m.content }))
      : [];

    const anthropic = new Anthropic();
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1200,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [
        { role: 'user', content: `Here is my trading data for account "${own.rows[0].account_name}":\n\n${context}` },
        { role: 'assistant', content: 'Got it — I have your stats in front of me. What do you want to work on?' },
        ...priorTurns,
        { role: 'user', content: String(question) },
      ],
    });

    const answer = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
    res.json({ configured: true, answer: answer || 'No response.' });
  } catch (error: any) {
    const emsg = String(error?.message || error);
    console.error('Coach error:', emsg);
    // Fail gracefully for common operational issues so the UI shows a clean message, not a 500
    if (/credit balance|billing/i.test(emsg)) {
      return res.json({ configured: false, answer: 'The AI coach is temporarily unavailable — the server needs Anthropic API credits topped up. Everything else works normally.' });
    }
    if (/rate.?limit|429|overloaded|529/i.test(emsg)) {
      return res.json({ configured: true, answer: 'The coach is busy right now. Give it a few seconds and ask again.' });
    }
    res.status(500).json({ error: 'Coach failed. Please try again.' });
  }
});

export default router;
