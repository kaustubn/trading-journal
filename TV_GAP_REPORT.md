# Market Chart vs TradingView — gap report (2026-11-17)

How this was checked: every drawing tool was placed, edited, dragged, templated and deleted in a headless browser on live data (tests t13, t18, t20, t21: all passed, no console errors), and candles were compared with Kay's TradingView (identical on 24h and Day session; see CHART_FIXES.md).

## What the journal chart already matches
Candles (same data as TradingView), timeframes incl. custom, 1–4 windows with synced crosshair and synced replay, Kay's colours / chart settings / status line, indicator legend with hide / settings / remove, saved layouts, all 16 of Kay's favourite drawing tools + favourites bar, drawing templates, magnet, stay-in-drawing-mode, right-click to cancel, undo / redo, measure, countdown to bar close, session breaks.

## Missing vs TradingView — ranked by value for NQ day trading
| # | Feature | Why it matters | Effort |
|---|---------|----------------|--------|
| 1 | **Object tree** (list of drawings: hide / lock / delete, filter by type, "show on these timeframes only") | 200+ drawings: find, clean up, hide old zones per timeframe | M |
| 2 | **Time sync between windows** (scroll or jump one window, the others follow) | Multi-timeframe reading without scrolling 4 charts | S |
| 3 | **Volume profile: visible range + session (daily) profile** | Real VAH / VAL / POC instead of NQ-SYS's VWAP proxy | M |
| 4 | **Anchored VWAP** tool | Standard futures level from a swing / open | S |
| 5 | **Alerts** on price / drawn lines (live + forward test) | Stop staring at the screen | M |
| 6 | More drawing tools: ray / extended line / info line, Fib extension, ellipse / circle, callout / note, price label, arrow markers, XABCD / head & shoulders / Elliott patterns | Completeness | M (bundle) |
| 7 | Chart types: Heikin Ashi, hollow candles, line, area | Reading trend / clean views | S |
| 8 | Copy drawing (Ctrl + drag), clone, bring to front / back | Faster zone work | S |
| 9 | Compare symbols (ES, YM overlay) | SMT divergence | L (needs ES data) |

## Backtesting / forward-test improvements (beyond TradingView's replay)
| # | Feature | Why | Effort |
|---|---------|-----|--------|
| 1 | **Scale in / scale out** (partials, several orders at once, move stop to break-even button) | Kay's plans use T1 / T2 partials; today replay allows one position | M |
| 2 | **Hotkeys** in replay / forward test: B buy, S sell, F flatten, Shift+B limit at cursor | Speed, like a real DOM | S |
| 3 | **Auto chart screenshot saved with every replay trade** | Review in the journal without re-opening the chart | S |
| 4 | **Session stats strip** (P&L, R, win rate, max drawdown of this replay session) + equity mini-curve | Know when to stop | S |
| 5 | **Day finder**: start replay on days matching a filter (trend day, ATR > X, gap up, news day, your losing days) | Practise the conditions you struggle with | M |
| 6 | "Next day 9:25" button and "skip to the open" | Faster session-to-session practice | S |
| 7 | Quick tags at exit: mistake / emotion / followed plan | Feeds Discipline and Emotions pages | S |
| 8 | Order flow (footprint, DOM) | Needs tick data (not in 1-minute data) | Not possible with current data |

## Suggested next build order
Time sync (2) → scale in/out + hotkeys + break-even button → screenshot on save + session stats → object tree → session / visible-range volume profile + anchored VWAP → alerts → extra drawing tools bundle.
