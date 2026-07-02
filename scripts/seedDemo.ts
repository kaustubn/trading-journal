import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import pool from '../src/db';
import bcryptjs from 'bcryptjs';

async function seedDemo() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create demo user
    const hashedPassword = await bcryptjs.hash('demo123', 10);
    const userResult = await client.query(
      `INSERT INTO users (email, password) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET password = $2
       RETURNING id`,
      ['demo@example.com', hashedPassword]
    );

    const userId = userResult.rows[0].id;
    console.log('Created user:', userId);

    // Create Zerodha account
    const zerodhaResult = await client.query(
      `INSERT INTO accounts (user_id, broker, account_number, account_name, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, broker, account_number) DO UPDATE SET status = 'active'
       RETURNING id`,
      [userId, 'zerodha', 'XX1234', 'My Zerodha', 'active']
    );

    const zerodhaId = zerodhaResult.rows[0].id;

    // Create Lucid account
    const lucidResult = await client.query(
      `INSERT INTO accounts (user_id, broker, account_number, account_name, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, broker, account_number) DO UPDATE SET status = 'active'
       RETURNING id`,
      [userId, 'lucid', 'lucid123', 'My Lucid', 'active']
    );

    const lucidId = lucidResult.rows[0].id;

    // Create demo trades for last 7 days
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const tradeDate = new Date(today);
      tradeDate.setDate(tradeDate.getDate() - i);

      // Zerodha trades
      const zerodhaTradeTime = new Date(tradeDate);
      zerodhaTradeTime.setHours(9, 30, 0);
      const zerodhaExitTime = new Date(zerodhaTradeTime);
      zerodhaExitTime.setHours(10, 15, 0);

      const zerodhaPrice = 20000 + Math.random() * 1000;
      const zerodhaExitPrice = zerodhaPrice + (Math.random() - 0.5) * 500;
      const zerodhaQty = Math.floor(Math.random() * 10) + 1;
      const zerodhaP = (zerodhaExitPrice - zerodhaPrice) * zerodhaQty;

      await client.query(
        `INSERT INTO trades (account_id, broker_trade_id, symbol, entry_time, exit_time, entry_price, exit_price, quantity, pnl, setup_tag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (broker_trade_id) DO NOTHING`,
        [
          zerodhaId,
          `demo_zerodha_${i}_${Math.random()}`,
          'EURUSD',
          zerodhaTradeTime,
          zerodhaExitTime,
          zerodhaPrice,
          zerodhaExitPrice,
          zerodhaQty,
          zerodhaP.toFixed(2),
          ['1st pullback', 'breakout', 'support bounce', 'trend continuation'][Math.floor(Math.random() * 4)],
        ]
      );

      // Lucid trades
      const lucidTradeTime = new Date(tradeDate);
      lucidTradeTime.setHours(11, 0, 0);
      const lucidExitTime = new Date(lucidTradeTime);
      lucidExitTime.setHours(12, 30, 0);

      const lucidPrice = 18500 + Math.random() * 800;
      const lucidExitPrice = lucidPrice + (Math.random() - 0.5) * 400;
      const lucidQty = Math.floor(Math.random() * 5) + 1;
      const lucidP = (lucidExitPrice - lucidPrice) * lucidQty;

      await client.query(
        `INSERT INTO trades (account_id, broker_trade_id, symbol, entry_time, exit_time, entry_price, exit_price, quantity, pnl, setup_tag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (broker_trade_id) DO NOTHING`,
        [
          lucidId,
          `demo_lucid_${i}_${Math.random()}`,
          'NQ',
          lucidTradeTime,
          lucidExitTime,
          lucidPrice,
          lucidExitPrice,
          lucidQty,
          lucidP.toFixed(2),
          ['range break', 'market structure', 'london breakout', 'scalp'][Math.floor(Math.random() * 4)],
        ]
      );
    }

    // Recalculate daily summaries
    await client.query(
      `DELETE FROM daily_summaries WHERE account_id IN ($1, $2)`,
      [zerodhaId, lucidId]
    );

    const summaries = await client.query(
      `SELECT account_id, DATE(entry_time) as trade_date,
              COUNT(*) as trade_count,
              SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
              SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
              SUM(pnl) as daily_pnl
       FROM trades
       WHERE account_id IN ($1, $2)
       GROUP BY account_id, DATE(entry_time)`,
      [zerodhaId, lucidId]
    );

    for (const row of summaries.rows) {
      await client.query(
        `INSERT INTO daily_summaries (account_id, trade_date, daily_pnl, trade_count, wins, losses)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.account_id, row.trade_date, row.daily_pnl, row.trade_count, row.wins || 0, row.losses || 0]
      );
    }

    await client.query('COMMIT');
    console.log('Demo data seeded successfully!');
    console.log('Login with: demo@example.com / demo123');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error seeding demo data:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

seedDemo();
