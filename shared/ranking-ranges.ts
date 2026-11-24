import type { PeriodMode } from "./power-rankings";

const periodStartBySeason: Record<number, string> = { 2026: "2025-10-06", 2027: "2026-09-29" };
export const periodsPerSeason = 14;
export const monthNames = ["October", "November", "December", "January", "February", "March", "April"];

export function formatDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function parseDate(value: string) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
export function shiftDate(value: string, days: number) { const date = parseDate(value); date.setDate(date.getDate() + days); return formatDate(date); }
export function periodEnd(value: string) { return shiftDate(value, 13); }
export function periodStart(season: number, period: number) {
  return shiftDate(periodStartBySeason[season], (period - 1) * 14);
}
export function latestPeriod(season: number) {
  let latest = 1;
  for (let period = 1; period <= periodsPerSeason; period += 1) {
    const end = parseDate(periodEnd(periodStart(season, period)));
    end.setHours(23, 59, 59, 999);
    if (Date.now() > end.getTime()) latest = period;
  }
  return latest;
}
export function monthRange(season: number, monthIndex: number) {
  const calendarMonth = monthIndex < 3 ? monthIndex + 10 : monthIndex - 2;
  const year = monthIndex < 3 ? season - 1 : season;
  const start = season === 2027 && monthIndex === 0 ? `${year}-09-29` : formatDate(new Date(year, calendarMonth - 1, 1));
  const end = formatDate(new Date(year, calendarMonth, 0));
  return { start, end };
}

export function rankingRange(season: number, mode: PeriodMode, index: number): { start?: string; end: string } {
  if (mode === "season") return { end: `${season}-04-30` };
  if (mode === "month") return monthRange(season, index);
  const start = periodStart(season, index);
  return { start, end: periodEnd(start) };
}
