import { supabase } from "./supabase";
import type { CapAdjustments } from "./cap";

export type TeamCapAdjustmentTotal = CapAdjustments & {
  fantasyTeamId: number;
  seasonYear: number;
};

type TeamCapAdjustmentRow = {
  fantasy_team_id: number;
  season_year: number;
  buyout_penalty_total: number;
  retention_net: number;
  buyout_slots_used: number;
  retention_slots_used: number;
};

function normalize(row: TeamCapAdjustmentRow): TeamCapAdjustmentTotal {
  return {
    fantasyTeamId: row.fantasy_team_id,
    seasonYear: row.season_year,
    buyoutPenaltyTotal: Number(row.buyout_penalty_total) || 0,
    retentionNet: Number(row.retention_net) || 0,
    buyoutSlotsUsed: Number(row.buyout_slots_used) || 0,
    retentionSlotsUsed: Number(row.retention_slots_used) || 0,
  };
}

export async function fetchTeamCapAdjustmentTotals(options: { teamId?: number; seasonYear?: number; seasonYears?: number[] } = {}) {
  let query = supabase.from("team_cap_adjustment_totals").select("fantasy_team_id,season_year,buyout_penalty_total,retention_net,buyout_slots_used,retention_slots_used");
  if (options.teamId !== undefined) query = query.eq("fantasy_team_id", options.teamId);
  if (options.seasonYear !== undefined) query = query.eq("season_year", options.seasonYear);
  if (options.seasonYears?.length) query = query.in("season_year", options.seasonYears);
  const { data, error } = await query;
  if (error) throw error;
  return ((data || []) as TeamCapAdjustmentRow[]).map(normalize);
}
