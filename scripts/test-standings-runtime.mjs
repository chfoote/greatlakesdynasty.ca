// Two isolated browser caches, delayed league metadata, and a newer NHL update.
// No production requests or account credentials are used.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const run=promisify(execFile),page=resolve('src/pages/League/Standings.tsx');
const original=process.argv.includes('--baseline')?(await run('git',['show','HEAD:src/pages/League/Standings.tsx'])).stdout:undefined;
const chrome=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mocks={
 PageMeta:'export default function PageMeta(){return null}',
 fantasyTeams:`export const applyTeamBranding=t=>t;export const fetchTeamBrandingHistory=async()=>[];
 export const fetchFantasyTeams=()=>new Promise(r=>setTimeout(()=>r([{id:1,team_name:'Georgian Bay Bears',abbreviation:'GBB'}]),1000));`,
 fantasyPlayers:`export const fetchPlayerSeasonsBySeason=()=>new Promise(r=>setTimeout(()=>r([{id:1,player_id:1,season_year:2027,fantasy_team_id:1,position:'C',player:{player_api_id:'8478402',full_name:'Fixture Player'}}]),1000));`,
 nhl:`let calls=0,dailyCalls=0;const initial=()=>Number(new URLSearchParams(location.search).get('initial'));const data=score=>({skaters:[{playerId:8478402,gamesPlayed:20,testScore:score}],goalies:[]});function stats(){calls++;return Promise.resolve(data(calls===1?initial():1545));}
 export const fetchNhlLiveSeasonStats=()=>stats();export const fetchNhlSkaterStats=async()=>[];export const fetchNhlGoalieStats=async()=>[];
 export const fetchNhlDailyStats=()=>++dailyCalls===1?new Promise(r=>setTimeout(()=>r(data(initial())),500)):Promise.resolve(data(1545));export const getNhlStatsDate=()=> '2026-11-23';export const getSkaterScore=r=>r.testScore;export const getGoalieScore=()=>0;`,
};
const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router';import Page from ${JSON.stringify(page)};
 createRoot(document.getElementById('root')).render(<BrowserRouter><Page/></BrowserRouter>);
 setTimeout(()=>{const view=new URLSearchParams(location.search).get('view');if(view!=='season')[...document.querySelectorAll('button')].find(b=>b.textContent===view)?.click();},50);
 setTimeout(()=>window.dispatchEvent(new Event('nhl-data-updated')),100);
 setTimeout(()=>{document.body.setAttribute('data-latest-total',String(document.body.textContent.includes('1545')&&!document.body.textContent.includes('Updating…')));},1800);`,loader:'tsx',resolveDir:process.cwd()},
 bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'standings-read-only-fixture',setup(plugin){
 plugin.onResolve({filter:/.*/},args=>{const name=args.path.split('/').at(-1).replace(/\.ts$/,'');if(args.importer===page&&name in mocks)return{path:name,namespace:'fixture'};});
 plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path]}));
 if(original)plugin.onLoad({filter:/Standings\.tsx$/},()=>({contents:original,loader:'tsx',resolveDir:resolve('src/pages/League')}));
 }}]});
const server=createServer((req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self';connect-src 'none';img-src 'none';style-src 'unsafe-inline'");res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');
 res.end(req.url==='/app.js'?built.outputFiles[0].text:'<!doctype html><body><div id="root"></div><script src="/app.js"></script></body>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{for(const [initial,view] of [[1544.4,'season'],[1545,'season'],[1544.4,'today'],[1544.4,'yesterday']]){const profile=await mkdtemp(join(tmpdir(),'gld-standings-browser-'));
 try{const{stdout}=await run(chrome,['--headless','--disable-gpu','--no-first-run','--disable-extensions','--disable-background-networking',`--user-data-dir=${profile}`,'--window-size=1280,900','--virtual-time-budget=2200','--dump-dom',`http://127.0.0.1:${server.address().port}/?initial=${initial}&view=${view}`],{timeout:20000,maxBuffer:2000000});
 assert.ok(stdout.includes('data-latest-total="true"'),'An older initial cache overwrote the newer standings update after delayed roster metadata arrived.');
 console.log('PASS: isolated browser initially holding '+initial+' ('+view+') converges on 1545.0 after the same source update; older requests cannot restore the old total or leave Updating stuck.');
 }finally{await rm(profile,{recursive:true,force:true}).catch(()=>{});}
}}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
