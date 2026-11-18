# Design review and redesign — Trading Journal

Date: 2026-11-17. Scope: every page except the Market Chart internals, which were reworked in parallel and left untouched (MarketChart, ChartPane, DrawingTools, ReplayBar, CoachPanel, MentorPanel, TvPane, DataPanel, DayNotes, `client/src/chart/*`, `MarketChart.css`).
Goal: make the app (a) professional, (b) easy to understand, and (c) coachable. Coaching is rule-based on Kay's own data. It uses no AI and no paid API.

---

## 1. Audit findings, ranked by impact

### Bugs (wrong numbers, broken visuals)
| # | Finding | Status |
|---|---|---|
| B1 | **Charts → Daily/Monthly P&L were unreadable.** Bars hung down from the top whether green or red, there was no zero line, x-labels wrapped to two lines ("09-0 / 1"), and the "Total" row was dark text on a dark background. | Fixed: new SVG chart with a zero baseline, a y-axis, sparse labels, a hover read-out and green/red-day counts. Drawdown is now an underwater curve. |
| B2 | **Risk Management values were nearly invisible.** Leftover light-theme CSS put dark text on dark cards (calculator result, rule values) and drew white separators. | Fixed with tokenised dark overrides. |
| B3 | **Discipline score showed "100" from 1 plan and 0 graded trades.** That reads as a perfect score. | Fixed: a score now needs 5+ daily plans or 10+ graded trades. Until then the page says what is missing. |
| B4 | **Report said "Best instrument NQ −$365,068" in green, and "Your biggest leak is NQ"** when NQ was the only instrument traded. | Fixed: colour follows the sign, the label reads "Instrument" when there is only one, and the focus line comes from the coaching rules. |
| B5 | **Pre-Market date defaulted to tomorrow every evening in BC.** It used `toISOString()`, which is UTC. | Fixed: uses the local date. |
| B6 | **Trade popup showed P&L as "$-203.50"** and prices as "$29020.25". | Fixed: "−$203.50", with prices shown without a currency sign. |
| B7 | **Money had no thousands separators anywhere** ("-$115487"). | Fixed globally in `money()`. |
| B8 | **Collapsed sidebar account initials were wrong.** `split(/s+/)` split on the letter "s". | Fixed: `/\s+/`. |
| B9 | **Charges button was hard-coded to ₹** on USD accounts ("₹/trade"). | Fixed: uses the account currency. |
| B10 | **Challenges compare coloured the better value green even when it was a loss** (−$115,487 shown in green). | Fixed: values are neutral and the better one gets a check mark. Total trades is no longer judged. |
| B11 | **Phone width overflowed** (scrollWidth 481 at 390px): the header buttons, the 20-item nav pushed above the content, the run selector and the calendar. | Fixed: drawer navigation, icon-only header, wrapped controls. scrollWidth is 390 on Dashboard, Performance, Trade Log and Coach. |
| B12 | **All Trades table squeezed columns.** The setup name wrapped to 4 lines and every row was ~60px tall. | Fixed: nowrap cells and horizontal scroll inside the table. |
| B13 | **Numbers disagree between pages.** Dashboard uses the selected run (8,117 trades, −$115k). Performance, Setups, Time and Report use every run in the account (31,029 trades, −$365k), and nothing said so. | Labelled: each page now shows a scope pill such as "All trades in this account · every run". The behaviour was not changed (see section 4). |
| B14 | **Risk & Sizing's Kelly reads a 56% win rate** while every other page shows 46–52%. The risk engine uses a different data window, and account equity is a fixed $100,000. | Not fixed (backend logic). Listed in section 4. |

### Design (amateur visuals)
1. Emoji icons everywhere: 143 occurrences in 40 files (sidebar, headings, buttons, status badges, landing page). They render differently on every OS and read as childish.
2. No design system. There were 70+ hard-coded hex colours, three different purples (#6366f1, #6c5ce7, #667eea), 12px/10px/8px/6px radii mixed, and light-theme leftovers (#fff, #333, #ddd) on dark pages.
3. Inconsistent page headers. Some pages had emoji h2 titles, some had none, some had subtitles. Analytics, Charts and Strategy Builder used one style; Challenges, Coach and Emotions used another.
4. The account list took ~400px of the sidebar (5 large cards), so the navigation started below the fold.
5. Weak empty states, such as "No strategies yet. Create one to get started!" and "No discipline data yet."
6. No tabular numbers, so money columns did not line up.
7. The calendar used square cells, which made it 900px tall on desktop.

### UX
1. Nav overload: 19 items in 5 groups with overlapping names (AI Coach vs the chart Coach; Performance vs Breakdown vs Charts vs Report; Backtest Lab vs Strategy Builder; "Compare & Buy").
2. No daily flow. Nothing told a newer trader to log, then review the day, then fix one thing.
3. Numbers with no meaning: nothing explained profit factor, expectancy, break-even win rate or Kelly, or what "good" looks like.
4. The AI Coach page depended on a paid Anthropic key, so with $0 spend it answered "not configured". That was a dead end.
5. All Trades was read-only. Clicking a row did nothing, so it was a dead end for trade review.
6. The trade popup was one long unstructured form ("Testing type", "TF Align") with no sense of what makes a review "done".
7. Jargon labels: Testing type, TF Align, Planned R:R, Risk Rules (Hardcoded), Recommended Size.

### Compared with pro journals
TradeZella, Tradervue and Edgewonk all have: one calm design system; a dashboard that leads with KPIs plus a "what to work on" panel (Zella Score / Edgewonk "Tiltmeter"); a trade review with tags, mistakes and lessons; setup/time breakdowns with clear verdicts; and tooltips on every metric. The journal already had most of the data, but it was hidden behind emoji and jargon. The redesign borrows that structure.

---

## 2. Information architecture

**Before (19 items, 5 groups)**
Journal: Dashboard · Challenges · Pre-Market · Market Chart
Analytics: AI Coach · Performance · Setup Performance · Breakdown · Charts · Paper vs Real · Discipline · Emotions · Report
Planning: Checklist · Backtest Lab · Strategy Builder · Risk Management
Data: All Trades
Prop Firms: Compare & Buy

**After (16 items, 4 groups, ordered by the daily flow)**
| Group | Item (route key) | Notes |
|---|---|---|
| Journal | Dashboard (`dashboard`) · Trade Log (`data`) · Daily Plan (`premarket`) · Challenges (`challenges`) | log it |
| Review | Coach (`coach`) · Performance (`analytics` + tabs **Stats / P&L charts / Report** → `charts`, `report`) · Setups (`setups`) · Time & Sessions (`breakdown`) · Mindset (`discipline` + tab **Emotions** → `emotions`) · Paper vs Real (`compare`) | review it |
| Practice | Market Chart (`marketchart`, admin) · Backtest Lab (`backtestlab`) · Strategy Rules (`strategy`) | practise it |
| Plan | Entry Checklist (`checklist`) · Risk & Sizing (`risk`) · Prop Firms (`propfirms`) | plan the next session |

Every old route key still works. Pages that share a nav entry are reached through sub-tabs, and the nav item stays highlighted for all of them. The hidden legacy views (insights, automation, advanced, social) still render if reached. Header shortcuts (Import, Add trade, Sync) and the "Open on chart" event still work.
Note: the earlier headless test scripts click nav items by text. "AI Coach" is now "Coach" and "All Trades" is now "Trade Log". "Market Chart", "Backtest Lab", "Performance", "Dashboard" and "Challenges" are unchanged.

---

## 3. What changed

### Design system (`client/src/styles/theme.css`)
- **Colour tokens:** `--bg #0b0d12`, `--surface #12151c`, `--raised #181c25`, `--raised-2 #1f2430`, `--border #252a36`, `--border-strong #323847`, `--text #e7e9ee`, `--text-dim #a3a9b6`, `--muted #737b8c`, `--accent #5b6cf0` (+ `-hover`, `-ink`, `-soft`), `--success #22c55e`, `--danger #ef4444`, `--warning #f5a623` (each with a `-soft` tint). The Market Chart's own colours were not touched.
- **Scales:** spacing `--sp-1…8` (4px base), radii `--r-sm 6 / --r-md 8 / --r-lg 10`, one `--shadow`, type `--fs-xs 11 … --fs-2xl 24`.
- **Font:** Inter (Google Fonts, in `index.html`) with a system fallback. Tabular numbers on tables, values and P&L.
- Legacy variable names (`--panel`, `--card`, `--brand`, `--green`, …) are kept as aliases. About 750 hard-coded hex values across 30 stylesheets were mapped to tokens (MarketChart.css excluded).
- Shared primitives in `styles/ui.css` + `components/ui.tsx`: `PageHeader`, `InfoTip` (tooltip: what it is + what good looks like), `EmptyState`, `SubTabs`, `.btn-solid/.btn-ghost/.btn-outline`, `.scope-note`, `.verdict` pills, focus/insight cards, and the daily-flow strip.
- Icons: `lucide-react@0.460.0` (pinned exact; installed in `client/`). Default 16px, stroke 1.75, `currentColor`, set once in CSS; `.ic-sm/.ic-lg/.ic-xl` change the size.

### Icon mapping (main ones)
Dashboard 📅→LayoutDashboard · Trade Log 🗄→Table2 · Daily Plan 📝→NotebookPen · Challenges 🏆→Trophy · Coach 🧠→Compass · Performance 📊→BarChart3 · Setups 📋→Layers · Time & Sessions 📦→Clock · Mindset 🎯/🎭→Brain · Paper vs Real ⚖→Scale · Market Chart 🕯→CandlestickChart · Backtest Lab 🧪→FlaskConical · Strategy Rules ⚗→Workflow · Entry Checklist ✅→ListChecks · Risk & Sizing 🛡→ShieldCheck · Prop Firms 🏦→Building2 · lock 🔒→Lock · blown 💥→Flame · passed ✅→CheckCircle2 · active 🔵→CircleDot · warning ⚠/🚨→AlertTriangle · halt 🛑→OctagonX · tip 💡→Lightbulb · screenshot 📷→Image · print 🖨→Printer · export ⬇→Download · close ✕→X · rating ★→Star. Remaining emoji outside the Market Chart files: **0** (emotion values typed by Kay stay as his data).

### Shell and pages
- **Header:** brand mark, Import (ghost), Add trade (primary), Sync (icon), a Pro pill, Log out (icon). On phones it becomes a menu button plus icons.
- **Sidebar:** a compact account switcher (popover with a "…" menu for rename / time zone / delete; right-click still works), grouped nav with 34px rows and an accent bar on the active item. Collapsed mode works and the arrow rail stays vertically centred. On phones it is a slide-in drawer with a backdrop.
- **Every page** gets a title and a one-line plain-English purpose (`PAGE_META` in `App.tsx`).
- **Dashboard:** daily-flow strip (Plan → Log → Review → Fix one thing), KPI row with tooltips and plain verdicts ("Below 1.0 = losing"), equity curve beside the score, **"Your focus this week"**, prop status, calendar. The day view has a review hint and a token-styled overtrading warning.
- **Trade review popup:** a sticky header with a large signed P&L and R badge, a **Review 0–4/4** progress bar (setup tagged, graded, feeling logged, stop saved) with a "Next:" tip, four numbered sections (What did you trade? / Was it a good trade? / How did you feel? / Evidence and lesson), a sticky Save, Escape closes it, and plain labels.
- **Trade Log:** rows now open the review popup (the old dead end). Icons, an empty state, and a scope line.
- **Coach:** the full ranked insight list, plus "Ask a question". The six suggested questions are answered **instantly from the rules** (no AI). Free-typed questions still go to the existing `/api/coach` endpoint, which only uses AI if a key is configured on the server; the label says so.
- **Performance → Stats:** tooltips, break-even win rate, worst trade as a multiple of the average loss, and a "What your numbers say" focus panel. **P&L charts:** rebuilt (B1). **Report:** fixed (B4), and the focus line plus two more items come from the rules.
- **Setups:** a **Verdict** column (Keep / Thin edge / Losing / Cut or fix / Too few trades / Tag these), header tooltips, and right-aligned numbers.
- **Time & Sessions:** hour and weekday first (the most actionable), instrument shown only if there is more than one, tag-based breakdowns grouped below, plain labels.
- **Mindset:** Discipline (B3) and Emotions ("Costing you / Paying you") as tabs.
- **Challenges:** icon status buttons, neutral compare with a "better" check mark, and a "New run" action.
- **Daily Plan:** split into "Before the open / After the close", and the date bug fixed.
- **Risk & Sizing:** readable (B2), plain labels ("Contracts calculator", "Safer: ¼ Kelly"), and a "no edge yet" message when Kelly ≤ 0.
- **Prop Firms, Checklist, modals, landing page, upgrade wall:** icons and tokens.

### Coaching rules (`client/src/utils/coaching.ts`)
Each card is an insight, why it matters, and what to do next, plus links to the relevant page (Setups, Time & Sessions, Emotions, Discipline, Checklist, Risk, Trade Log, **Backtest Lab**, and **Market Chart** when admin). Data comes from the existing endpoints: `/api/overview`, `/api/setups?groupBy=setup|tag|grade`, `/api/breakdown`, `/api/emotions`, `/api/overtrading`. Cards are ranked by dollars at stake.

| Rule | Fires when | Rank weight |
|---|---|---|
| Not enough data | < 20 trades in view | shown alone |
| Rule breaks | trades tagged `rule break` / `broke rule(s)` / `mistake`, net < 0 | ×1.5 |
| Losing setup | setup with ≥ max(10, min(30, 2% of trades)) trades, PF < 0.9, net < 0; worst one | ×1.0 |
| Edge setup | same min trades, PF ≥ 1.3, expectancy > 0; best one | ×0.6 |
| Costliest hour | hour with ≥ 10 trades and net < 0; worst one (best hour quoted) | ×1.0 |
| Costliest weekday | ≥ 10 trades, net < 0, ≥ 25% of all losing-weekday losses, ≥ 3 weekdays | ×0.7 |
| Negative emotion | negative emotion tag with ≥ 3 trades, net < 0 | ×1.2 |
| C-grade trades | C-grade with ≥ 5 trades, net < 0 | ×1.0 |
| Payoff | avg loss > 1.15 × avg win and win rate < 60% (break-even win rate quoted) | ×0.5 of the gap |
| Untagged | > 50% of trades without a setup tag and < 3 other cards | info |

Headline sentence: what one trade is worth on average, with the profit factor. Setup verdicts use the same thresholds. The dashboard panel is scoped to the selected run and date range. To support that, `/api/setups` and `/api/breakdown` gained an **optional** `attempt` query parameter (`src/api/setups.ts`, `src/api/breakdown.ts`). The default behaviour is unchanged.

### Files
- New: `client/src/components/FocusPanel.tsx`, `client/src/components/ui.tsx`, `client/src/styles/ui.css`, `client/src/utils/coaching.ts`, `client/src/utils/glossary.ts`, `DESIGN_REVIEW.md`.
- Changed: `client/index.html`; `App.tsx`, `App.css`; `utils/format.ts`; components AccountSelector, AddAccountModal, AddTradeModal, Advanced, Analytics, AttemptBar(.css), Automation, BacktestLab (title/✓✕ only), Breakdown, Calendar, Challenges(.css), Charts, Checklist, Coach(.css), Compare, CostCalculator, DataTable(.css), Discipline, Emotions(.css), Ideas, ImportModal, Insights, LoginForm, OptionPicker(.css), Overview, PreMarket, PropFirms, PropStatus, Report, RiskManagement, Setups, Social, StrategyBuilder, TradeDetail, TradeList, UpgradeWall(.css); `data/propfirms.ts` (emoji labels); 30 stylesheets in `styles/` (token mapping and redesign blocks); server `src/api/setups.ts`, `src/api/breakdown.ts`; build output in `public/`.

---

## 4. Not done, and recommended next (rough effort)
1. **One scope everywhere (B13).** Pass the Dashboard's selected run and dates to Performance, Charts, Setups and Time, with an "All runs" toggle. ~2–3 h. This changes what Kay sees, so it needs his OK first.
2. **Risk & Sizing data (B14).** Compute Kelly and equity from the same trades and the starting balance (the prop rules already store one). Make the built-in rules editable. ~3 h.
3. **Calendar opens on the last month with trades** instead of an empty current month (backtest accounts). ~30 min.
4. **Trade Log performance:** 8,000+ rows render at once. Add pagination or virtualisation. ~1–2 h.
5. **Weekly review page / email:** the focus cards for "last 7 days" against "previous 4 weeks", with a trend arrow per rule. ~half a day.
6. **"Mistakes" tag set** in the trade popup (Moved stop, Early exit, Oversized, Rule break) so the rule-break coaching fires more often. ~1 h.
7. **Coach → Market Chart Mentor deep link:** the Market Chart has no event to open the Mentor panel directly (those files were out of scope). The links open the Market Chart. ~15 min in MarketChart.tsx.
8. **Bundle size:** the main chunk is over 500 kB. Code-split Market Chart and Backtest Lab with `React.lazy`. ~1 h.
9. Legacy pages (Insights, Automation, Advanced, Social) are not in the nav and still carry some light-theme CSS. Remove them or finish restyling. ~1–2 h.

---

## 5. Screenshots
Folder: `C:\Users\wolfm\AppData\Local\Temp\claude\361518571890c5a5\2d263fd2-9dcd-4833-b207-7a901fe9626a\scratchpad\cdp\design\`
- Before: `before-00-landing.png`, `before-01-login.png`, `before-02-_Dashboard.png` … `before-20-_Compare_Buy.png` (every nav page), `before-40-dashboard-day.png`, `before-41-trade-detail.png`, `before-41b-trade-detail-lower.png`, `before-42-add-trade.png`, `before-43-import.png`, `before-44-collapsed.png`, phone `before-p0-landing.png`, `before-p1-dashboard.png`, `before-p-Performance.png`, `before-p-All_Trades.png`.
- After: `after-00-landing.png`, `after-01-login.png`, `after-02-Dashboard.png` … `after-17-Prop_Firms.png` (plus sub-tabs `after-07-Performance-P_L_charts.png`, `after-07-Performance-Report.png`, `after-10-Mindset-Emotions.png`), `after-40-dashboard-day.png`, `after-41-trade-detail.png`, `after-41b-trade-detail-lower.png`, `after-42-add-trade.png`, `after-43-import.png`, `after-44-collapsed.png`, `after-45-account-switcher.png`, `after-46-tooltip.png`, phone `after-p0-landing.png`, `after-p1-dashboard.png`, `after-p-Performance.png`, `after-p-Trade_Log.png`, `after-p-Coach.png`.
- Some pages captured in the first after-pass (Trade Log, Report, Risk, Daily Plan) were taken before a token fix that restored the green and red colours. Dashboard, Setups, Time, Performance, Charts, Emotions, Challenges and collapsed were re-shot after the fix.
