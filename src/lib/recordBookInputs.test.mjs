import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
let seq=0;
async function fixture(t){
 const state={queries:[],rows:Array.from({length:1003},(_,id)=>({id,player_id:id,season_year:2027,salary:1000000})),tx:[{id:1,fantasy_team_id:1,season_year:2026}],fail:false};
 globalThis.__recordInputs=state;t.after(()=>delete globalThis.__recordInputs);
 const sources={fantasyTeams:`export const fetchFantasyTeams=async()=>[{id:1,team_name:'Current'}];export const fetchTeamBrandingHistory=async()=>[];export const applyTeamBranding=(team,brands,year)=>({...team,team_name:year===2026?'Original':team.team_name});`,
 supabase:`export const supabase={from(table){const s=globalThis.__recordInputs;let offset=0;const query={table};s.queries.push(query);const q={select(fields){query.fields=fields;return q},order(){return q},range(a,b){offset=a;query.range=[a,b];return q},abortSignal(){return q},overrideTypes:async()=>({data:(table==='player_seasons'?s.rows:s.tx).slice(offset,offset+1000),error:s.fail&&offset?Error('Later page failed'):null})};return q}};`};
 const built=await build({entryPoints:['src/lib/recordBookInputs.ts'],bundle:true,format:'esm',platform:'browser',write:false,plugins:[{name:'record-input-fixtures',setup(p){p.onResolve({filter:/^\.\/(supabase|fantasyTeams)$/},args=>({path:args.path.slice(2),namespace:'fixture'}));p.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:sources[args.path]}))}}]});
 const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64')+'#'+seq++);return{state,api};
}
test('all tabs share complete paginated contract and minimal transaction inputs',async t=>{const {state,api}=await fixture(t);const [a,b]=await Promise.all([api.fetchRecordBookInputs(),api.fetchRecordBookInputs()]);assert.equal(a,b);assert.equal(a.allSeasons.length,1003);assert.equal(state.queries.length,3);assert.equal(a.transactions[0].fantasy_team.team_name,'Original');assert.ok(state.queries.every(q=>!q.fields.includes('notes')&&!q.fields.includes('profiles')))});
test('failed later pages reject partial financial records and can be retried',async t=>{const {state,api}=await fixture(t);state.fail=true;await assert.rejects(api.fetchRecordBookInputs(),/Later page failed/);state.fail=false;assert.equal((await api.fetchRecordBookInputs()).allSeasons.length,1003)});
test('input cache refreshes after five minutes and explicit daily capture invalidation',async t=>{const {state,api}=await fixture(t);let now=Date.now();t.mock.method(Date,'now',()=>now);await api.fetchRecordBookInputs();state.rows.push({id:1004});await api.fetchRecordBookInputs();assert.equal(state.queries.length,3);now+=300001;assert.equal((await api.fetchRecordBookInputs()).allSeasons.length,1004);api.clearRecordBookInputs();await api.fetchRecordBookInputs();assert.equal(state.queries.length,9)});
