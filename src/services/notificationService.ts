import axios from 'axios';
import pool from '../db';
import emailService from './emailService';

export class NotificationService {
  // Send daily summary via email
  async sendDailySummaryEmail(userId: number, accountId: number) {
    try {
      const user = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
      if (!user.rows[0]) return;

      const summary = await pool.query(
        `SELECT trade_date, trade_count, wins, losses, daily_pnl
         FROM daily_summaries
         WHERE account_id = $1
         ORDER BY trade_date DESC LIMIT 1`,
        [accountId]
      );

      if (summary.rows.length === 0) return;

      const data = summary.rows[0];
      const winRate = data.trade_count > 0 ? ((data.wins / data.trade_count) * 100).toFixed(2) : '0';

      const emailBody = `
        <h2>Daily Trading Summary</h2>
        <p><strong>Date:</strong> ${data.trade_date}</p>
        <p><strong>Total Trades:</strong> ${data.trade_count}</p>
        <p><strong>Wins:</strong> ${data.wins} | <strong>Losses:</strong> ${data.losses}</p>
        <p><strong>Win Rate:</strong> ${winRate}%</p>
        <p style="font-size: 20px; font-weight: bold; color: ${data.daily_pnl >= 0 ? 'green' : 'red'};">
          Daily P&L: ₹${data.daily_pnl}
        </p>
      `;

      await this.sendEmail(
        user.rows[0].email,
        `Daily Trading Summary - ${data.trade_date}`,
        emailBody
      );
    } catch (error) {
      console.error('Error sending daily summary email:', error);
    }
  }

  // Send Slack notification
  async sendSlackNotification(webhookUrl: string, message: {
    title: string;
    pnl: number;
    trades: number;
    winRate: string;
    color?: string;
  }) {
    try {
      const color = message.pnl >= 0 ? '#22c55e' : '#ef4444';

      const payload = {
        attachments: [
          {
            color: message.color || color,
            title: message.title,
            fields: [
              {
                title: 'P&L',
                value: `₹${message.pnl.toFixed(2)}`,
                short: true
              },
              {
                title: 'Trades',
                value: message.trades.toString(),
                short: true
              },
              {
                title: 'Win Rate',
                value: message.winRate,
                short: true
              }
            ],
            ts: Math.floor(Date.now() / 1000)
          }
        ]
      };

      await axios.post(webhookUrl, payload);
    } catch (error) {
      console.error('Error sending Slack notification:', error);
    }
  }

  // Send alert on significant P&L
  async sendPnLAlert(userId: number, accountId: number, pnl: number, threshold: number) {
    try {
      if (Math.abs(pnl) < threshold) return;

      const user = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
      if (!user.rows[0]) return;

      const status = pnl > 0 ? 'PROFIT' : 'LOSS';
      const emailBody = `
        <h2>⚠️ Large ${status} Alert</h2>
        <p>Your account has recorded a significant ${status.toLowerCase()} of <strong>₹${pnl.toFixed(2)}</strong></p>
        <p>Log in to your Trading Journal to review your trades.</p>
      `;

      await this.sendEmail(
        user.rows[0].email,
        `Alert: Large ${status} - ₹${pnl.toFixed(2)}`,
        emailBody
      );
    } catch (error) {
      console.error('Error sending P&L alert:', error);
    }
  }

  // Send weekly performance report
  async sendWeeklyReport(userId: number, accountId: number) {
    try {
      const user = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
      if (!user.rows[0]) return;

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const stats = await pool.query(
        `SELECT
          COUNT(*) as trades,
          SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
          SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
          SUM(pnl) as total_pnl,
          AVG(pnl) as avg_pnl
         FROM trades
         WHERE account_id = $1 AND entry_time >= $2`,
        [accountId, weekAgo.toISOString()]
      );

      const data = stats.rows[0];
      const winRate = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(2) : '0';

      const emailBody = `
        <h2>Weekly Trading Report</h2>
        <p><strong>Period:</strong> Last 7 days</p>
        <p><strong>Total Trades:</strong> ${data.trades}</p>
        <p><strong>Wins:</strong> ${data.wins} | <strong>Losses:</strong> ${data.losses}</p>
        <p><strong>Win Rate:</strong> ${winRate}%</p>
        <p><strong>Average P&L per trade:</strong> ₹${parseFloat(data.avg_pnl || 0).toFixed(2)}</p>
        <p style="font-size: 18px; font-weight: bold; color: ${data.total_pnl >= 0 ? 'green' : 'red'};">
          Weekly P&L: ₹${parseFloat(data.total_pnl || 0).toFixed(2)}
        </p>
      `;

      await this.sendEmail(
        user.rows[0].email,
        'Weekly Trading Report',
        emailBody
      );
    } catch (error) {
      console.error('Error sending weekly report:', error);
    }
  }

  // Generic email sender (requires SMTP configuration)
  private async sendEmail(to: string, subject: string, htmlBody: string) {
    try {
      const success = await emailService.sendEmail({
        to,
        subject,
        html: htmlBody,
        type: 'daily_summary'
      });
      if (!success) {
        console.warn(`Failed to send email to ${to}: ${subject}`);
      }
    } catch (error) {
      console.error('Error sending email:', error);
    }
  }
}
