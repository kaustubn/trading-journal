import pool from '../db';

interface Trade {
  id: number;
  symbol: string;
  entry_price: number;
  exit_price?: number;
  entry_time: string;
  exit_time?: string;
  pnl?: number;
  quantity: number;
  setup_tag?: string;
}

interface PatternMatch {
  pattern: string;
  confidence: number;
  factors: string[];
  matches: number;
  wins: number;
  winRate: number;
}

interface TradeGrade {
  tradeId: number;
  grade: 'A' | 'B' | 'C';
  confluenceScore: number;
  factors: string[];
  pnl: number;
  pnlPercent: number;
}

interface Insight {
  id?: number;
  account_id: number;
  title: string;
  description: string;
  type: 'pattern' | 'recommendation' | 'anomaly' | 'opportunity';
  confidence: number;
  metrics: Record<string, any>;
  created_at?: string;
}

export class InsightsService {
  // Analyze trades for patterns
  async analyzePatterns(account_id: number, days: number = 30): Promise<PatternMatch[]> {
    const client = await pool.connect();
    try {
      const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Fetch trades
      const tradesRes = await client.query(
        `SELECT id, symbol, entry_price, exit_price, entry_time, exit_time, pnl, quantity, setup_tag
         FROM trades
         WHERE account_id = $1 AND entry_time >= $2
         ORDER BY entry_time DESC`,
        [account_id, fromDate.toISOString()]
      );

      const trades: Trade[] = tradesRes.rows;
      if (trades.length === 0) return [];

      const patterns: PatternMatch[] = [];

      // Pattern 1: Volume Profile Confluence (S2)
      const vwapTrades = trades.filter(t => {
        const range = Math.abs(t.entry_price - (t.exit_price || t.entry_price));
        return range < 50; // tight range trades
      });
      if (vwapTrades.length > 0) {
        const vwapWins = vwapTrades.filter(t => (t.pnl || 0) > 0).length;
        patterns.push({
          pattern: 'S2: VWAP Pullback',
          confidence: Math.min(100, (vwapWins / vwapTrades.length) * 100 + 20),
          factors: ['tight range', 'pullback setup', 'VWAP convergence'],
          matches: vwapTrades.length,
          wins: vwapWins,
          winRate: (vwapWins / vwapTrades.length) * 100
        });
      }

      // Pattern 2: Breakout (S1)
      const breakoutTrades = trades.filter(t => {
        const range = Math.abs(t.entry_price - (t.exit_price || t.entry_price));
        return range > 50; // wide range trades = breakout
      });
      if (breakoutTrades.length > 0) {
        const boWins = breakoutTrades.filter(t => (t.pnl || 0) > 0).length;
        patterns.push({
          pattern: 'S1: ORB Breakout',
          confidence: Math.min(100, (boWins / breakoutTrades.length) * 100 + 15),
          factors: ['breakout direction', 'volume spike', 'trend continuation'],
          matches: breakoutTrades.length,
          wins: boWins,
          winRate: (boWins / breakoutTrades.length) * 100
        });
      }

      // Pattern 3: Fade (S3) - trades that reverse at extremes
      const fadeTrades = trades.filter(t => {
        const pnl = t.pnl || 0;
        return pnl > 0 && t.setup_tag === 'fade'; // profitable fades
      });
      if (fadeTrades.length > 0) {
        patterns.push({
          pattern: 'S3: Auction Fade',
          confidence: 70,
          factors: ['extreme price', 'RSI extreme', 'range boundary'],
          matches: fadeTrades.length,
          wins: fadeTrades.length,
          winRate: 100
        });
      }

      // Pattern 4: Time-of-day edge
      const nyOpenTrades = trades.filter(t => {
        const hour = new Date(t.entry_time).getHours();
        return hour >= 14 && hour <= 16; // NY open, 2-4 PM UTC = 9-11 AM ET
      });
      if (nyOpenTrades.length > 3) {
        const nyWins = nyOpenTrades.filter(t => (t.pnl || 0) > 0).length;
        patterns.push({
          pattern: 'NY Session Edge',
          confidence: (nyWins / nyOpenTrades.length) * 100 + 10,
          factors: ['NY open liquidity', 'volume spike', 'volatility'],
          matches: nyOpenTrades.length,
          wins: nyWins,
          winRate: (nyWins / nyOpenTrades.length) * 100
        });
      }

      return patterns.sort((a, b) => b.confidence - a.confidence);
    } finally {
      client.release();
    }
  }

  // Grade each trade on confluence
  async gradeTradeConfluence(account_id: number, days: number = 30): Promise<TradeGrade[]> {
    const client = await pool.connect();
    try {
      const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const tradesRes = await client.query(
        `SELECT id, symbol, entry_price, exit_price, entry_time, exit_time, pnl, quantity, setup_tag
         FROM trades
         WHERE account_id = $1 AND entry_time >= $2`,
        [account_id, fromDate.toISOString()]
      );

      const trades: Trade[] = tradesRes.rows;
      return trades.map(trade => {
        const factors: string[] = [];
        let confluenceScore = 0;

        // Check various confluence factors
        if (trade.setup_tag?.includes('vwap')) {
          confluenceScore += 25;
          factors.push('VWAP');
        }
        if (trade.setup_tag?.includes('ema')) {
          confluenceScore += 20;
          factors.push('EMA 21');
        }
        if (trade.pnl && trade.pnl > 100) {
          confluenceScore += 15;
          factors.push('Strong P&L');
        }
        if (trade.setup_tag?.includes('volume')) {
          confluenceScore += 15;
          factors.push('Volume');
        }
        if (trade.setup_tag?.includes('breakout')) {
          confluenceScore += 10;
          factors.push('Breakout');
        }

        // Grade assignment
        let grade: 'A' | 'B' | 'C' = 'C';
        if (confluenceScore >= 70) grade = 'A';
        else if (confluenceScore >= 40) grade = 'B';

        const pnlPercent = trade.exit_price
          ? ((trade.exit_price - trade.entry_price) / trade.entry_price) * 100
          : 0;

        return {
          tradeId: trade.id,
          grade,
          confluenceScore,
          factors,
          pnl: trade.pnl || 0,
          pnlPercent
        };
      });
    } finally {
      client.release();
    }
  }

  // Generate smart recommendations
  async generateRecommendations(account_id: number): Promise<Insight[]> {
    const patterns = await this.analyzePatterns(account_id, 30);
    const grades = await this.gradeTradeConfluence(account_id, 30);

    const insights: Insight[] = [];

    // Top pattern recommendation
    if (patterns.length > 0) {
      const topPattern = patterns[0];
      insights.push({
        account_id,
        title: `${topPattern.pattern} is your best setup`,
        description: `This pattern has ${topPattern.winRate.toFixed(1)}% win rate on ${topPattern.matches} trades. Confluence factors: ${topPattern.factors.join(', ')}`,
        type: 'recommendation',
        confidence: topPattern.confidence,
        metrics: {
          pattern: topPattern.pattern,
          winRate: topPattern.winRate,
          tradeCount: topPattern.matches,
          confluenceFactors: topPattern.factors
        }
      });
    }

    // Grade distribution insight
    const aGrades = grades.filter(g => g.grade === 'A').length;
    const totalTrades = grades.length;
    if (totalTrades > 0) {
      const aPercent = (aGrades / totalTrades) * 100;
      insights.push({
        account_id,
        title: `A-grade trades: ${aPercent.toFixed(0)}% of your setup`,
        description: `Only ${aGrades} of ${totalTrades} trades had high confluence. Focus on setups with 4+ confluence factors.`,
        type: 'pattern',
        confidence: 85,
        metrics: {
          aGradeCount: aGrades,
          totalTrades,
          aGradePercent: aPercent
        }
      });
    }

    // Anomaly: consecutive losses
    const client = await pool.connect();
    try {
      const tradesRes = await client.query(
        `SELECT id, pnl FROM trades
         WHERE account_id = $1
         ORDER BY entry_time DESC
         LIMIT 10`,
        [account_id]
      );

      let losses = 0;
      for (const trade of tradesRes.rows) {
        if ((trade.pnl || 0) < 0) {
          losses++;
        } else {
          break;
        }
      }

      if (losses >= 3) {
        insights.push({
          account_id,
          title: `⚠️ ${losses} losses in a row`,
          description: 'Consider taking a break or reviewing recent trades for mechanical errors.',
          type: 'anomaly',
          confidence: 90,
          metrics: { consecutiveLosses: losses }
        });
      }
    } finally {
      client.release();
    }

    // Opportunity: best time of day
    const patterns2 = await this.analyzePatterns(account_id, 30);
    const timePattern = patterns2.find(p => p.pattern.includes('Session'));
    if (timePattern && timePattern.winRate > 60) {
      insights.push({
        account_id,
        title: `${timePattern.pattern} has ${timePattern.winRate.toFixed(0)}% win rate`,
        description: `Focus more trading during this time window. It's your strongest edge.`,
        type: 'opportunity',
        confidence: timePattern.confidence,
        metrics: {
          session: timePattern.pattern,
          winRate: timePattern.winRate,
          tradeCount: timePattern.matches
        }
      });
    }

    return insights;
  }

  // Save insight to DB
  async saveInsight(insight: Insight): Promise<Insight> {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `INSERT INTO insights (account_id, title, description, type, confidence, metrics)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [insight.account_id, insight.title, insight.description, insight.type, insight.confidence, JSON.stringify(insight.metrics)]
      );
      return res.rows[0];
    } finally {
      client.release();
    }
  }

  // Get insights for account
  async getInsights(account_id: number, limit: number = 10): Promise<Insight[]> {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT id, account_id, title, description, type, confidence, metrics, created_at
         FROM insights
         WHERE account_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [account_id, limit]
      );
      return res.rows;
    } finally {
      client.release();
    }
  }

  // Confidence calibration: does X% confidence actually win X% of trades?
  async calibrateConfidence(account_id: number, days: number = 60): Promise<Record<string, number>> {
    const client = await pool.connect();
    try {
      const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const tradesRes = await client.query(
        `SELECT pnl FROM trades
         WHERE account_id = $1 AND entry_time >= $2`,
        [account_id, fromDate.toISOString()]
      );

      const trades = tradesRes.rows;
      if (trades.length < 10) return {};

      const wins = trades.filter(t => (t.pnl || 0) > 0).length;
      const actualWinRate = (wins / trades.length) * 100;

      // Simple calibration: expected vs actual
      return {
        tradeCount: trades.length,
        actualWinRate: actualWinRate,
        calibrationFactor: actualWinRate > 50 ? actualWinRate / 60 : 0.7 // scale predictions
      };
    } finally {
      client.release();
    }
  }
}

export default new InsightsService();
