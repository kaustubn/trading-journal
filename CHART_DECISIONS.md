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
