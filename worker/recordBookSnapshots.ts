import { recordBookTail } from "../shared/record-book-tail.ts";
import { CURRENT_LEAGUE_SEASON, FIRST_LEAGUE_SEASON } from "../src/lib/leagueSeasons.ts";
import { recordBookRanges, recordRangeKey, type RecordBoundary, type RecordNhlRange } from "../shared/record-book-ranges.ts";
import { validRecordStats, type RecordStats } from "../shared/record-book-stats.ts";
import type { NhlSkaterRecord, NhlGoalieRecord } from "../src/lib/nhl";
export const recordBookSnapshotCron = "1,11,21,31,41,51 * * * *";
type Boundary = RecordBoundary & {player_id:number|null;trade_offer:{trade_offer_players:Array<{player_season:{player_id:number}|null}>}|null};
type Roster = {season_year:number;player_id:number;fantasy_team_id:number|null;position:string|null;player:{player_api_id:string}|null};
type Full = RecordNhlRange & {players:Array<{playerId:number;positionCode:string;gamesPlayed:number}>};
const validPlayers=(base:Full)=>Array.isArray(base.players)&&base.players.every(row=>Number.isSafeInteger(row.playerId)&&Number.isFinite(row.gamesPlayed));
type Saved = RecordNhlRange & { generated_at: string; schema_version: number };
type Options = { url:string; key:string; now?:number; fetcher?:typeof fetch; getReport:(path:string)=>Promise<Response> };
export function selectRecordBookRange(ranges: RecordNhlRange[], saved: Saved[], now: number) {
  const existing = new Map(saved.map(row=>[recordRangeKey(row),row]));
  return ranges.filter(range=>{
    const row=existing.get(recordRangeKey(range));
    const stamp=Date.parse(row?.generated_at??'');
    return !row || row.schema_version!==1 || !Number.isFinite(stamp) || stamp>now || now-stamp>7*86400_000;
  }).sort((a,b)=>{
    const aSaved=existing.has(recordRangeKey(a)), bSaved=existing.has(recordRangeKey(b));
    return Number(aSaved)-Number(bSaved) || b.end_date.localeCompare(a.end_date) || a.start_date.localeCompare(b.start_date);
  })[0];
}
export async function refreshRecordBookSnapshot({url,key,now=Date.now(),fetcher=fetch,getReport}:Options) {
  const root=new URL('/rest/v1/',url);
  const headers={apikey:key,Authorization:`Bearer ${key}`};
  async function read<T>(table:string,params:Record<string,string>):Promise<T[]> {
    const rows:T[]=[];
    for(let offset=0;;offset+=1000){
      const endpoint=new URL(table,root);endpoint.search=new URLSearchParams({...params,order:'id',limit:'1000',offset:String(offset)}).toString();
      if(table==='power_ranking_snapshots')endpoint.searchParams.delete('order');
      if(table.startsWith('record_book_'))endpoint.searchParams.set('order','season_year,start_date,end_date');
      const response=await fetcher(endpoint,{headers,signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw Error(`Record inputs read failed (${response.status}).`);
      const page=await response.json() as T[];if(!Array.isArray(page))throw Error('Invalid record inputs');
      rows.push(...page);if(page.length<1000)return rows;
    }
  }
  const [boundaries,saved,roster,bases]=await Promise.all([
    read<Boundary>('league_transactions',{select:'season_year,transaction_date,transaction_type,action,player_id,trade_offer:trade_offers!league_transactions_trade_offer_id_fkey(trade_offer_players(player_season:player_seasons(player_id)))',or:'(action.eq.called_up,transaction_type.eq.trade)'}),
    read<Saved>('record_book_nhl_ranges',{select:'season_year,start_date,end_date,schema_version,generated_at'}),
    read<Roster>('player_seasons',{select:'season_year,player_id,fantasy_team_id,position,player:players(player_api_id)'}),
    read<Full>('record_book_range_players',{select:'season_year,start_date,end_date,players',schema_version:'eq.1',start_date:`in.(${Array.from({length:CURRENT_LEAGUE_SEASON-FIRST_LEAGUE_SEASON+1},(_,i)=>`${FIRST_LEAGUE_SEASON+i-1}-07-01`).join(',')})`}),
  ]);
  const full=recordBookRanges([],now).filter((range,index,all)=>all.findIndex(r=>r.season_year===range.season_year)===index);
  // Full seasons first, so played-player IDs match the visitor's boundaries.
  const missingFull=full.filter(range=>!bases.some(base=>recordRangeKey(base)===recordRangeKey(range)&&validPlayers(base)));
  const relevant:RecordBoundary[]=[];
  for(const range of full){
    const base=bases.find(row=>recordRangeKey(row)===recordRangeKey(range)&&validPlayers(row));if(!base)continue;
    const played=new Map(base.players.map(row=>[String(row.playerId),row]));
    const ids=new Set(roster.filter(row=>row.season_year===range.season_year&&row.fantasy_team_id&&row.player?.player_api_id)
      .filter(row=>!['PROSPECT','AP'].includes((row.position||'').toUpperCase())||boundaries.some(tx=>tx.action==='called_up'&&tx.season_year===row.season_year&&tx.player_id===row.player_id))
      .filter(row=>{const stats=played.get(row.player!.player_api_id);const code=stats?.positionCode==='L'?'LW':stats?.positionCode==='R'?'RW':stats?.positionCode||row.position||'C';return (stats?.gamesPlayed||0)>0&&['C','LW','RW','D','G'].includes(code.toUpperCase())})
      .map(row=>row.player_id));
    for(const tx of boundaries){
      if(tx.transaction_type==='trade'&&tx.trade_offer?.trade_offer_players.some(move=>move.player_season&&ids.has(move.player_season.player_id)))relevant.push({...tx,season_year:range.season_year});
      if(tx.action==='called_up'&&tx.season_year===range.season_year&&tx.player_id&&ids.has(tx.player_id)&&!boundaries.some(prior=>prior.action==='called_up'&&prior.season_year===tx.season_year&&prior.player_id===tx.player_id&&prior.transaction_date<tx.transaction_date))relevant.push(tx);
    }
  }
  const ranges=recordBookRanges(relevant,now),range=selectRecordBookRange(missingFull.length?missingFull:ranges,saved,now);
  if(!range)return {refreshed:false,total:ranges.length};
  let stats:RecordStats|null=null;
  if(range.season_year===CURRENT_LEAGUE_SEASON && range.start_date===`${range.season_year-1}-07-01`){
    const sources=await read<{source_stats:RecordStats;generated_at:string}>('power_ranking_snapshots',{select:'source_stats,generated_at',season_year:`eq.${range.season_year}`,mode:'eq.season',range_index:'eq.0',schema_version:'eq.1',stats_through:`eq.${range.end_date}`});
    const source=sources.find(row=>validRecordStats(row.source_stats)&&Date.parse(row.generated_at)<=now&&now-Date.parse(row.generated_at)<86400_000);
    if(source)stats=source.source_stats;
  }
  if(!stats && range.season_year===CURRENT_LEAGUE_SEASON && range.start_date!==`${range.season_year-1}-07-01`){
    const fullRange={...range,start_date:`${range.season_year-1}-07-01`};
    const prefixes:RecordNhlRange[]=[];let cursor=fullRange.start_date;
    while(cursor<range.start_date){
      const prefix=saved.filter(row=>row.season_year===range.season_year&&row.start_date===cursor&&row.end_date<range.start_date&&row.schema_version===1)
        .sort((a,b)=>b.end_date.localeCompare(a.end_date))[0];
      if(!prefix)break;prefixes.push(prefix);cursor=new Date(Date.parse(`${prefix.end_date}T12:00:00Z`)+86400_000).toISOString().slice(0,10);
    }
    if(cursor===range.start_date && saved.some(row=>recordRangeKey(row)===recordRangeKey(fullRange)&&row.schema_version===1)){
      const wanted=[fullRange,...prefixes];
      const inputs=await read<RecordNhlRange&RecordStats>('record_book_nhl_ranges',{select:'season_year,start_date,end_date,skaters,goalies',season_year:`eq.${range.season_year}`,schema_version:'eq.1',or:`(${wanted.map(row=>`and(start_date.eq.${row.start_date},end_date.eq.${row.end_date})`).join(',')})`});
      const base=inputs.find(row=>recordRangeKey(row)===recordRangeKey(fullRange));
      const prior=prefixes.map(prefix=>inputs.find(row=>recordRangeKey(row)===recordRangeKey(prefix)));
      if(base&&validRecordStats(base)&&prior.every((row):row is RecordNhlRange&RecordStats=>Boolean(row&&validRecordStats(row))))stats=recordBookTail(base,prior);
    }
  }
  if(!stats){
  const id=(range.season_year-1)*10000+range.season_year;
  const query=new URLSearchParams({cayenneExp:`seasonId=${id} and gameTypeId=2 and gameDate>="${range.start_date}" and gameDate<="${range.end_date}"`});
  async function report<T>(path:string):Promise<T[]> {
    const response=await getReport(`/nhl-api/complete/${path}?${query}`);
    if(!response.ok||response.headers.get('X-NHL-Stale')==='1')throw Error(`Record NHL ${path} unavailable (${response.status}).`);
    const body=await response.json() as {data:T[];total:number};
    if(!Array.isArray(body.data)||body.data.length!==body.total)throw Error('Record snapshot requires complete NHL reports.');
    return body.data;
  }
  const summary=await report<NhlSkaterRecord>('skater/summary');
  const realtime=await report<Pick<NhlSkaterRecord,'playerId'|'blockedShots'|'hits'>>('skater/realtime');
  const faceoffs=await report<Pick<NhlSkaterRecord,'playerId'|'totalFaceoffWins'>>('skater/faceoffwins');
  const goalies=await report<NhlGoalieRecord>('goalie/summary');
  const extras=new Map(realtime.map(row=>[row.playerId,row])),wins=new Map(faceoffs.map(row=>[row.playerId,row.totalFaceoffWins]));
  stats={goalies,skaters:summary.map(row=>({...row,teamAbbrevs:row.teamAbbrevs||'',blockedShots:extras.get(row.playerId)?.blockedShots??0,hits:extras.get(row.playerId)?.hits??0,totalFaceoffWins:wins.get(row.playerId)??0}))};
  if(!validRecordStats(stats)||Boolean(summary.length)!==Boolean(goalies.length)||(summary.length&&!realtime.length))throw Error('Incomplete Record Book scoring inputs.');
  }
  if(!validRecordStats(stats))throw Error('Invalid derived Record Book tail.');
  const endpoint=new URL('record_book_nhl_ranges',root);endpoint.searchParams.set('on_conflict','season_year,start_date,end_date');
  const response=await fetcher(endpoint,{method:'POST',headers:{...headers,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({...range,...stats,schema_version:1,generated_at:new Date(now).toISOString()}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error(`Record snapshot save failed (${response.status}).`);
  return {refreshed:true,range,total:ranges.length};
}
