// Offline checks for the bar CSV parser (no database needed): npx ts-node scripts/test_ingest.ts
import { parseBarsCsv, contractCode } from '../src/bars/ingest';
let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
};
eq('contract NQZ6 in 2026', contractCode('NQZ6', Date.UTC(2026, 10, 1)), 2612);
eq('contract NQH7 seen in Dec 2026', contractCode('NQH7', Date.UTC(2026, 11, 20)), 2703);
eq('contract with exchange prefix', contractCode('CME:NQU24', Date.UTC(2024, 6, 1)), 2409);
eq('contract for a continuous symbol', contractCode('NQ.v.0', Date.UTC(2024, 6, 1)), 0);

const own = parseBarsCsv('ts_utc,open,high,low,close,volume,symbol\n2024-03-05T14:30,18133.75,18135.25,18120,18125.5,1500,NQH4\nbad,1,1,1,1,1,NQH4\n');
eq('own format: one good row', own.bars.length, 1);
eq('own format: bad rows counted', own.bad, 1);
eq('own format: values', own.bars[0], { ts: Date.UTC(2024, 2, 5, 14, 30), o: 1813375, h: 1813525, l: 1812000, c: 1812550, v: 1500, contract: 2403 });

const dbPretty = parseBarsCsv('ts_event,rtype,publisher_id,instrument_id,open,high,low,close,volume,symbol\n2026-11-16T14:30:00.000000000Z,33,1,42005347,28100.250000000,28110.000000000,28095.500000000,28105.750000000,2201,NQZ6\n2026-11-16T14:31:00.000000000Z,33,1,1,1,1,1,1,1,NQZ6-NQH7\n');
eq('databento pretty csv', dbPretty.bars[0], { ts: Date.UTC(2026, 10, 16, 14, 30), o: 2810025, h: 2811000, l: 2809550, c: 2810575, v: 2201, contract: 2612 });
eq('databento spreads skipped', dbPretty.skipped, 1);

const dbRaw = parseBarsCsv('ts_event,rtype,publisher_id,instrument_id,open,high,low,close,volume,symbol\n1794842400000000000,33,1,42005347,28100250000000,28110000000000,28095500000000,28105750000000,2201,NQ.v.0\n', 2612);
eq('databento raw (ns time, fixed-point prices, continuous symbol)', dbRaw.bars[0], { ts: 1794842400000, o: 2810025, h: 2811000, l: 2809550, c: 2810575, v: 2201, contract: 2612 });

let threw = '';
try { parseBarsCsv('a,b,c\n1,2,3'); } catch (e: any) { threw = e.message.slice(0, 30); }
eq('wrong columns explained', threw, 'CSV needs columns ts_utc (or t');
console.log(failed ? `\n${failed} FAILED` : '\nAll parser checks passed');
process.exit(failed ? 1 : 0);
