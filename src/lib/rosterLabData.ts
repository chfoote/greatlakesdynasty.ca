import { supabase } from "./supabase";
import type { PlayerSeasonWithRelations } from "./fantasyPlayers";
import { fetchProspectRights } from "./prospectRights";
import { CURRENT_LEAGUE_SEASON } from "./leagueSeasons";

// Full contracts stay in component memory. Stable pagination prevents Supabase's
// row limit from silently dropping future seasons from the simulator.
export async function fetchRosterLabContracts() {
  const rows: PlayerSeasonWithRelations[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("player_seasons")
      .select("*, player:players(*), fantasy_team:fantasy_teams(*)")
      .order("id").range(offset, offset + 999).abortSignal(AbortSignal.timeout(12000))
      .overrideTypes<PlayerSeasonWithRelations[], { merge: false }>();
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export async function fetchRosterLabProspectRights() {
  const saved = import.meta.env.VITE_FARM_SNAPSHOTS === "true"
    ? await import("./farmSharedSnapshot").then(module => module.fetchFarmSharedSnapshot()) : null;
  // Only draft history is reused. Ownership and transactions are read fresh.
  return fetchProspectRights(CURRENT_LEAGUE_SEASON, saved?.drafts);
}
