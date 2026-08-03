// Prop-firm reference data — researched Jul 2026, focused on 25K & 50K accounts.
// Surfaces the stuff firms bury: contract limits, payout caps, how many payouts.
// Rules change monthly — each firm links to a "check latest" tracker. Values marked
// "~" are best-known estimates; always confirm the exact number on the firm's site.

export const LAST_UPDATED = 'Jul 2026';

export interface SizeDetail {
  available: boolean;
  profitTarget: string;     // to pass eval
  maxDrawdown: string;      // $ + how it moves
  contracts: string;        // how many lots you can hold
  scaling?: string;         // scaling-plan gotcha
  dailyLoss: string;
  consistency: string;      // best-day cap
  minDays: string;
  split: string;
  cost: string;
  payoutMin: string;        // smallest you can withdraw
  payoutCap: string;        // max per single payout
  payoutCount: string;      // how many payouts / lifetime cap
  daysBetween: string;
  firstPayout: string;      // what unlocks payout #1
  note?: string;
}

export interface Firm {
  id: string;
  name: string;
  variant: string;          // which account this detail is for
  tagline: string;
  url: string;
  drawdownType: string;
  rating: number;
  discount: { code: string; off: string; verified: string; source: string };
  sizes: { '25K': SizeDetail; '50K': SizeDetail };
  pros: string[];
  cons: string[];
  tags: string[];
}

const NA: SizeDetail = {
  available: false, profitTarget: '—', maxDrawdown: '—', contracts: '—', dailyLoss: '—',
  consistency: '—', minDays: '—', split: '—', cost: '—', payoutMin: '—', payoutCap: '—',
  payoutCount: '—', daysBetween: '—', firstPayout: '—',
};

export const FIRMS: Firm[] = [
  {
    id: 'apex', name: 'Apex Trader Funding', variant: 'Intraday / EOD (4.0)',
    tagline: 'Most popular. One-time pay, choose your drawdown.',
    url: 'https://apextraderfunding.com/', drawdownType: 'Trailing (Intraday or EOD, you pick)',
    rating: 4.2, tags: ['scalper', 'no-daily-loss', 'popular'],
    discount: { code: 'up to 90% off', off: 'up to 90%', verified: 'Jun 2026', source: 'https://damnpropfirms.com/futures-prop-firms/apex-trader-funding/discount/' },
    sizes: {
      '25K': {
        available: true, profitTarget: '$1,500 (6%)', maxDrawdown: '$1,500 trailing', contracts: '4 minis / 40 micros (eval)',
        scaling: 'Funded: start HALF (2 of 4). Full 4 unlocks at ~$26,600 (start + $1,500 DD + $100), where drawdown also freezes',
        dailyLoss: 'None (Intraday) / yes (EOD)', consistency: 'None to pass · 50% to withdraw', minDays: 'None — pass in 1 day', split: 'Tiered → 100% later', cost: 'One-time (promo)',
        payoutMin: '$500', payoutCap: '$1,000 per payout', payoutCount: '⚠ Max ~$6,000 total, then account CLOSES', daysBetween: '~', firstPayout: 'Trade 8 days + 5 qualifying days ($100–300 each) + 50% consistency',
        note: 'The 25K is a small starter — low payout ceiling. Good to learn the rules, not to scale.',
      },
      '50K': {
        available: true, profitTarget: '$3,000 (6%)', maxDrawdown: '$2,500 trailing', contracts: '10 minis / 100 micros (max)',
        scaling: 'Funded: start HALF (5 of 10). Full 10 unlocks at $52,600 (start + $2,500 DD + $100), where drawdown also freezes',
        dailyLoss: 'None (Intraday) / $1,000 (EOD)', consistency: 'None to pass · 50% to withdraw', minDays: 'None — pass in 1 day', split: 'Tiered → 100% from 6th payout', cost: 'One-time (promo)',
        payoutMin: '$500', payoutCap: 'Laddered: $1.5k, $1.5k, $2k, $2.5k, $2.5k, $3k', payoutCount: 'Max 6 payouts = $13,000 lifetime cap', daysBetween: '~', firstPayout: 'Trade 8 days + 5 qualifying days + 50% consistency',
      },
    },
    pros: ['One-time payment (no monthly)', 'Choose Intraday or EOD drawdown', 'Pass in 1 day', 'Frequent 90% discounts'],
    cons: ['Contracts SCALE UP — not full size day 1', 'Payout ladder caps early payouts', '25K closes after ~$6k withdrawn'],
  },
  {
    id: 'lucid', name: 'Lucid Trading', variant: 'LucidFlex',
    tagline: 'Fast ~15-min payouts, EOD drawdown, 90/10 from $1.',
    url: 'https://lucidtrading.com/', drawdownType: 'End-of-Day (EOD) — forgiving intraday',
    rating: 4.4, tags: ['payout-fast', 'flexible', 'no-consistency'],
    discount: { code: 'DGT', off: '50% off', verified: 'Jun 10 2026', source: 'https://saveonpropfirms.com/prop-firms/lucid-trading' },
    sizes: {
      '25K': {
        available: true, profitTarget: '$1,250', maxDrawdown: '$1,000 (EOD trailing)', contracts: '~2 minis / 20 micros',
        dailyLoss: 'None on 25K', consistency: 'Flex: none funded · Pro: 40% · Direct: 20%', minDays: 'Low', split: '90/10', cost: 'One-time eval, no monthly',
        payoutMin: '$500', payoutCap: 'On-demand (no hard cap like Apex)', payoutCount: 'Unlimited on-demand once eligible', daysBetween: 'On-demand', firstPayout: 'Flex: 5 profit days + net positive for the cycle',
        note: '25K has NO daily loss limit — a bad session won\'t auto-fail you.',
      },
      '50K': {
        available: true, profitTarget: '$3,000', maxDrawdown: '$2,000 (EOD trailing)', contracts: '4 minis / 40 micros',
        dailyLoss: 'Yes (~$1,200)', consistency: 'Flex: none funded · Pro: 40% · Direct: 20%', minDays: 'Low', split: '90/10', cost: 'One-time eval, no monthly',
        payoutMin: '$500', payoutCap: 'On-demand', payoutCount: 'Unlimited on-demand once eligible', daysBetween: 'On-demand (~15 min processing)', firstPayout: 'Flex: 5 profit days + net positive',
      },
    },
    pros: ['Payouts in ~15 min, on-demand', '90/10 from the first dollar', 'LucidFlex funded has NO consistency rule', '25K has no daily loss limit'],
    cons: ['LucidDirect variant = strict 20% consistency', 'Newer firm', '50K has a daily loss limit'],
  },
  {
    id: 'tradeify', name: 'Tradeify', variant: 'Growth',
    tagline: 'Cheap one-time eval, no activation, 100% of first $15k.',
    url: 'https://tradeify.co/', drawdownType: 'EOD trailing (locks to floor +$100 once profitable)',
    rating: 4.6, tags: ['cheap', 'balanced', 'payout-fast'],
    discount: { code: 'flash sales', off: '~40% off', verified: 'Jun 2026', source: 'https://saveonpropfirms.com/promos' },
    sizes: {
      '25K': {
        available: true, profitTarget: 'Reach $26,500 (+$1,500)', maxDrawdown: 'EOD trailing (carries from eval)', contracts: '~3 minis (carries from eval)',
        dailyLoss: '~$625', consistency: '35% (funded)', minDays: 'Pass in 1 day possible', split: '100% first $15k, then 90/10', cost: '~$ one-time, no activation',
        payoutMin: 'Balance must hit $26,500', payoutCap: '$1,000 per payout', payoutCount: 'Recurring (keep $1,500 min balance)', daysBetween: '5 trading days between payouts', firstPayout: '5 days with $100+ profit + 35% consistency + balance $26,500',
      },
      '50K': {
        available: true, profitTarget: 'Reach $53,000 (+$3,000)', maxDrawdown: 'EOD trailing (carries from eval)', contracts: '~5–6 minis (carries from eval)',
        dailyLoss: '$1,000', consistency: '35% (funded)', minDays: 'Pass in 1 day possible', split: '100% first $15k, then 90/10', cost: '~$103 one-time, no activation',
        payoutMin: 'Balance must hit $53,000', payoutCap: '$1,500 per payout', payoutCount: 'Recurring (keep min balance)', daysBetween: '5 trading days between payouts', firstPayout: '5 days with $150+ profit + 35% consistency + balance $53,000',
      },
    },
    pros: ['No activation fee', 'Cheap one-time eval', '100% split on first $15k', 'Highest Trustpilot (4.6)'],
    cons: ['Payout capped per request ($1k / $1.5k)', 'Must hold a buffer balance to withdraw', 'Newer firm'],
  },
  {
    id: 'topstep', name: 'TopStep', variant: 'Standard',
    tagline: 'Oldest (2012), clearest rules, on-demand payouts.',
    url: 'https://www.topstep.com/', drawdownType: 'EOD trailing (freezes at start balance once target hit)',
    rating: 3.8, tags: ['beginner', 'payout-fast'],
    discount: { code: 'often none', off: 'varies', verified: 'Jun 12 2026', source: 'https://damnpropfirms.com/futures-prop-firms/topstep/discount/' },
    sizes: {
      '25K': { ...NA, note: 'TopStep does NOT offer a 25K — smallest is 50K.' },
      '50K': {
        available: true, profitTarget: '$3,000', maxDrawdown: '$2,000 (EOD trailing)', contracts: '5 minis / 50 micros',
        dailyLoss: '$1,000', consistency: '50% to pass · none/40% funded', minDays: 'None (Standard)', split: '90/10', cost: '~$49/mo + $149 activation',
        payoutMin: 'Low', payoutCap: 'On-demand', payoutCount: 'On-demand once eligible', daysBetween: 'After 5 winning days (Standard)', firstPayout: '5 winning days (Standard path)',
      },
    },
    pros: ['Clearest rules in the industry', 'On-demand payouts', 'Best docs + biggest community', 'Longest track record'],
    cons: ['No 25K option', 'Monthly fee + activation', 'Rarely any discount'],
  },
  {
    id: 'mffu', name: 'My Funded Futures', variant: 'Core',
    tagline: 'No daily loss limit on any plan.',
    url: 'https://myfundedfutures.com/', drawdownType: 'Core: EOD 3% trailing',
    rating: 4.3, tags: ['no-daily-loss', 'flexible'],
    discount: { code: 'seasonal', off: 'varies', verified: 'Jun 2026', source: 'https://propfirmplus.com/coupon-codes/' },
    sizes: {
      '25K': { ...NA, note: 'MFFU Core starts at 50K — check Starter plans for smaller.' },
      '50K': {
        available: true, profitTarget: '$3,000', maxDrawdown: '$2,000 (EOD 3% trailing)', contracts: '~5 minis',
        dailyLoss: 'None', consistency: '40% (Core)', minDays: 'Low', split: '80/20 (Core)', cost: '~$77/mo',
        payoutMin: 'Low', payoutCap: 'Per policy', payoutCount: 'Recurring', daysBetween: '5 winning days', firstPayout: '5 winning days + 40% consistency',
      },
    },
    pros: ['No daily loss limit', 'Rapid/Pro variants drop the consistency rule', 'Multiple risk styles'],
    cons: ['Core is 80/20 split', 'No 25K in Core', 'Monthly fee'],
  },
  {
    id: 'tpt', name: 'Take Profit Trader', variant: 'PRO / PRO+',
    tagline: 'No daily loss, no consistency — but funded drawdown turns intraday.',
    url: 'https://takeprofittrader.com/', drawdownType: 'EOD in eval → ⚠ INTRADAY on funded (harsher)',
    rating: 4.4, tags: ['no-daily-loss', 'no-consistency'],
    discount: { code: 'seasonal', off: 'varies', verified: 'Jun 2026', source: 'https://saveonpropfirms.com/promos' },
    sizes: {
      '25K': {
        available: true, profitTarget: '$1,500 (6%)', maxDrawdown: '$1,500 EOD → intraday on funded', contracts: '~3 minis / 30 micros',
        dailyLoss: 'None', consistency: 'None', minDays: 'Low', split: 'PRO 80/20 · PRO+ 90/10', cost: 'One-time',
        payoutMin: 'Low', payoutCap: 'First 5 payouts limited to 50% over buffer', payoutCount: 'Recurring; full split after buffer built', daysBetween: '~', firstPayout: 'Withdraw from day 1, but build a buffer (= max DD) for full split',
        note: 'Funded drawdown switches to INTRADAY — a big change from the EOD eval. Plan for it.',
      },
      '50K': {
        available: true, profitTarget: '$3,000 (6%)', maxDrawdown: '$2,000 EOD → intraday on funded', contracts: '~5 minis / 50 micros',
        dailyLoss: 'None', consistency: 'None', minDays: 'Low', split: 'PRO 80/20 · PRO+ 90/10', cost: 'One-time',
        payoutMin: 'Low', payoutCap: 'First 5 payouts limited to 50% over buffer', payoutCount: 'Recurring; full split after buffer built', daysBetween: '~', firstPayout: 'Withdraw from day 1, build buffer for full split',
      },
    },
    pros: ['No daily loss limit', 'No consistency rule', 'Withdraw from day 1', 'PRO+ = 90/10'],
    cons: ['⚠ Funded drawdown becomes INTRADAY (harsh)', 'PRO base split only 80/20', 'Early payouts limited'],
  },
  {
    id: 'alpha', name: 'Alpha Futures', variant: 'Zero / Standard',
    tagline: 'Drawdown floor locks at start; doesn\'t jump on payouts.',
    url: 'https://alphafutures.com/', drawdownType: 'EOD trailing → freezes at start balance (does NOT reset on payout)',
    rating: 4.3, tags: ['payout-fast', 'flexible'],
    discount: { code: 'seasonal', off: 'varies', verified: 'Jun 2026', source: 'https://damnpropfirms.com/futures-prop-firms/alpha-futures/' },
    sizes: {
      '25K': {
        available: true, profitTarget: '$1,500 (Zero)', maxDrawdown: '$1,000 (Zero)', contracts: '~3 minis',
        dailyLoss: 'None (Zero)', consistency: 'Low/none', minDays: '5 winning days', split: '90/10', cost: 'One-time (Zero)',
        payoutMin: '$200+ days', payoutCap: 'Per policy', payoutCount: 'Up to 4 payouts / month', daysBetween: 'Within monthly cap', firstPayout: '5 winning days of $200+ profit',
      },
      '50K': {
        available: true, profitTarget: '$3,000 (Standard) · $4,000 (Advanced)', maxDrawdown: '$2,000 (Standard) · $1,750 (Advanced)', contracts: '~5 minis',
        dailyLoss: 'Plan-specific', consistency: 'Low/none', minDays: '5 winning days', split: '90/10', cost: 'One-time',
        payoutMin: '$200+ days', payoutCap: 'Per policy', payoutCount: 'Up to 4 payouts / month', daysBetween: 'Within monthly cap', firstPayout: '5 winning days of $200+ profit',
        note: 'Drawdown floor locks at start balance and does NOT jump up when you take a payout — friendlier than most.',
      },
    },
    pros: ['Drawdown freezes at start, stable on payouts', 'Up to 4 payouts/month', '90% split', 'Advanced = lower DD for a higher target'],
    cons: ['Newer firm', 'Monthly payout cap (4×)'],
  },
  {
    id: 'bulenox', name: 'Bulenox', variant: 'EOD (Option 2)',
    tagline: '100% first $10k, weekly Wed payouts, EAs allowed.',
    url: 'https://bulenox.com/', drawdownType: 'Option 1 realtime (fixed contracts) OR Option 2 EOD + scaling',
    rating: 4.1, tags: ['cheap', 'flexible'],
    discount: { code: 'LUMI', off: '89% off', verified: 'Jun 2026', source: 'https://funded.now/propfirm/bulenox' },
    sizes: {
      '25K': {
        available: true, profitTarget: '$1,500', maxDrawdown: '$1,500', contracts: 'Option 1: fixed · Option 2: progressive scaling',
        scaling: 'Option 2 scales contracts up as balance grows; Option 1 gives full contracts but realtime (harsher) drawdown',
        dailyLoss: 'Option 2 has a DLL', consistency: '40% at payout', minDays: '10 trading days before 1st payout', split: '100% first $10k, then 90%', cost: 'One-time (89% off w/ LUMI)',
        payoutMin: 'Low', payoutCap: 'First 3 payouts capped $1,000 (25K)', payoutCount: 'Weekly (Wednesdays)', daysBetween: 'Weekly', firstPayout: '10 trading days + 40% consistency',
      },
      '50K': {
        available: true, profitTarget: '$3,000', maxDrawdown: '$2,500', contracts: 'Option 1: fixed · Option 2: progressive scaling',
        scaling: 'Option 2 scales contracts with balance; Option 1 = full size but realtime drawdown',
        dailyLoss: 'Option 2 has a DLL', consistency: '40% at payout', minDays: '10 trading days before 1st payout', split: '100% first $10k, then 90%', cost: 'One-time (89% off w/ LUMI)',
        payoutMin: 'Low', payoutCap: 'First 3 payouts capped by size', payoutCount: 'Weekly (Wednesdays)', daysBetween: 'Weekly', firstPayout: '10 trading days + 40% consistency',
        note: '3-stage model (Qualification → Master → Funded). Cheapest with the LUMI 89% code.',
      },
    },
    pros: ['100% split on first $10k', 'Weekly payouts', 'EAs/bots allowed', 'Huge 89% discount (LUMI)'],
    cons: ['10 trading days before first payout', '3-stage model is more steps', 'Option 1 realtime drawdown is harsh'],
  },
];

// Typical LIST prices (pre-discount) for the cost calculator. Editable in the UI —
// these are ballpark defaults; plug in the real checkout price for an exact number.
// eval = one-time eval fee · monthly = monthly sub (0 if one-time model) · activation = fee on pass.
export interface Price { eval: number; monthly: number; activation: number; }
export const PRICES: Record<string, { '25K': Price | null; '50K': Price | null }> = {
  apex:     { '25K': { eval: 147, monthly: 0, activation: 0 },  '50K': { eval: 167, monthly: 0, activation: 0 } },
  lucid:    { '25K': { eval: 87, monthly: 0, activation: 0 },   '50K': { eval: 137, monthly: 0, activation: 0 } },
  tradeify: { '25K': { eval: 63, monthly: 0, activation: 0 },   '50K': { eval: 103, monthly: 0, activation: 0 } },
  topstep:  { '25K': null,                                       '50K': { eval: 0, monthly: 49, activation: 149 } },
  mffu:     { '25K': null,                                       '50K': { eval: 0, monthly: 80, activation: 0 } },
  tpt:      { '25K': { eval: 110, monthly: 0, activation: 130 }, '50K': { eval: 150, monthly: 0, activation: 130 } },
  alpha:    { '25K': { eval: 69, monthly: 0, activation: 0 },    '50K': { eval: 99, monthly: 0, activation: 0 } },
  bulenox:  { '25K': { eval: 0, monthly: 115, activation: 0 },   '50K': { eval: 0, monthly: 145, activation: 0 } },
};

// Account TYPES per firm (Growth/Select/Lightning etc) — which to pick.
// path: Eval = pass a test first · Instant = funded day 1 (no test).
export interface AccountVariant {
  name: string;
  path: 'Eval' | 'Instant';
  difficulty: 'Easy' | 'Medium' | 'Hard';
  pass: string;        // how fast / what it takes to pass
  payout: string;      // how fast you can withdraw
  note: string;
}
export const ACCOUNT_TYPES: Record<string, AccountVariant[]> = {
  tradeify: [
    { name: 'Growth', path: 'Eval', difficulty: 'Easy', pass: 'Pass in 1 day · no eval consistency', payout: 'Per request, 5 days apart', note: 'Fastest eval · 35% consistency on funded · 1st payout: 5 days of $100+' },
    { name: 'Select', path: 'Eval', difficulty: 'Medium', pass: 'Min 3 days · 40% consistency', payout: 'Daily ($1k cap) or Flex 5-day ($3k cap)', note: 'Consistency REMOVED on funded · pick Daily or Flex once' },
    { name: 'Lightning', path: 'Instant', difficulty: 'Easy', pass: 'No test — funded now', payout: 'Daily per goal ($2–2.5k cap)', note: 'Instant · earn $3k goal for 1st payout · consistency 20%→25%→30%' },
  ],
  lucid: [
    { name: 'LucidFlex', path: 'Eval', difficulty: 'Easy', pass: '5 profit days · 50% consistency in eval', payout: 'On-demand ~15 min', note: 'NO consistency rule once funded — most flexible · no daily loss' },
    { name: 'LucidPro', path: 'Eval', difficulty: 'Medium', pass: 'Hit target · min 3 days', payout: 'On-demand (cycle)', note: '40% consistency at payout' },
    { name: 'LucidDirect', path: 'Instant', difficulty: 'Hard', pass: 'No test — funded now', payout: 'On-demand after 5 days', note: 'Instant, but strict 20% consistency + payout caps' },
  ],
  apex: [
    { name: 'Intraday Trail', path: 'Eval', difficulty: 'Easy', pass: 'Pass in 1 day', payout: 'After 8+5 days', note: 'No daily loss — best for scalpers' },
    { name: 'EOD Trail', path: 'Eval', difficulty: 'Medium', pass: 'Pass in 1 day', payout: 'After 8+5 days', note: 'Forgiving intraday, but has a daily loss limit' },
  ],
  mffu: [
    { name: 'Core', path: 'Eval', difficulty: 'Medium', pass: 'Hit target', payout: '5 winning days', note: 'Cheapest · 40% consistency · 80/20' },
    { name: 'Rapid', path: 'Eval', difficulty: 'Medium', pass: 'Hit target', payout: '5 winning days', note: 'No consistency · 90/10 · intraday drawdown' },
    { name: 'Pro', path: 'Eval', difficulty: 'Medium', pass: 'Hit target', payout: '14 days', note: 'No consistency · EOD drawdown' },
  ],
  tpt: [
    { name: 'PRO', path: 'Eval', difficulty: 'Medium', pass: 'Hit target', payout: 'From day 1 (build buffer)', note: 'No daily loss/consistency · 80/20 · funded goes intraday' },
    { name: 'PRO+', path: 'Eval', difficulty: 'Medium', pass: 'Hit target', payout: 'From day 1 (build buffer)', note: 'Same but 90/10 split' },
  ],
  alpha: [
    { name: 'Zero', path: 'Eval', difficulty: 'Easy', pass: '5 winning days', payout: '4×/month', note: 'Lower target · no daily loss · 90/10' },
    { name: 'Standard', path: 'Eval', difficulty: 'Medium', pass: '5 winning days', payout: '4×/month', note: 'Balanced target/drawdown' },
    { name: 'Advanced', path: 'Eval', difficulty: 'Hard', pass: '5 winning days', payout: '4×/month', note: 'Higher target ($4k) but lower drawdown' },
  ],
  bulenox: [
    { name: 'Option 1', path: 'Eval', difficulty: 'Hard', pass: 'Hit target', payout: 'Weekly (Wed)', note: 'Full contracts but harsh realtime drawdown' },
    { name: 'Option 2', path: 'Eval', difficulty: 'Medium', pass: 'Hit target', payout: 'Weekly (Wed)', note: 'EOD drawdown + scaling · has a daily loss limit' },
  ],
  topstep: [
    { name: 'Standard', path: 'Eval', difficulty: 'Easy', pass: 'Hit target', payout: 'On-demand / 5 winning days', note: 'Clearest rules · on-demand payouts' },
  ],
};

export const STYLES = [
  { key: 'scalper', label: '🔪 I scalp (tight stops)', why: 'No daily loss limit + intraday drawdown you understand.' },
  { key: 'no-consistency', label: '🚫 Hate consistency rules', why: 'Funded plans with no best-day cap.' },
  { key: 'payout-fast', label: '⚡ Fast payouts', why: 'On-demand / ~15-min payouts.' },
  { key: 'beginner', label: '🌱 Clearest rules', why: 'Best structure to learn.' },
  { key: 'cheap', label: '💸 Cheapest entry', why: 'Low one-time fee, no activation.' },
  { key: 'no-daily-loss', label: '🛡️ No daily loss limit', why: 'A bad session won\'t auto-fail you.' },
];

export const GLOSSARY = [
  { term: 'Contracts / lots (max size)', def: 'How many futures contracts you can hold at once. "4 minis / 40 micros" = 4 full E-mini NQ OR 40 Micro MNQ (1 mini = 10 micros). GOTCHA: on funded accounts many firms make you START SMALL and scale up as the balance grows — you often can\'t use full size on day 1.' },
  { term: 'How many payouts', def: 'The hidden killer. Apex caps you: 25K = ~$6,000 total then the account CLOSES; 50K = 6 payouts / $13,000 lifetime. Lucid/TopStep = on-demand, effectively unlimited once eligible. Tradeify = recurring but capped per request ($1k–1.5k).' },
  { term: 'Payout cap (per request)', def: 'Max you can withdraw in ONE payout. Apex 25K = $1,000. Tradeify 50K = $1,500. Others on-demand.' },
  { term: 'First-payout unlock', def: 'What you must do before withdrawal #1: e.g. Apex = 8 trading days + 5 qualifying days + 50% consistency. This is why "instant funded" doesn\'t mean instant money.' },
  { term: 'Profit target', def: 'The $ you must gain to pass the evaluation. 25K ≈ $1,250–1,500. 50K ≈ $3,000.' },
  { term: 'Trailing drawdown', def: 'Your max-loss line that follows your profit up. Intraday = moves on unrealized (harsh, punishes round-tripping). EOD = updates only at close (forgiving).' },
  { term: 'Daily loss limit', def: 'Max you can lose in one day before it locks. "None" = a bad session won\'t auto-fail you.' },
  { term: 'Consistency rule', def: 'Best single day ≤ X% of total profit. 40% rule → one $2,000 day needs $5,000 total before withdrawal. Lower % = stricter.' },
  { term: 'Safety Net / half-max (Apex)', def: 'On Apex funded you can only trade HALF your max contracts (5 of 10 on a 50K) until your balance reaches the Safety Net — start + drawdown + $100 ($52,600 on a 50K). Hit it and you unlock full size AND the drawdown freezes at start balance. This is why you can\'t swing full size on day 1.' },
  { term: 'Buffer / min balance', def: 'Tradeify makes you keep a cushion (e.g. $53,000 on a 50K) to be allowed to withdraw. TPT/Apex require building a buffer before the full split / drawdown freeze.' },
  { term: 'Split', def: 'Your share of profit. 90/10 = you keep 90%. Some give 100% up to a first amount (Tradeify first $15k, Apex first $25k).' },
];
