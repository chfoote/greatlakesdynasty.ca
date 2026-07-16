import { supabase } from "./supabase";
import type { FantasyPlayer } from "./fantasyPlayers";

export type Award = { id: number; name: string; image_url: string | null; active: boolean; created_at: string };
export type PlayerAward = {
  id: number;
  award_id: number;
  player_id: number;
  season_year: number;
  award: Award | null;
  player: FantasyPlayer | null;
};

export async function fetchAwards(includeInactive = false) {
  let query = supabase.from("awards").select("*").order("name");
  if (!includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Award[];
}

export async function createAward(input: { name: string; image_url: string | null }) {
  const { data, error } = await supabase.from("awards").insert(input).select().single();
  if (error) throw error;
  return data as Award;
}

export async function deleteAward(id: number) {
  const { error } = await supabase.from("awards").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchPlayerAwards(seasonYear?: number) {
  let query = supabase
    .from("player_awards")
    .select("*, award:awards(*), player:players(*)")
    .order("season_year", { ascending: false });
  if (seasonYear) query = query.eq("season_year", seasonYear);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as PlayerAward[];
}

export async function assignPlayerAward(input: { award_id: number; player_id: number; season_year: number }) {
  const { data, error } = await supabase.from("player_awards").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function deletePlayerAward(id: number) {
  const { error } = await supabase.from("player_awards").delete().eq("id", id);
  if (error) throw error;
}

export async function uploadAwardImage(file: File) {
  const extension = file.name.split(".").pop() || "png";
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("award-images").upload(fileName, file);
  if (error) throw error;
  return supabase.storage.from("award-images").getPublicUrl(fileName).data.publicUrl;
}

export function mapAwardsByPlayer(rows: PlayerAward[]) {
  return rows.reduce<Map<number, PlayerAward[]>>((map, row) => {
    map.set(row.player_id, [...(map.get(row.player_id) || []), row]);
    return map;
  }, new Map());
}
