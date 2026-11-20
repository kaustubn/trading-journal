import { Router, Request, Response } from 'express';
import { pointValue } from '../utils/pointValue';
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
  // Only our own backtest exports carry this; broker files keep the field-hash dedupe
  trade_id:    ['backtesttradeid'],
  commission:  ['commission', 'commissions', 'fees', 'fee', 'totalfees', 'brokerage', 'charges', 'comm'],
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
  const openPositions: { symbol: string; qty: number }[] = [];
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
    if (pos !== 0) openPositions.push({ symbol, qty: pos }); // not flat at the end of the file: not imported
  }
  // Chronological order so the calendar/list read naturally
  trades.sort((a, b) => a.entry_time.getTime() - b.entry_time.getTime());
  return { trades, executed, skippedNonExec, openPositions };
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

// Futures-looking symbol (root letters + optional month code/year) whose point value we don't know.
const FUTURES_RE = /^(?:[A-Z_]+:)?[A-Z]{1,4}[FGHJKMNQUVXZ]?\d{0,4}!?$/;
function unknownFuture(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  return FUTURES_RE.test(s) && /[FGHJKMNQUVXZ]\d{1,4}$|!$/.test(s) && pointValue(s) === 1;
}

interface Planned {
  brokerTradeId: string; symbol: string; entry_time: Date; exit_time: Date | null;
  entry_price: number | null; exit_price: number | null; quantity: number; pnl: number | null;
  setup: string; notes: string | null; commission: number | null; dateMissing: boolean;
}

// POST /api/import/csv  { account_id, csv, preview? }
// preview: true -> nothing is written; returns what WOULD be imported plus checks (duplicates, open positions,
// unknown contracts, commissions in the file vs the account's estimate, missing dates).
router.post('/import/csv', async (req: Request, res: Response) => {
  try {
    const user_id = req.userId;
    const { account_id, csv } = req.body;
    const preview = req.body?.preview === true;

    if (!account_id || !csv) {
      return res.status(400).json({ error: 'account_id and csv are required' });
    }

    // Verify ownership
    const own = await pool.query('SELECT id, cost_per_trade, micro_cost_per_trade, timezone FROM accounts WHERE id = $1 AND user_id = $2', [account_id, user_id]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'Account not found' });

    const rows = parseCSV(String(csv));
    if (rows.length < 2) return res.status(400).json({ error: 'CSV has no data rows' });

    // Locate the real header (skips broker preamble/summary blocks)
    const { idx: headerIdx, map: col } = findHeaderRow(rows);
    const header = rows[headerIdx];

    const planned: Planned[] = [];
    let mode = 'rows';
    let extra: Record<string, unknown> = {};
    const errors: string[] = [];
    let skippedRows = 0;

    // Order-book / execution-log format? Pair fills into round-trip trades.
    // (Checked BEFORE the generic column validation — order books have no P&L/entry column.)
    const execCols = detectExecutionLog(header);
    if (execCols) {
      mode = 'orderbook-aggregated';
      const { trades, executed, skippedNonExec, openPositions } = aggregateExecutions(rows, headerIdx, execCols);
      extra = { executedFills: executed, ignoredRows: skippedNonExec, openPositions };
      for (const t of trades) {
        const hash = crypto.createHash('md5')
          .update(`${account_id}|${t.symbol}|${t.entry_time.toISOString()}|${t.exit_time?.toISOString?.() || ''}|${t.entry_price}|${t.quantity}|${t.pnl}`)
          .digest('hex').slice(0, 20);
        planned.push({ brokerTradeId: `ob_${hash}`, symbol: t.symbol, entry_time: t.entry_time, exit_time: t.exit_time, entry_price: t.entry_price,
          exit_price: t.exit_price, quantity: t.quantity, pnl: t.pnl, setup: 'Imported', notes: null, commission: null, dateMissing: false });
      }
    } else {
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
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        try {
          const symbol = (row[col.symbol] || '').trim();
          if (!symbol) { skippedRows++; continue; }
          const entryPrice = toNum(row[col.entry_price]);
          const exitPrice = col.exit_price !== undefined ? toNum(row[col.exit_price]) : null;
          const qty = col.quantity !== undefined ? (toNum(row[col.quantity]) ?? 1) : 1;
          const side = col.side !== undefined ? parseSide(row[col.side]) : null;
          let pnl = col.pnl !== undefined ? toNum(row[col.pnl]) : null;
          const parsedEntry = col.entry_time !== undefined ? parseDate(row[col.entry_time]) : null;
          const entryTime = parsedEntry || fallbackDate || new Date();
          const exitTime = col.exit_time !== undefined ? parseDate(row[col.exit_time]) : null;
          const setup = col.setup !== undefined ? (row[col.setup] || '').trim() : 'CSV Import';
          const notes = col.notes !== undefined ? (row[col.notes] || '').trim() : null;
          const commission = col.commission !== undefined ? toNum(row[col.commission]) : null;
          // Derive P&L if not provided (futures: points x contracts x $ per point)
          if (pnl === null && entryPrice !== null && exitPrice !== null) {
            const dir = side === 'SHORT' ? -1 : 1;
            pnl = (exitPrice - entryPrice) * qty * dir * pointValue(symbol);
          }
          // Stable dedupe id from the row's identifying fields
          // Rows without a readable date use the raw row text, so re-importing the same file never duplicates them
          const when = parsedEntry || fallbackDate ? entryTime.toISOString() : `nodate:${row.join('|')}`;
          const hash = crypto.createHash('md5')
            .update(`${account_id}|${symbol}|${when}|${entryPrice}|${qty}|${pnl}`)
            .digest('hex').slice(0, 20);
          // A backtest file names each trade, so identical trades from different runs both import
          const tradeId = col.trade_id !== undefined ? (row[col.trade_id] || '').trim() : '';
          const brokerTradeId = tradeId
            ? `bt_${crypto.createHash('md5').update(`${account_id}|${tradeId}`).digest('hex').slice(0, 20)}`
            : `csv_${hash}`;
          planned.push({ brokerTradeId, symbol, entry_time: entryTime, exit_time: exitTime, entry_price: entryPrice, exit_price: exitPrice,
            quantity: qty, pnl, setup: setup || 'CSV Import', notes, commission, dateMissing: col.entry_time !== undefined && !parsedEntry });
        } catch (e: any) {
          errors.push(`Row ${r + 1}: ${e.message}`);
        }
      }
    }

    if (preview) {
      const ids = planned.map(p => p.brokerTradeId);
      const dup = ids.length ? await pool.query('SELECT broker_trade_id FROM trades WHERE account_id = $1 AND broker_trade_id = ANY($2)', [account_id, ids]) : { rows: [] as any[] };
      const dupSet = new Set(dup.rows.map((r: any) => r.broker_trade_id));
      const fresh = planned.filter(p => !dupSet.has(p.brokerTradeId));
      const unknown = [...new Set(planned.filter(p => unknownFuture(p.symbol)).map(p => p.symbol))];
      const withComm = planned.filter(p => p.commission != null);
      const commTotal = withComm.reduce((a, p) => a + Math.abs(p.commission as number), 0);
      const est = Number(own.rows[0].cost_per_trade) || 0;
      const times = planned.map(p => p.entry_time.getTime()).filter(Number.isFinite).sort((a, b) => a - b);
      const warnings: string[] = [];
      if (unknown.length) warnings.push(`No point value for ${unknown.join(', ')}: P&L for these may be in points, not dollars. Check them after import.`);
      const open = (extra.openPositions as any[] | undefined) ?? [];
      if (open.length) warnings.push(`${open.length} position${open.length === 1 ? ' is' : 's are'} still open at the end of the file (${open.map(o => `${o.symbol} ${o.qty > 0 ? '+' : ''}${o.qty}`).join(', ')}): not imported until closed.`);
      const missingDates = planned.filter(p => p.dateMissing).length;
      if (missingDates) warnings.push(`${missingDates} row${missingDates === 1 ? ' has' : 's have'} an unreadable date and would be dated today.`);
      if (withComm.length && est > 0) warnings.push(`The file has commissions (avg $${(commTotal / withComm.length).toFixed(2)} per trade). This account also subtracts an estimated $${est.toFixed(2)} per trade — set the account's cost per trade to match so costs are not counted twice or wrong.`);
      else if (withComm.length) warnings.push(`The file has commissions (avg $${(commTotal / withComm.length).toFixed(2)} per trade, $${commTotal.toFixed(2)} total). P&L is stored as in the file; set the account's cost per trade if the file P&L is before commissions.`);
      if (planned.some(p => p.pnl == null)) warnings.push(`${planned.filter(p => p.pnl == null).length} trade(s) have no P&L and no exit price.`);
      return res.json({
        preview: true, mode, ...extra,
        trades: planned.length, newTrades: fresh.length, duplicates: planned.length - fresh.length, skippedRows,
        pnlNew: Number(fresh.reduce((a, p) => a + (p.pnl ?? 0), 0).toFixed(2)),
        pnlFile: Number(planned.reduce((a, p) => a + (p.pnl ?? 0), 0).toFixed(2)),
        commissions: withComm.length ? { trades: withComm.length, total: Number(commTotal.toFixed(2)) } : null,
        firstTrade: times.length ? new Date(times[0]).toISOString() : null, lastTrade: times.length ? new Date(times[times.length - 1]).toISOString() : null,
        accountTimezone: own.rows[0].timezone ?? null,
        symbols: [...new Set(planned.map(p => p.symbol))].slice(0, 20),
        detectedColumns: Object.keys(col), warnings, errors: errors.slice(0, 10),
      });
    }

    // Imported trades land in the account's current attempt (the live challenge run)
    const attemptId = await getCurrentAttemptId(pool, Number(account_id));
    let inserted = 0, skipped = 0;
    for (const t of planned) {
      try {
        const r = await pool.query(
          `INSERT INTO trades (account_id, broker_trade_id, symbol, entry_time, exit_time,
             entry_price, exit_price, quantity, pnl, setup_tag, notes, attempt_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (broker_trade_id) DO NOTHING RETURNING id`,
          [account_id, t.brokerTradeId, t.symbol, t.entry_time, t.exit_time,
           t.entry_price ?? 0, t.exit_price, t.quantity, t.pnl, t.setup, t.notes, attemptId]
        );
        if (r.rows.length > 0) inserted++; else skipped++;
      } catch (e: any) {
        errors.push(`${t.symbol} ${t.entry_time.toISOString()}: ${e.message}`);
      }
    }
    res.json({
      success: true, mode, ...extra,
      inserted, skipped: skipped + skippedRows,
      tradesBuilt: planned.length, totalRows: rows.length - 1,
      totalPnl: Number(planned.reduce((a, p) => a + (p.pnl ?? 0), 0).toFixed(2)),
      detectedColumns: Object.keys(col),
      errors: errors.slice(0, 10),
    });
  } catch (error: any) {
    console.error('CSV import error:', error);
    res.status(500).json({ error: 'Failed to import CSV' });
  }
});

export default router;
