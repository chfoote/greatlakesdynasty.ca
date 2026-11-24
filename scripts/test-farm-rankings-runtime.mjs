// Offline mobile-sized browser regression. Exercise the real ranking component,
// calculation and snapshot cache; only remote sources are replaced with fixtures.
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
const page=resolve('src/pages/League/FarmSystemRankings.tsx');
const shared=process.argv.includes('--shared');
const baseline=process.argv.includes('--baseline');
const original=baseline?(await run('git',['show','HEAD:src/pages/League/FarmSystemRankings.tsx'])).stdout:undefined;
const common=`const delay=value=>{globalThis.__inputCalls=(globalThis.__inputCalls||0)+1;return new Promise(r=>setTimeout(()=>r(value),globalThis.__slowInputs?30000:100));};`;
const mocks={
 leagueSeasonStats:`export {fetchNhlLiveSeasonStats as fetchLeagueSeasonStats} from 'nhl';`,
 farmSharedSnapshot:`import{buildFarmRankings,farmDraftYears}from ${JSON.stringify(resolve('shared/farm-rankings.ts'))};
 import{farmSignature}from ${JSON.stringify(resolve('shared/farm-signature.ts'))};import{displayRows}from ${JSON.stringify(resolve('src/lib/farmRankingsCache.ts'))};
 export const fetchFarmOwnershipRows=async()=>[];
 export async function fetchFarmSharedSnapshot(){
  const teams=[{id:1,team_name:'Farm Team One',abbreviation:'ONE',logo:null,eastern_farm_system:'TOR',notes:'DO_NOT_SAVE'},
   {id:2,team_name:'Farm Team Two',abbreviation:'TWO',logo:null,eastern_farm_system:'BOS',notes:'DO_NOT_SAVE'}];
  const stats={skaters:[{playerId:1,skaterFullName:'Prospect One',positionCode:'C',score:10},{playerId:2,skaterFullName:'Prospect Two',positionCode:'C',score:5}],goalies:[]};
  const drafts=farmDraftYears(2027).map(year=>({year,picks:year===new Date().getFullYear()-6?[{firstName:{default:'Prospect'},lastName:{default:'One'},positionCode:'C',teamAbbrev:'TOR',overallPick:1},{firstName:{default:'Prospect'},lastName:{default:'Two'},positionCode:'C',teamAbbrev:'BOS',overallPick:2}]:[]}));
  return{generated_at:new Date().toISOString(),stats_through:'2026-11-23',drafts,signature:await farmSignature(teams,[],drafts,stats),
   rankings:displayRows(buildFarmRankings(teams,[],drafts,stats,{getSkaterScore:r=>r.score,getGoalieScore:()=>0}).rankings)};
 }`,
 PageMeta:`export default function PageMeta(){return null}`,
 fantasyTeams:`${common} export const applyTeamBranding=t=>t;export const fetchTeamBrandingHistory=()=>delay([]);
  export const fetchFantasyTeams=()=>delay([{id:1,team_name:'Farm Team One',abbreviation:'ONE',logo:null,eastern_farm_system:'TOR',notes:'DO_NOT_SAVE'},
  {id:2,team_name:'Farm Team Two',abbreviation:'TWO',logo:null,eastern_farm_system:'BOS',notes:'DO_NOT_SAVE'}]);`,
 fantasyPlayers:`${common} export const fetchPlayerSeasons=()=>delay([]);`,
 nhl:`${common}export const formatFantasyPoints=n=>n.toFixed(2);export const getSkaterScore=r=>r.score;export const getGoalieScore=()=>0;
  export const fetchNhlDraftPicks=year=>{globalThis.__draftCalls=(globalThis.__draftCalls||0)+1;return delay(year===new Date().getFullYear()-6?[{firstName:{default:'Prospect'},lastName:{default:'One'},positionCode:'C',teamAbbrev:'TOR',overallPick:1},
  {firstName:{default:'Prospect'},lastName:{default:'Two'},positionCode:'C',teamAbbrev:'BOS',overallPick:2}]:[]);};
  export const fetchNhlLiveSeasonStats=()=>delay({skaters:[{playerId:1,skaterFullName:'Prospect One',positionCode:'C',score:10},
   {playerId:2,skaterFullName:'Prospect Two',positionCode:'C',score:5}],goalies:[]});
  export const fetchNhlPlayerLanding=id=>{globalThis.__profileCalls=(globalThis.__profileCalls||0)+1;return new Promise(r=>setTimeout(()=>r({birthDate:'2002-01-01',headshot:'fixture.png'}),30000));};
  export const searchNhlPlayers=()=>new Promise(r=>setTimeout(()=>r([]),30000));`,
};
const built=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router';import Page from ${JSON.stringify(page)};
 const start=performance.now();new MutationObserver(()=>{if(document.body.textContent.includes('Farm Team One')&&document.body.textContent.includes('The podium')&&!document.body.hasAttribute('data-ready-ms')){
 document.body.setAttribute('data-ready-ms',String(Math.round(performance.now()-start)));document.body.setAttribute('data-profile-calls',String(globalThis.__profileCalls||0));document.body.setAttribute('data-draft-calls',String(globalThis.__draftCalls||0));
 document.body.setAttribute('data-input-calls',String(globalThis.__inputCalls||0));
 document.body.setAttribute('data-private-fields-stored',String(Object.keys(localStorage).some(key=>key.startsWith('gld:public-farm-rankings:')&&localStorage.getItem(key).includes('DO_NOT_SAVE'))));}})
 .observe(document.body,{subtree:true,childList:true});createRoot(document.getElementById('root')).render(<BrowserRouter><Page/></BrowserRouter>);`,loader:'tsx',resolveDir:process.cwd()},
 bundle:true,format:'iife',platform:'browser',jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"','import.meta.env.VITE_FARM_SNAPSHOTS':JSON.stringify(String(shared))},plugins:[{name:'farm-offline-fixtures',setup(plugin){
 plugin.onResolve({filter:/.*/},args=>{const name=args.path.split('/').at(-1);if(name in mocks&&(args.importer===page||args.importer.endsWith('/src/lib/farmInsights.ts')||args.namespace==='farm-browser-fixture'))return{path:name,namespace:'farm-browser-fixture'};});
 plugin.onLoad({filter:/.*/,namespace:'farm-browser-fixture'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
 if(original)plugin.onLoad({filter:/FarmSystemRankings\.tsx$/},()=>({contents:original,loader:'tsx',resolveDir:resolve('src/pages/League')}));
}}]});
let slow=false;
const server=createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self';connect-src 'none';img-src 'self' data:;style-src 'unsafe-inline'");
 res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/html');
 res.end(req.url==='/app.js'?built.outputFiles[0].text:req.url==='/config.js'?`window.__slowInputs=${slow};`:'<!doctype html><meta name="viewport" content="width=device-width"><body><div id="root"></div><script src="/config.js"></script><script src="/app.js"></script></body>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const profile=await mkdtemp(join(tmpdir(),'gld-farm-browser-'));
try{
 for(const label of (baseline?['baseline']:['first-complete-ranking','saved-reload'])){
  slow=label==='saved-reload';
  const {stdout}=await run(chrome,['--headless','--disable-gpu','--no-first-run','--disable-extensions','--disable-sync','--disable-background-networking',
   `--user-data-dir=${profile}`,'--window-size=390,844','--virtual-time-budget=2000','--dump-dom',`http://127.0.0.1:${server.address().port}/`],{timeout:20000,maxBuffer:2000000});
  const ready=stdout.match(/data-ready-ms="(\d+)"/);
  assert.ok(ready,`${label}: rankings still blocked after two seconds with profile/birthday requests delayed 30 seconds.`);
  assert.match(stdout,/data-profile-calls="0"/);assert.match(stdout,/data-private-fields-stored="false"/);
  if(shared)assert.match(stdout,/data-draft-calls="0"/);
  if(slow)assert.match(stdout,/data-input-calls="0"/);
  console.log(`PASS: ${label} rankings visible at ${ready[1]} ms; no profile/birthday requests, no private fields stored${slow?', no ranking-source requests on reload':''}.`);
 }
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true}).catch(()=>{});}
