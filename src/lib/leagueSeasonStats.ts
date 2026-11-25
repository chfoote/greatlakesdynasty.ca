import {
  fetchNhlDailyStats, fetchNhlGoalieStats, fetchNhlLiveSeasonStats, fetchNhlSkaterStats,
  getNhlStatsDate, mergeGoalieRecords, mergeSkaterRecords,
  type NhlGoalieRecord, type NhlSkaterRecord,
} from "./nhl";
import { CURRENT_LEAGUE_SEASON, playedAndCurrentSeasons } from "./leagueSeasons";
import { inheritNhlFreshness, markNhlFetched } from "./nhlFreshness";
import { NhlBaselineAvailable, savedNhl } from "./nhlSaved";
import { playerMetadata } from "./nhlPlayerMetadata";
import { supabase } from "./supabase";

type SeasonStats = { skaters: NhlSkaterRecord[]; goalies: NhlGoalieRecord[] };
type SeasonSnapshot = { generated_at: string; stats_through: string; source_stats: unknown };
const dayMs = 86_400_000;
const skaterFields = ["gamesPlayed", "goals", "assists", "plusMinus", "penaltyMinutes", "ppGoals", "ppPoints",
  "shGoals", "shPoints", "gameWinningGoals", "shots", "blockedShots", "hits", "totalFaceoffWins"];
const goalieFields = ["gamesPlayed", "gamesStarted", "wins", "losses", "otLosses", "goalsAgainst", "saves",
  "shutouts", "penaltyMinutes", "goals", "assists"];

function validRows(rows: unknown, name: string, fields: string[]) {
  if (!Array.isArray(rows) || !rows.length) return false;
  const ids = new Set<number>();
  return rows.every((row: Record<string, unknown>) => {
    if (!row || !Number.isSafeInteger(row.playerId) || Number(row.playerId) <= 0 || ids.has(Number(row.playerId))
      || typeof row[name] !== "string" || !(row.teamAbbrevs == null || typeof row.teamAbbrevs === "string")
      || !fields.every(field => typeof row[field] === "number" && Number.isFinite(row[field]))) return false;
    ids.add(Number(row.playerId));
    return true;
  });
}

function validStats(value: unknown): value is SeasonStats {
  const stats = value as SeasonStats | null;
  return Boolean(stats && validRows(stats.skaters, "skaterFullName", skaterFields)
    && stats.skaters.every(row => typeof row.positionCode === "string")
    && validRows(stats.goalies, "goalieFullName", goalieFields)
    && stats.goalies.every(row => (row.savePct === null || Number.isFinite(row.savePct))
      && (row.goalsAgainstAverage === null || Number.isFinite(row.goalsAgainstAverage))));
}

// Cache the database lookup, including misses, across the three page consumers.
// The key includes the hockey day so yesterday's baseline is never merged into
// a different day's live box scores while a new scheduled snapshot is pending.
const snapshots = new Map<string, { expiresAt: number; value: Promise<SeasonStats | null> }>();
async function savedSeason(season: number, today: string) {
  const key = `${season}:${today}`;
  const cached = snapshots.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = (async () => {
    try {
      const { data, error } = await supabase.from("power_ranking_snapshots")
        .select("generated_at, stats_through, source_stats")
        .eq("season_year", season).eq("mode", "season").eq("range_index", 0).eq("schema_version", 1)
        .abortSignal(AbortSignal.timeout(2500)).maybeSingle();
      if (error || !data) return null;
      const snapshot = data as SeasonSnapshot;
      const source = snapshot.source_stats as SeasonStats & { schema_version?: number } | null;
      const timestamp = Date.parse(snapshot.generated_at);
      const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - dayMs).toISOString().slice(0, 10);
      const through = season === CURRENT_LEAGUE_SEASON ? yesterday : `${season}-04-30`;
      if (snapshot.stats_through !== through || !Number.isFinite(timestamp) || timestamp > Date.now()
        || source?.schema_version !== 1 || !validStats(source)) return null;
      // Only the public NHL arrays enter the browser's NHL cache. League ranking
      // rows, rosters, and Supabase session data are never persisted there.
      const stats = {
        skaters: source.skaters.map(row => ({ ...row, teamAbbrevs: row.teamAbbrevs ?? "", birthDate: row.birthDate ?? playerMetadata.read(String(row.playerId))?.birthDate })),
        goalies: source.goalies.map(row => ({ ...row, teamAbbrevs: row.teamAbbrevs ?? "", birthDate: row.birthDate ?? playerMetadata.read(String(row.playerId))?.birthDate })),
      };
      markNhlFetched(stats.skaters, timestamp); markNhlFetched(stats.goalies, timestamp);
      return markNhlFetched(stats, timestamp);
    } catch { return null; }
  })();
  snapshots.set(key, { expiresAt: Date.now() + 300_000, value });
  if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value!);
  return value;
}

async function originalSeason(season: number): Promise<SeasonStats> {
  if (season === CURRENT_LEAGUE_SEASON) return fetchNhlLiveSeasonStats(season);
  const id = (season - 1) * 10000 + season;
  const [skaters, goalies] = await Promise.all([fetchNhlSkaterStats(id), fetchNhlGoalieStats(id)]);
  return inheritNhlFreshness({ skaters, goalies }, [skaters, goalies]);
}

export function fetchLeagueSeasonStats(season: number): Promise<SeasonStats> {
  if (import.meta.env.VITE_SEASON_SNAPSHOTS !== "true" || !playedAndCurrentSeasons.includes(season)) {
    return originalSeason(season);
  }
  const today = getNhlStatsDate();
  const current = season === CURRENT_LEAGUE_SEASON;
  return savedNhl(`league-season:${season}`, async () => {
    const baseline = await savedSeason(season, today);
    if (!baseline) return originalSeason(season);
    if (!current) return baseline;
    let daily: SeasonStats;
    try { daily = await fetchNhlDailyStats(today, { waitForRefresh: true }); }
    catch {
      throw new NhlBaselineAvailable(baseline, "Live NHL updates unavailable. Showing completed games through " + getNhlStatsDate(-1) + ".");
    }
    return inheritNhlFreshness({
      skaters: mergeSkaterRecords(baseline.skaters, daily.skaters),
      goalies: mergeGoalieRecords(baseline.goalies, daily.goalies),
    }, [baseline, daily], "latest-if-fresh");
  }, (value): value is SeasonStats => {
    // Legacy fallbacks also allow empty off-season reports and a debuting live
    // player whose name has not yet reached the season summary.
    const stats = value as SeasonStats | null;
    return Boolean(stats && Array.isArray(stats.skaters) && Array.isArray(stats.goalies)
      && [...stats.skaters, ...stats.goalies].every(row => row && Number.isSafeInteger(row.playerId)));
  }, current ? 30_000 : dayMs, { scope: current ? today : undefined, staleRetryMs: 5000 });
}

// Front Office can publish one position group even if the other NHL report
// fails. Historical fallback only requests the group that the roster needs.
export async function fetchLeagueSkaterStats(season: number): Promise<NhlSkaterRecord[]> {
  if (season === CURRENT_LEAGUE_SEASON) {
    try { return (await fetchLeagueSeasonStats(season)).skaters; }
    catch { return fetchNhlSkaterStats((season - 1) * 10000 + season); }
  }
  if (import.meta.env.VITE_SEASON_SNAPSHOTS === "true" && playedAndCurrentSeasons.includes(season)) {
    const saved = await savedSeason(season, getNhlStatsDate());
    if (saved) return saved.skaters;
  }
  return fetchNhlSkaterStats((season - 1) * 10000 + season);
}

export async function fetchLeagueGoalieStats(season: number): Promise<NhlGoalieRecord[]> {
  if (season === CURRENT_LEAGUE_SEASON) {
    try { return (await fetchLeagueSeasonStats(season)).goalies; }
    catch { return fetchNhlGoalieStats((season - 1) * 10000 + season); }
  }
  if (import.meta.env.VITE_SEASON_SNAPSHOTS === "true" && playedAndCurrentSeasons.includes(season)) {
    const saved = await savedSeason(season, getNhlStatsDate());
    if (saved) return saved.goalies;
  }
  return fetchNhlGoalieStats((season - 1) * 10000 + season);
}
