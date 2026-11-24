import assert from "node:assert/strict";
import { test } from "node:test";
import { refreshRankingSnapshot, selectRankingRange } from "./rankingSnapshots.ts";
import { rankingRange } from "../shared/ranking-ranges.ts";

const now = Date.parse("2026-11-24T15:35:00Z");
const target = { season_year: 2027, mode: "month", range_index: 0 };
const saved = [2026, 2027].flatMap(season_year => [
  { season_year, mode: "season", range_index: 0 },
  ...Array.from({ length: 7 }, (_, range_index) => ({ season_year, mode: "month", range_index })),
  ...Array.from({ length: 14 }, (_, index) => ({ season_year, mode: "period", range_index: index + 1 })),
]).map(range => {
  const { end } = rankingRange(range.season_year, range.mode, range.range_index);
  return { ...range, schema_version: 1, source_schema_version: "1", generated_at: new Date(now).toISOString(), stats_through: end < "2026-11-23" ? end : "2026-11-23" };
});
const sameRange = (row, range = target) => Object.keys(range).every(key => row[key] === range[key]);
const skater = {
  playerId: 8479420, gamesPlayed: 2, goals: 3, assists: 1, plusMinus: 0, penaltyMinutes: 0,
  ppGoals: 0, ppPoints: 0, shGoals: 0, shPoints: 0, gameWinningGoals: 0, shots: 0, teamAbbrevs: "BUF",
};

function fixture(getReport, range = target) {
  const writes = [];
  const tables = {
    power_ranking_snapshots: saved.map(row => ({ ...row,
      ...(sameRange(row, range) ? { generated_at: "2026-11-01T00:00:00Z" } : {}),
      source_stats: { schema_version: 1, skaters: [skater], goalies: [] },
    })),
    fantasy_teams: [1, 2].map(id => ({ id, team_name: `Team ${id}`, abbreviation: `T${id}`, logo: null })),
    fantasy_team_branding_history: [],
    player_seasons: [{
      id: 1, player_id: 8, fantasy_team_id: 2, position: "C", salary: 500000, term_end_year: 2029, contract_group: "ELC",
      player: { player_api_id: "8479420", full_name: "Tage Thompson" },
    }],
    league_transactions: [{
      transaction_date: "2026-11-03",
      trade_offer: { trade_offer_players: [{ from_team_id: 1, player_season: { player_id: 8 } }] },
    }],
  };
  return {
    writes,
    run: () => refreshRankingSnapshot({
      url: "https://supabase.example", key: "fixture", now, getReport,
      fetcher: async (url, request) => {
        if (request.method === "POST") {
          writes.push(JSON.parse(request.body));
          return new Response(null, { status: 204 });
        }
        const table = url.pathname.split("/").at(-1);
        const rows = tables[table];
        return Response.json(table === "power_ranking_snapshots" ? rows.filter(row =>
          ["season_year", "mode", "range_index", "schema_version"].every(key =>
            !url.searchParams.has(key) || `eq.${row[key]}` === url.searchParams.get(key))) : rows);
      },
    }),
  };
}

test("current snapshots need a refresh when the hockey day changes, even before a full day elapses", () => {
  assert.equal(selectRankingRange(saved, now), undefined);
  const nextDay = selectRankingRange(saved, now + 23 * 3600_000);
  assert.equal(nextDay.statsThrough, "2026-11-24");
  assert.equal(nextDay.range.season_year, 2027);
});

test("rebuilds a completed monthly snapshot with the correct historical team and rookie data", async () => {
  const paths = [];
  const { writes, run } = fixture(async path => {
    paths.push(path);
    const data = [path.includes("goalie") ? { playerId: 8479999, gamesPlayed: 2 }
      : { ...skater, hits: 5, blockedShots: 0, totalFaceoffWins: 0 }];
    return Response.json({ data, total: data.length });
  });
  await run();
  assert.equal(paths.length, 4);
  assert.equal(writes.length, 1);
  assert.ok(sameRange(writes[0]));
  assert.equal(writes[0].stats_through, "2026-10-31");
  const [player] = writes[0].results.playerRankings;
  assert.equal(player.team.id, 1);
  assert.equal(player.season.contract_group, "ELC");
  assert.equal(player.points, 12);
  assert.equal(writes[0].results.teamRankings[0].points, player.points);
  assert.equal(writes[0].source_stats.schema_version, 1);
  assert.equal(writes[0].source_stats.skaters.length, 1);
});

test("missing comparison inputs are built before a dependent range", () => {
  const desired = { season_year: 2027, mode: "month", range_index: 1 };
  const rows = saved.map(row => ({ ...row,
    ...(sameRange(row, desired) ? { generated_at: "2026-11-01T00:00:00Z" } : {}),
    ...(sameRange(row) ? { source_schema_version: undefined } : {}),
  }));
  assert.deepEqual(selectRankingRange(rows, now).range, target);
  const ready = rows.map(row => sameRange(row) ? { ...row, source_schema_version: "1" } : row);
  assert.deepEqual(selectRankingRange(ready, now).range, desired);
});

test("comparison movement reuses saved inputs instead of fetching a second NHL range", async () => {
  const paths = [];
  const desired = { season_year: 2027, mode: "month", range_index: 1 };
  const { writes, run } = fixture(async path => {
    paths.push(path);
    return Response.json({ total: 1, data: [path.includes("goalie")
      ? { playerId: 8479999, gamesPlayed: 2 } : { ...skater, hits: 5, blockedShots: 0, totalFaceoffWins: 0 }] });
  }, desired);
  await run();
  assert.equal(paths.length, 4);
  assert.equal(writes.length, 1);
  assert.ok(sameRange(writes[0], desired));
  assert.ok(writes[0].results.playerRankings.some(row => row.movement !== null));
});

test("period backfill advances through missing prerequisites without skipping a comparison", () => {
  const rows = saved.map(row => ({ ...row,
    ...(row.season_year === 2027 && row.mode === "period" && row.range_index === 4
      ? { generated_at: "2026-11-01T00:00:00Z" } : {}),
    ...(row.season_year === 2027 && row.mode === "period" && row.range_index < 4
      ? { source_schema_version: undefined } : {}),
  }));
  for (let index = 1; index <= 4; index++) {
    const next = selectRankingRange(rows, now);
    assert.deepEqual(next.range, { season_year: 2027, mode: "period", range_index: index });
    const row = rows.find(row => sameRange(row, next.range));
    row.source_schema_version = "1";
  }
});

test("rate-limited, stale, or incomplete NHL data leaves the last published snapshot alone", async () => {
  for (const makeResponse of [
    () => new Response(null, { status: 429 }),
    () => Response.json({ data: [skater], total: 1 }, { headers: { "X-NHL-Stale": "1" } }),
    () => Response.json({ data: [skater], total: 2 }),
  ]) {
    const { writes, run } = fixture(makeResponse);
    await assert.rejects(run());
    assert.deepEqual(writes, []);
  }
});
