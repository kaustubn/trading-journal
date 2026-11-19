// In-memory cache for heavy per-account trade queries.
//
// Why: the database (Neon free plan) bills data transfer; the Backtesting account alone is ~31k trades,
// and every dashboard / trade-log view used to re-read them all. Each account has a `data_ver` counter
// that database triggers bump on every insert / update / delete of its trades (and on account edits),
// so a cached result is reused only while that counter is unchanged. Checking it is one tiny query.

type Query = (sql: string, params: any[]) => Promise<{ rows: any[] }>;

interface Entry { ver: string; rows: any[]; at: number; }

export interface AccountCacheOptions {
  query: Query;
  maxRows?: number;   // total rows kept across all entries (memory budget)
  ttlMs?: number;     // safety expiry even when nothing changed
  now?: () => number;
}

export function makeAccountCache({ query, maxRows = 250_000, ttlMs = 6 * 3600 * 1000, now = Date.now }: AccountCacheOptions) {
  const entries = new Map<string, Entry>(); // Map keeps insertion order: first = least recently used
  const inflight = new Map<string, Promise<Entry | null>>();
  let total = 0;
  const stats = { hits: 0, misses: 0 };

  const drop = (key: string) => { const e = entries.get(key); if (e) { total -= e.rows.length; entries.delete(key); } };

  async function version(accountId: number): Promise<string | null> {
    const r = await query('SELECT data_ver FROM accounts WHERE id = $1', [accountId]);
    return r.rows.length ? String(r.rows[0].data_ver) : null;
  }

  return {
    stats,
    /** Same contract as pool.query(sql, params), cached per account. Always returns a private copy. */
    async query(accountId: number, sql: string, params: any[]): Promise<{ rows: any[] }> {
      const ver = await version(Number(accountId));
      if (ver === null) return query(sql, params);
      const key = `${accountId}\u0000${sql}\u0000${JSON.stringify(params)}`;

      const hit = entries.get(key);
      if (hit && hit.ver === ver && now() - hit.at < ttlMs) {
        entries.delete(key); entries.set(key, hit); // mark as most recently used
        stats.hits++;
        return { rows: structuredClone(hit.rows) };
      }
      if (hit) drop(key);

      const flightKey = key + '\u0000' + ver;
      let p = inflight.get(flightKey);
      if (!p) {
        stats.misses++;
        p = (async () => {
          const r = await query(sql, params);
          const e: Entry = { ver, rows: r.rows, at: now() };
          if (r.rows.length <= maxRows) {
            drop(key);
            entries.set(key, e); total += r.rows.length;
            for (const k of entries.keys()) { if (total <= maxRows) break; if (k !== key) drop(k); }
          }
          return e;
        })().finally(() => inflight.delete(flightKey));
        inflight.set(flightKey, p);
      }
      const e = await p;
      return { rows: structuredClone(e!.rows) };
    },
    clear() { entries.clear(); total = 0; },
  };
}
