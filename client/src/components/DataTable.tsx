import React, { useState, useEffect, useMemo } from 'react';
import { canOpenOnChart, openOnChart } from '../utils/chartLink';
import axios from 'axios';
import { money, num } from '../utils/format';
import { useOptions, values } from '../utils/options';
import { Download, CandlestickChart, ArrowUp, ArrowDown, Table2 } from 'lucide-react';
import TradeDetail from './TradeDetail';
import { EmptyState } from './ui';
import './DataTable.css';

interface Props {
  token: string;
  account_id: number;
  accountName?: string;
  attempt?: number | null;
}

type SortKey = 'entry_time' | 'symbol' | 'pnl' | 'quantity' | 'setup_tag' | 'grade' | 'session' | 'test_type' | 'timeframe';

const COLS: { key: SortKey | string; label: string; sortable?: boolean; right?: boolean }[] = [
  { key: 'entry_time', label: 'Date / Time', sortable: true },
  { key: 'symbol', label: 'Pair', sortable: true },
  { key: 'quantity', label: 'Qty', sortable: true, right: true },
  { key: 'entry_price', label: 'Entry', right: true },
  { key: 'exit_price', label: 'Exit', right: true },
  { key: 'pnl', label: 'P&L', sortable: true, right: true },
  { key: 'setup_tag', label: 'Setup', sortable: true },
  { key: 'grade', label: 'Grade', sortable: true },
  { key: 'session', label: 'Session', sortable: true },
  { key: 'test_type', label: 'Entry type', sortable: true },
  { key: 'timeframe', label: 'TF', sortable: true },
  { key: 'tf_align', label: 'Align', right: true },
  { key: 'planned_rr', label: 'R:R' },
  { key: 'tags', label: 'Tags' },
  { key: 'notes', label: 'Notes' },
];

export default function DataTable({ token, account_id, accountName, attempt }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [f, setF] = useState<Record<string, string>>({ session: '', test_type: '', timeframe: '', setup_tag: '', grade: '', result: '' });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'entry_time', dir: -1 });
  const opts = useOptions();
  const [open, setOpen] = useState<any | null>(null);   // trade open in the review popup
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoading(true);
    axios.get('/api/trades', {
      headers: { Authorization: `Bearer ${token}` },
      params: { account_id, attempt: attempt || undefined },
    })
      .then(r => setRows(r.data.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [account_id, attempt, token, reload]);

  // Long / short: from the tags if the import set them, else from the price move and the P&L sign
  const sideOf = (t: any): string => {
    const tags: string[] = t.tags || [];
    if (tags.includes('Long')) return 'long';
    if (tags.includes('Short')) return 'short';
    const e = Number(t.entry_price), x = Number(t.exit_price), p = Number(t.pnl);
    if (Number.isFinite(e) && Number.isFinite(x) && Number.isFinite(p) && x !== e && p !== 0) return (x - e) * p > 0 ? 'long' : 'short';
    return '';
  };
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter(t => {
      if (f.session && t.session !== f.session) return false;
      if (f.test_type && t.test_type !== f.test_type) return false;
      if (f.timeframe && t.timeframe !== f.timeframe) return false;
      if (f.setup_tag && t.setup_tag !== f.setup_tag) return false;
      if (f.grade && t.grade !== f.grade) return false;
      if (f.result === 'win' && !(Number(t.pnl) > 0)) return false;
      if (f.result === 'loss' && !(Number(t.pnl) < 0)) return false;
      if (needle) {
        const hay = [t.symbol, sideOf(t), t.setup_tag, t.session, t.test_type, t.timeframe, t.planned_rr,
          (t.tags || []).join(' '), t.notes].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const { key, dir } = sort;
    out = [...out].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (key === 'pnl' || key === 'quantity') return (Number(av) - Number(bv)) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return out;
  }, [rows, q, f, sort]);

  // Big accounts (backtests) hold tens of thousands of trades: draw one page of rows at a time.
  // Filters, totals and CSV export still use every matching trade.
  const PAGE = 200;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [q, f, sort, rows]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageRows = useMemo(() => filtered.slice(page * PAGE, page * PAGE + PAGE), [filtered, page]);

  const totals = useMemo(() => {
    const pnl = filtered.reduce((s, t) => s + Number(t.pnl || 0), 0);
    const wins = filtered.filter(t => Number(t.pnl) > 0).length;
    return { pnl, wins, n: filtered.length, winRate: filtered.length ? (wins / filtered.length) * 100 : 0 };
  }, [filtered]);

  const csvCell = (v: any) => {
    const s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };

  const downloadCsv = () => {
    const header = COLS.map(c => c.label).join(',');
    const lines = filtered.map(t => COLS.map(c => csvCell(t[c.key as string])).join(','));
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(accountName || 'trades').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const setFilter = (k: string, v: string) => setF(p => ({ ...p, [k]: p[k] === v ? '' : v }));
  const toggleSort = (k: SortKey) => setSort(s => s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: -1 });
  const anyFilter = q.trim() !== '' || Object.values(f).some(Boolean);

  const Chips = ({ label, k, list }: { label: string; k: string; list: string[] }) => (
    list.length === 0 ? null : (
      <div className="dt-frow">
        <span className="dt-flabel">{label}</span>
        <div className="dt-fchips">
          {list.map(o => (
            <button key={o} className={`dt-chip ${f[k] === o ? 'on' : ''}`} onClick={() => setFilter(k, o)}>{o}</button>
          ))}
        </div>
      </div>
    )
  );

  const setups = Array.from(new Set(rows.map(r => r.setup_tag).filter(Boolean))) as string[];

  return (
    <div className="datatable">
      <div className="dt-head">
        <p className="dt-sub">
          {accountName || 'This account'}{attempt ? ' · the run selected on the Dashboard' : ' · all runs'}. Click any row to review and tag that trade.
        </p>
        <button className="dt-export" onClick={downloadCsv} disabled={filtered.length === 0}>
          <Download className="ic-sm" /> Export CSV ({filtered.length.toLocaleString()})
        </button>
      </div>

      <div className="dt-filters">
        <input className="dt-search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search pair, setup, notes, tags…" />
        <Chips label="Session" k="session" list={values(opts, 'session')} />
        <Chips label="Entry type" k="test_type" list={values(opts, 'test_type')} />
        <Chips label="Timeframe" k="timeframe" list={values(opts, 'timeframe')} />
        <Chips label="Setup" k="setup_tag" list={setups} />
        <Chips label="Grade" k="grade" list={['A', 'B', 'C']} />
        <Chips label="Result" k="result" list={['win', 'loss']} />
        {anyFilter && (
          <button className="dt-clear" onClick={() => { setQ(''); setF({ session: '', test_type: '', timeframe: '', setup_tag: '', grade: '', result: '' }); }}>
            Clear all filters
          </button>
        )}
      </div>

      <div className="dt-summary">
        <span><b>{totals.n.toLocaleString()}</b> trades</span>
        <span>Net <b className={totals.pnl >= 0 ? 'pos' : 'neg'}>{money(totals.pnl, 2)}</b></span>
        <span>Win rate <b>{num(totals.winRate).toFixed(0)}%</b></span>
      </div>

      {loading ? (
        <p className="dt-empty">Loading…</p>
      ) : filtered.length === 0 ? (
        rows.length === 0
          ? <EmptyState icon={Table2} title="No trades in this account yet">Use <b>Import</b> in the top bar to load a broker CSV, or <b>Add trade</b> to log one by hand.</EmptyState>
          : <p className="dt-empty">No trades match these filters. Clear a filter or the search box.</p>
      ) : (
        <div className="dt-wrap">
          <table className="dt-table">
            <thead>
              <tr>
                {COLS.map(c => (
                  <th key={c.key as string} className={`${c.right ? 'r' : ''} ${c.sortable ? 'sortable' : ''}`}
                    onClick={() => c.sortable && toggleSort(c.key as SortKey)}>
                    {c.label}{sort.key === c.key ? (sort.dir === 1 ? <ArrowUp className="ic-sm dt-sort" /> : <ArrowDown className="ic-sm dt-sort" />) : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map(t => (
                <tr key={t.id} className="dt-row" onClick={() => setOpen(t)} title="Click to review this trade">
                  <td className="nowrap">
                    {canOpenOnChart(t.symbol) && (
                      <button className="dt-chart-btn" title="Open on the market chart" aria-label="Open on the market chart" onClick={e => { e.stopPropagation(); openOnChart(t.id); }}><CandlestickChart className="ic-sm" /></button>
                    )}
                    {new Date(t.entry_time).toLocaleString()}
                  </td>
                  <td className="strong">{t.symbol}{sideOf(t) && <span className={`dt-side ${sideOf(t)}`}>{sideOf(t) === 'long' ? 'L' : 'S'}</span>}</td>
                  <td className="r">{t.quantity}</td>
                  <td className="r">{t.entry_price != null ? num(t.entry_price).toFixed(2) : ''}</td>
                  <td className="r">{t.exit_price != null ? num(t.exit_price).toFixed(2) : ''}</td>
                  <td className={`r strong ${Number(t.pnl) >= 0 ? 'pos' : 'neg'}`}>{t.pnl != null ? money(t.pnl, 2) : ''}</td>
                  <td className="nowrap">{t.setup_tag || ''}</td>
                  <td>{t.grade ? <span className={`dt-grade g-${t.grade}`}>{t.grade}</span> : ''}</td>
                  <td>{t.session || ''}</td>
                  <td>{t.test_type || ''}</td>
                  <td>{t.timeframe || ''}</td>
                  <td className="r">{t.tf_align ?? ''}</td>
                  <td>{t.planned_rr || ''}</td>
                  <td className="dim">{(t.tags || []).join(', ')}</td>
                  <td className="dim dt-notes" title={t.notes || ''}>{t.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="dt-pager">
              <button onClick={() => setPage(0)} disabled={page === 0}>First</button>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Prev</button>
              <span>Rows {(page * PAGE + 1).toLocaleString()}–{Math.min(filtered.length, (page + 1) * PAGE).toLocaleString()} of {filtered.length.toLocaleString()}</span>
              <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>Next</button>
              <button onClick={() => setPage(pages - 1)} disabled={page >= pages - 1}>Last</button>
            </div>
          )}
        </div>
      )}
      {open && (
        <TradeDetail trade={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); setReload(r => r + 1); }} />
      )}
    </div>
  );
}
