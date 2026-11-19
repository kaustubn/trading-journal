// Rule-based coach (no AI): costly habits found in this account's trades, most expensive first.
import { useEffect, useState } from 'react';
import axios from 'axios';
import { ShieldAlert } from 'lucide-react';

interface Finding { key: string; title: string; explain: string; n: number; pnl: number; avg: number; lossShare: number | null; smallSample: boolean }
const SYM: Record<string, string> = { USD: '$', INR: '₹' };

export default function CoachFindings({ token, account_id }: { token: string; account_id: number }) {
  const [data, setData] = useState<{ trades: number; currency?: string; findings: Finding[] } | null>(null);
  const sym = SYM[data?.currency || 'USD'] ?? '';
  const usd = (x: number) => `${x < 0 ? '−' : '+'}${sym}${Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const [err, setErr] = useState('');
  useEffect(() => {
    setData(null); setErr('');
    axios.get('/api/coach/findings', { headers: { Authorization: `Bearer ${token}` }, params: { account_id } })
      .then(r => setData(r.data)).catch(() => setErr('Could not check the rules.'));
  }, [token, account_id]);
  return (
    <section className="coach-section coach-findings">
      <div className="coach-sec-head"><h3><ShieldAlert className="ic-sm" /> Costly habits <span className="coach-dim">fixed rules, no AI · most expensive first</span></h3></div>
      {err ? <p className="coach-dim">{err}</p> : !data ? <p className="coach-dim">Checking {''}your trades…</p> : data.findings.length === 0 ? (
        <p className="coach-dim">None of the checked habits shows up in {data.trades} trades: size-ups after a loss, re-entries within 5 minutes of a loss, trades past the daily loss limit, overtrading, tagged rule breaks, trades inside the news window.</p>
      ) : (
        <div className="coach-find-list">
          {data.findings.map(f => (
            <div key={f.key} className={`coach-find ${f.pnl < 0 ? 'bad' : 'ok'}`}>
              <div className="coach-find-top"><b>{f.title}</b><span className={f.pnl < 0 ? 'coach-neg' : 'coach-pos'}>{usd(f.pnl)}</span></div>
              <div className="coach-dim">{f.n} trade{f.n === 1 ? '' : 's'} · average {usd(f.avg)}{f.lossShare != null && f.pnl < 0 ? ` · ${Math.round(f.lossShare * 100)}% of all your losses` : ''}{f.smallSample ? ' · small sample (under 10 trades), treat as a hint' : ''}</div>
              <div className="coach-dim">{f.explain}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
