import axios from 'axios';
import { BrokerAdapter, Trade } from '../types';
import pool from '../db';

const TV_BASE_URL = 'https://api.tradingview.com'; // placeholder - TradingView API varies

export class TradingViewAdapter implements BrokerAdapter {
  private account_id: number;
  private api_token: string;
  private paper_account_id: string;

  constructor(account_id: number, api_token: string, paper_account_id: string) {
    this.account_id = account_id;
    this.api_token = api_token;
    this.paper_account_id = paper_account_id;
  }

  private getHeaders() {
    return {
      'Authorization': `Bearer ${this.api_token}`,
      'Content-Type': 'application/json',
    };
  }

  async authenticate(): Promise<void> {
    try {
      // Verify token by fetching paper account info
      await axios.get(`${TV_BASE_URL}/user/accounts/${this.paper_account_id}`, {
        headers: this.getHeaders(),
      });
      console.log('TradingView adapter authenticated');
    } catch (error) {
      console.error('TradingView authentication failed:', error);
      throw error;
    }
  }

  async fetchTrades(from_date: Date, to_date: Date): Promise<Trade[]> {
    try {
      // Fetch paper account trades
      const response = await axios.get(
        `${TV_BASE_URL}/user/accounts/${this.paper_account_id}/orders`,
        {
          headers: this.getHeaders(),
          params: {
            from: from_date.toISOString(),
            to: to_date.toISOString(),
            status: 'filled'
          },
        }
      );

      const orders = response.data.data || [];
      const trades: Trade[] = [];

      // Group by position (entry + exit)
      const positions: { [key: string]: any } = {};

      for (const order of orders) {
        const key = `${order.symbol}`;
        if (!positions[key]) {
          positions[key] = [];
        }
        positions[key].push(order);
      }

      // Convert to trades
      for (const symbol in positions) {
        const orders = positions[symbol];
        let entry_order = null;
        let exit_order = null;

        // Assume first order is entry, last is exit (simplified)
        if (orders.length >= 1) {
          entry_order = orders[0];
          exit_order = orders[orders.length - 1];
        }

        if (entry_order) {
          let pnl = null;
          if (exit_order && exit_order.price) {
            pnl = (exit_order.price - entry_order.price) * entry_order.quantity;
          }

          trades.push({
            id: 0,
            account_id: this.account_id,
            broker_trade_id: `tradingview_${entry_order.id}`,
            symbol: entry_order.symbol,
            entry_time: new Date(entry_order.filled_at),
            exit_time: exit_order ? new Date(exit_order.filled_at) : undefined,
            entry_price: entry_order.price,
            exit_price: exit_order?.price,
            quantity: entry_order.quantity,
            pnl,
            setup_tag: undefined,
            notes: undefined,
            created_at: new Date(),
            updated_at: new Date(),
          });
        }
      }

      return trades;
    } catch (error) {
      console.error('Error fetching TradingView trades:', error);
      throw error;
    }
  }

  async refreshToken(): Promise<void> {
    // TradingView typically uses long-lived tokens
    console.log('TradingView token refresh not needed for paper trading');
  }

  static async createFromCredentials(account_id: number): Promise<TradingViewAdapter> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM broker_credentials WHERE account_id = $1',
        [account_id]
      );
      const creds = result.rows[0];
      return new TradingViewAdapter(account_id, creds.api_key, creds.api_secret);
    } finally {
      client.release();
    }
  }
}
