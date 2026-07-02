-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Accounts (Zerodha, Lucid, etc.)
CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker VARCHAR(50) NOT NULL,
  account_number VARCHAR(100) NOT NULL,
  account_name VARCHAR(100),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, broker, account_number)
);

-- Broker credentials (encrypted)
CREATE TABLE IF NOT EXISTS broker_credentials (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  api_key VARCHAR(500),
  api_secret VARCHAR(500),
  access_token VARCHAR(1000),
  refresh_token VARCHAR(1000),
  token_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trades (immutable once inserted, deduped by broker_trade_id)
CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  broker_trade_id VARCHAR(100) UNIQUE NOT NULL,
  symbol VARCHAR(50) NOT NULL,
  entry_time TIMESTAMP NOT NULL,
  exit_time TIMESTAMP,
  entry_price DECIMAL(10, 2) NOT NULL,
  exit_price DECIMAL(10, 2),
  quantity INT NOT NULL,
  pnl DECIMAL(10, 2),
  setup_tag VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_account_date (account_id, DATE(entry_time)),
  INDEX idx_broker_trade_id (broker_trade_id)
);

-- Daily summaries (materialized for O(1) calendar queries)
CREATE TABLE IF NOT EXISTS daily_summaries (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  trade_date DATE NOT NULL,
  daily_pnl DECIMAL(10, 2),
  trade_count INT DEFAULT 0,
  wins INT DEFAULT 0,
  losses INT DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id, trade_date)
);

-- Sync logs (audit trail)
CREATE TABLE IF NOT EXISTS sync_logs (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sync_type VARCHAR(50),
  status VARCHAR(20),
  trades_inserted INT DEFAULT 0,
  trades_updated INT DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
