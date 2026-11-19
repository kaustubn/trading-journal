/// <reference types="node" />
// Databento auto-update, tested offline: the database and Databento's HTTP API are stubbed,
// so this proves the request shape and bar handling before a real DATABENTO_API_KEY exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- stub the database module before ingest.ts loads it
const queries: { sql: string; params?: unknown[] }[] = [];
let lastTs: string | null = '2026-11-15T23:59:00.000Z';
const fakePool = {
  query: async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    if (/MAX\(ts\) AS ts, \(array_agg/.test(sql)) return { rows: [{ ts: lastTs, contract: 2612 }], rowCount: 1 };
    if (/INSERT INTO bars_1m/.test(sql)) return { rows: [], rowCount: (params?.[0] as unknown[]).length };
    return { rows: [], rowCount: 0 };
  },
  connect: async () => ({ query: (sql: string, params?: unknown[]) => fakePool.query(sql, params), release: () => undefined }),
};
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { __esModule: true, default: fakePool } } as unknown as NodeModule;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ingest = require('../src/bars/ingest') as typeof import('../src/bars/ingest');

// ---- stub fetch (Databento)
const calls: { url: URL; auth: string | null }[] = [];
let failWith: number | null = null;
const csv = [
  'ts_event,rtype,publisher_id,instrument_id,open,high,low,close,volume,symbol',
  '2026-11-16T00:00:00.000000000Z,33,1,42,25010.25,25012.00,25009.50,25011.75,321,NQZ6',
  '2026-11-16T00:01:00.000000000Z,33,1,42,25011.75,25013.25,25010.00,25010.50,198,NQZ6',
  '2026-11-16T00:02:00.000000000Z,33,1,99,25010.50,25011.00,25009.00,25009.25,55,NQZ6-NQH7', // spread: skipped
  '2026-11-16T00:03:00.000000000Z,33,1,42,25009.25,25008.00,25009.00,25009.00,10,NQZ6',      // high < open: bad
].join('\n');
(globalThis as { fetch: unknown }).fetch = async (input: string, init?: { headers?: Record<string, string> }) => {
  const url = new URL(input);
  calls.push({ url, auth: init?.headers?.Authorization ?? null });
  if (failWith) return new Response('{"detail":"Unauthorized"}', { status: failWith });
  if (url.pathname.endsWith('metadata.get_dataset_range')) return Response.json({ end: '2026-11-16T00:04:00Z', schema: { 'ohlcv-1m': { end: '2026-11-16T00:04:00Z' } } });
  if (url.pathname.endsWith('symbology.resolve')) return Response.json({ result: { 'NQ.v.0': [{ d0: '2026-09-12', d1: '2026-12-12', s: 'NQZ6' }] } });
  if (url.pathname.endsWith('timeseries.get_range')) return new Response(csv);
  return new Response('not found', { status: 404 });
};

test('no key -> clear message, no network call', async () => {
  delete process.env.DATABENTO_API_KEY;
  const r = await ingest.updateFromDatabento();
  assert.equal(r.ok, false);
  assert.match(r.message, /DATABENTO_API_KEY is not set/);
  assert.equal(calls.length, 0);
});

test('with key -> asks for the minutes after the last bar, inserts clean bars only, x100 prices, contract code', async () => {
  process.env.DATABENTO_API_KEY = 'db-test-key';
  const r = await ingest.updateFromDatabento();
  assert.equal(r.ok, true, r.message);
  assert.equal(r.inserted, 2);
  const get = calls.find(c => c.url.pathname.endsWith('timeseries.get_range'))!;
  assert.equal(get.url.searchParams.get('dataset'), 'GLBX.MDP3');
  assert.equal(get.url.searchParams.get('schema'), 'ohlcv-1m');
  assert.equal(get.url.searchParams.get('symbols'), 'NQ.v.0');
  assert.equal(get.url.searchParams.get('start'), '2026-11-16T00:00:00.000Z'); // last stored bar + 1 minute
  assert.equal(get.url.searchParams.get('end'), '2026-11-16T00:04:00.000Z');   // capped at what Databento has
  assert.equal(get.auth, 'Basic ' + Buffer.from('db-test-key:').toString('base64'));
  const ins = queries.find(q => /INSERT INTO bars_1m/.test(q.sql))!;
  const [ts, o, h, , c, v, , contract] = ins.params as unknown[][];
  assert.deepEqual(ts, ['2026-11-16T00:00:00.000Z', '2026-11-16T00:01:00.000Z']);
  assert.deepEqual(o, [2501025, 2501175]);
  assert.deepEqual(h, [2501200, 2501325]);
  assert.deepEqual(c, [2501175, 2501050]);
  assert.deepEqual(v, [321, 198]);
  assert.deepEqual(contract, [2612, 2612]);
});

test('already current -> no download', async () => {
  calls.length = 0;
  lastTs = '2026-11-16T00:04:00.000Z';
  const r = await ingest.updateFromDatabento();
  assert.equal(r.ok, true);
  assert.match(r.message, /Up to date/);
  assert.equal(calls.some(c => c.url.pathname.endsWith('timeseries.get_range')), false);
});

test('bad key -> error message carries Databento status, not a crash', async () => {
  lastTs = '2026-11-15T23:59:00.000Z';
  failWith = 401;
  const r = await ingest.updateFromDatabento();
  assert.equal(r.ok, false);
  assert.match(r.message, /answered 401/);
  failWith = null;
});
