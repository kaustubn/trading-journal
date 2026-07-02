import pool from '../db';
import axios from 'axios';

// STAGE 7: Portfolio Aggregation
interface PortfolioSnapshot {
  total_equity: number;
  cash_balance: number;
  open_pnl: number;
  realized_pnl: number;
  allocation: Record<string, number>;
}

export class PortfolioService {
  async getPortfolioSnapshot(user_id: number): Promise<PortfolioSnapshot> {
    const accountsRes = await pool.query(
      `SELECT id FROM accounts WHERE user_id = $1`,
      [user_id]
    );

    let totalEquity = 0, totalPnL = 0, realizedPnL = 0;
    const allocation: Record<string, number> = {};

    for (const acc of accountsRes.rows) {
      const summaryRes = await pool.query(
        `SELECT SUM(daily_pnl) as total FROM daily_summaries WHERE account_id = $1`,
        [acc.id]
      );
      const tradeRes = await pool.query(
        `SELECT SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END) as wins FROM trades WHERE account_id = $1`,
        [acc.id]
      );

      const equity = 100000 + (parseFloat(summaryRes.rows[0]?.total) || 0);
      totalEquity += equity;
      realizedPnL += parseFloat(tradeRes.rows[0]?.wins) || 0;
      allocation[`account_${acc.id}`] = equity;
    }

    // Normalize allocation percentages
    Object.keys(allocation).forEach(key => {
      allocation[key] = (allocation[key] / totalEquity) * 100;
    });

    return {
      total_equity: totalEquity,
      cash_balance: totalEquity * 0.1,
      open_pnl: totalPnL,
      realized_pnl: realizedPnL,
      allocation
    };
  }

  async saveSnapshot(user_id: number, snapshot: PortfolioSnapshot) {
    await pool.query(
      `INSERT INTO portfolio_snapshot (user_id, total_equity, cash_balance, open_pnl, realized_pnl, allocation)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user_id, snapshot.total_equity, snapshot.cash_balance, snapshot.open_pnl, snapshot.realized_pnl, JSON.stringify(snapshot.allocation)]
    );
  }
}

// STAGE 8: Tax Compliance
interface TaxRecord {
  fiscal_year: number;
  short_term_gains: number;
  long_term_gains: number;
  total_loss: number;
  tax_due: number;
}

export class TaxService {
  async generateTaxReport(user_id: number, fiscal_year: number): Promise<TaxRecord> {
    const tradesRes = await pool.query(
      `SELECT t.entry_time, t.exit_time, t.pnl FROM trades t
       JOIN accounts a ON t.account_id = a.id
       WHERE a.user_id = $1 AND EXTRACT(YEAR FROM t.exit_time) = $2`,
      [user_id, fiscal_year]
    );

    let shortTerm = 0, longTerm = 0, loss = 0;

    for (const trade of tradesRes.rows) {
      const days = Math.floor((new Date(trade.exit_time).getTime() - new Date(trade.entry_time).getTime()) / (1000 * 86400));
      if (trade.pnl > 0) {
        if (days <= 365) shortTerm += trade.pnl;
        else longTerm += trade.pnl;
      } else {
        loss += Math.abs(trade.pnl);
      }
    }

    const taxDue = shortTerm * 0.3 + longTerm * 0.2;
    const record: TaxRecord = { fiscal_year, short_term_gains: shortTerm, long_term_gains: longTerm, total_loss: loss, tax_due: taxDue };

    await pool.query(
      `INSERT INTO tax_records (user_id, fiscal_year, short_term_gains, long_term_gains, total_loss, tax_due, export_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, fiscal_year) DO UPDATE SET short_term_gains = $3, long_term_gains = $4, total_loss = $5, tax_due = $6`,
      [user_id, fiscal_year, shortTerm, longTerm, loss, taxDue, JSON.stringify(record)]
    );

    return record;
  }

  async getTaxRecords(user_id: number) {
    const res = await pool.query('SELECT * FROM tax_records WHERE user_id = $1 ORDER BY fiscal_year DESC', [user_id]);
    return res.rows;
  }
}

// STAGE 9: Advanced Webhooks
interface WebhookSubscription {
  id: number;
  service: string;
  webhook_url: string;
  events: string[];
  enabled: boolean;
}

export class WebhookService {
  async subscribe(user_id: number, service: string, webhook_url: string, events: string[]) {
    const res = await pool.query(
      `INSERT INTO webhook_subscriptions (user_id, service, webhook_url, events)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, service) DO UPDATE SET webhook_url = $3, events = $4
       RETURNING *`,
      [user_id, service, webhook_url, JSON.stringify(events)]
    );
    return res.rows[0];
  }

  async getSubscriptions(user_id: number): Promise<WebhookSubscription[]> {
    const res = await pool.query(
      'SELECT * FROM webhook_subscriptions WHERE user_id = $1 AND enabled = true',
      [user_id]
    );
    return res.rows.map(r => ({ ...r, events: JSON.parse(r.events) }));
  }

  async sendWebhook(service: string, url: string, payload: any) {
    try {
      if (service === 'discord') {
        await axios.post(url, {
          content: `🔔 Alert: ${payload.message}`,
          embeds: [{ title: payload.title, description: payload.description, color: payload.color }]
        });
      } else if (service === 'telegram') {
        await axios.post(url, { text: `${payload.title}\n${payload.message}` });
      }
    } catch (error) {
      console.error(`Webhook send failed for ${service}:`, error);
    }
  }
}

// STAGE 10: Live Dashboard
interface DashboardAlert {
  id: number;
  alert_type: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  read: boolean;
}

export class DashboardService {
  async createAlert(user_id: number, type: string, message: string, severity: 'low' | 'medium' | 'high') {
    const res = await pool.query(
      `INSERT INTO dashboard_alerts (user_id, alert_type, message, severity)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [user_id, type, message, severity]
    );
    return res.rows[0];
  }

  async getAlerts(user_id: number, limit = 50) {
    const res = await pool.query(
      'SELECT * FROM dashboard_alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [user_id, limit]
    );
    return res.rows;
  }

  async markAlertRead(alert_id: number) {
    await pool.query('UPDATE dashboard_alerts SET read = true WHERE id = $1', [alert_id]);
  }

  async getLiveMetrics(user_id: number) {
    const accountsRes = await pool.query('SELECT id FROM accounts WHERE user_id = $1', [user_id]);

    let totalPnL = 0, totalTrades = 0, winRate = 0;
    for (const acc of accountsRes.rows) {
      const statsRes = await pool.query(
        `SELECT SUM(pnl) as pnl, COUNT(*) as cnt, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins
         FROM trades WHERE account_id = $1 AND DATE(entry_time) = CURRENT_DATE`,
        [acc.id]
      );
      const stats = statsRes.rows[0];
      totalPnL += parseFloat(stats.pnl) || 0;
      totalTrades += parseInt(stats.cnt);
      if (stats.cnt > 0) winRate = (parseInt(stats.wins) / parseInt(stats.cnt)) * 100;
    }

    return { totalPnL, totalTrades, winRate, timestamp: new Date() };
  }
}

export const portfolioService = new PortfolioService();
export const taxService = new TaxService();
export const webhookService = new WebhookService();
export const dashboardService = new DashboardService();
