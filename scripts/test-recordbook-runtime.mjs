import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const run=promisify(execFile),root=process.cwd();
const teams=[{id:1,team_name:'Original Franchise',abbreviation:'ONE'},{id:2,team_name:'Current Franchise',abbreviation:'TWO'}];
const player=(year,owner)=>({id:year,player_id:1,season_year:year,position:'C',fantasy_team_id:owner,salary:1000000,term_end_year:2027,player:{id:1,player_api_id:'1',full_name:'Record Forward'},fantasy_team:teams[owner-1]});
const seasons=[player(2026,1),player(2027,2)];
const transactions=[{id:1,season_year:2027,transaction_type:'trade',action:'traded',transaction_date:'2026-11-01',player_id:1,trade_offer:{trade_offer_players:[{from_team_id:1,to_team_id:2,player_season:{player_id:1}}]}}];
const skater={playerId:1,skaterFullName:'Record Forward',positionCode:'C',gamesPlayed:5,goals:2,assists:1,plusMinus:0,penaltyMinutes:0,ppGoals:0,ppPoints:0,shGoals:0,shPoints:0,gameWinningGoals:0,shots:0,blockedShots:0,hits:0,totalFaceoffWins:0};
const common=`const f=new Proxy({},{get:(_,key)=>globalThis.__recordBrowser[key],set:(_,key,value)=>{globalThis.__recordBrowser[key]=value;return true}});`;
const fixture=`Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});globalThis.__recordBrowser={seasons:${JSON.stringify(seasons)},transactions:${JSON.stringify(transactions)},teams:${JSON.stringify(teams)},skater:${JSON.stringify(skater)},queries:[],reports:0,writes:0,missing:new URLSearchParams(location.search).has('missing'),outage:new URLSearchParams(location.search).has('outage')};`;
const services={
 AuthContext:`export const useAuth=()=>({isAdmin:false});`,PageMeta:`export default function Meta(){return null}`,NhlHeadshot:`export default function Headshot(){return null}`,useNhlDataRevision:`export const useNhlDataRevision=()=>0;`,
 fantasyTeams:`${common}export const fetchFantasyTeams=async()=>f.teams;export const fetchTeamBrandingHistory=async()=>[];export const applyTeamBranding=t=>t;export const fetchFantasyTeamByAbbreviation=async code=>f.teams.find(t=>t.abbreviation.toLowerCase()===code.toLowerCase());`,
 fantasyPlayers:`${common}export const fetchPlayerSeasonsBySeason=async year=>f.seasons.filter(row=>row.season_year===year);`,
 transactions:`${common}export const fetchLeagueTransactions=async()=>f.transactions;`,awards:`export const fetchPlayerAwards=async()=>[];`,teamLeadership:`export const fetchSeasonLeadership=async()=>[];`,
 leagueSeasonStats:`${common}export const fetchLeagueSeasonStats=async year=>{if(f.outage)throw Error('NHL unavailable');return {skaters:[{...f.skater,testScore:year===2026?10:20}],goalies:[]}};`,
 nhl:`${common}export {mergeSkaterRecords,mergeGoalieRecords} from ${JSON.stringify(resolve('src/lib/nhl.ts'))};export const getSkaterScore=r=>r.testScore;export const getGoalieScore=()=>0;export const getNhlStatsDate=offset=>offset===-2?'2026-11-22':offset===-1?'2026-11-23':'2026-11-24';export const fetchNhlDailyStats=async()=>({skaters:[],goalies:[]});export const fetchNhlSkaterStatsForPeriod=async(id,start)=>{f.reports++;if(f.outage)throw Error('NHL unavailable');if(!f.missing)return new Promise(r=>setTimeout(()=>r([]),30000));return [{...f.skater,testScore:id===20252026?10:start==='2026-07-01'?8:12}]};export const fetchNhlGoalieStatsForPeriod=async()=>{f.reports++;if(f.outage)throw Error('NHL unavailable');return []};`,
 supabase:`${common}export const supabase={from(table){let filters={},start=0,end=999,periods=[];f.queries.push(table);const q={select(){return q},eq(k,v){filters[k]=v;return q},neq(){return q},or(expression){periods=[...expression.matchAll(/start_date.eq.(\\d{4}-\\d{2}-\\d{2}),end_date.eq.(\\d{4}-\\d{2}-\\d{2})/g)].map(m=>({start_date:m[1],end_date:m[2]}));return q},order(){return q},limit(){return q},range(a,b){start=a;end=b;return q},abortSignal(){return q},overrideTypes(){return q},maybeSingle:async()=>({data:f.missing?null:{generated_at:new Date(Date.now()-1000).toISOString(),skaters:[{...f.skater,testScore:filters.season_year===2026?10:filters.start_date==='2026-07-01'?8:12}],goalies:[]}}),then(resolve,reject){const rows=table==='record_book_nhl_ranges'?periods.map(p=>({...p,generated_at:new Date(Date.now()-1000).toISOString(),skaters:[{...f.skater,testScore:filters.season_year===2026?10:p.start_date==='2026-07-01'?8:12}],goalies:[]})).filter(()=>!f.missing):table==='player_seasons'?f.seasons:table==='league_transactions'?f.transactions:[];return new Promise(r=>setTimeout(()=>r({data:rows.slice(start,end+1),error:null}),50)).then(resolve,reject)},upsert(){f.writes++;throw Error('Unexpected write')}};return q}};`,
};
const checks=`
const f=globalThis.__recordBrowser,checks=[];const wait=ms=>new Promise(r=>setTimeout(r,ms));const text=()=>document.body.textContent;
const check=(value,message)=>{if(!value)throw Error(message)};const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label);
async function tab(label){const began=performance.now();button(label).click();for(let i=0;i<20;i++){await wait(50);if(!document.querySelector('.animate-pulse'))break}check(!document.querySelector('.animate-pulse'),'Tab blocked: '+label);check(text().includes('Record Forward'),'Missing records: '+label);check(performance.now()-began<1500,'Slow tab '+label);checks.push(label)}
(async()=>{try{
 await wait(300);
 if(f.outage){await tab('Contracts');check(text().includes('$2,000,000'),'Contracts unavailable during NHL outage')}
 else{
 check(text().includes('Record Forward'),'Initial leaders blocked');
 const initial=await api.fetchRecordBookData(null,null,undefined,'leaders');check(initial.positionLeaders[0].fantasyPoints===30,'All-time leader totals changed');
 for(const label of ['Leaders – Position','Leaders – Positional by Franchise','Franchise Records','Seasonal – Positional Records','Contracts'])await tab(label);
 const franchise=await api.fetchRecordBookData(null,null,undefined,'franchise');check(franchise.franchiseStatLines.find(r=>r.team.id===1).skater.fantasyPoints===18,'Original franchise credit changed');check(franchise.franchiseStatLines.find(r=>r.team.id===2).skater.fantasyPoints===12,'Current franchise credit changed');
 check(text().includes('$2,000,000'),'Contract value changed');
 const season=document.querySelector('select');season.value='2026';season.dispatchEvent(new Event('change',{bubbles:true}));await wait(150);await tab('Leaders – Position');check(text().includes('Record Forward'),'Historical season failed');
 // Rapid tab changes must not let a late result overwrite the selected view.
 button('Franchise Records').click();button('Contracts').click();await wait(150);check(text().includes('Total value'),'Late result replaced Contracts');
 check(f.queries.filter(t=>t==='player_seasons').length===1,'Tab changes repeated contract input reads');
 if(!f.missing)check(f.reports===0,'Saved Record Book issued league-wide NHL reports');
 }
 check(f.writes===0,'Read path wrote records');document.body.setAttribute('data-result','passed');document.body.setAttribute('data-checks',JSON.stringify(checks));
}catch(error){document.body.setAttribute('data-result','failed');document.body.setAttribute('data-error',error.message)}})();`;
const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router';import Records from ${JSON.stringify(resolve('src/pages/League/RecordBook.tsx'))};import * as api from './src/lib/recordBook';${fixture}createRoot(document.getElementById('root')).render(<BrowserRouter><Records/></BrowserRouter>);${checks}`,loader:'tsx',resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.env.VITE_RECORD_BOOK_SNAPSHOTS':'"true"'},plugins:[{name:'record-browser-fixtures',setup(p){p.onResolve({filter:/.*/},args=>{const key=args.path.split('/').at(-1);if(key in services)return{path:key,namespace:'fixture'}});p.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:services[args.path],resolveDir:resolve('src/lib')}))}}]});
const server=createServer((req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'none'; img-src 'none'; style-src 'unsafe-inline'");res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?built.outputFiles[0].text:'<!doctype html><body><div id="root"></div><script src="/app.js"></script>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{for(const scenario of ['','?missing','?missing&outage']){const profile=await mkdtemp(join(tmpdir(),'gld-records-'));try{const {stdout}=await run(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--no-first-run','--disable-background-networking',`--user-data-dir=${profile}`,'--virtual-time-budget=5000','--dump-dom',`http://127.0.0.1:${server.address().port}/${scenario}`],{timeout:20000,maxBuffer:3000000});assert.ok(stdout.includes('data-result="passed"'),scenario+': '+(stdout.match(/data-error="([^"]*)"/)?.[1]||stdout.slice(-1000)));console.log('PASS Record Book: '+(scenario||'shared spans; all five tabs; zero NHL reports'))}finally{await rm(profile,{recursive:true,force:true}).catch(()=>{})}}}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
