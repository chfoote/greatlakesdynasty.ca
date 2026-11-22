import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { nhlStatsDate } from '../../shared/nhl-live.ts';
let sequence=0;
async function fixture(t) {
 const date=nhlStatsDate(),team={id:1,team_name:'Fantasy Team',abbreviation:'FAN',active:true};
 const state={metadataCalls:0,snapshot:{date,generatedAt:Date.now(),live:true,nextRefreshAt:Date.now()+30000,
 scoreboard:{games:[{id:2026020368,gameState:'LIVE',awayTeam:{id:1,abbrev:'NJD',score:4},homeTeam:{id:2,abbrev:'STL',score:8}}]},
 games:[{game:{id:2026020368,gameState:'LIVE',awayTeam:{id:1,abbrev:'NJD',score:4},homeTeam:{id:2,abbrev:'STL',score:8}},
 boxscore:{awayTeam:{abbrev:'NJD',score:4},homeTeam:{abbrev:'STL',score:8},playerByGameStats:{homeTeam:{forwards:[{playerId:8478402,position:'C',goals:3,assists:1,sog:6,pim:0,toi:'10:00'}]},awayTeam:{}}},
 playByPlay:{rosterSpots:[{playerId:8478402,firstName:{default:'Live'},lastName:{default:'Player'}}],plays:[{eventId:1,typeDescKey:'goal',sortOrder:1,timeInPeriod:'02:00',periodDescriptor:{number:1,periodType:'REG'},details:{eventOwnerTeamId:2,scoringPlayerId:8478402,awayScore:0,homeScore:3}}]}}]}};
 globalThis.__feedFixture=state;t.after(()=>{delete globalThis.__feedFixture;});
 const sources={
 nhlLive:`export async function fetchNhlLiveSnapshot(){return globalThis.__feedFixture.snapshot;}`,
 fantasyTeams:`export async function fetchFantasyTeams(){globalThis.__feedFixture.metadataCalls++;return [${JSON.stringify(team)}];}`,
 fantasyPlayers:`export async function fetchPlayerSeasonsBySeason(){globalThis.__feedFixture.metadataCalls++;return [{player_id:1,fantasy_team_id:1,position:'C',player:{player_api_id:'8478402',full_name:'Live Player'}}];}`,
 transactions:`export async function fetchLeagueTransactions(){globalThis.__feedFixture.metadataCalls++;return [];}`,
 prospectRights:`export const fetchProspectRights=()=>new Promise(()=>{});export const getProspectRight=()=>undefined;export const removeAgedOutProspectRights=async rights=>rights;`,
 recordBook:`export const LEAGUE_RECORD_LIMIT=10;export const fetchRecordBookData=()=>new Promise(()=>{});`,
 nhl:`export {buildNhlDailyStats,getSkaterScore,getGoalieScore,getNhlStatsDate} from ${JSON.stringify(resolve('src/lib/nhl.ts'))};export const fetchNhlLiveSeasonStats=()=>new Promise(()=>{});`,
 };
 const built=await build({entryPoints:['src/lib/goalFeed.ts'],bundle:true,format:'esm',platform:'browser',write:false,
 plugins:[{name:'feed-read-only-fixtures',setup(plugin){plugin.onResolve({filter:/^\.\//},args=>{
 if(args.importer.endsWith('/src/lib/goalFeed.ts')&&args.path.slice(2) in sources)return{path:args.path.slice(2),namespace:'feed-fixture'};
 });plugin.onLoad({filter:/.*/,namespace:'feed-fixture'},args=>({contents:sources[args.path],resolveDir:process.cwd()}));}}]});
 const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64')+`#feed-${sequence++}`);
 return{state,api,date};
}
test('live goals return without season reports, prospect lookups or record-book notes completing',async t=>{
 const {state,api,date}=await fixture(t);let timer;
 try{
 const feed=await Promise.race([api.fetchGoalFeed(date),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('live goals blocked by optional reports')),250);})]);
 assert.equal(feed.events.length,1);assert.equal(feed.events[0].homeTeam.score,8);assert.equal(feed.events[0].awayTeam.score,4);
 assert.deepEqual(feed.events[0].scoreAtGoal,{away:0,home:3});
 assert.equal(feed.events[0].scorer.fantasyTeam.id,1);
 assert.equal(feed.events[0].scorer.ownershipPending,false);
 assert.ok(feed.events[0].scorer.tonightPoints>0);
 assert.equal(feed.generatedAt,state.snapshot.generatedAt);
 assert.ok(feed.standingsPromise);assert.ok(feed.enrichmentPromise);
 }finally{clearTimeout(timer);}
});
test('live refreshes reuse league metadata briefly instead of refetching it for every enrichment',async t=>{
 const {state,api,date}=await fixture(t);
 await api.fetchGoalFeed(date);await api.fetchGoalFeed(date);
 assert.equal(state.metadataCalls,3);
});
