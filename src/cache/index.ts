import pool from '../db';
import { makeAccountCache } from './accountCache';

/** Shared cache for heavy per-account trade reads. Use: tradeCache.query(accountId, sql, params). */
export const tradeCache = makeAccountCache({ query: (sql, params) => pool.query(sql, params) });
