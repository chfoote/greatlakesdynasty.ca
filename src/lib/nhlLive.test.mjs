import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { nhlStatsDate } from '../../shared/nhl-live.ts';
test('a snapshot restored from saved storage also restores the current polling schedule',async t=>{
 const date=nhlStatsDate();
 globalThis.__savedLiveFixture={date,generatedAt:Date.now()-10000,live:true,nextRefreshAt:Date.now()+20000,scoreboard:{games:[]},games:[]};
 t.after(()=>{delete globalThis.__savedLiveFixture;});
 const built=await build({entryPoints:['src/lib/nhlLive.ts'],bundle:true,format:'esm',platform:'browser',write:false,plugins:[{name:'saved-live-fixture',setup(plugin){
 plugin.onResolve({filter:/nhlSaved\.ts$/},()=>({path:'saved',namespace:'live-fixture'}));
 plugin.onLoad({filter:/.*/,namespace:'live-fixture'},()=>({contents:'export async function savedNhl(){return globalThis.__savedLiveFixture;}'}));
 }}]});
 const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 assert.equal(api.getLiveSchedule(),undefined);
 await api.fetchNhlLiveSnapshot(date);
 assert.equal(api.getLiveSchedule().live,true);
 assert.equal(api.getLiveSchedule().generatedAt,globalThis.__savedLiveFixture.generatedAt);
});
