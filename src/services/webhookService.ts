import pool from '../db';
import { SyncService } from './syncService';

export interface WebhookPayload {
  event: 'trade_closed' | 'trade_opened' | 'position_update';
  account_id?: string;
  broker: 'fyres' | 'zerodha' | 'lucid' | 'tradingview';
  data: {
    order_id: string;
    symbol: string;
    entry_time: string;
    exit_time?: string;
    entry_price: number;
    exit_price?: number;
    quantity: number;
    pnl?: number;
    tag?: string;
  };
}

export class WebhookService {
  private syncService = new SyncService();

  async processWebhook(payload: WebhookPayload, brokerAccountId: string) {
    try {
      // Find account by broker credentials
      const accountResult = await pool.query(
        `SELECT a.id, a.user_id FROM accounts a
         JOIN broker_credentials bc ON a.id = bc.account_id
         WHERE a.broker = $1 AND a.account_number = $2`,
        [payload.broker, brokerAccountId]
      );

      if (accountResult.rows.length === 0) {
        console.warn(`Account not found for broker ${payload.broker}, account ${brokerAccountId}`);
        return;
      }

      const account = accountResult.rows[0];
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        if (payload.event === 'trade_closed') {
          await this.processTradeClosed(client, account.id, payload.data);
        } else if (payload.event === 'trade_opened') {
          await this.processTradeOpened(client, account.id, payload.data);
        } else if (payload.event === 'position_update') {
          await this.processPositionUpdate(client, account.id, payload.data);
        }

        // Recalculate daily summary
        const tradeDate = new Date(payload.data.entry_time).toISOString().split('T')[0];
        await this.recalculateDailySummary(client, account.id, tradeDate);

        await client.query('COMMIT');
        console.log(`Webhook processed for account ${account.id}: ${payload.event}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Webhook processing error:', error);
      throw error;
    }
  }

  private async processTradeClosed(client: any, accountId: number, data: any) {
    const existing = await client.query(
      'SELECT id FROM trades WHERE broker_trade_id = $1',
      [data.order_id]
    );

    if (existing.rows.length === 0) {
      // New trade
      await client.query(
        `INSERT INTO trades (account_id, broker_trade_id, symbol, entry_time, exit_time,
         entry_price, exit_price, quantity, pnl, setup_tag, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
        [
          accountId,
          data.order_id,
          data.symbol,
          data.entry_time,
          data.exit_time,
          data.entry_price,
          data.exit_price,
          data.quantity,
          data.pnl,
          data.tag || 'webhook'
        ]
      );
    } else {
      // Update existing trade
      await client.query(
        `UPDATE trades SET exit_price = $1, exit_time = $2, pnl = $3, updated_at = NOW()
         WHERE broker_trade_id = $4`,
        [data.exit_price, data.exit_time, data.pnl, data.order_id]
      );
    }
  }

  private async processTradeOpened(client: any, accountId: number, data: any) {
    const existing = await client.query(
      'SELECT id FROM trades WHERE broker_trade_id = $1',
      [data.order_id]
    );

    if (existing.rows.length === 0) {
      await client.query(
        `INSERT INTO trades (account_id, broker_trade_id, symbol, entry_time,
         entry_price, quantity, setup_tag, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [
          accountId,
          data.order_id,
          data.symbol,
          data.entry_time,
          data.entry_price,
          data.quantity,
          data.tag || 'webhook'
        ]
      );
    }
  }

  private async processPositionUpdate(client: any, accountId: number, data: any) {
    // Update open position
    const existing = await client.query(
      'SELECT id FROM trades WHERE broker_trade_id = $1 AND exit_time IS NULL',
      [data.order_id]
    );

    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE trades SET entry_price = $1, quantity = $2, updated_at = NOW()
         WHERE broker_trade_id = $3`,
        [data.entry_price, data.quantity, data.order_id]
      );
    }
  }

  private async recalculateDailySummary(client: any, accountId: number, tradeDate: string) {
    // Delete existing summary for date
    await client.query(
      'DELETE FROM daily_summaries WHERE account_id = $1 AND DATE(trade_date) = $2',
      [accountId, tradeDate]
    );

    // Recalculate
    const result = await client.query(
      `SELECT COUNT(*) as trade_count,
              SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
              SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
              SUM(pnl) as daily_pnl
       FROM trades
       WHERE account_id = $1 AND DATE(entry_time) = $2`,
      [accountId, tradeDate]
    );

    const row = result.rows[0];
    if (row.trade_count > 0) {
      await client.query(
        `INSERT INTO daily_summaries (account_id, trade_date, daily_pnl, trade_count, wins, losses)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          accountId,
          tradeDate,
          row.daily_pnl,
          row.trade_count,
          row.wins || 0,
          row.losses || 0
        ]
      );
    }
  }
}
