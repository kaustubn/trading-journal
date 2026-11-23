// Defensive numeric helpers. Backend now returns decimals as numbers, but
// values can still be null/undefined (empty accounts, missing fields). These
// never throw, so a stray null can't crash a render.

export function num(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

export function curSymbol(code?: string): string {
  return code === 'USD' ? '$' : code === 'CAD' ? 'C$' : '₹';
}

// Active currency symbol for the selected account — set in App on account change.
let _symbol = '₹';
export function setCurrency(code?: string) { _symbol = curSymbol(code); }

export function money(value: unknown, decimals = 2, symbol?: string): string {
  const s = symbol ?? _symbol;
  const n = num(value);
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  // Avoid "-$0" when a tiny negative rounds to zero
  const neg = n < 0 && Number(Math.abs(n).toFixed(decimals)) !== 0;
  return `${neg ? '-' : ''}${s}${abs}`;
}

/** Active currency symbol ($ or ₹) for labels like "charges $/trade". */
export function currencySymbol(): string { return _symbol; }

/** Signed money: "+$1,250" / "-$300" — for P&L deltas. */
export function signedMoney(value: unknown, decimals = 0): string {
  const n = num(value);
  return `${n > 0 ? '+' : ''}${money(n, decimals)}`;
}

export function pct(value: unknown, decimals = 1): string {
  return `${num(value).toFixed(decimals)}%`;
}

export function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
