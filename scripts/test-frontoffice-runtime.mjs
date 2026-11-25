// Offline browser regression: optional data is delayed 30 seconds, core data
// 100 ms. The real Front Office component must render before optional data.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
const run = promisify(execFile);
const baselineRef = process.argv.find(value => value.startsWith('--baseline-ref='))?.slice('--baseline-ref='.length);
const baseline = process.argv.includes('--baseline') || Boolean(baselineRef);
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chrome)) throw Error('Set CHROME_PATH to an installed Chrome/Chromium browser.');
const managerPath = resolve('src/pages/League/ManagerCommandCenter.tsx');
const baselineSource = baseline ? (await run('git', ['show', `${baselineRef || 'HEAD'}:src/pages/League/ManagerCommandCenter.tsx`])).stdout : undefined;
const team = { id: 1, team_name: 'Timing Test Team', abbreviation: 'TIM', primary_color: '#123456', secondary_color: '#654321' };
const row = { id: 1, player_id: 1, season_year: 2027, fantasy_team_id: 1, position: 'C', salary: 1000000, term_end_year: 2027,
  player: { player_api_id: '8478402', full_name: 'Test Player' } };
const common = `const delay=(value,ms=30000)=>new Promise(resolve=>setTimeout(()=>resolve(value),ms));`;
const mocks = {
  AuthContext: `const user={id:'fixture-user',email:'fixture@example.invalid'}; export const useAuth=()=>({user});`,
  teamLeadership: `${common} export const fetchTeamLeadership=()=>delay([]); export const setTeamLeadershipSlot=()=>{throw Error('Unexpected write')};`,
  PageMeta: `export default function PageMeta(){return null}`,
  useNhlDataRevision: `export const useNhlDataRevision=()=>0;`,
  leagueSeasons: `export const CURRENT_LEAGUE_SEASON=2027;`,
  teamUserAssignments: `${common} const assigned={fantasy_team_id:1,fantasy_team:${JSON.stringify(team)},profile:{display_name:'Timing Tester'}};
    export const fetchUserTeamAssignment=()=>delay(assigned,10); export const fetchLatestUserTeamAssignment=()=>delay(assigned,10);`,
  fantasyPlayers: `${common} export const fetchPlayerSeasonsBySeason=year=>delay(year===2027?[${JSON.stringify(row)}]:[],year===2027?100:30000);`,
  fantasyTeams: `${common} export const applyTeamBranding=team=>team; export const fetchTeamBrandingHistory=()=>delay([],100);`,
  buyouts: `${common} export const fetchBuyoutPenalties=()=>delay([],100);`,
  retentions: `${common} export const fetchRetentionAdjustments=()=>delay([],100);`,
  auctions: `${common} export const fetchAuctions=()=>delay([]);`,
  tradeOffers: `${common} export const fetchTradeOffers=()=>delay([]);`,
  tradeMarket: `${common} export const fetchPlayerTradeInterests=()=>delay([]); export const fetchTradeBlockListings=()=>delay([]);`,
  transactions: `${common} export const fetchLeagueTransactions=()=>delay([]);`,
  farmInsights: `${common} export const fetchFarmInsights=()=>delay({agingByTeam:new Map()});`,
  leagueSeasonStats: `${common} export const fetchLeagueSkaterStats=()=>delay([]); export const fetchLeagueGoalieStats=()=>delay([]);`,
  nhl: `${common} export const fetchNhlSkaterStats=()=>delay([]); export const fetchNhlGoalieStats=()=>delay([]);
    export const formatFantasyPoints=value=>value.toFixed(2); export const getSkaterScore=()=>0; export const getGoalieScore=()=>0;`,
};
const built = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {BrowserRouter} from 'react-router'; import Manager from ${JSON.stringify(managerPath)};
    const started=performance.now();
    new MutationObserver(()=>{if(document.body.textContent.includes('Timing Test Team') && document.body.textContent.includes('Cap Space')
      && !document.body.hasAttribute('data-ready-ms')) document.body.setAttribute('data-ready-ms',String(Math.round(performance.now()-started)));})
      .observe(document.body,{subtree:true,childList:true});
    createRoot(document.getElementById('root')).render(<BrowserRouter><Manager/></BrowserRouter>);`,
    loader: 'tsx', resolveDir: process.cwd() }, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', write: false,
  define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'offline-dashboard-fixtures', setup(plugin) {
    plugin.onResolve({ filter: /.*/ }, args => {
      if (args.importer !== managerPath) return;
      const key=args.path.split('/').at(-1);
      if (key in mocks) return {path:key,namespace:'dashboard-fixture'};
    });
    plugin.onLoad({filter:/.*/,namespace:'dashboard-fixture'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
    if (baselineSource) plugin.onLoad({filter:/ManagerCommandCenter\.tsx$/},()=>({contents:baselineSource,loader:'tsx',resolveDir:resolve('src/pages/League')}));
  }}] });
const js=built.outputFiles[0].text;
const server=createServer((request,response)=>{
  response.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  response.setHeader('Content-Type',request.url==='/app.js'?'text/javascript':'text/html');
  response.end(request.url==='/app.js'?js:'<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(join(tmpdir(),'gld-dashboard-browser-'));
try {
  const {stdout}=await run(chrome,['--headless','--disable-gpu','--no-first-run','--disable-extensions','--disable-sync',
    '--disable-background-networking',`--user-data-dir=${profile}`,'--virtual-time-budget=2000','--dump-dom',
    `http://127.0.0.1:${server.address().port}/`],{timeout:20000,maxBuffer:2000000});
  const ready=stdout.match(/data-ready-ms="(\d+)"/);
  assert.ok(ready,`${baseline?'Baseline':'Updated'} dashboard did not render within the 2-second browser budget while optional data waited 30 seconds.`);
  assert.ok(Number(ready[1])<2000);
  assert.ok(stdout.includes('Loading recent activity'));
  assert.ok(stdout.includes('$49,000,000'));
  console.log(`PASS: dashboard rendered at ${ready[1]} ms with NHL, activity and prior-year reads still delayed 30 seconds. Cap/roster data visible; optional activity marked loading.`);
} finally {
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
