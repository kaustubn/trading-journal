// Acceptance checks for the market-bar data (CHART_BUILD_SPEC.md section 5).
//   npx ts-node scripts/check_bars.ts            run the checks
//   npx ts-node scripts/check_bars.ts --rebuild  rebuild hourly/daily bars first
// Uses DATABASE_URL. Read-only unless --rebuild is given.
import dotenv from 'dotenv';
dotenv.config();
import pool from '../src/db';
import { getBars, getMeta, rebuildAgg, BarRow, Timeframe } from '../src/bars/store';

const SYM = 1;
let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
}
const ohlc = (b: BarRow[]) => b.length ? {
  o: b[0][1], h: Math.max(...b.map(x => x[2])), l: Math.min(...b.map(x => x[3])), c: b[b.length - 1][4],
  v: b.reduce((s, x) => s + x[5], 0),
} : null;
const etHour = (ms: number) => Number(new Intl.DateTimeFormat('en-US',
  { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(ms));
const etDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(ms);

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bars_agg (
      ts TIMESTAMPTZ NOT NULL,
      o INTEGER NOT NULL, h INTEGER NOT NULL, l INTEGER NOT NULL, c INTEGER NOT NULL,
      v INTEGER NOT NULL, sym SMALLINT NOT NULL, tf SMALLINT NOT NULL,
      PRIMARY KEY (sym, tf, ts))`);
  if (process.argv.includes('--rebuild')) {
    const t = Date.now();
    const r = await rebuildAgg(SYM);
    console.log(`Rebuilt: ${r.hourly} hourly, ${r.daily} daily bars in ${((Date.now() - t) / 1000).toFixed(1)}s\n`);
  }

  const meta = await getMeta('NQ', SYM);
  console.log(`Data: ${meta.count.toLocaleString()} bars, ${new Date(meta.first!).toISOString()} -> ${new Date(meta.last!).toISOString()}, ${meta.rolls.length} contracts\n`);
  check('first bar is 2021-11-16 00:00 UTC', new Date(meta.first!).toISOString(), '2021-11-16T00:00:00.000Z');
  check('row count >= 1,770,120', meta.count >= 1770120, true);

  // 2024-03-05 NY session (9:30am-4pm ET = 14:30-21:00 UTC, EST)
  const ny = await getBars({ sym: SYM, tf: 1, from: new Date('2024-03-05T14:30Z'), to: new Date('2024-03-05T21:00Z'), limit: 5000 });
  const nyo = ohlc(ny)!;
  check('2024-03-05 NY session OHLC (1m)', { o: nyo.o, h: nyo.h, l: nyo.l, c: nyo.c }, { o: 18133.75, h: 18135.25, l: 17832.5, c: 17931.75 });
  check('2024-03-05 NY session has 390 one-minute bars', ny.length, 390);

  // Full CME session ending 2024-03-05 (6pm ET Mar 4 -> 5pm ET Mar 5)
  const from = new Date('2024-03-04T23:00Z'), to = new Date('2024-03-05T22:00Z');
  const counts: Record<string, number> = {};
  const byTf: Record<number, BarRow[]> = {};
  for (const tf of [1, 3, 5, 15, 30, 60, 240, 1440] as Timeframe[]) {
    byTf[tf] = await getBars({ sym: SYM, tf, from, to, limit: 5000 });
    counts[tf] = byTf[tf].length;
  }
  check('bars per full session by timeframe', counts, { 1: 1380, 3: 460, 5: 276, 15: 92, 30: 46, 60: 23, 240: 6, 1440: 1 });
  const base = ohlc(byTf[1]);
  for (const tf of [3, 5, 15, 30, 60, 240, 1440] as Timeframe[]) {
    check(`tf ${tf}: session OHLCV equals the 1m session`, ohlc(byTf[tf]), base);
  }
  check('daily bar is dated by the session end date', etDate(byTf[1440][0][0]), '2024-03-05');
  check('4h bars start at 18,22,2,6,10,14 ET (winter)', byTf[240].map(b => etHour(b[0])), [18, 22, 2, 6, 10, 14]);
  const summer = await getBars({ sym: SYM, tf: 240, from: new Date('2024-07-09T22:00Z'), to: new Date('2024-07-10T21:00Z'), limit: 50 });
  check('4h bars start at 18,22,2,6,10,14 ET (summer, DST)', summer.map(b => etHour(b[0])), [18, 22, 2, 6, 10, 14]);
  check('1h bars start on the hour', byTf[60].every(b => b[0] % 3600000 === 0), true);

  // No partial oldest bucket when the lower bound is implicit
  const a = await getBars({ sym: SYM, tf: 15, to: new Date('2024-03-05T21:07Z'), limit: 5000 });
  const firstFull = await getBars({ sym: SYM, tf: 1, from: new Date(a[0][0]), to: new Date(a[0][0] + 15 * 60000), limit: 100 });
  check('oldest bar of an open-ended query is a whole bucket', { o: a[0][1], v: a[0][5] }, { o: firstFull[0][1], v: firstFull.reduce((s, x) => s + x[5], 0) });

  // Scroll back to the start of the data on each timeframe that pages quickly
  for (const tf of [1440, 240, 60] as Timeframe[]) {
    let cursor: Date | undefined, pages = 0, total = 0, oldest = 0;
    for (;;) {
      const page = await getBars({ sym: SYM, tf, to: cursor, limit: 5000 });
      if (!page.length) break;
      pages++; total += page.length; oldest = page[0][0];
      cursor = new Date(oldest);
    }
    check(`tf ${tf}: paging back reaches 2021-11-16 (${total} bars, ${pages} pages)`, etDate(oldest) <= '2021-11-16', true);
  }
  const early = await getBars({ sym: SYM, tf: 1, to: new Date('2021-11-16T02:00Z'), limit: 5000 });
  check('1m: first two hours of data load (120 bars)', early.length, 120);

  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nAll checks passed');
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
