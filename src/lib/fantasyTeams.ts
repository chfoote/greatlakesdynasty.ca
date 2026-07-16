import { supabase } from "./supabase";

export type FantasyTeam = {
  id: number;
  team_name: string;
  abbreviation: string;
  logo: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  manager_name: string | null;
  manager_since: string | null;
  eastern_farm_system: string | null;
  western_farm_system: string | null;
  championships: number;
  runner_up_finishes: number;
  third_place_finishes: number;
  created_date: string;
  active: boolean;
  notes: string | null;
};

export type FantasyTeamInput = {
  team_name: string;
  abbreviation: string;
  logo: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  manager_name: string | null;
  manager_since: string | null;
  eastern_farm_system: string | null;
  western_farm_system: string | null;
  championships: number;
  runner_up_finishes: number;
  third_place_finishes: number;
  active: boolean;
  notes: string | null;
};

export type FantasyTeamManagerTenure = {
  id: number;
  fantasy_team_id: number;
  manager_name: string;
  start_season: number;
  end_season: number | null;
};

export type FantasyTeamFinish = {
  id: number;
  fantasy_team_id: number;
  season_year: number;
  placement: 1 | 2 | 3;
};

export async function fetchFantasyTeams(includeInactive = false) {
  let query = supabase
    .from("fantasy_teams")
    .select("*")
    .order("id", { ascending: true });

  if (!includeInactive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FantasyTeam[];
}

export async function fetchFantasyTeamByAbbreviation(
  abbreviation: string,
  includeInactive = false,
) {
  let query = supabase
    .from("fantasy_teams")
    .select("*")
    .ilike("abbreviation", abbreviation);

  if (!includeInactive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as FantasyTeam | null;
}

export async function createFantasyTeam(team: FantasyTeamInput) {
  const { data, error } = await supabase
    .from("fantasy_teams")
    .insert(team)
    .select()
    .single();

  if (error) throw error;
  return data as FantasyTeam;
}

export async function updateFantasyTeam(id: number, team: FantasyTeamInput) {
  const { data, error } = await supabase
    .from("fantasy_teams")
    .update(team)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as FantasyTeam;
}

export async function deactivateFantasyTeam(id: number) {
  const { error } = await supabase
    .from("fantasy_teams")
    .update({ active: false })
    .eq("id", id);

  if (error) throw error;
}

export async function fetchTeamManagerTenures(teamId: number) {
  const { data, error } = await supabase
    .from("fantasy_team_manager_tenures")
    .select("*")
    .eq("fantasy_team_id", teamId)
    .order("start_season", { ascending: true });
  if (error) throw error;
  return (data ?? []) as FantasyTeamManagerTenure[];
}

export function getManagerForSeason(
  tenures: FantasyTeamManagerTenure[],
  seasonYear: number,
) {
  return [...tenures]
    .filter((tenure) => tenure.start_season <= seasonYear && (tenure.end_season === null || tenure.end_season >= seasonYear))
    .sort((a, b) => b.start_season - a.start_season)[0] ?? null;
}

export async function createTeamManagerTenure(input: Omit<FantasyTeamManagerTenure, "id">) {
  const { data, error } = await supabase
    .from("fantasy_team_manager_tenures")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as FantasyTeamManagerTenure;
}

export async function deleteTeamManagerTenure(id: number) {
  const { error } = await supabase
    .from("fantasy_team_manager_tenures")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function fetchTeamFinishes(teamId: number) {
  const { data, error } = await supabase
    .from("fantasy_team_finishes")
    .select("*")
    .eq("fantasy_team_id", teamId)
    .order("season_year", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FantasyTeamFinish[];
}

export async function createTeamFinish(input: Omit<FantasyTeamFinish, "id">) {
  const { data, error } = await supabase
    .from("fantasy_team_finishes")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as FantasyTeamFinish;
}

export async function deleteTeamFinish(id: number) {
  const { error } = await supabase.from("fantasy_team_finishes").delete().eq("id", id);
  if (error) throw error;
}

export async function uploadTeamLogo(file: File) {
  const extension = file.name.split(".").pop() || "png";
  const fileName = `${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from("team-logos")
    .upload(fileName, file, { upsert: false });

  if (error) throw error;

  const { data } = supabase.storage.from("team-logos").getPublicUrl(fileName);
  return data.publicUrl;
}
