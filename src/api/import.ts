import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import pool from '../db';
import { getCurrentAttemptId } from './attempts';

const router = Router();

// --- Minimal RFC-4180-ish CSV parser (handles quoted fields + commas) ---
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some(v => v.trim() !== '')) rows.push(row); }
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Column synonyms → canonical field (exact-normalized match preferred, then contains)
const SYNONYMS: Record<string, string[]> = {
  symbol:      ['symbol', 'ticker', 'instrument', 'contract', 'tradingsymbol', 'product', 'name', 'scrip', 'stock'],
  side:        ['side', 'direction', 'action', 'buysell', 'bs', 'ordertype', 'position', 'transactiontype', 'tradetype'],
  quantity:    ['quantity', 'qty', 'buyqty', 'sellqty', 'size', 'contracts', 'shares', 'volume', 'lots', 'filledqty'],
  entry_price: ['entryprice', 'buyprice', 'avgentry', 'openprice', 'avgprice', 'entryavg', 'avgfillprice', 'fillprice', 'buyavgprice', 'entry'],
  exit_price:  ['exitprice', 'sellprice', 'avgexit', 'closeprice', 'sellavgprice', 'exitavg', 'exit'],
  entry_time:  ['entrytime', 'entrydate', 'opentime', 'opendate', 'datetime', 'date', 'boughttimestamp', 'tradedate', 'orderexecutiontime', 'filltime', 'executiontime', 'time', 'orderdatetime', 'tradetime', 'placingtime', 'closingtime'],
  exit_time:   ['exittime', 'exitdate', 'closetime', 'closedate', 'soldtimestamp'],
  pnl:         ['pnl', 'pl', 'grosspl', 'grosspnl', 'netpnl', 'realizedpnl', 'realized', 'profit', 'plvalue', 'profitloss', 'net'],
  setup:       ['setup', 'setuptag', 'strategy'],
  notes:       ['notes', 'note', 'comment', 'comments', 'remarks', 'segment'],
};

function buildColumnMap(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const nheader = header.map(norm);
  // Pass 1: exact normalized matches (highest confidence)
  nheader.forEach((nh, i) => {
    for (const [field, syns] of Object.entries(SYNONYMS)) {
      if (map[field] === undefined && syns.includes(nh)) map[field] = i;
    }
  });
  // Pass 2: contains-matches for anything still unmapped
  nheader.forEach((nh, i) => {
    for (const [field, syns] of Object.entries(SYNONYMS)) {
      if (map[field] === undefined && syns.some(s => s.length >= 3 && nh.includes(s))) map[field] = i;
    }
  });
  return map;
}

// Some brokers (e.g. Fyers Realised P&L) prepend metadata + a summary block
// before the real header. Find the first row that maps to a valid trade header.
function findHeaderRow(rows: string[][]): { idx: number; map: Record<string, number> } {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    // Execution-log / order-book header (price column is "Traded price", no P&L col)
    if (detectExecutionLog(rows[i])) {
      return { idx: i, map: buildColumnMap(rows[i]) };
    }
    const map = buildColumnMap(rows[i]);
    const cols = Object.keys(map).length;
    if (map.symbol !== undefined && (map.entry_price !== undefined || map.pnl !== undefined) && cols >= 3) {
      return { idx: i, map };
    }
  }
  return { idx: 0, map: buildColumnMap(rows[0]) };
}

// Pull a fallback date from a "Date Range,From dd/mm/yyyy to dd/mm/yyyy" preamble line
function extractFallbackDate(rows: string[][]): Date | null {
  for (const row of rows.slice(0, 15)) {
    const joined = row.join(' ');
    const m = joined.match(/to\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00`);
    const m2 = joined.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m2 && /date/i.test(joined)) return new Date(`${m2[3]}-${m2[2]}-${m2[1]}T12:00:00`);
  }
  return null;
}

// Parse "DD-MM-YYYY HH:MM:SS" (Fyers Order Book) — JS Date can't do DD-MM-YYYY natively
function parseDMY(v: string | undefined): Date | null {
  if (!v) return null;
  const m = String(v).match(/(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return parseDate(v);
  const dt = new Date(
    Number(m[3]), Number(m[2]) - 1, Number(m[1]),
    m[4] ? Number(m[4]) : 12, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0
  );
  return isNaN(dt.getTime()) ? null : dt;
}

// Detect an execution-log / order-book style CSV (one row per fill, has status + side)
function detectExecutionLog(header: string[]): null | {
  iName: number; iSide: number; iStatus: number; iPrice: number; iDate: number; iQty: number;
} {
  const nh = header.map(norm);
  const find = (opts: string[]) => nh.findIndex(h => opts.includes(h));
  const iName = find(['name', 'symbol', 'tradingsymbol', 'instrument', 'contract']);
  const iSide = find(['side', 'buysell', 'transactiontype', 'bs']);
  const iStatus = find(['status', 'orderstatus']);
  // Tradovate uses "Avg Fill Price" / "avgPrice"
  const iPrice = find(['tradedprice', 'tradeprice', 'avgtradedprice', 'executedprice', 'fillprice', 'avgfillprice', 'avgprice']);
  // Tradovate uses "Update Time" (TV download) or "Fill Time" (desktop export)
  const iDate = find(['datetime', 'dateandtime', 'ordertime', 'tradetime', 'executiontime', 'placingtime', 'closingtime', 'updatetime', 'filltime', 'time']);
  const iQty = find(['qty', 'quantity', 'filledqty', 'tradedqty']);
  if ([iName, iSide, iStatus, iPrice, iDate, iQty].every(i => i >= 0)) {
    return { iName, iSide, iStatus, iPrice, iDate, iQty };
  }
  return null;
}

// CME futures $ per point — converts TradingView/Tradovate point P&L to dollars.
// Options/equities (price×qty already = cash value) default to 1.
const POINT_VALUE: Record<string, number> = {
  NQ: 20, MNQ: 2, ES: 50, MES: 5, YM: 5, MYM: 0.5, RTY: 50, M2K: 5,
  CL: 1000, MCL: 100, NG: 10000, GC: 100, MGC: 10, SI: 5000,
  HG: 25000, ZB: 1000, ZN: 1000, ZF: 1000, ZT: 2000,
  BTC: 5, MBT: 0.1, ETH: 50, MET: 0.1,
};

function pointValue(sym: string): number {
  // Drop exchange prefix, uppercase, then keep the leading letters only
  // (strips year/expiry digits and "!"): "CME:NQU6" -> "NQU", "MNQ1!" -> "MNQ".
  let s = sym.replace(/^[A-Z_]+:/, '').toUpperCase().replace(/[^A-Z].*$/, '');
  if (POINT_VALUE[s] !== undefined) return POINT_VALUE[s];
  // Tradovate-style contracts carry a trailing month code (F G H J K M N Q U V X Z):
  // "NQU" -> strip "U" -> "NQ", "MESU" -> "MES".
  if (s.length > 1 && 'FGHJKMNQUVXZ'.includes(s[s.length - 1])) {
    const root = s.slice(0, -1);
    if (POINT_VALUE[root] !== undefined) return POINT_VALUE[root];
  }
  return POINT_VALUE[s] || 1;
}

// Reconstruct INDIVIDUAL round-trip trades from a fill log.
// Fills are grouped per symbol, sorted by time, then split into flat-to-flat
// segments — each time the net position returns to zero, that's one trade.
// This gives one trade per scalp instead of one lump per day.
function aggregateExecutions(rows: string[][], headerIdx: number, m: {
  iName: number; iSide: number; iStatus: number; iPrice: number; iDate: number; iQty: number;
}) {
  interface Fill { time: Date; isSell: boolean; qty: number; price: number; }
  const bySymbol = new Map<string, Fill[]>();
  let executed = 0, skippedNonExec = 0;

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const status = (row[m.iStatus] || '').toLowerCase();
    // Fyers says "Executed", TradingView says "Filled" — accept both, skip cancelled/rejected/working
    if (!(status.includes('execut') || status.includes('fill'))) { skippedNonExec++; continue; }
    const qty = toNum(row[m.iQty]);
    const price = toNum(row[m.iPrice]);
    if (!qty || !price || qty <= 0 || price <= 0) { skippedNonExec++; continue; }
    const symbol = (row[m.iName] || '').trim();
    if (!symbol) continue;
    const dt = parseDMY(row[m.iDate]);
    if (!dt) continue;
    executed++;
    const isSell = (row[m.iSide] || '').toUpperCase().includes('S');
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
    bySymbol.get(symbol)!.push({ time: dt, isSell, qty, price });
  }

  const trades: any[] = [];
  for (const [symbol, fills] of bySymbol) {
    fills.sort((a, b) => a.time.getTime() - b.time.getTime());
    const mult = pointValue(symbol);
    let pos = 0; // signed net position
    let seg: { first: Date; last: Date; buyQty: number; buyVal: number; sellQty: number; sellVal: number } | null = null;

    for (const f of fills) {
      if (!seg) seg = { first: f.time, last: f.time, buyQty: 0, buyVal: 0, sellQty: 0, sellVal: 0 };
      seg.last = f.time;
      if (f.isSell) { seg.sellQty += f.qty; seg.sellVal += f.qty * f.price; pos -= f.qty; }
      else { seg.buyQty += f.qty; seg.buyVal += f.qty * f.price; pos += f.qty; }

      if (pos === 0) { // position flat → one completed round-trip
        const matched = Math.min(seg.buyQty, seg.sellQty);
        if (matched > 0) {
          const avgBuy = seg.buyVal / seg.buyQty;
          const avgSell = seg.sellVal / seg.sellQty;
          trades.push({
            symbol,
            entry_time: seg.first,
            exit_time: seg.last,
            entry_price: avgBuy,
            exit_price: avgSell,
            quantity: matched,
            pnl: (avgSell - avgBuy) * matched * mult,
          });
        }
        seg = null;
      }
    }
  }
  // Chronological order so the calendar/list read naturally
  trades.sort((a, b) => a.entry_time.getTime() - b.entry_time.getTime());
  return { trades, executed, skippedNonExec };
}

function toNum(v: string | undefined): number | null {
  if (v === undefined || v === null) return null;
  const cleaned = String(v).replace(/[$₹,\s]/g, '');
  if (cleaned === '') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseSide(v: string | undefined): 'LONG' | 'SHORT' | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s.includes('buy') || s.includes('long') || s === 'b') return 'LONG';
  if (s.includes('sell') || s.includes('short') || s === 's') return 'SHORT';
  return null;
}

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// POST /api/import/csv  { account_id, csv }
router.post('/import/csv', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId;
    const { account_id, csv } = req.body;

    if (!account_id || !csv) {
      return res.status(400).json({ error: 'account_id and csv are required' });
    }

    // Verify ownership
    const own = await pool.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2', [account_id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });

    // Imported trades land in the account's current attempt (the live challenge run)
    const attemptId = await getCurrentAttemptId(pool, Number(account_id));

    const rows = parseCSV(String(csv));
    if (rows.length < 2) return res.status(400).json({ error: 'CSV has no data rows' });

    // Locate the real header (skips broker preamble/summary blocks)
    const { idx: headerIdx, map: col } = findHeaderRow(rows);
    const header = rows[headerIdx];

    // Order-book / execution-log format? Pair fills into round-trip trades.
    // (Checked BEFORE the generic column validation — order books have no P&L/entry column.)
    const execCols = detectExecutionLog(header);
    if (execCols) {
      const { trades, executed, skippedNonExec } = aggregateExecutions(rows, headerIdx, execCols);
      let ins = 0, skp = 0;
      for (const t of trades) {
        const hash = crypto.createHash('md5')
          .update(`${account_id}|${t.symbol}|${t.entry_time.toISOString()}|${t.exit_time?.toISOString?.() || ''}|${t.entry_price}|${t.quantity}|${t.pnl}`)
          .digest('hex').slice(0, 20);
        const r = await pool.query(
          `INSERT INTO trades (account_id, broker_trade_id, symbol, entry_time, exit_time,
             entry_price, exit_price, quantity, pnl, setup_tag, attempt_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (broker_trade_id) DO NOTHING RETURNING id`,
          [account_id, `ob_${hash}`, t.symbol, t.entry_time, t.exit_time,
           t.entry_price, t.exit_price, t.quantity, t.pnl, 'Imported', attemptId]
        );
        if (r.rows.length > 0) ins++; else skp++;
      }
      const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
      return res.json({
        success: true, mode: 'orderbook-aggregated',
        inserted: ins, skipped: skp,
        tradesBuilt: trades.length, executedFills: executed, ignoredRows: skippedNonExec,
        totalPnl: Number(totalPnl.toFixed(2)),
      });
    }

    // Generic (row-per-trade) formats: require a symbol + entry/buy price or P&L
    if (col.symbol === undefined || (col.entry_price === undefined && col.pnl === undefined)) {
      return res.status(400).json({
        error: 'Could not detect required columns. Need at least a symbol column and either an entry/buy price or a P&L column.',
        detected: Object.keys(col),
        headers: header,
      });
    }

    // No per-trade date column? Fall back to the report period-end date.
    const fallbackDate = col.entry_time === undefined ? (extractFallbackDate(rows) || new Date()) : null;

    let inserted = 0, skipped = 0;
    const errors: string[] = [];

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      try {
        const symbol = (row[col.symbol] || '').trim();
        if (!symbol) { skipped++; continue; }

        const entryPrice = toNum(row[col.entry_price]);
        const exitPrice = col.exit_price !== undefined ? toNum(row[col.exit_price]) : null;
        const qty = col.quantity !== undefined ? (toNum(row[col.quantity]) ?? 1) : 1;
        const side = col.side !== undefined ? parseSide(row[col.side]) : null;
        let pnl = col.pnl !== undefined ? toNum(row[col.pnl]) : null;
        const entryTime = (col.entry_time !== undefined ? parseDate(row[col.entry_time]) : null) || fallbackDate || new Date();
        const exitTime = col.exit_time !== undefined ? parseDate(row[col.exit_time]) : null;
        const setup = col.setup !== undefined ? (row[col.setup] || '').trim() : 'CSV Import';
        const notes = col.notes !== undefined ? (row[col.notes] || '').trim() : null;

        // Derive P&L if not provided
        if (pnl === null && entryPrice !== null && exitPrice !== null) {
          const dir = side === 'SHORT' ? -1 : 1;
          pnl = (exitPrice - entryPrice) * qty * dir;
        }

        // Stable dedupe id from the row's identifying fields
        const hash = crypto.createHash('md5')
          .update(`${account_id}|${symbol}|${entryTime.toISOString()}|${entryPrice}|${qty}|${pnl}`)
          .digest('hex').slice(0, 20);
        const brokerTradeId = `csv_${hash}`;

        const result = await pool.query(
          `INSERT INTO trades (account_id, broker_trade_id, symbol, entry_time, exit_time,
             entry_price, exit_price, quantity, pnl, setup_tag, notes, attempt_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (broker_trade_id) DO NOTHING
           RETURNING id`,
          [account_id, brokerTradeId, symbol, entryTime, exitTime,
           entryPrice ?? 0, exitPrice, qty, pnl, setup || 'CSV Import', notes, attemptId]
        );
        if (result.rows.length > 0) inserted++; else skipped++;
      } catch (e: any) {
        errors.push(`Row ${r + 1}: ${e.message}`);
      }
    }

    res.json({
      success: true,
      inserted,
      skipped,
      totalRows: rows.length - 1,
      detectedColumns: Object.keys(col),
      errors: errors.slice(0, 10),
    });
  } catch (error: any) {
    console.error('CSV import error:', error);
    res.status(500).json({ error: 'Failed to import CSV: ' + error.message });
  }
});

export default router;
