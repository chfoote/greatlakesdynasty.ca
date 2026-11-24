import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFarmRankingsCache } from './farmRankingsCache.ts';
import { markNhlSaved } from './nhlFreshness.ts';
const row = { rank:1,eligible:2,nhlActive:1,production:10,draftQuality:90,farmScore:95,
  team:{id:1,team_name:'Public Team',abbreviation:'PUB',logo:null,primary_color:'#123456',secondary_color:null,notes:'private notes',manager_name:'private manager'},
  topProspects:[{playerId:1,name:'Public Player',position:'C',nhlTeam:'TOR',score:10,draftYear:2020,overallPick:1,privateField:'must not persist'}] };
function setup(load=async()=>[structuredClone(row)]) {
  let time=Date.parse('2026-11-21T12:00:00Z');
  const store=new Map([['supabase-auth','private-token']]);
  const options={seasonYear:2027,load,now:()=>time,storage:()=>({getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)})};
  return {options,store,advance:ms=>time+=ms,now:()=>time};
}
test('public ranking display survives reload, whitelists fields and preserves auth storage',async()=>{
  const f=setup();await createFarmRankingsCache(f.options).load();
  const saved=f.store.get('gld:public-farm-rankings:v1:2027');
  assert.ok(!saved.includes('private'));
  const reloaded=createFarmRankingsCache({...f.options,load:async()=>{throw Error('must not fetch');}});
  assert.equal(reloaded.read().rankings[0].farmScore,95);
  assert.equal((await reloaded.load()).rankings[0].team.team_name,'Public Team');
  assert.equal(f.store.get('supabase-auth'),'private-token');
});
test('expired ranking remains readable immediately; requests deduplicate and failure cannot replace it',async()=>{
  let fail=false,calls=0,finish;
  const f=setup(async()=>{calls++;if(fail)return new Promise((resolve,reject)=>{finish=reject;});return [structuredClone(row)];});
  const cache=createFarmRankingsCache(f.options);await cache.load();f.advance(300001);fail=true;
  const a=cache.load(),b=cache.load();assert.equal(a,b);assert.equal(cache.read().rankings[0].farmScore,95);
  await new Promise(resolve=>setImmediate(resolve));finish(Error('429'));
  await assert.rejects(a,/429/);assert.equal(calls,2);assert.equal(cache.read().rankings[0].farmScore,95);
  await assert.rejects(cache.load(),/cooling down/);assert.equal(calls,2);
});
test('invalid and partial rankings cannot overwrite complete saved results',async()=>{
  const f=setup();const cache=createFarmRankingsCache(f.options);await cache.load();
  const before=f.store.get('gld:public-farm-rankings:v1:2027');f.advance(300001);
  f.options.load=async()=>[];
  await assert.rejects(cache.load(),/incomplete/);
  assert.equal(f.store.get('gld:public-farm-rankings:v1:2027'),before);
});
test('saved ranking identity and age prevent another season or future/over-age timestamps being used',async()=>{
  const f=setup();await createFarmRankingsCache(f.options).load();
  assert.equal(createFarmRankingsCache({...f.options,seasonYear:2026}).read(),undefined);
  const original=f.store.get('gld:public-farm-rankings:v1:2027');
  f.store.set('gld:public-farm-rankings:v1:2027',JSON.stringify({...JSON.parse(original),updatedAt:f.now()+3600000}));
  assert.equal(createFarmRankingsCache(f.options).read(),undefined);
  f.store.set('gld:public-farm-rankings:v1:2027',original);
  f.advance(7*86400000+1);assert.equal(createFarmRankingsCache(f.options).read(),undefined);
});
test('disabled storage still permits rankings and stale NHL sources keep their true timestamp',async()=>{
  const f=setup();const savedAt=f.now()-3600000;
  const cache=createFarmRankingsCache({...f.options,storage:()=>{throw Error('blocked');},load:async()=>markNhlSaved([structuredClone(row)],savedAt)});
  const data=await cache.load();assert.equal(data.updatedAt,savedAt);assert.match(data.warning,/saved/);assert.ok(cache.read());
});
test('rankings refresh when the hockey day changes even if the saved snapshot is recent',async()=>{
  let calls=0;const f=setup(async()=>{calls++;return [structuredClone(row)];});
  const cache=createFarmRankingsCache(f.options);await cache.load();
  const saved=JSON.parse(f.store.get('gld:public-farm-rankings:v1:2027'));
  saved.hockeyDate='2026-11-20';saved.updatedAt=f.now()-1000;
  f.store.set('gld:public-farm-rankings:v1:2027',JSON.stringify(saved));
  const reloaded=createFarmRankingsCache(f.options);await reloaded.load();
  assert.equal(calls,2);
  assert.equal(JSON.parse(f.store.get('gld:public-farm-rankings:v1:2027')).hockeyDate,'2026-11-21');
});

test('ownership changes publish even when NHL production has the same fresh timestamp',async()=>{
  const {markNhlFetched}=await import('./nhlFreshness.ts');
  const f=setup();const cache=createFarmRankingsCache(f.options);await cache.load();
  const timestamp=f.now();f.advance(300001);
  f.options.load=async()=>markNhlFetched([{...structuredClone(row),farmScore:96,eligible:3}],timestamp);
  const updated=await cache.load();assert.equal(updated.rankings[0].farmScore,96);assert.equal(updated.rankings[0].eligible,3);
});
