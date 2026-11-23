// Actual NHL client, pagination, saved caches, scoring, and standings page.
// Only the public HTTP transport and read-only league metadata are fixtures.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const run=promisify(execFile),page=resolve('src/pages/League/Standings.tsx');
const original=process.argv.includes('--baseline')?(await run('git',['show','HEAD:src/lib/nhlSaved.ts'])).stdout:undefined;
const mocks={
 PageMeta:'export default function PageMeta(){return null}',
 fantasyTeams:`export const applyTeamBranding=t=>t;export const fetchTeamBrandingHistory=async()=>[];export const fetchFantasyTeams=async()=>[{id:1,team_name:'Georgian Bay Bears',abbreviation:'GBB'}];`,
 fantasyPlayers:`export const fetchPlayerSeasonsBySeason=async()=>[{id:1,player_id:1,season_year:2027,fantasy_team_id:1,position:'C',player:{player_api_id:'8478402',full_name:'Fixture Skater'}}];`,
};
const contents=`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router';import Page from ${JSON.stringify(page)};
 import Notice from './src/components/hockey/NhlDataNotice';import{getNhlStatsDate}from './src/lib/nhl';
 // Chrome virtual time can finish before Web Locks IPC grants a lock. The
 // optional cross-tab lock behavior is covered by the client unit tests.
 Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});
 window.addEventListener('unhandledrejection',e=>document.body.setAttribute('data-failure',String(e.reason)));
 const params=new URLSearchParams(location.search),offline=params.get('live')==='off',day=params.get('day'),current=day==='today';
 const initial=Number(params.get('initial')),target=Number(params.get('target'));
 function row(score){const goals=Math.floor(score/3);return {playerId:8478402,skaterFullName:'Fixture Skater',positionCode:'C',teamAbbrevs:'BUF',gamesPlayed:20,
 goals,assists:0,shots:Math.round((score-goals*3)/0.2),plusMinus:0,penaltyMinutes:0,ppGoals:0,ppPoints:0,shGoals:0,shPoints:0,gameWinningGoals:0,blockedShots:0,hits:0,totalFaceoffWins:0};}
 const savedAt=current?Date.now()-60000:Date.parse(day+'T17:00:00Z');
 localStorage.setItem('gld:complete-nhl:v1:live-season:2027',JSON.stringify({value:{skaters:[row(initial)],goalies:[]},updatedAt:savedAt}));
 localStorage.setItem('sb-fixture-auth-token','leave-this-alone');
 const requests=[];window.fetch=async(path,options)=>{requests.push({path,cache:options?.cache});const url=new URL(path,location.origin);
  if(url.pathname.startsWith('/nhl-web-api/live-snapshot/'))return offline?Response.json({error:'limited'},{status:429,headers:{'Retry-After':'600'}}):Response.json({date:getNhlStatsDate(),generatedAt:Date.now(),live:false,nextRefreshAt:Date.now()+3600000,scoreboard:{games:[]},games:[]});
  if(!url.pathname.startsWith('/nhl-api/'))throw Error('Unexpected external/private request');
  let data=[];if(url.pathname==='/nhl-api/skater/summary')data=[row(target)];
  if(url.pathname==='/nhl-api/skater/realtime')data=[{playerId:8478402,blockedShots:0,hits:0}];
  if(url.pathname==='/nhl-api/skater/faceoffwins')data=[{playerId:8478402,totalFaceoffWins:0}];
  if(url.pathname==='/nhl-api/skater/bios')data=[{playerId:8478402,birthDate:'1997-01-01',birthCountryCode:'USA'}];
  return Response.json({data,total:data.length},{headers:{Date:new Date().toUTCString()}});
 };
 createRoot(document.getElementById('root')).render(<BrowserRouter><Notice/><Page/></BrowserRouter>);
 setTimeout(()=>{
  const text=document.body.textContent;
  document.body.setAttribute('data-recovered',String(text.includes(String(target))));
  document.body.setAttribute('data-current-baseline',String(!offline||text.includes('completed games through')));
  document.body.setAttribute('data-auth-untouched',String(localStorage.getItem('sb-fixture-auth-token')==='leave-this-alone'));
  document.body.setAttribute('data-http-revalidated',String(requests.every(r=>r.cache==='no-cache')));
  document.body.setAttribute('data-live-requests',String(requests.filter(r=>r.path.includes('/live-snapshot/')).length));
  document.body.setAttribute('data-request-count',String(requests.length));
 },13000);`;
const built=await build({stdin:{contents,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'old-cache-fixture',setup(plugin){
 plugin.onResolve({filter:/.*/},args=>{const name=args.path.split('/').at(-1).replace(/\.ts$/,'');if(args.importer===page&&name in mocks)return{path:name,namespace:'fixture'};});
 plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path]}));
 if(original)plugin.onLoad({filter:/nhlSaved\.ts$/},()=>({contents:original,loader:'ts',resolveDir:resolve('src/lib')}));
}}]});
const server=createServer((req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self';connect-src 'none';img-src 'none';style-src 'unsafe-inline'");res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');
 res.end(req.url==='/app.js'?built.outputFiles[0].text:'<!doctype html><body><div id="root"></div><script src="/app.js"></script></body>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{for(const [day,initial,live] of [['2026-11-20',1461,'on'],['2026-11-21',1461,'off'],['today',1544.4,'on']]){
 const profile=await mkdtemp(join(tmpdir(),'gld-saved-recovery-'));
 try{const{stdout}=await run(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--no-first-run','--disable-extensions','--disable-background-networking',`--user-data-dir=${profile}`,'--window-size=390,844','--virtual-time-budget=14500','--dump-dom',`http://127.0.0.1:${server.address().port}/?day=${day}&initial=${initial}&target=1545&live=${live}`],{timeout:25000,maxBuffer:2000000});
 if(!stdout.includes('data-recovered="true"'))console.log('Fixture diagnostic:',stdout.match(/data-[a-z-]+="[^"]*"/g));
 assert.ok(stdout.includes('data-recovered="true"'),'Actual saved cache did not recover '+day+' data from the fresh completed report (live '+live+').');
 assert.ok(stdout.includes('data-current-baseline="true"'),'Completed-game coverage was not labeled.');
 assert.ok(stdout.includes('data-auth-untouched="true"'),'Auth storage was altered.');
 assert.ok(stdout.includes('data-http-revalidated="true"'),'Browser HTTP cache was not revalidated.');
 assert.match(stdout,/data-live-requests="1"/,'Live failure must not produce an immediate retry loop');
 console.log('PASS: actual stored '+day+' cache ('+initial+') recovers to the fixture total 1545 with live '+live+'; real scoring/client/caches, preserved auth, one live request.');
 }finally{await rm(profile,{recursive:true,force:true}).catch(()=>{});}
}}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
