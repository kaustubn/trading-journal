import { Router, Request, Response } from 'express';
import pool from '../db';
import { getCurrentAttemptId } from './attempts';

const router = Router();

// TradingView webhook - routed by per-account token in the URL.
// URL: /api/webhook/tradingview/:token  (token from the account's webhook_token)
router.post('/webhook/tradingview/:token', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token || '');
    // TradingView sends the alert body as raw text or { message } JSON.
    const message = typeof req.body === 'string'
      ? req.body
      : (req.body.message || req.body.text || '');

    // Parse message format: "SYMBOL DIRECTION ENTRY [stop:STOP] [target:TARGET] [qty:QTY]"
    // Example: "NQ LONG 19500 stop:19450 target:19550 qty:1"
    // Example: "ES SHORT 4500"

    const lines = message.split('\n').filter((l: string) => l.trim());
    if (lines.length === 0) {
      return res.status(400).json({ error: 'Empty message' });
    }

    const firstLine = lines[0].trim().split(/\s+/);
    if (firstLine.length < 3) {
      return res.status(400).json({ error: 'Invalid format. Use: SYMBOL DIRECTION PRICE' });
    }

    const symbol = firstLine[0].toUpperCase();
    const direction = firstLine[1].toUpperCase(); // LONG or SHORT
    const entryPrice = parseFloat(firstLine[2]);

    if (isNaN(entryPrice)) {
      return res.status(400).json({ error: 'Invalid entry price' });
    }

    let stopPrice = null;
    let targetPrice = null;
    let quantity = 1;

    // Parse additional parameters from message
    for (let i = 1; i < firstLine.length; i++) {
      const param = firstLine[i];
      if (param.startsWith('stop:')) {
        stopPrice = parseFloat(param.split(':')[1]);
      } else if (param.startsWith('target:')) {
        targetPrice = parseFloat(param.split(':')[1]);
      } else if (param.startsWith('qty:')) {
        quantity = parseInt(param.split(':')[1]);
      }
    }

    // Resolve the account from the webhook token (per-account routing)
    const accountResult = await pool.query(
      `SELECT id, user_id FROM accounts WHERE webhook_token = $1`,
      [token]
    );

    if (accountResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid webhook token — no matching account' });
    }

    const accountId = accountResult.rows[0].id;
    const entryTime = new Date();
    const attemptId = await getCurrentAttemptId(pool, accountId);

    // Create trade entry
    const tradeResult = await pool.query(
      `INSERT INTO trades (account_id, broker_trade_id, symbol, entry_time, entry_price, quantity, setup_tag, notes, attempt_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        accountId,
        `tv_${Date.now()}`,
        symbol,
        entryTime,
        entryPrice,
        quantity,
        `TV ${direction}`,
        `Stop: ${stopPrice || 'N/A'} | Target: ${targetPrice || 'N/A'}`,
        attemptId
      ]
    );

    res.json({
      success: true,
      trade: tradeResult.rows[0],
      message: `Trade logged: ${symbol} ${direction} @ ${entryPrice}`
    });
  } catch (error) {
    console.error('TradingView webhook error:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

export default router;
