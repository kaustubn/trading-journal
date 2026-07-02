import { Router, Request, Response } from 'express';
import pool from '../db';
import { NotificationService } from '../services/notificationService';

const router = Router();
const notificationService = new NotificationService();

// Get notification preferences
router.get('/preferences', async (req: Request, res: Response) => {
  try {
    const userId = req.userId || 0;

    const result = await pool.query(
      `SELECT daily_email, weekly_report, slack_webhook, pnl_alert_threshold
       FROM notification_preferences
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        data: {
          daily_email: false,
          weekly_report: false,
          slack_webhook: null,
          pnl_alert_threshold: 10000
        }
      });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching notification preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// Update notification preferences
router.post('/preferences', async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    const { daily_email, weekly_report, slack_webhook, pnl_alert_threshold } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if preferences exist
      const existing = await client.query(
        'SELECT id FROM notification_preferences WHERE user_id = $1',
        [userId]
      );

      if (existing.rows.length === 0) {
        // Insert new preferences
        await client.query(
          `INSERT INTO notification_preferences
           (user_id, daily_email, weekly_report, slack_webhook, pnl_alert_threshold)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, daily_email, weekly_report, slack_webhook, pnl_alert_threshold]
        );
      } else {
        // Update existing preferences
        await client.query(
          `UPDATE notification_preferences
           SET daily_email = $1, weekly_report = $2, slack_webhook = $3, pnl_alert_threshold = $4
           WHERE user_id = $5`,
          [daily_email, weekly_report, slack_webhook, pnl_alert_threshold, userId]
        );
      }

      await client.query('COMMIT');
      res.json({ success: true, message: 'Preferences updated' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Test notification
router.post('/test/:type', async (req: Request, res: Response) => {
  try {
    const { type } = req.params;
    const userId = req.userId || 0;

    const user = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    if (!user.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (type === 'email') {
      // Send test email
      await notificationService.sendDailySummaryEmail(userId, 1);
      res.json({ success: true, message: 'Test email sent' });
    } else if (type === 'slack') {
      // Get Slack webhook from preferences
      const prefs = await pool.query(
        'SELECT slack_webhook FROM notification_preferences WHERE user_id = $1',
        [userId]
      );

      if (!prefs.rows[0]?.slack_webhook) {
        return res.status(400).json({ error: 'Slack webhook not configured' });
      }

      await notificationService.sendSlackNotification(prefs.rows[0].slack_webhook, {
        title: '✅ Test Notification',
        pnl: 5000,
        trades: 10,
        winRate: '60%'
      });

      res.json({ success: true, message: 'Test Slack notification sent' });
    } else {
      res.status(400).json({ error: 'Invalid notification type' });
    }
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

export default router;
