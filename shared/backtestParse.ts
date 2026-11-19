// Parse a backtest trade list exported from TradingView ("List of trades"), NinjaTrader (Strategy Analyzer ->
// Trades), or any CSV with a time column and a P&L column. Pure; tested in tests/backtestParse.test.ts.

export interface BtTrade {
  entry: number;          // epoch ms of the exporter's wall clock (treated as UTC, like the journal)
  exit: number | null;
  side: 'long' | 'short' | null;
  qty: number | null;
  pnl: number;            // P&L in the file's currency, as exported
  symbol: string | null;
}

export interface ParseResult {
  format: 'tradingview' | 'ninjatrader' | 'generic';
  trades: BtTrade[];
  skipped: number;
  warnings: string[];
}

function splitCsv(line: string, sep: string): string[] {
  if (!line.includes('"')) return line.split(sep);
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === sep && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** "$1,234.50", "(250.00)", "−12", "1 234,5" -> number (NaN if unreadable) */
export function parseMoney(raw: string | undefined): number {
  if (raw == null) return NaN;
  let s = String(raw).trim().replace(/[−–]/g, '-').replace(/[$€£¥\s]|USD/gi, '');
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,50
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

/** Wall-clock text -> epoch ms (as if UTC). Accepts ISO-like and US "M/D/YYYY h:mm[:ss] AM". */
export function parseWhen(raw: string | undefined): number {
  if (!raw) return NaN;
  const s = String(raw).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/.exec(s);
  if (m) {
    let h = +(m[4] ?? 0);
    if (m[7]) { const pm = /p/i.test(m[7]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    return Date.UTC(+m[3], +m[1] - 1, +m[2], h, +(m[5] ?? 0), +(m[6] ?? 0));
  }
  return NaN;
}

const norm = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');
const sideOf = (v: string | undefined): 'long' | 'short' | null => {
  const s = (v || '').toLowerCase();
  return /long|buy/.test(s) ? 'long' : /short|sell/.test(s) ? 'short' : null;
};

export function parseBacktestCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { format: 'generic', trades: [], skipped: 0, warnings: ['The file has no data rows.'] };
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : lines[0].includes('\t') && !lines[0].includes(',') ? '\t' : ',';
  const head = splitCsv(lines[0], sep).map(norm);
  const rows = lines.slice(1).map(l => splitCsv(l, sep));
  const col = (...names: (string | RegExp)[]) => {
    for (const n of names) {
      const i = head.findIndex(h => (typeof n === 'string' ? h === n : n.test(h)));
      if (i >= 0) return i;
    }
    return -1;
  };
  const warnings: string[] = [];
  let skipped = 0;

  // ---- TradingView: two rows per trade ("Entry long" / "Exit long"), grouped by Trade # ----
  const tvNum = col('trade #'), tvType = col('type'), tvTime = col('date/time', 'date and time', /^date/);
  const tvPnl = col('net p&l usd', 'profit usd', /^net p&l/, /^profit/);
  if (tvNum >= 0 && tvType >= 0 && tvTime >= 0 && tvPnl >= 0) {
    const tvQty = col('contracts', 'position size (qty)', /^quantity/);
    const by = new Map<string, { entry?: number; exit?: number; side: 'long' | 'short' | null; qty: number | null; pnl?: number; open: boolean }>();
    for (const r of rows) {
      const id = (r[tvNum] || '').trim(); const type = (r[tvType] || '').toLowerCase();
      if (!id) { skipped++; continue; }
      const g = by.get(id) ?? { side: sideOf(type), qty: null, open: false };
      const when = parseWhen(r[tvTime]);
      if (/entry/.test(type)) g.entry = when;
      if (/exit/.test(type)) {
        g.exit = when;
        const p = parseMoney(r[tvPnl]); if (Number.isFinite(p)) g.pnl = p;
        if (/open/.test((r[col('signal')] || '').toLowerCase())) g.open = true;
      }
      if (tvQty >= 0 && g.qty == null) { const q = Number((r[tvQty] || '').replace(/,/g, '')); if (Number.isFinite(q) && q > 0) g.qty = q; }
      by.set(id, g);
    }
    const trades: BtTrade[] = [];
    let open = 0;
    for (const g of by.values()) {
      if (g.open) { open++; continue; }
      if (g.pnl == null || !Number.isFinite(g.entry ?? NaN)) { skipped++; continue; }
      trades.push({ entry: g.entry!, exit: Number.isFinite(g.exit ?? NaN) ? g.exit! : null, side: g.side, qty: g.qty, pnl: g.pnl, symbol: null });
    }
    if (open) warnings.push(`${open} open trade${open === 1 ? '' : 's'} at the end of the test ${open === 1 ? 'was' : 'were'} left out.`);
    warnings.push('TradingView: P&L is as exported. If your strategy settings had no commission or slippage, add costs below.');
    return { format: 'tradingview', trades: trades.sort((a, b) => a.entry - b.entry), skipped, warnings };
  }

  // ---- NinjaTrader Strategy Analyzer -> Trades ----
  const ntPos = col('market pos.'), ntEntry = col('entry time'), ntProfit = col('profit');
  if (ntPos >= 0 && ntEntry >= 0 && ntProfit >= 0) {
    const ntExit = col('exit time'), ntQty = col('qty', 'quantity'), ntInst = col('instrument');
    const trades: BtTrade[] = [];
    for (const r of rows) {
      const entry = parseWhen(r[ntEntry]), pnl = parseMoney(r[ntProfit]);
      if (!Number.isFinite(entry) || !Number.isFinite(pnl)) { skipped++; continue; }
      const q = ntQty >= 0 ? Number((r[ntQty] || '').replace(/,/g, '')) : NaN;
      trades.push({ entry, exit: ntExit >= 0 && Number.isFinite(parseWhen(r[ntExit])) ? parseWhen(r[ntExit]) : null, side: sideOf(r[ntPos]),
        qty: Number.isFinite(q) && q > 0 ? q : null, pnl, symbol: ntInst >= 0 ? (r[ntInst] || '').trim() || null : null });
    }
    warnings.push('NinjaTrader: check whether "Profit" in your export already includes commission (it usually does when a commission template is set).');
    return { format: 'ninjatrader', trades: trades.sort((a, b) => a.entry - b.entry), skipped, warnings };
  }

  // ---- generic: one row per trade ----
  const gTime = col('exit time', 'close time', 'exit date', 'closed', 'entry time', 'open time', 'date', 'time', /time/, /date/);
  const gPnl = col('net p&l', 'net profit', 'net pnl', 'pnl', 'p&l', 'profit', 'realized p&l', 'net', /p&l/, /pnl/, /profit/);
  if (gTime < 0 || gPnl < 0) {
    return { format: 'generic', trades: [], skipped: rows.length, warnings: [`Could not find a time column and a P&L column. Columns found: ${head.join(', ')}`] };
  }
  const gSide = col('side', 'direction', 'market pos.', 'position', 'type'), gQty = col('qty', 'quantity', 'contracts', 'size');
  const gSym = col('symbol', 'instrument', 'ticker', 'contract'), gExit = col('exit time', 'close time');
  const gEntry = col('entry time', 'open time');
  const trades: BtTrade[] = [];
  for (const r of rows) {
    const when = parseWhen(r[gEntry >= 0 ? gEntry : gTime]), pnl = parseMoney(r[gPnl]);
    if (!Number.isFinite(when) || !Number.isFinite(pnl)) { skipped++; continue; }
    const q = gQty >= 0 ? Number((r[gQty] || '').replace(/,/g, '')) : NaN;
    trades.push({ entry: when, exit: gExit >= 0 && Number.isFinite(parseWhen(r[gExit])) ? parseWhen(r[gExit]) : null,
      side: gSide >= 0 ? sideOf(r[gSide]) : null, qty: Number.isFinite(q) && q > 0 ? q : null, pnl, symbol: gSym >= 0 ? (r[gSym] || '').trim() || null : null });
  }
  return { format: 'generic', trades: trades.sort((a, b) => a.entry - b.entry), skipped, warnings };
}
