import axios from 'axios';
import pool from '../db';
import { BrokerAdapter, Trade } from '../types';

export class FyresAdapter implements BrokerAdapter {
  private apiKey: string;
  private apiSecret: string;
  private baseURL = 'https://api.fyres.in/api/v1';

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  static async createFromCredentials(account_id: number): Promise<FyresAdapter> {
    const result = await pool.query(
      'SELECT api_key, api_secret FROM broker_credentials WHERE account_id = $1',
      [account_id]
    );

    if (!result.rows[0]) {
      throw new Error('Fyres credentials not found');
    }

    const { api_key, api_secret } = result.rows[0];
    return new FyresAdapter(api_key, api_secret);
  }

  async authenticate(): Promise<void> {
    // Fyres uses API key/secret, no token refresh needed
    const valid = await this.validateCredentials();
    if (!valid) {
      throw new Error('Fyres authentication failed');
    }
  }

  async fetchTrades(fromDate: Date, toDate: Date): Promise<Trade[]> {
    try {
      const response = await axios.get(`${this.baseURL}/trades`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'X-API-Secret': this.apiSecret
        },
        params: {
          from_date: fromDate.toISOString().split('T')[0],
          to_date: toDate.toISOString().split('T')[0],
          status: 'closed'
        }
      });

      return response.data.trades.map((trade: any) => ({
        broker_trade_id: trade.order_id,
        symbol: trade.instrument,
        entry_time: new Date(trade.entry_time),
        exit_time: trade.exit_time ? new Date(trade.exit_time) : undefined,
        entry_price: parseFloat(trade.entry_price),
        exit_price: trade.exit_price ? parseFloat(trade.exit_price) : undefined,
        quantity: parseInt(trade.quantity),
        pnl: parseFloat(trade.pnl),
        setup_tag: trade.tag || 'scalp'
      }));
    } catch (error) {
      console.error('Fyres API error:', error);
      throw error;
    }
  }

  async getOpenPositions(): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseURL}/positions/open`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'X-API-Secret': this.apiSecret
        }
      });

      return response.data.positions || [];
    } catch (error) {
      console.error('Fyres open positions error:', error);
      return [];
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseURL}/account/info`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'X-API-Secret': this.apiSecret
        }
      });
      return !!response.data.account_id;
    } catch (error) {
      console.error('Fyres validation failed:', error);
      return false;
    }
  }

  async getAccountInfo(): Promise<any> {
    try {
      const response = await axios.get(`${this.baseURL}/account/info`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'X-API-Secret': this.apiSecret
        }
      });
      return response.data;
    } catch (error) {
      console.error('Fyres account info error:', error);
      return null;
    }
  }

  async refreshToken(): Promise<void> {
    // Fyres uses static API keys, no token refresh needed
  }
}
