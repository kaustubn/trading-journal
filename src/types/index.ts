export interface User {
  id: number;
  email: string;
  password: string;
  created_at: Date;
}

export interface Account {
  id: number;
  user_id: number;
  broker: string;
  account_number: string;
  account_name?: string;
  status: string;
  created_at: Date;
}

export interface BrokerCredentials {
  id: number;
  account_id: number;
  api_key?: string;
  api_secret?: string;
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: Date;
}

export interface Trade {
  id: number;
  account_id: number;
  broker_trade_id: string;
  symbol: string;
  entry_time: Date;
  exit_time?: Date;
  entry_price: number;
  exit_price?: number;
  quantity: number;
  pnl?: number;
  setup_tag?: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

export interface DailySummary {
  id: number;
  account_id: number;
  trade_date: string;
  daily_pnl?: number;
  trade_count: number;
  wins: number;
  losses: number;
  updated_at: Date;
}

export interface SyncLog {
  id: number;
  account_id: number;
  sync_type: string;
  status: string;
  trades_inserted: number;
  trades_updated: number;
  error_message?: string;
  created_at: Date;
}

export interface Idea {
  id: number;
  user_id: number;
  account_id?: number;
  title: string;
  description?: string;
  symbol?: string;
  price_level?: number;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface BrokerAdapter {
  authenticate(): Promise<void>;
  fetchTrades(from_date: Date, to_date: Date): Promise<Trade[]>;
  refreshToken(): Promise<void>;
}
