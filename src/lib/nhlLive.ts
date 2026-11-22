import { savedNhl } from "./nhlSaved.ts";
import { markNhlFetched, markNhlSaved } from "./nhlFreshness.ts";
import { nhlFetch } from "./nhlRequest.ts";
import { nhlStatsDate, type LiveSnapshot } from "../../shared/nhl-live.ts";
import { NhlRateLimitError } from "../../shared/nhl-policy.ts";

let latest: Pick<LiveSnapshot, "date" | "live" | "nextRefreshAt" | "generatedAt"> | undefined;
export const getLiveSchedule = () => latest;

async function loadNhlLiveSnapshot(date: string): Promise<LiveSnapshot> {
  const response = await nhlFetch(`/nhl-web-api/live-snapshot/${date}`);
  if (response.status === 429) throw new NhlRateLimitError("NHL live data is temporarily rate limited (429). Please wait before refreshing.");
  if (!response.ok) throw new Error(`Unable to load NHL live snapshot (${response.status})`);
  const snapshot = await response.json() as LiveSnapshot;
  if (snapshot.date !== date || !Array.isArray(snapshot.scoreboard?.games) || !Array.isArray(snapshot.games)
    || !Number.isFinite(snapshot.generatedAt) || typeof snapshot.live !== "boolean"
    || !(snapshot.nextRefreshAt === null || Number.isFinite(snapshot.nextRefreshAt))) {
    throw new Error("NHL returned an invalid live snapshot.");
  }
  if (date === nhlStatsDate()) latest = snapshot;
  if (response.headers.get("X-NHL-Stale") === "1") return markNhlSaved(snapshot, snapshot.generatedAt);
  return markNhlFetched(snapshot, snapshot.generatedAt);
}

export async function fetchNhlLiveSnapshot(date: string, options: { waitForRefresh?: boolean } = {}): Promise<LiveSnapshot> {
  const snapshot = await savedNhl<LiveSnapshot>(`live:${date}`, () => loadNhlLiveSnapshot(date),
    (value): value is LiveSnapshot => Boolean(value && typeof value === 'object' && 'date' in value && value.date === date
      && 'games' in value && Array.isArray(value.games) && 'scoreboard' in value && value.scoreboard
      && typeof value.scoreboard === 'object' && 'games' in value.scoreboard && Array.isArray(value.scoreboard.games)
      && 'generatedAt' in value && Number.isFinite(value.generatedAt)
      && 'live' in value && typeof value.live === 'boolean' && 'nextRefreshAt' in value
      && (value.nextRefreshAt === null || Number.isFinite(value.nextRefreshAt))), 30_000, { ...options, staleRetryMs: 5000 });
  if (date === nhlStatsDate()) latest = snapshot;
  return snapshot;
}
