import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
let sequence = 0;
async function fixture(t, enabled = true) {
  const state = { rows: Array.from({length:1003}, (_,id)=>({id, salary:123456, notes:'private'})), ranges:[], fail:false, drafts:[{year:2026,picks:[{overallPick:1}]}] };
  globalThis.__labData=state; t.after(()=>delete globalThis.__labData);
  const mocks = {
    supabase:`export const supabase={from(table){const f=globalThis.__labData;let offset=0;const q={select(){return q},order(){return q},range(a,b){offset=a;f.ranges.push([a,b]);return q},abortSignal(){return q},overrideTypes:async()=>({data:f.rows.slice(offset,offset+1000),error:f.fail&&offset?Error('Incomplete contracts'):null})};return q}};`,
    prospectRights:`export const fetchProspectRights=async(year,drafts)=>{globalThis.__labData.received={year,drafts};return new Map()};`,
    farmSharedSnapshot:`export const fetchFarmSharedSnapshot=async()=>({drafts:globalThis.__labData.drafts});`,
  };
  const built=await build({entryPoints:['src/lib/rosterLabData.ts'],bundle:true,format:'esm',platform:'browser',write:false,
    define:{'import.meta.env.VITE_FARM_SNAPSHOTS':JSON.stringify(String(enabled))},plugins:[{name:'lab-fixtures',setup(p){
      p.onResolve({filter:/.*/},args=>{const key=args.path.split('/').at(-1);if(key in mocks)return{path:key,namespace:'fixture'}});
      p.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path]}));
    }}]});
  return {state, api:await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64')+'#'+sequence++)};
}
test('Lab reads complete contracts beyond the first thousand without persisting private data',async t=>{
  const {state,api}=await fixture(t); const rows=await api.fetchRosterLabContracts();
  assert.equal(rows.length,1003);assert.equal(rows.at(-1).salary,123456);
  assert.deepEqual(state.ranges,[[0,999],[1000,1999]]);
});
test('Lab rejects a failed later contract page rather than returning partial payroll',async t=>{
  const {state,api}=await fixture(t);state.fail=true;await assert.rejects(api.fetchRosterLabContracts(),/Incomplete contracts/);
});
test('Lab passes shared draft history into fresh prospect ownership resolution',async t=>{
  const {state,api}=await fixture(t);await api.fetchRosterLabProspectRights();
  assert.equal(state.received.year,2027);assert.deepEqual(state.received.drafts,state.drafts);
});
test('Farm rollback leaves Lab prospect rights on its original draft loader',async t=>{
  const {state,api}=await fixture(t,false);await api.fetchRosterLabProspectRights();assert.equal(state.received.drafts,undefined);
});
