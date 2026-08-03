import pool from '../db';
import { ZerodhaAdapter } from '../adapters/zerodha';
import { LucidAdapter } from '../adapters/lucid';
import { FyresAdapter } from '../adapters/fyres';
import { IBKRAdapter } from '../adapters/ibkr';
import { Trade } from '../types';

export class SyncService {
  async syncAccount(account_id: number, from_date: Date, to_date: Date) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get account details
      const accountResult = await client.query(
        'SELECT broker FROM accounts WHERE id = $1',
        [account_id]
      );
      const account = accountResult.rows[0];

      let adapter: any;
      if (account.broker === 'zerodha') {
        adapter = await ZerodhaAdapter.createFromCredentials(account_id);
      } else if (account.broker === 'lucid') {
        adapter = await LucidAdapter.createFromCredentials(account_id);
      } else if (account.broker === 'fyres') {
        adapter = await FyresAdapter.createFromCredentials(account_id);
      } else if (account.broker === 'ibkr') {
        adapter = await IBKRAdapter.createFromCredentials(account_id);
      } else {
        throw new Error(`Unsupported broker: ${account.broker}`);
      }

      // Fetch trades from broker
      const trades = await adapter.fetchTrades(from_date, to_date);

      let inserted = 0;
      let updated = 0;

      // Upsert trades (dedup by broker_trade_id)
      for (const trade of trades) {
        const existing = await client.query(
          'SELECT id FROM trades WHERE broker_trade_id = $1',
          [trade.broker_trade_id]
        );

        if (existing.rows.length === 0) {
          // Insert
          await client.query(
            `INSERT INTO trades (account_id, broker_trade_id, symbol, entry_time, exit_time,
             entry_price, exit_price, quantity, pnl, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
            [
              account_id,
              trade.broker_trade_id,
              trade.symbol,
              trade.entry_time,
              trade.exit_time,
              trade.entry_price,
              trade.exit_price,
              trade.quantity,
              trade.pnl,
            ]
          );
          inserted++;
        } else {
          // Update exit_price, exit_time, pnl if available
          if (trade.exit_price || trade.pnl) {
            await client.query(
              `UPDATE trades SET exit_price = COALESCE($1, exit_price),
               exit_time = COALESCE($2, exit_time), pnl = COALESCE($3, pnl),
               updated_at = NOW()
               WHERE broker_trade_id = $4`,
              [trade.exit_price, trade.exit_time, trade.pnl, trade.broker_trade_id]
            );
            updated++;
          }
        }
      }

      // Recalculate daily summaries
      await this.recalculateDailySummary(client, account_id, from_date, to_date);

      // Log sync
      await client.query(
        `INSERT INTO sync_logs (account_id, sync_type, status, trades_inserted, trades_updated)
         VALUES ($1, $2, $3, $4, $5)`,
        [account_id, 'real_time', 'success', inserted, updated]
      );

      await client.query('COMMIT');
      return { inserted, updated };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Sync error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async recalculateDailySummary(client: any, account_id: number, from_date: Date, to_date: Date) {
    // Clear existing summaries for date range
    await client.query(
      'DELETE FROM daily_summaries WHERE account_id = $1 AND trade_date BETWEEN $2 AND $3',
      [account_id, from_date.toISOString().split('T')[0], to_date.toISOString().split('T')[0]]
    );

    // Recalculate
    const result = await client.query(
      `SELECT DATE(entry_time) as trade_date,
              COUNT(*) as trade_count,
              SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
              SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
              SUM(pnl) as daily_pnl
       FROM trades
       WHERE account_id = $1 AND DATE(entry_time) BETWEEN $2 AND $3
       GROUP BY DATE(entry_time)`,
      [
        account_id,
        from_date.toISOString().split('T')[0],
        to_date.toISOString().split('T')[0],
      ]
    );

    for (const row of result.rows) {
      await client.query(
        `INSERT INTO daily_summaries (account_id, trade_date, daily_pnl, trade_count, wins, losses)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [account_id, row.trade_date, row.daily_pnl, row.trade_count, row.wins || 0, row.losses || 0]
      );
    }
  }

  async syncAllAccounts(user_id: number) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT id FROM accounts WHERE user_id = $1 AND status = $2',
        [user_id, 'active']
      );

      const accounts = result.rows;
      const from_date = new Date();
      from_date.setDate(from_date.getDate() - 7); // Last 7 days

      for (const account of accounts) {
        try {
          await this.syncAccount(account.id, from_date, new Date());
        } catch (error) {
          console.error(`Failed to sync account ${account.id}:`, error);
        }
      }
    } finally {
      client.release();
    }
  }
}
