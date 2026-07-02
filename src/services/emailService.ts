import nodemailer from 'nodemailer';
import pool from '../db';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

interface EmailData {
  to: string;
  subject: string;
  html: string;
  type: 'daily_summary' | 'trade_alert' | 'loss_alert' | 'milestone' | 'weekly_digest';
}

async function sendEmail(data: EmailData): Promise<boolean> {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@tradezella.io',
      to: data.to,
      subject: data.subject,
      html: data.html
    });
    return true;
  } catch (error) {
    console.error('Email send failed:', error);
    return false;
  }
}

async function sendDailySummary(user_id: number, email: string, stats: any) {
  const html = `
    <h2>Daily Trading Summary</h2>
    <p><strong>P&L:</strong> ${stats.pnl > 0 ? '+' : ''}${stats.pnl}</p>
    <p><strong>Trades:</strong> ${stats.tradeCount}</p>
    <p><strong>Win Rate:</strong> ${stats.winRate}%</p>
    <p><strong>Profit Factor:</strong> ${stats.profitFactor}</p>
    <p><a href="https://tradezella.io">View Full Dashboard</a></p>
  `;

  return await sendEmail({
    to: email,
    subject: `Daily Summary - ${new Date().toLocaleDateString()}`,
    html,
    type: 'daily_summary'
  });
}

async function sendTradeAlert(user_id: number, email: string, trade: any) {
  const html = `
    <h2>New Trade Alert</h2>
    <p><strong>Symbol:</strong> ${trade.symbol}</p>
    <p><strong>Entry:</strong> ${trade.entry}</p>
    <p><strong>Stop:</strong> ${trade.stop}</p>
    <p><strong>Target:</strong> ${trade.target}</p>
    <p><strong>Risk/Reward:</strong> 1:${(trade.target - trade.entry) / (trade.entry - trade.stop)}</p>
  `;

  return await sendEmail({
    to: email,
    subject: `Trade Alert - ${trade.symbol}`,
    html,
    type: 'trade_alert'
  });
}

async function sendLossAlert(user_id: number, email: string, drawdown: number) {
  const html = `
    <h2>Drawdown Alert</h2>
    <p>Your account drawdown has reached <strong>${drawdown}%</strong></p>
    <p>Circuit breaker is active. No new trades until recovery.</p>
    <p><a href="https://tradezella.io">Review Risk Dashboard</a></p>
  `;

  return await sendEmail({
    to: email,
    subject: `⚠️ Drawdown Alert - ${drawdown}%`,
    html,
    type: 'loss_alert'
  });
}

async function sendMilestoneEmail(user_id: number, email: string, milestone: string) {
  const html = `
    <h2>🎉 Milestone Reached!</h2>
    <p>${milestone}</p>
    <p><a href="https://tradezella.io">View Profile</a></p>
  `;

  return await sendEmail({
    to: email,
    subject: `Milestone - ${milestone}`,
    html,
    type: 'milestone'
  });
}

async function sendWeeklyDigest(user_id: number, email: string, stats: any) {
  const html = `
    <h2>Weekly Trading Digest</h2>
    <p><strong>Week P&L:</strong> ${stats.weekPnl}</p>
    <p><strong>Trades:</strong> ${stats.tradeCount}</p>
    <p><strong>Best Day:</strong> ${stats.bestDay}</p>
    <p><strong>Win Rate:</strong> ${stats.winRate}%</p>
    <p><a href="https://tradezella.io">View Full Week</a></p>
  `;

  return await sendEmail({
    to: email,
    subject: `Weekly Digest - Week of ${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString()}`,
    html,
    type: 'weekly_digest'
  });
}

async function getUserEmail(user_id: number): Promise<string | null> {
  try {
    const result = await pool.query('SELECT email FROM users WHERE id = $1', [user_id]);
    return result.rows[0]?.email || null;
  } catch (error) {
    console.error('Failed to get user email:', error);
    return null;
  }
}

export default {
  sendEmail,
  sendDailySummary,
  sendTradeAlert,
  sendLossAlert,
  sendMilestoneEmail,
  sendWeeklyDigest,
  getUserEmail
};
