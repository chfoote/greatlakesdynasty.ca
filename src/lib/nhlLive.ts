import { nhlFetch } from "./nhlRequest.ts";
import { nhlStatsDate, type LiveSnapshot } from "../../shared/nhl-live.ts";
import { NhlRateLimitError } from "../../shared/nhl-policy.ts";

let latest: Pick<LiveSnapshot, "date" | "live" | "nextRefreshAt" | "generatedAt"> | undefined;
export const getLiveSchedule = () => latest;

export async function fetchNhlLiveSnapshot(date: string): Promise<LiveSnapshot> {
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
  return snapshot;
}
