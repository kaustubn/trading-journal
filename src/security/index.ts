import pool from '../db';
import { makeOwnsAccount, makeRequireAccount } from './ownership';

export const ownsAccount = makeOwnsAccount((sql, params) => pool.query(sql, params));
/** Route guard for `:account_id` params. */
export const requireAccountParam = makeRequireAccount(ownsAccount, req => req.params.account_id);
/** Route guard for `?account_id=` query values. */
export const requireAccountQuery = makeRequireAccount(ownsAccount, req => req.query.account_id);
