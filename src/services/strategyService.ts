import pool from '../db';

export interface StrategyRule {
  id?: string;
  type: 'entry' | 'exit' | 'stop';
  condition: 'price_above' | 'price_below' | 'rsi_above' | 'rsi_below' | 'macd_cross' | 'ema_cross';
  value: number;
  timeframe?: string;
}

export interface Strategy {
  id?: number;
  user_id: number;
  name: string;
  description: string;
  rules: StrategyRule[];
  account_id: number;
  enabled: boolean;
  backtestResults?: any;
  createdAt?: string;
}

export class StrategyService {
  async createStrategy(userId: number, strategy: Strategy) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO strategies (user_id, account_id, name, description, rules, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          userId,
          strategy.account_id,
          strategy.name,
          strategy.description,
          JSON.stringify(strategy.rules),
          strategy.enabled || true
        ]
      );

      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateStrategy(userId: number, strategyId: number, strategy: Strategy) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify user owns strategy
      const check = await client.query(
        'SELECT id FROM strategies WHERE id = $1 AND user_id = $2',
        [strategyId, userId]
      );

      if (check.rows.length === 0) {
        throw new Error('Strategy not found');
      }

      const result = await client.query(
        `UPDATE strategies
         SET name = $1, description = $2, rules = $3, enabled = $4, updated_at = NOW()
         WHERE id = $5 AND user_id = $6
         RETURNING *`,
        [
          strategy.name,
          strategy.description,
          JSON.stringify(strategy.rules),
          strategy.enabled,
          strategyId,
          userId
        ]
      );

      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteStrategy(userId: number, strategyId: number) {
    const result = await pool.query(
      `DELETE FROM strategies
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [strategyId, userId]
    );

    return result.rows.length > 0;
  }

  async getStrategies(userId: number) {
    const result = await pool.query(
      `SELECT * FROM strategies
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    return result.rows.map(row => ({
      ...row,
      rules: JSON.parse(row.rules)
    }));
  }

  async applyStrategyToTrades(strategyId: number, trades: any[]) {
    const strategy = await pool.query(
      'SELECT rules FROM strategies WHERE id = $1',
      [strategyId]
    );

    if (strategy.rows.length === 0) {
      throw new Error('Strategy not found');
    }

    const rules = JSON.parse(strategy.rows[0].rules);
    const matchedTrades = [];

    for (const trade of trades) {
      if (this.evaluateRules(trade, rules)) {
        matchedTrades.push(trade);
      }
    }

    return matchedTrades;
  }

  private evaluateRules(trade: any, rules: StrategyRule[]): boolean {
    // Entry rules must be met
    const entryRules = rules.filter(r => r.type === 'entry');
    if (entryRules.length === 0) return true;

    return entryRules.every(rule => this.evaluateCondition(trade, rule));
  }

  private evaluateCondition(trade: any, rule: StrategyRule): boolean {
    switch (rule.condition) {
      case 'price_above':
        return trade.entry_price > rule.value;
      case 'price_below':
        return trade.entry_price < rule.value;
      case 'rsi_above':
        // Would need RSI calculation
        return true;
      case 'rsi_below':
        return true;
      case 'macd_cross':
        return true;
      case 'ema_cross':
        return true;
      default:
        return true;
    }
  }

  async backtestStrategy(strategyId: number, accountId: number, fromDate: string, toDate: string) {
    // Fetch trades for period
    const trades = await pool.query(
      `SELECT * FROM trades
       WHERE account_id = $1
       AND DATE(entry_time) BETWEEN $2 AND $3
       ORDER BY entry_time ASC`,
      [accountId, fromDate, toDate]
    );

    // Get strategy
    const strategy = await pool.query(
      'SELECT rules FROM strategies WHERE id = $1',
      [strategyId]
    );

    const rules = JSON.parse(strategy.rows[0].rules);
    const matchedTrades = await this.applyStrategyToTrades(strategyId, trades.rows);

    // Calculate stats
    const totalTrades = matchedTrades.length;
    const wins = matchedTrades.filter((t: any) => parseFloat(t.pnl) > 0).length;
    const losses = matchedTrades.filter((t: any) => parseFloat(t.pnl) < 0).length;
    const totalPnL = matchedTrades.reduce((sum: number, t: any) => sum + parseFloat(t.pnl), 0);

    return {
      strategy_id: strategyId,
      from_date: fromDate,
      to_date: toDate,
      total_trades: totalTrades,
      wins,
      losses,
      win_rate: totalTrades > 0 ? (wins / totalTrades) * 100 : 0,
      total_pnl: totalPnL,
      matched_trades: matchedTrades
    };
  }
}
