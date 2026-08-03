// Defensive numeric helpers. Backend now returns decimals as numbers, but
// values can still be null/undefined (empty accounts, missing fields). These
// never throw, so a stray null can't crash a render.

export function num(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

export function curSymbol(code?: string): string {
  return code === 'USD' ? '$' : '₹';
}

// Active currency symbol for the selected account — set in App on account change.
let _symbol = '₹';
export function setCurrency(code?: string) { _symbol = curSymbol(code); }

export function money(value: unknown, decimals = 2, symbol?: string): string {
  const s = symbol ?? _symbol;
  const n = num(value);
  return `${n < 0 ? '-' : ''}${s}${Math.abs(n).toFixed(decimals)}`;
}

export function pct(value: unknown, decimals = 1): string {
  return `${num(value).toFixed(decimals)}%`;
}

export function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
