import { supabase } from "./supabase";
import type { PlayerSeasonWithRelations } from "./fantasyPlayers";
import type { LeagueTransaction } from "./transactions";
import { fetchFantasyTeams, fetchTeamBrandingHistory, applyTeamBranding } from "./fantasyTeams";
async function contracts() {
  const rows:PlayerSeasonWithRelations[]=[];
  for(let offset=0;;offset+=1000){
    const {data,error}=await supabase.from('player_seasons')
      .select('id,player_id,season_year,fantasy_team_id,salary,position,term_end_year,player:players(id,player_api_id,first_name,last_name,full_name),fantasy_team:fantasy_teams(*)')
      .order('id').range(offset,offset+999).abortSignal(AbortSignal.timeout(12000)).overrideTypes<PlayerSeasonWithRelations[],{merge:false}>();
    if(error)throw error;const page=data??[];rows.push(...page);if(page.length<1000)return rows;
  }
}
async function transactions() {
  const rows:LeagueTransaction[]=[];
  for(let offset=0;;offset+=1000){
    const {data,error}=await supabase.from('league_transactions')
      .select('id,player_id,fantasy_team_id,season_year,transaction_type,action,transaction_date,salary,term_end_year,trade_offer:trade_offers!league_transactions_trade_offer_id_fkey(trade_offer_players(from_team_id,to_team_id,player_season:player_seasons(player_id)))')
      .order('id').range(offset,offset+999).abortSignal(AbortSignal.timeout(12000)).overrideTypes<LeagueTransaction[],{merge:false}>();
    if(error)throw error;const page=data??[];rows.push(...page);if(page.length<1000)return rows;
  }
}
let cached:{expires:number;value:Promise<Awaited<ReturnType<typeof load>>>}|undefined;
async function load(){
  const [teams,brandingHistory,allSeasons,tx]=await Promise.all([fetchFantasyTeams(true),fetchTeamBrandingHistory(),contracts(),transactions()]);
  const byId=new Map(teams.map(team=>[team.id,team]));
  return {teams,brandingHistory,allSeasons,transactions:tx.map(row=>({...row,fantasy_team:row.fantasy_team_id&&byId.has(row.fantasy_team_id)?applyTeamBranding(byId.get(row.fantasy_team_id)!,brandingHistory,row.season_year):null}))};
}
export function fetchRecordBookInputs(){
  if(cached&&cached.expires>Date.now())return cached.value;
  const value=load().catch(error=>{if(cached?.value===value)cached=undefined;throw error});
  cached={expires:Date.now()+300_000,value};return value;
}
export function clearRecordBookInputs(){cached=undefined;}
