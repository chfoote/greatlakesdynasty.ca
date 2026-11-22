import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSavedNhlCache, NhlBaselineAvailable, validPlayerRows } from './nhlSaved.ts';
import { inheritNhlFreshness, markNhlFetched, markNhlSaved, nhlFreshness } from './nhlFreshness.ts';
const rows = [{ playerId: 1, goals: 5 }];
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let time = Date.parse('2026-11-20T12:00:00Z');
  const entries = new Map([['supabase-auth', 'private-session']]);
  const store = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
  let changes = 0;
  const options = { now: () => time, storage: () => store, onChange: () => changes++ };
  return { entries, options, advance: ms => { time += ms; }, changes: () => changes, now: () => time };
}

test('complete saved statistics survive a reload without a network request', async () => {
  const f = fixture();
  await createSavedNhlCache(f.options)('skaters:20262027', async () => rows, validPlayerRows);
  const reloaded = createSavedNhlCache(f.options);
  assert.deepEqual(await reloaded('skaters:20262027', async () => { throw Error('network should not run'); }, validPlayerRows), rows);
  assert.equal(f.entries.get('supabase-auth'), 'private-session');
});

test('expired complete data appears immediately while one background request updates it', async () => {
  const f = fixture(), cache = createSavedNhlCache(f.options);
  await cache('skaters:20262027', async () => rows, validPlayerRows);
  f.advance(300_001);
  let finish, calls = 0;
  const load = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  assert.deepEqual(await cache('skaters:20262027', load, validPlayerRows), rows);
  assert.deepEqual(await cache('skaters:20262027', load, validPlayerRows), rows);
  assert.equal(calls, 1);
  const next = [{ playerId: 1, goals: 6 }];
  finish(next); await flush();
  assert.deepEqual(await cache('skaters:20262027', load, validPlayerRows), next);
  assert.equal(f.changes(), 1);
});

test('429, network failure and incomplete refresh never overwrite complete saved stats', async () => {
  for (const failure of [() => { throw Error('429'); }, () => { throw Error('network'); }, () => ({ partial: true })]) {
    const f = fixture(), cache = createSavedNhlCache(f.options);
    await cache('goalies:20262027', async () => rows, validPlayerRows);
    const before = f.entries.get('gld:complete-nhl:v1:goalies:20262027');
    f.advance(300_001);
    assert.deepEqual(await cache('goalies:20262027', async () => failure(), validPlayerRows), rows);
    await flush();
    assert.equal(f.entries.get('gld:complete-nhl:v1:goalies:20262027'), before);
    let repeated = false;
    await cache('goalies:20262027', async () => { repeated = true; return []; }, validPlayerRows);
    assert.equal(repeated, false);
  }
});

test('season/date keys never substitute another season or daily result', async () => {
  const f = fixture(), cache = createSavedNhlCache(f.options);
  await cache('live:2026-11-19', async () => rows, validPlayerRows);
  await assert.rejects(cache('live:2026-11-20', async () => { throw Error('unavailable'); }, validPlayerRows));
  await assert.rejects(cache('skaters:20252026', async () => { throw Error('unavailable'); }, validPlayerRows));
});

test('over-age, malformed and future-dated stored values are not used', async () => {
  for (const entry of [{ value: rows, updatedAt: 1 }, { value: { partial: true }, updatedAt: Date.parse('2026-11-20T12:00:00Z') },
    { value: rows, updatedAt: Date.parse('2030-01-01') }]) {
    const f = fixture();
    f.entries.set('gld:complete-nhl:v1:skaters:20262027', JSON.stringify(entry));
    await assert.rejects(createSavedNhlCache(f.options)('skaters:20262027', async () => { throw Error('offline'); }, validPlayerRows));
  }
});

test('unavailable storage does not break successful stats or in-memory fallback', async () => {
  const f = fixture(), cache = createSavedNhlCache({ ...f.options, storage: () => { throw Error('denied'); } });
  assert.deepEqual(await cache('skaters:20262027', async () => rows, validPlayerRows), rows);
  f.advance(300_001);
  assert.deepEqual(await cache('skaters:20262027', async () => { throw Error('429'); }, validPlayerRows), rows);
  await flush();
});

test('a live outage preserves a saved composite instead of overwriting it with the baseline', async () => {
  const f = fixture(), cache = createSavedNhlCache(f.options);
  await cache('live-season:2027', async () => rows, validPlayerRows);
  f.advance(300_001);
  await cache('live-season:2027', async () => { throw new NhlBaselineAvailable([], 'Completed games only'); }, validPlayerRows);
  await flush();
  assert.deepEqual(JSON.parse(f.entries.get('gld:complete-nhl:v1:live-season:2027')).value, rows);
});

test('a first-time visitor may use a complete baseline when live updates fail', async () => {
  const f = fixture();
  assert.deepEqual(await createSavedNhlCache(f.options)('live-season:2027', async () => {
    throw new NhlBaselineAvailable(rows, 'Completed games through yesterday');
  }, validPlayerRows), rows);
  assert.match(JSON.parse(f.entries.get('gld:complete-nhl:v1:live-season:2027')).message, /through yesterday/);
});

test('shared stale data keeps its original timestamp rather than becoming fresh', async () => {
  const f = fixture(), savedAt = f.now() - 3600_000;
  const value = markNhlSaved([{ playerId: 1 }], savedAt);
  await createSavedNhlCache(f.options)('skaters:20262027', async () => value, validPlayerRows);
  assert.equal(JSON.parse(f.entries.get('gld:complete-nhl:v1:skaters:20262027')).updatedAt, savedAt);
  assert.equal(nhlFreshness(value).updatedAt, savedAt);
});

test('older shared data cannot replace a newer complete local snapshot', async () => {
  const f = fixture(), cache = createSavedNhlCache(f.options);
  await cache('skaters:20262027', async () => rows, validPlayerRows);
  const before = f.entries.get('gld:complete-nhl:v1:skaters:20262027');
  const savedAt = f.now() - 3600_000;
  f.advance(300_001);
  await cache('skaters:20262027', async () => markNhlSaved([{ playerId: 1, goals: 1 }], savedAt), validPlayerRows);
  await flush();
  assert.equal(f.entries.get('gld:complete-nhl:v1:skaters:20262027'), before);
});

test('public snapshot eviction never touches authentication storage', async () => {
  const f = fixture(), cache = createSavedNhlCache(f.options);
  for (let i = 0; i < 30; i++) await cache(`skaters:${i}`, async () => rows, validPlayerRows);
  assert.equal(f.entries.get('supabase-auth'), 'private-session');
  assert.ok(JSON.parse(f.entries.get('gld:complete-nhl:v1:index')).length <= 24);
});

test('saved data recovers after cooldown and publishes a new successful timestamp', async () => {
  const f = fixture(), cache = createSavedNhlCache(f.options);
  await cache('skaters:20262027', async () => [{ playerId: 1, goals: 5 }], validPlayerRows);
  f.advance(300_001);
  await cache('skaters:20262027', async () => { throw Error('429'); }, validPlayerRows);
  await flush();
  f.advance(60_001);
  await cache('skaters:20262027', async () => [{ playerId: 1, goals: 6 }], validPlayerRows);
  await flush();
  const entry = JSON.parse(f.entries.get('gld:complete-nhl:v1:skaters:20262027'));
  assert.equal(entry.value[0].goals, 6);
  assert.equal(entry.updatedAt, f.now());
  assert.equal(entry.message, undefined);
});

test('live poll can await the existing background refresh instead of returning the old score again', async () => {
  const f=fixture(), cache=createSavedNhlCache(f.options);
  await cache('live:2026-11-20',async()=>[{playerId:1,goals:3}],validPlayerRows,30000);
  f.advance(30001);
  let finish,calls=0;
  const load=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  const old=await cache('live:2026-11-20',load,validPlayerRows,30000);
  assert.equal(old[0].goals,3);
  const poll=cache('live:2026-11-20',load,validPlayerRows,30000,{waitForRefresh:true});
  finish([{playerId:1,goals:8}]);
  assert.equal((await poll)[0].goals,8);
  assert.equal(calls,1);
});

test('new live totals advance while a valid through-yesterday baseline is reused', async () => {
  const f = fixture(), cache = createSavedNhlCache(f.options);
  const baseline = markNhlFetched([], f.now());
  const assemble = goals => inheritNhlFreshness([{ playerId: 1, goals }],
    [baseline, markNhlFetched([], f.now())], 'latest-if-fresh');
  await cache('live-season:2027', async () => assemble(3), validPlayerRows, 30000);
  f.advance(30001);
  const next = await cache('live-season:2027', async () => assemble(8), validPlayerRows, 30000, { waitForRefresh: true });
  assert.equal(next[0].goals, 8);
  assert.equal(nhlFreshness(next).updatedAt, f.now());
  assert.equal(nhlFreshness(next).message, undefined);
});

test('a delayed composite source keeps its older timestamp and warning', () => {
  const old = markNhlSaved([], 1000, 'Baseline is delayed');
  const live = markNhlFetched([], 2000);
  const composite = inheritNhlFreshness({}, [old, live], 'latest-if-fresh');
  assert.equal(nhlFreshness(composite).updatedAt, 1000);
  assert.equal(nhlFreshness(composite).message, 'Baseline is delayed');
  assert.equal(nhlFreshness(inheritNhlFreshness({}, [markNhlFetched([], 1000), live])).updatedAt, 1000);
});
