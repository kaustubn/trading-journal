// "New version ready" bar: the journal is a single page that stays open for hours, so after a deploy the open tab keeps
// running the old code until it is reloaded. Every 5 minutes (and when the tab comes back into view) this checks which
// script the server's page loads now; when it differs from the running one it offers a reload.
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const scriptOf = (html: string) => /\/assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html)?.[1] ?? null;
const running = () => {
  const s = [...document.querySelectorAll('script[src]')].map(x => (x as HTMLScriptElement).src).find(src => /\/assets\/index-[A-Za-z0-9_-]+\.js/.test(src));
  return s ? scriptOf(s) : null;
};

export default function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const mine = running();
    if (!mine) return;                 // dev server: nothing to compare
    let stop = false;
    const check = async () => {
      if (stop || document.visibilityState === 'hidden') return;
      try {
        const r = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' });
        const now = scriptOf(await r.text());
        if (now && now !== mine) setReady(true);
      } catch { /* offline: try later */ }
    };
    const t = window.setInterval(check, 5 * 60000);
    const onVis = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { stop = true; window.clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  if (!ready) return null;
  return (
    <div role="status" style={{
      position: 'fixed', left: '50%', bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', transform: 'translateX(-50%)', zIndex: 1000,
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 8px 14px', borderRadius: 10,
      background: 'var(--accent, #5b6cf0)', color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,.35)', fontSize: 13.5, maxWidth: 'calc(100vw - 24px)',
    }}>
      <span>A new version of the journal is ready.</span>
      <button onClick={() => window.location.reload()} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 7, padding: '6px 10px',
        background: '#fff', color: '#1e222d', fontWeight: 600, cursor: 'pointer',
      }}><RefreshCw size={14} /> Reload</button>
      <button onClick={() => setReady(false)} aria-label="Later" style={{ border: 0, background: 'transparent', color: '#fff', cursor: 'pointer', fontSize: 16 }}>✕</button>
    </div>
  );
}
