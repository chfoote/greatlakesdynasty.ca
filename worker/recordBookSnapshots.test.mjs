import assert from 'node:assert/strict';
import {test} from 'node:test';
import {refreshRecordBookSnapshot,selectRecordBookRange} from './recordBookSnapshots.ts';
import {recordBookRanges,recordRangeKey} from '../shared/record-book-ranges.ts';
const now=Date.parse('2026-11-24T21:00:00Z');
const skater={playerId:1,skaterFullName:'One',positionCode:'C',gamesPlayed:5,goals:2,assists:1,plusMinus:0,penaltyMinutes:0,ppGoals:0,ppPoints:0,shGoals:0,shPoints:0,gameWinningGoals:0,shots:0,blockedShots:0,hits:0,totalFaceoffWins:0};
const goalie={playerId:2,goalieFullName:'Two',gamesPlayed:5,gamesStarted:5,wins:2,losses:1,otLosses:0,goalsAgainst:5,saves:50,shutouts:0,penaltyMinutes:0,goals:0,assists:0};
const full=recordBookRanges([],now).filter((r,i,all)=>all.findIndex(s=>s.season_year===r.season_year)===i);
function fixture(){
 const state={posts:[],reports:[],boundaries:[{season_year:2027,transaction_date:'2026-11-01',transaction_type:'trade',action:'traded',player_id:1,trade_offer:{trade_offer_players:[{player_season:{player_id:1}}]}}],bases:full.map(r=>({...r,skaters:[skater],goalies:[goalie]})),saved:full.map(r=>({...r,schema_version:1,generated_at:new Date(now).toISOString()})),roster:[{season_year:2027,player_id:1,fantasy_team_id:1,position:'C',player:{player_api_id:'1'}}],fail:false,stale:false,partial:false};
 const options={url:'https://fixture.supabase.co',key:'server-only-test-key',now,
 fetcher:async(input,init)=>{const url=new URL(input);if(init?.method==='POST'){state.posts.push(JSON.parse(init.body));return new Response(null,{status:201})}const table=url.pathname.split('/').at(-1);let rows=table==='league_transactions'?state.boundaries:table==='player_seasons'?state.roster:table==='record_book_range_players'?state.bases.map(base=>({...base,players:[...base.skaters.map(p=>({playerId:p.playerId,positionCode:p.positionCode,gamesPlayed:p.gamesPlayed})),...base.goalies.map(p=>({playerId:p.playerId,positionCode:'G',gamesPlayed:p.gamesPlayed}))]})):state.saved;return Response.json(rows)},
 getReport:async path=>{state.reports.push(path);if(state.fail)return new Response(null,{status:429});const data=path.includes('/goalie/')?[goalie]:[skater];return Response.json({data,total:state.partial?2:1},{headers:state.stale?{'X-NHL-Stale':'1'}:{}})}};
 return {state,options};
}
test('planner preserves closed ownership spans and builds both moving comparison tails',()=>{const ranges=recordBookRanges([{season_year:2027,transaction_date:'2026-11-01',transaction_type:'trade',action:'traded'}],now);const keys=new Set(ranges.map(recordRangeKey));for(const key of ['2027:2026-07-01:2026-10-31','2027:2026-11-01:2026-11-23','2027:2026-11-01:2026-11-22','2027:2026-07-01:2026-11-22'])assert.ok(keys.has(key))});
test('producer saves one complete public range without financial or manager fields',async()=>{const {state,options}=fixture();const result=await refreshRecordBookSnapshot(options);assert.equal(result.refreshed,true);assert.equal(state.reports.length,4);assert.equal(state.posts.length,1);assert.deepEqual(Object.keys(state.posts[0]).sort(),['season_year','start_date','end_date','schema_version','generated_at','skaters','goalies'].sort());assert.ok(!JSON.stringify(state.posts).includes('server-only-test-key'))});
test('cold producer builds missing full seasons before attribution spans',async()=>{const {state,options}=fixture();state.bases=[];state.saved=[];const result=await refreshRecordBookSnapshot(options);assert.equal(result.range.start_date,`${result.range.season_year-1}-07-01`)});
test('producer does not create boundaries for unplayed prospects',async()=>{const {state,options}=fixture();state.roster[0].player.player_api_id='99';const result=await refreshRecordBookSnapshot(options);assert.equal(result.range.start_date,'2026-07-01');assert.equal(result.range.end_date,'2026-11-22')});
for(const kind of ['fail','stale','partial'])test('producer preserves old rows on '+kind+' NHL reports',async()=>{const {state,options}=fixture();state[kind]=true;await assert.rejects(refreshRecordBookSnapshot(options));assert.equal(state.posts.length,0)});
test('fully populated fresh ranges require no NHL requests',async()=>{const {state,options}=fixture();state.saved=recordBookRanges(state.boundaries,now).map(r=>({...r,schema_version:1,generated_at:new Date(now).toISOString()}));const result=await refreshRecordBookSnapshot(options);assert.equal(result.refreshed,false);assert.equal(state.reports.length,0);assert.equal(state.posts.length,0)});
test('invalid and future generated timestamps are scheduled for repair',()=>{for(const generated_at of ['invalid',new Date(now+10000).toISOString()])assert.ok(selectRecordBookRange([full[0]],[{...full[0],schema_version:1,generated_at}],now))});


test('producer plans only the earliest call-up boundary for repeated call-up records',async()=>{
 const {state,options}=fixture();state.roster[0].position='PROSPECT';
 state.boundaries=['2026-11-01','2026-11-10'].map(transaction_date=>({player_id:1,season_year:2027,action:'called_up',transaction_type:'signing',transaction_date,trade_offer:null}));
 const result=await refreshRecordBookSnapshot(options);
 assert.equal(result.total,recordBookRanges([state.boundaries[0]],now).length);
});
