import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
let sequence=0;
async function fixture(t, changes = {}) {
  const date=new Date();
  const earliest=date.getFullYear()-((date.getMonth()>8 || (date.getMonth()===8 && date.getDate()>=15))?6:7);
  const state={drafts:[],landings:[],earliest,birthDate:`${date.getFullYear()-24}-01-01`,...changes};
  globalThis.__farmFixture=state;
  t.after(()=>{delete globalThis.__farmFixture;});
  const sources={
    fantasyTeams:`export const applyTeamBranding=t=>t; export async function fetchTeamBrandingHistory(){return []}
      export async function fetchFantasyTeams(){return [{id:1,team_name:'Team 1',eastern_farm_system:'TOR'},{id:2,team_name:'Team 2',eastern_farm_system:'BOS'}]}`,
    fantasyPlayers:`export async function fetchPlayerSeasons(){return []}`,
    nhl:`export const getGoalieScore=()=>0; export const getSkaterScore=()=>0; export async function searchNhlPlayers(){return []}
      export async function fetchNhlDraftPicks(year){const s=globalThis.__farmFixture;s.drafts.push(year);return year===s.earliest?
        [{firstName:{default:'Player'},lastName:{default:'One'},positionCode:'C',teamAbbrev:'TOR',overallPick:1},
         {firstName:{default:'Player'},lastName:{default:'Two'},positionCode:'C',teamAbbrev:'BOS',overallPick:2}]:[];}
      export async function fetchNhlLiveSeasonStats(){const s=globalThis.__farmFixture;return {skaters:[{playerId:1,skaterFullName:'Player One',birthDate:s.birthDate},
        {playerId:2,skaterFullName:'Player Two',birthDate:s.birthDate}],goalies:[]};}
      export async function fetchNhlPlayerLanding(id){const s=globalThis.__farmFixture;s.landings.push(id);if(s.deferLandings)return new Promise(()=>{});return {birthDate:s.birthDate,headshot:'fixture.png'}}`,
  };
  const built=await build({entryPoints:['src/lib/farmInsights.ts'],bundle:true,format:'esm',platform:'browser',write:false,
    plugins:[{name:'farm-read-only-fixtures',setup(plugin){
      plugin.onResolve({filter:/^\.\/(fantasyTeams|fantasyPlayers|nhl)$/},args=>({path:args.path.slice(2),namespace:'farm-fixture'}));
      plugin.onLoad({filter:/.*/,namespace:'farm-fixture'},args=>({contents:sources[args.path]}));
    }}]});
  const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64')+`#farm-${sequence++}`);
  return {state,api};
}

test('Front Office requests only its own aging candidates and the two relevant draft years',async t=>{
  const {state,api}=await fixture(t);
  const result=await api.fetchFarmInsights(1);
  assert.deepEqual([...result.agingByTeam.keys()],[1]);
  assert.equal(result.agingByTeam.get(1)[0].name,'Player One');
  assert.deepEqual(state.drafts.sort(),[state.earliest,state.earliest+1]);
  assert.deepEqual(state.landings,[]);
  assert.equal(result.rankings.length,0);
  await api.fetchFarmInsights(1);
  assert.equal(state.landings.length,0);
});

test('full farm rankings remain available and do not reuse a team-only result',async t=>{
  const {state,api}=await fixture(t);
  await api.fetchFarmInsights(1);
  const league=await api.fetchFarmInsights();
  assert.equal(league.rankings.length,2);
  assert.deepEqual([...league.agingByTeam.keys()],[1,2]);
  assert.ok(state.drafts.some(year=>year>state.earliest+1));
  assert.equal(state.landings.length,0);
});

test('rankings do not wait for profile photos or league-wide birthday checks',async t=>{
  const {state,api}=await fixture(t,{deferLandings:true});
  const result=await api.fetchFarmInsights(undefined,{rankingsOnly:true});
  assert.equal(result.rankings.length,2);
  assert.equal(result.agingByTeam.size,0);
  assert.equal(state.landings.length,0);
});

test('rankings-only results preserve the original ranking scores and ordering',async t=>{
  const {api}=await fixture(t);
  const simple=await api.fetchFarmInsights(undefined,{rankingsOnly:true});
  const full=await api.fetchFarmInsights();
  const values=result=>result.rankings.map(row=>[row.team.id,row.rank,row.farmScore,row.production,row.draftQuality,row.eligible]);
  assert.deepEqual(values(simple),values(full));
});
