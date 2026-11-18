// Built-in courses. Book / video courses are made in Claude Code (/mentor-book) and
// stored in the journal; these two ship with the chart.
import type { Course, Rule, Strategy } from './mentorTypes';

const r = (text: string, extra: Partial<Rule> = {}): Rule => ({ text, ...extra });
const K = (text: string): Rule => ({ text, conf: 'KA', src: { book: 'ENTRY_CHECKLIST.md' } });
const empty = { scaleIn: [] as Rule[], avoid: [] as Rule[] };

// ---------------------------------------------------------------- smart money cycle
const smStrategies: Strategy[] = [
  {
    id: 'spring', name: 'Spring long', summary: 'Buy the failed breakdown at the bottom of an accumulation range.', tf: 5,
    when: [r('A trading range forms after a clear down-move (accumulation).'), r('Volume on the selling climax is high, then fades on later tests of the low.')],
    entry: [r('Watch the range low. Let price break it.')],
    trigger: [r('The break fails: the bar closes back inside the range (spring), then a bar closes above the spring bar high.')],
    stop: [r('Below the spring low, with a small buffer (about a quarter ATR).')],
    targets: [r('T1: the range high (the far side of the box).'), r('T2: about 2R, or a measured move the height of the range above it.')],
    manage: [r('After T1, move the stop to break-even.'), r('If price comes back inside and closes under the spring low, the idea is wrong: get out.')],
    scaleIn: [r('Optional: add on the first higher low after the sign of strength (LPS), stop under that low.')],
    scaleOut: [r('Take half at the range high, trail the rest under each new higher low.')],
    avoid: [r('No range or no prior down-move: a break of a random low is not a spring.'), r('Strong trend down with lower highs still forming.')],
    psychology: [r('The spring is built to scare you out. If you feel fear at the low, ask whether the low just took stops and closed back inside.'), r('Do not chase the markup that follows; wait for the next pullback.')],
    detector: { key: 'wyckoff_spring' }, rr: { t1R: 1, t2R: 2, scaleOutAtT1: 0.5 },
  },
  {
    id: 'upthrust', name: 'Upthrust short', summary: 'Sell the failed breakout at the top of a distribution range.', tf: 5,
    when: [r('A trading range forms after a clear up-move (distribution).'), r('Rallies to the top show less strength each time.')],
    entry: [r('Watch the range high. Let price break it.')],
    trigger: [r('The break fails: the bar closes back inside the range (upthrust), then a bar closes below the upthrust bar low.')],
    stop: [r('Above the upthrust high, with a small buffer.')],
    targets: [r('T1: the range low.'), r('T2: about 2R.')],
    manage: [r('After T1, stop to break-even.'), r('A close back above the upthrust high cancels the idea.')],
    scaleIn: [r('Optional: add on the first lower high after the sign of weakness (LPSY).')],
    scaleOut: [r('Half at the range low, trail the rest above each lower high.')],
    avoid: [r('Breakout that holds above the range with volume: that is markup continuing, not an upthrust.')],
    psychology: [r('The upthrust is built to make you buy the breakout (FOMO). Wait for the close.')],
    detector: { key: 'wyckoff_upthrust' }, rr: { t1R: 1, t2R: 2, scaleOutAtT1: 0.5 },
  },
  {
    id: 'sweep', name: 'Liquidity sweep reversal', summary: 'Stops above a high or below a low get taken, the move fails, trapped traders fuel the reversal.', tf: 5,
    when: [r('A clear swing high or low that many traders can see (stops sit beyond it).'), r('Not in a runaway trend against you.')],
    entry: [r('Wait for the wick through the swing.')],
    trigger: [r('The bar closes back inside, and the next bar confirms in the other direction.')],
    stop: [r('Just beyond the sweep wick.')],
    targets: [r('T1 about 2R, T2 about 3R or the opposite swing.')],
    manage: [r('If price returns beyond the wick, exit: the sweep was a real breakout.')],
    scaleIn: [], scaleOut: [r('Half at T1, rest at T2 or trailed.')],
    avoid: [r('8 or more of the last 10 bars trending against the trade.')],
    psychology: [r('Being stopped out on the sweep and then watching it reverse is the classic trap; this setup takes the other side of it.')],
    detector: { key: 'liquidity_sweep' }, rr: { t1R: 2, t2R: 3, scaleOutAtT1: 0.5 },
  },
  {
    id: 'bos-retest', name: 'Break of structure + retest', summary: 'After the range ends, join the new trend on the retest of the broken level.', tf: 5,
    when: [r('Price closes beyond the last swing (break of structure) or the range edge (sign of strength / weakness).')],
    entry: [r('Do not chase the break. Wait for price to come back to the broken level.')],
    trigger: [r('The retest bar holds and closes back on the breakout side.')],
    stop: [r('Beyond the broken level and the retest bar, with a buffer.')],
    targets: [r('T1 2R, T2 3R.')],
    manage: [r('Stop to break-even once price makes a new swing in your direction.')],
    scaleIn: [r('Add on the next pullback that holds above the prior swing.')], scaleOut: [r('Half at T1.')],
    avoid: [r('A retest that closes back through the level: failed break.')],
    psychology: [r('Missing the breakout is fine. The retest is the lower-risk entry for patient traders.')],
    detector: { key: 'breakout_retest' }, rr: { t1R: 2, t2R: 3, scaleOutAtT1: 0.5 },
  },
];

export const SMART_MONEY: Course = {
  id: 'builtin-smart-money', version: 1, kind: 'builtin', mentor: 'Journal mentor', title: 'Smart money cycle (Wyckoff basics)',
  description: 'How large players build positions: accumulation, manipulation, markup, distribution, markdown. Learn to read it bar by bar.',
  chapters: [
    { id: 'cycle', title: '1. The cycle', summary: 'Markets move in four phases. Big players cannot buy everything at once, so they build positions in ranges and then let price trend.',
      points: [r('Accumulation: sideways after a fall. Big buyers absorb selling.'), r('Markup: trend up. Higher highs and higher lows.'), r('Distribution: sideways after a rise. Big sellers unload into late buyers.'), r('Markdown: trend down. Lower highs and lower lows.')],
      psychology: [r('Most traders buy late in markup and sell late in markdown. The cycle is how you avoid being their exit liquidity.')] },
    { id: 'manip', title: '2. Manipulation: springs, upthrusts, sweeps', summary: 'Before a range ends, price often runs the obvious stops on the wrong side. That is where big players fill.',
      points: [r('Spring: a break under the range low that closes back inside.'), r('Upthrust: a break over the range high that closes back inside.'), r('Sweep: any wick beyond a visible swing that closes back.'), r('The tell is the close: a real break closes beyond and holds; a manipulation closes back inside.')],
      psychology: [r('These moves are built to trigger fear (springs) and greed (upthrusts). Wait for the close before you react.')] },
    { id: 'volume', title: '3. Effort and result', summary: 'Volume is effort, the price move is result. When they disagree, something is being absorbed.',
      points: [r('Huge volume with a small move: someone is absorbing the other side.'), r('Climax: a big bar with very high volume at the end of a move often marks the extreme (SC, BC).'), r('Tests of a climax low on lower volume show supply drying up.')] },
    { id: 'structure', title: '4. Structure', summary: 'Trend is defined by swings, not by feelings.',
      points: [r('Uptrend: higher highs and higher lows. Downtrend: lower highs and lower lows.'), r('Break of structure: a close beyond the last swing. In a range, the break of the range edge (SOS / SOW) starts the trend.'), r('The safest entries are on the retest of a broken level.')] },
    { id: 'candles', title: '5. Candles that matter', summary: 'A candle only means something at a level.',
      points: [r('Engulfing: the body swallows the prior body. Shows a shift in control.'), r('Pin bar: a long wick rejecting a level.'), r('Inside bar: pause, energy building. Trade the break in the trend direction.'), r('Doji at an extreme after a long move: indecision, watch for reversal.')] },
    { id: 'mind', title: '6. Mindset', summary: 'The edge is patience at the right place.',
      points: [r('Plan the trade at the level before price gets there.'), r('One good setup beats five average ones.'), r('After a loss, step away for a few bars. The next setup does not need revenge.')] },
  ],
  strategies: smStrategies,
  glossary: [
    { term: 'SC', meaning: 'Selling climax: panic selling with high volume that ends a down-move.' },
    { term: 'AR', meaning: 'Automatic rally: the bounce after the climax; its high marks the range top.' },
    { term: 'ST', meaning: 'Secondary test: price comes back near the climax low on less volume.' },
    { term: 'Spring', meaning: 'A stop-run under the range low that closes back inside.' },
    { term: 'SOS / SOW', meaning: 'Sign of strength / weakness: a strong close out of the range.' },
    { term: 'LPS / LPSY', meaning: 'Last point of support / supply: the pullback after the sign of strength / weakness, often the best entry.' },
    { term: 'UT / UTAD', meaning: 'Upthrust (after distribution): a stop-run over the range high that closes back inside.' },
  ],
  quizzes: [
    { q: 'Price breaks under a 3-hour range low, then the same bar closes back inside the range. What is it most likely?', options: ['Breakdown, go short', 'Spring: possible manipulation before markup', 'Nothing, ignore it'], answer: 1, explain: 'A break that closes back inside is a failed break: the classic spring.' },
    { q: 'Volume is very high but the bar barely moves at the low of a fall. What does it suggest?', options: ['Sellers winning easily', 'Absorption: someone big is buying', 'Low interest'], answer: 1, explain: 'Big effort with small result means the other side is absorbing it.' },
    { q: 'Where is the lower-risk entry after a break of structure up?', options: ['On the breakout bar', 'On the retest of the broken level', 'At the next high'], answer: 1, explain: 'The retest gives a nearby stop beyond the broken level.' },
  ],
};

// ---------------------------------------------------------------- Kay's NQ system
const kStrat = (s: Omit<Strategy, 'scaleIn' | 'avoid'> & Partial<Pick<Strategy, 'scaleIn' | 'avoid'>>): Strategy => ({ ...empty, ...s });
export const KAY_SYSTEM: Course = {
  id: 'builtin-kay-nq', version: 1, kind: 'builtin', mentor: 'Kay', title: "Kay's NQ System (S1 / S2 / S3 / ORB)",
  description: 'Your own entry checklist: universal gates, day type, the four setups, confluence grading.',
  chapters: [
    { id: 'gates', title: 'Universal gates', summary: 'All must pass, or stand down.',
      points: [K('Prime window only: RTH open to about 2 hours, or power hour. No lunch chop 12-1 ET.'), K('ATR-14: 8-30 normal, 30-40 cut size 40%, above 40 skip.'), K('Day classified at IB / 10:00 ET: trend/expansion or range/reversal.'), K('No red flags: no major news in the next 5 minutes, not a half-day.'), K('Entry at a real level: VWAP, POC, VAH/VAL, PDH/PDL, prior swing, round number.'), K('Stop defined before entry; R:R at least the setup minimum; size fits the $ risk cap.'), K('Both directions scanned.')] },
    { id: 'daytype', title: 'Day type decides the setup', summary: 'Trend day: S1 or ORB, never fade. Range day: S2 or S3, never chase. Unsure: no trade.',
      points: [K('Trend / expansion day: S1 pullback or ORB breakout.'), K('Range / reversal day: S2 extreme fade or S3 sweep reversal.')] },
    { id: 'grade', title: 'Confluence and grade', summary: '1 point each: level stack, HTF aligned, clean structure, tape/delta, ATR sweet spot, R:R >= 2.5, major level, prime time.',
      points: [K('A grade 6-8: full size. B grade 4-5: half size. C grade 3 or less: no trade.')],
      psychology: [K('If you cannot tick 4, you do not have an edge, you have a hope.')] },
  ],
  strategies: [
    kStrat({ id: 's1', name: 'S1 Trend pullback', summary: 'Buy/sell the pullback into a level with the trend on a trend day.', tf: 5,
      when: [K('Trend day. 2 consecutive HH/HL (or LH/LL), EMA-21 sloping with the trend.')],
      entry: [K('Pullback of 30-60% into a level (VWAP, EMA, PDH/PDL, profile).')],
      trigger: [K('5-min rejection candle closes at least 50% of its range away from the level; then the first 2-min close in trend direction within 4 candles.')],
      stop: [K('Beyond the rejection candle (a few points).')], targets: [K('R:R at least 2.5. T1 2.5R, T2 4R.')],
      manage: [K('At T1 move the stop to break-even +3.')], scaleOut: [K('Partial at T1.')],
      psychology: [K('Never fade a trend day.')],
      detector: { key: 'ema_pullback', params: { ema: 21, rejection: 0.5, t1R: 2.5, t2R: 4 } }, rr: { t1R: 2.5, t2R: 4 } }),
    kStrat({ id: 's2', name: 'S2 Range extreme fade', summary: 'Fade VAH/VAL or PDH/PDL on a range day after a wick rejection.', tf: 5,
      when: [K('Range day.')], entry: [K('At a range extreme: VAH/VAL, PDH/PDL, session high/low.')],
      trigger: [K('5-min wick rejection closing back in; entry on the first 2-min close back in the fade direction.')],
      stop: [K('5 points beyond the rejection wick.')], targets: [K('T1 VWAP/POC (60%), T2 the opposite extreme (40%). R:R 1.5-2.')],
      manage: [K('At T1 move the stop to break-even +3.')], scaleOut: [K('60% at T1, 40% at T2.')], psychology: [K('Do not chase breakouts on a range day.')],
      detector: { key: 'range_fade', params: { wick: 0.5 } }, rr: { t1R: 1.5, t2R: 2, scaleOutAtT1: 0.6 } }),
    kStrat({ id: 's3', name: 'S3 Liquidity sweep reversal', summary: 'A sweep of real liquidity that reclaims within 1-2 candles.', tf: 5,
      when: [K('Range or reversal day; never against a strong trend.')], entry: [K('Sweep of PDH/PDL, a swing, VAH/VAL or a round number.')],
      trigger: [K('Close back on the original side within 1-2 candles; entry on the first 2-min close back through the level within 4 candles.')],
      stop: [K('3-5 points beyond the sweep wick.')], targets: [K('R:R 2-3.')], manage: [K('At T1 stop to break-even +3.')], scaleOut: [K('Half at T1.')],
      avoid: [K('Skip if 5+ consecutive HH/HL (or LH/LL) in the last 10 bars in the sweep direction.')],
      psychology: [K('The sweep is where others get stopped. Wait for the reclaim close.')],
      detector: { key: 'liquidity_sweep', params: { t1R: 2, t2R: 3 } }, rr: { t1R: 2, t2R: 3 } }),
    kStrat({ id: 'orb', name: 'ORB Opening range breakout', summary: 'Body close beyond the 9:30-9:45 range on an expansion day.', tf: 5,
      when: [K('Expansion / trend day (not a range day).')], entry: [K('Opening range 9:30-9:45 ET, 0.15-0.50x the average New York day range of the last 14 days (about 57-190 points at today’s volatility).')],
      trigger: [K('A clean break and hold: the full body closes outside the range, body at least 8 points; or the first pullback to the broken edge.')],
      stop: [K('Back inside the range (3 points inside the broken edge).')], targets: [K('T1 2R, T2 3R.')], manage: [K('At T1 stop to break-even +3.')], scaleOut: [K('Half at T1.')],
      psychology: [K('Only on expansion days. A wick through is not a break.')],
      detector: { key: 'orb', params: { minAtr: 0.15, maxAtr: 0.5, minBody: 8 } }, rr: { t1R: 2, t2R: 3 } }),
  ],
  quizzes: [
    { q: 'ATR(14) is 43. What does your checklist say?', options: ['Trade normal size', 'Cut size 40%', 'Skip'], answer: 2, explain: 'Above 40 is too wild: skip.', src: { book: 'ENTRY_CHECKLIST.md' } },
    { q: 'Range day, price sweeps PDL and closes back above it on the next candle. Which setup?', options: ['S1', 'S3', 'ORB'], answer: 1, explain: 'A sweep of real liquidity that reclaims within 1-2 candles is S3.', src: { book: 'ENTRY_CHECKLIST.md' } },
    { q: 'Your confluence score is 3. What do you do?', options: ['Half size', 'Full size', 'No trade'], answer: 2, explain: 'C grade (3 or less) is no trade.', src: { book: 'ENTRY_CHECKLIST.md' } },
  ],
};

export const BUILTIN_COURSES: Course[] = [SMART_MONEY, KAY_SYSTEM];
