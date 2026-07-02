import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initializeDB() {
  const client = await pool.connect();
  try {
    console.log('Initializing database...');

    // Create tables
    const schema = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        suspended BOOLEAN DEFAULT false,
        suspended_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

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

      CREATE TABLE IF NOT EXISTS ideas (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        symbol VARCHAR(50),
        price_level DECIMAL(10, 2),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notification_preferences (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        daily_email BOOLEAN DEFAULT FALSE,
        weekly_report BOOLEAN DEFAULT FALSE,
        slack_webhook VARCHAR(500),
        pnl_alert_threshold DECIMAL(10, 2) DEFAULT 10000,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS backtest_results (
        id SERIAL PRIMARY KEY,
        account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        from_date DATE NOT NULL,
        to_date DATE NOT NULL,
        config JSONB,
        result JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS strategies (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        rules JSONB NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS strategy_backtests (
        id SERIAL PRIMARY KEY,
        strategy_id INT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
        from_date DATE NOT NULL,
        to_date DATE NOT NULL,
        result JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS insights (
        id SERIAL PRIMARY KEY,
        account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        type VARCHAR(50),
        confidence DECIMAL(5, 2),
        metrics JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS followers (
        id SERIAL PRIMARY KEY,
        follower_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(follower_id, following_id),
        CHECK (follower_id != following_id)
      );

      CREATE TABLE IF NOT EXISTS shared_trades (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        trade_id INT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
        visibility VARCHAR(20) DEFAULT 'public',
        caption TEXT,
        likes INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, trade_id)
      );

      CREATE TABLE IF NOT EXISTS leaderboard (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rank INT NOT NULL,
        monthly_pnl DECIMAL(12, 2),
        win_rate DECIMAL(5, 2),
        total_trades INT,
        followers_count INT DEFAULT 0,
        updated_at DATE DEFAULT CURRENT_DATE,
        UNIQUE(user_id, updated_at)
      );

      CREATE TABLE IF NOT EXISTS trading_bots (
        id SERIAL PRIMARY KEY,
        account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        strategy_id INT REFERENCES strategies(id) ON DELETE SET NULL,
        enabled BOOLEAN DEFAULT FALSE,
        status VARCHAR(20) DEFAULT 'inactive',
        webhook_url VARCHAR(500),
        webhook_secret VARCHAR(500),
        config JSONB,
        active_positions INT DEFAULT 0,
        total_executed INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bot_orders (
        id SERIAL PRIMARY KEY,
        bot_id INT NOT NULL REFERENCES trading_bots(id) ON DELETE CASCADE,
        strategy_signal VARCHAR(50),
        symbol VARCHAR(50) NOT NULL,
        side VARCHAR(10),
        quantity INT,
        entry_price DECIMAL(12, 4),
        stop_loss DECIMAL(12, 4),
        take_profit DECIMAL(12, 4),
        status VARCHAR(20) DEFAULT 'pending',
        executed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS open_positions (
        id SERIAL PRIMARY KEY,
        account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        symbol VARCHAR(50) NOT NULL,
        side VARCHAR(10),
        quantity INT,
        entry_price DECIMAL(12, 4),
        current_price DECIMAL(12, 4),
        pnl_points DECIMAL(12, 4),
        pnl_percent DECIMAL(5, 2),
        stop_loss DECIMAL(12, 4),
        take_profit DECIMAL(12, 4),
        opened_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS portfolio_snapshot (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        total_equity DECIMAL(14, 2),
        cash_balance DECIMAL(14, 2),
        open_pnl DECIMAL(14, 2),
        realized_pnl DECIMAL(14, 2),
        allocation JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tax_records (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        fiscal_year INT NOT NULL,
        short_term_gains DECIMAL(14, 2),
        long_term_gains DECIMAL(14, 2),
        total_loss DECIMAL(14, 2),
        tax_due DECIMAL(14, 2),
        export_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, fiscal_year)
      );

      CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        service VARCHAR(50),
        webhook_url VARCHAR(500) NOT NULL,
        events JSONB,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, service)
      );

      CREATE TABLE IF NOT EXISTS dashboard_alerts (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        alert_type VARCHAR(50),
        message TEXT,
        severity VARCHAR(20),
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_trades_account_date ON trades(account_id, DATE(entry_time));
      CREATE INDEX IF NOT EXISTS idx_trades_broker_id ON trades(broker_trade_id);
      CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id);
      CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at);
      CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
      CREATE INDEX IF NOT EXISTS idx_daily_summaries ON daily_summaries(account_id, trade_date);
      CREATE INDEX IF NOT EXISTS idx_ideas_user ON ideas(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_ideas_account ON ideas(account_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_backtest_account ON backtest_results(account_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_insights_account ON insights(account_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_followers ON followers(follower_id, following_id);
      CREATE INDEX IF NOT EXISTS idx_followers_count ON followers(following_id);
      CREATE INDEX IF NOT EXISTS idx_shared_trades ON shared_trades(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_leaderboard ON leaderboard(rank, updated_at);
      CREATE INDEX IF NOT EXISTS idx_bots_account ON trading_bots(account_id);
      CREATE INDEX IF NOT EXISTS idx_bot_orders ON bot_orders(bot_id, status);
      CREATE INDEX IF NOT EXISTS idx_open_positions ON open_positions(account_id, symbol);
      CREATE INDEX IF NOT EXISTS idx_portfolio ON portfolio_snapshot(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_tax_records ON tax_records(user_id, fiscal_year);
      CREATE INDEX IF NOT EXISTS idx_webhooks ON webhook_subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS idx_alerts ON dashboard_alerts(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_alerts_read ON dashboard_alerts(user_id, read);
    `;

    await client.query(schema);
    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
}

export default pool;
