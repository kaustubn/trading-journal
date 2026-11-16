// One-time loader: imports NQ futures 1-minute bars from CSV files into Postgres (table bars_1m).
//
//   node scripts/import_bars.js [--dir <path>] [--symbol NQ] [--dry-run]
//
// - Only files named exactly NQ_front_1m_<YYYY>.csv in --dir (default ./data) are loaded, in filename order.
// - Files are streamed line by line (never fully in memory).
// - Safe to re-run: rows already present (same sym + ts) are skipped via ON CONFLICT DO NOTHING.
// - --dry-run parses and validates everything and opens NO database connection.
// - Connection string comes from DATABASE_URL (never printed; only the hostname is shown).
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const FILE_RE = /^NQ_front_1m_\d{4}\.csv$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SYM_RE = /^NQ([FGHJKMNQUVXZ])(\d)$/;
const MONTHS = { F: 1, G: 2, H: 3, J: 4, K: 5, M: 6, N: 7, Q: 8, U: 9, V: 10, X: 11, Z: 12 };
const SYM_ID = 1; // NQ
const BATCH_SIZE = 10000;
const PROGRESS_EVERY = 50000;
const INT_MAX = 2147483647;
const MAX_BAD_SAMPLES = 5;
const SSL_RE = /neon\.tech|render\.com|amazonaws\.com|supabase|sslmode=require/i;

const DDL = `CREATE TABLE IF NOT EXISTS bars_1m (
  ts TIMESTAMPTZ NOT NULL,
  o INTEGER NOT NULL, h INTEGER NOT NULL, l INTEGER NOT NULL, c INTEGER NOT NULL,
  v INTEGER NOT NULL,
  sym SMALLINT NOT NULL,
  contract SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (sym, ts)
)`;

const INSERT_SQL =
  'INSERT INTO bars_1m (ts,o,h,l,c,v,sym,contract) SELECT * FROM unnest($1::timestamptz[],$2::int[],$3::int[],$4::int[],$5::int[],$6::int[],$7::smallint[],$8::smallint[]) ON CONFLICT (sym, ts) DO NOTHING';

class FatalError extends Error {}
function fatal(msg) { throw new FatalError(msg); }

function parseArgs(argv) {
  const a = { dir: './data', dryRun: false, symbol: 'NQ' };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry-run') a.dryRun = true;
    else if (t === '--dir') { a.dir = argv[++i]; if (!a.dir) fatal('--dir requires a path'); }
    else if (t.startsWith('--dir=')) a.dir = t.slice(6);
    else if (t === '--symbol') { a.symbol = argv[++i]; if (!a.symbol) fatal('--symbol requires a value'); }
    else if (t.startsWith('--symbol=')) a.symbol = t.slice(9);
    else fatal(`Unknown argument: ${t}`);
  }
  if (a.symbol !== 'NQ') fatal(`Unsupported --symbol "${a.symbol}" (only NQ is supported)`);
  return a;
}

// Returns a row object, or a string describing why the line is bad.
function parseRow(line) {
  const f = line.split(',');
  if (f.length !== 7) return `expected 7 fields, got ${f.length}`;
  const [tsRaw, so, sh, sl, sc, sv, symRaw] = f.map((s) => s.trim());

  if (!TS_RE.test(tsRaw)) return 'bad timestamp format';
  const d = new Date(tsRaw + ':00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 16) !== tsRaw) return 'invalid calendar timestamp';

  for (const s of [so, sh, sl, sc, sv]) if (s === '') return 'empty numeric field';
  const o = Math.round(Number(so) * 100);
  const h = Math.round(Number(sh) * 100);
  const l = Math.round(Number(sl) * 100);
  const c = Math.round(Number(sc) * 100);
  const v = Math.round(Number(sv));
  if (![o, h, l, c, v].every(Number.isFinite)) return 'non-numeric value';
  if ([o, h, l, c, v].some((x) => Math.abs(x) > INT_MAX)) return 'value out of INTEGER range';
  if (h < Math.max(o, c)) return 'high below open/close';
  if (l > Math.min(o, c)) return 'low above open/close';
  if (v < 0) return 'negative volume';

  const m = SYM_RE.exec(symRaw);
  if (!m) return `unrecognised symbol "${symRaw.slice(0, 20)}"`;
  const month = MONTHS[m[1]];
  const digit = Number(m[2]);
  const barYear = d.getUTCFullYear();
  let year;
  if (barYear % 10 === digit) year = barYear;
  else if ((barYear + 1) % 10 === digit) year = barYear + 1;
  else return `contract year digit ${digit} does not fit bar year ${barYear}`;
  const contract = (year % 100) * 100 + month;

  return { ts: tsRaw + ':00Z', tsKey: tsRaw, o, h, l, c, v, contract };
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (_) { /* fall through */ }
  const m = /@([^/:?#]+)/.exec(url);
  return m ? m[1] : '(unknown host)';
}

async function processFile(filePath, fileName, run) {
  const st = {
    rows: 0, bad: 0, inserted: 0, present: 0,
    first: null, last: null, outOfOrder: 0, dupTs: 0,
    contracts: new Map(), // contract -> first bar ts (min)
  };
  const newBatch = () => ({ ts: [], o: [], h: [], l: [], c: [], v: [], sym: [], contract: [] });
  let batch = newBatch();
  let prevTs = null;
  let lineNo = 0;

  const flush = async () => {
    const n = batch.ts.length;
    if (!n) return;
    if (run.client) {
      const r = await run.client.query(INSERT_SQL, [
        batch.ts, batch.o, batch.h, batch.l, batch.c, batch.v, batch.sym, batch.contract,
      ]);
      st.inserted += r.rowCount;
      st.present += n - r.rowCount;
    }
    batch = newBatch();
  };

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (let line of rl) {
    lineNo++;
    if (lineNo === 1) {
      line = line.replace(/^﻿/, '');
      if (/^ts_utc\b/i.test(line)) continue; // header
    }
    if (line.trim() === '') continue;
    st.rows++;

    const r = parseRow(line);
    if (typeof r === 'string') {
      st.bad++;
      if (run.badSamples < MAX_BAD_SAMPLES) {
        run.badSamples++;
        console.log(`  BAD ${fileName}:${lineNo} (${r}): ${line.slice(0, 200)}`);
      }
    } else {
      if (st.first === null || r.tsKey < st.first) st.first = r.tsKey;
      if (st.last === null || r.tsKey > st.last) st.last = r.tsKey;
      if (prevTs !== null) {
        if (r.tsKey < prevTs) st.outOfOrder++;
        else if (r.tsKey === prevTs) st.dupTs++;
      }
      prevTs = r.tsKey;
      const cur = st.contracts.get(r.contract);
      if (cur === undefined || r.tsKey < cur) st.contracts.set(r.contract, r.tsKey);

      batch.ts.push(r.ts); batch.o.push(r.o); batch.h.push(r.h); batch.l.push(r.l);
      batch.c.push(r.c); batch.v.push(r.v); batch.sym.push(SYM_ID); batch.contract.push(r.contract);
      if (batch.ts.length >= BATCH_SIZE) await flush();
    }

    if (st.rows % PROGRESS_EVERY === 0) {
      console.log(`  ${fileName}: ${st.rows.toLocaleString()} rows read` +
        (run.client ? `, ${st.inserted.toLocaleString()} inserted, ${st.present.toLocaleString()} already present` : '') +
        `, ${st.bad} bad`);
    }
  }
  await flush();
  return st;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(args.dir);

  let entries;
  try {
    if (!fs.statSync(dir).isDirectory()) fatal(`Not a directory: ${dir}`);
    entries = fs.readdirSync(dir);
  } catch (e) {
    if (e instanceof FatalError) throw e;
    fatal(`Cannot read directory ${dir}: ${e.message}`);
  }
  const files = entries.filter((n) => FILE_RE.test(n)).sort();
  if (!files.length) fatal(`No files matching NQ_front_1m_YYYY.csv in ${dir}`);

  console.log(`${args.dryRun ? 'DRY RUN - ' : ''}Importing ${files.length} file(s) from ${dir}`);
  files.forEach((f) => console.log(`  ${f}`));

  const run = { client: null, badSamples: 0 };
  let client = null;

  if (!args.dryRun) {
    require('dotenv').config({ quiet: true });
    let url = process.env.DATABASE_URL;
    if (!url) fatal('DATABASE_URL is not set');
    const { Client } = require('pg');
    const cfg = {};
    if (SSL_RE.test(url)) {
      cfg.ssl = { rejectUnauthorized: false };
      // Strip sslmode so pg-connection-string cannot override the explicit ssl option above.
      url = url.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');
    }
    cfg.connectionString = url;
    console.log(`Database host: ${hostOf(url)}`);
    client = new Client(cfg);
    client.on('error', () => { /* surfaced via the failing query */ });
    try {
      await client.connect();
      await client.query(DDL);
    } catch (e) {
      const c = client;
      client = null;
      try { await c.end(); } catch (_) { /* ignore */ }
      fatal(`Database error: ${e.message}`);
    }
    run.client = client;
  }

  const t0 = Date.now();
  const totals = { rows: 0, inserted: 0, present: 0, bad: 0 };
  const allContracts = new Map();
  let first = null;
  let last = null;

  try {
    for (const name of files) {
      console.log(`\n== ${name} ==`);
      const t1 = Date.now();
      let st;
      try {
        st = await processFile(path.join(dir, name), name, run);
      } catch (e) {
        if (e instanceof FatalError) throw e;
        fatal(`Error while processing ${name}: ${e.message}`);
      }
      const secs = ((Date.now() - t1) / 1000).toFixed(1);
      totals.rows += st.rows; totals.inserted += st.inserted; totals.present += st.present; totals.bad += st.bad;
      if (st.first !== null && (first === null || st.first < first)) first = st.first;
      if (st.last !== null && (last === null || st.last > last)) last = st.last;
      for (const [k, v] of st.contracts) {
        const cur = allContracts.get(k);
        if (cur === undefined || v < cur) allContracts.set(k, v);
      }

      if (args.dryRun) {
        console.log(`  ${name}: ${st.rows.toLocaleString()} rows, ${st.bad} bad, first ${st.first}, last ${st.last}, ${secs}s`);
        console.log(`    contracts: ${[...st.contracts.keys()].sort((a, b) => a - b).join(', ') || '(none)'}`);
        if (st.outOfOrder || st.dupTs) {
          console.log(`    note: ${st.outOfOrder} out-of-order timestamps, ${st.dupTs} duplicate consecutive timestamps`);
        }
      } else {
        console.log(`  ${name} done: ${st.rows.toLocaleString()} read, ${st.inserted.toLocaleString()} inserted, ` +
          `${st.present.toLocaleString()} already present, ${st.bad} bad, ${secs}s`);
      }
    }

    const totalSecs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('\n===== SUMMARY =====');
    console.log(`Rows read: ${totals.rows.toLocaleString()}`);
    if (!args.dryRun) {
      console.log(`Inserted: ${totals.inserted.toLocaleString()}`);
      console.log(`Already present: ${totals.present.toLocaleString()}`);
    }
    console.log(`Bad rows: ${totals.bad.toLocaleString()}`);
    console.log(`First ts: ${first}   Last ts: ${last}`);
    console.log(`Time: ${totalSecs}s`);

    if (args.dryRun) {
      console.log('Contract codes seen (first bar time):');
      for (const [k, v] of [...allContracts].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))) {
        console.log(`  ${k}  ${v}`);
      }
      console.log('(dry run: no database connection was opened)');
    } else {
      try {
        const s = await client.query('SELECT COUNT(*)::bigint AS n, MIN(ts) AS mn, MAX(ts) AS mx FROM bars_1m WHERE sym = $1', [SYM_ID]);
        const row = s.rows[0];
        console.log(`\nbars_1m (sym=${SYM_ID}): COUNT(*) = ${Number(row.n).toLocaleString()}, MIN(ts) = ${row.mn ? row.mn.toISOString() : null}, MAX(ts) = ${row.mx ? row.mx.toISOString() : null}`);
        const cs = await client.query('SELECT contract, MIN(ts) AS first_ts FROM bars_1m WHERE sym = $1 GROUP BY contract ORDER BY 2', [SYM_ID]);
        console.log('Contracts (first bar time):');
        for (const r of cs.rows) console.log(`  ${r.contract}  ${r.first_ts.toISOString()}`);
      } catch (e) {
        fatal(`Database error: ${e.message}`);
      }
    }
  } finally {
    if (client) { try { await client.end(); } catch (_) { /* ignore */ } }
  }
}

main().catch((e) => {
  console.error(`IMPORT FAILED: ${e instanceof FatalError ? e.message : (e && e.message) || e}`);
  process.exit(1);
});
