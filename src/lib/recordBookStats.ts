import { supabase } from "./supabase";
import { fetchLeagueSeasonStats } from "./leagueSeasonStats";
import { CURRENT_LEAGUE_SEASON } from "./leagueSeasons";
import { fetchNhlDailyStats, fetchNhlSkaterStatsForPeriod, fetchNhlGoalieStatsForPeriod, getNhlStatsDate, mergeSkaterRecords, mergeGoalieRecords } from "./nhl";
import { inheritNhlFreshness, markNhlFetched } from "./nhlFreshness";
import { savedNhl, NhlBaselineAvailable } from "./nhlSaved";
import { validRecordStats, type RecordStats } from "../../shared/record-book-stats";
import { previousRecordDate } from "../../shared/record-book-ranges";
const lookups = new Map<string,{expires:number;value:Promise<RecordStats|null>}>();
function snapshotStats(data: unknown): RecordStats | null {
  const row=data as RecordStats & {generated_at?:string} | null;
  const stamp=Date.parse(row?.generated_at??'');
  if(!row||!Number.isFinite(stamp)||stamp>Date.now()||Date.now()-stamp>30*86400_000||!validRecordStats(row))return null;
  const result={skaters:row.skaters,goalies:row.goalies};
  markNhlFetched(result.skaters,stamp);markNhlFetched(result.goalies,stamp);return markNhlFetched(result,stamp);
}
// One database round trip per season, rather than one per ownership interval.
export async function prefetchRecordBookRanges(year:number,periods:Array<{start:string;end:string}>) {
  if(import.meta.env.VITE_RECORD_BOOK_SNAPSHOTS!=='true')return;
  const today=getNhlStatsDate();
  const wanted=periods.map(period=>({start:period.start,end:year===CURRENT_LEAGUE_SEASON&&period.end===today?previousRecordDate(today):period.end}))
    .filter(period=>period.start<=period.end&&(lookups.get(`${year}:${period.start}:${period.end}`)?.expires??0)<=Date.now());
  if(!wanted.length)return;
  const work=(async()=>{try{
    const {data,error}=await supabase.from('record_book_nhl_ranges').select('start_date,end_date,generated_at,skaters,goalies')
      .eq('season_year',year).eq('schema_version',1)
      .or(wanted.map(period=>`and(start_date.eq.${period.start},end_date.eq.${period.end})`).join(','))
      .abortSignal(AbortSignal.timeout(5000));
    if(error)return new Map<string,RecordStats>();
    const rows=new Map<string,RecordStats>();
    for(const row of data??[]){const stats=snapshotStats(row);if(stats)rows.set(`${year}:${row.start_date}:${row.end_date}`,stats);}
    return rows;
  }catch{return new Map<string,RecordStats>()}})();
  for(const period of wanted){const key=`${year}:${period.start}:${period.end}`;lookups.set(key,{expires:Date.now()+300_000,value:work.then(rows=>rows.get(key)??null)});}
  while(lookups.size>128)lookups.delete(lookups.keys().next().value!);
  await work;
}
async function savedRange(year:number,start:string,end:string) {
  const key=`${year}:${start}:${end}`,cached=lookups.get(key);
  if(cached&&cached.expires>Date.now())return cached.value;
  const value=(async()=>{try{
    const {data,error}=await supabase.from('record_book_nhl_ranges').select('generated_at,skaters,goalies')
      .eq('season_year',year).eq('start_date',start).eq('end_date',end).eq('schema_version',1)
      .abortSignal(AbortSignal.timeout(2500)).maybeSingle();
    return error?null:snapshotStats(data);
  }catch{return null}})();
  lookups.set(key,{expires:Date.now()+300_000,value});
  if(lookups.size>128)lookups.delete(lookups.keys().next().value!);
  return value;
}
export async function fetchRecordBookStats(year:number,start?:string,end?:string):Promise<RecordStats> {
  const enabled=import.meta.env.VITE_RECORD_BOOK_SNAPSHOTS==='true';
  if(!start||!end){
    if(enabled&&year<CURRENT_LEAGUE_SEASON){const saved=await savedRange(year,`${year-1}-07-01`,`${year}-06-30`);if(saved)return saved;}
    return fetchLeagueSeasonStats(year);
  }
  const id=(year-1)*10000+year,today=getNhlStatsDate();
  const original=async()=>{const [skaters,goalies]=await Promise.all([fetchNhlSkaterStatsForPeriod(id,start,end),fetchNhlGoalieStatsForPeriod(id,start,end)]);return inheritNhlFreshness({skaters,goalies},[skaters,goalies]);};
  if(!enabled)return original();
  const live=year===CURRENT_LEAGUE_SEASON&&end===today;
  if(live&&start===today)return fetchNhlDailyStats(today,{waitForRefresh:true});
  return savedNhl(`record-range:${year}:${start}:${end}`,async()=>{
    const baseline=await savedRange(year,start,live?previousRecordDate(today):end);
    if(!baseline)return original();
    if(!live)return baseline;
    try{
      const daily=await fetchNhlDailyStats(today,{waitForRefresh:true});
      return inheritNhlFreshness({skaters:mergeSkaterRecords(baseline.skaters,daily.skaters),goalies:mergeGoalieRecords(baseline.goalies,daily.goalies)},[baseline,daily],'latest-if-fresh');
    }catch{throw new NhlBaselineAvailable(baseline,'Live Record Book updates unavailable. Showing completed games through '+previousRecordDate(today)+'.');}
  },validRecordStats,live?30_000:86400_000,{scope:live?today:undefined,staleRetryMs:5000});
}
