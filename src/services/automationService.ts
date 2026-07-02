import pool from '../db';
import crypto from 'crypto';

interface BotConfig {
  enabled: boolean;
  maxPositions: number;
  riskPerTrade: number;
  tradeSize: number;
}

interface TradingBot {
  id: number;
  account_id: number;
  name: string;
  strategy_id?: number;
  enabled: boolean;
  status: 'active' | 'inactive' | 'error';
  webhook_url: string;
  webhook_secret: string;
  config: BotConfig;
  active_positions: number;
  total_executed: number;
}

interface BotOrder {
  id: number;
  bot_id: number;
  strategy_signal: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  status: 'pending' | 'executed' | 'cancelled';
}

interface OpenPosition {
  id: number;
  account_id: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entry_price: number;
  current_price: number;
  pnl_points: number;
  pnl_percent: number;
  stop_loss: number;
  take_profit: number;
}

export class AutomationService {
  // Create new trading bot
  async createBot(
    account_id: number,
    name: string,
    strategy_id?: number,
    config?: Partial<BotConfig>
  ): Promise<TradingBot> {
    const webhook_secret = crypto.randomBytes(32).toString('hex');
    const webhook_url = `${process.env.WEBHOOK_BASE_URL}/webhooks/bot/${crypto.randomBytes(16).toString('hex')}`;
    const defaultConfig: BotConfig = {
      enabled: false,
      maxPositions: 3,
      riskPerTrade: 1,
      tradeSize: 1,
      ...config
    };

    const result = await pool.query(
      `INSERT INTO trading_bots (account_id, name, strategy_id, webhook_url, webhook_secret, config)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [account_id, name, strategy_id || null, webhook_url, webhook_secret, JSON.stringify(defaultConfig)]
    );

    return this.formatBot(result.rows[0]);
  }

  // Get bot by ID
  async getBot(bot_id: number): Promise<TradingBot> {
    const result = await pool.query('SELECT * FROM trading_bots WHERE id = $1', [bot_id]);
    if (result.rows.length === 0) throw new Error('Bot not found');
    return this.formatBot(result.rows[0]);
  }

  // List bots for account
  async getBots(account_id: number): Promise<TradingBot[]> {
    const result = await pool.query(
      'SELECT * FROM trading_bots WHERE account_id = $1 ORDER BY created_at DESC',
      [account_id]
    );
    return result.rows.map(row => this.formatBot(row));
  }

  // Enable/disable bot
  async updateBotStatus(bot_id: number, enabled: boolean): Promise<TradingBot> {
    const result = await pool.query(
      'UPDATE trading_bots SET enabled = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [enabled, bot_id]
    );
    return this.formatBot(result.rows[0]);
  }

  // Create order from webhook signal
  async createOrder(
    bot_id: number,
    signal: { symbol: string; side: string; quantity: number; entryPrice: number; stopLoss: number; takeProfit: number }
  ): Promise<BotOrder> {
    const bot = await this.getBot(bot_id);

    // Check max positions
    if (bot.active_positions >= bot.config.maxPositions) {
      throw new Error('Max positions exceeded');
    }

    const result = await pool.query(
      `INSERT INTO bot_orders (bot_id, strategy_signal, symbol, side, quantity, entry_price, stop_loss, take_profit, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       RETURNING *`,
      [
        bot_id,
        'webhook_signal',
        signal.symbol,
        signal.side.toUpperCase(),
        signal.quantity,
        signal.entryPrice,
        signal.stopLoss,
        signal.takeProfit
      ]
    );

    return this.formatOrder(result.rows[0]);
  }

  // Execute order (simulate or real execution)
  async executeOrder(bot_order_id: number, executedPrice: number): Promise<BotOrder> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update order status
      const orderRes = await client.query(
        'UPDATE bot_orders SET status = $1, executed_at = NOW() WHERE id = $2 RETURNING *',
        ['executed', bot_order_id]
      );

      const order = orderRes.rows[0];

      // Create open position
      await client.query(
        `INSERT INTO open_positions (account_id, symbol, side, quantity, entry_price, current_price, stop_loss, take_profit)
         SELECT bot.account_id, $1, $2, $3, $4, $5, $6, $7
         FROM trading_bots bot
         JOIN bot_orders ON bot_orders.id = $8
         WHERE bot.id = bot_orders.bot_id`,
        [order.symbol, order.side, order.quantity, executedPrice, executedPrice, order.stop_loss, order.take_profit, bot_order_id]
      );

      // Update bot stats
      await client.query(
        'UPDATE trading_bots SET active_positions = active_positions + 1, total_executed = total_executed + 1 WHERE id = $1',
        [order.bot_id]
      );

      await client.query('COMMIT');
      return this.formatOrder(order);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get open positions
  async getOpenPositions(account_id: number): Promise<OpenPosition[]> {
    const result = await pool.query(
      'SELECT * FROM open_positions WHERE account_id = $1 ORDER BY opened_at DESC',
      [account_id]
    );

    return result.rows.map(row => ({
      id: row.id,
      account_id: row.account_id,
      symbol: row.symbol,
      side: row.side,
      quantity: row.quantity,
      entry_price: parseFloat(row.entry_price),
      current_price: parseFloat(row.current_price),
      pnl_points: parseFloat(row.pnl_points),
      pnl_percent: parseFloat(row.pnl_percent),
      stop_loss: parseFloat(row.stop_loss),
      take_profit: parseFloat(row.take_profit)
    }));
  }

  // Update position price (from price feed)
  async updatePositionPrice(position_id: number, currentPrice: number): Promise<OpenPosition> {
    const posRes = await pool.query('SELECT * FROM open_positions WHERE id = $1', [position_id]);
    if (posRes.rows.length === 0) throw new Error('Position not found');

    const pos = posRes.rows[0];
    const pnlPoints = pos.side === 'BUY'
      ? currentPrice - pos.entry_price
      : pos.entry_price - currentPrice;
    const pnlPercent = (pnlPoints / pos.entry_price) * 100;

    const result = await pool.query(
      'UPDATE open_positions SET current_price = $1, pnl_points = $2, pnl_percent = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [currentPrice, pnlPoints, pnlPercent, position_id]
    );

    return this.formatPosition(result.rows[0]);
  }

  // Close position
  async closePosition(position_id: number): Promise<OpenPosition> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const posRes = await client.query('SELECT * FROM open_positions WHERE id = $1', [position_id]);
      if (posRes.rows.length === 0) throw new Error('Position not found');

      const pos = posRes.rows[0];

      // Delete position
      await client.query('DELETE FROM open_positions WHERE id = $1', [position_id]);

      // Update bot
      await client.query(
        'UPDATE trading_bots SET active_positions = active_positions - 1 WHERE account_id = $1',
        [pos.account_id]
      );

      await client.query('COMMIT');
      return this.formatPosition(posRes.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Verify webhook signature
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    const computed = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    return computed === signature;
  }

  // Helper: format bot response
  private formatBot(row: any): TradingBot {
    return {
      id: row.id,
      account_id: row.account_id,
      name: row.name,
      strategy_id: row.strategy_id,
      enabled: row.enabled,
      status: row.status,
      webhook_url: row.webhook_url,
      webhook_secret: row.webhook_secret,
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
      active_positions: row.active_positions,
      total_executed: row.total_executed
    };
  }

  private formatOrder(row: any): BotOrder {
    return {
      id: row.id,
      bot_id: row.bot_id,
      strategy_signal: row.strategy_signal,
      symbol: row.symbol,
      side: row.side,
      quantity: row.quantity,
      entry_price: parseFloat(row.entry_price),
      stop_loss: parseFloat(row.stop_loss),
      take_profit: parseFloat(row.take_profit),
      status: row.status
    };
  }

  private formatPosition(row: any): OpenPosition {
    return {
      id: row.id,
      account_id: row.account_id,
      symbol: row.symbol,
      side: row.side,
      quantity: row.quantity,
      entry_price: parseFloat(row.entry_price),
      current_price: parseFloat(row.current_price),
      pnl_points: parseFloat(row.pnl_points),
      pnl_percent: parseFloat(row.pnl_percent),
      stop_loss: parseFloat(row.stop_loss),
      take_profit: parseFloat(row.take_profit)
    };
  }
}

export default new AutomationService();
