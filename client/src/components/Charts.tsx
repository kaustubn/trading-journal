import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import '../styles/Charts.css';
import { money } from '../utils/format';

interface ChartData {
  label: string;
  value: number;
  pnl?: number;
}

interface ChartsProps {
  token: string;
  account_id: number | null;
}

export default function Charts({ token, account_id, attempt }: ChartsProps & { attempt?: number | null }) {
  const [dailyPnLData, setDailyPnLData] = useState<ChartData[]>([]);
  const [monthlyPnLData, setMonthlyPnLData] = useState<ChartData[]>([]);
  const [drawdownData, setDrawdownData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeChart, setActiveChart] = useState<'daily' | 'monthly' | 'drawdown'>('daily');

  useEffect(() => {
    if (account_id) {
      fetchChartData();
    }
  }, [account_id, token, attempt]);

  const fetchChartData = async () => {
    if (!account_id) return;
    setLoading(true);
    try {
      const [dailyRes, monthlyRes] = await Promise.all([
        axios.get(`/api/analytics/daily/${account_id}`, { params: { attempt: attempt || undefined }, 
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`/api/analytics/monthly/${account_id}`, { params: { attempt: attempt || undefined }, 
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      // Process daily P&L
      const dailyChartData = (dailyRes.data.data || []).map((row: any) => ({
        label: row.date,
        value: parseFloat(row.pnl),
        pnl: parseFloat(row.pnl)
      })).reverse();
      setDailyPnLData(dailyChartData);

      // Process monthly P&L
      const monthlyChartData = (monthlyRes.data.data || []).map((row: any) => ({
        label: row.month,
        value: parseFloat(row.pnl),
        pnl: parseFloat(row.pnl)
      })).reverse();
      setMonthlyPnLData(monthlyChartData);

      // Calculate drawdown
      const drawdown = calculateDrawdown(dailyChartData);
      setDrawdownData(drawdown);
    } catch (error) {
      console.error('Error fetching chart data:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateDrawdown = (data: ChartData[]): ChartData[] => {
    let cumulative = 0;
    let peak = 0;

    return data.map((row, idx) => {
      cumulative += row.value;
      peak = Math.max(peak, cumulative);
      const drawdown = cumulative - peak;

      return {
        label: row.label,
        value: drawdown,
        pnl: drawdown
      };
    });
  };

  if (!account_id) {
    return <div className="charts empty">Select an account to view charts</div>;
  }

  if (loading) {
    return <div className="charts loading">Loading charts…</div>;
  }

  const CAPTION: Record<string, string> = {
    daily: 'Each bar is one trading day: green above the line made money, red below lost money. Look for clusters of red — they often follow a rule break.',
    monthly: 'Each bar is one month. You want more green than red, and red months smaller than green ones.',
    drawdown: 'How far below your previous high you were after each day. Shallow and short dips are what you want — deep ones are what fail prop challenges.',
  };

  return (
    <div className="charts">
      <div className="charts-header">
        <span className="scope-note">{attempt ? 'The run selected on the Dashboard' : 'All trades in this account · every run'}</span>
        <div className="chart-toggle">
          {([['daily', 'Daily P&L'], ['monthly', 'Monthly P&L'], ['drawdown', 'Drawdown']] as const).map(([k, l]) => (
            <button key={k} className={`chart-btn ${activeChart === k ? 'active' : ''}`} onClick={() => setActiveChart(k)}>{l}</button>
          ))}
        </div>
      </div>
      <p className="chart-caption">{CAPTION[activeChart]}</p>

      <div className="chart-container">
        {activeChart === 'daily' && <PnlBars data={dailyPnLData} unit="day" />}
        {activeChart === 'monthly' && <PnlBars data={monthlyPnLData} unit="month" />}
        {activeChart === 'drawdown' && <DrawdownChart data={drawdownData} />}
      </div>
    </div>
  );
}

const H = 280, PL = 64, PR = 12, PT = 12, PB = 28;

/** Measures the chart's real width so SVG text is never stretched. */
function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1000);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)));
    ro.observe(el); setW(Math.max(280, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Compact money for axis ticks: $1.2k, -$15k */
function short(v: number) {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  const sym = money(0, 0).replace(/[\d.,-]/g, '');
  if (a >= 1e6) return `${s}${sym}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${sym}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${s}${sym}${a.toFixed(0)}`;
}

function ticks(min: number, max: number) {
  const span = max - min || 1;
  const step0 = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || step0;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

/** P&L bars from a zero baseline (positive up, negative down), with axis and sparse labels. */
function PnlBars({ data, unit }: { data: ChartData[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  if (!data.length) return <div className="chart-empty">No {unit}s with closed trades yet.</div>;
  const vals = data.map(d => d.value);
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
  const y = (v: number) => PT + ((max - v) / (max - min || 1)) * (H - PT - PB);
  const bw = (W - PL - PR) / data.length;
  const total = vals.reduce((s, v) => s + v, 0);
  const green = vals.filter(v => v > 0).length, red = vals.filter(v => v < 0).length;
  const every = Math.max(1, Math.ceil(data.length / Math.max(3, Math.floor(W / 90))));
  const h = hover != null ? data[hover] : null;
  return (
    <div className="pnl-chart" ref={ref}>
      <div className="chart-summary">
        <span>Total <b className={total >= 0 ? 'positive' : 'negative'}>{money(total, 0)}</b></span>
        <span><b className="positive">{green}</b> green · <b className="negative">{red}</b> red {unit}s</span>
        <span className="chart-hover">{h ? <>{h.label}: <b className={h.value >= 0 ? 'positive' : 'negative'}>{money(h.value, 0)}</b></> : `Hover a bar for details`}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="pnl-svg" height={H} onMouseLeave={() => setHover(null)}>
        {ticks(min, max).map(t => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis-zero' : 'axis-grid'} />
            <text x={PL - 8} y={y(t) + 4} textAnchor="end" className="axis-text">{short(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = PL + i * bw + bw * 0.15;
          const top = Math.min(y(d.value), y(0)), hh = Math.max(1, Math.abs(y(d.value) - y(0)));
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={PL + i * bw} y={PT} width={bw} height={H - PT - PB} fill="transparent" />
              <rect x={x} y={top} width={Math.max(1, bw * 0.7)} height={hh} rx={Math.min(2, bw * 0.2)}
                className={`bar-rect ${d.value >= 0 ? 'up' : 'down'} ${hover === i ? 'hl' : ''}`} />
              {i % every === 0 && <text x={PL + i * bw + bw / 2} y={H - 8} textAnchor="middle" className="axis-text">{unit === 'day' ? d.label.slice(5) : d.label}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Underwater curve: distance below the running peak after each day. */
function DrawdownChart({ data }: { data: ChartData[] }) {
  const [ref, W] = useWidth();
  if (!data.length) return <div className="chart-empty">No days with closed trades yet.</div>;
  const min = Math.min(0, ...data.map(d => d.value));
  const y = (v: number) => PT + ((0 - v) / (0 - min || 1)) * (H - PT - PB);
  const x = (i: number) => PL + (i / Math.max(1, data.length - 1)) * (W - PL - PR);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z`;
  const every = Math.max(1, Math.ceil(data.length / Math.max(3, Math.floor(W / 90))));
  return (
    <div className="pnl-chart" ref={ref}>
      <div className="chart-summary">
        <span>Deepest drawdown <b className="negative">{money(min, 0)}</b></span>
        <span>Now <b className={data[data.length - 1].value < 0 ? 'negative' : 'positive'}>{data[data.length - 1].value < 0 ? money(data[data.length - 1].value, 0) : 'at a new high'}</b></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="pnl-svg" height={H}>
        {ticks(min, 0).map(t => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis-zero' : 'axis-grid'} />
            <text x={PL - 8} y={y(t) + 4} textAnchor="end" className="axis-text">{short(t)}</text>
          </g>
        ))}
        <path d={area} className="dd-area" />
        <path d={line} className="dd-line" />
        {data.map((d, i) => i % every === 0 && <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="axis-text">{d.label.slice(5)}</text>)}
      </svg>
    </div>
  );
}
