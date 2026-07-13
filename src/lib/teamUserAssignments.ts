import { supabase } from "./supabase";
import type { FantasyTeam } from "./fantasyTeams";
import type { Profile } from "./profiles";

export type TeamUserAssignment = {
  id: number;
  user_id: string;
  user_email: string | null;
  fantasy_team_id: number;
  season_year: number;
  role: "owner" | "co_owner" | "admin";
  created_at: string;
  updated_at: string;
};

export type TeamUserAssignmentWithTeam = TeamUserAssignment & {
  fantasy_team: FantasyTeam | null;
  profile: Profile | null;
};

export async function fetchUserTeamAssignment(
  userId: string,
  seasonYear: number,
) {
  const { data, error } = await supabase
    .from("team_user_assignments")
    .select("*, fantasy_team:fantasy_teams(*), profile:profiles(*)")
    .eq("user_id", userId)
    .eq("season_year", seasonYear)
    .maybeSingle();

  if (error) throw error;
  return data as TeamUserAssignmentWithTeam | null;
}

export async function fetchLatestUserTeamAssignment(userId: string) {
  const { data, error } = await supabase
    .from("team_user_assignments")
    .select("*, fantasy_team:fantasy_teams(*), profile:profiles(*)")
    .eq("user_id", userId)
    .order("season_year", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as TeamUserAssignmentWithTeam | null;
}

export async function fetchTeamUserAssignments(seasonYear: number) {
  const { data, error } = await supabase
    .from("team_user_assignments")
    .select("*, fantasy_team:fantasy_teams(*), profile:profiles(*)")
    .eq("season_year", seasonYear)
    .order("user_email", { ascending: true, nullsFirst: false });

  if (error) throw error;
  return (data ?? []) as TeamUserAssignmentWithTeam[];
}

export async function upsertUserTeamAssignment({
  userId,
  userEmail,
  fantasyTeamId,
  seasonYear,
}: {
  userId: string;
  userEmail: string;
  fantasyTeamId: number;
  seasonYear: number;
}) {
  const { data, error } = await supabase
    .from("team_user_assignments")
    .upsert(
      {
        user_id: userId,
        user_email: userEmail,
        fantasy_team_id: fantasyTeamId,
        season_year: seasonYear,
        role: "owner",
      },
      { onConflict: "user_id,season_year" },
    )
    .select("*, fantasy_team:fantasy_teams(*), profile:profiles(*)")
    .single();

  if (error) throw error;
  return data as TeamUserAssignmentWithTeam;
}

export async function upsertTeamUserAssignment({
  userId,
  userEmail,
  fantasyTeamId,
  seasonYear,
}: {
  userId: string;
  userEmail: string | null;
  fantasyTeamId: number;
  seasonYear: number;
}) {
  const { data, error } = await supabase
    .from("team_user_assignments")
    .upsert(
      {
        user_id: userId,
        user_email: userEmail,
        fantasy_team_id: fantasyTeamId,
        season_year: seasonYear,
        role: "owner",
      },
      { onConflict: "user_id,season_year" },
    )
    .select("*, fantasy_team:fantasy_teams(*), profile:profiles(*)")
    .single();

  if (error) throw error;
  return data as TeamUserAssignmentWithTeam;
}

export async function deleteTeamUserAssignment(id: number) {
  const { error } = await supabase
    .from("team_user_assignments")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
