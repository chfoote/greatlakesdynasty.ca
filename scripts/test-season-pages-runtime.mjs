// Actual Standings, Skater Stats, and Goalie Stats with the real shared loader.
// Fixtures replace external services; these checks never sign in or write data.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nhlStatsDate } from "../shared/nhl-live.ts";
import { getGoalieScore, getSkaterScore } from "../shared/nhl-scoring.ts";
const run = promisify(execFile);
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const skater = { playerId: 1, skaterFullName: "Alpha Forward", positionCode: "C", teamAbbrevs: "TOR",
  gamesPlayed: 10, goals: 5, assists: 4, plusMinus: 2, penaltyMinutes: 0, ppGoals: 1, ppPoints: 2,
  shGoals: 0, shPoints: 0, gameWinningGoals: 1, shots: 20, blockedShots: 3, hits: 4, totalFaceoffWins: 30 };
const goalie = { playerId: 3, goalieFullName: "Alpha Goalie", teamAbbrevs: "TOR", gamesPlayed: 10, gamesStarted: 10,
  wins: 5, losses: 4, otLosses: 1, goalsAgainst: 20, saves: 180, shutouts: 1, penaltyMinutes: 0,
  goals: 0, assists: 1, savePct: 0.9, goalsAgainstAverage: 2 };
const source = { schema_version: 1,
  skaters: [skater, { ...skater, playerId: 2, skaterFullName: "Beta Forward", goals: 1, assists: 0 }],
  goalies: [goalie, { ...goalie, playerId: 4, goalieFullName: "Beta Goalie", wins: 1 }],
};
const team = { id: 1, team_name: "Fixture Franchise", abbreviation: "FIX", logo: null };
const roster = [{ id: 1, player_id: 1, position: "C", player: { id: 1, player_api_id: "1", full_name: "Alpha Forward" } },
  { id: 3, player_id: 3, position: "G", player: { id: 3, player_api_id: "3", full_name: "Alpha Goalie" } }]
  .map(row => ({ ...row, fantasy_team_id: 1, fantasy_team: team, salary: 500000, term_end_year: 2029, contract_group: "ELC", season_year: 2027 }));
const expected = { current: (getSkaterScore({ ...skater, goals: 6 }) + getGoalieScore(goalie)).toFixed(1),
  historical: (getSkaterScore(skater) + getGoalieScore(goalie)).toFixed(1) };
const pages = ["Standings", "SkaterStats", "GoalieStats", "HockeyTeamDetail"].map(name => resolve(`src/pages/League/${name}.tsx`));
const mocks = {
  PageMeta: "export default function PageMeta(){return null}",
  fantasyTeams: `export const applyTeamBranding=t=>t;export const fetchFantasyTeams=async()=>[${JSON.stringify(team)}];export const fetchTeamBrandingHistory=async()=>[];export const fetchFantasyTeamByAbbreviation=async()=>(${JSON.stringify(team)});export const fetchTeamManagerTenures=async()=>[];export const fetchTeamFinishes=async()=>[];export const getManagerForSeason=()=>null;`,
  fantasyPlayers: `export const fetchPlayerSeasons=async()=>${JSON.stringify(roster)};export const fetchPlayerSeasonsByPlayers=async()=>${JSON.stringify(roster)};export const fetchPlayerSeasonsByTeam=async()=>${JSON.stringify(roster)};export const fetchPlayerSeasonsByTeamAndSeason=(id,season)=>new Promise(resolve=>setTimeout(()=>resolve(${JSON.stringify(roster)}.map(row=>({...row,season_year:season,term_end_year:season===2026?2066:2029}))),season===2026?350:10));export const fetchPlayerSeasonsBySeason=async season=>${JSON.stringify(roster)}.map(row=>({...row,season_year:season}));`,
  buyouts: "export const fetchBuyoutPenalties=async()=>[];",
  retentions: "export const fetchRetentionAdjustments=async()=>[];",
  capAdjustments: "export const fetchTeamCapAdjustmentTotals=async()=>[];",
  awards: "export const fetchAwards=async()=>[];export const fetchPlayerAwards=async()=>[];export const mapAwardsByPlayer=()=>new Map();",
  prospectRights: "export const fetchProspectRights=async()=>new Map();export const getProspectRight=()=>undefined;export const removeAgedOutProspectRights=async rights=>rights;",
  tradeMarket: "export const fetchTradeBlockListings=async()=>[];",
  teamLeadership: "export const fetchSeasonLeadership=async()=>[];export const fetchTeamLeadership=async()=>[];",
  usePlayerTradeInterest: "export const usePlayerTradeInterest=()=>({canExpressInterest:()=>false,busyPlayerSeasonId:null});",
  supabase: `export const supabase={from(table){if(table!=='power_ranking_snapshots')throw Error('Unexpected database table');
    const state=globalThis.__seasonPageFixture;state.lookups++;let season;const query={select(){return query},eq(key,value){if(key==='season_year')season=value;return query},abortSignal(){return query},async maybeSingle(){
      return {data:state.missing?null:{generated_at:new Date(Date.now()-3600000).toISOString(),stats_through:season===2027?'${nhlStatsDate(-1)}':season+'-04-30',source_stats:state.source},error:null};}};return query;}};`,
};
const fixtureScript = `Object.defineProperty(navigator,"locks",{value:undefined,configurable:true});const state=globalThis.__seasonPageFixture={source:${JSON.stringify(source)},missing:new URLSearchParams(location.search).has('missing'),lookups:0,reports:0,live:0};
 globalThis.fetch=async path=>{const url=new URL(path,location.href);if(url.pathname.includes('/live-snapshot/')){
  state.live++;return Response.json({date:url.pathname.split('/').at(-1),generatedAt:Date.now(),live:true,nextRefreshAt:Date.now()+30000,scoreboard:{games:[]},games:[{
   game:{id:1,gameState:'LIVE'},playByPlay:null,boxscore:{gameState:'LIVE',awayTeam:{abbrev:'TOR',score:1},homeTeam:{abbrev:'BOS',score:0},
    playerByGameStats:{awayTeam:{forwards:[{playerId:1,position:'C',goals:1,assists:0,toi:'10:00'}]}}}}]});}
  if(!url.pathname.startsWith('/nhl-api/complete/'))throw Error('Unexpected HTTP request');state.reports++;
  const data=url.pathname.includes('/goalie/')?state.source.goalies:state.source.skaters;return Response.json({data,total:data.length});};`;
const built = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router';
    import Standings from ${JSON.stringify(pages[0])};import Skaters from ${JSON.stringify(pages[1])};import Goalies from ${JSON.stringify(pages[2])};import Team from ${JSON.stringify(pages[3])};import {playerMetadata} from "./src/lib/nhlPlayerMetadata";
    ${fixtureScript}
    playerMetadata.remember([{playerId:1,birthCountry:"CAN",birthDate:"1995-01-01",currentTeamAbbrev:"TOR"},{playerId:3,birthCountry:"CAN",birthDate:"1995-01-01",currentTeamAbbrev:"TOR"}]);
    const Page=location.pathname==='/standings'?Standings:location.pathname==='/skaters'?Skaters:location.pathname==='/team'?Team:Goalies;
    createRoot(document.getElementById('root')).render(<BrowserRouter><Page/></BrowserRouter>);
    const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async test=>{for(let i=0;i<100&&!test();i++)await wait(100);};const checks={};const expected=${JSON.stringify(expected)};
    const names=()=>[...document.querySelectorAll('tbody a[href^="/player-profile"]')].map(a=>a.textContent);
    const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
    (async()=>{try{await until(()=>Page===Team?document.body.textContent.includes('Alpha Forward'):Page===Standings?document.body.textContent.includes(expected.current):names().length===2);
      if(Page===Team){checks.initial=document.body.textContent.includes('Alpha Forward');for(const label of ['Lineup','Multi-Year']){const control=button(label)||[...document.querySelectorAll('button')].find(b=>b.textContent.includes(label));if(!control)throw Error('Missing team control '+label);control.click();await wait(200);checks[label]=document.body.textContent.includes('Alpha Forward');}button('Roster')?.click();await wait(100);for(const label of ['Today','Yesterday']){button(label).click();await wait(250);checks[label]=!document.body.textContent.includes('Updating…')&&document.body.textContent.includes('Alpha Forward');}button('Season').click();await wait(100);}
      else if(Page===Standings){checks.initial=document.body.textContent.includes(expected.current)&&document.body.textContent.includes('Fixture Franchise');}
      else{checks.initial=names().length===2&&names()[0].startsWith('Alpha');
        document.querySelector('th button[title="Sort by PLAYER"]').click();await wait(100);checks.sort=names()[0].startsWith('Beta');
        const search=document.getElementById('player-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(search,'Alpha');search.dispatchEvent(new Event('input',{bubbles:true}));
        await wait(100);checks.search=names().length===1&&names()[0].startsWith('Alpha');button('Clear Filters').click();await wait(100);
        const rights=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='unowned'));rights.value='owned';rights.dispatchEvent(new Event('change',{bubbles:true}));await wait(100);
        checks.ownership=names().length===1&&names()[0].startsWith('Alpha');button('Clear Filters').click();await wait(100);
      }
      const season=document.querySelector('select');season.value='2026';season.dispatchEvent(new Event('change',{bubbles:true}));await wait(100);await until(()=>Page===Team?document.body.textContent.includes('Alpha Forward'):Page===Standings?document.body.textContent.includes(expected.historical):names().length===2);
      checks.historical=Page===Team?document.body.textContent.includes('Alpha Forward'):Page===Standings?document.body.textContent.includes(expected.historical):names().length===2;
      if(Page===Team){for(const value of ['2027','2026','2027']){season.value=value;season.dispatchEvent(new Event('change',{bubbles:true}));await wait(20);}await wait(500);checks.rapidSwitch=season.value==='2027'&&!document.body.textContent.includes('2066');}
      checks.sharedReads=state.lookups===2;checks.reportCalls=state.reports;checks.liveCalls=state.live;
    }catch(error){checks.error=error.message;}finally{document.body.setAttribute('data-checks',JSON.stringify(checks));}})();`,
    loader: "tsx", resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_SEASON_SNAPSHOTS": '"true"' },
  plugins: [{ name: "season-page-services", setup(plugin) {
    plugin.onResolve({ filter: /.*/ }, args => {
      const name = args.path.split("/").at(-1).replace(/\.ts$/, "");
      if (name === "supabase" || pages.includes(args.importer) && name in mocks) return { path: name, namespace: "fixture" };
    });
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path] }));
  } }],
});
const server = createServer((request, response) => {
  response.setHeader("Content-Security-Policy", "default-src 'self';connect-src 'none';img-src 'none';style-src 'unsafe-inline'");
  response.setHeader("Content-Type", request.url === "/app.js" ? "text/javascript" : "text/html");
  response.end(request.url === "/app.js" ? built.outputFiles[0].text : '<!doctype html><body><div id="root"></div><script src="/app.js"></script></body>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  for (const missing of [false, true]) for (const page of ["standings", "skaters", "goalies", "team"]) {
    const profile = await mkdtemp(join(tmpdir(), "gld-season-pages-"));
    try {
      const { stdout } = await run(chrome, ["--headless", "--disable-gpu", "--no-first-run", "--disable-extensions", "--disable-background-networking",
        `--user-data-dir=${profile}`, "--window-size=1280,900", "--virtual-time-budget=22000", "--dump-dom",
        `http://127.0.0.1:${server.address().port}/${page}${missing ? "?missing" : ""}`], { timeout: 20000, maxBuffer: 2000000 });
      const match = stdout.match(/data-checks="([^"]+)"/);
      assert.ok(match, `Browser checks did not complete for ${page}`);
      const checks = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
      assert.equal(checks.error, undefined, JSON.stringify(checks));
      for (const key of ["initial", "historical", "sharedReads", ...(page === "team" ? ["Lineup", "Multi-Year", "rapidSwitch", "Today", "Yesterday"] : page === "standings" ? [] : ["sort", "search", "ownership"])]) {
        assert.equal(checks[key], true, `${page} ${key}: ${JSON.stringify(checks)}`);
      }
      assert.equal(checks.liveCalls, page === "team" ? 2 : 1);
      assert.ok(missing ? checks.reportCalls > 0 : checks.reportCalls === 0, JSON.stringify(checks));
      console.log(`PASS: ${page} ${missing ? "falls back safely" : "uses saved season data without NHL report requests"}; current/historical totals and controls work.`);
    } finally { await rm(profile, { recursive: true, force: true }).catch(() => {}); }
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
