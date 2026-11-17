import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    TradingView?: any;
  }
}

const TV_SRC = 'https://s3.tradingview.com/tv.js';
let tvPromise: Promise<void> | null = null;

function loadTv(): Promise<void> {
  if (tvPromise) return tvPromise;
  tvPromise = new Promise<void>((resolve, reject) => {
    if (window.TradingView && window.TradingView.widget) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = TV_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      tvPromise = null;
      s.remove();
      reject(new Error('TradingView script failed to load'));
    };
    document.head.appendChild(s);
  });
  return tvPromise;
}

let idCounter = 0;

function clearChildren(el: HTMLElement | null) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

export default function TvPane(props: {
  interval: number;
  theme: 'dark' | 'light';
  timezone: 'America/New_York' | 'Etc/GMT+7';
  symbol?: string;
}) {
  const { interval, theme, timezone } = props;
  // TradingView's free widget does not allow CME futures ("only available on TradingView"),
  // so the live window shows the Nasdaq-100 CFD: real-time, moves with NQ, but priced off the
  // cash index (no futures premium), so its numbers differ from NQ by a fairly steady amount.
  const symbol = props.symbol ?? 'OANDA:NAS100USD';
  const idRef = useRef<string>('');
  if (!idRef.current) idRef.current = `tv_pane_${++idCounter}`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let dead = false;
    const el = containerRef.current;
    loadTv().then(
      () => {
        if (dead) return;
        clearChildren(el);
        try {
          new window.TradingView.widget({
            container_id: idRef.current,
            autosize: true,
            symbol,
            interval: interval === 1440 ? 'D' : String(interval),
            timezone,
            theme,
            style: '1',
            locale: 'en',
            hide_side_toolbar: false,
            allow_symbol_change: false,
            save_image: false,
            withdateranges: false,
            details: false,
            hotlist: false,
            calendar: false,
            support_host: 'https://www.tradingview.com',
          });
          setStatus('ready');
        } catch {
          setStatus('error');
        }
      },
      () => {
        if (!dead) setStatus('error');
      },
    );
    return () => {
      dead = true;
      clearChildren(el);
    };
  }, [interval, theme, timezone, symbol]);

  const msg: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: 12,
    color: '#787b86',
    fontSize: 12,
    pointerEvents: 'none',
  };

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div
        id={idRef.current}
        ref={containerRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      {status === 'loading' && <div style={msg}>Loading TradingView…</div>}
      {status === 'error' && (
        <div style={msg}>TradingView could not be loaded (blocked by the browser or offline).</div>
      )}
      <div
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          zIndex: 2,
          pointerEvents: 'none',
          fontSize: 10,
          textTransform: 'uppercase',
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          padding: '2px 6px',
          borderRadius: 3,
        }}
      >
        TradingView · Nasdaq-100 CFD live (not NQ futures prices)
      </div>
    </div>
  );
}
