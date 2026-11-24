// Exercise the snapshot database requests in workerd, including redirect handling.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { resolve } from "node:path";

const skater = {
  playerId: 8479420, gamesPlayed: 2, goals: 3, assists: 1, hits: 5,
  blockedShots: 0, totalFaceoffWins: 0, plusMinus: 0, penaltyMinutes: 0,
  ppGoals: 0, ppPoints: 0, shGoals: 0, shPoints: 0,
  gameWinningGoals: 0, shots: 0, teamAbbrevs: "BUF",
};
const tables = {
  power_ranking_snapshots: [],
  fantasy_teams: [{ id: 1, team_name: "Fixture Team", abbreviation: "FIX", logo: null }],
  fantasy_team_branding_history: [],
  player_seasons: [{
    id: 1, player_id: 8, fantasy_team_id: 1, position: "C", salary: 500000,
    term_end_year: 2029, contract_group: "ELC",
    player: { player_api_id: "8479420", full_name: "Tage Thompson" },
  }],
  league_transactions: [],
};
const { outputFiles } = await build({
  stdin: {
    contents: `import { refreshRankingSnapshot } from ${JSON.stringify(resolve("worker/rankingSnapshots.ts"))};
      export default { async fetch() {
        await refreshRankingSnapshot({url: "https://database.example", key: "fixture-only",
          now: Date.parse("2026-11-24T15:05:00Z"),
          getReport: async path => Response.json({total: 1, data: [path.includes("goalie")
            ? {playerId: 8479999, gamesPlayed: 2} : ${JSON.stringify(skater)}]})});
        return Response.json({completed: true});
      }};`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const writes = [];
const runtime = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: outputFiles[0].text,
  compatibilityDate: "2026-11-19",
  cf: false,
  outboundService: async request => {
    assert.equal(new URL(request.url).hostname, "database.example");
    if (request.method === "POST") {
      writes.push(await request.json());
      return new Response(null, { status: 204 });
    }
    const table = new URL(request.url).pathname.split("/").at(-1);
    assert.ok(table in tables, `Unexpected table: ${table}`);
    return Response.json(tables[table]);
  },
}));
try {
  const response = await runtime.dispatchFetch("https://runtime.example");
  assert.equal(response.status, 200, await response.text());
  assert.equal(writes.length, 1);
  assert.equal(writes[0].season_year, 2027);
  assert.equal(writes[0].mode, "season");
  assert.ok(writes[0].results.playerRankings[0].points > 0);
  assert.equal(writes[0].results.teamRankings[0].team.id, 1);
  console.log("PASS: workerd reads snapshot inputs and writes complete rankings with the real Fetch API.");
} finally {
  await runtime.dispose();
}
