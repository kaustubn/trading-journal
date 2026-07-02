import axios from 'axios';
import { BrokerAdapter, Trade } from '../types';
import pool from '../db';

const KITE_BASE_URL = 'https://api.kite.trade';

export class ZerodhaAdapter implements BrokerAdapter {
  private account_id: number;
  private api_key: string;
  private api_secret: string;
  private access_token: string;

  constructor(account_id: number, api_key: string, api_secret: string, access_token: string) {
    this.account_id = account_id;
    this.api_key = api_key;
    this.api_secret = api_secret;
    this.access_token = access_token;
  }

  private getHeaders() {
    return {
      'X-Kite-Version': '3',
      'Authorization': `token ${this.api_key}:${this.access_token}`,
    };
  }

  async authenticate(): Promise<void> {
    // OAuth flow would happen here in production
    // For now, assume token is already obtained
    console.log('Zerodha adapter authenticated');
  }

  async fetchTrades(from_date: Date, to_date: Date): Promise<Trade[]> {
    try {
      // Fetch orders (completed trades) from Kite API
      const response = await axios.get(`${KITE_BASE_URL}/orders`, {
        headers: this.getHeaders(),
      });

      const orders = response.data.data;
      const trades: Trade[] = [];

      // Filter completed orders within date range
      const completedOrders = orders.filter((o: any) => o.status === 'COMPLETE');

      for (const order of completedOrders) {
        const entry_time = new Date(order.order_timestamp);
        if (entry_time >= from_date && entry_time <= to_date) {
          trades.push({
            id: 0,
            account_id: this.account_id,
            broker_trade_id: `zerodha_${order.order_id}`,
            symbol: order.tradingsymbol,
            entry_time,
            exit_time: undefined,
            entry_price: order.average_price,
            exit_price: undefined,
            quantity: order.quantity,
            pnl: undefined,
            setup_tag: undefined,
            notes: undefined,
            created_at: new Date(),
            updated_at: new Date(),
          });
        }
      }

      return trades;
    } catch (error) {
      console.error('Error fetching Zerodha trades:', error);
      throw error;
    }
  }

  async refreshToken(): Promise<void> {
    // In production, refresh access token using refresh token flow
    console.log('Zerodha token refresh not implemented yet');
  }

  static async createFromCredentials(account_id: number): Promise<ZerodhaAdapter> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM broker_credentials WHERE account_id = $1',
        [account_id]
      );
      const creds = result.rows[0];
      return new ZerodhaAdapter(
        account_id,
        creds.api_key,
        creds.api_secret,
        creds.access_token
      );
    } finally {
      client.release();
    }
  }
}
