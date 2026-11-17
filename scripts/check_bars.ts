// Acceptance checks for the market-bar data (CHART_BUILD_SPEC.md section 5).
//   npx ts-node scripts/check_bars.ts            run the checks
//   npx ts-node scripts/check_bars.ts --rebuild  rebuild hourly/daily bars first
// Uses DATABASE_URL. Read-only unless --rebuild is given.
import dotenv from 'dotenv';
dotenv.config();
import pool from '../src/db';
import { getBars, getMeta, getLevels, rebuildAgg, BarRow, Timeframe } from '../src/bars/store';

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
    console.log(`Rebuilt ${JSON.stringify(r)} in ${((Date.now() - t) / 1000).toFixed(1)}s\n`);
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

  // Regular trading hours only (9:30am-4pm ET)
  const rthCounts: Record<string, number> = {};
  const rthBy: Record<number, BarRow[]> = {};
  for (const tf of [1, 5, 30, 60, 240, 1440] as Timeframe[]) {
    rthBy[tf] = await getBars({ sym: SYM, tf, rth: true, from: new Date('2024-03-05T05:00Z'), to: new Date('2024-03-06T05:00Z'), limit: 5000 });
    rthCounts[tf] = rthBy[tf].length;
  }
  check('RTH bars per day by timeframe', rthCounts, { 1: 390, 5: 78, 30: 13, 60: 7, 240: 2, 1440: 1 });
  for (const tf of [5, 30, 60, 240, 1440] as Timeframe[]) {
    check(`RTH tf ${tf}: day OHLCV equals the 1m NY session`, ohlc(rthBy[tf]), ohlc(ny));
  }
  const etHM = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }).format(ms);
  check('RTH 1h bars start 9:30 ... 15:30 ET', rthBy[60].map(b => etHM(b[0])), ['09:30', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30']);
  check('RTH 4h bars start 9:30 and 13:30 ET', rthBy[240].map(b => etHM(b[0])), ['09:30', '13:30']);
  const rthSummer = await getBars({ sym: SYM, tf: 60, rth: true, from: new Date('2024-07-10T04:00Z'), to: new Date('2024-07-11T04:00Z'), limit: 50 });
  check('RTH 1h bars start 9:30 ET in summer (DST)', [etHM(rthSummer[0][0]), rthSummer.length], ['09:30', 7]);

  // Forward paging
  const fwd = await getBars({ sym: SYM, tf: 5, after: new Date('2024-03-05T14:25Z'), limit: 3 });
  check('after= returns the next bars, oldest first', fwd.map(b => new Date(b[0]).toISOString().slice(11, 16)), ['14:30', '14:35', '14:40']);
  const fwd4 = await getBars({ sym: SYM, tf: 240, after: new Date(byTf[240][0][0]), limit: 2 });
  check('after= on 4h skips the bar it starts from', fwd4.map(b => b[0]), [byTf[240][1][0], byTf[240][2][0]]);
  const fwdD = await getBars({ sym: SYM, tf: 1440, after: new Date(byTf[1440][0][0]), limit: 1 });
  check('after= on daily gives the next session', etDate(fwdD[0][0]), '2024-03-06');
  const fwdFull = await getBars({ sym: SYM, tf: 15, after: new Date('2024-03-05T14:25Z'), limit: 5000 });
  const lastB = fwdFull[fwdFull.length - 1];
  const lastMin = await getBars({ sym: SYM, tf: 1, from: new Date(lastB[0]), to: new Date(lastB[0] + 15 * 60000), limit: 100 });
  check('newest bar of a forward page is a whole bucket', lastB[5], lastMin.reduce((s, x) => s + x[5], 0));

  // Key levels, using only bars up to the given time
  const prevDay = await getBars({ sym: SYM, tf: 1440, to: new Date(byTf[1440][0][0]), limit: 1 });
  const overnight = ohlc(await getBars({ sym: SYM, tf: 1, from, to: new Date('2024-03-05T14:30Z'), limit: 5000 }))!;
  const lv = (await getLevels(SYM, new Date('2024-03-05T15:00Z')))!;
  check('levels at 10:00 ET', lv, {
    session: '2024-03-05', start: from.getTime(), nyStart: Date.parse('2024-03-05T14:30Z'), end: to.getTime(),
    prev: { date: '2024-03-04', h: prevDay[0][2], l: prevDay[0][3], c: prevDay[0][4] },
    open: byTf[1][0][1], nyOpen: 18133.75, overnight: { h: overnight.h, l: overnight.l },
  });
  const early2 = (await getLevels(SYM, new Date('2024-03-05T02:00Z')))!;
  const soFar = ohlc(await getBars({ sym: SYM, tf: 1, from, to: new Date('2024-03-05T02:01Z'), limit: 5000 }))!;
  check('levels at 9pm ET the evening before show nothing from the future',
    { ny: early2.nyOpen, on: early2.overnight }, { ny: null, on: { h: soFar.h, l: soFar.l } });

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
