// Read-only logical backup: dumps every table's rows to a timestamped JSON file.
// Run with the DB URL injected, e.g.:  railway run node scripts/backup.js
// Restore path (later, into Neon): the app auto-creates the schema on boot,
// then a companion restore script re-inserts these rows.
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const outDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = path.join(outDir, `backup-${stamp}.json`);

  const tablesRes = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  const dump = { takenAt: new Date().toISOString(), tables: {} };
  let totalRows = 0;

  for (const { tablename } of tablesRes.rows) {
    try {
      const r = await pool.query(`SELECT * FROM "${tablename}"`);
      dump.tables[tablename] = r.rows;
      totalRows += r.rows.length;
      console.log(`  ${tablename}: ${r.rows.length} rows`);
    } catch (e) {
      console.log(`  ${tablename}: SKIP (${e.message})`);
    }
  }

  fs.writeFileSync(outFile, JSON.stringify(dump, null, 2));
  const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
  console.log(`\nBACKUP OK -> ${outFile}`);
  console.log(`Tables: ${Object.keys(dump.tables).length}, rows: ${totalRows}, size: ${kb} KB`);
  await pool.end();
})().catch(e => { console.error('BACKUP FAILED:', e.message); process.exit(1); });
