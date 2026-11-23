// Offline browser checks of the actual ranking page and roster card.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const run = promisify(execFile);
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const page = resolve('src/pages/League/PowerRankings.tsx');
const roster = resolve('src/pages/League/HockeyTeamDetail.tsx');
const team = {id:1,team_name:'Fixture Franchise',abbreviation:'FIX'};
const row = {id:1,player_id:1,season_year:2027,fantasy_team_id:1,position:'C',salary:500000,contract_group:'ELC',term_end_year:2029,player:{player_api_id:'8479420',full_name:'Tage Thompson'}};
const common = `const delay=v=>new Promise(r=>setTimeout(()=>r(v),100));`;
const mocks = {
 PageMeta:'export default function PageMeta(){return null}',
 fantasyTeams:`${common} export const applyTeamBranding=t=>t;export const fetchFantasyTeams=()=>{globalThis.__metadataCalls=(globalThis.__metadataCalls||0)+1;return delay([${JSON.stringify(team)}]);};export const fetchTeamBrandingHistory=()=>delay([]);`,
 fantasyPlayers:`${common} export const fetchPlayerSeasonsBySeason=()=>delay([${JSON.stringify(row)}]);`,
 transactions:`${common} export const fetchLeagueTransactions=()=>delay([]);`,
 nhl:`${common} const skaters=[{playerId:8479420,skaterFullName:'Tage Thompson',positionCode:'C',teamAbbrevs:'BUF',gamesPlayed:10,goals:3,assists:4,points:7,testScore:25}];
 export const formatFantasyPoints=n=>n.toFixed(2);export const getSkaterScore=r=>r.testScore;export const getGoalieScore=()=>0;
 export const fetchNhlSkaterStats=()=>delay(skaters);export const fetchNhlGoalieStats=()=>delay([]);
 function period(start,value){if(!globalThis.__selectedStart)globalThis.__selectedStart=start;
 if(start!==globalThis.__selectedStart){globalThis.__comparisonCalls=(globalThis.__comparisonCalls||0)+1;return new Promise(()=>{});}return delay(value);}
 export const fetchNhlSkaterStatsForPeriod=(id,start)=>period(start,skaters);export const fetchNhlGoalieStatsForPeriod=(id,start)=>period(start,[]);
 export const fetchNhlPlayerLanding=()=>{throw Error('Photo must not fetch a profile');};`,
};
async function bundle(contents, card=false) {
 return (await build({stdin:{contents,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',
 define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'offline-ranking-fixtures',setup(plugin){
  plugin.onResolve({filter:/.*/},args=>{const name=args.path.split('/').at(-1).replace(/\.ts$/,'');
   if(args.importer===page&&name in mocks)return{path:name,namespace:'fixture'};
   if(card&&name==='supabase')return{path:'supabase',namespace:'fixture'};});
  plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='supabase'?'export const supabase={};':mocks[args.path]}));
  if(card)plugin.onLoad({filter:/HockeyTeamDetail\.tsx$/},async()=>({contents:(await readFile(roster,'utf8'))+'\nexport {LineupPlayerCard};',loader:'tsx',resolveDir:resolve('src/pages/League')}));
 }}]})).outputFiles[0].text;
}
const rankingScript=await bundle(`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router';import Page from ${JSON.stringify(page)};
 createRoot(document.getElementById('root')).render(<BrowserRouter><Page/></BrowserRouter>);
 const results=[];const click=label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label)?.click();
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 (async()=>{await wait(400);for(const mode of ['Periods','Months','Full Season']){
  globalThis.__selectedStart=undefined;click(mode);await wait(250);
  if(mode==='Months'){const select=[...document.querySelectorAll('select')].at(-1);select.value='1';globalThis.__selectedStart=undefined;select.dispatchEvent(new Event('change',{bubbles:true}));await wait(250);}
  for(const tab of ['Player Rankings','Team Rankings','Rookie Watch']){click(tab);await wait(100);
   const text=document.body.textContent;results.push({mode,tab,ready:text.includes(tab==='Team Rankings'?'Fixture Franchise':'Tage Thompson')&&!document.querySelector('.animate-pulse')});}
 }
 document.body.setAttribute('data-results',JSON.stringify(results));document.body.setAttribute('data-metadata-calls',String(globalThis.__metadataCalls));document.body.setAttribute('data-comparison-calls',String(globalThis.__comparisonCalls||0));})();`);
const cardScript=await bundle(`import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router';import{LineupPlayerCard}from ${JSON.stringify(roster)};import{playerMetadata}from './src/lib/nhlPlayerMetadata';
 playerMetadata.remember([{playerId:8479420,birthCountryCode:'USA',birthDate:'1997-10-30'}]);
 const start=performance.now();new MutationObserver(()=>{const img=document.querySelector('img[alt="Tage Thompson headshot"]');const flag=document.querySelector('[aria-label="Born in United States"]');
 if(img&&flag&&!document.body.hasAttribute('data-ready-ms')){document.body.setAttribute('data-ready-ms',String(Math.round(performance.now()-start)));document.body.setAttribute('data-photo-url',img.getAttribute('src'));}}).observe(document.body,{childList:true,subtree:true});
 createRoot(document.getElementById('root')).render(<BrowserRouter><LineupPlayerCard season={${JSON.stringify(row)}} score={25}/></BrowserRouter>);`,true);
const server=createServer((req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self';connect-src 'none';img-src 'self' data:;style-src 'unsafe-inline'");
 if(req.url.endsWith('.js')){res.setHeader('Content-Type','text/javascript');res.end(req.url==='/card.js'?cardScript:rankingScript);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><body><div id="root"></div><script src="'+(req.url==='/card'?'/card.js':'/rankings.js')+'"></script></body>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{for(const route of ['/rankings','/card']){const profile=await mkdtemp(join(tmpdir(),'gld-ranking-runtime-'));
 try{const{stdout}=await run(chrome,['--headless','--disable-gpu','--no-first-run','--disable-extensions','--disable-background-networking',`--user-data-dir=${profile}`,'--window-size=390,844',`--virtual-time-budget=${route==='/card'?1500:5000}`,'--dump-dom',`http://127.0.0.1:${server.address().port}${route}`],{timeout:20000,maxBuffer:2000000});
 if(route==='/rankings'){const raw=stdout.match(/data-results="([^"]+)"/);assert.ok(raw,'Ranking scenarios did not finish');const results=JSON.parse(raw[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
 assert.equal(results.length,9);assert.ok(results.every(r=>r.ready),JSON.stringify(results));assert.match(stdout,/data-metadata-calls="1"/);assert.ok(Number(stdout.match(/data-comparison-calls="(\d+)"/)[1])>0);console.log('PASS: all 9 player/team/rookie × period/month/season views render while previous reports remain unresolved; roster metadata fetched once.');
 }else{const ready=stdout.match(/data-ready-ms="(\d+)"/);assert.ok(ready,'Roster card waited for a profile before its headshot and cached flag');assert.ok(Number(ready[1])<1000);assert.match(stdout,/data-photo-url="https:\/\/assets.nhle.com\/mugs\/nhl\/latest\/8479420.png"/);console.log('PASS: actual Tage Thompson roster card requests its static photo and renders the cached USA flag at '+ready[1]+' ms without an NHL profile request.');}
 }finally{await rm(profile,{recursive:true,force:true}).catch(()=>{});}
}}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
