import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import pool from '../src/db';

async function seedStrategies() {
  const client = await pool.connect();
  try {
    console.log('Seeding strategies...');

    // Strategy 1: S1 - NQ ORB Breakout
    const s1 = await client.query(
      `INSERT INTO strategies (user_id, account_id, name, description, rules, enabled)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        1,
        1,
        'S1: NQ ORB Breakout',
        'Initial Balance breakout strategy. Trades breakout of first 30-min range with volume confirmation. Works on trend days (IB < 60 pts). 52-62% win rate, 1:3-1:5 R:R.',
        JSON.stringify([
          {
            id: 'ib-range-check',
            type: 'entry',
            condition: 'price_above',
            value: 19400,
            description: 'Price above IB High'
          },
          {
            id: 'volume-confirm',
            type: 'entry',
            condition: 'macd_cross',
            value: 0,
            description: 'MACD bullish crossover or volume spike'
          },
          {
            id: 'ema-check',
            type: 'entry',
            condition: 'price_above',
            value: 19380,
            description: 'Price above EMA 21 (15-min)'
          },
          {
            id: 'exit-t1',
            type: 'exit',
            condition: 'price_above',
            value: 19450,
            description: 'T1: Next resistance (30% close)'
          },
          {
            id: 'exit-t2',
            type: 'exit',
            condition: 'price_above',
            value: 19500,
            description: 'T2: Second resistance (40% close)'
          },
          {
            id: 'stop-loss',
            type: 'stop',
            condition: 'price_below',
            value: 19370,
            description: 'Stop 3 pts below IB High'
          }
        ]),
        true
      ]
    );

    console.log('✓ S1 Strategy created:', s1.rows[0].id);

    // Strategy 2: S2 - VWAP Pullback to Value
    const s2 = await client.query(
      `INSERT INTO strategies (user_id, account_id, name, description, rules, enabled)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        1,
        1,
        'S2: VWAP Pullback',
        'VP/VWAP mean reversion strategy. Buys pullbacks to VWAP in uptrend, sells rallies in downtrend. Works on normal days (IB 60-120). 55-65% win rate, 1:2-1:3 R:R.',
        JSON.stringify([
          {
            id: 'vwap-level',
            type: 'entry',
            condition: 'price_above',
            value: 19410,
            description: 'Price at or below VWAP'
          },
          {
            id: 'rejection-candle',
            type: 'entry',
            condition: 'rsi_above',
            value: 40,
            description: 'RSI 40-60: moderate pullback (not extreme reversal)'
          },
          {
            id: 'trend-bias',
            type: 'entry',
            condition: 'ema_cross',
            value: 0,
            description: 'EMA 21 (15-min) pointing up'
          },
          {
            id: 'exit-t1',
            type: 'exit',
            condition: 'price_above',
            value: 19450,
            description: 'T1: Next VAH (50% close)'
          },
          {
            id: 'exit-t2',
            type: 'exit',
            condition: 'price_above',
            value: 19500,
            description: 'T2: Second VAH (50% close)'
          },
          {
            id: 'stop-loss',
            type: 'stop',
            condition: 'price_below',
            value: 19390,
            description: 'Stop 3 pts below VAL'
          }
        ]),
        true
      ]
    );

    console.log('✓ S2 Strategy created:', s2.rows[0].id);

    // Strategy 3: S3 - Auction Fade
    const s3 = await client.query(
      `INSERT INTO strategies (user_id, account_id, name, description, rules, enabled)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        1,
        1,
        'S3: Auction Fade',
        'Auction market fade strategy. Sells at IB High when RSI > 68, buys at IB Low when RSI < 32. Works on range days (IB > 120). 60-68% win rate, 1:1.5-1:2 R:R.',
        JSON.stringify([
          {
            id: 'rsi-extreme-high',
            type: 'entry',
            condition: 'rsi_above',
            value: 68,
            description: 'RSI above 68 at resistance'
          },
          {
            id: 'rsi-extreme-low',
            type: 'entry',
            condition: 'rsi_below',
            value: 32,
            description: 'RSI below 32 at support'
          },
          {
            id: 'price-at-extreme',
            type: 'entry',
            condition: 'price_above',
            value: 19430,
            description: 'Price at IB High or VAH'
          },
          {
            id: 'exit-t1',
            type: 'exit',
            condition: 'price_above',
            value: 19415,
            description: 'T1: VWAP/POC (60% close)'
          },
          {
            id: 'exit-t2',
            type: 'exit',
            condition: 'price_above',
            value: 19385,
            description: 'T2: Opposite extreme (40% close)'
          },
          {
            id: 'stop-loss',
            type: 'stop',
            condition: 'price_above',
            value: 19450,
            description: 'Stop 5 pts beyond wick'
          }
        ]),
        true
      ]
    );

    console.log('✓ S3 Strategy created:', s3.rows[0].id);
    console.log('\n✅ All 3 strategies seeded successfully!');

  } finally {
    client.release();
    await pool.end();
  }
}

seedStrategies().catch(console.error);
