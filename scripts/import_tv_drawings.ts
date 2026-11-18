// Import drawings exported from TradingView (scripts/tv_import/*.txt) into the market chart.
// Usage: npx ts-node scripts/import_tv_drawings.ts <export.txt> <userId> [--dry]
// Imported drawings get ids "tv-<n>"; re-running replaces them and keeps every other drawing.
import fs from 'fs';
import pool from '../src/db';

type Pt = { t: number; p: number };
const LINE: Record<string, 'solid' | 'dotted' | 'dashed'> = { '0': 'solid', '1': 'dotted', '2': 'dashed' };
const TICK = 0.25;

export function parseExport(text: string) {
  const lines = text.split(/\r?\n/).filter(l => l && !l.startsWith('#'));
  const palLine = lines.find(l => l.startsWith('PAL '));
  if (!palLine) throw new Error('No PAL line');
  const pal = palLine.slice(4).split(' | ').map(s => s.trim());
  const col = (i: string, fallback: string) => (i === '' || i === undefined ? fallback : pal[Number(i)] ?? fallback);
  const out: any[] = [];
  lines.filter(l => !l.startsWith('PAL ')).forEach((l, n) => {
    const tok = l.split(' ');
    const [type, ptsRaw, c, w, st, fill, ext, extra] = tok;
    const pts: Pt[] = ptsRaw.split(',').map(x => { const [t, p] = x.split(':'); return { t: Number(t) * 60000, p: Number(p) }; });
    const base = { id: `tv-${n + 1}`, width: Number(w) || 1, line: LINE[st] ?? 'solid' };
    const extL = ext?.[0] === '1', extR = ext?.[1] === '1';
    switch (type) {
      case 'H': out.push({ ...base, tool: 'hline', points: [pts[0]], color: col(c, '#2962ff') }); break;
      case 'R': out.push({ ...base, tool: 'rect', points: pts, color: col(c, '#2962ff'), fill: fill ? col(fill, '') || undefined : undefined, extL, extR }); break;
      case 'T': out.push({ ...base, tool: 'trend', points: pts, color: col(c, '#2962ff'), extL, extR }); break;
      case 'P': out.push({ ...base, tool: 'trend', points: pts, color: col(c, 'rgba(242, 54, 69, 1)') }); break;   // TV path (no journal path tool): red, as on TV
      case 'C': out.push({ ...base, tool: 'channel', points: pts, color: col(c, 'rgba(0, 0, 0, 1)'), width: 2 }); break;
      case 'L': case 'S': {
        const [stopT, profT] = (extra || '0,0').split(',').map(Number);
        const dir = type === 'L' ? 1 : -1, e = pts[0];
        out.push({
          ...base, tool: type === 'L' ? 'long' : 'short', color: col(c, '#ffffff'), qty: 1, contract: 'NQ',
          points: [e, { t: e.t, p: e.p + dir * profT * TICK }, { t: e.t, p: e.p - dir * stopT * TICK }, { t: pts[1]?.t ?? e.t, p: e.p }],
        });
        break;
      }
      default: throw new Error(`Unknown type ${type} on line ${n + 1}`);
    }
  });
  return out;
}

async function main() {
  const [file, userArg, flag] = process.argv.slice(2);
  if (!file || !userArg) throw new Error('usage: import_tv_drawings.ts <export.txt> <userId> [--dry]');
  const userId = Number(userArg);
  const drawings = parseExport(fs.readFileSync(file, 'utf8'));
  const by: Record<string, number> = {};
  drawings.forEach(d => { by[d.tool] = (by[d.tool] || 0) + 1; });
  console.log(`parsed ${drawings.length}:`, by);
  const r = await pool.query('SELECT drawings FROM drawings WHERE user_id = $1 AND symbol = $2', [userId, 'NQ']);
  const existing: any[] = r.rows[0]?.drawings ?? [];
  const keep = existing.filter(d => !String(d.id).startsWith('tv-'));
  const merged = [...keep, ...drawings];
  console.log(`existing ${existing.length} (keeping ${keep.length}) -> ${merged.length}`);
  if (merged.length > 1000) throw new Error('more than 1000 drawings');
  if (flag !== '--dry') {
    await pool.query(
      `INSERT INTO drawings (user_id, symbol, drawings, updated_at) VALUES ($1, 'NQ', $2::jsonb, NOW())
       ON CONFLICT (user_id, symbol) DO UPDATE SET drawings = EXCLUDED.drawings, updated_at = NOW()`,
      [userId, JSON.stringify(merged)]);
    console.log('saved');
  }
  await pool.end();
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
