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
