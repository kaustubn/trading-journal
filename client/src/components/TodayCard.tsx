// Dashboard card: what matters today before you trade — next high-impact releases with a countdown and what NQ
// usually does, big-tech earnings this week, and an NQ / ES / VIX snapshot with the overnight gap.
import { useEffect, useState } from 'react';
import axios from 'axios';
import { Sunrise } from 'lucide-react';
import { useCalendar, useEarnings, until, localTime } from './EconCalendar';
import '../styles/Habits.css';

const fmt = (n: number | null | undefined, d = 2) => (n == null ? '–' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const sg = (n: number | null | undefined, d = 2) => (n == null ? '' : `${n >= 0 ? '+' : ''}${fmt(n, d)}`);

export function usePremarket(token: string) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const load = () => axios.get('/api/calendar/premarket', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setData(r.data); setErr(''); }).catch(e => setErr(e?.response?.data?.error || 'Market snapshot unavailable.'));
    load();
    const t = window.setInterval(load, 2 * 60000);
    return () => window.clearInterval(t);
  }, [token]);
  return { data, err };
}

export default function TodayCard({ token, onNavigate, isAdmin }: { token: string; onNavigate?: (v: string) => void; isAdmin: boolean }) {
  const { events } = useCalendar(token, 3, 0, 'high');
  const earnings = useEarnings(token);
  const { data: pm, err } = usePremarket(token);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(t); }, []);
  const upcoming = (events || []).filter(e => Date.parse(e.release_utc) > now - 30 * 60000).slice(0, 5);
  const q = (s: string) => pm?.data?.quotes?.find((x: any) => x.sym === s);
  const nq = q('NQ=F'), es = q('ES=F'), vix = q('^VIX'), lv = pm?.data?.nq;
  const weekEnd = new Date(now + 7 * 86400000).toISOString().slice(0, 10);
  const soonEarn = (earnings?.events || []).filter(e => e.day <= weekEnd);
  return (
    <div className="hb-card">
      <h3><Sunrise size={16} /> Today before you trade
        <span className="hb-row" style={{ marginLeft: 'auto' }}>
          <button className="hb-btn" onClick={() => onNavigate?.('premarket')}>Pre-market</button>
          {isAdmin && <button className="hb-btn" onClick={() => onNavigate?.('news')}>Full calendar</button>}
        </span>
      </h3>
      <div className="hb-grid">
        <div className="hb-block">
          <div className="hb-dim">High-impact releases (next 3 days)</div>
          {events === null ? <div className="hb-dim">Loading…</div> : !upcoming.length ? <div className="hb-dim" style={{ marginTop: 4 }}>None in the calendar. {isAdmin ? 'Import this week\'s ForexFactory export on the News page.' : ''}</div> : upcoming.map((e, i) => (
            <div key={e.id} style={{ marginTop: 6 }}>
              <div className="hb-between"><span><span className="hb-imp high" />{e.title}</span><span className={i === 0 ? 'hb-warn' : 'hb-dim'}>{until(Date.parse(e.release_utc) - now)}</span></div>
              <div className="hb-dim">{e.ny_time} NY ({localTime(e.release_utc)} yours){e.forecast ? ` · f ${e.forecast}` : ''}{e.actual ? ` · actual ${e.actual}` : ''}{e.nq ? ` · NQ median ${e.nq.absMed15.toFixed(0)} pts / 15 min` : ''}</div>
            </div>
          ))}
        </div>
        <div className="hb-block">
          <div className="hb-dim">NQ snapshot {nq?.session === 'futures' ? '' : ''}</div>
          {err && !pm ? <div className="hb-dim">{err}</div> : !pm ? <div className="hb-dim">Loading…</div> : (
            <>
              <div className="hb-between" style={{ marginTop: 4 }}>
                <span className="hb-big">{fmt(nq?.last)}</span>
                <span className={nq?.chg >= 0 ? 'hb-up' : 'hb-down'}>{sg(nq?.chg)} ({sg(nq?.chgPct)}%)</span>
              </div>
              <div className="hb-dim">ES {sg(es?.chgPct)}% · VIX {fmt(vix?.last)} ({sg(vix?.chg)})</div>
              {lv?.rthClose != null && <div className="hb-dim">Yesterday NY: H {fmt(lv.rthHigh)} L {fmt(lv.rthLow)} C {fmt(lv.rthClose)} · overnight H {fmt(lv.onHigh)} L {fmt(lv.onLow)} · gap {sg(lv.gap)} pts</div>}
              <div className="hb-dim" style={{ fontSize: 11.5 }}>Delayed (Yahoo, ~10 min).</div>
            </>
          )}
        </div>
        <div className="hb-block">
          <div className="hb-dim">Big-tech earnings (next 7 days)</div>
          {!earnings ? <div className="hb-dim">Loading…</div> : !soonEarn.length ? <div className="hb-dim" style={{ marginTop: 4 }}>None this week.</div> : soonEarn.map(e => (
            <div key={e.symbol + e.day} className="hb-between" style={{ marginTop: 4 }}><b>{e.symbol}</b><span className="hb-dim">{e.day.slice(5)} · {e.timing ?? '?'}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}
