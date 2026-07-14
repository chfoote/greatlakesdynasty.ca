import { supabase } from "./supabase";
import type { FantasyPlayer, PlayerSeasonWithRelations } from "./fantasyPlayers";
import type { FantasyTeam } from "./fantasyTeams";

export type TransactionAction =
  | "signed"
  | "called_up"
  | "waived"
  | "claimed"
  | "bought_out"
  | "retained"
  | "injured_reserve"
  | "long_term_injured_reserve"
  | "released_to_rfa_offer"
  | "matched_rfa_offer"
  | "traded";

export type LeagueTransaction = {
  id: number;
  player_season_id: number | null;
  player_id: number | null;
  fantasy_team_id: number | null;
  transaction_type: "signing" | "extension" | "trade" | "waiver" | "release";
  action: TransactionAction;
  transaction_date: string;
  season_year: number;
  salary: number | null;
  term_end_year: number | null;
  contract_group: string | null;
  notes: string | null;
  description: string | null;
  trade_offer_id: number | null;
  created_at: string;
  player: FantasyPlayer | null;
  fantasy_team: FantasyTeam | null;
  player_season: PlayerSeasonWithRelations | null;
};

export async function fetchLeagueTransactions() {
  const { data, error } = await supabase
    .from("league_transactions")
    .select("*, player:players(*), fantasy_team:fantasy_teams(*), player_season:player_seasons(*)")
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as LeagueTransaction[];
}

export async function postSigningTransaction(
  season: PlayerSeasonWithRelations,
  transactionDate: string,
  action: TransactionAction,
) {
  if (!season.fantasy_team_id) {
    throw new Error("Choose a fantasy team before posting a signing transaction.");
  }

  const { data, error } = await supabase
    .from("league_transactions")
    .upsert({
      player_season_id: season.id,
      player_id: season.player_id,
      fantasy_team_id: season.fantasy_team_id,
      transaction_type: "signing",
      action,
      transaction_date: transactionDate,
      season_year: season.season_year,
      salary: season.salary,
      term_end_year: season.term_end_year,
      contract_group: season.contract_group,
      notes: season.notes,
    }, { onConflict: "player_season_id" })
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data;
}
