import { CURRENT_LEAGUE_SEASON, FIRST_LEAGUE_SEASON } from "../src/lib/leagueSeasons.ts";
import { nhlStatsDate } from "./nhl-live.ts";

export type RecordNhlRange = { season_year: number; start_date: string; end_date: string };
export type RecordBoundary = { season_year: number; transaction_date: string; action: string; transaction_type: string };
export const recordRangeKey = (range: RecordNhlRange) => `${range.season_year}:${range.start_date}:${range.end_date}`;
export function previousRecordDate(date: string) {
  return new Date(Date.parse(`${date}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10);
}
// Both current totals and the previous-day movement comparison need a completed
// tail. Closed trade/call-up spans can be reused by every franchise and visitor.
export function recordBookRanges(boundaries: RecordBoundary[], now = Date.now()) {
  const through = nhlStatsDate(-1, now);
  const ranges = new Map<string, RecordNhlRange>();
  const add = (range: RecordNhlRange) => { if (range.start_date <= range.end_date) ranges.set(recordRangeKey(range), range); };
  for (let year = FIRST_LEAGUE_SEASON; year <= CURRENT_LEAGUE_SEASON; year++) {
    const start = `${year - 1}-07-01`;
    const end = year === CURRENT_LEAGUE_SEASON ? through : `${year}-06-30`;
    add({ season_year: year, start_date: start, end_date: end });
    const dates = [...new Set(boundaries.filter(row => row.season_year === year
      && (row.action === "called_up" || row.transaction_type === "trade")
      && row.transaction_date >= start && row.transaction_date <= end).map(row => row.transaction_date))].sort();
    const starts = [...new Set([start, ...dates])];
    starts.forEach((value, i) => add({season_year:year,start_date:value,end_date:i+1<starts.length?previousRecordDate(starts[i+1]):end}));
    if (year === CURRENT_LEAGUE_SEASON) {
      const previous = previousRecordDate(through);
      add({season_year:year,start_date:start,end_date:previous});
      const tail = [...starts].reverse().find(value=>value<=previous);
      if (tail) add({season_year:year,start_date:tail,end_date:previous});
    }
  }
  return [...ranges.values()];
}
