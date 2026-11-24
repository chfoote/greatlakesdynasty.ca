import assert from "node:assert/strict";
import { test } from "node:test";
import { refreshFarmSnapshot } from "./farmSnapshots.ts";
import { farmDraftYears } from "../shared/farm-rankings.ts";
const now=Date.parse("2026-11-24T21:00:00Z");
const skater={playerId:1,skaterFullName:"Prospect One",positionCode:"C",teamAbbrevs:"TOR",gamesPlayed:10,goals:5,assists:4,plusMinus:0,penaltyMinutes:0,
  ppGoals:0,ppPoints:0,shGoals:0,shPoints:0,gameWinningGoals:0,shots:0,blockedShots:0,hits:0,totalFaceoffWins:0};
function fixture({savedDrafts=false,fail=false,stale=false,invalid=false,extraRows=false}={}){
  const writes=[],calls=[];const drafts=farmDraftYears(2027).map(year=>({year,picks:[{overallPick:1,firstName:{default:"Prospect"},lastName:{default:"One"},positionCode:"C",teamAbbrev:"TOR"}]}));
  const tables={
    power_ranking_snapshots:[{stats_through:"2026-11-23",source_stats:{schema_version:1,skaters:[skater],goalies:[{playerId:2,goalieFullName:"Goalie",wins:1,otLosses:0,goalsAgainst:0,saves:0,shutouts:0,penaltyMinutes:0,goals:0,assists:0}]}}],
    farm_ranking_snapshots:savedDrafts?[{drafts,drafts_checked_at:new Date(now).toISOString()}]:[],
    fantasy_teams:[{id:1,team_name:"Public Team",abbreviation:"PUB",eastern_farm_system:"TOR",notes:"DO_NOT_SAVE",manager_name:"PRIVATE"}],
    fantasy_team_branding_history:[],
    player_seasons:Array.from({length:extraRows?1001:1},(_,i)=>({id:i+1,season_year:2027,position:"PROSPECT",fantasy_team_id:1,updated_at:"2026-01-01",player:{player_api_id:String(2000+i),full_name:"Unrelated Player"}})),
  };
  return {writes,calls,tables,run:()=>refreshFarmSnapshot({url:"https://database.example",key:"fixture",now,sleep:async()=>{},
    getReport:async path=>{calls.push(path);if(fail)return new Response(null,{status:429});
      const year=Number(path.split('/').at(-2));const payload={draftYear:year,picks:invalid?[]:drafts.find(d=>d.year===year).picks};
      return Response.json(payload,{headers:stale?{"X-NHL-Stale":"1"}:{}});},
    fetcher:async(url,request)=>{assert.equal(request.redirect,"manual");
      if(request.method==="POST"){writes.push(JSON.parse(request.body));return new Response(null,{status:204});}
      const table=url.pathname.split('/').at(-1),offset=Number(url.searchParams.get('offset'));
      return Response.json(tables[table].slice(offset,offset+1000));},
  })};
}
test("farm job saves complete public results without roster, notes, or manager fields",async()=>{
  const f=fixture();await f.run();assert.equal(f.calls.length,7);assert.equal(f.writes.length,1);
  const saved=f.writes[0];assert.equal(saved.rankings[0].rank,1);assert.ok(saved.rankings[0].production>0);assert.equal(saved.signature.length,64);
  assert.ok(!JSON.stringify(saved).includes('DO_NOT_SAVE'));assert.ok(!JSON.stringify(saved).includes('PRIVATE'));assert.equal(saved.player_seasons,undefined);
});
test("later jobs reuse saved draft inputs without issuing NHL requests",async()=>{
  const f=fixture({savedDrafts:true});await f.run();assert.equal(f.calls.length,0);assert.equal(f.writes.length,1);
});
test("all ownership pages are read before ranking so late rows cannot be ignored",async()=>{
  const f=fixture({savedDrafts:true,extraRows:true});
  f.tables.player_seasons[1000]={id:1001,season_year:2027,position:"C",fantasy_team_id:1,updated_at:"2026-01-01",player:{player_api_id:"1",full_name:"Prospect One"}};
  await f.run();assert.equal(f.writes[0].rankings[0].eligible,0);
});
for(const option of ['fail','stale','invalid'])test(`${option} drafts never replace an existing farm snapshot`,async()=>{
  const f=fixture({[option]:true});await assert.rejects(f.run());assert.equal(f.writes.length,0);
});
test("a season baseline with missing completed days cannot publish farm rankings",async()=>{
  const f=fixture();f.tables.power_ranking_snapshots[0].stats_through="2026-11-22";await assert.rejects(f.run(),/baseline/);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
});
