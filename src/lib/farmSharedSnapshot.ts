import { supabase } from "./supabase";
import { farmDraftYears } from "../../shared/farm-rankings";
import { CURRENT_LEAGUE_SEASON } from "./leagueSeasons";
import { validRows, displayRows } from "./farmRankingsCache";
import type { NhlDraftPick } from "./nhl";
import type { FarmRanking } from "./farmInsights";
import type { ProspectOwnershipRow } from "./prospectOwnership";

export type FarmSharedSnapshot = { generated_at: string; stats_through: string; signature: string;
  drafts: Array<{year:number;picks:NhlDraftPick[]}>; rankings: FarmRanking[] };
let cached: {expires: number; promise: Promise<FarmSharedSnapshot|null>} | undefined;
export async function fetchFarmOwnershipRows() {
  const rows: ProspectOwnershipRow[] = [];
  for (let offset=0;;offset+=1000) {
    const {data,error} = await supabase.from("player_seasons")
      .select("id,season_year,updated_at,fantasy_team_id,position,player:players(player_api_id,full_name)")
      .order("id").range(offset,offset+999).abortSignal(AbortSignal.timeout(12000))
      .overrideTypes<ProspectOwnershipRow[],{merge:false}>();
    if (error) throw error;
    const page = (data ?? []) as ProspectOwnershipRow[];
    rows.push(...page);
    if (page.length<1000) return rows;
  }
}
export function fetchFarmSharedSnapshot() {
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = (async () => {
    try {
      const {data,error} = await supabase.from("farm_ranking_snapshots")
        .select("generated_at,stats_through,signature,drafts,rankings")
        .eq("season_year",CURRENT_LEAGUE_SEASON).eq("schema_version",1)
        .abortSignal(AbortSignal.timeout(2500)).maybeSingle();
      if (error || !data) return null;
      const row = data as FarmSharedSnapshot;
      const timestamp = Date.parse(row.generated_at);
      const years = farmDraftYears(CURRENT_LEAGUE_SEASON);
      if (!Number.isFinite(timestamp) || timestamp > Date.now() || Date.now()-timestamp > 7*86400_000
        || !/^[a-f0-9]{64}$/.test(row.signature) || !validRows(row.rankings) || !Array.isArray(row.drafts)
        || row.drafts.length !== years.length || new Set(row.drafts.map(d=>d.year)).size !== years.length
        || !row.drafts.every(d=>years.includes(d.year)&&Array.isArray(d.picks)&&d.picks.length>0
          &&d.picks.every(p=>Number.isSafeInteger(p.overallPick)&&p.overallPick>0&&typeof p.teamAbbrev==="string"))) return null;
      return {...row,rankings:displayRows(row.rankings)};
    } catch { return null; }
  })();
  cached = {expires:Date.now()+300_000,promise};
  return promise;
}
