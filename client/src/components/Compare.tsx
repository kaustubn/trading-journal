import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { num, money } from '../utils/format';
import '../styles/Compare.css';

interface Account { id: number; broker: string; account_name: string; account_type?: string; }
interface CompareProps {
  token: string;
  accounts: Account[];
}

export default function Compare({ token, accounts }: CompareProps) {
  const [aId, setAId] = useState<number | null>(null);
  const [bId, setBId] = useState<number | null>(null);
  const [a, setA] = useState<any>(null);
  const [b, setB] = useState<any>(null);
  const [aBd, setABd] = useState<any>(null);
  const [bBd, setBBd] = useState<any>(null);
  const [diag, setDiag] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Default: paper/sim as A, live as B (or first two accounts)
  useEffect(() => {
    if (accounts.length >= 1 && aId === null) {
      const paper = accounts.find(x => x.account_type === 'paper' || x.account_type === 'simulation');
      const live = accounts.find(x => x.account_type === 'live');
      setAId(paper?.id ?? accounts[0].id);
      setBId(live?.id ?? accounts[1]?.id ?? accounts[0].id);
    }
  }, [accounts]);

  const H = { headers: { Authorization: `Bearer ${token}` } };
  const loadSide = async (id: number, setOv: any, setBd: any) => {
    const [ov, bd] = await Promise.all([
      axios.get(`/api/overview/${id}`, H).then(r => r.data.data).catch(() => null),
      axios.get(`/api/breakdown/${id}`, H).then(r => r.data.data).catch(() => null),
    ]);
    setOv(ov); setBd(bd);
  };

  useEffect(() => {
    if (aId === null || bId === null) return;
    setLoading(true);
    axios.get(`/api/diagnosis?a=${aId}&b=${bId}`, H).then(r => setDiag(r.data.data)).catch(() => setDiag(null));
    Promise.all([loadSide(aId, setA, setABd), loadSide(bId, setB, setBBd)]).finally(() => setLoading(false));
  }, [aId, bId]);

  const label = (id: number | null) => accounts.find(x => x.id === id)?.account_name || '—';

  const StatRow = ({ name, av, bv, better }: { name: string; av: number; bv: number; better?: 'high' | 'low' }) => {
    const aWins = better === 'low' ? av < bv : av > bv;
    return (
      <div className="cmp-row">
        <div className={`cmp-a ${better ? (aWins ? 'win' : '') : ''}`}>{name === 'Net P&L' || name === 'Expectancy' ? money(av, 0) : name.includes('%') ? `${num(av).toFixed(1)}%` : num(av).toFixed(2)}</div>
        <div className="cmp-name">{name}</div>
        <div className={`cmp-b ${better ? (!aWins ? 'win' : '') : ''}`}>{name === 'Net P&L' || name === 'Expectancy' ? money(bv, 0) : name.includes('%') ? `${num(bv).toFixed(1)}%` : num(bv).toFixed(2)}</div>
      </div>
    );
  };

  // Instrument divergence: instruments profitable in A but losing in B (or vice versa)
  const divergences: { key: string; aPnl: number; bPnl: number }[] = [];
  if (aBd?.symbols && bBd?.symbols) {
    const bMap = new Map(bBd.symbols.map((s: any) => [s.key, s.pnl]));
    for (const s of aBd.symbols) {
      const bPnl = (bMap.get(s.key) as number) ?? null;
      if (bPnl !== null && Math.sign(s.pnl) !== Math.sign(bPnl) && (Math.abs(s.pnl) > 100 || Math.abs(bPnl) > 100)) {
        divergences.push({ key: s.key, aPnl: s.pnl, bPnl });
      }
    }
  }

  return (
    <div className="compare">
      <div className="cmp-pickers">
        <select value={aId ?? ''} onChange={e => setAId(Number(e.target.value))}>
          {accounts.map(x => <option key={x.id} value={x.id}>{x.account_name} ({x.account_type || 'live'})</option>)}
        </select>
        <span className="cmp-vs">vs</span>
        <select value={bId ?? ''} onChange={e => setBId(Number(e.target.value))}>
          {accounts.map(x => <option key={x.id} value={x.id}>{x.account_name} ({x.account_type || 'live'})</option>)}
        </select>
      </div>

      {loading && <div className="cmp-loading">Loading…</div>}

      {a?.hasData && b?.hasData ? (
        <>
          <div className="cmp-head">
            <div className="cmp-hcol">{label(aId)}</div>
            <div />
            <div className="cmp-hcol">{label(bId)}</div>
          </div>
          <div className="cmp-stats">
            <StatRow name="Net P&L" av={a.netAfterCharges} bv={b.netAfterCharges} better="high" />
            <StatRow name="Win %" av={a.winRate} bv={b.winRate} better="high" />
            <StatRow name="Profit Factor" av={a.profitFactor} bv={b.profitFactor} better="high" />
            <StatRow name="Expectancy" av={a.expectancy} bv={b.expectancy} better="high" />
            <StatRow name="Trades" av={a.totalTrades} bv={b.totalTrades} />
          </div>

          {divergences.length > 0 && (
            <div className="cmp-diverge">
              <h3>⚡ Where you flip — same instrument, opposite result</h3>
              {divergences.map(d => (
                <div key={d.key} className="cmp-div-row">
                  <span className="cmp-div-key">{d.key}</span>
                  <span className={d.aPnl >= 0 ? 'positive' : 'negative'}>{label(aId)}: {money(d.aPnl, 0)}</span>
                  <span className="cmp-arrow">→</span>
                  <span className={d.bPnl >= 0 ? 'positive' : 'negative'}>{label(bId)}: {money(d.bPnl, 0)}</span>
                </div>
              ))}
              <p className="cmp-note">These are instruments you profit on in one account but lose on in the other — your biggest fixable leak.</p>
            </div>
          )}

          {diag?.ready && diag.findings?.length > 0 && (
            <div className="cmp-diag">
              <h3>🔍 Diagnosis — what's going wrong</h3>
              <p className="cmp-diag-sub">Auto-analysis comparing <strong>{label(bId)}</strong> against <strong>{label(aId)}</strong>.</p>
              {diag.findings.map((f: any, i: number) => (
                <div key={i} className={`diag-item sev-${f.severity}`}>
                  <div className="diag-title">
                    <span className={`diag-dot sev-${f.severity}`} />
                    {f.title}
                  </div>
                  <div className="diag-detail">{f.detail}</div>
                </div>
              ))}
            </div>
          )}
          {diag?.ready && diag.findings?.length === 0 && (
            <div className="cmp-diag">
              <h3>🔍 Diagnosis</h3>
              <p className="cmp-diag-sub">No major divergences detected — your real execution tracks your paper. Keep tagging trades with setup + grade for deeper analysis.</p>
            </div>
          )}
        </>
      ) : (
        !loading && (
          <div className="cmp-empty">
            <p>Both accounts need imported trades to compare.</p>
            <p className="cmp-sub">Import your paper-trading and real-account CSVs, then come back here.</p>
          </div>
        )
      )}
    </div>
  );
}
