import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createPlayerMetadataCache } from './nhlPlayerMetadata.ts';

test('public country metadata survives reload without retaining full profiles or account fields', () => {
  const entries = new Map([['supabase-auth', 'untouched']]);
  const storage = () => ({ getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) });
  const first = createPlayerMetadataCache({ storage });
  first.remember([{ playerId: 8479420, birthCountryCode: 'USA', birthDate: '1997-10-30', notes: 'DO_NOT_SAVE', credentials: 'DO_NOT_SAVE' }]);
  const reloaded = createPlayerMetadataCache({ storage });
  assert.equal(reloaded.read('8479420').birthCountry, 'USA');
  assert.equal(entries.get('supabase-auth'), 'untouched');
  assert.ok(!entries.get('gld:public-player-bios:v1').includes('DO_NOT_SAVE'));
});

test('country metadata handles disabled storage, expiry, and invalid countries without guessing', () => {
  let now = 100000;
  const cache = createPlayerMetadataCache({ now: () => now, storage: () => { throw Error('denied'); } });
  cache.remember([{ playerId: 1, birthCountry: 'CAN' }, { playerId: 2, birthCountry: 'unknown' }]);
  assert.equal(cache.read(1).birthCountry, 'CAN');
  assert.equal(cache.read(2), undefined);
  now += 30 * 86400_000;
  assert.equal(cache.read(1), undefined);
});

test('biographies share reports, scope roster queries, and never request individual photos', async () => {
  const calls = [];
  globalThis.__bioCalls = calls;
  try {
    const built = await build({ stdin: { contents: `export { fetchNhlPlayerBiographies } from './src/lib/nhl'; export { playerMetadata } from './src/lib/nhlPlayerMetadata';`, resolveDir: process.cwd() },
      bundle: true, write: false, format: 'esm', platform: 'browser', plugins: [{ name: 'biography-fixture', setup(plugin) {
        plugin.onResolve({ filter: /\.\/nhlReports$/ }, () => ({ path: 'reports', namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export async function fetchCompleteNhlReport(path) {
          globalThis.__bioCalls.push(path); if(globalThis.__bioReport)return globalThis.__bioReport(path);
          return [{playerId:path.includes('/goalie/')?2:8479420,birthCountryCode:'USA',birthDate:'1997-10-30'}]; }` }));
      } }] });
    const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
    await Promise.all([api.fetchNhlPlayerBiographies(20262027), api.fetchNhlPlayerBiographies(20262027)]);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(path => path.includes('/bios?')));
    assert.equal(api.playerMetadata.read(8479420).birthCountry, 'USA');
    calls.length = 0;
    await api.fetchNhlPlayerBiographies(20262027, ['8478402', '8478402', '8477999', 'bad) or secret=1']);
    assert.equal(calls.length, 2);
    for (const path of calls) {
      const query = new URL(path, 'https://fixture.invalid').searchParams.get('cayenneExp');
      assert.equal(query, 'seasonId=20262027 and gameTypeId=2 and (playerId=8478402 or playerId=8477999)');
    }
    calls.length = 0;
    await api.fetchNhlPlayerBiographies(20262027, ['8479420']);
    assert.equal(calls.length, 0, 'Known countries must not trigger new NHL requests');
    let finishGoalies, updates = 0;
    globalThis.__bioReport = path => path.includes('/goalie/')
      ? new Promise((resolve, reject) => { finishGoalies = reject; })
      : Promise.resolve([{ playerId: 3, birthCountryCode: 'CAN' }]);
    const streamed = api.fetchNhlPlayerBiographies(20262027, ['3', '4'], () => updates++);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(api.playerMetadata.read(3).birthCountry, 'CAN', 'Skater country must not wait for goalie bios');
    assert.equal(updates, 1);
    finishGoalies(Error('Goalie metadata temporarily unavailable'));
    await assert.rejects(streamed, /temporarily unavailable/);
    assert.equal(api.playerMetadata.read(3).birthCountry, 'CAN');
  } finally { delete globalThis.__bioCalls; delete globalThis.__bioReport; }
});
