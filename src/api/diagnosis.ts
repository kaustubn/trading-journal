import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

interface Stats {
  trades: number; wins: number; losses: number; winRate: number;
  netPnl: number; avgWin: number; avgLoss: number; profitFactor: number;
  expectancy: number; tradingDays: number; tradesPerDay: number;
  avgHoldMin: number; pctA: number; pctB: number; pctC: number;
  bySymbol: Map<string, number>; bySetup: Map<string, { trades: number; wins: number; pnl: number }>;
}

function symbolRoot(sym: string): string {
  let s = sym.replace(/^[A-Z_]+:/, '');
  const m = s.match(/^([A-Za-z]+?)[0-9!]/);
  if (m) return m[1].toUpperCase();
  return s.replace(/-(EQ|BE|BZ|GS)$/i, '').toUpperCase();
}

async function computeStats(account_id: number): Promise<Stats | null> {
  const tr = await pool.query(
    `SELECT pnl, symbol, setup_tag, grade,
            EXTRACT(EPOCH FROM (exit_time - entry_time))/60 AS hold_min,
            to_char(DATE(entry_time),'YYYY-MM-DD') AS d
     FROM trades WHERE account_id = $1 AND pnl IS NOT NULL`,
    [account_id]
  );
  const rows = tr.rows;
  if (rows.length === 0) return null;

  let wins = 0, losses = 0, gp = 0, gl = 0, net = 0, holdSum = 0, holdN = 0;
  let a = 0, b = 0, c = 0, graded = 0;
  const days = new Set<string>();
  const bySymbol = new Map<string, number>();
  const bySetup = new Map<string, { trades: number; wins: number; pnl: number }>();

  for (const r of rows) {
    const p = Number(r.pnl);
    net += p; days.add(r.d);
    if (p > 0) { wins++; gp += p; } else if (p < 0) { losses++; gl += Math.abs(p); }
    if (r.hold_min != null && Number.isFinite(Number(r.hold_min))) { holdSum += Number(r.hold_min); holdN++; }
    if (r.grade === 'A') { a++; graded++; } else if (r.grade === 'B') { b++; graded++; } else if (r.grade === 'C') { c++; graded++; }
    const root = symbolRoot(r.symbol);
    bySymbol.set(root, (bySymbol.get(root) || 0) + p);
    const st = r.setup_tag || 'Untagged';
    const s = bySetup.get(st) || { trades: 0, wins: 0, pnl: 0 };
    s.trades++; s.pnl += p; if (p > 0) s.wins++; bySetup.set(st, s);
  }

  const n = rows.length;
  return {
    trades: n, wins, losses,
    winRate: (wins / n) * 100,
    netPnl: net,
    avgWin: wins ? gp / wins : 0,
    avgLoss: losses ? gl / losses : 0,
    profitFactor: gl > 0 ? gp / gl : (gp > 0 ? 999 : 0),
    expectancy: (wins / n) * (wins ? gp / wins : 0) - (losses / n) * (losses ? gl / losses : 0),
    tradingDays: days.size,
    tradesPerDay: n / Math.max(days.size, 1),
    avgHoldMin: holdN ? holdSum / holdN : 0,
    pctA: graded ? (a / graded) * 100 : 0,
    pctB: graded ? (b / graded) * 100 : 0,
    pctC: graded ? (c / graded) * 100 : 0,
    bySymbol, bySetup,
  };
}

// GET /api/diagnosis?a=<paperId>&b=<realId>   (a = reference/good, b = subject to diagnose)
router.get('/diagnosis', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId;
    const aId = parseInt(String(req.query.a));
    const bId = parseInt(String(req.query.b));
    if (!aId || !bId) return res.status(400).json({ error: 'a and b account ids required' });

    const own = await pool.query('SELECT id FROM accounts WHERE id = ANY($1::int[]) AND user_id = $2', [[aId, bId], user_id]);
    if (own.rows.length < 2 && aId !== bId) return res.status(403).json({ error: 'Account not found' });

    const A = await computeStats(aId);
    const B = await computeStats(bId);
    if (!A || !B) return res.json({ data: { ready: false } });

    const findings: { severity: 'high' | 'med' | 'low'; title: string; detail: string }[] = [];
    const push = (severity: any, title: string, detail: string) => findings.push({ severity, title, detail });

    // Overtrading
    if (B.tradesPerDay > A.tradesPerDay * 1.3) {
      push('high', 'Overtrading in real',
        `You take ${B.tradesPerDay.toFixed(1)} trades/day in real vs ${A.tradesPerDay.toFixed(1)} in paper (${((B.tradesPerDay / A.tradesPerDay - 1) * 100).toFixed(0)}% more). Fewer, higher-quality entries.`);
    }
    // Win rate drop
    if (B.winRate < A.winRate - 5) {
      push('high', 'Win rate collapses in real',
        `${A.winRate.toFixed(0)}% in paper → ${B.winRate.toFixed(0)}% in real. Same setups, worse execution — likely entering earlier or off-plan.`);
    }
    // Holding losers
    if (A.avgLoss > 0 && B.avgLoss > A.avgLoss * 1.25) {
      push('high', 'Holding losers longer in real',
        `Avg loss ${B.avgLoss.toFixed(0)} in real vs ${A.avgLoss.toFixed(0)} in paper. You let losers run past your stop when real money is on.`);
    }
    // Cutting winners
    if (A.avgWin > 0 && B.avgWin < A.avgWin * 0.8) {
      push('med', 'Cutting winners early in real',
        `Avg win ${B.avgWin.toFixed(0)} in real vs ${A.avgWin.toFixed(0)} in paper. Fear takes profit too soon.`);
    }
    // Hold time (panic exits)
    if (A.avgHoldMin > 0 && B.avgHoldMin < A.avgHoldMin * 0.6) {
      push('med', 'Panic exits in real',
        `You hold ${B.avgHoldMin.toFixed(0)} min in real vs ${A.avgHoldMin.toFixed(0)} min in paper — jumping out early under pressure.`);
    }
    // Discipline (grades)
    if (A.pctA > 0 || B.pctA > 0) {
      if (B.pctA < A.pctA - 10) push('high', 'Breaking the checklist in real',
        `A-grade trades: ${A.pctA.toFixed(0)}% in paper → ${B.pctA.toFixed(0)}% in real. You take lower-quality setups when live.`);
      if (B.pctC > A.pctC + 10) push('high', 'Too many C-grade trades in real',
        `C-grades: ${A.pctC.toFixed(0)}% paper → ${B.pctC.toFixed(0)}% real. These are the account-killers.`);
    }
    // Instrument leaks (profit in paper, loss in real)
    for (const [sym, aPnl] of A.bySymbol) {
      const bPnl = B.bySymbol.get(sym);
      if (bPnl != null && aPnl > 0 && bPnl < 0) {
        push('med', `${sym}: winner in paper, loser in real`,
          `${sym} makes money in paper but loses in real. Same instrument, opposite result — a psychology gap, not a strategy gap.`);
      }
    }
    // Expectancy gap
    if (B.expectancy < 0 && A.expectancy > 0) {
      push('high', 'Positive edge in paper, negative in real',
        `Expectancy ${A.expectancy.toFixed(0)}/trade paper → ${B.expectancy.toFixed(0)}/trade real. Your system works — your execution under real money doesn't yet.`);
    }

    const order = { high: 0, med: 1, low: 2 };
    findings.sort((x, y) => order[x.severity] - order[y.severity]);

    const slim = (s: Stats) => ({
      trades: s.trades, winRate: Number(s.winRate.toFixed(1)), netPnl: Number(s.netPnl.toFixed(2)),
      avgWin: Number(s.avgWin.toFixed(0)), avgLoss: Number(s.avgLoss.toFixed(0)),
      profitFactor: Number(s.profitFactor.toFixed(2)), expectancy: Number(s.expectancy.toFixed(0)),
      tradesPerDay: Number(s.tradesPerDay.toFixed(1)), avgHoldMin: Number(s.avgHoldMin.toFixed(0)),
      pctA: Number(s.pctA.toFixed(0)), pctC: Number(s.pctC.toFixed(0)),
    });

    res.json({ data: { ready: true, a: slim(A), b: slim(B), findings } });
  } catch (error: any) {
    console.error('Diagnosis error:', error);
    res.status(500).json({ error: 'Failed to compute diagnosis' });
  }
});

export default router;
