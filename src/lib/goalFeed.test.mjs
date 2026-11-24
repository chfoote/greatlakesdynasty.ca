import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { nhlStatsDate } from '../../shared/nhl-live.ts';
let sequence=0;
async function fixture(t, changes = {}) {
 const date=nhlStatsDate(),team={id:1,team_name:'Fantasy Team',abbreviation:'FAN',active:true};
 const state={metadataCalls:0,recordCalls:[],...changes,snapshot:{date,generatedAt:Date.now(),live:true,nextRefreshAt:Date.now()+30000,
 scoreboard:{games:[{id:2026020368,gameState:'LIVE',awayTeam:{id:1,abbrev:'NJD',score:4},homeTeam:{id:2,abbrev:'STL',score:8}}]},
 games:[{game:{id:2026020368,gameState:'LIVE',awayTeam:{id:1,abbrev:'NJD',score:4},homeTeam:{id:2,abbrev:'STL',score:8}},
 boxscore:{awayTeam:{abbrev:'NJD',score:4},homeTeam:{abbrev:'STL',score:8},playerByGameStats:{homeTeam:{forwards:[{playerId:8478402,position:'C',goals:3,assists:1,sog:6,pim:0,toi:'10:00'}]},awayTeam:{}}},
 playByPlay:{rosterSpots:[{playerId:8478402,firstName:{default:'Live'},lastName:{default:'Player'}}],plays:[{eventId:1,typeDescKey:'goal',sortOrder:1,timeInPeriod:'02:00',periodDescriptor:{number:1,periodType:'REG'},details:{eventOwnerTeamId:2,scoringPlayerId:8478402,awayScore:0,homeScore:3}}]}}]}};
 globalThis.__feedFixture=state;t.after(()=>{delete globalThis.__feedFixture;});
 const sources={
 nhlLive:`export async function fetchNhlLiveSnapshot(){return globalThis.__feedFixture.snapshot;}`,
 fantasyTeams:`export async function fetchFantasyTeams(){globalThis.__feedFixture.metadataCalls++;return [${JSON.stringify(team)}];}`,
 fantasyPlayers:`export async function fetchPlayerSeasonsBySeason(){globalThis.__feedFixture.metadataCalls++;return [{player_id:1,fantasy_team_id:1,position:'C',player:{player_api_id:'8478402',full_name:'Live Player'}},...(globalThis.__feedFixture.extraRoster||[])];}`,
 transactions:`export async function fetchLeagueTransactions(){globalThis.__feedFixture.metadataCalls++;return [];}`,
 prospectRights:`export const fetchProspectRights=()=>new Promise(()=>{});export const getProspectRight=()=>undefined;export const removeAgedOutProspectRights=async rights=>rights;`,
 recordBook:`export const LEAGUE_RECORD_LIMIT=10;export async function fetchRecordBookData(...args){const s=globalThis.__feedFixture;s.recordCalls.push(args);
 if(s.recordError)throw Error('NHL record history unavailable');if(s.recordLines)return {franchiseStatLines:s.recordLines,warnings:s.recordWarnings||[]};return new Promise(()=>{});}`,
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
 assert.ok(!('scoreAtGoal' in feed.events[0]));
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

const fantasyTeam = { id: 1, team_name: 'Fantasy Team', abbreviation: 'FAN' };
const career = (id, goals, points, team = fantasyTeam) => ({ playerId: String(id), playerName: id === 8478402 ? 'Live Player' : 'Previous Leader',
 team, currentTeam: team, skater: { goals, assists: points - goals, points, gameWinningGoals: 0 }, goalie: null });

test('milestones and record movements use only completed career lines plus the live day once', async t => {
 const {state,api,date}=await fixture(t,{recordLines:[career(8478402,47,95),career(2,49,100)]});
 const feed=await api.fetchGoalFeed(date);
 const insights=await feed.recordInsightsPromise;
 assert.equal(state.recordCalls.length,1);
 assert.equal(state.recordCalls[0][3],'franchise');
 const previous=new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10);
 assert.equal(state.recordCalls[0][2],previous);
 assert.ok(insights.milestones.some(item=>item.abbreviation==='G'&&item.target===50&&item.achievedTonight));
 assert.ok(insights.milestones.some(item=>item.abbreviation==='P'&&item.target===100&&item.remaining===1));
 assert.ok(insights.movements.some(event=>event.movements.some(m=>m.abbreviation==='G'&&m.beforeRank===2&&m.afterRank===1)));
 assert.ok(insights.chases.length);
 assert.equal(state.recordLines[0].skater.goals,47,'Never mutate the reusable career baseline');
 const again=await (await api.fetchGoalFeed(date)).recordInsightsPromise;
 assert.deepEqual(again.milestones,insights.milestones);
 assert.equal(state.recordCalls.length,1);
});

test('history failures are visible, leave goals usable, and permit a subsequent recovery', async t => {
 const {state,api,date}=await fixture(t,{recordError:true});
 const first=await api.fetchGoalFeed(date);
 assert.equal(first.events.length,1);
 assert.match((await first.recordInsightsPromise).warning,/temporarily unavailable/);
 state.recordError=false;state.recordLines=[career(8478402,47,95),career(2,49,100)];
 const recovered=await (await api.fetchGoalFeed(date)).recordInsightsPromise;
 assert.equal(recovered.warning,undefined);
 assert.ok(recovered.milestones.length);
});

test('live deltas keep historical franchise credits and are never applied twice', async t => {
 const {api}=await fixture(t);
 const oldTeam={id:2,team_name:'Previous Franchise',abbreviation:'OLD'};
 const lines=[career(8478402,20,40,oldTeam),career(8478402,27,55)];
 const owners=new Map([['8478402',{playerId:'8478402',name:'Live Player',fantasyTeam,prospect:false,tonightPoints:0}]]);
 const result=api.addDailyRecordTotals(lines,[{playerId:8478402,goals:3,assists:1,gameWinningGoals:0}],[],owners);
 assert.equal(result[0].skater.goals,20);
 assert.equal(result[1].skater.goals,30);
 assert.deepEqual(lines,[career(8478402,20,40,oldTeam),career(8478402,27,55)]);
 assert.deepEqual(api.addDailyRecordTotals(lines,[{playerId:8478402,goals:3,assists:1,gameWinningGoals:0}],[],owners),result);
});

test('delayed history does not announce unverified achievements', async t => {
 const {api,date}=await fixture(t,{recordLines:[career(8478402,47,95),career(2,49,100)],recordWarnings:['NHL saved data']});
 const result=await (await api.fetchGoalFeed(date)).recordInsightsPromise;
 assert.match(result.warning,/delayed/);
 assert.equal(result.movements.length,0);
 assert.ok(result.milestones.every(item=>!item.achievedTonight));
});

test('completed-game goalie milestones and game-winning goal records use final box scores', async t => {
 const {state,api,date}=await fixture(t,{recordLines:[career(8478402,47,95),
  {playerId:'3',playerName:'Fixture Goalie',team:fantasyTeam,currentTeam:fantasyTeam,skater:null,goalie:{wins:24,shutouts:9}}],
  extraRoster:[{player_id:3,fantasy_team_id:1,position:'G',player:{player_api_id:'3',full_name:'Fixture Goalie'}}]});
 const bundle=state.snapshot.games[0];
 bundle.game.gameState='FINAL';bundle.game.awayTeam.score=0;bundle.game.homeTeam.score=3;
 bundle.boxscore.awayTeam.score=0;bundle.boxscore.homeTeam.score=3;
 bundle.playByPlay.plays[0].details.homeScore=1;
 bundle.boxscore.playerByGameStats.homeTeam.goalies=[{playerId:3,decision:'W',goalsAgainst:0,saves:20,toi:'60:00',starter:true}];
 const result=await (await api.fetchGoalFeed(date)).recordInsightsPromise;
 assert.ok(result.milestones.some(item=>item.abbreviation==='W'&&item.target===25&&item.achievedTonight));
 assert.ok(result.milestones.some(item=>item.abbreviation==='SO'&&item.target===10&&item.achievedTonight));
 assert.ok(result.movements.some(event=>event.movements.some(move=>move.abbreviation==='GWG'&&move.value===1)));
});
