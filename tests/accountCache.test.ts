/// <reference types="node" />
// Account query cache: avoids re-reading big trade lists from the database (Neon bills data transfer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAccountCache } from '../src/cache/accountCache';

function fakeDb() {
  const state = { ver: 1, calls: 0, rows: [{ id: 1, pnl: 100, tags: ['a'] }, { id: 2, pnl: -50, tags: ['b'] }] as any[] };
  const query = async (sql: string, params: any[]) => {
    if (/^SELECT data_ver FROM accounts/.test(sql)) return { rows: params[0] === 48 ? [{ data_ver: state.ver }] : [] };
    state.calls++;
    await new Promise(r => setTimeout(r, 5));
    return { rows: state.rows.map(r => ({ ...r, tags: [...r.tags] })) };
  };
  return { state, query };
}
const SQL = 'SELECT pnl FROM trades WHERE account_id = $1';

test('cache: second identical query is served from memory', async () => {
  const db = fakeDb(); const c = makeAccountCache({ query: db.query });
  await c.query(48, SQL, [48]); await c.query(48, SQL, [48]);
  assert.equal(db.state.calls, 1);
});
test('cache: a data change (version bump) forces a fresh read', async () => {
  const db = fakeDb(); const c = makeAccountCache({ query: db.query });
  await c.query(48, SQL, [48]);
  db.state.ver++; db.state.rows.push({ id: 3, pnl: 10, tags: [] });
  const r = await c.query(48, SQL, [48]);
  assert.equal(db.state.calls, 2);
  assert.equal(r.rows.length, 3);
});
test('cache: different SQL or params are separate entries', async () => {
  const db = fakeDb(); const c = makeAccountCache({ query: db.query });
  await c.query(48, SQL, [48]); await c.query(48, SQL + ' AND pnl > 0', [48]); await c.query(48, SQL, [48, 'x']);
  assert.equal(db.state.calls, 3);
});
test('cache: callers cannot corrupt the cached copy by mutating results', async () => {
  const db = fakeDb(); const c = makeAccountCache({ query: db.query });
  const a = await c.query(48, SQL, [48]);
  a.rows[0].pnl = 999999; a.rows[0].tags.push('hacked'); a.rows.pop();
  const b = await c.query(48, SQL, [48]);
  assert.equal(b.rows.length, 2);
  assert.equal(b.rows[0].pnl, 100);
  assert.deepEqual(b.rows[0].tags, ['a']);
});
test('cache: unknown account is not cached (always reads)', async () => {
  const db = fakeDb(); const c = makeAccountCache({ query: db.query });
  await c.query(999, SQL, [999]); await c.query(999, SQL, [999]);
  assert.equal(db.state.calls, 2);
});
test('cache: concurrent identical requests share one database read', async () => {
  const db = fakeDb(); const c = makeAccountCache({ query: db.query });
  const rs = await Promise.all([c.query(48, SQL, [48]), c.query(48, SQL, [48]), c.query(48, SQL, [48])]);
  assert.equal(db.state.calls, 1);
  rs[0].rows[0].pnl = 1;
  assert.equal(rs[1].rows[0].pnl, 100); // each caller got its own copy
});
test('cache: least-recently-used entries are dropped past the row budget', async () => {
  const db = fakeDb(); const c = makeAccountCache({ query: db.query, maxRows: 4 }); // 2 rows per entry
  await c.query(48, SQL + ' -- A', [48]);
  await c.query(48, SQL + ' -- B', [48]);
  await c.query(48, SQL + ' -- A', [48]); // A is now most recent
  await c.query(48, SQL + ' -- C', [48]); // evicts B
  const before = db.state.calls;
  await c.query(48, SQL + ' -- A', [48]);
  assert.equal(db.state.calls, before, 'A still cached');
  await c.query(48, SQL + ' -- B', [48]);
  assert.equal(db.state.calls, before + 1, 'B was evicted');
});
test('cache: a result bigger than the whole budget is returned but not stored', async () => {
  const db = fakeDb(); const c = makeAccountCache({ query: db.query, maxRows: 1 });
  const r = await c.query(48, SQL, [48]); await c.query(48, SQL, [48]);
  assert.equal(r.rows.length, 2);
  assert.equal(db.state.calls, 2);
});
test('cache: entries expire after the time limit even without changes', async () => {
  let t = 0;
  const db = fakeDb(); const c = makeAccountCache({ query: db.query, ttlMs: 1000, now: () => t });
  await c.query(48, SQL, [48]); t = 999; await c.query(48, SQL, [48]);
  assert.equal(db.state.calls, 1);
  t = 1001; await c.query(48, SQL, [48]);
  assert.equal(db.state.calls, 2);
});
test('cache: a failed read is not cached and the error reaches the caller', async () => {
  let fail = true;
  const db = fakeDb();
  const q = async (sql: string, p: any[]) => { if (fail && !/data_ver/.test(sql)) throw new Error('boom'); return db.query(sql, p); };
  const c = makeAccountCache({ query: q });
  await assert.rejects(c.query(48, SQL, [48]), /boom/);
  fail = false;
  const r = await c.query(48, SQL, [48]);
  assert.equal(r.rows.length, 2);
});
test('cache: Dates survive the copy', async () => {
  const d = new Date('2026-11-18T14:30:00Z');
  const q = async (sql: string) => (/data_ver/.test(sql) ? { rows: [{ data_ver: 1 }] } : { rows: [{ t: d }] });
  const c = makeAccountCache({ query: q });
  await c.query(48, SQL, [48]);
  const r = await c.query(48, SQL, [48]);
  assert.ok(r.rows[0].t instanceof Date);
  assert.equal(r.rows[0].t.getTime(), d.getTime());
});
