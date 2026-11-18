// "Open on chart" link between journal trades and the market chart page.
// Trade views fire an event; App switches to the chart and passes the trade id on.
// The chart is owner-only, so the link is hidden until App knows the user is the owner.

let enabled = false;
export function setChartLinkEnabled(v: boolean) { enabled = v; }

/** The chart only has NQ prices (MNQ tracks the same index). */
export function canOpenOnChart(symbol?: string | null): boolean {
  return enabled && !!symbol && /(^|[^A-Z])M?NQ/i.test(symbol);
}

export const OPEN_CHART_EVENT = 'jc:open-chart';
export function openOnChart(tradeId: number) {
  window.dispatchEvent(new CustomEvent(OPEN_CHART_EVENT, { detail: { tradeId } }));
}
/** Open the chart in bar replay at 9:25 ET on a day (YYYY-MM-DD). */
export function openReplayDay(day: string) {
  window.dispatchEvent(new CustomEvent(OPEN_CHART_EVENT, { detail: { replayDay: day } }));
}
