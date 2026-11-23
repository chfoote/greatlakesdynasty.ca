import { nhlStatsDate, type LiveSnapshot } from "../../shared/nhl-live.ts";
import { fetchNhlLiveSnapshot, getLiveSchedule } from "./nhlLive.ts";

type Schedule = Pick<LiveSnapshot, "date" | "live" | "nextRefreshAt" | "generatedAt">;

export function shouldRefreshNhl(options: {
  now: number; date: string; mode: "live" | "season"; lastAttempt: number; lastSuccess: number;
  schedule?: Schedule; visible: boolean;
}) {
  const { now, date, mode, lastAttempt, lastSuccess, schedule, visible } = options;
  if (!visible) return false;
  const interval = mode === "season" && !schedule?.live ? 300_000 : 30_000;
  if (now - lastAttempt < interval) return false;
  // Completed-game totals and yesterday's baseline can recover/correct before
  // today's puck drop. A quiet live schedule must not stop season-data recovery.
  if (mode === "season" && !schedule?.live) return true;
  if (!schedule) return now - lastAttempt >= (mode === "live" ? 30_000 : 300_000);
  if (schedule.date !== date) return true; // One refresh at the next league day.
  if (schedule.live) return true;
  if (schedule.nextRefreshAt !== null) return now >= schedule.nextRefreshAt;
  // Confirm the final result once after a live-to-final transition, then stop.
  return lastSuccess < schedule.generatedAt;
}

export function startNhlPolling(refresh: () => Promise<unknown>, mode: "live" | "season", selectedDate?: string) {
  let stopped = false;
  let busy = false;
  let lastAttempt = Date.now();
  let lastSuccess = 0;
  const tick = async () => {
    const date = nhlStatsDate();
    if (stopped || busy || (selectedDate && selectedDate !== date)) return;
    if (!shouldRefreshNhl({ now: Date.now(), date, mode, lastAttempt, lastSuccess,
      schedule: getLiveSchedule(), visible: document.visibilityState === "visible" && navigator.onLine !== false })) return;
    busy = true;
    lastAttempt = Date.now();
    try {
      if (mode === "live" || getLiveSchedule()?.live) await fetchNhlLiveSnapshot(date, { waitForRefresh: true });
      if (!stopped && await refresh() !== false) lastSuccess = Date.now();
    }
    catch { /* Existing data stays visible; the next scheduled check can recover. */ }
    finally { busy = false; }
  };
  // Local clock checks cost no CDN/Worker requests. No overnight network polling.
  const timer = window.setInterval(() => void tick(), 30_000);
  const onVisible = () => { void tick(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
}
