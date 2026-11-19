// Record a strategy found by an AI backtest into the AI Trade Book (every trade replayed with entry, management,
// exit and confluence; saved in the journal account "AI Playbook").
// Usage: DATABASE_URL=... npx ts-node scripts/record_tradebook.ts <strategy.json> <userId>
// strategy.json: { "ruleKey": "my-rule-v1", "name": "...", "rule": "...", "source": "...",
//   "stats": { "n", "tStat", "val": {avgR}, "hold": {n, avgR}, "maxDdR", "maxLosingStreak", "perDay" },
//   "trades": [ { "date": "YYYY-MM-DD", "entryMin": <minutes after 9:30 ET>, "dir": 1|-1, "stopPts": <pt>, "targetR": 2,
//                 "holdMin": <max minutes>, "refR": <the backtest's net R, optional> } ] }
import fs from 'fs';
import pool from '../src/db';
import { recordStrategy } from '../src/patterns/tradeBook';

(async () => {
  const [file, user] = process.argv.slice(2);
  if (!file || !user) { console.error('Usage: record_tradebook.ts <strategy.json> <userId>'); process.exit(1); }
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = await recordStrategy({ userId: Number(user), source: j.source || 'AI research', ruleKey: 'custom:' + j.ruleKey, name: j.name, rule: j.rule, stats: { n: j.trades.length, ...j.stats }, trades: j.trades });
  console.log(`Recorded ${r.trades} trades, status ${r.status}, replay match ${r.replayMatch == null ? 'n/a' : Math.round(r.replayMatch * 1000) / 10 + '%'}`);
  for (const c of r.gate.checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'} ${c.name} (${c.value})`);
  await pool.end();
})().catch(async e => { console.error(e.message); await pool.end(); process.exit(1); });
