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
