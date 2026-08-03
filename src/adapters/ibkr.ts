import axios from 'axios';
import { BrokerAdapter, Trade } from '../types';
import pool from '../db';
import { decrypt } from '../utils/crypto';

const IBKR_API_BASE = 'https://localhost:5000'; // Client Portal API (local)

export class IBKRAdapter implements BrokerAdapter {
  private account_id: number;
  private account_number: string;
  private api_key: string;

  constructor(account_id: number, account_number: string, api_key: string) {
    this.account_id = account_id;
    this.account_number = account_number;
    this.api_key = api_key;
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.api_key}`,
    };
  }

  async authenticate(): Promise<void> {
    try {
      await axios.get(`${IBKR_API_BASE}/iserver/auth/status`, {
        headers: this.getHeaders(),
        httpsAgent: { rejectUnauthorized: false }, // Local self-signed cert
      });
      console.log('IBKR adapter authenticated');
    } catch (error) {
      console.error('IBKR authentication failed:', error);
      throw error;
    }
  }

  async fetchTrades(from_date: Date, to_date: Date): Promise<Trade[]> {
    try {
      // Fetch trades from IBKR Client Portal API
      const response = await axios.get(
        `${IBKR_API_BASE}/iserver/account/${this.account_number}/trades`,
        {
          headers: this.getHeaders(),
          httpsAgent: { rejectUnauthorized: false },
          params: {
            from: from_date.toISOString().split('T')[0],
            to: to_date.toISOString().split('T')[0],
          },
        }
      );

      const trades: Trade[] = [];
      const tradeData = response.data.trades || [];

      for (const trade of tradeData) {
        trades.push({
          id: 0,
          account_id: this.account_id,
          broker_trade_id: `ibkr_${trade.execId}`,
          symbol: trade.symbol,
          entry_time: new Date(trade.execTime),
          exit_time: undefined,
          entry_price: parseFloat(trade.price),
          exit_price: undefined,
          quantity: parseInt(trade.shares),
          pnl: undefined,
          setup_tag: undefined,
          notes: undefined,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }

      return trades;
    } catch (error) {
      console.error('Error fetching IBKR trades:', error);
      throw error;
    }
  }

  async refreshToken(): Promise<void> {
    // IBKR uses session-based auth via Client Portal
    console.log('IBKR token refresh handled via Client Portal');
  }

  static async createFromCredentials(account_id: number): Promise<IBKRAdapter> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM broker_credentials WHERE account_id = $1',
        [account_id]
      );
      const creds = result.rows[0];
      return new IBKRAdapter(account_id, creds.account_number, decrypt(creds.api_key) || '');
    } finally {
      client.release();
    }
  }
}
