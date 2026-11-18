# Market Chart — Kay's fix list (2026-11-17)

Status: [ ] to do · [~] in progress · [x] done (commit) · [—] not possible / needs Kay

## Batch 1 — quick, high impact
- [x] 18. Changing timeframe jumps to the start → stay on the same date/time.
- [x] 5. BC time wrong in the "TV live" window (shows ET).
- [x] 13. Candle countdown (time to close) under the last-price label on the right, like TradingView.
- [x] 10. Session open/close: super-light vertical line; remove the yellow (ORB) and grey (IB) vertical zones.
- [x] 16. RTH / ETH button is hard to understand → clear names.
- [x] 8. Tools: right-click cancels / deselects the tool; option to keep drawing (tool stays on) like TradingView.
- [x] 9. Path tool can't be finished → double-click, right-click, Enter, Esc and a Finish button all work.
- [x] 4. Clicking Indicators: panel looks jumbled / mixed.

## Batch 2 — TradingView-grade controls
- [x] 1. Indicator control: legend on the chart per indicator with hide (eye), settings (gear: inputs + colours), remove; option to hide indicator names / values like TradingView.
- [x] 2. Volume indicator: settings and colours like TradingView (match Kay's TV).
- [x] 12. Chart settings dialog like TradingView (Symbol / Status line / Scales / Canvas …).
- [x] 3. Layouts: create, save, rename and delete your own layouts (not only TV / Standard).

## Batch 3 — workspace + reliability
- [x] 7 / 19. Tool settings bar, indicator panel and other floating panels: draggable around the screen and hideable.
- [x] 17. Favorites toolbar with Kay's TradingView favourite tools: floating, draggable, hideable.
- [x] 11. Tools lag / get stuck: full test of every tool, fix performance.
- [x] 15. TradingView vs journal candles differ: compare RTH and ETH side by side and make them match.
- [x] 14. TradingView-expert audit: hard-run every tool, list what is missing, improve backtesting tools.

## Needs Kay
- [—] 6. Al Brooks books / Encyclopedia: paid, copyrighted material — cannot download it. If Kay owns copies, put the files in trading-system\mentor\books and run /mentor-book.

## Findings
- #11 Lag: every drawing change re-sent all ~200 drawings to every chart window. Now only changed drawings are updated: 0.3 ms per edit with 204 drawings.
- #15 TradingView vs journal candles (checked 2026-11-17 from Kay's TradingView, NQ1!): 24h (ETH) 1h candles Nov 1–15 and 15m candles Nov 13 + 15 are identical (open, high, low, close, time); Day session (RTH) 15m candles Nov 13 identical and 1h RTH candles (9:30-anchored) identical. The differences Kay sees come from (1) TradingView's time zone America/Vancouver, which TradingView shows as UTC-8 in winter while the journal's BC is UTC-7 (BC's actual time) — every candle looks one hour apart; fix: TradingView → right-click the clock → Time zone → (UTC-7) Phoenix; (2) B-ADJ (back-adjusted rolls) when switched on in TradingView shifts prices before the last roll.
- #14 Audit + ranked missing features and backtesting improvements: TV_GAP_REPORT.md
