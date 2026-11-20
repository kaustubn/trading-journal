// Prop-firm breach warning on every page for the selected account / challenge run.
import { useEffect, useState } from 'react';
import axios from 'axios';
import { OctagonX, AlertTriangle } from 'lucide-react';
import { money } from '../utils/format';
import '../styles/NewsAnalyzer.css';

export default function PropBreachBanner({ token, accountId, attempt }: { token: string; accountId: number | null; attempt?: number | null }) {
  const [s, setS] = useState<any>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick(x => x + 1), 2 * 60000);
    const f = () => setTick(x => x + 1);
    window.addEventListener('focus', f);
    return () => { window.clearInterval(t); window.removeEventListener('focus', f); };
  }, []);
  useEffect(() => {
    if (!accountId) { setS(null); return; }
    axios.get(`/api/accounts/${accountId}/prop-status`, { headers: { Authorization: `Bearer ${token}` }, params: { attempt: attempt || undefined } })
      .then(r => setS(r.data?.data)).catch(() => setS(null));
  }, [accountId, attempt, token, tick]);
  if (!s?.configured) return null;
  const dailyLow = s.dailyLossLimit && s.dailyHeadroom != null && !s.dailyBreached && s.dailyHeadroom < 0.25 * s.dailyLossLimit;
  if (s.drawdownBreached || s.dailyBreached) {
    return (
      <div className="nb nb-active" role="alert"><OctagonX className="ic-sm" />
        <span><b>{s.drawdownBreached ? 'Max drawdown breached' : 'Daily loss limit hit'}</b> on this account{s.dailyBreached && !s.drawdownBreached ? ' — stop trading for today' : ''}.</span>
      </div>
    );
  }
  if (s.bufferLevel !== 'danger' && !dailyLow) return null;
  return (
    <div className="nb nb-active" role="alert"><AlertTriangle className="ic-sm" />
      <span>
        {s.bufferLevel === 'danger' && <><b>{money(s.drawdownHeadroom, 0)}</b> left before the drawdown floor{s.avgLoss < 0 ? ` (≈${Math.max(0, Math.floor(s.drawdownHeadroom / Math.abs(s.avgLoss)))} average losses)` : ''}. </>}
        {dailyLow && <><b>{money(s.dailyHeadroom, 0)}</b> left of today's loss limit.</>}
      </span>
    </div>
  );
}
