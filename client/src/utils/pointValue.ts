// Same table as the server (src/utils/pointValue.ts).
// CME futures $ per point — converts TradingView/Tradovate point P&L to dollars.
// Options/equities (price×qty already = cash value) default to 1.
export const POINT_VALUE: Record<string, number> = {
  NQ: 20, MNQ: 2, ES: 50, MES: 5, YM: 5, MYM: 0.5, RTY: 50, M2K: 5,
  CL: 1000, MCL: 100, NG: 10000, GC: 100, MGC: 10, SI: 5000,
  HG: 25000, ZB: 1000, ZN: 1000, ZF: 1000, ZT: 2000,
  BTC: 5, MBT: 0.1, ETH: 50, MET: 0.1,
};

export function pointValue(sym: string): number {
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
