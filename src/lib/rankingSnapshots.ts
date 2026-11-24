import type { PeriodMode, RankingResults } from "../../shared/power-rankings";
import { supabase } from "./supabase";

export type RankingSnapshot = {
  generated_at: string;
  stats_through: string;
  results: RankingResults;
};

export async function fetchRankingSnapshot(season: number, mode: PeriodMode, index: number, signal: AbortSignal) {
  const { data, error } = await supabase.from("power_ranking_snapshots")
    .select("generated_at, stats_through, results")
    .eq("season_year", season)
    .eq("mode", mode)
    .eq("range_index", index)
    .eq("schema_version", 1)
    .abortSignal(signal)
    .maybeSingle();
  if (error || !data || !data.results) return null;
  const snapshot = data as RankingSnapshot;
  return Array.isArray(snapshot.results.playerRankings)
    && Array.isArray(snapshot.results.teamRankings)
    && Array.isArray(snapshot.results.goalieTandems) ? snapshot : null;
}
