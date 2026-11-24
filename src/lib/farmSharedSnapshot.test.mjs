import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { buildFarmRankings, farmDraftYears } from "../../shared/farm-rankings.ts";
import { farmSignature } from "../../shared/farm-signature.ts";
import { displayRows } from "./farmRankingsCache.ts";
let sequence=0;
async function fixture(t,{enabled=true,missing=false}={}){
  const skater={playerId:1,skaterFullName:"Prospect One",positionCode:"C",teamAbbrevs:"TOR",gamesPlayed:10,goals:5,assists:4,plusMinus:0,penaltyMinutes:0,
    ppGoals:0,ppPoints:0,shGoals:0,shPoints:0,gameWinningGoals:0,shots:0,blockedShots:0,hits:0,totalFaceoffWins:0};
  const teams=[{id:1,team_name:"One",abbreviation:"ONE",eastern_farm_system:"TOR"},{id:2,team_name:"Two",abbreviation:"TWO",eastern_farm_system:"BOS"}];
  const stats={skaters:[skater,{...skater,playerId:2,skaterFullName:"Prospect Two",teamAbbrevs:"BOS",goals:2}],goalies:[]};
  const drafts=farmDraftYears(2027).map((year,index)=>({year,picks:index===0?[
    {firstName:{default:"Prospect"},lastName:{default:"One"},positionCode:"C",teamAbbrev:"TOR",overallPick:1},
    {firstName:{default:"Prospect"},lastName:{default:"Two"},positionCode:"C",teamAbbrev:"BOS",overallPick:2},
  ]:[{firstName:{default:"Unplayed"},lastName:{default:String(year)},positionCode:"C",teamAbbrev:"TOR",overallPick:1}]}));
  const rankings=displayRows(buildFarmRankings(teams,[],drafts,stats).rankings);
  const candidate={generated_at:new Date(Date.now()-1000).toISOString(),stats_through:"2026-11-23",drafts,rankings,signature:await farmSignature(teams,[],drafts,stats)};
  const state={teams,stats,drafts,seasons:[],candidate:missing?null:candidate,draftCalls:0,computations:0,queries:[]};
  globalThis.__sharedFarmFixture=state;t.after(()=>{delete globalThis.__sharedFarmFixture;});
  const sources={
    fantasyTeams:`export const applyTeamBranding=t=>t;export const fetchFantasyTeams=async()=>globalThis.__sharedFarmFixture.teams;export const fetchTeamBrandingHistory=async()=>[];`,
    fantasyPlayers:`export const fetchPlayerSeasons=async()=>globalThis.__sharedFarmFixture.seasons;`,
    leagueSeasonStats:`export {fetchNhlLiveSeasonStats as fetchLeagueSeasonStats} from './nhl';`,
    nhl:`import {markNhlFetched} from ${JSON.stringify(resolve('src/lib/nhlFreshness.ts'))};
      export {getSkaterScore,getGoalieScore} from ${JSON.stringify(resolve('shared/nhl-scoring.ts'))};
      export const fetchNhlLiveSeasonStats=async()=>markNhlFetched(globalThis.__sharedFarmFixture.stats,Date.now());
      export const fetchNhlDraftPicks=async year=>{const f=globalThis.__sharedFarmFixture;f.draftCalls++;return f.drafts.find(d=>d.year===year).picks;};
      export const fetchNhlPlayerLanding=async()=>{throw Error('Unexpected profile load')};export const searchNhlPlayers=async()=>[];`,
    supabase:`export const supabase={from(table){const state=globalThis.__sharedFarmFixture;let start=0,end=999;state.queries.push(table);
      const chain={select(){return chain},eq(){return chain},abortSignal(){return chain},order(){return chain},range(a,b){start=a;end=b;return chain},overrideTypes(){return chain},
        maybeSingle:async()=>({data:state.candidate,error:null}),then(resolve,reject){return Promise.resolve({data:state.seasons.slice(start,end+1),error:null}).then(resolve,reject)}};return chain;}};`,
    computation:`import {buildFarmRankings as original} from ${JSON.stringify(resolve('shared/farm-rankings.ts'))};
      export const buildFarmRankings=(...args)=>{globalThis.__sharedFarmFixture.computations++;return original(...args)};`,
  };
  const built=await build({entryPoints:['src/lib/farmInsights.ts'],bundle:true,format:'esm',platform:'browser',write:false,
    define:{'import.meta.env.VITE_FARM_SNAPSHOTS':JSON.stringify(String(enabled))},plugins:[{name:'shared-farm-services',setup(plugin){
      plugin.onResolve({filter:/.*/},args=>{
        if(args.importer.endsWith('/farmInsights.ts')&&args.path.endsWith('/shared/farm-rankings'))return{path:'computation',namespace:'fixture'};
        const name=args.path.split('/').at(-1).replace(/\.ts$/,'');
        if(name in sources)return{path:name,namespace:'fixture'};
      });
      plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:sources[args.path],resolveDir:process.cwd()}));
    }}]});
  const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64')+'#shared-farm-'+sequence++);
  return{state,api,rankings};
}
test('matching farm inputs reuse the saved result without draft requests or recalculation',async t=>{
  const f=await fixture(t);const result=await f.api.fetchFarmInsights(undefined,{rankingsOnly:true});
  assert.deepEqual(result.rankings,f.rankings);assert.equal(f.state.computations,0);assert.equal(f.state.draftCalls,0);
  assert.deepEqual(f.state.queries.sort(),['farm_ranking_snapshots','player_seasons']);
});
test('live production changes recalculate using shared drafts without requesting draft history',async t=>{
  const f=await fixture(t);f.state.stats.skaters[0].goals+=1;
  const result=await f.api.fetchFarmInsights(undefined,{rankingsOnly:true});
  assert.equal(f.state.computations,1);assert.equal(f.state.draftCalls,0);
  assert.ok(result.rankings.find(r=>r.team.id===1).production>f.rankings.find(r=>r.team.id===1).production);
});
test('prospect rights transfers invalidate the saved result and move the prospect',async t=>{
  const f=await fixture(t);f.state.seasons=[{id:1,season_year:2027,updated_at:'2026-11-24',position:'PROSPECT',fantasy_team_id:2,player:{player_api_id:'1',full_name:'Prospect One'}}];
  const result=await f.api.fetchFarmInsights(undefined,{rankingsOnly:true});
  assert.equal(f.state.computations,1);assert.equal(f.state.draftCalls,0);
  assert.ok(result.rankings.find(r=>r.team.id===2).topProspects.some(p=>p.name==='Prospect One'));
  assert.ok(!result.rankings.find(r=>r.team.id===1).topProspects.some(p=>p.name==='Prospect One'));
});
test('ownership pagination excludes a signed prospect even when its row is beyond the first thousand',async t=>{
  const f=await fixture(t);f.state.seasons=Array.from({length:1000},(_,i)=>({id:i+1,season_year:2027,updated_at:'2026-11-24',position:'PROSPECT',fantasy_team_id:1,player:{player_api_id:String(2000+i),full_name:'Unrelated'}}));
  f.state.seasons.push({id:1001,season_year:2026,updated_at:'2026-01-01',position:'C',fantasy_team_id:1,player:{player_api_id:'1',full_name:'Prospect One'}});
  const result=await f.api.fetchFarmInsights(undefined,{rankingsOnly:true});
  assert.equal(f.state.queries.filter(table=>table==='player_seasons').length,2);
  assert.ok(result.rankings.every(r=>!r.topProspects.some(p=>p.name==='Prospect One')));assert.equal(f.state.draftCalls,0);
});
test('missing shared snapshot uses the original draft loader and produces the same rankings',async t=>{
  const f=await fixture(t,{missing:true});const result=await f.api.fetchFarmInsights(undefined,{rankingsOnly:true});
  assert.equal(f.state.draftCalls,7);assert.deepEqual(displayRows(result.rankings),f.rankings);
});
test('invalid shared snapshot falls back without publishing its results',async t=>{
  const f=await fixture(t);f.state.candidate.signature='invalid';
  const result=await f.api.fetchFarmInsights(undefined,{rankingsOnly:true});
  assert.equal(f.state.draftCalls,7);assert.deepEqual(displayRows(result.rankings),f.rankings);
});
test('disabling the farm snapshot flag preserves the existing loader without snapshot queries',async t=>{
  const f=await fixture(t,{enabled:false});const result=await f.api.fetchFarmInsights(undefined,{rankingsOnly:true});
  assert.equal(f.state.queries.length,0);assert.equal(f.state.draftCalls,7);assert.deepEqual(displayRows(result.rankings),f.rankings);
});

test('database JSON key ordering does not invalidate a matching shared result',async t=>{
  const f=await fixture(t);
  f.state.candidate.drafts=f.state.candidate.drafts.map(d=>({...d,picks:d.picks.map(p=>Object.fromEntries(Object.entries(p).reverse()))}));
  const result=await f.api.fetchFarmInsights(undefined,{rankingsOnly:true});
  assert.equal(f.state.computations,0);assert.deepEqual(result.rankings,f.rankings);
});

test('known age eligibility changes invalidate saved rankings without new draft requests',async t=>{
  const f=await fixture(t);f.state.stats.skaters[0].birthDate='1990-01-01';
  const result=await f.api.fetchFarmInsights(undefined,{rankingsOnly:true});
  assert.equal(f.state.computations,1);assert.equal(f.state.draftCalls,0);
  assert.ok(result.rankings.every(r=>!r.topProspects.some(p=>p.name==='Prospect One')));
});
