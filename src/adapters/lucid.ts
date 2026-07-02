import axios from 'axios';
import { BrokerAdapter, Trade } from '../types';
import pool from '../db';

const LUCID_BASE_URL = 'https://api.lucidtrading.com'; // placeholder

export class LucidAdapter implements BrokerAdapter {
  private account_id: number;
  private api_key: string;

  constructor(account_id: number, api_key: string) {
    this.account_id = account_id;
    this.api_key = api_key;
  }

  private getHeaders() {
    return {
      'Authorization': `Bearer ${this.api_key}`,
      'Content-Type': 'application/json',
    };
  }

  async authenticate(): Promise<void> {
    try {
      await axios.get(`${LUCID_BASE_URL}/auth/verify`, {
        headers: this.getHeaders(),
      });
      console.log('Lucid adapter authenticated');
    } catch (error) {
      console.error('Lucid authentication failed:', error);
      throw error;
    }
  }

  async fetchTrades(from_date: Date, to_date: Date): Promise<Trade[]> {
    try {
      const response = await axios.get(`${LUCID_BASE_URL}/trades`, {
        headers: this.getHeaders(),
        params: {
          from: from_date.toISOString(),
          to: to_date.toISOString(),
        },
      });

      const lucidTrades = response.data.data || [];
      const trades: Trade[] = lucidTrades.map((t: any) => ({
        id: 0,
        account_id: this.account_id,
        broker_trade_id: `lucid_${t.trade_id}`,
        symbol: t.symbol,
        entry_time: new Date(t.entry_time),
        exit_time: t.exit_time ? new Date(t.exit_time) : undefined,
        entry_price: t.entry_price,
        exit_price: t.exit_price,
        quantity: t.quantity,
        pnl: t.pnl,
        setup_tag: undefined,
        notes: undefined,
        created_at: new Date(),
        updated_at: new Date(),
      }));

      return trades;
    } catch (error) {
      console.error('Error fetching Lucid trades:', error);
      throw error;
    }
  }

  async refreshToken(): Promise<void> {
    // Lucid uses static API keys, no refresh needed
    console.log('Lucid adapter uses static API keys, no refresh needed');
  }

  static async createFromCredentials(account_id: number): Promise<LucidAdapter> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM broker_credentials WHERE account_id = $1',
        [account_id]
      );
      const creds = result.rows[0];
      return new LucidAdapter(account_id, creds.api_key);
    } finally {
      client.release();
    }
  }
}
