// Exercise the real simulator with slow optional inputs and real React events.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const run=promisify(execFile);
const page=resolve('src/pages/League/RosterLab.tsx');
const teams=[{id:1,team_name:'Lab One',abbreviation:'ONE'},{id:2,team_name:'Lab Two',abbreviation:'TWO'}];
const contract=(id,playerId,name,year,position,salary,teamId=1)=>({id,player_id:playerId,season_year:year,position,salary,fantasy_team_id:teamId,player:{id:playerId,player_api_id:String(playerId),full_name:name},fantasy_team:teams.find(t=>t.id===teamId)});
const rows=[...Array.from({length:3},(_,i)=>contract(i+1,1,'Forward One',2027+i,'C',1000000)),contract(4,2,'Goalie One',2027,'G',2000000),contract(5,3,'Prospect One',2026,'PROSPECT',0),contract(6,4,'Free Agent',2027,'LW',0,null)];
const common=`const wait=(value,ms=100)=>new Promise(r=>setTimeout(()=>r(value),ms));const scenario=new URLSearchParams(location.search).get('case');`;
const mocks={
  AuthContext:`import {useState} from 'react';export const useAuth=()=>{const [user,setUser]=useState({id:'one'});window.changeUser=id=>setUser({id});return {user}};`,
  PageMeta:`export default function Meta(){return null}`,
  PageBreadCrumb:`export default function Breadcrumb(){return null}`,
  useNhlDataRevision:`import {useState,useEffect} from 'react';export function useNhlDataRevision(){const [n,set]=useState(0);useEffect(()=>{window.refreshStats=()=>set(v=>v+1)},[]);return n}`,
  fantasyTeams:`${common}export const fetchFantasyTeams=()=>wait(${JSON.stringify(teams)});`,
  rosterLabData:`${common}export const fetchRosterLabContracts=()=>{window.contractReads=(window.contractReads||0)+1;return wait(${JSON.stringify(rows)})};
    export const fetchRosterLabProspectRights=()=>scenario==='optional-fail'?Promise.reject(Error('rights unavailable')):wait(new Map(),800);`,
  leagueSeasonStats:`${common}export const fetchLeagueSeasonStats=()=>scenario==='optional-fail'?Promise.reject(Error('NHL unavailable')):wait({skaters:[{playerId:1,skaterFullName:'Forward One',positionCode:'C',gamesPlayed:10}],goalies:[{playerId:2,goalieFullName:'Goalie One',gamesPlayed:10}]},800);`,
  nhl:`export const formatFantasyPoints=v=>v.toFixed(2);export const getSkaterScore=()=>100;export const getGoalieScore=()=>200;`,
  buyouts:`${common}let failed=false;export const fetchBuyoutPenalties=year=>{if(scenario==='financial-fail'&&year===2028&&!failed){failed=true;return Promise.reject(Error('Financial read failed'))}return wait(year===2027?[{id:1,fantasy_team_id:1,amount:100000}]:[])};`,
  retentions:`${common}export const fetchRetentionAdjustments=year=>wait(year===2027?[{id:1,fantasy_team_id:1,amount:200000}]:[]);`,
  teamUserAssignments:`${common}export const fetchUserTeamAssignment=user=>wait({fantasy_team_id:user==='two'?2:1});export const fetchLatestUserTeamAssignment=()=>wait(null);`,
};
const checks=`
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const check=(value,message)=>{if(!value)throw Error(message)};
const text=()=>document.body.textContent;
const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label);
const selectLabel=label=>[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith(label))?.querySelector('select');
const choose=async(el,value)=>{check(el,'Missing input');el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));await pause(25)};
const click=async(label)=>{const b=button(label);check(b&&!b.disabled,'Button unavailable: '+label);b.click();await pause(25)};
const payroll=()=>[...document.querySelectorAll('p')].find(p=>p.textContent==='Payroll')?.nextElementSibling.textContent;
const money=value=>check(payroll()===value,'Payroll '+payroll()+' expected '+value);
const pick=async name=>{const el=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.textContent.includes(name)));const option=[...el.options].find(o=>o.textContent.includes(name));await choose(el,option.value)};
(async()=>{try{
 await pause(300);
 if(scenario==='financial-fail'){
  check(text().includes('complete roster and financial data'),'Missing financial failure');check(!button('Apply Mock Move'),'Partial finance allowed actions');
  await click('Retry');await pause(300);money('$3,300,000');
 }else{
  money('$3,300,000');check(text().includes('Forward One'),'Missing roster');
  if(scenario==='optional-fail')check(text().includes('NHL production is unavailable')&&text().includes('Prospect rights are unavailable'),'Missing optional failure notices');
  else check(text().includes('Loading NHL production')&&text().includes('Loading prospect rights'),'Optional reads blocked core or missing loading notices');
  await pick('Forward One');await choose(selectLabel('New Designation'),'LTIR');await click('Apply Mock Move');money('$2,300,000');
  await pause(900);money('$2,300,000');check(text().includes('1 mock moves'),'Optional arrivals reset scenario');
  window.refreshStats();await pause(900);money('$2,300,000');check(window.contractReads===1,'NHL refresh reread/reset contracts');
  if(scenario!=='optional-fail')check(text().includes('100.00 FPTS'),'Production never populated');
  await click('Undo');money('$3,300,000');await click('buyout');await pick('Forward One');await click('Apply Mock Move');money('$2,800,000');
  const projection=[...document.querySelectorAll('section')].find(s=>s.textContent.includes('Five-year view'));check(projection.textContent.includes('$500,000'),'Multi-year buyout projection wrong');
  await click('Reset Lab');money('$3,300,000');await click('trade');await pick('Forward One');
  const slider=document.querySelector('input[type=range]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(slider,'25');slider.dispatchEvent(new Event('input',{bubbles:true}));await pause(25);
  await click('Apply Mock Move');money('$2,550,000');await click('Reset Lab');
  await click('Prospect Call-Up');await pick('Prospect One');await click('Apply Mock Move');money('$3,800,000');await click('Reset Lab');
  await click('signing');await pick('Free Agent');await click('Apply Mock Move');money('$4,050,000');await click('Reset Lab');money('$3,300,000');
  window.changeUser('two');await pause(300);money('$0');check(text().includes('0 mock moves'),'Private scenario survived identity change');
 }
 check(localStorage.length===0,'Private simulator data persisted');
 document.body.setAttribute('data-test','passed');
}catch(e){document.body.setAttribute('data-test','failed');document.body.setAttribute('data-error',e.stack)}})();`;
const built=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Lab from ${JSON.stringify(page)};const scenario=new URLSearchParams(location.search).get('case');createRoot(document.getElementById('root')).render(<Lab/>);${checks}`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'lab-services',setup(p){
 p.onResolve({filter:/.*/},args=>{if(args.importer!==page)return;const key=args.path.split('/').at(-1);if(key in mocks)return{path:key,namespace:'fixture'}});
 p.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
}}]});
const server=createServer((req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'none'; img-src 'none'; style-src 'unsafe-inline'");res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?built.outputFiles[0].text:'<!doctype html><body><div id="root"></div><script src="/app.js"></script>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{for(const scenario of ['slow-optional','optional-fail','financial-fail']){
 const profile=await mkdtemp(join(tmpdir(),'gld-lab-'));
 try{const {stdout}=await run(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--no-first-run','--disable-background-networking',`--user-data-dir=${profile}`,'--virtual-time-budget=7000','--dump-dom',`http://127.0.0.1:${server.address().port}/?case=${scenario}`],{timeout:20000,maxBuffer:2000000});
 assert.ok(stdout.includes('data-test="passed"'),scenario+': '+(stdout.match(/data-error="([^"]*)"/)?.[1]||stdout.slice(-2000)));console.log('PASS Roster Lab: '+scenario);
 }finally{await rm(profile,{recursive:true,force:true}).catch(()=>{})}
}}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
