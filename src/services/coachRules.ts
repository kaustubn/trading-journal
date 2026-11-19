// Rule-based coach (no AI): finds costly habits in a trader's journal and ranks them by the money they cost.
// Pure; tested in tests/coachRules.test.ts.

export interface CTrade {
  id: number; day: string;            // trading day
  entry: number; exit: number | null; // epoch ms (UTC)
  pnl: number; qty: number | null; tags: string[];
}

export interface Finding {
  key: string; title: string; explain: string;
  n: number; pnl: number; avg: number;
  lossShare: number | null;  // share of the account's total losses that these trades produced (losing trades only)
  smallSample: boolean;      // fewer than 10 trades: treat as a hint
  tradeIds: number[];
}

const REVENGE_MIN = 5;

export function coachFindings(trades: CTrade[], opts: { dailyLossLimit: number | null; blackout: { before: number; after: number } | null; releasesUtc: number[] }): Finding[] {
  const ts = [...trades].sort((a, b) => a.entry - b.entry);
  const totalLoss = -ts.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0);
  const byDay = new Map<string, CTrade[]>();
  for (const t of ts) byDay.set(t.day, [...(byDay.get(t.day) ?? []), t]);
  const counts = [...byDay.values()].map(d => d.length).sort((a, b) => a - b);
  const medianPerDay = counts.length ? counts[Math.floor((counts.length - 1) / 2)] : 0;
  const overN = Math.max(3, medianPerDay * 2);

  const sets: Record<string, CTrade[]> = { size: [], revenge: [], limit: [], over: [], tagged: [], news: [] };
  for (const day of byDay.values()) {
    let cum = 0;
    day.forEach((t, i) => {
      const prev = day[i - 1];
      if (prev && prev.pnl < 0 && t.qty != null && prev.qty != null && t.qty > prev.qty) sets.size.push(t);
      if (prev && prev.pnl < 0 && prev.exit != null && t.entry - prev.exit >= 0 && t.entry - prev.exit <= REVENGE_MIN * 60000) sets.revenge.push(t);
      if (opts.dailyLossLimit && opts.dailyLossLimit > 0 && cum <= -opts.dailyLossLimit) sets.limit.push(t);
      if (i >= overN) sets.over.push(t);
      cum += t.pnl;
    });
  }
  for (const t of ts) {
    if (t.tags.some(x => /rule break/i.test(x))) sets.tagged.push(t);
    if (opts.blackout && opts.releasesUtc.some(r => t.entry >= r - opts.blackout!.before * 60000 && t.entry < r + opts.blackout!.after * 60000)) sets.news.push(t);
  }
  const meta: Record<string, [string, string]> = {
    size: ['Bigger size right after a loss', 'Trades where you added contracts straight after a losing trade on the same day.'],
    revenge: ['Re-entering within 5 minutes of a loss', 'Trades opened less than 5 minutes after a losing trade closed (a common sign of revenge trading).'],
    limit: ['Trading past your daily loss limit', "Trades taken after the day's P&L had already reached the account's daily loss limit."],
    over: [`Overtrading (trade ${overN + 1}+ of the day)`, `Trades beyond twice your usual number per day (usual: ${medianPerDay}).`],
    tagged: ['Trades you tagged "Rule break"', 'Trades marked as rule breaks (by you or by the replay coach).'],
    news: ['Trades inside your news blackout', "Trades opened inside the account's prop-firm news window."],
  };
  const out: Finding[] = [];
  for (const [k, xs] of Object.entries(sets)) {
    if (!xs.length) continue;
    const pnl = xs.reduce((a, t) => a + t.pnl, 0), loss = -xs.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0);
    out.push({ key: k, title: meta[k][0], explain: meta[k][1], n: xs.length, pnl, avg: pnl / xs.length,
      lossShare: totalLoss > 0 ? loss / totalLoss : null, smallSample: xs.length < 10, tradeIds: xs.map(t => t.id).slice(0, 200) });
  }
  return out.sort((a, b) => a.pnl - b.pnl); // most costly first
}
