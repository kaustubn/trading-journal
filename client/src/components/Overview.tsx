import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { num, money, currencySymbol } from '../utils/format';
import { Settings2, X, LineChart } from 'lucide-react';
import { InfoTip, EmptyState } from './ui';
import '../styles/Overview.css';

interface OverviewProps {
  token: string;
  account_id: number;
  from?: string | null;
  to?: string | null;
  attempt?: number | null;
}

function EquityCurve({ data }: { data: { date: string; cumulative: number }[] }) {
  if (!data || data.length < 2) {
    return <div className="eq-empty">Not enough data for an equity curve yet.</div>;
  }
  const W = 900, H = 220, pad = 8;
  const xs = data.map((_, i) => i);
  const ys = data.map(d => d.cumulative);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 0);
  const rangeY = maxY - minY || 1;
  const x = (i: number) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - minY) / rangeY) * (H - pad * 2);

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.cumulative).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(data.length - 1).toFixed(1)} ${y(minY).toFixed(1)} L ${x(0).toFixed(1)} ${y(minY).toFixed(1)} Z`;
  const zeroY = y(0);
  const last = data[data.length - 1].cumulative;
  const up = last >= 0;
  const stroke = up ? '#22c55e' : '#ef4444';

  return (
    <svg className="eq-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="4 4" />
      <path d={area} fill="url(#eqfill)" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function scoreColor(v: number) {
  if (v >= 80) return '#22c55e';
  if (v >= 70) return '#84cc16';
  if (v >= 55) return '#eab308';
  if (v >= 40) return '#f59e0b';
  return '#ef4444';
}

function ScoreCard({ score }: { score: any }) {
  if (!score) return null;
  const R = 52, C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(100, score.total));
  const col = scoreColor(pct);
  return (
    <div className="ov-score">
      <div className="ov-score-gauge">
        <svg viewBox="0 0 130 130" className="ov-score-svg">
          <circle cx="65" cy="65" r={R} fill="none" stroke="var(--raised-2)" strokeWidth="11" />
          <circle cx="65" cy="65" r={R} fill="none" stroke={col} strokeWidth="11" strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * C} ${C}`} transform="rotate(-90 65 65)" />
          <text x="65" y="60" textAnchor="middle" className="ov-score-num" fill={col}>{score.total}</text>
          <text x="65" y="82" textAnchor="middle" className="ov-score-grade">{score.grade}</text>
        </svg>
      </div>
      <div className="ov-score-parts">
        <div className="ov-score-title">Performance score <InfoTip term="score" align="left" /></div>
        {score.parts.map((p: any) => (
          <div key={p.key} className="ov-score-row">
            <span className="ov-score-plabel">{p.label}</span>
            <div className="ov-score-bar"><div className="ov-score-fill" style={{ width: `${p.val}%`, background: scoreColor(p.val) }} /></div>
            <span className="ov-score-pval">{p.val}</span>
            <span className="ov-score-w">{p.weight}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Overview({ token, account_id, from, to, attempt }: OverviewProps) {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editCost, setEditCost] = useState(false);
  const [costInput, setCostInput] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (attempt) params.set('attempt', String(attempt));
      const res = await axios.get(`/api/overview/${account_id}?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      setD(res.data.data);
      setCostInput(String(res.data.data?.costPerTrade ?? ''));
    } catch { setD(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [account_id, from, to, attempt]);

  const saveCost = async () => {
    try {
      await axios.put(`/api/accounts/${account_id}/cost`, { cost_per_trade: parseFloat(costInput) || 0 },
        { headers: { Authorization: `Bearer ${token}` } });
      setEditCost(false);
      load();
    } catch (e) { console.error(e); }
  };

  if (loading) return <div className="overview loading">Loading overview…</div>;
  if (!d || !d.hasData) {
    return (
      <EmptyState icon={LineChart} title="No trades in this view yet">
        Import a broker CSV or click <b>Add trade</b> in the top bar. If you picked a date range or a run above, try <b>All time</b>.
      </EmptyState>
    );
  }

  const pf = num(d.profitFactor);
  const sym = currencySymbol();
  return (
    <div className="overview">
      <div className="ov-kpis">
        <div className="ov-kpi big">
          <div className="ov-label">{num(d.costPerTrade) > 0 ? 'Net P&L (after charges)' : 'Net P&L'}<InfoTip term="netPnl" align="left" /></div>
          <div className={`ov-value ${num(d.netAfterCharges) >= 0 ? 'positive' : 'negative'}`}>{money(d.netAfterCharges, 0)}</div>
          <div className="ov-sub">
            {num(d.costPerTrade) > 0
              ? <>gross {money(d.grossPnl, 0)} − {money(d.charges, 0)} charges</>
              : <>{num(d.totalTrades).toLocaleString()} trades · {d.tradingDays} days</>}
          </div>
        </div>
        <div className="ov-kpi">
          <div className="ov-label">Win rate<InfoTip term="winRate" /></div>
          <div className="ov-value">{num(d.winRate).toFixed(1)}%</div>
          <div className="ov-sub">{num(d.wins).toLocaleString()} won · {num(d.losses).toLocaleString()} lost</div>
        </div>
        <div className="ov-kpi">
          <div className="ov-label">Profit factor<InfoTip term="profitFactor" /></div>
          <div className={`ov-value ${pf >= 1 ? 'positive' : 'negative'}`}>{pf >= 999 ? '∞' : pf.toFixed(2)}</div>
          <div className="ov-sub">{pf >= 1.5 ? 'Healthy (1.5+)' : pf >= 1 ? 'Profitable, thin edge' : 'Below 1.0 = losing'}</div>
        </div>
        <div className="ov-kpi">
          <div className="ov-label">Expectancy<InfoTip term="expectancy" /></div>
          <div className={`ov-value ${num(d.expectancy) >= 0 ? 'positive' : 'negative'}`}>{money(d.expectancy, 0)}</div>
          <div className="ov-sub">per trade{d.avgR !== null ? ` · ${num(d.avgR).toFixed(2)}R avg` : ''}</div>
        </div>
        <div className="ov-kpi">
          <div className="ov-label">Streak<InfoTip term="streak" align="right" /></div>
          <div className={`ov-value ${d.streakType === 'win' ? 'positive' : d.streakType === 'loss' ? 'negative' : ''}`}>
            {d.streak}{d.streakType === 'win' ? 'W' : d.streakType === 'loss' ? 'L' : ''}
          </div>
          <div className="ov-sub">{d.streakType === 'win' ? 'wins in a row' : d.streakType === 'loss' ? 'losses in a row' : 'current run'}</div>
        </div>
      </div>

      <div className="ov-row">
        <div className="ov-curve">
          <div className="ov-curve-head">
            <h3>Equity curve <span className="ov-curve-note">cumulative P&L by day</span></h3>
            <div className="ov-cost">
              {editCost ? (
                <>
                  <span>Charges {sym}/trade:</span>
                  <input type="number" value={costInput} onChange={e => setCostInput(e.target.value)}
                    placeholder="e.g. 4" style={{ width: 80 }} />
                  <button className="ov-cost-save" onClick={saveCost}>Save</button>
                  <button className="ov-cost-cancel" onClick={() => setEditCost(false)} aria-label="Cancel"><X className="ic-sm" /></button>
                </>
              ) : (
                <button className="ov-cost-btn" onClick={() => setEditCost(true)} title="Commissions + fees per trade, subtracted from Net P&L">
                  <Settings2 className="ic-sm" /> {num(d.costPerTrade) > 0 ? `${sym}${num(d.costPerTrade)}/trade charges` : 'Set charges per trade'}
                </button>
              )}
            </div>
          </div>
          <EquityCurve data={d.equityCurve} />
        </div>
        {d.score && <ScoreCard score={d.score} />}
      </div>

      <div className="ov-mini">
        <div className="ov-mini-card positive-b">
          <span className="m-label">Best day<InfoTip term="bestWorstDay" align="left" /></span>
          <span className="m-value positive">{money(d.bestDay?.pnl, 0)}</span>
          <span className="m-sub">{d.bestDay?.date}</span>
        </div>
        <div className="ov-mini-card negative-b">
          <span className="m-label">Worst day</span>
          <span className="m-value negative">{money(d.worstDay?.pnl, 0)}</span>
          <span className="m-sub">{d.worstDay?.date}</span>
        </div>
        <div className="ov-mini-card">
          <span className="m-label">Largest win<InfoTip term="largest" /></span>
          <span className="m-value positive">{money(d.largestWin, 0)}</span>
        </div>
        <div className="ov-mini-card">
          <span className="m-label">Largest loss</span>
          <span className="m-value negative">{money(d.largestLoss, 0)}</span>
        </div>
        <div className="ov-mini-card">
          <span className="m-label">Avg win / loss<InfoTip term="payoff" /></span>
          <span className="m-value">{money(d.avgWin, 0)} / {money(d.avgLoss, 0)}</span>
        </div>
        <div className="ov-mini-card">
          <span className="m-label">Green / red days<InfoTip term="greenDays" align="right" /></span>
          <span className="m-value">{d.winningDays} / {d.losingDays}</span>
        </div>
      </div>
    </div>
  );
}
