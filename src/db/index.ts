import { Pool, types } from 'pg';
import { runMigrations } from './migrations';

// --- Global type parsers (fixes systemic frontend crashes) ---
// node-pg returns NUMERIC/DECIMAL (oid 1700) as strings by default, so the
// frontend's `.toFixed()` calls throw "toFixed is not a function". Parse them
// as JS numbers so numeric columns arrive as numbers everywhere.
types.setTypeParser(1700, (val: string | null) => (val === null ? null : parseFloat(val)));
// DATE (oid 1082) defaults to a JS Date, which serializes to a full ISO string
// and never matches the calendar's 'YYYY-MM-DD' keys. Keep it as the raw date string.
types.setTypeParser(1082, (val: string | null) => val);
// TIMESTAMP without time zone (oid 1114): pg stores broker/platform wall-clock
// times (e.g. Tradovate "05:36"). node-pg would tag it "…Z" (UTC), so the browser
// then shifts it by its own offset and shows the wrong hour. Return it as a naive
// ISO string (no Z) so `new Date(...)` reads it as local → displays exactly as recorded.
types.setTypeParser(1114, (val: string | null) => (val ? val.replace(' ', 'T') : val));

// Neon (and most hosted Postgres) require SSL. Enable it unless connecting to a
// local/internal host. rejectUnauthorized:false accepts their managed certs.
const dbUrl = process.env.DATABASE_URL || '';
const needsSSL = /neon\.tech|render\.com|amazonaws\.com|supabase|sslmode=require/i.test(dbUrl)
  || process.env.PGSSL === 'true';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSSL ? { rejectUnauthorized: false } : undefined,
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

    // --- Migrations for existing tables (CREATE TABLE IF NOT EXISTS won't add columns) ---
    const migrations = `
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS webhook_token VARCHAR(64);
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) DEFAULT 'live';
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS prop_starting_balance DECIMAL(14,2);
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS prop_profit_target DECIMAL(14,2);
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS prop_max_drawdown DECIMAL(14,2);
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS prop_daily_loss_limit DECIMAL(14,2);
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS prop_trailing BOOLEAN DEFAULT true;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS prop_consistency_pct DECIMAL(5,2);
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS prop_min_trading_days INT;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS day_boundary_hour INT DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS micro_cost_per_trade DECIMAL(10,2) DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS cost_per_trade DECIMAL(10,2) DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'INR';
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS tags TEXT[];
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS stop_loss DECIMAL(12,4);
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS target DECIMAL(12,4);
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS rating INT;
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS grade VARCHAR(2);
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS screenshot TEXT;
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS screenshots JSONB;
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS session VARCHAR(20);
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS test_type VARCHAR(40);
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS timeframe VARCHAR(10);
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS tf_align INT;
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS planned_rr VARCHAR(12);
      UPDATE accounts SET webhook_token = md5(random()::text || id::text || clock_timestamp()::text)
        WHERE webhook_token IS NULL;
      UPDATE accounts SET account_type = 'live' WHERE account_type IS NULL;
      CREATE INDEX IF NOT EXISTS idx_accounts_webhook_token ON accounts(webhook_token);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'free';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_since TIMESTAMP;
      UPDATE users SET plan = 'pro' WHERE email = 'demo@example.com' AND (plan IS NULL OR plan = 'free');
    `;
    await client.query(migrations);
    // owner accounts on the pro plan come from the environment (PRO_EMAILS=a@x.com,b@y.com), not from the public code
    const proEmails = (process.env.PRO_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (proEmails.length) await client.query(`UPDATE users SET plan = 'pro' WHERE lower(email) = ANY($1) AND (plan IS NULL OR plan = 'free')`, [proEmails]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_notes (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note_date DATE NOT NULL,
        day_type VARCHAR(20),
        bias VARCHAR(20),
        key_levels TEXT,
        setups TEXT,
        plan TEXT,
        review TEXT,
        followed_plan BOOLEAN,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, note_date)
      );
      CREATE INDEX IF NOT EXISTS idx_daily_notes ON daily_notes(user_id, note_date);
      ALTER TABLE daily_notes ADD COLUMN IF NOT EXISTS screenshot TEXT;

      CREATE TABLE IF NOT EXISTS account_events (
        id SERIAL PRIMARY KEY,
        account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        event_date DATE NOT NULL,
        type VARCHAR(20) NOT NULL,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, event_date, type)
      );
      CREATE INDEX IF NOT EXISTS idx_account_events ON account_events(account_id, event_date);

      CREATE TABLE IF NOT EXISTS account_attempts (
        id SERIAL PRIMARY KEY,
        account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        seq INT NOT NULL,
        label VARCHAR(100),
        status VARCHAR(20) DEFAULT 'active',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_attempts_account ON account_attempts(account_id, seq);

      -- User-editable dropdown lists (pairs, setups, testing types, sessions, timeframes)
      CREATE TABLE IF NOT EXISTS journal_options (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        field VARCHAR(30) NOT NULL,
        value VARCHAR(60) NOT NULL,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, field, value)
      );
      CREATE INDEX IF NOT EXISTS idx_journal_options ON journal_options(user_id, field, sort_order);
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS attempt_id INT REFERENCES account_attempts(id) ON DELETE SET NULL;
    `);

    // Backfill: every account gets at least "Attempt 1", and existing trades get assigned to it
    await client.query(`
      INSERT INTO account_attempts (account_id, seq, label, status)
        SELECT a.id, 1, 'Attempt 1', 'active' FROM accounts a
        WHERE NOT EXISTS (SELECT 1 FROM account_attempts x WHERE x.account_id = a.id);
      UPDATE trades t SET attempt_id = (
          SELECT id FROM account_attempts aa WHERE aa.account_id = t.account_id ORDER BY seq DESC LIMIT 1
        ) WHERE attempt_id IS NULL;
    `);

    // Market bars for the chart page (see src/bars/store.ts). Prices are integer price x 100.
    await client.query(`
      CREATE TABLE IF NOT EXISTS bars_1m (
        ts TIMESTAMPTZ NOT NULL,
        o INTEGER NOT NULL, h INTEGER NOT NULL, l INTEGER NOT NULL, c INTEGER NOT NULL,
        v INTEGER NOT NULL,
        sym SMALLINT NOT NULL,
        contract SMALLINT NOT NULL DEFAULT 0,
        PRIMARY KEY (sym, ts)
      );
      CREATE TABLE IF NOT EXISTS bars_agg (
        ts TIMESTAMPTZ NOT NULL,
        o INTEGER NOT NULL, h INTEGER NOT NULL, l INTEGER NOT NULL, c INTEGER NOT NULL,
        v INTEGER NOT NULL,
        sym SMALLINT NOT NULL,
        tf SMALLINT NOT NULL,
        PRIMARY KEY (sym, tf, ts)
      );
    `);

    // Per-user chart settings (opaque JSON blob; see src/api/chartSettings.ts)
    await client.query(`
      CREATE TABLE IF NOT EXISTS chart_settings (
        user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Per-user, per-symbol chart drawings (opaque JSON array; see src/api/chartDrawings.ts)
    await client.query(`
      CREATE TABLE IF NOT EXISTS drawings (
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol VARCHAR(16) NOT NULL,
        drawings JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, symbol)
      );
    `);

    // Mentor school: courses (one JSON doc per course) and practice progress (see src/api/mentor.ts)
    await client.query(`
      CREATE TABLE IF NOT EXISTS mentor_courses (
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL CHECK (id ~ '^[a-z0-9-]{1,64}$'),
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS mentor_progress (
        user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // IANA zone the account's trade times are recorded in; NULL means New York
    await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS timezone VARCHAR(40);`);

    // Convert between an account's wall-clock timestamps and UTC (handles NULL = New York and 'BC' = Vancouver until 2026-03-08, then fixed UTC-7)
    await client.query(`
      CREATE OR REPLACE FUNCTION journal_wall_to_utc(ts timestamp, tz text) RETURNS timestamptz AS $$
        SELECT CASE
          WHEN tz IS NULL OR tz = '' THEN ts AT TIME ZONE 'America/New_York'
          WHEN tz = 'BC' THEN ts AT TIME ZONE (CASE WHEN ts < TIMESTAMP '2026-03-08 02:00' THEN 'America/Vancouver' ELSE 'Etc/GMT+7' END)
          ELSE ts AT TIME ZONE tz
        END
      $$ LANGUAGE sql STABLE;
      CREATE OR REPLACE FUNCTION journal_utc_to_wall(t timestamptz, tz text) RETURNS timestamp AS $$
        SELECT CASE
          WHEN tz IS NULL OR tz = '' THEN t AT TIME ZONE 'America/New_York'
          WHEN tz = 'BC' THEN t AT TIME ZONE (CASE WHEN t < TIMESTAMPTZ '2026-03-08 10:00:00+00' THEN 'America/Vancouver' ELSE 'Etc/GMT+7' END)
          ELSE t AT TIME ZONE tz
        END
      $$ LANGUAGE sql STABLE;
    `);

    // Packed monthly bar blocks for the pattern scanners (src/patterns/barPack.ts)
    await client.query(`CREATE TABLE IF NOT EXISTS scan_cache (
      key TEXT PRIMARY KEY, ver TEXT NOT NULL, data BYTEA NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);

    // Change counter per account, read by the server's trade cache (src/cache). Bumped by triggers on
    // every insert / update / delete of the account's trades, and on any edit of the account row itself.
    await client.query(`
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS data_ver BIGINT NOT NULL DEFAULT 1;

      CREATE OR REPLACE FUNCTION journal_bump_ver_new() RETURNS trigger AS $$
      BEGIN
        UPDATE accounts SET data_ver = data_ver + 1 WHERE id IN (SELECT DISTINCT account_id FROM new_rows);
        RETURN NULL;
      END $$ LANGUAGE plpgsql;
      CREATE OR REPLACE FUNCTION journal_bump_ver_old() RETURNS trigger AS $$
      BEGIN
        UPDATE accounts SET data_ver = data_ver + 1 WHERE id IN (SELECT DISTINCT account_id FROM old_rows);
        RETURN NULL;
      END $$ LANGUAGE plpgsql;
      CREATE OR REPLACE FUNCTION journal_bump_ver_upd() RETURNS trigger AS $$
      BEGIN
        UPDATE accounts SET data_ver = data_ver + 1
         WHERE id IN (SELECT account_id FROM new_rows UNION SELECT account_id FROM old_rows);
        RETURN NULL;
      END $$ LANGUAGE plpgsql;
      CREATE OR REPLACE FUNCTION journal_account_touch() RETURNS trigger AS $$
      BEGIN
        IF NEW.data_ver = OLD.data_ver AND NEW IS DISTINCT FROM OLD THEN NEW.data_ver := OLD.data_ver + 1; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trades_ver_ins ON trades;
      CREATE TRIGGER trades_ver_ins AFTER INSERT ON trades REFERENCING NEW TABLE AS new_rows
        FOR EACH STATEMENT EXECUTE FUNCTION journal_bump_ver_new();
      DROP TRIGGER IF EXISTS trades_ver_del ON trades;
      CREATE TRIGGER trades_ver_del AFTER DELETE ON trades REFERENCING OLD TABLE AS old_rows
        FOR EACH STATEMENT EXECUTE FUNCTION journal_bump_ver_old();
      DROP TRIGGER IF EXISTS trades_ver_upd ON trades;
      CREATE TRIGGER trades_ver_upd AFTER UPDATE ON trades REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
        FOR EACH STATEMENT EXECUTE FUNCTION journal_bump_ver_upd();
      DROP TRIGGER IF EXISTS accounts_ver_touch ON accounts;
      CREATE TRIGGER accounts_ver_touch BEFORE UPDATE ON accounts
        FOR EACH ROW EXECUTE FUNCTION journal_account_touch();
    `);

    // Versioned, run-once changes (new features add entries to src/db/migrations.ts)
    await runMigrations(client);

    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
}

export default pool;
