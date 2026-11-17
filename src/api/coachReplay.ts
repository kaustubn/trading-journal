// Claude as a practice coach on the market chart: reviews an entry, an exit, or
// answers a question about what is on the charts (replay or forward testing).
import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { verifyToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = Router();
router.use(verifyToken, requireAdmin);

const MODEL = 'claude-opus-5-5';

// The trader's own entry checklist (condensed from trading-system/ENTRY_CHECKLIST.md)
const CHECKLIST = `
UNIVERSAL GATES (all must pass, else NO TRADE): prime window only (RTH open ~2h, or power hour; no lunch chop 12-1 ET) ·
ATR-14 8-30 normal, 30-40 cut size, >40 skip · day classified at IB/10:00 (trend/expansion vs range/reversal) ·
no red flags (news, holiday) · entry at a REAL level (VWAP, POC, VAH/VAL, PDH/PDL, prior swing, round number) ·
stop defined before entry, R:R >= setup minimum, size fits $ risk cap · both directions scanned.
DAY TYPE -> SETUP: trend/expansion -> S1 pullback or ORB (never fade). Range/reversal -> S2 extreme fade or S3 sweep reversal (never chase breakouts). Unsure -> no trade.
S1 trend pullback: 2 HH/HL (or LH/LL), EMA21 sloping with trend; pullback 30-60% into a level; 5m rejection candle body closes >=50% of range away from the level; trigger = first 2m close in trend direction within 4 candles; R:R >= 2.5.
S2 range extreme fade: at VAH/VAL/PDH/PDL/session extreme; 5m wick rejection closing back in; entry first 2m close back; stop 5 pts beyond the wick; T1 VWAP/POC, T2 opposite extreme; R:R 1.5-2.
S3 liquidity sweep reversal: sweep of real liquidity by a 5m wick; reclaim within 1-2 candles; skip if 5+ consecutive HH/HL in sweep direction; entry first 2m close back through the level; stop 3-5 pts beyond the sweep wick; R:R 2-3.
ORB: clean break + hold beyond the opening range (close outside), momentum expansion, expansion day only; stop back inside the range.
CONFLUENCE (1 pt each): level stack, 15m trend agrees, clean structure, tape/delta confirms, ATR 8-30, R:R >= 2.5, major level, prime time. A = 6-8 (full size), B = 4-5 (half size), C <= 3 = NO TRADE.`;

const SYSTEM = `You are a strict, practical futures trading coach sitting next to a trader who is practising on NQ (Nasdaq-100 E-mini futures) in a bar-replay simulator or forward-testing on a live chart. The trader wrote their own rules; hold them to those rules.

The trader's checklist:${CHECKLIST}

How to coach:
- Judge only from the data given (candles per timeframe, levels, the order or trade, today's trades, rule-check results). Never assume candles you were not shown — in replay the future is hidden.
- Be concrete: name the level, the candle, the timeframe, the number. No generic advice.
- Grade entries against the checklist (setup, day type, level, confluence score, grade A/B/C).
- If rules were broken, say so plainly and what to do instead.
- At most 120 words. Plain sentences, no headings.
- This is practice on the trader's own system, not investment advice.

The FIRST line of your reply must be exactly one of:
VERDICT: GO   (entry fits the rules)
VERDICT: CAUTION   (allowed but weak or B-grade; explain)
VERDICT: STOP   (breaks a rule or C-grade; the trader should not take it / should stop for the day)
For a plain question, use VERDICT: INFO.`;

const KINDS = ['entry', 'exit', 'ask'] as const;
type Kind = typeof KINDS[number];

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

// POST /api/coach/replay { kind: 'entry'|'exit'|'ask', question?: string, context: {...} }
router.post('/', async (req: Request, res: Response) => {
  const kind = req.body?.kind as Kind;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: "kind must be 'entry', 'exit' or 'ask'" });
  const question = typeof req.body?.question === 'string' ? req.body.question.slice(0, 1000) : '';
  if (kind === 'ask' && !question.trim()) return res.status(400).json({ error: 'Type a question.' });
  const context = JSON.stringify(req.body?.context ?? {});
  if (context.length > 80000) return res.status(400).json({ error: 'Chart context too large.' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Claude is not set up: add ANTHROPIC_API_KEY on the server.' });
  }

  const task = kind === 'entry'
    ? 'The trader is about to enter this order. Review the entry before they confirm it.'
    : kind === 'exit'
      ? 'This trade just closed. Review it: was the entry valid by the checklist, was it managed well, and what is the one lesson?'
      : `The trader asks: ${question}`;

  try {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: [{ model: 'claude-opus-4-8' }], // if Opus 5.5 declines, Opus 4.8 answers in the same call
      system: SYSTEM,
      messages: [{ role: 'user', content: `${task}\n\nChart and session context (JSON):\n${context}` }],
    });

    if (response.stop_reason === 'refusal') {
      return res.status(200).json({ verdict: 'INFO', text: 'Claude declined to review this one. Try asking differently.' });
    }
    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
      .trim();
    const m = /^\s*VERDICT:\s*(GO|CAUTION|STOP|INFO)\b\s*/i.exec(text);
    const verdict = m ? m[1].toUpperCase() : 'INFO';
    res.json({ verdict, text: m ? text.slice(m[0].length).trim() : text, model: response.model });
  } catch (e: any) {
    if (e instanceof Anthropic.AuthenticationError) {
      return res.status(503).json({ error: 'Claude rejected the API key on the server (ANTHROPIC_API_KEY).' });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Claude is busy (rate limited). Try again in a minute.' });
    }
    if (e instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(e.message)) {
      return res.status(402).json({ error: 'Your Anthropic account has no credit left. Add credit at console.anthropic.com → Billing.' });
    }
    if (e instanceof Anthropic.APIError) {
      console.error('[coach/replay] API error', e.status, e.message);
      return res.status(502).json({ error: `Claude error ${e.status ?? ''}: ${String(e.message).slice(0, 200)}` });
    }
    console.error('[coach/replay]', e?.message);
    res.status(500).json({ error: 'Coach failed — try again.' });
  }
});

export default router;
