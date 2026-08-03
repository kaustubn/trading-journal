import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// GET /api/discipline?account_id=  → plan adherence + grade discipline + weekly trend
router.get('/discipline', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId;
    const account_id = req.query.account_id ? parseInt(String(req.query.account_id)) : null;

    // Plan adherence (per-user, from pre-market notes)
    const notes = await pool.query(
      `SELECT followed_plan, to_char(note_date,'IYYY-IW') AS wk FROM daily_notes
       WHERE user_id = $1 AND followed_plan IS NOT NULL`,
      [user_id]
    );
    const notesTotal = notes.rows.length;
    const notesFollowed = notes.rows.filter(n => n.followed_plan === true).length;
    const adherencePct = notesTotal ? (notesFollowed / notesTotal) * 100 : 0;

    // Grade discipline (per-account trades)
    let gradedTotal = 0, aC = 0, bC = 0, cC = 0;
    const weekGrade = new Map<string, { a: number; total: number }>();
    if (account_id) {
      const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [account_id, user_id]);
      if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });
      const tr = await pool.query(
        `SELECT grade, to_char(entry_time,'IYYY-IW') AS wk FROM trades
         WHERE account_id = $1 AND grade IS NOT NULL`,
        [account_id]
      );
      for (const r of tr.rows) {
        gradedTotal++;
        if (r.grade === 'A') aC++; else if (r.grade === 'B') bC++; else if (r.grade === 'C') cC++;
        const w = weekGrade.get(r.wk) || { a: 0, total: 0 };
        w.total++; if (r.grade === 'A') w.a++; weekGrade.set(r.wk, w);
      }
    }
    const aPct = gradedTotal ? (aC / gradedTotal) * 100 : 0;
    const bPct = gradedTotal ? (bC / gradedTotal) * 100 : 0;
    const cPct = gradedTotal ? (cC / gradedTotal) * 100 : 0;

    // Weekly adherence
    const weekAdh = new Map<string, { f: number; total: number }>();
    for (const n of notes.rows) {
      const w = weekAdh.get(n.wk) || { f: 0, total: 0 };
      w.total++; if (n.followed_plan === true) w.f++; weekAdh.set(n.wk, w);
    }

    const weeks = Array.from(new Set([...weekGrade.keys(), ...weekAdh.keys()])).sort();
    const byWeek = weeks.map(wk => {
      const g = weekGrade.get(wk);
      const a = weekAdh.get(wk);
      return {
        week: wk,
        aPct: g ? Number(((g.a / g.total) * 100).toFixed(0)) : null,
        adherencePct: a ? Number(((a.f / a.total) * 100).toFixed(0)) : null,
        trades: g?.total || 0,
      };
    });

    // Trend: compare last 3 weeks vs prior 3 weeks (A% + adherence)
    const scoreAt = (arr: any[]) => {
      const g = arr.filter(x => x.aPct != null);
      const a = arr.filter(x => x.adherencePct != null);
      const gAvg = g.length ? g.reduce((s, x) => s + x.aPct, 0) / g.length : 0;
      const aAvg = a.length ? a.reduce((s, x) => s + x.adherencePct, 0) / a.length : 0;
      return (gAvg + aAvg) / 2;
    };
    const recent = byWeek.slice(-3), prior = byWeek.slice(-6, -3);
    const trend = byWeek.length >= 4 ? scoreAt(recent) - scoreAt(prior) : 0;

    const planScore = adherencePct;
    const gradeScore = aPct + 0.5 * bPct;
    const disciplineScore = Math.round((gradedTotal || notesTotal) ? ((planScore + gradeScore) / (notesTotal && gradedTotal ? 2 : 1)) : 0);

    res.json({
      data: {
        disciplineScore: Math.min(100, disciplineScore),
        adherencePct: Number(adherencePct.toFixed(0)), notesFollowed, notesTotal,
        aPct: Number(aPct.toFixed(0)), bPct: Number(bPct.toFixed(0)), cPct: Number(cPct.toFixed(0)),
        gradedTotal,
        trend: Number(trend.toFixed(0)),
        byWeek,
      },
    });
  } catch (error: any) {
    console.error('Discipline error:', error);
    res.status(500).json({ error: 'Failed to compute discipline' });
  }
});

// GET /api/overtrading/:account_id → typical trades/day + threshold to flag overtrading
router.get('/overtrading/:account_id', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId;
    const account_id = parseInt(String(req.params.account_id));
    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [account_id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });

    const r = await pool.query(
      `SELECT COUNT(*)::int AS c FROM trades
       WHERE account_id = $1 AND pnl IS NOT NULL
       GROUP BY DATE(entry_time)`,
      [account_id]
    );
    const counts = r.rows.map(x => x.c).sort((a, b) => a - b);
    if (counts.length === 0) return res.json({ data: { avgPerDay: 0, medianPerDay: 0, maxPerDay: 0, threshold: 0, days: 0 } });
    const avg = counts.reduce((s, x) => s + x, 0) / counts.length;
    const median = counts[Math.floor(counts.length / 2)];
    const max = counts[counts.length - 1];
    // Threshold: 1.5× the median (robust to outliers), min avg+2
    const threshold = Math.max(Math.ceil(median * 1.5), Math.ceil(avg) + 2);
    res.json({ data: { avgPerDay: Number(avg.toFixed(1)), medianPerDay: median, maxPerDay: max, threshold, days: counts.length } });
  } catch (error: any) {
    console.error('Overtrading error:', error);
    res.status(500).json({ error: 'Failed to compute overtrading' });
  }
});

export default router;
