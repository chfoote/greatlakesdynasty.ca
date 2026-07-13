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
  al_farm_system: string | null;
  nl_farm_system: string | null;
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
  al_farm_system: string | null;
  nl_farm_system: string | null;
  championships: number;
  runner_up_finishes: number;
  third_place_finishes: number;
  active: boolean;
  notes: string | null;
};

export async function fetchFantasyTeams(includeInactive = false) {
  let query = supabase
    .from("fantasy_teams")
    .select("*")
    .order("team_name", { ascending: true });

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
