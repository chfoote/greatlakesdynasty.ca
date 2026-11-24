// Actual feed component + transformation + poller, with remote sources replaced.
// Required data takes 100 ms; season/prospect/record enrichment never resolves.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { existsSync } from 'node:fs';
const run=promisify(execFile),chrome=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if(!existsSync(chrome))throw Error('Set CHROME_PATH to Chrome/Chromium.');
const page=resolve('src/pages/League/GoalHorn.tsx');
const original=process.argv.includes('--baseline-records')?(await run('git',['show','HEAD:src/pages/League/GoalHorn.tsx'])).stdout:undefined;
const mocks={
 PageMeta:'export default function PageMeta(){return null}',
 AuthContext:'const user={id:"fixture-user"};export const useAuth=()=>({user});',
 teamUserAssignments:'export const fetchUserTeamAssignment=async()=>({fantasy_team_id:1});export const fetchLatestUserTeamAssignment=async()=>({fantasy_team_id:1});',
 fantasyTeams:`let calls=0;export const fetchFantasyTeams=async()=>{calls++;if(location.search.includes('delayed')&&calls>1)await new Promise(r=>setTimeout(r,20000));return [{id:1,team_name:'Fantasy Team',abbreviation:'FAN',active:true}];};`,
 fantasyPlayers:'export const fetchPlayerSeasonsBySeason=async()=>[{player_id:1,fantasy_team_id:1,position:"C",player:{player_api_id:"8478402",full_name:"Live Scorer"}}];',
 transactions:'export const fetchLeagueTransactions=async()=>[];',
 prospectRights:'export const fetchProspectRights=()=>new Promise(()=>{});export const getProspectRight=()=>undefined;export const removeAgedOutProspectRights=async r=>r;',
 recordBook:`export const LEAGUE_RECORD_LIMIT=10;export const fetchRecordBookData=async(...args)=>{
 globalThis.__recordCalls=(globalThis.__recordCalls||0)+1;if(args[3]!=='franchise')throw Error('Unrelated record-book sections requested');
 const mode=new URLSearchParams(location.search).get('records');if(!mode)return new Promise(()=>{});
 if(mode==='error')throw Error('History unavailable');await new Promise(r=>setTimeout(r,mode==='delayed'?35000:100));
 const team={id:1,team_name:'Fantasy Team',abbreviation:'FAN'};const line=(playerId,goals,points)=>({playerId:String(playerId),playerName:playerId===8478402?'Live Scorer':'Earlier Leader',team,currentTeam:team,skater:{goals,assists:points-goals,points,gameWinningGoals:0},goalie:null});
 return {franchiseStatLines:[line(8478402,47,95),line(2,49,100),line(3,46,101)],warnings:[]};};`,
 nhl:`export {buildNhlDailyStats,fetchNhlDailyStats,getSkaterScore,getGoalieScore,getNhlStatsDate} from ${JSON.stringify(resolve('src/lib/nhl.ts'))};export const fetchNhlLiveSeasonStats=()=>new Promise(()=>{});`,
 nhlLive:`import {nhlStatsDate} from ${JSON.stringify(resolve('shared/nhl-live.ts'))};
 const started=performance.now();
 function snapshot(){const late=performance.now()-started>=25000,away=late?5:4,home=late?9:8;
 const game={id:2026020368,gameState:'LIVE',awayTeam:{id:1,abbrev:'NJD',score:away},homeTeam:{id:2,abbrev:'STL',score:home}};
 return {date:nhlStatsDate(),generatedAt:Date.now(),live:true,nextRefreshAt:Date.now()+30000,scoreboard:{games:[game]},games:[{game,
 boxscore:{awayTeam:game.awayTeam,homeTeam:game.homeTeam,playerByGameStats:{awayTeam:{},homeTeam:{forwards:[{playerId:8478402,position:'C',goals:late?4:3,assists:1,sog:6,toi:'10:00'}]}}},
 playByPlay:{rosterSpots:[{playerId:8478402,firstName:{default:'Live'},lastName:{default:'Scorer'}}],plays:[{eventId:1,typeDescKey:'goal',sortOrder:1,timeInPeriod:'02:00',periodDescriptor:{number:1,periodType:'REG'},details:{eventOwnerTeamId:2,scoringPlayerId:8478402,awayScore:0,homeScore:3}}]}}]};}
 export const getLiveSchedule=()=>snapshot();export const fetchNhlLiveSnapshot=async()=>snapshot();`,
};
const built=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router';import Page from ${JSON.stringify(page)};
 const start=performance.now();new MutationObserver(()=>{if(document.body.textContent.includes('Milestone Watch')&&!document.body.hasAttribute('data-record-ready-ms'))document.body.setAttribute('data-record-ready-ms',String(Math.round(performance.now()-start)));document.body.setAttribute('data-record-calls',String(globalThis.__recordCalls||0));if(document.body.textContent.includes('Live Scorer')&&!document.body.hasAttribute('data-feed-ready-ms'))document.body.setAttribute('data-feed-ready-ms',String(Math.round(performance.now()-start)));})
 .observe(document.body,{subtree:true,childList:true});createRoot(document.getElementById('root')).render(<BrowserRouter><Page/></BrowserRouter>);`,loader:'tsx',resolveDir:process.cwd()},
 bundle:true,format:'iife',platform:'browser',jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'live-offline-fixtures',setup(plugin){
 plugin.onResolve({filter:/.*/},args=>{const name=args.path.split('/').at(-1).replace(/\.ts$/,'');
 const feed=args.importer.endsWith('/src/lib/goalFeed.ts');
 if(name==='nhlLive'||(name in mocks&&(args.importer===page||feed)))return{path:name,namespace:'live-browser-fixture'};});
 plugin.onLoad({filter:/.*/,namespace:'live-browser-fixture'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
 if(original)plugin.onLoad({filter:/GoalHorn\.tsx$/},()=>({contents:original,loader:'tsx',resolveDir:resolve('src/pages/League')}));
}}]});
const server=createServer((req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self';connect-src 'none';img-src 'self' data:;style-src 'unsafe-inline'");
 res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?built.outputFiles[0].text:'<!doctype html><meta name="viewport" content="width=device-width"><body><div id="root"></div><script src="/app.js"></script></body>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{for(const [budget,records] of (original?[[40000,'delayed']]:[[2000,''],[35000,''],[2000,'fast'],[40000,'delayed'],[65000,'delayed'],[2000,'error']])){
 const profile=await mkdtemp(join(tmpdir(),'gld-live-browser-'));
 try{const {stdout}=await run(chrome,['--headless','--disable-gpu','--no-first-run','--disable-extensions','--disable-sync','--disable-background-networking',`--user-data-dir=${profile}`,
 '--window-size=390,844',`--virtual-time-budget=${budget}`,'--dump-dom',`http://127.0.0.1:${server.address().port}/?records=${records}`],{timeout:20000,maxBuffer:2000000});
 const ready=stdout.match(/data-feed-ready-ms="(\d+)"/);assert.ok(ready,'Live goals remained blocked by optional enrichment.');
 assert.ok(Number(ready[1])<2000);
 assert.ok(!stdout.includes('At goal:'),'Removed historical-score text returned.');
 if(!records)assert.ok(stdout.includes(budget===2000?'4–8':'5–9'),'Current scoreboard did not update.');
 if(records==='fast'||records==='delayed'){
  const notes=stdout.match(/data-record-ready-ms="(\d+)"/);assert.ok(notes,'Record or milestone results were discarded during score refresh.');
  assert.ok(Number(notes[1])<(records==='fast'?2000:40000));
  assert.ok(stdout.includes('Record Chases'),'Record chases did not populate.');
  assert.match(stdout,/data-record-calls="1"/,'Career history was fetched again while it was still loading/cached.');
  if(budget===65000)assert.ok(stdout.includes('5–9'),'Live score polling stopped while records were loading.');
  console.log(`PASS: ${records} records/milestones visible at ${notes[1]} ms across live refreshes; one shared career-history request; no At goal label.`);
 }else if(records==='error'){
  assert.ok(stdout.includes('Record and milestone updates are temporarily unavailable.'));assert.ok(!stdout.includes('Loading record notes'));
  console.log('PASS: record failure is explained, loading ends, and goals remain visible.');
 }else console.log(`PASS: goals visible at ${ready[1]} ms with optional enrichment unresolved${budget===35000?'; score updates on the 30-second poll':''}; no At goal label.`);
 }finally{await rm(profile,{recursive:true,force:true}).catch(()=>{});}
}}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
