import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// Export trades as CSV
router.get('/trades/csv/:account_id', async (req: Request, res: Response) => {
  try {
    const { account_id } = req.params;
    const user_id = req.userId;
    const { from_date, to_date } = req.query;

    // Verify user owns this account
    const accountCheck = await pool.query(
      'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
      [account_id, user_id]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    let query = `SELECT
      symbol, entry_time, exit_time, entry_price, exit_price, quantity, pnl, setup_tag, notes
      FROM trades
      WHERE account_id = $1`;

    const params: any[] = [account_id];

    if (from_date) {
      query += ` AND entry_time >= $${params.length + 1}`;
      params.push(from_date);
    }

    if (to_date) {
      query += ` AND entry_time <= $${params.length + 1}`;
      params.push(to_date);
    }

    query += ` ORDER BY entry_time DESC`;

    const result = await pool.query(query, params);

    // Generate CSV
    const csv = generateCSV(result.rows);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="trades_${account_id}_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting trades:', error);
    res.status(500).json({ error: 'Failed to export trades' });
  }
});

// Export account summary as CSV
router.get('/summary/csv/:account_id', async (req: Request, res: Response) => {
  try {
    const { account_id } = req.params;
    const user_id = req.userId;

    const accountCheck = await pool.query(
      'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
      [account_id, user_id]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT
        trade_date, trade_count, wins, losses, daily_pnl
        FROM daily_summaries
        WHERE account_id = $1
        ORDER BY trade_date DESC`,
      [account_id]
    );

    const csv = generateSummaryCSV(result.rows);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="summary_${account_id}_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting summary:', error);
    res.status(500).json({ error: 'Failed to export summary' });
  }
});

function generateCSV(rows: any[]): string {
  if (rows.length === 0) {
    return 'Symbol,Entry Time,Exit Time,Entry Price,Exit Price,Quantity,P&L,Setup Tag,Notes\n';
  }

  const headers = 'Symbol,Entry Time,Exit Time,Entry Price,Exit Price,Quantity,P&L,Setup Tag,Notes';
  const data = rows.map(row => [
    row.symbol,
    row.entry_time ? new Date(row.entry_time).toLocaleString('en-IN') : '',
    row.exit_time ? new Date(row.exit_time).toLocaleString('en-IN') : '',
    parseFloat(row.entry_price || 0).toFixed(2),
    parseFloat(row.exit_price || 0).toFixed(2),
    row.quantity,
    parseFloat(row.pnl || 0).toFixed(2),
    row.setup_tag || '',
    (row.notes || '').replace(/"/g, '""') // Escape quotes
  ].map(v => `"${v}"`).join(','));

  return [headers, ...data].join('\n');
}

function generateSummaryCSV(rows: any[]): string {
  if (rows.length === 0) {
    return 'Date,Trades,Wins,Losses,Daily P&L\n';
  }

  const headers = 'Date,Trades,Wins,Losses,Daily P&L';
  const data = rows.map(row => [
    row.trade_date,
    row.trade_count,
    row.wins,
    row.losses,
    parseFloat(row.daily_pnl || 0).toFixed(2)
  ].map(v => `"${v}"`).join(','));

  return [headers, ...data].join('\n');
}

export default router;
