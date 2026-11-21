import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const team = id => ({ id, team_name: `Team ${id}`, abbreviation: `T${id}` });
const player = (id, year, position, owner) => ({ id: id * 10000 + year, player_id: id, season_year: year,
  position, fantasy_team_id: owner, fantasy_team: team(owner), salary: 1_000_000, term_end_year: 2027,
  player: { id, player_api_id: String(8000000 + id), full_name: `Player ${id}` } });
let moduleId = 0;
async function fixture(t, changes = {}) {
  const state = {
    calls: [], queries: [], writes: 0, failNhl: false, failTable: undefined, stale: false,
    teams: [team(1), team(2)],
    seasons: [player(1, 2026, 'C', 1), player(1, 2027, 'C', 2), player(2, 2027, 'G', 1), player(3, 2028, 'LW', 2)],
    transactions: [{ player_id: 1, season_year: 2027, transaction_type: 'trade', action: 'traded', transaction_date: '2026-11-01',
      trade_offer: { trade_offer_players: [{ player_season: { player_id: 1 }, from_team_id: 1, to_team_id: 2 }] } }],
    ...changes,
  };
  globalThis.__recordBookFixture = state;
  t.after(() => { delete globalThis.__recordBookFixture; });
  const mock = {
    supabase: `export const supabase = { from(table) {
      const query = { select(){return this}, eq(){return this}, neq(){return this}, order(){return this}, limit(){return this},
        then(resolve,reject){ const s=globalThis.__recordBookFixture; s.queries.push(table);
          return Promise.resolve({data:[],error:s.failTable===table?{message:'table unavailable'}:null}).then(resolve,reject); },
        upsert(){globalThis.__recordBookFixture.writes++; throw Error('Unexpected database write');} }; return query;
    } };`,
    fantasyTeams: `export const applyTeamBranding=t=>t;
      export async function fetchFantasyTeams(){return globalThis.__recordBookFixture.teams}
      export async function fetchTeamBrandingHistory(){return []}`,
    fantasyPlayers: `export async function fetchPlayerSeasons(){return globalThis.__recordBookFixture.seasons}
      export async function fetchPlayerSeasonsBySeason(year){return globalThis.__recordBookFixture.seasons.filter(r=>r.season_year===year)}`,
    transactions: `export async function fetchLeagueTransactions(){return globalThis.__recordBookFixture.transactions}`,
    awards: `export async function fetchPlayerAwards(){return []}`,
    teamLeadership: `export async function fetchSeasonLeadership(){return []}`,
    nhl: `import { markNhlSaved } from './nhlFreshness.ts';
      export const getSkaterScore=r=>r.testScore; export const getGoalieScore=r=>r.testScore;
      export const getNhlStatsDate=()=> '2026-11-20';
      async function stats(kind,id,start,end){
        const s=globalThis.__recordBookFixture; s.calls.push({kind,id,start,end});
        if(s.failNhl) throw Error('NHL 429');
        let score=id===20252026?10:20;
        if(start && id===20262027)score=start==='2026-07-01'?8:12;
        const rows=[{ playerId:kind==='skater'?8000001:8000002, positionCode:kind==='skater'?'C':'G',
          gamesPlayed:5,testScore:score,goals:2,assists:1,saves:20,goalsAgainst:2 }];
        return s.stale?markNhlSaved(rows,1795000000000):rows;
      }
      export const fetchNhlSkaterStats=id=>stats('skater',id);
      export const fetchNhlGoalieStats=id=>stats('goalie',id);
      export const fetchNhlSkaterStatsForPeriod=(id,start,end)=>stats('skater',id,start,end);
      export const fetchNhlGoalieStatsForPeriod=(id,start,end)=>stats('goalie',id,start,end);`,
  };
  const built = await build({ entryPoints: ['src/lib/recordBook.ts'], bundle: true, format: 'esm', platform: 'browser', write: false,
    plugins: [{ name: 'read-only-record-fixtures', setup(plugin) {
      plugin.onResolve({ filter: /^\.\/(supabase|fantasyTeams|fantasyPlayers|transactions|awards|teamLeadership|nhl)$/ }, args =>
        ({ path: args.path.slice(2), namespace: 'record-fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'record-fixture' }, args => ({ contents: mock[args.path], resolveDir: process.cwd() + '/src/lib' }));
    } }],
  });
  const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64') + `#records-${moduleId++}`);
  return { state, api };
}

test('Contracts loads despite an NHL outage and unavailable optional record tables', async t => {
  const { state, api } = await fixture(t, { failNhl: true, failTable: 'daily_team_performances' });
  const data = await api.fetchRecordBookData(null, null, undefined, 'contracts');
  assert.equal(state.calls.length, 0);
  assert.equal(state.queries.length, 0);
  const contract = data.contracts.find(row => row.playerId === '8000001');
  assert.equal(contract.aav, 1_000_000);
  assert.equal(contract.years, 2);
  assert.equal(contract.totalValue, 2_000_000);
  assert.equal(contract.position, 'C');
  assert.equal(state.writes, 0);
});

test('position leaders exclude future seasons and skip all trade-period and optional DB requests', async t => {
  const { state, api } = await fixture(t, { failTable: 'record_history' });
  const data = await api.fetchRecordBookData(null, null, undefined, 'leaders');
  assert.equal(state.calls.length, 4);
  assert.ok(state.calls.every(call => !call.start && call.id <= 20262027));
  assert.equal(state.queries.length, 0);
  assert.equal(data.positionLeaders.find(row => row.playerId === '8000001').fantasyPoints, 30);
  assert.ok(!data.positionLeaders.some(row => row.playerId === '8000003'));
});

test('seasonal positional records default to the current season and survive optional rookie-table errors', async t => {
  const { api } = await fixture(t, { failTable: 'rookie_eligibility' });
  const data = await api.fetchRecordBookData(null, null, undefined, 'season');
  assert.equal(data.entries.find(row => row.key === 'top-scoring-c').value, 20);
  assert.match(data.entries.find(row => row.key === 'top-scoring-c').dateLabel, /2027/);
  assert.ok(data.warnings.some(message => /Rookie eligibility/.test(message)));
  assert.ok(!data.entries.some(row => row.key.startsWith('top-rookie-')));
});

test('franchise records retain trade-date ownership credit and never request future periods', async t => {
  const { state, api } = await fixture(t);
  const data = await api.fetchRecordBookData(null, null, undefined, 'franchise');
  const playerLines = data.franchiseStatLines.filter(row => row.playerId === '8000001');
  assert.equal(playerLines.find(row => row.team.id === 1).skater.fantasyPoints, 18);
  assert.equal(playerLines.find(row => row.team.id === 2).skater.fantasyPoints, 12);
  assert.ok(state.calls.filter(call => call.start).every(call => call.end <= '2026-11-20'));
  assert.equal(data.positionLeaders.find(row => row.playerId === '8000001').fantasyPoints, 30);
});

test('simultaneous same-tab loads deduplicate and query identity includes season and section', async t => {
  const { state, api } = await fixture(t);
  const [a,b] = await Promise.all([api.fetchRecordBookData(null, 2026, undefined, 'leaders'), api.fetchRecordBookData(null, 2026, undefined, 'leaders')]);
  assert.equal(a,b);
  assert.equal(state.calls.length, 2);
  await api.fetchRecordBookData(null, 2027, undefined, 'leaders');
  assert.equal(state.calls.length, 4);
  await api.fetchRecordBookData(null, 2027, undefined, 'contracts');
  assert.equal(state.calls.length, 4);
});

test('failed NHL sections do not silently accept partial leader totals and cannot block Contracts', async t => {
  const { state, api } = await fixture(t, { failNhl: true });
  await assert.rejects(api.fetchRecordBookData(null, null, undefined, 'leaders'), /429/);
  const contracts = await api.fetchRecordBookData(null, null, undefined, 'contracts');
  assert.ok(contracts.contracts.length);
  state.failNhl = false;
  assert.ok((await api.fetchRecordBookData(null, null, undefined, 'leaders')).positionLeaders.length);
});

test('saved NHL data is labeled and cannot be written as verified daily records', async t => {
  const { state, api } = await fixture(t, { stale: true });
  const data = await api.fetchRecordBookData(null, null, undefined, 'leaders');
  assert.ok(data.warnings.some(message => /saved/.test(message)));
  await assert.rejects(api.syncDailyRecordSnapshot('2026-11-19'), /Cannot capture verified/);
  assert.equal(state.writes, 0);
});
