# Journal Chart — agreed decisions (2026-11-16)

Read together with CHART_BUILD_SPEC.md. Where the two differ, this file wins.

## Kay's answers
- Chart is for Kay only. Lock the Market Chart page and bar upload to an admin flag (none exists yet — add `users.is_admin`). No subscriber access: CME data may not be redistributed.
- Trade time zones: Tradovate eval + TradingView paper = BC time (UTC-7 all year), Fyers = IST. Backtesting (RoboQuant) = check the data. Add `accounts.timezone`.
- CSVs came from Databento, so the updater uses `NQ.v.0` (rolls in the files land Mon/Tue of expiry week, consistent with volume roll). Confirm by comparing one roll week on the first paid call.
- Chart clock: ET / BC switch button, default ET.
- Look and feel: as close to TradingView as possible — layout (left drawing bar, top bar, right price scale), dark colours, shortcuts, mouse behaviour. No TradingView code, logo or assets.

## Changes to the spec
1. Never commit the CSVs (public repo, licensed data). Import from `C:\Users\wolfm\Downloads\NQ_front_1m_*.csv`; add `data/` to `.gitignore`. `NQ_front_1m_2021 (1).csv` is an identical duplicate — skip it.
2. Slim bars table: prices as integers (price x 100), no repeated symbol text. Neon free cap is 0.5 GB shared with the journal — check current usage before importing.
3. No auto screenshots stored in the DB (screenshots are base64 in Postgres). Save chart state (time, timeframe) and redraw via "Open on chart".
4. Databento updater: set END to Databento's reported available end (`metadata.get_dataset_range`), not "now". The historical API may not serve the last ~24h of CME data — confirm on first run, and relax the "latest bar = last completed minute" check to match.
5. Updater posts bars to the app's upload endpoint with an import token; the DB password stays on Render only. GitHub secrets: `DATABENTO_API_KEY`, `BARS_IMPORT_TOKEN`.
6. Section 3 is blocked until Kay creates a GitHub token with `workflow` scope (current one cannot push workflow files).
7. 4h bars anchor at 6pm ET (18, 22, 2, 6, 10, 14), like TradingView.
8. Import script in Node (repo has no Python). Python is fine inside the GitHub Action.
9. Precompute 1h and D bars at import/update so higher timeframes don't scan 1.77M rows per request.
10. Mark contract roll dates on the chart (front-month, not back-adjusted: price jumps mid-session four times a year).

## Verified against the CSVs
- 1,770,120 rows, 2021-11-16 00:00 UTC to 2026-11-15 23:59 UTC. Timestamp format `2024-01-01T23:00` (UTC, no seconds). `symbol` column holds the contract (e.g. NQH4).
- 2024-03-05 NY session: O 18133.75, H 18135.25, L 17832.50, C 17931.75. Full session = 1,380 one-minute bars, 276 five-minute bars.

## Model routing (Kay's preference)
Main session runs on Fable 5.2 and keeps the hard parts. Mechanical, well-specified chunks go to smaller-model subagents.
- Haiku: .gitignore, CSS/theme colours, nav entry, simple CRUD boilerplate.
- Sonnet: import script, drawings/settings endpoints, standard indicators, toolbar UI.
- Opus / Fable: bar aggregation SQL (ET buckets, DST, CME session day), replay engine and fill logic, custom drawing overlays, undo/redo, position tool, time-zone mapping of trades.

## Status
- 2026-11-16 — Section 2 done. `bars_1m` holds 1,770,120 bars (155 MB; database 186 MB of 500). Hourly + daily bars precomputed in `bars_agg`. `GET /api/bars` and `/api/bars/meta` are admin only (`users.role = 'admin'`, set on Kay's user). Checks: `npx ts-node scripts/check_bars.ts` (all pass). Import script written by Sonnet, the rest by Fable.
- 2026-11-16 — Phase 1 done. Market Chart page (admin only) with KLineChart 10.1.0: timeframes + type-a-number, go to date, scroll back, ET/BC clock, dark/light, log + auto scale, session shading, ETH/RTH, levels (PDH/PDL/PDC, ONH/ONL, opens, round 100s), roll markers, indicators EMA/SMA/VWAP/BOLL/VOL/RSI/ATR/MACD with editable inputs. Settings saved per user (`chart_settings`). Server: RTH bars (tf 61/1441 in bars_agg), forward paging (`after=`), `/api/bars/levels`. Browser-tested locally against Neon. Settings endpoint by Sonnet, stylesheet by Haiku, rest by Fable/Opus.
- 2026-11-16 — Phase 2 done. Left drawing toolbar: trend line (Alt+T), horizontal line (Alt+H) and ray (Alt+J) with price labels, vertical line (Alt+V), rectangle (Alt+Shift+R), fib retracement (Alt+F), parallel channel, text, arrow, long/short position (R:R, $ for NQ/MNQ, qty, outcome on the bars inside the box). Measure: Shift+drag or ruler (points, %, ticks, NQ/MNQ $, bars, time). Magnet off/weak/strong, lock one/all, hide all, remove all (click twice), delete key, undo/redo (Ctrl+Z / Ctrl+Y, 100 steps). Edit bar for the selected drawing: colour, width, dash style, text, qty, contract. Drawings stored as real times + prices (rounded to 0.25) in `drawings` (one list per user + symbol) and snapped to the bar of whichever timeframe is shown. Browser-tested; test drawings removed afterwards. Drawings endpoint by Sonnet, rest by Opus.
- Next: Phase 3 (bar replay + trade logging). Known gaps: drawing points older than the loaded bars are placed by calendar time until that data loads; level labels can overlap.
- 2026-11-16 — Phase 3 done (built by Opus; Fable review pending). Bar replay: Replay button → click a candle (it becomes the last one shown) or Random date (a weekday at 9:00am ET). → / ← step one candle (or one minute in 1m mode), Space plays (0.5–10 steps/s). Candles of any timeframe are rebuilt from 1-minute bars as they form; timeframe, RTH and drawings keep working during replay; levels never use bars after the cursor. Trading: Buy/Sell ticket (qty, NQ/MNQ, stop in points, target in R or points, setup, note) → market fill at the close of the current minute; bracket on the chart (stop/target handles draggable); stop and target checked on every 1-minute bar after the entry minute (gaps fill at the open, stop wins when both are touched in one bar). Closed trades are saved via `POST /api/replay/trades` to the chosen account (default "Backtesting") in an attempt labelled "Bar replay", times converted to the account's clock (`accounts.timezone`, NULL = New York), with session, timeframe, planned R:R, tags Bar replay + Long/Short. Verified: 2024-03-05 long at 18,080.50 (09:39 ET close), 20-pt stop / 2R → stopped on the 09:43 minute, −1R −$400, same as an independent SQL check; trade showed in All Trades and Performance; test trade and run removed afterwards. Save endpoint by Sonnet, the rest by Opus.

## For the Fable review (Phase 3)
- `client/src/chart/replay.ts` — stepping (`stepForward`, `stepBack`, `placeCursor`), the forming candle, `fillOn` order of checks, buffer extension/trim (`extend` shifts `idx` after dropping bars).
- `client/src/components/MarketChart.tsx` — replay branch in `loadBars` (history `to = barTime(cursor)` + forming candle), `subscribeBar` used to push candles, hotkeys disabled during replay, level clamp in `refreshLevels`.
- `src/api/replay.ts` — validation, P&L/planned R:R/session maths, tz conversion, idempotent insert on `replay_<client_id>`.
- Known limits: no screenshots (decision 3); one position at a time, no scaling in/out; no commission (Backtesting cost is 0); the "Bar replay" attempt gets the highest seq, so it becomes the account's current run and a later CSV import into Backtesting would land in it unless a new run is started first; Performance page shows ₹ for USD accounts (pre-existing).
- 2026-11-16 — Phase 4 done (Opus). "Open on chart" (🕯️) in All Trades and the trade detail window, shown only for NQ/MNQ trades and only to the owner: switches to the chart centred on the trade with entry/exit markers, stop/target lines and a trade chip. Trade times are converted with the account's clock: new `accounts.timezone` set from the account right-click menu (🕐 Time zone), SQL helpers `journal_wall_to_utc` / `journal_utc_to_wall` (special value `BC` = America/Vancouver before 2026-03-08, fixed UTC-7 after; NULL = New York). Set: Backtesting + old = New York (verified: 372/400 entries inside their minute), us future (TradingView paper) = UTC (verified: 22/23; NOT BC as first assumed), Fyers = India, prop acc = BC (no NQ trades left to verify). Day notes panel (Notes button) beside the chart: same notes as Pre-Market, follows the trading day at the chart's right edge, the replay cursor, or the opened trade; autosaves. Server endpoints by Sonnet, the rest by Opus. Known: trades on the next contract around a roll show off the candles (chart is front-month); trade-detail button not clicked in the browser test (same code path as All Trades, which was).
- 2026-11-17 — Review (Fable + Opus): replay save after the time-zone change, round trip and duplicate protection re-tested; fixed rupee sign on Performance/Charts/Strategy Builder, stale chart focus, replay position lost on leaving the page. Section 3 done differently from the spec: no GitHub Action (Render free plan sleeps, and the token lacked `workflow` scope) — opening the chart starts a background Databento update (`src/bars/ingest.ts`, at most every 30 min, needs `DATABENTO_API_KEY` on Render) plus a Data panel with "Update now" and "Upload bars CSV". Databento HTTP details could not be confirmed from the docs (they document the Python client), so the parser accepts both plain and raw CSV forms (`scripts/test_ingest.ts`) and errors are shown in the panel; first real run needs watching. Pushed 2026-11-17 (`405cda6..f171b30`) via the GitHub CLI login (the token in the remote URL was dead and has been removed); live on Render and checked in the browser.
- 2026-11-18 — Multi-chart (Opus): up to 4 windows (`client/src/components/ChartPane.tsx` per window, `MarketChart.tsx` = workspace, shared defs in `client/src/chart/config.ts`). One `ReplayEngine` (chart-agnostic) drives every window through a `ReplayView` each; bar steps use the active window's timeframe. `DrawingStore` = one shared drawing list, a `DrawingController` per window. Crosshair sync via `executeAction` (no feedback loop: it sets `notExecuteAction`). Near-live: client polls `GET /api/bars/live` every minute (server throttles Databento to once per 50 s; needs `DATABENTO_API_KEY`). "TV live" window = TradingView free widget; CME futures are refused in widgets ("only available on TradingView"), so it shows `OANDA:NAS100USD` (real-time Nasdaq-100 CFD, different price level from NQ). Verified headless (local Chrome via CDP, script in the session scratchpad): 4 windows 1m/5m/15m/1h load; replay keeps every window's newest candle on the cursor minute with identical close at each step; trade bracket + marker on all windows; saved; TV window loads and is excluded from replay. Settings saved with the old single `tf` migrate to `panes[0]`.

## Coach + Backtest Lab (2026-11-17)

**Coach (Market Chart → "Coach" button)**
- Rules live in chart settings (`coach`): prime-time windows (ET), min R:R, max $ risk, trades/day, losers/day, daily $ stop, cooldown after a loss, setup required, no widening the stop, pause-on-break, Claude mode (off / when asked / every trade).
- Buy/Sell pauses the replay. Submitting checks the order instantly (`chart/coach.ts`); a break shows the list with Fix / Cancel / "Take anyway (log rule break)".
- Dragging the stop further away pauses and asks: Put it back, or Keep (logged as a rule break).
- After each close: losers/day, daily stop and trade limit are checked; a hit pauses the replay.
- Rule breaks are saved with the trade: tag "Rule break" + "Rule breaks: …" line in the notes (`POST /api/replay/trades` `rule_breaks`).
- Claude (`POST /api/coach/replay`, Opus 5.5 + Opus 4.8 fallback): sees the candles on every open journal window up to the replay cursor only, EMA9/21 and ATR14 per window, day levels as of the cursor, the order/position, today's trades and the rule results. "Every trade" mode reviews each entry before it is placed (GO places it, CAUTION/STOP asks; taking a STOP is logged as a rule break) and each exit after it closes (STOP pauses). Also works on the live chart (forward testing): Ask / "Read the chart".
- Needs ANTHROPIC_API_KEY with credit on Render. About 1–3¢ per review.

**Backtest Lab (sidebar → Planning → Backtest Lab)**
- Stats engine `client/src/utils/backtestStats.ts` (checked by `scripts/check_backtest_stats.ts`, 72 checks).
- Filters: attempt, setup, session, size multiplier. Days roll at 6pm ET for New York-clock accounts.
- Tiles: net, win rate, PF, expectancy ($ and R), payoff, max DD (+ days under water), recovery factor, Sharpe/Sortino (daily, annualised), green days, best/worst day, streaks, trades/day.
- Equity and drawdown charts with hover.
- Prop simulator: replays the trades as a challenge from every start day (up to 400), rules pre-filled from the account's prop fields (fallback 50k / 3k target / 2k EOD trailing). Intraday trailing uses closed-trade P&L only.
- Monte Carlo: reshuffles trade order 500–5000 times: max drawdown median / 95th pct, chance of hitting the challenge drawdown, losing streaks, 20 sample curves.
- Test (headless, live DB): Backtesting account 8117 trades → 25% pass / 75% fail at 50k/3k/2k EOD. Coach gate showed 4 breaks, widen modal, trade saved with tag + notes; test trade 44184 and attempt 78 deleted.

## Any timeframe (2026-11-17)
- Any whole minutes 1–1439 (2m, 7m, 45m, 90m…), hours (2h, 6h, 12h) and D. Set with the "+" button (Show, or Show + add button; right-click a custom button to remove it), "Custom…" in a window's timeframe menu, or by typing e.g. 45 / 2h then Enter on the chart. Custom buttons are saved in chart settings (`customTfs`, max 10).
- Timeframes that divide the hour keep UTC-aligned buckets. Others count from each session's open (6pm ET, or 9:30am ET for RTH), like TradingView; e.g. 45m bars run 18:00, 18:45, … and restart the next evening. Hour multiples are built from the hourly table, the rest from 1-minute bars.
- Server (`binSession` in store.ts) and chart (`barTime`) were checked to agree on every bar for 2/7/45/90/120/360/720/240/5/60m, full session and RTH, across the March DST change.
- Weekly/monthly are not offered: replay builds the forming candle from buffered 1-minute bars and keeps only ~1 day of them.

## TV preset: levels, chart style, NQ-SYS v3, tool templates (2026-11-17)
- Read from Kay's TradingView (Chrome, layout HWg0QWTO, NQ1! 15m) through the page's chart API.
- **Drawings:** all 199 (25 horizontal lines, 126 rectangles, 41 trend lines, 2 paths, 1 channel, 3 long + 1 short positions) exported to `scripts/tv_import/drawings_2026-11-17.txt` (checksums of prices, times and styles matched TradingView exactly) and imported with `npx ts-node scripts/import_tv_drawings.ts <file> <userId>` as ids `tv-<n>` (re-running replaces them, other drawings kept). Paths become red trend lines (no path tool here).
- Drawing model gained `fill`, `extL/extR`, `text`+`textColor` labels on lines, per-drawing fib `levels`/`fibFill`; colours may be rgba().
- **Chart style "TV"** (Layout panel → Chart style; default for every layout): grey #9c9c9c background, cyan up / black down bodies coloured against the previous close, black wicks and borders, no grid, white 2px solid crosshair, black scale text, session breaks as dashed lines instead of session shading. "Standard" returns to the green/red look.
- **NQ-SYS v3** (`chart/nqsys.ts`, indicator JC_NQSYS, on by default): port of `trading-system/pine/NQ_System_v3.pine` with the inputs Kay uses on TradingView (= Pine defaults). Delta uses each bar's signed volume (no lower-timeframe data); delta S/R lines not drawn; 15m EMA and PDH/PDL warm up from loaded bars only.
- **Templates** (`chart/templates.ts`): all of Kay's TradingView drawing templates (hline 2, hray 6, rect 2, trend 5, fib 3, vline, long, short). Missing ones were created on both sides from the styles he uses: rect "zone red", "zone purple", trend "white", path, channel — saved into his TradingView too. The edit bar has a Template menu; the last template used for a tool becomes that tool's default.
- Not ported: TradingView tools without an equivalent here (fixed-range volume profile, brush, highlighter, date range, Gann square, path).

## Remaining TradingView favourite tools (2026-11-17)
- Added: Path (click points, double-click or Enter to finish), Brush and Highlighter (drag; strokes stored as raw time/price points and drawn between bars, so they keep their shape on any timeframe; dragging moves the whole stroke), Date range, Date and price range (bars, time, volume, price change), Gann square (levels 0.25/0.382/0.5/0.618/0.75, fans and diagonals), Fixed range volume profile (24 rows from the chart's own bars, up/down volume, 70% value area, POC/VAH/VAL).
- Templates: Gann "k" and Path "path" from TradingView.
- Volume profile uses the bars of the window's timeframe (TradingView uses a lower timeframe), so rows can differ slightly.
- End-to-end headless test on live data: 30/30 checks passed (every new tool drawn, saved and deleted; templates; NQ-SYS on; 4/2-window layouts; Standard/TV styles; 45m timeframe; replay with coach gate and saved trade; Backtest Lab; Dashboard/Performance/All Trades/AI Coach/Challenges pages), no console errors. Test trade 44185 + attempt 79 deleted; Kay's chart settings restored.
