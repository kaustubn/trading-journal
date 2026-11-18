// Plain-English explanations for every metric the journal shows.
// Used by <InfoTip term="..."/>: what it is + what good looks like.

export interface Term { label: string; what: string; good: string }

export const GLOSSARY: Record<string, Term> = {
  netPnl: { label: 'Net P&L', what: 'Everything you made minus everything you lost (after charges, if you set them).', good: 'Positive and trending up. One big day matters less than a steady curve.' },
  winRate: { label: 'Win rate', what: 'The share of trades that closed in profit.', good: '40–60% is normal for intraday futures. Only means something next to your average win and loss.' },
  profitFactor: { label: 'Profit factor', what: 'Money won ÷ money lost. 1.0 means break-even.', good: 'Above 1.5 is healthy, 2.0+ is strong. Below 1.0 means you are losing money overall.' },
  expectancy: { label: 'Expectancy', what: 'What one trade is worth on average: total P&L ÷ number of trades.', good: 'Must be above $0. The bigger and steadier, the better.' },
  streak: { label: 'Streak', what: 'How many wins (W) or losses (L) in a row you are on right now.', good: 'Neither is a signal. After 3+ losses, take a break before the next trade.' },
  score: { label: 'Performance score', what: 'A 0–100 mix of profit factor, win/loss size, risk control, win rate and consistency.', good: '70+ is good, 50–70 is average, below 50 needs work. Look at the weakest bar first.' },
  payoff: { label: 'Avg win / avg loss', what: 'The size of your average winning trade next to your average losing trade.', good: 'Winners bigger than losers (ratio above 1.0). With a ~50% win rate you need that to profit.' },
  avgR: { label: 'Average R', what: 'Average result measured in "R", where 1R = the money you risked to your stop.', good: '+0.2R or better per trade is solid. Needs a stop loss saved on each trade.' },
  maxDrawdown: { label: 'Max drawdown', what: 'The biggest drop from a high point in your account to the low that followed.', good: 'Keep it well under your prop firm\'s max-loss limit — ideally under half of it.' },
  greenDays: { label: 'Green / red days', what: 'Days that ended in profit vs. days that ended in a loss.', good: 'More green days than red means you are consistent, not relying on one lucky day.' },
  bestWorstDay: { label: 'Best / worst day', what: 'Your single most profitable and most losing day.', good: 'Your worst day should not erase more than 2–3 good days.' },
  largest: { label: 'Largest win / loss', what: 'The single biggest winning and losing trade.', good: 'A largest loss far bigger than your average loss usually means a stop was moved or skipped.' },
  totalTrades: { label: 'Trades', what: 'Number of closed trades in the selected period.', good: 'You need ~30+ trades before any number here is reliable.' },
  discipline: { label: 'Discipline score', what: 'How often you followed your pre-market plan and took A/B-grade setups (from your checklist).', good: '80+ is strong. It needs graded trades and daily plans — with little data it is not meaningful.' },
  adherence: { label: 'Plan adherence', what: 'Days you marked "followed my plan" in Pre-market, out of all days you answered.', good: '80%+ of days.' },
  gradeA: { label: 'A-grade trades', what: 'Trades you graded A — the setups that pass every checklist gate.', good: 'Most of your trades should be A or B.' },
  gradeC: { label: 'C-grade trades', what: 'Trades you graded C — the checklist says these are "no trade".', good: 'Close to 0%. C trades are usually where accounts bleed.' },
  setupExpectancy: { label: 'Expectancy per trade', what: 'Average $ you make on one trade of this setup.', good: 'Positive, with at least ~20 trades behind it.' },
  emotionCost: { label: 'Emotion cost', what: 'Total P&L of trades you tagged with this feeling.', good: 'Negative emotions (revenge, FOMO, tilt) should shrink over time.' },
  kelly: { label: 'Kelly %', what: 'A formula that suggests what % of the account to risk per trade, from your win rate and win/loss size.', good: 'Most traders use ¼ of Kelly or less. A negative Kelly means the strategy has no edge yet.' },
  circuitBreaker: { label: 'Circuit breaker', what: 'Green = keep trading, yellow = slow down, red = stop for the day (based on your loss limits).', good: 'Stays green. If it turns red, stop trading — that is the rule.' },
  passRate: { label: 'Pass rate', what: 'Share of challenge attempts you passed.', good: 'Track it over time; one pass means more than many quick resets.' },
};
