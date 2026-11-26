import type { PlayerSeasonWithRelations } from "./fantasyPlayers";
import type { LeagueTransaction } from "./transactions";
import { CURRENT_LEAGUE_SEASON } from "./leagueSeasons.ts";
export type EarningsYear={year:number;salary:number;teamName:string;source:"season"|"signing"};
export type CareerEarnings={key:string;playerId:string;playerName:string;total:number;years:EarningsYear[];rank:number};
const signings=new Set(["signed","called_up","claimed","competitive_balance_drafted","matched_rfa_offer"]);
export function buildCareerEarnings(rows:PlayerSeasonWithRelations[],transactions:LeagueTransaction[],includeFuture=false):CareerEarnings[]{
  const metadata=new Map<number,PlayerSeasonWithRelations>();
  [...rows].sort((a,b)=>a.season_year-b.season_year||a.id-b.id).forEach(row=>{if(row.player)metadata.set(row.player_id,row)});
  const groups=new Map<string,Omit<CareerEarnings,"rank"|"total"|"years">&{years:Map<number,EarningsYear>}>();
  function add(playerId:number,year:EarningsYear,replace=false){
    const row=metadata.get(playerId);if(!row?.player||(!includeFuture&&year.year>CURRENT_LEAGUE_SEASON))return;
    const api=row.player.player_api_id||"",key=api?`nhl:${api}`:`player:${playerId}`;
    let group=groups.get(key);
    if(!group){group={key,playerId:api,playerName:row.player.full_name||[row.player.first_name,row.player.last_name].filter(Boolean).join(" ")||`Player ${playerId}`,years:new Map()};groups.set(key,group)}
    if(replace||!group.years.has(year.year))group.years.set(year.year,year);
  }
  // Season rows are the authoritative annual salary. A traded contract remains
  // one player-year; separate retention cap adjustments do not add earnings.
  [...rows].sort((a,b)=>a.id-b.id).forEach(row=>{
    if(row.fantasy_team_id&&typeof row.salary==="number"&&Number.isFinite(row.salary)&&row.salary>0
      &&(!row.term_end_year||row.term_end_year>=row.season_year)&&!["RETENTION","BUYOUT"].includes((row.position||"").toUpperCase()))
      add(row.player_id,{year:row.season_year,salary:row.salary,teamName:row.fantasy_team?.team_name||"Recorded franchise",source:"season"},true);
  });
  // Buyouts can clear salary on roster rows. Signing history restores the
  // recorded contract years through the buyout season, without inventing pay
  // for later terminated years or counting a second salary after a trade.
  [...transactions].filter(tx=>tx.player_id&&signings.has(tx.action)&&typeof tx.salary==="number"&&Number.isFinite(tx.salary)&&tx.salary>0&&tx.term_end_year!==null&&tx.term_end_year>=tx.season_year)
    .sort((a,b)=>b.transaction_date.localeCompare(a.transaction_date)||b.id-a.id).forEach(tx=>{
      const ended=transactions.filter(event=>event.player_id===tx.player_id&&event.action==="bought_out"&&event.transaction_date>=tx.transaction_date)
        .sort((a,b)=>a.transaction_date.localeCompare(b.transaction_date))[0];
      const last=Math.min(tx.term_end_year!,ended?.season_year??tx.term_end_year!,includeFuture?tx.term_end_year!:CURRENT_LEAGUE_SEASON);
      for(let year=tx.season_year;year<=last;year++)add(tx.player_id!,{year,salary:tx.salary!,teamName:tx.fantasy_team?.team_name||"Recorded franchise",source:"signing"});
    });
  return [...groups.values()].map(group=>({...group,years:[...group.years.values()].sort((a,b)=>a.year-b.year),total:[...group.years.values()].reduce((sum,year)=>sum+year.salary,0)}))
    .sort((a,b)=>b.total-a.total||a.playerName.localeCompare(b.playerName)||a.key.localeCompare(b.key)).map((row,index)=>({...row,rank:index+1}));
}
