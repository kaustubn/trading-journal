import pool from '../db';

export interface BacktestConfig {
  account_id: number;
  from_date: string;
  to_date: string;
  initial_capital: number;
  max_risk_per_trade: number; // percentage
  win_only_filter?: boolean;
  min_win_rate?: number; // percentage
}

export interface BacktestResult {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  roi: number;
  max_drawdown: number;
  profit_factor: number;
  avg_win: number;
  avg_loss: number;
  best_trade: number;
  worst_trade: number;
  consecutive_wins: number;
  consecutive_losses: number;
  daily_breakdown: DailyResult[];
  trades: TradeResult[];
}

export interface DailyResult {
  date: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  balance: number;
}

export interface TradeResult {
  id: number;
  symbol: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  pnl: number;
  roi: number;
  win: boolean;
}

export class BacktestService {
  async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
    try {
      // Fetch trades for period
      const tradesResult = await pool.query(
        `SELECT * FROM trades
         WHERE account_id = $1
         AND DATE(entry_time) BETWEEN $2 AND $3
         AND exit_time IS NOT NULL
         ORDER BY entry_time ASC`,
        [config.account_id, config.from_date, config.to_date]
      );

      const trades = tradesResult.rows;

      // Apply filters
      let filteredTrades = trades;
      if (config.win_only_filter) {
        filteredTrades = trades.filter(t => parseFloat(t.pnl) > 0);
      }

      // Calculate metrics
      const metrics = this.calculateMetrics(
        filteredTrades,
        config.initial_capital
      );

      // Build daily breakdown
      const dailyBreakdown = this.calculateDailyBreakdown(filteredTrades, config.initial_capital);

      return {
        ...metrics,
        daily_breakdown: dailyBreakdown,
        trades: filteredTrades.map(t => ({
          id: t.id,
          symbol: t.symbol,
          entry_date: new Date(t.entry_time).toLocaleDateString('en-IN'),
          exit_date: new Date(t.exit_time).toLocaleDateString('en-IN'),
          entry_price: parseFloat(t.entry_price),
          exit_price: parseFloat(t.exit_price),
          quantity: t.quantity,
          pnl: parseFloat(t.pnl),
          roi: (parseFloat(t.pnl) / config.initial_capital) * 100,
          win: parseFloat(t.pnl) > 0
        }))
      };
    } catch (error) {
      console.error('Backtest error:', error);
      throw error;
    }
  }

  private calculateMetrics(trades: any[], initialCapital: number) {
    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => parseFloat(t.pnl) > 0).length;
    const losingTrades = trades.filter(t => parseFloat(t.pnl) < 0).length;

    const totalPnL = trades.reduce((sum, t) => sum + parseFloat(t.pnl), 0);
    const winSum = trades
      .filter(t => parseFloat(t.pnl) > 0)
      .reduce((sum, t) => sum + parseFloat(t.pnl), 0);
    const lossSum = Math.abs(
      trades
        .filter(t => parseFloat(t.pnl) < 0)
        .reduce((sum, t) => sum + parseFloat(t.pnl), 0)
    );

    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const roi = (totalPnL / initialCapital) * 100;
    const profitFactor = lossSum > 0 ? winSum / lossSum : winSum > 0 ? Infinity : 0;
    const avgWin = winningTrades > 0 ? winSum / winningTrades : 0;
    const avgLoss = losingTrades > 0 ? lossSum / losingTrades : 0;

    const pnlValues = trades.map(t => parseFloat(t.pnl));
    const bestTrade = Math.max(...pnlValues);
    const worstTrade = Math.min(...pnlValues);

    // Calculate max drawdown
    let cumulative = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const trade of trades) {
      cumulative += parseFloat(trade.pnl);
      peak = Math.max(peak, cumulative);
      maxDrawdown = Math.min(maxDrawdown, cumulative - peak);
    }

    // Consecutive wins/losses
    let consecutiveWins = 0;
    let maxConsecutiveWins = 0;
    let consecutiveLosses = 0;
    let maxConsecutiveLosses = 0;

    for (const trade of trades) {
      if (parseFloat(trade.pnl) > 0) {
        consecutiveWins++;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins);
        consecutiveLosses = 0;
      } else {
        consecutiveLosses++;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
        consecutiveWins = 0;
      }
    }

    return {
      total_trades: totalTrades,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
      win_rate: parseFloat(winRate.toFixed(2)),
      total_pnl: parseFloat(totalPnL.toFixed(2)),
      roi: parseFloat(roi.toFixed(2)),
      max_drawdown: parseFloat(maxDrawdown.toFixed(2)),
      profit_factor: typeof profitFactor === 'number' ? parseFloat(profitFactor.toFixed(2)) : profitFactor,
      avg_win: parseFloat(avgWin.toFixed(2)),
      avg_loss: parseFloat(avgLoss.toFixed(2)),
      best_trade: parseFloat(bestTrade.toFixed(2)),
      worst_trade: parseFloat(worstTrade.toFixed(2)),
      consecutive_wins: maxConsecutiveWins,
      consecutive_losses: maxConsecutiveLosses
    };
  }

  private calculateDailyBreakdown(trades: any[], initialCapital: number): DailyResult[] {
    const dailyMap = new Map<string, any[]>();

    // Group by date
    for (const trade of trades) {
      const date = new Date(trade.entry_time).toISOString().split('T')[0];
      if (!dailyMap.has(date)) {
        dailyMap.set(date, []);
      }
      dailyMap.get(date)!.push(trade);
    }

    // Calculate daily metrics
    let balance = initialCapital;
    const results: DailyResult[] = [];

    for (const [date, dayTrades] of Array.from(dailyMap.entries()).sort()) {
      const dayPnL = dayTrades.reduce((sum, t) => sum + parseFloat(t.pnl), 0);
      balance += dayPnL;

      results.push({
        date,
        trades: dayTrades.length,
        wins: dayTrades.filter(t => parseFloat(t.pnl) > 0).length,
        losses: dayTrades.filter(t => parseFloat(t.pnl) < 0).length,
        pnl: parseFloat(dayPnL.toFixed(2)),
        balance: parseFloat(balance.toFixed(2))
      });
    }

    return results;
  }
}
