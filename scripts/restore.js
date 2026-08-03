// Restore a backup JSON into a target Postgres (e.g. Neon), AFTER the app has
// booted once so initializeDB() created all tables. Idempotent (ON CONFLICT DO NOTHING).
// Usage:  DATABASE_URL="<neon url>" node scripts/restore.js [backups/backup-XXXX.json]
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Parent -> child insert order so foreign keys resolve.
const ORDER = [
  'users', 'accounts', 'account_attempts', 'trades', 'account_events', 'daily_notes',
  'broker_credentials', 'insights', 'portfolio_snapshot', 'daily_summaries', 'open_positions',
  'sync_logs', 'ideas', 'strategies', 'strategy_backtests', 'backtest_results', 'trading_bots',
  'bot_orders', 'notification_preferences', 'dashboard_alerts', 'followers', 'shared_trades',
  'leaderboard', 'tax_records', 'webhook_subscriptions',
];

function coerce(v) {
  // jsonb objects need stringifying; arrays (TEXT[]) and ISO date strings pass through.
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
    return JSON.stringify(v);
  }
  return v;
}

(async () => {
  const file = process.argv[2] || fs.readdirSync(path.join(__dirname, '..', 'backups'))
    .filter(f => f.startsWith('backup-') && f.endsWith('.json')).sort().pop();
  const full = path.isAbsolute(file) ? file : path.join(__dirname, '..', 'backups', file);
  const dump = JSON.parse(fs.readFileSync(full, 'utf8'));
  console.log(`Restoring ${full} (taken ${dump.takenAt})`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const names = Object.keys(dump.tables);
  const ordered = [...ORDER.filter(t => names.includes(t)), ...names.filter(t => !ORDER.includes(t))];

  for (const table of ordered) {
    const rows = dump.tables[table] || [];
    if (rows.length === 0) { console.log(`  ${table}: 0 (skip)`); continue; }
    let ok = 0;
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map(c => coerce(row[c]));
      const ph = cols.map((_, i) => `$${i + 1}`).join(',');
      const colList = cols.map(c => `"${c}"`).join(',');
      try {
        const r = await pool.query(
          `INSERT INTO "${table}" (${colList}) VALUES (${ph}) ON CONFLICT DO NOTHING`, vals);
        ok += r.rowCount;
      } catch (e) {
        console.log(`    row error in ${table}: ${e.message}`);
      }
    }
    // Reset the id sequence so new inserts don't collide with restored ids
    try {
      await pool.query(
        `SELECT setval(pg_get_serial_sequence('"${table}"','id'),
                       COALESCE((SELECT MAX(id) FROM "${table}"), 1), true)`);
    } catch { /* table has no serial id — fine */ }
    console.log(`  ${table}: ${ok}/${rows.length} inserted`);
  }

  console.log('\nRESTORE DONE');
  await pool.end();
})().catch(e => { console.error('RESTORE FAILED:', e.message); process.exit(1); });
