// Builds src/news/econReleases.json: every CPI, NFP, PPI and Retail Sales release since mid-2021 with the
// FIRST-RELEASE value (as published that day, never later revisions), the previous month as shown that day,
// and the revised value (as shown in the next release), plus FOMC decisions from the Fed's target-rate series.
// Source: ALFRED (St. Louis Fed archival data, public, no key): one CSV per data vintage.
// Usage: node scripts/news/build_econ_releases.cjs        (about 4-5 minutes; re-run monthly to add new releases)
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (compatible; trading-journal-research/1.0)';
const FROM = '2021-06-01';
const SERIES = [
  { event: 'CPI', seid: 'CPIAUCSL', unit: '% m/m', time: '08:30', kind: 'pct' },
  { event: 'NFP', seid: 'PAYEMS', unit: 'k jobs', time: '08:30', kind: 'diff' },
  { event: 'PPI', seid: 'PPIFIS', unit: '% m/m', time: '08:30', kind: 'pct' },
  { event: 'RETAIL', seid: 'RSAFS', unit: '% m/m', time: '08:30', kind: 'pct' },
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
    } catch { /* retry */ }
    await sleep(2000 * (i + 1));
  }
  throw new Error('failed: ' + url);
}

const r1 = x => Math.round(x * 10) / 10;
function change(kind, rows, i) {
  if (i < 1 || !rows[i] || !rows[i - 1]) return null;
  const a = rows[i].v, b = rows[i - 1].v;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return kind === 'pct' ? r1((a / b - 1) * 100) : Math.round(a - b);
}

async function buildSeries(s) {
  const page = await get(`https://alfred.stlouisfed.org/series/downloaddata?seid=${s.seid}`);
  const vintages = [...new Set(page.match(/20\d\d-\d\d-\d\d/g) || [])].filter(d => d >= FROM).sort();
  const releases = [];
  const seenPeriods = new Set();
  let n = 0;
  for (const v of vintages) {
    await sleep(700);
    const csv = await get(`https://alfred.stlouisfed.org/graph/alfredgraph.csv?id=${s.seid}&vintage_date=${v}&cosd=2020-01-01`);
    if (!csv) continue;
    const rows = csv.trim().split(/\r?\n/).slice(1).map(l => { const [d, x] = l.split(','); return { d, v: Number(x) }; }).filter(r => Number.isFinite(r.v));
    if (rows.length < 3) continue;
    const last = rows.length - 1, period = rows[last].d.slice(0, 7);
    n++;
    if (seenPeriods.has(period)) continue; // a revision-only vintage (benchmark / seasonal update), not a new release
    seenPeriods.add(period);
    releases.push({ event: s.event, date: v, time: s.time, period, actual: change(s.kind, rows, last), previous: change(s.kind, rows, last - 1), unit: s.unit, rows });
  }
  // revised = this period's value as shown in the NEXT release
  for (let i = 0; i < releases.length; i++) {
    const next = releases[i + 1];
    if (!next) { releases[i].revised = null; continue; }
    const k = next.rows.findIndex(r => r.d.slice(0, 7) === releases[i].period);
    releases[i].revised = k >= 1 ? change(s.kind, next.rows, k) : null;
  }
  for (const r of releases) delete r.rows;
  console.log(`${s.event}: ${vintages.length} vintages read, ${n} usable, ${releases.length} releases`);
  return releases;
}

async function buildFomc() {
  const src = fs.readFileSync(path.join(__dirname, '../../src/patterns/newsCalendar.ts'), 'utf8');
  const block = src.slice(src.indexOf('export const FOMC_DATES'));
  const dates = (block.slice(0, block.indexOf('];')).match(/20\d\d-\d\d-\d\d/g) || []).filter(d => d >= FROM);
  const csv = await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU&cosd=2021-01-01');
  const rate = new Map(csv.trim().split(/\r?\n/).slice(1).map(l => { const [d, x] = l.split(','); return [d, Number(x)]; }));
  const days = [...rate.keys()].sort();
  const at = d => { let v = null; for (const k of days) { if (k <= d) v = rate.get(k); else break; } return v; };
  const nextDay = d => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
  const today = new Date().toISOString().slice(0, 10);
  return dates.map(d => {
    const before = at(d), after = d < today ? at(nextDay(d)) : null; // the new target takes effect the day after the decision
    return { event: 'FOMC', date: d, time: '14:00', period: d.slice(0, 7), actual: after == null ? null : Math.round((after - before) * 100),
      previous: before == null ? null : before, revised: null, unit: 'bp change (upper bound)' };
  });
}

(async () => {
  const out = [];
  for (const s of SERIES) out.push(...await buildSeries(s));
  out.push(...await buildFomc());
  out.sort((a, b) => (a.date + a.time + a.event).localeCompare(b.date + b.time + b.event));
  // sanity check against the release dates already in the app (CPI/NFP from earlier ALFRED work)
  const cal = fs.readFileSync(path.join(__dirname, '../../src/patterns/newsCalendar.ts'), 'utf8');
  for (const [ev, name] of [['CPI', 'CPI_DATES'], ['NFP', 'NFP_DATES']]) {
    const line = cal.split('\n').find(l => l.includes(`export const ${name}`)) || '';
    const known = new Set(line.match(/20\d\d-\d\d-\d\d/g) || []);
    const mine = out.filter(r => r.event === ev && r.date >= '2021-12-01').map(r => r.date);
    const miss = mine.filter(d => !known.has(d)), extra = [...known].filter(d => !mine.includes(d));
    console.log(`${ev} check vs app calendar: ${mine.length} releases, ${miss.length} not in app list ${miss.slice(0, 5)}, ${extra.length} app dates not found ${extra.slice(0, 5)}`);
  }
  const file = path.join(__dirname, '../../src/news/econReleases.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ builtAt: new Date().toISOString(), source: 'ALFRED / FRED (St. Louis Fed), first-release vintages', releases: out }, null, 1));
  console.log('wrote', out.length, 'releases ->', file);
})().catch(e => { console.error(e.message); process.exit(1); });
