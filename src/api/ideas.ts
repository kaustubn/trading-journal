import { Router, Request, Response } from 'express';
import pool from '../db';
import { verifyToken } from '../middleware/auth';

const router = Router();

// Get all ideas for user
router.get('/ideas', verifyToken, async (req: Request, res: Response) => {
  try {
    const { account_id } = req.query;

    let query = 'SELECT * FROM ideas WHERE user_id = $1';
    const params: any[] = [req.userId];

    if (account_id) {
      query += ` AND account_id = $${params.length + 1}`;
      params.push(account_id);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching ideas:', error);
    res.status(500).json({ error: 'Failed to fetch ideas' });
  }
});

// Get ideas by date
router.get('/ideas/date/:date', verifyToken, async (req: Request, res: Response) => {
  try {
    const { date } = req.params;

    const result = await pool.query(
      `SELECT * FROM ideas
       WHERE user_id = $1 AND DATE(created_at) = $2
       ORDER BY created_at DESC`,
      [req.userId, date]
    );

    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching ideas by date:', error);
    res.status(500).json({ error: 'Failed to fetch ideas' });
  }
});

// Create idea
router.post('/ideas', verifyToken, async (req: Request, res: Response) => {
  try {
    const { account_id, title, description, symbol, price_level } = req.body;

    // Verify user owns this account
    if (account_id) {
      const accountCheck = await pool.query(
        'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
        [account_id, req.userId]
      );

      if (accountCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    }

    const result = await pool.query(
      `INSERT INTO ideas (user_id, account_id, title, description, symbol, price_level, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [req.userId, account_id || null, title, description, symbol, price_level]
    );

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error creating idea:', error);
    res.status(500).json({ error: 'Failed to create idea' });
  }
});

// Update idea
router.put('/ideas/:id', verifyToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, symbol, price_level, status } = req.body;

    // Verify user owns this idea
    const ideaCheck = await pool.query(
      'SELECT id FROM ideas WHERE id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (ideaCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `UPDATE ideas
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           symbol = COALESCE($3, symbol),
           price_level = COALESCE($4, price_level),
           status = COALESCE($5, status)
       WHERE id = $6
       RETURNING *`,
      [title, description, symbol, price_level, status, id]
    );

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error updating idea:', error);
    res.status(500).json({ error: 'Failed to update idea' });
  }
});

// Delete idea
router.delete('/ideas/:id', verifyToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify user owns this idea
    const ideaCheck = await pool.query(
      'SELECT id FROM ideas WHERE id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (ideaCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await pool.query('DELETE FROM ideas WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting idea:', error);
    res.status(500).json({ error: 'Failed to delete idea' });
  }
});

export default router;
