// Pre-market panel (top of the Pre-Market / daily plan page): market context in one look — NQ levels from
// yesterday's New York session and the overnight range, ES / VIX / dollar / 10-year / oil, the biggest NQ stocks
// in pre-market, today's releases and earnings. Free delayed data; refreshes every 2 minutes.
import { Activity } from 'lucide-react';
import { usePremarket } from './TodayCard';
import { useCalendar, useEarnings, localTime } from './EconCalendar';
import '../styles/Habits.css';

const fmt = (n: number | null | undefined, d = 2) => (n == null ? '–' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const sg = (n: number | null | undefined, d = 2) => (n == null ? '' : `${n >= 0 ? '+' : ''}${fmt(n, d)}`);

export default function PremarketPanel({ token }: { token: string }) {
  const { data, err } = usePremarket(token);
  const { events } = useCalendar(token, 1, 0, 'high,medium');
  const earnings = useEarnings(token);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const todays = (events || []).filter(e => e.ny_date === today);
  const lv = data?.data?.nq;
  const quotes: any[] = data?.data?.quotes || [];
  const ctx = quotes.filter(q => !/^[A-Z]{2,5}$/.test(q.sym) || q.sym === 'NQ=F');
  const stocks = quotes.filter(q => /^[A-Z]{2,5}$/.test(q.sym));
  const lines = lv ? [
    { k: 'Yesterday high', v: lv.rthHigh }, { k: 'Yesterday low', v: lv.rthLow }, { k: 'Yesterday close', v: lv.rthClose },
    { k: 'Overnight high', v: lv.onHigh }, { k: 'Overnight low', v: lv.onLow },
  ] : [];
  return (
    <div className="hb-card">
      <h3><Activity size={16} /> Market before the open <span className="hb-dim">delayed · {data?.fetchedAt ? `updated ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span></h3>
      {err && !data && <div className="hb-msg err">{err}</div>}
      {data?.stale && <div className="hb-dim">Showing the last good data ({data.stale}).</div>}
      <div className="hb-grid">
        <div className="hb-block">
          <div className="hb-dim">NQ levels</div>
          {lv ? (
            <>
              <div className="hb-between" style={{ marginTop: 4 }}><span className="hb-big">{fmt(lv.last)}</span><span className={(lv.gap ?? 0) >= 0 ? 'hb-up' : 'hb-down'}>gap {sg(lv.gap)} pts</span></div>
              {lines.map(l => (
                <div key={l.k} className="hb-between" style={{ fontSize: 13 }}><span className="hb-dim">{l.k}</span><span>{fmt(l.v)} <span className="hb-dim">({sg(l.v != null && lv.last != null ? lv.last - l.v : null)})</span></span></div>
              ))}
              <div className="hb-dim" style={{ marginTop: 4 }}>Session used: {lv.rthDay}, 9:30–16:00 New York. Gap = now vs that close.</div>
            </>
          ) : <div className="hb-dim">Loading…</div>}
        </div>
        <div className="hb-block">
          <div className="hb-dim">Today (New York time)</div>
          {events === null ? <div className="hb-dim">Loading…</div> : !todays.length ? <div className="hb-dim" style={{ marginTop: 4 }}>No high/medium US releases in the calendar today.</div> : todays.map(e => (
            <div key={e.id} style={{ marginTop: 5 }}>
              <div className="hb-between"><span><span className={`hb-imp ${e.impact}`} />{e.ny_time} {e.title}</span><span className="hb-dim">{localTime(e.release_utc)} yours</span></div>
              <div className="hb-dim">{e.forecast ? `forecast ${e.forecast}` : ''}{e.previous ? ` · previous ${e.previous}` : ''}{e.actual ? ` · actual ${e.actual}` : ''}</div>
              {e.nq && <div className="hb-nq">{e.nq.line}</div>}
            </div>
          ))}
          {(earnings?.events || []).filter(x => x.day === today).map(x => <div key={x.symbol} className="hb-warn" style={{ marginTop: 6 }}>Earnings today: {x.symbol} ({x.timing ?? 'time not given'})</div>)}
        </div>
      </div>
      <h4>Markets</h4>
      <div className="hb-quotes">
        {ctx.map(q => (
          <div key={q.sym} className="hb-quote"><div className="l">{q.label}</div><div className="v">{fmt(q.last)}</div>
            <div className={`c ${(q.chg ?? 0) >= 0 ? 'hb-up' : 'hb-down'}`}>{sg(q.chg)} ({sg(q.chgPct)}%)</div></div>
        ))}
      </div>
      <h4>Biggest NQ stocks</h4>
      <div className="hb-quotes">
        {stocks.map(q => (
          <div key={q.sym} className="hb-quote"><div className="l">{q.sym} · {q.session}</div><div className="v">{fmt(q.last)}</div>
            <div className={`c ${(q.chgPct ?? 0) >= 0 ? 'hb-up' : 'hb-down'}`}>{sg(q.chgPct)}%</div></div>
        ))}
      </div>
      <div className="hb-dim" style={{ marginTop: 8 }}>{data?.data?.note}</div>
    </div>
  );
}
