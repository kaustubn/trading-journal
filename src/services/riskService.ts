import pool from '../db';

interface RiskMetrics {
  accountEquity: number;
  dailyPnl: number;
  dailyDrawdown: number;
  monthlyDrawdown: number;
  peakEquity: number;
  riskPerTrade: number;
  maxDailyLoss: number;
  circuitBreakerStatus: 'green' | 'yellow' | 'red';
}

interface PositionSize {
  accountSize: number;
  riskPercent: number;
  riskDollars: number;
  stopLossPts: number;
  contracts: number;
  warningMsg?: string;
}

interface KellyCriterion {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  kellyPercent: number;
  recommendedSize: number;
  safeFraction: number;
}

export class RiskService {
  // Calculate position size using Kelly Criterion
  async calculateKelly(account_id: number): Promise<KellyCriterion> {
    const client = await pool.connect();
    try {
      const tradesRes = await client.query(
        `SELECT pnl, quantity FROM trades
         WHERE account_id = $1
         LIMIT 100`,
        [account_id]
      );

      const trades = tradesRes.rows;
      if (trades.length < 10) {
        return {
          winRate: 0.5,
          avgWin: 0,
          avgLoss: 0,
          kellyPercent: 2,
          recommendedSize: 0.02,
          safeFraction: 0.25
        };
      }

      const wins = trades.filter(t => (t.pnl || 0) > 0);
      const losses = trades.filter(t => (t.pnl || 0) < 0);

      const winRate = wins.length / trades.length;
      const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + (t.pnl || 0), 0) / wins.length : 0;
      const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + (t.pnl || 0), 0) / losses.length) : 0;

      // Kelly: (p * b - q) / b where p=win%, b=win/loss ratio, q=loss%
      const b = avgLoss > 0 ? avgWin / avgLoss : 1;
      const q = 1 - winRate;
      const kelly = (winRate * b - q) / b;

      return {
        winRate,
        avgWin,
        avgLoss,
        kellyPercent: Math.max(0, kelly * 100),
        recommendedSize: Math.max(0.01, Math.min(0.1, kelly)), // Clamp 1-10%
        safeFraction: Math.max(0.01, Math.min(0.05, kelly * 0.25)) // 25% of Kelly
      };
    } finally {
      client.release();
    }
  }

  // Calculate position size based on account and risk
  async calculatePositionSize(
    account_id: number,
    riskPercent: number,
    stopLossPts: number
  ): Promise<PositionSize> {
    const client = await pool.connect();
    try {
      // Get current account equity
      const summaryRes = await client.query(
        `SELECT COALESCE(SUM(daily_pnl), 0) as total_pnl FROM daily_summaries
         WHERE account_id = $1`,
        [account_id]
      );

      const totalPnl = summaryRes.rows[0].total_pnl || 0;
      const accountSize = 100000 + totalPnl; // Assume $100K starting capital

      if (accountSize <= 0) {
        return {
          accountSize,
          riskPercent,
          riskDollars: 0,
          stopLossPts,
          contracts: 0,
          warningMsg: 'Account equity is zero or negative'
        };
      }

      const riskDollars = (accountSize * riskPercent) / 100;
      // For NQ: $20 per point, ES: $50 per point, Gold: $10 per point
      // Assume NQ for now
      const ptValue = 20;
      const contracts = Math.floor(riskDollars / (stopLossPts * ptValue));

      let warningMsg = '';
      if (riskDollars > accountSize * 0.02) {
        warningMsg = 'Risk exceeds 2% max - reduce size';
      }
      if (contracts > 20) {
        warningMsg = 'Position too large for account';
      }

      return {
        accountSize,
        riskPercent,
        riskDollars,
        stopLossPts,
        contracts: Math.max(1, contracts),
        warningMsg
      };
    } finally {
      client.release();
    }
  }

  // Get current risk metrics
  async getRiskMetrics(account_id: number): Promise<RiskMetrics> {
    const client = await pool.connect();
    try {
      const today = new Date().toISOString().split('T')[0];
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      // Daily P&L
      const dailyRes = await client.query(
        `SELECT COALESCE(SUM(daily_pnl), 0) as daily_pnl FROM daily_summaries
         WHERE account_id = $1 AND trade_date = $2`,
        [account_id, today]
      );
      const dailyPnl = dailyRes.rows[0].daily_pnl || 0;

      // Total and peak equity
      const totalRes = await client.query(
        `SELECT COALESCE(SUM(daily_pnl), 0) as total_pnl FROM daily_summaries
         WHERE account_id = $1`,
        [account_id]
      );
      const accountEquity = 100000 + (totalRes.rows[0].total_pnl || 0);

      // Peak equity for drawdown calc
      const peakRes = await client.query(
        `WITH daily_equity AS (
           SELECT DATE(trade_date) as dt, SUM(daily_pnl) as cum_pnl
           FROM daily_summaries
           WHERE account_id = $1 AND trade_date <= $2
           GROUP BY DATE(trade_date)
         )
         SELECT MAX(cum_pnl + 100000) as peak_equity
         FROM daily_equity`,
        [account_id, today]
      );
      const peakEquity = peakRes.rows[0].peak_equity || accountEquity;

      // Drawdown
      const dailyDrawdown = ((peakEquity - accountEquity) / peakEquity) * 100;

      const monthlyRes = await client.query(
        `WITH daily_equity AS (
           SELECT DATE(trade_date) as dt, SUM(daily_pnl) as cum_pnl
           FROM daily_summaries
           WHERE account_id = $1 AND trade_date >= $2 AND trade_date <= $3
           GROUP BY DATE(trade_date)
         )
         SELECT MAX(cum_pnl + 100000) as peak, MIN(cum_pnl + 100000) as valley
         FROM daily_equity`,
        [account_id, monthAgo, today]
      );

      const monthlyPeak = monthlyRes.rows[0].peak || accountEquity;
      const monthlyValley = monthlyRes.rows[0].valley || accountEquity;
      const monthlyDrawdown = ((monthlyPeak - monthlyValley) / monthlyPeak) * 100;

      // Risk per trade
      const riskPerTrade = (Math.abs(dailyPnl) / accountEquity) * 100;
      const maxDailyLoss = accountEquity * 0.02; // 2% max daily loss

      // Circuit breaker status
      let circuitBreakerStatus: 'green' | 'yellow' | 'red' = 'green';
      if (dailyDrawdown > 15) circuitBreakerStatus = 'red'; // 15% drawdown = stop
      else if (dailyDrawdown > 10) circuitBreakerStatus = 'yellow'; // 10% = caution
      if (dailyPnl < -maxDailyLoss) circuitBreakerStatus = 'red'; // Daily loss limit

      return {
        accountEquity,
        dailyPnl,
        dailyDrawdown,
        monthlyDrawdown,
        peakEquity,
        riskPerTrade,
        maxDailyLoss,
        circuitBreakerStatus
      };
    } finally {
      client.release();
    }
  }

  // Check if trading should be halted
  async shouldHaltTrading(account_id: number): Promise<{ shouldHalt: boolean; reason?: string }> {
    const metrics = await this.getRiskMetrics(account_id);

    if (metrics.circuitBreakerStatus === 'red') {
      return {
        shouldHalt: true,
        reason: metrics.dailyDrawdown > 15
          ? `Daily drawdown ${metrics.dailyDrawdown.toFixed(1)}% exceeds 15% limit`
          : `Daily loss $${Math.abs(metrics.dailyPnl).toFixed(0)} exceeds 2% max`
      };
    }

    return { shouldHalt: false };
  }

  // Calculate correlation between accounts (portfolio-level risk)
  async getAccountCorrelation(user_id: number): Promise<Record<string, number>> {
    const client = await pool.connect();
    try {
      const accountsRes = await client.query(
        `SELECT id FROM accounts WHERE user_id = $1`,
        [user_id]
      );

      const accounts = accountsRes.rows.map(r => r.id);
      if (accounts.length < 2) return {};

      // Simplified: returns number of accounts
      return {
        accountCount: accounts.length,
        diversified: accounts.length >= 3 ? 1 : 0
      };
    } finally {
      client.release();
    }
  }
}

export default new RiskService();
