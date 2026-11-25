import { buildFarmRankings, farmDraftYears, farmDate } from "../shared/farm-rankings.ts";
import { farmSignature } from "../shared/farm-signature.ts";
import { nhlStatsDate } from "../shared/nhl-live.ts";
import { displayRows, validRows } from "../src/lib/farmRankingsCache.ts";
import { CURRENT_LEAGUE_SEASON } from "../src/lib/leagueSeasons.ts";
import type { FantasyTeam, FantasyTeamBranding } from "../src/lib/fantasyTeams";
import type { ProspectOwnershipRow } from "../src/lib/prospectOwnership";
import type { NhlDraftPick, NhlSkaterRecord, NhlGoalieRecord } from "../src/lib/nhl";

export const farmSnapshotCron = "10,25,40,55 * * * *";
type Draft = {year:number;picks:NhlDraftPick[]};
type Stats = {schema_version:number;skaters:NhlSkaterRecord[];goalies:NhlGoalieRecord[]};
export async function refreshFarmSnapshot(options: {url:string;key:string;getReport:(path:string)=>Promise<Response>;fetcher?:typeof fetch;now?:number;sleep?:(ms:number)=>Promise<void>}) {
  const now = options.now ?? Date.now(), year = CURRENT_LEAGUE_SEASON;
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? (ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  const root = new URL("/rest/v1/",options.url);
  const headers = {apikey:options.key,Authorization:`Bearer ${options.key}`};
  async function read<T>(table:string, params:Record<string,string>):Promise<T[]> {
    const rows:T[]=[];
    for(let offset=0;;offset+=1000){
      const url=new URL(table,root);url.search=new URLSearchParams({...params,offset:String(offset),limit:"1000"}).toString();
      const response=await fetcher(url,{headers,redirect:"manual",signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw Error(`Farm snapshot database read failed (${response.status}).`);
      const page=await response.json() as T[];
      if(!Array.isArray(page))throw Error("Invalid farm snapshot database response.");
      rows.push(...page);if(page.length<1000)return rows;
    }
  }
  const [basis] = await read<{source_stats:Stats;stats_through:string}>("power_ranking_snapshots",{
    select:"source_stats,stats_through",season_year:`eq.${year}`,mode:"eq.season",range_index:"eq.0",schema_version:"eq.1",
  });
  if(basis?.stats_through!==nhlStatsDate(-1,now)||basis.source_stats?.schema_version!==1
    ||!basis.source_stats.skaters?.length||!basis.source_stats.goalies?.length)throw Error("Farm snapshot requires a complete through-yesterday season baseline.");
  const [previous] = await read<{drafts:Draft[];drafts_checked_at:string}>("farm_ranking_snapshots",{
    select:"drafts,drafts_checked_at",season_year:`eq.${year}`,schema_version:"eq.1",
  });
  const date=farmDate(now), years=farmDraftYears(year,date);
  let drafts:Draft[];
  if(previous && now-Date.parse(previous.drafts_checked_at)<7*86400_000 && Date.parse(previous.drafts_checked_at)<=now
    && Array.isArray(previous.drafts) && previous.drafts.length===years.length && previous.drafts.every(d=>d&&years.includes(d.year)&&Array.isArray(d.picks)&&d.picks.length>0)
    && new Set(previous.drafts.map(d=>d.year)).size===years.length)drafts=previous.drafts;
  else {
    drafts=[];
    for(const draftYear of years){
      if(drafts.length)await sleep(5000);
      const response=await options.getReport(`/nhl-web-api/draft/picks/${draftYear}/all`);
      if(!response.ok||response.headers.get("X-NHL-Stale")==="1")throw Error(`Farm snapshot draft ${draftYear} unavailable (${response.status}).`);
      const payload=await response.json() as {draftYear?:number;picks?:NhlDraftPick[]};
      if(payload.draftYear!==draftYear||!Array.isArray(payload.picks)||!payload.picks.length
        ||payload.picks.some(p=>!Number.isSafeInteger(p.overallPick)||p.overallPick<1||typeof p.teamAbbrev!=="string")
        ||new Set(payload.picks.map(p=>p.overallPick)).size!==payload.picks.length)throw Error(`Farm snapshot draft ${draftYear} is incomplete or invalid.`);
      drafts.push({year:draftYear,picks:payload.picks.map(p=>({round:p.round,pickInRound:p.pickInRound,teamId:p.teamId,overallPick:p.overallPick,firstName:p.firstName,lastName:p.lastName,positionCode:p.positionCode,teamAbbrev:p.teamAbbrev,teamName:p.teamName,teamCommonName:p.teamCommonName}))});
    }
  }
  const [teams,branding,seasons]=await Promise.all([
    read<FantasyTeam>("fantasy_teams",{select:"id,team_name,abbreviation,logo,primary_color,secondary_color,eastern_farm_system,western_farm_system",active:"eq.true",order:"id"}),
    read<FantasyTeamBranding>("fantasy_team_branding_history",{select:"fantasy_team_id,start_season,end_season,team_name,abbreviation,logo,primary_color,secondary_color",order:"start_season.desc,id"}),
    read<ProspectOwnershipRow>("player_seasons",{select:"id,season_year,updated_at,fantasy_team_id,position,player:players(player_api_id,full_name)",order:"id"}),
  ]);
  if(!teams.length||!seasons.length)throw Error("Farm snapshot league inputs are empty.");
  const displayTeams=teams.map(team=>{
    const b=branding.find(b=>b.fantasy_team_id===team.id&&b.start_season<=year&&(b.end_season===null||b.end_season>=year));
    return b?{...team,team_name:b.team_name,abbreviation:b.abbreviation,logo:b.logo,primary_color:b.primary_color,secondary_color:b.secondary_color}:team;
  });
  const stats={skaters:basis.source_stats.skaters.map(s=>({...s,teamAbbrevs:s.teamAbbrevs??""})),goalies:basis.source_stats.goalies.map(s=>({...s,teamAbbrevs:s.teamAbbrevs??""}))};
  const rankings=displayRows(buildFarmRankings(displayTeams,seasons,drafts,stats,undefined,date).rankings);
  if(!validRows(rankings)||rankings.length!==teams.length)throw Error("Farm snapshot rankings are incomplete.");
  const signature=await farmSignature(displayTeams,seasons,drafts,stats,date);
  const body={season_year:year,schema_version:1,generated_at:new Date(now).toISOString(),stats_through:basis.stats_through,
    signature,drafts,rankings,drafts_checked_at:previous?.drafts===drafts?previous.drafts_checked_at:new Date(now).toISOString()};
  const response=await fetcher(new URL("farm_ranking_snapshots",root),{method:"POST",headers:{...headers,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},
    redirect:"manual",signal:AbortSignal.timeout(12000),body:JSON.stringify(body)});
  if(!response.ok)throw Error(`Farm snapshot database write failed (${response.status}).`);
}
