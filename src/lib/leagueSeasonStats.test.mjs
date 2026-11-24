import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { getSkaterScore, getGoalieScore } from "../../shared/nhl-scoring.ts";

const initialTime = Date.parse("2026-11-24T21:00:00Z");
const skater = {
  playerId: 1, skaterFullName: "Fixture Forward", positionCode: "C", teamAbbrevs: "TOR",
  gamesPlayed: 10, goals: 5, assists: 4, plusMinus: 2, penaltyMinutes: 0,
  ppGoals: 1, ppPoints: 2, shGoals: 0, shPoints: 0, gameWinningGoals: 1,
  shots: 20, blockedShots: 3, hits: 4, totalFaceoffWins: 30,
};
const goalie = {
  playerId: 2, goalieFullName: "Fixture Goalie", teamAbbrevs: "TOR",
  gamesPlayed: 10, gamesStarted: 10, wins: 5, losses: 4, otLosses: 1,
  goalsAgainst: 20, saves: 180, shutouts: 1, penaltyMinutes: 0, goals: 0, assists: 1,
  savePct: 0.9, goalsAgainstAverage: 2,
};
const snapshot = () => ({
  generated_at: "2026-11-24T20:00:00Z", stats_through: "2026-11-23",
  source_stats: { schema_version: 1, skaters: [{ ...skater }], goalies: [{ ...goalie }] },
});
let moduleIndex = 0;
async function setup(t, row = snapshot(), enabled = true) {
  let now = initialTime;
  const requests = [];
  const db = { row, queries: [], failure: false };
  globalThis.__leagueSeasonTest = db;
  t.after(() => { delete globalThis.__leagueSeasonTest; });
  t.mock.method(Date, "now", () => now);
  let liveGoals = 1, unavailable = false, empty = false;
  t.mock.method(globalThis, "fetch", async path => {
    const url = new URL(path, "https://fixture.example");
    requests.push(url.pathname);
    if (url.pathname.includes("/live-snapshot/")) {
      if (unavailable) return Response.json({ error: "limited" }, { status: 429, headers: { "Retry-After": "60" } });
      return Response.json({
        date: url.pathname.split("/").at(-1), generatedAt: now, live: !empty, nextRefreshAt: now + 30000,
        scoreboard: { games: [] }, games: empty ? [] : [{ game: { id: 1, gameState: "LIVE" }, playByPlay: null,
          boxscore: { gameState: "LIVE", awayTeam: { abbrev: "TOR", score: liveGoals }, homeTeam: { abbrev: "BOS", score: 1 },
            playerByGameStats: { awayTeam: { forwards: [{ playerId: 1, position: "C", goals: liveGoals, assists: 0, toi: "10:00" }],
              goalies: [{ playerId: 2, saves: 10, goalsAgainst: 1, starter: true, toi: "10:00" }] } } } }],
      });
    }
    assert.ok(url.pathname.startsWith("/nhl-api/complete/"), "Unexpected NHL call: " + url.pathname);
    const data = [url.pathname.includes("/goalie/") ? goalie : skater];
    return Response.json({ data, total: data.length });
  });
  const built = await build({
    stdin: { contents: `export {fetchLeagueSeasonStats} from './src/lib/leagueSeasonStats';
      export {getNhlStatuses} from './src/lib/nhlSaved';`, resolveDir: process.cwd() },
    bundle: true, write: false, format: "esm", platform: "browser",
    define: { "import.meta.env.VITE_SEASON_SNAPSHOTS": JSON.stringify(String(enabled)) },
    plugins: [{ name: "snapshot-database-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: "database", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export const supabase={from(table){
        const db=globalThis.__leagueSeasonTest;const query={table,filters:{}};db.queries.push(query);
        const chain={select(columns){query.columns=columns;return chain;},eq(key,value){query.filters[key]=value;return chain;},
          abortSignal(){return chain;},async maybeSingle(){if(db.failure)throw Error('Unavailable');return {data:db.row,error:null};}};
        return chain;}};` }));
    } }],
  });
  const api = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64") + "#" + moduleIndex++);
  return { ...api, db, requests, advance: ms => { now += ms; },
    live: goals => { liveGoals = goals; }, failLive: () => { unavailable = true; }, noGames: () => { empty = true; } };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 25));

test("three season-page consumers share one snapshot lookup and one live request", async t => {
  const api = await setup(t);
  const results = await Promise.all(Array.from({ length: 3 }, () => api.fetchLeagueSeasonStats(2027)));
  assert.equal(api.db.queries.length, 1);
  assert.deepEqual(api.db.queries[0].filters, { season_year: 2027, mode: "season", range_index: 0, schema_version: 1 });
  assert.equal(api.db.queries[0].columns, "generated_at, stats_through, source_stats");
  assert.equal(api.requests.length, 1);
  assert.ok(api.requests[0].includes("/live-snapshot/"));
  for (const result of results) {
    assert.equal(result.skaters[0].goals, 6);
    assert.equal(result.skaters[0].gamesPlayed, 11);
    assert.equal(result.goalies[0].saves, 190);
    assert.equal(result.goalies[0].savePct, 190 / 211);
  }
});

test("repeated live refreshes add today's totals once and preserve last good scores during an outage", async t => {
  const api = await setup(t);
  await api.fetchLeagueSeasonStats(2027);
  api.advance(31000); api.live(2);
  await api.fetchLeagueSeasonStats(2027); await flush();
  const updated = await api.fetchLeagueSeasonStats(2027);
  assert.equal(updated.skaters[0].goals, 7);
  assert.equal(updated.skaters[0].gamesPlayed, 11);
  assert.equal(api.db.row.source_stats.skaters[0].goals, 5, "Shared baseline was mutated");
  api.advance(31000); api.failLive();
  await api.fetchLeagueSeasonStats(2027); await flush();
  const retained = await api.fetchLeagueSeasonStats(2027);
  assert.equal(retained.skaters[0].goals, 7);
  assert.equal(api.requests.filter(path => path.includes("/complete/")).length, 0);
});

test("before puck drop the saved season loads without any league-wide NHL reports", async t => {
  const api = await setup(t); api.noGames();
  const result = await api.fetchLeagueSeasonStats(2027);
  assert.equal(result.skaters[0].goals, 5);
  assert.equal(api.requests.length, 1);
});

test("NHL aggregate goalie reports without team abbreviations remain valid scoring inputs", async t => {
  const row = snapshot(); delete row.source_stats.goalies[0].teamAbbrevs;
  const api = await setup(t, row); api.noGames();
  const result = await api.fetchLeagueSeasonStats(2027);
  assert.equal(result.goalies[0].saves, 180);
  assert.equal(result.goalies[0].teamAbbrevs, "");
  assert.equal(api.requests.filter(path => path.includes("/complete/")).length, 0);
});

test("completed historical seasons use one saved dataset and do not request live games", async t => {
  const row = snapshot(); row.stats_through = "2026-04-30";
  const api = await setup(t, row);
  const result = await api.fetchLeagueSeasonStats(2026);
  assert.equal(result.skaters[0].goals, 5);
  assert.equal(result.goalies[0].saves, 180);
  assert.equal(api.requests.length, 0);
});

for (const [name, change] of [
  ["missing", () => null],
  ["older coverage", row => ({ ...row, stats_through: "2026-11-22" })],
  ["coverage already including today", row => ({ ...row, stats_through: "2026-11-24" })],
  ["unknown schema", row => ({ ...row, source_stats: { ...row.source_stats, schema_version: 2 } })],
  ["missing scoring field", row => { delete row.source_stats.skaters[0].totalFaceoffWins; return row; }],
  ["duplicate players", row => { row.source_stats.skaters.push({ ...skater }); return row; }],
]) test(`${name} snapshot falls back to the existing complete NHL loaders`, async t => {
  const api = await setup(t, change(snapshot())); api.noGames();
  const result = await api.fetchLeagueSeasonStats(2027);
  assert.equal(result.skaters[0].goals, 5);
  assert.equal(api.requests.filter(path => path.includes("/complete/")).length, 4);
});

test("a new hockey day rejects yesterday's baseline until the scheduled snapshot catches up", async t => {
  const api = await setup(t);
  await api.fetchLeagueSeasonStats(2027);
  api.advance(24 * 3600_000); api.noGames();
  const result = await api.fetchLeagueSeasonStats(2027);
  assert.equal(api.db.queries.length, 2);
  assert.equal(api.requests.filter(path => path.includes("/complete/")).length, 4);
  assert.equal(result.skaters[0].goals, 5, "Yesterday's live points leaked into the new day");
});

test("a live outage on first load still renders completed-game totals with a delay status", async t => {
  const api = await setup(t); api.failLive();
  const result = await api.fetchLeagueSeasonStats(2027);
  assert.equal(result.skaters[0].goals, 5);
  assert.equal(api.requests.length, 1);
  assert.ok(api.getNhlStatuses().some(status => status.dataset === "league-season:2027" && status.message?.includes("completed games")));
});

test("database errors and a disabled feature keep existing NHL access usable", async t => {
  const api = await setup(t); api.db.failure = true; api.noGames();
  assert.equal((await api.fetchLeagueSeasonStats(2027)).skaters[0].goals, 5);
  assert.equal(api.requests.filter(path => path.includes("/complete/")).length, 4);
});

test("feature rollback bypasses the snapshot database", async t => {
  const api = await setup(t, snapshot(), false); api.noGames();
  assert.equal((await api.fetchLeagueSeasonStats(2027)).skaters[0].goals, 5);
  assert.equal(api.db.queries.length, 0);
});

if (process.env.NHL_SEASON_SNAPSHOT_FIXTURE) test("the actual stored NHL season is accepted without changing its scoring totals", async t => {
  const row = JSON.parse(readFileSync(process.env.NHL_SEASON_SNAPSHOT_FIXTURE, "utf8"));
  const api = await setup(t, row); api.noGames();
  api.advance(Math.max(0, Date.parse(row.generated_at) + 60000 - initialTime));
  const result = await api.fetchLeagueSeasonStats(2027);
  assert.equal(result.skaters.length, row.source_stats.skaters.length);
  assert.equal(result.goalies.length, row.source_stats.goalies.length);
  assert.equal(api.requests.filter(path => path.includes("/complete/")).length, 0);
  for (const [kind, score] of [["skaters", getSkaterScore], ["goalies", getGoalieScore]]) {
    assert.equal(result[kind].reduce((total, player) => total + score(player), 0),
      row.source_stats[kind].reduce((total, player) => total + score(player), 0));
  }
});
