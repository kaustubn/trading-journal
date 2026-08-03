import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { money } from '../utils/format';
import './Emotions.css';

interface Props { token: string; account_id: number; attempt?: number | null; }
interface Row { key: string; label: string; neg: boolean; trades: number; net: number; winRate: number; avg: number; }

export default function Emotions({ token, account_id, attempt }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    axios.get(`/api/emotions/${account_id}`, { headers: { Authorization: `Bearer ${token}` }, params: { attempt: attempt || undefined } })
      .then(r => setData(r.data.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [account_id, attempt]);

  if (loading) return <div className="emo"><div className="emo-load">Loading…</div></div>;
  const rows: Row[] = data?.rows || [];
  const s = data?.summary || { total: 0, tagged: 0, untagged: 0, negNet: 0, negTradeCount: 0, posNet: 0, posTradeCount: 0 };

  const leaks = rows.filter(r => r.neg);
  const strengths = rows.filter(r => !r.neg);
  const worst = leaks.length ? leaks[0] : null; // rows sorted worst-first

  return (
    <div className="emo">
      <div className="emo-head">
        <h2>🎭 Emotions</h2>
        <p>What your feelings cost you. Tag trades with emotion chips (revenge, FOMO, disciplined…) in the trade popup, then see the damage here.</p>
      </div>

      {s.tagged === 0 ? (
        <div className="emo-empty">
          <h3>No emotion tags yet</h3>
          <p>Open any trade → tap an emotion chip (Revenge, FOMO, Disciplined…) → Save. Come back to see how much each emotion helps or hurts.</p>
        </div>
      ) : (
        <>
          {/* Headline cards */}
          <div className="emo-cards">
            <div className="emo-card bad">
              <div className="emo-card-l">Lost to negative emotion</div>
              <div className="emo-card-v">{money(s.negNet, 0)}</div>
              <div className="emo-card-s">{s.negTradeCount} trades tagged revenge/FOMO/tilt/etc.</div>
            </div>
            <div className="emo-card good">
              <div className="emo-card-l">On disciplined trades</div>
              <div className="emo-card-v">{money(s.posNet, 0)}</div>
              <div className="emo-card-s">{s.posTradeCount} trades tagged disciplined/patient/planned</div>
            </div>
            <div className="emo-card">
              <div className="emo-card-l">Biggest single leak</div>
              <div className="emo-card-v">{worst ? worst.label : '—'}</div>
              <div className="emo-card-s">{worst ? `${money(worst.net, 0)} over ${worst.trades} trades` : 'none'}</div>
            </div>
          </div>

          <div className="emo-cols">
            <div className="emo-colbox">
              <h3 className="emo-col-title bad">⚠ Leaks</h3>
              {leaks.length === 0 ? <div className="emo-none">None tagged</div> : leaks.map(r => <EmoRow key={r.key} r={r} />)}
            </div>
            <div className="emo-colbox">
              <h3 className="emo-col-title good">✅ Strengths</h3>
              {strengths.length === 0 ? <div className="emo-none">None tagged</div> : strengths.map(r => <EmoRow key={r.key} r={r} />)}
            </div>
          </div>

          <div className="emo-cov">
            Tagged {s.tagged} of {s.total} trades ({s.total ? Math.round((s.tagged / s.total) * 100) : 0}%). Tag more for a truer picture.
          </div>
        </>
      )}
    </div>
  );
}

function EmoRow({ r }: { r: Row }) {
  return (
    <div className="emo-row">
      <span className="emo-row-label">{r.label}</span>
      <span className="emo-row-trades">{r.trades}t · {r.winRate}%wr</span>
      <span className={`emo-row-net ${r.net >= 0 ? 'pos' : 'neg'}`}>{money(r.net, 0)}</span>
      <span className="emo-row-avg">{money(r.avg, 0)}/t</span>
    </div>
  );
}
