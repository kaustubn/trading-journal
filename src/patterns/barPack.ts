// Compact, gzipped column blocks of 1-minute bars (one block per month) for the pattern scanners.
// Reading these instead of raw rows cuts database data transfer roughly 10x (Neon bills transfer).
import zlib from 'zlib';

const MAGIC = 'BP1\n';

export interface BarCols {
  n: number;
  t: Float64Array;           // epoch ms
  o: Float64Array; h: Float64Array; l: Float64Array; c: Float64Array; // raw stored ints (price x 100)
  v: Float64Array;
  d: string[];               // NY session date YYYY-MM-DD
  wd: Int8Array;             // ISO weekday 1=Mon..7=Sun
  mod: Int16Array;           // NY minute of day
}

const fitsI32 = (a: Float64Array) => a.every(x => Number.isInteger(x) && x >= -2147483648 && x <= 2147483647);

/** rows: [t, o, h, l, c, v, 'YYYY-MM-DD', isodow, minuteOfDay] as returned by pg in rowMode 'array'. */
export function packRows(rows: any[][]): Buffer {
  const n = rows.length;
  const col = (j: number) => Float64Array.from(rows, r => Number(r[j]));
  const t = col(0), o = col(1), h = col(2), l = col(3), c = col(4), v = col(5);
  const tMin = t.every(x => x % 60000 === 0 && x / 60000 <= 2147483647);
  const pI32 = [o, h, l, c].every(fitsI32);
  const vI32 = fitsI32(v);
  const dates: string[] = [];
  const dIdx = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const d = String(rows[i][6]);
    if (!dates.length || dates[dates.length - 1] !== d) dates.push(d);
    dIdx[i] = dates.length - 1;
  }
  const header = Buffer.from(JSON.stringify({ n, tMin, pI32, vI32, dates }));
  const parts: Buffer[] = [Buffer.from(MAGIC), Buffer.alloc(4), header];
  parts[1].writeUInt32LE(header.length, 0);
  const push = (a: ArrayBufferView) => parts.push(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  push(tMin ? Int32Array.from(t, x => x / 60000) : t);
  for (const a of [o, h, l, c]) push(pI32 ? Int32Array.from(a) : a);
  push(vI32 ? Int32Array.from(v) : v);
  push(dIdx);
  push(Int8Array.from(rows, r => Number(r[7])));
  push(Int16Array.from(rows, r => Number(r[8])));
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

export function unpackRows(block: Buffer): BarCols {
  const buf = zlib.gunzipSync(block);
  if (buf.subarray(0, 4).toString() !== MAGIC) throw new Error('not a bar block');
  const hl = buf.readUInt32LE(4);
  const { n, tMin, pI32, vI32, dates } = JSON.parse(buf.subarray(8, 8 + hl).toString());
  let off = 8 + hl;
  // copy each section into its own aligned typed array
  const take = <T>(Ctor: any, count: number): T => {
    const bytes = count * Ctor.BYTES_PER_ELEMENT;
    const out = new Ctor(count);
    new Uint8Array(out.buffer).set(buf.subarray(off, off + bytes));
    off += bytes;
    return out as T;
  };
  const f64 = (a: any) => Float64Array.from(a as ArrayLike<number>);
  const t = tMin ? Float64Array.from(take<Int32Array>(Int32Array, n), x => x * 60000) : take<Float64Array>(Float64Array, n);
  const P = pI32 ? Int32Array : Float64Array;
  const o = f64(take(P, n)), h = f64(take(P, n)), l = f64(take(P, n)), c = f64(take(P, n));
  const v = f64(take(vI32 ? Int32Array : Float64Array, n));
  const dIdx = take<Int32Array>(Int32Array, n);
  const wd = take<Int8Array>(Int8Array, n);
  const mod = take<Int16Array>(Int16Array, n);
  if (off !== buf.length) throw new Error('bar block size mismatch');
  const d = Array.from(dIdx, i => dates[i]);
  return { n, t, o, h, l, c, v, d, wd, mod };
}
