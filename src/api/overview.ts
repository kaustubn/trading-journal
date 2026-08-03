import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// GET /api/overview/:account_id[?from=YYYY-MM-DD&to=YYYY-MM-DD]
router.get('/overview/:account_id', async (req: Request, res: Response) => {
  try {
    const account_id = parseInt(String(req.params.account_id));
    const user_id = req.userId;
    const { from, to, attempt } = req.query;

    const own = await pool.query('SELECT id, cost_per_trade FROM accounts WHERE id = $1 AND user_id = $2', [account_id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });
    const costPerTrade = Number(own.rows[0].cost_per_trade) || 0;

    const params: any[] = [account_id];
    let dateFilter = '';
    if (from) { params.push(from); dateFilter += ` AND DATE(entry_time) >= $${params.length}`; }
    if (to) { params.push(to); dateFilter += ` AND DATE(entry_time) <= $${params.length}`; }
    if (attempt) { params.push(attempt); dateFilter += ` AND attempt_id = $${params.length}`; }

    const tr = await pool.query(
      `SELECT pnl, entry_price, stop_loss, quantity,
              to_char(DATE(entry_time), 'YYYY-MM-DD') AS d
       FROM trades
       WHERE account_id = $1 AND pnl IS NOT NULL${dateFilter}
       ORDER BY entry_time ASC, id ASC`,
      params
    );

    const rows = tr.rows;
    const n = rows.length;
    if (n === 0) {
      return res.json({ data: { hasData: false } });
    }

    let wins = 0, losses = 0, grossProfit = 0, grossLoss = 0, totalPnl = 0;
    let largestWin = 0, largestLoss = 0;
    let rSum = 0, rCount = 0;
    const dayMap = new Map<string, number>();

    for (const row of rows) {
      const pnl = Number(row.pnl);
      totalPnl += pnl;
      if (pnl > 0) { wins++; grossProfit += pnl; if (pnl > largestWin) largestWin = pnl; }
      else if (pnl < 0) { losses++; grossLoss += Math.abs(pnl); if (pnl < largestLoss) largestLoss = pnl; }
      dayMap.set(row.d, (dayMap.get(row.d) || 0) + pnl);
      if (row.stop_loss != null && row.entry_price != null && row.quantity) {
        const risk = Math.abs(Number(row.entry_price) - Number(row.stop_loss)) * Number(row.quantity);
        if (risk > 0) { rSum += pnl / risk; rCount++; }
      }
    }

    const winRate = (wins / n) * 100;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 999 : 0);
    const avgWin = wins > 0 ? grossProfit / wins : 0;
    const avgLoss = losses > 0 ? grossLoss / losses : 0;
    const expectancy = (wins / n) * avgWin - (losses / n) * avgLoss;
    const avgR = rCount > 0 ? rSum / rCount : null;

    // Equity curve (cumulative by day)
    const days = Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    let cum = 0;
    const equityCurve = days.map(([date, pnl]) => { cum += pnl; return { date, pnl: Number(pnl.toFixed(2)), cumulative: Number(cum.toFixed(2)) }; });

    // Best / worst day
    let bestDay = { date: '', pnl: -Infinity }, worstDay = { date: '', pnl: Infinity };
    for (const [date, pnl] of dayMap) {
      if (pnl > bestDay.pnl) bestDay = { date, pnl };
      if (pnl < worstDay.pnl) worstDay = { date, pnl };
    }

    // Peak equity + max drawdown from the curve
    let peak = -Infinity, maxDD = 0;
    for (const pt of equityCurve) {
      if (pt.cumulative > peak) peak = pt.cumulative;
      const dd = peak - pt.cumulative;
      if (dd > maxDD) maxDD = dd;
    }

    // Current streak (consecutive winning or losing trades from the end)
    let streak = 0, streakType: 'win' | 'loss' | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const pnl = Number(rows[i].pnl);
      if (pnl === 0) continue;
      const t = pnl > 0 ? 'win' : 'loss';
      if (streakType === null) { streakType = t; streak = 1; }
      else if (t === streakType) streak++;
      else break;
    }

    const winningDays = equityCurve.filter(d => d.pnl > 0).length;
    const losingDays = equityCurve.filter(d => d.pnl < 0).length;

    // --- Composite performance score (0-100), TradeZella-style ---
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    // Profit factor score: <1 scales 0-40, 1→40, 2+→100
    const pfScore = grossLoss === 0
      ? (grossProfit > 0 ? 100 : 0)
      : (profitFactor <= 1 ? profitFactor * 40 : clamp(40 + (profitFactor - 1) * 60));
    // Payoff (avg win / avg loss): 1→50, 2+→100
    const payoff = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? 2 : 0);
    const payoffScore = clamp((payoff / 2) * 100);
    // Win rate: 60%+ = full marks
    const winScore = clamp((winRate / 60) * 100);
    // Consistency: share of green trading days
    const consistencyScore = days.length > 0 ? clamp((winningDays / days.length) * 100) : 0;
    // Risk control: max drawdown vs gross profit (smaller = better)
    const ddRatio = grossProfit > 0 ? maxDD / grossProfit : (maxDD > 0 ? 1 : 0);
    const riskScore = clamp(100 - ddRatio * 100);

    const parts = [
      { key: 'profitFactor', label: 'Profit Factor', val: Math.round(pfScore), weight: 30 },
      { key: 'payoff', label: 'Win/Loss Size', val: Math.round(payoffScore), weight: 20 },
      { key: 'risk', label: 'Risk Control', val: Math.round(riskScore), weight: 20 },
      { key: 'winRate', label: 'Win Rate', val: Math.round(winScore), weight: 15 },
      { key: 'consistency', label: 'Consistency', val: Math.round(consistencyScore), weight: 15 },
    ];
    const totalScore = Math.round(parts.reduce((s, p) => s + p.val * p.weight, 0) / 100);
    const grade = totalScore >= 90 ? 'A+' : totalScore >= 80 ? 'A' : totalScore >= 70 ? 'B'
      : totalScore >= 55 ? 'C' : totalScore >= 40 ? 'D' : 'F';
    const score = { total: totalScore, grade, parts };

    res.json({
      data: {
        hasData: true,
        score,
        totalTrades: n,
        wins, losses,
        winRate: Number(winRate.toFixed(1)),
        grossPnl: Number(totalPnl.toFixed(2)),
        costPerTrade,
        charges: Number((costPerTrade * n).toFixed(2)),
        netAfterCharges: Number((totalPnl - costPerTrade * n).toFixed(2)),
        netPnl: Number(totalPnl.toFixed(2)),
        grossProfit: Number(grossProfit.toFixed(2)),
        grossLoss: Number(grossLoss.toFixed(2)),
        profitFactor: Number(profitFactor.toFixed(2)),
        avgWin: Number(avgWin.toFixed(2)),
        avgLoss: Number(avgLoss.toFixed(2)),
        expectancy: Number(expectancy.toFixed(2)),
        avgR: avgR !== null ? Number(avgR.toFixed(2)) : null,
        largestWin: Number(largestWin.toFixed(2)),
        largestLoss: Number(largestLoss.toFixed(2)),
        bestDay, worstDay,
        maxDrawdown: Number(maxDD.toFixed(2)),
        streak, streakType,
        tradingDays: days.length,
        winningDays, losingDays,
        equityCurve,
      },
    });
  } catch (error: any) {
    console.error('Overview error:', error);
    res.status(500).json({ error: 'Failed to compute overview' });
  }
});

export default router;
