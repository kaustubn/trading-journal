/// <reference types="node" />
// Packed bar blocks for Pattern Finder / Edge Hunter: must round-trip exactly and be much smaller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packRows, unpackRows } from '../src/patterns/barPack';

// rows as Postgres returns them in rowMode 'array': [t(ms, numeric string), o, h, l, c (int cents), v, 'YYYY-MM-DD', isodow, minute-of-day]
function sampleRows(n: number, start = Date.UTC(2026, 0, 5, 14, 30)) {
  const rows: any[][] = [];
  let p = 2100000;
  for (let i = 0; i < n; i++) {
    const t = start + i * 60000;
    const o = p, c = p + ((i * 37) % 21) - 10, h = Math.max(o, c) + (i % 7), l = Math.min(o, c) - (i % 5);
    p = c;
    const day = 5 + Math.floor(i / 390);
    rows.push([String(t) + '.000000', o, h, l, c, 1000 + (i % 977), `2026-01-${String(day).padStart(2, '0')}`, 1 + (day - 5) % 5, 570 + (i % 390)]);
  }
  return rows;
}

function same(rows: any[][], u: ReturnType<typeof unpackRows>) {
  assert.equal(u.n, rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    assert.equal(u.t[i], Number(r[0]), `t ${i}`);
    assert.equal(u.o[i], Number(r[1])); assert.equal(u.h[i], Number(r[2])); assert.equal(u.l[i], Number(r[3])); assert.equal(u.c[i], Number(r[4]));
    assert.equal(u.v[i], Number(r[5]));
    assert.equal(u.d[i], r[6]); assert.equal(u.wd[i], Number(r[7])); assert.equal(u.mod[i], Number(r[8]));
  }
}

test('barPack: a month of bars round-trips exactly', () => {
  const rows = sampleRows(390 * 21);
  same(rows, unpackRows(packRows(rows)));
});
test('barPack: packed block is far smaller than the raw rows', () => {
  const rows = sampleRows(390 * 21);
  const raw = Buffer.byteLength(rows.map(r => r.join(',')).join('\n'));
  const packed = packRows(rows).length;
  assert.ok(packed * 4 < raw, `packed ${packed} vs raw ${raw}`);
});
test('barPack: empty month', () => {
  const u = unpackRows(packRows([]));
  assert.equal(u.n, 0);
});
test('barPack: timestamps that are not whole minutes are kept exactly', () => {
  const rows = sampleRows(10);
  rows[3][0] = String(Number(rows[3][0]) + 1234);
  same(rows, unpackRows(packRows(rows)));
});
test('barPack: huge volume and negative prices survive', () => {
  const rows = sampleRows(5);
  rows[0][5] = 5_000_000_000; rows[1][1] = -3700; rows[1][3] = -3800;
  same(rows, unpackRows(packRows(rows)));
});
test('barPack: numbers arriving as strings are handled', () => {
  const rows = sampleRows(5).map(r => r.map((x, j) => (j >= 1 && j <= 5) || j >= 7 ? String(x) : x));
  same(rows, unpackRows(packRows(rows)));
});
test('barPack: a corrupt or foreign block is rejected, not misread', () => {
  assert.throws(() => unpackRows(Buffer.from('not a block')));
});
