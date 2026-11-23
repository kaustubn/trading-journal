// Versioned, run-once schema changes. initializeDB() calls runMigrations() after the base schema.
// Rules: never edit or reorder an entry that has shipped; add a new one with the next id.
// Each migration runs in its own transaction and is recorded in schema_migrations.
import type { PoolClient } from 'pg';

export interface Migration { id: string; sql: string }

export const MIGRATIONS: Migration[] = [
  {
    // users.role was only part of CREATE TABLE, so databases created before it existed lacked the column
    // and /api/auth/me failed (found 2026-11-19 on an older local database).
    id: '001_users_role',
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';`,
  },
  {
    // Backtest Session Tracker (practice time on Market Chart replay / S1 Practice)
    id: '002_backtest_sessions',
    sql: `
      CREATE TABLE IF NOT EXISTS bt_sessions (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        page VARCHAR(30) NOT NULL DEFAULT 'marketchart',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        status VARCHAR(10) NOT NULL DEFAULT 'running',
        active_sec INT NOT NULL DEFAULT 0,
        idle_sec INT NOT NULL DEFAULT 0,
        pause_sec INT NOT NULL DEFAULT 0,
        setup_tag VARCHAR(100),
        instrument VARCHAR(20),
        timeframe VARCHAR(10),
        hist_from DATE,
        hist_to DATE,
        trades_logged INT NOT NULL DEFAULT 0,
        last_seq INT NOT NULL DEFAULT 0,
        last_beat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        lock_tab VARCHAR(64),
        lock_until TIMESTAMPTZ,
        edited BOOLEAN NOT NULL DEFAULT false,
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_bt_sessions_user ON bt_sessions(user_id, started_at DESC);
      CREATE TABLE IF NOT EXISTS bt_session_minutes (
        session_id INT NOT NULL REFERENCES bt_sessions(id) ON DELETE CASCADE,
        minute_utc TIMESTAMPTZ NOT NULL,
        active_sec INT NOT NULL,
        PRIMARY KEY (session_id, minute_utc)
      );
      CREATE TABLE IF NOT EXISTS bt_session_days (
        session_id INT NOT NULL REFERENCES bt_sessions(id) ON DELETE CASCADE,
        hist_date DATE NOT NULL,
        PRIMARY KEY (session_id, hist_date)
      );
      CREATE TABLE IF NOT EXISTS bt_coverage_tags (
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        hist_date DATE NOT NULL,
        tag VARCHAR(10) NOT NULL,
        PRIMARY KEY (user_id, hist_date)
      );
      CREATE TABLE IF NOT EXISTS bt_setup_targets (
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        setup_tag VARCHAR(100) NOT NULL,
        target INT NOT NULL DEFAULT 100,
        PRIMARY KEY (user_id, setup_tag)
      );
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS bt_session_id INT REFERENCES bt_sessions(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_trades_bt_session ON trades(bt_session_id) WHERE bt_session_id IS NOT NULL;
    `,
  },
  {
    // News Event Analyzer: imported consensus forecasts (and upcoming release dates) + prop-firm news blackout per account
    id: '003_news_analyzer',
    sql: `
      CREATE TABLE IF NOT EXISTS econ_forecasts (
        event VARCHAR(10) NOT NULL,
        release_date DATE NOT NULL,
        release_time VARCHAR(5),
        forecast NUMERIC,
        source VARCHAR(100),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (event, release_date)
      );
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS news_blackout_before_min INT;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS news_blackout_after_min INT;
    `,
  },
  {
    // Prop rules: drawdown type (eod / intraday / static), lock at the starting balance, chosen firm preset.
    // Existing accounts keep today's behaviour: trailing = follows every closed trade (intraday), not trailing = static.
    id: '004_prop_drawdown_types',
    sql: `
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS prop_dd_type VARCHAR(10);
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS prop_lock_at_start BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS prop_preset VARCHAR(40);
      UPDATE accounts SET prop_dd_type = CASE WHEN prop_trailing = false THEN 'static' ELSE 'intraday' END WHERE prop_dd_type IS NULL;
    `,
  },
  {
    // Economic calendar (any release, imported from ForexFactory files), big-tech earnings dates, a small cache for
    // market snapshots, personal risk rules, post-trade debriefs, and Telegram alert settings + sent log (2026-11-20).
    id: '005_calendar_discipline_alerts',
    sql: `
      CREATE TABLE IF NOT EXISTS econ_events (
        id SERIAL PRIMARY KEY,
        release_utc TIMESTAMPTZ NOT NULL,
        title VARCHAR(160) NOT NULL,
        currency VARCHAR(8) NOT NULL DEFAULT 'USD',
        impact VARCHAR(10) NOT NULL DEFAULT 'high',
        actual VARCHAR(40), forecast VARCHAR(40), previous VARCHAR(40),
        source VARCHAR(40),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (release_utc, title, currency)
      );
      CREATE INDEX IF NOT EXISTS idx_econ_events_time ON econ_events(release_utc);
      CREATE TABLE IF NOT EXISTS earnings_events (
        symbol VARCHAR(12) NOT NULL,
        report_date DATE NOT NULL,
        timing VARCHAR(20),
        eps_forecast VARCHAR(20),
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (symbol, report_date)
      );
      CREATE TABLE IF NOT EXISTS market_cache (
        key VARCHAR(80) PRIMARY KEY,
        data JSONB NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS account_rules (
        account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        max_trades_day INT, max_losses_day INT, max_contracts INT,
        max_daily_loss NUMERIC(12, 2),
        start_time VARCHAR(5), end_time VARCHAR(5),
        respect_news BOOLEAN NOT NULL DEFAULT false,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS trade_debriefs (
        trade_id INT PRIMARY KEY REFERENCES trades(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        followed_plan BOOLEAN, emotion VARCHAR(20), retake BOOLEAN, quality SMALLINT,
        lesson TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_trade_debriefs_user ON trade_debriefs(user_id);
      CREATE TABLE IF NOT EXISTS alert_settings (
        user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        telegram_token TEXT, telegram_chat VARCHAR(40),
        enabled BOOLEAN NOT NULL DEFAULT false,
        account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
        news BOOLEAN NOT NULL DEFAULT true, earnings BOOLEAN NOT NULL DEFAULT true,
        rules BOOLEAN NOT NULL DEFAULT true, prop BOOLEAN NOT NULL DEFAULT true, brief BOOLEAN NOT NULL DEFAULT true,
        lead_min INT NOT NULL DEFAULT 15,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS alert_log (
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key VARCHAR(200) NOT NULL,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, key)
      );
    `,
  },
  {
    // News page + app notifications (2026-11-23): server key pair store, one row per device that turned
    // notifications on, and which news alerts a user wants (Telegram keeps using alert_settings.enabled).
    id: '006_news_push',
    sql: `
      CREATE TABLE IF NOT EXISTS app_kv (
        key VARCHAR(40) PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS push_subs (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh VARCHAR(200) NOT NULL, auth VARCHAR(60) NOT NULL,
        label VARCHAR(80) NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subs(user_id);
      ALTER TABLE alert_settings ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE alert_settings ADD COLUMN IF NOT EXISTS headlines BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE alert_settings ADD COLUMN IF NOT EXISTS bigmove BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE alert_settings ADD COLUMN IF NOT EXISTS bigmove_pct NUMERIC(4, 2) NOT NULL DEFAULT 0.6;
    `,
  },
  {
    // Practice Log (2026-11-23): which market sessions (Asia / London / NY AM ...) the replayed candles were in.
    id: '007_bt_market_sessions',
    sql: `ALTER TABLE bt_sessions ADD COLUMN IF NOT EXISTS mkt_sessions VARCHAR(80);`,
  },
];

export async function runMigrations(client: PoolClient, list: Migration[] = MIGRATIONS): Promise<string[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const done = new Set((await client.query('SELECT id FROM schema_migrations')).rows.map(r => r.id as string));
  const applied: string[] = [];
  for (const m of list) {
    if (done.has(m.id)) continue;
    try {
      await client.query('BEGIN');
      await client.query(m.sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
      await client.query('COMMIT');
      applied.push(m.id);
      console.log('[migrations] applied', m.id);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[migrations] FAILED', m.id, (e as Error).message);
      throw e;
    }
  }
  return applied;
}
