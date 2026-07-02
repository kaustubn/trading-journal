import axios from 'axios';

const API_URL = 'http://localhost:5000';
const TOKEN = 'test-token'; // Will use the demo user token

const DEMO_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTcxOTk1MDAwMH0.demo';

async function testStrategies() {
  try {
    console.log('\n🚀 Testing 3 Strategies on Demo Data\n');

    // Strategy 1: S1 - ORB Breakout
    console.log('📊 Creating S1: ORB Breakout Strategy...');
    const s1Res = await axios.post(
      `${API_URL}/api/strategies`,
      {
        name: 'S1: NQ ORB Breakout',
        description: 'IB breakout with volume. Works on trend days (IB < 60 pts).',
        account_id: 1,
        rules: [
          { type: 'entry', condition: 'price_above', value: 19400, description: 'Price above IB High' },
          { type: 'entry', condition: 'macd_cross', value: 0, description: 'Volume spike' },
          { type: 'exit', condition: 'price_above', value: 19450, description: 'T1: Next resistance' },
          { type: 'exit', condition: 'price_above', value: 19500, description: 'T2: Second target' },
          { type: 'stop', condition: 'price_below', value: 19370, description: 'Stop 3pts below IB' }
        ],
        enabled: true
      },
      { headers: { Authorization: `Bearer ${DEMO_TOKEN}` } }
    );
    const s1Id = s1Res.data.data.id;
    console.log(`✓ S1 created: ID ${s1Id}`);

    // Backtest S1
    console.log('\n📈 Backtesting S1 (last 30 days)...');
    const s1BacktestRes = await axios.post(
      `${API_URL}/api/strategies/${s1Id}/backtest`,
      {
        account_id: 1,
        from_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        to_date: new Date().toISOString().split('T')[0]
      },
      { headers: { Authorization: `Bearer ${DEMO_TOKEN}` } }
    );

    const s1Result = s1BacktestRes.data.data;
    console.log(`  Win Rate: ${s1Result.win_rate.toFixed(2)}%`);
    console.log(`  Total Trades: ${s1Result.total_trades}`);
    console.log(`  Total P&L: ₹${s1Result.total_pnl.toFixed(2)}`);
    console.log(`  Matched: ${s1Result.matched_trades?.length || 0} trades`);

    // Strategy 2: S2 - VWAP Pullback
    console.log('\n📊 Creating S2: VWAP Pullback Strategy...');
    const s2Res = await axios.post(
      `${API_URL}/api/strategies`,
      {
        name: 'S2: VWAP Pullback to Value',
        description: 'Buys pullbacks to VWAP in uptrend. Works on normal days (IB 60-120).',
        account_id: 1,
        rules: [
          { type: 'entry', condition: 'price_above', value: 19410, description: 'Price at VWAP' },
          { type: 'entry', condition: 'rsi_above', value: 40, description: 'RSI 40-60: moderate PB' },
          { type: 'entry', condition: 'ema_cross', value: 0, description: 'EMA 21 pointing up' },
          { type: 'exit', condition: 'price_above', value: 19450, description: 'T1: Next VAH' },
          { type: 'exit', condition: 'price_above', value: 19500, description: 'T2: Second VAH' },
          { type: 'stop', condition: 'price_below', value: 19390, description: 'Stop 3pts below VAL' }
        ],
        enabled: true
      },
      { headers: { Authorization: `Bearer ${DEMO_TOKEN}` } }
    );
    const s2Id = s2Res.data.data.id;
    console.log(`✓ S2 created: ID ${s2Id}`);

    // Backtest S2
    console.log('\n📈 Backtesting S2 (last 30 days)...');
    const s2BacktestRes = await axios.post(
      `${API_URL}/api/strategies/${s2Id}/backtest`,
      {
        account_id: 1,
        from_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        to_date: new Date().toISOString().split('T')[0]
      },
      { headers: { Authorization: `Bearer ${DEMO_TOKEN}` } }
    );

    const s2Result = s2BacktestRes.data.data;
    console.log(`  Win Rate: ${s2Result.win_rate.toFixed(2)}%`);
    console.log(`  Total Trades: ${s2Result.total_trades}`);
    console.log(`  Total P&L: ₹${s2Result.total_pnl.toFixed(2)}`);
    console.log(`  Matched: ${s2Result.matched_trades?.length || 0} trades`);

    // Strategy 3: S3 - Auction Fade
    console.log('\n📊 Creating S3: Auction Fade Strategy...');
    const s3Res = await axios.post(
      `${API_URL}/api/strategies`,
      {
        name: 'S3: Auction Fade at Extremes',
        description: 'Sells at IB High (RSI>68), buys at IB Low (RSI<32). Works on range days (IB>120).',
        account_id: 1,
        rules: [
          { type: 'entry', condition: 'rsi_above', value: 68, description: 'RSI > 68 at resistance' },
          { type: 'entry', condition: 'rsi_below', value: 32, description: 'RSI < 32 at support' },
          { type: 'entry', condition: 'price_above', value: 19430, description: 'Price at IB High/VAH' },
          { type: 'exit', condition: 'price_above', value: 19415, description: 'T1: VWAP/POC (60%)' },
          { type: 'exit', condition: 'price_above', value: 19385, description: 'T2: Opposite extreme' },
          { type: 'stop', condition: 'price_above', value: 19450, description: 'Stop 5pts beyond wick' }
        ],
        enabled: true
      },
      { headers: { Authorization: `Bearer ${DEMO_TOKEN}` } }
    );
    const s3Id = s3Res.data.data.id;
    console.log(`✓ S3 created: ID ${s3Id}`);

    // Backtest S3
    console.log('\n📈 Backtesting S3 (last 30 days)...');
    const s3BacktestRes = await axios.post(
      `${API_URL}/api/strategies/${s3Id}/backtest`,
      {
        account_id: 1,
        from_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        to_date: new Date().toISOString().split('T')[0]
      },
      { headers: { Authorization: `Bearer ${DEMO_TOKEN}` } }
    );

    const s3Result = s3BacktestRes.data.data;
    console.log(`  Win Rate: ${s3Result.win_rate.toFixed(2)}%`);
    console.log(`  Total Trades: ${s3Result.total_trades}`);
    console.log(`  Total P&L: ₹${s3Result.total_pnl.toFixed(2)}`);
    console.log(`  Matched: ${s3Result.matched_trades?.length || 0} trades`);

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 STRATEGY BACKTEST SUMMARY');
    console.log('='.repeat(70));
    console.log(`\n${s1Result.total_trades > 0 ? '✅' : '⚠️'} S1 ORB Breakout: ${s1Result.win_rate.toFixed(1)}% WR | ${s1Result.total_trades} trades | ₹${s1Result.total_pnl.toFixed(0)} P&L`);
    console.log(`${s2Result.total_trades > 0 ? '✅' : '⚠️'} S2 VWAP Pullback: ${s2Result.win_rate.toFixed(1)}% WR | ${s2Result.total_trades} trades | ₹${s2Result.total_pnl.toFixed(0)} P&L`);
    console.log(`${s3Result.total_trades > 0 ? '✅' : '⚠️'} S3 Auction Fade: ${s3Result.win_rate.toFixed(1)}% WR | ${s3Result.total_trades} trades | ₹${s3Result.total_pnl.toFixed(0)} P&L`);
    console.log('\n✅ All strategies created and backtested!\n');

  } catch (error: any) {
    console.error('\n❌ Error:', error.response?.data || error.message);
    process.exit(1);
  }
}

testStrategies();
