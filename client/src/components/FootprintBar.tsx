// Small floating bar shown while the Footprint indicator is on: which New York session has
// order-flow data, what a missing one costs, and a Load button. It follows the replay date.
// Nothing is bought without a click: the server asks Databento for the price first (free)
// and refuses anything above its caps (see src/bars/footprint.ts).
import { useEffect, useState } from 'react';
import axios from 'axios';
import { Floating } from './ChartDialogs';
import { addFootprintDay, hasFootprintDay, FpDay } from '../chart/footprint';

interface Status {
  day: string; configured: boolean; cached: boolean; contract?: string | null; cost?: number | null;
  maxUsd?: number; spent24h?: number; dayUsd?: number; spentTotal?: number; totalUsd?: number; message?: string; fake?: boolean;
}

export default function FootprintBar({ auth, day, onDay, onLoaded, replay }: {
  auth: () => { headers: { Authorization: string } };
  day: string; onDay: (d: string) => void; onLoaded: () => void;
  replay: boolean;   // data is only bought from Replay (backtesting); days already bought show anywhere
}) {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const weekend = [0, 6].includes(new Date(day + 'T12:00:00Z').getUTCDay());

  // the day changed (replay moved, or picked by hand): use the cache, else ask the price (free)
  useEffect(() => {
    let dead = false;
    setMsg(''); setSt(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || weekend) return;
    if (hasFootprintDay(day)) { setSt({ day, configured: true, cached: true }); return; }
    (async () => {
      try {
        const r = await axios.get('/api/bars/footprint', { ...auth(), params: { day, cost: 1 } });
        if (dead) return;
        if (r.data.data) { addFootprintDay(r.data.data as FpDay); onLoaded(); }
        setSt(r.data.status);
      } catch (e: any) {
        if (!dead) setMsg(e?.response?.data?.error || 'Could not reach the server.');
      }
    })();
    return () => { dead = true; };
  }, [day]);

  const load = async () => {
    if (!st || st.cost == null) return;
    setBusy(true); setMsg('');
    try {
      const r = await axios.post('/api/bars/footprint', { day, confirmUsd: st.cost, replay }, auth());
      addFootprintDay(r.data.data as FpDay); onLoaded();
      setSt({ ...st, cached: true });
    } catch (e: any) {
      setMsg(e?.response?.data?.error || 'Loading failed.');
    } finally { setBusy(false); }
  };

  let body: React.ReactNode;
  if (weekend) body = <span className="mc-dim">Weekend: no New York session.</span>;
  else if (msg) body = <span className="mc-bad">{msg}</span>;
  else if (!st) body = <span className="mc-dim">Checking…</span>;
  else if (st.cached) body = <span className="mc-up">✓ Loaded{st.fake ? ' (TEST DATA)' : ''}<span className="mc-dim"> · zoom in (wide candles) for the numbers; only 9:30–16:00 ET candles have it</span></span>;
  else if (!st.configured) body = <span className="mc-dim">Needs a Databento key on the server (DATABENTO_API_KEY).</span>;
  else if (st.message) body = <span className="mc-bad">{st.message}</span>;
  else if (!replay) body = <span className="mc-dim">Not loaded. Footprint data is bought only in Replay (backtesting): start a replay on this day.</span>;
  else if (st.cost == null) body = <span className="mc-dim">No price from Databento.</span>;
  else {
    const over = (st.maxUsd != null && st.cost > st.maxUsd) || (st.totalUsd != null && (st.spentTotal ?? 0) + st.cost > st.totalUsd);
    body = (
      <>
        <span className="mc-dim">{st.contract} 9:30–16:00 ET · ${st.cost.toFixed(2)} of credit{st.totalUsd ? ` · footprint budget $${(st.spentTotal ?? 0).toFixed(2)} of $${st.totalUsd.toFixed(0)} used` : ''}</span>
        <button className="mc-btn mc-primary mc-small" disabled={busy || over} onClick={load} title={over ? `Above the $${st.maxUsd?.toFixed(2)} per-day limit` : 'Buy this session from Databento and keep it'}>
          {busy ? 'Loading…' : `Load ($${st.cost.toFixed(2)})`}
        </button>
      </>
    );
  }

  return (
    <Floating id="fp-bar" bare initial={{ x: 200, y: 64 }} className="mc-fp-float">
      <div className="mc-fp">
        <b>Footprint</b>
        <input className="mc-input mc-small" type="date" value={day} onChange={e => e.target.value && onDay(e.target.value)} title="New York session to show" />
        {body}
      </div>
    </Floating>
  );
}
