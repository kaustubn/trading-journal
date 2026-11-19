// Plain-English summary of a News Event study. Always available from fixed rules (no AI, no cost).
// If ANTHROPIC_API_KEY is set, Claude may rewrite it from the computed stats JSON only; the result is rejected
// (and the rule-based text used) unless every number in it appears in the stats and it contains no trade calls.
import Anthropic from '@anthropic-ai/sdk';

export const LABEL = 'Scenario research, not a trade signal';

interface Ci { p: number; lo: number; hi: number }
interface WS { n: number; insufficient: boolean; up: Ci | null; medianPts: number | null; meanPts: number | null }
interface Study {
  event: string; info: { name: string; measures: string };
  counts: { used: number; withForecast: number };
  buckets: Record<string, { n: number; windows: Record<string, WS>; reversal: { n: number; insufficient: boolean; rate: Ci | null }; first15VsAvg: number | null }>;
  rows: { date: string; m5: number | null; shared: string[] }[];
  includeShared?: boolean;
}

const pc = (x: number) => Math.round(x * 100);
const f1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

/** Compact, rounded stats: the ONLY thing the AI sees, and the reference set of allowed numbers. */
export function digest(s: Study) {
  const all = s.buckets.all, w = (k: string) => all.windows[k];
  const win = (k: string) => { const x = w(k); return x && !x.insufficient && x.up ? { n: x.n, upPct: pc(x.up.p), upLo: pc(x.up.lo), upHi: pc(x.up.hi), medianPts: Number(f1(x.medianPts!)), meanPts: Number(f1(x.meanPts!)) } : { n: x?.n ?? 0, insufficient: true }; };
  const dates = s.rows.filter(r => r.m5 != null && (s.includeShared || !r.shared?.length)).map(r => r.date).sort(); // releases actually used
  return {
    event: s.event, name: s.info.name, measures: s.info.measures, releasesUsed: s.counts.used, withForecast: s.counts.withForecast,
    from: dates[0] ?? null, to: dates[dates.length - 1] ?? null,
    plus5min: win('m5'), plus60min: win('m60'), restOfSession: win('session'),
    reversal: all.reversal.insufficient || !all.reversal.rate ? { n: all.reversal.n, insufficient: true } : { n: all.reversal.n, pct: pc(all.reversal.rate.p), lo: pc(all.reversal.rate.lo), hi: pc(all.reversal.rate.hi) },
    first15VsNormal: all.first15VsAvg == null ? null : Number(f1(all.first15VsAvg)),
  };
}

export function ruleSummary(s: Study): string[] {
  const d = digest(s);
  const out: string[] = [`What it measures: ${d.measures}`];
  const m5 = d.plus5min as any, m60 = d.plus60min as any, rev = d.reversal as any;
  if (m5.insufficient) out.push(`Only ${m5.n} releases have NQ data: insufficient evidence for any statistics.`);
  else {
    out.push(`Across ${m5.n} releases (${d.from} to ${d.to}), NQ was higher 5 minutes after the release ${m5.upPct}% of the time (95% range ${m5.upLo}–${m5.upHi}%); median move ${m5.medianPts} pts, average ${m5.meanPts} pts.`);
    if (!m60.insufficient) out.push(`After 60 minutes it was higher ${m60.upPct}% of the time (95% range ${m60.upLo}–${m60.upHi}%)${rev.insufficient ? '' : `, and the first-5-minute direction had reversed by then in ${rev.pct}% of releases (95% range ${rev.lo}–${rev.hi}%, n ${rev.n})`}.`);
    if (d.first15VsNormal != null) out.push(`The first 15 minutes moved about ${d.first15VsNormal}× the normal range for that time of day (n ${m5.n}).`);
    const coin = (x: any) => !x.insufficient && x.upLo <= 50 && x.upHi >= 50;
    out.push(`What the data does NOT support: ${coin(m5) && (m60.insufficient || coin(m60)) ? 'a reliable direction — the up/down split is not clearly different from a coin flip' : 'trading it as a signal without a forward test — a past split is not a guarantee'}${d.withForecast ? '' : '; surprise-based conclusions (no forecasts imported yet)'}.`);
  }
  return out.slice(0, 5);
}

/** Every number in `text` must be in the digest (or a harmless constant such as window lengths and 95). */
export function numbersOk(text: string, dg: unknown): boolean {
  const allowed = new Set<string>(['1', '5', '10', '15', '30', '60', '95', '16', '00', '8', '30', '14', '2', '3', '4']);
  const walk = (v: unknown) => {
    if (typeof v === 'number') { allowed.add(String(v)); allowed.add(String(Math.round(v))); allowed.add(String(Math.abs(v))); allowed.add(String(Math.abs(Math.round(v)))); }
    else if (typeof v === 'string') (v.match(/\d+(\.\d+)?/g) || []).forEach(x => allowed.add(x));
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(dg);
  const nums = text.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(\.\d+)?/g) || [];
  return nums.every(n => allowed.has(n) || allowed.has(String(Number(n))));
}

const TRADE_CALL = /\b(buy|sell|go long|go short|enter (a )?(long|short)|take (a )?(long|short)|you should (trade|buy|sell))\b/i;

export async function summarize(s: Study): Promise<{ bullets: string[]; source: 'rules' | 'ai'; label: string; model?: string }> {
  const rules = ruleSummary(s);
  if (!process.env.ANTHROPIC_API_KEY) return { bullets: rules, source: 'rules', label: LABEL };
  const dg = digest(s);
  const model = process.env.NEWS_AI_MODEL || 'claude-haiku-5-5';
  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model, max_tokens: 600,
      system: 'You write 3 to 5 plain-English bullet points (each starting with "- ") about how NQ futures reacted to a US economic release, '
        + 'using ONLY the JSON you are given. Cover: what the release measures, how past releases moved NQ, and what the data does NOT support. '
        + 'Quote n for every statistic. Never invent or compute new numbers; copy numbers exactly from the JSON. No buy/sell or long/short recommendations.',
      messages: [{ role: 'user', content: JSON.stringify(dg) }],
    });
    const text = msg.content.map(b => (b.type === 'text' ? b.text : '')).join('\n');
    const bullets = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
    if (bullets.length < 3 || bullets.length > 5 || !numbersOk(bullets.join(' '), dg) || TRADE_CALL.test(bullets.join(' '))) {
      console.warn('[news/summary] AI text rejected by the checks; using the rule-based summary');
      return { bullets: rules, source: 'rules', label: LABEL };
    }
    return { bullets, source: 'ai', label: LABEL, model };
  } catch (e) {
    console.warn('[news/summary] AI unavailable:', (e as Error).message);
    return { bullets: rules, source: 'rules', label: LABEL };
  }
}
