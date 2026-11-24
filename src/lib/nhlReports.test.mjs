import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fetchCompleteNhlReport } from "./nhlReports.ts";

const path = "/nhl-api/skater/summary?limit=-1&cayenneExp=seasonId%3D20262027+and+gameTypeId%3D2";

test("a complete unlimited report needs only one request", async () => {
  let calls = 0;
  const rows = await fetchCompleteNhlReport(path, "summary", async () => {
    calls++;
    return Response.json({ data: [{ playerId: 1 }, { playerId: 2 }], total: 2 });
  });
  assert.equal(calls, 1);
  assert.equal(rows.length, 2);
});

test("truncated unlimited responses fetch every remaining player sequentially", async () => {
  const all = Array.from({ length: 1201 }, (_, i) => ({ playerId: i + 1 }));
  const starts = [];
  let active = 0;
  const result = await fetchCompleteNhlReport(path, "summary", async (requestPath) => {
    active++;
    assert.equal(active, 1);
    const url = new URL(requestPath, "https://test.example");
    assert.equal(url.searchParams.get("cayenneExp"), "seasonId=20262027 and gameTypeId=2");
    assert.equal(JSON.parse(url.searchParams.get("sort"))[0].property, "playerId");
    const start = Number(url.searchParams.get("start"));
    starts.push(start);
    const count = url.searchParams.get("limit") === "-1" ? 50 : 500;
    active--;
    return Response.json({ data: all.slice(start, start + count), total: all.length });
  });
  assert.deepEqual(starts, [0, 50, 550, 1050]);
  assert.deepEqual(result, all);
  assert.equal(result.at(-1).playerId, 1201);
});

test("offset advances by actual rows even when provider caps every page", async () => {
  const starts = [];
  const result = await fetchCompleteNhlReport(path, "summary", async (requestPath) => {
    const start = Number(new URL(requestPath, "https://test.example").searchParams.get("start"));
    starts.push(start);
    return Response.json({ data: Array.from({ length: Math.min(2, 5 - start) }, (_, i) => ({ playerId: start + i })), total: 5 });
  });
  assert.deepEqual(starts, [0, 2, 4]);
  assert.equal(result.length, 5);
});

test("later-page 429 rejects incomplete data without retrying when recovery is disabled", async () => {
  let calls = 0;
  await assert.rejects(fetchCompleteNhlReport(path, "summary", async () => {
    calls++;
    return calls === 1 ? Response.json({ data: [{ playerId: 1 }], total: 2 })
      : Response.json({ error: "limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }, { recoverRateLimit: false }), /429/);
  assert.equal(calls, 2);
});

test("a short 429 cooldown resumes exactly the blocked page without restarting loaded pages", async () => {
  const offsets = [];
  const waits = [];
  let calls = 0;
  const rows = await fetchCompleteNhlReport(path, "summary", async (url) => {
    calls++;
    const offset = Number(new URL(url, "https://test.example").searchParams.get("start"));
    offsets.push(offset);
    if (calls === 2) return Response.json({}, { status: 429, headers: { "Retry-After": "1" } });
    return Response.json({ data: [{ playerId: offset + 1 }], total: 2 });
  }, { sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(offsets, [0, 1, 1]);
  assert.deepEqual(waits, [2000]);
  assert.equal(rows.length, 2);
});

test("repeated 429 and long cooldowns stop without endless retries or partial results", async () => {
  let calls = 0;
  await assert.rejects(fetchCompleteNhlReport(path, "summary", async () => {
    calls++; return Response.json({}, { status: 429, headers: { "Retry-After": "1" } });
  }, { sleep: async () => {} }), /429/);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(fetchCompleteNhlReport(path, "summary", async () => {
    calls++; return Response.json({}, { status: 429, headers: { "Retry-After": "120" } });
  }, { sleep: async () => { throw Error("Long cooldown should not auto-retry"); } }), /429/);
  assert.equal(calls, 1);
});

test("invalid success payloads cannot silently become an empty player list", async () => {
  for (const payload of [{ error: "failed" }, { data: [], total: -1 }, { data: [], total: 1.5 }, { data: [], total: 50001 }, { data: null, total: 0 }]) {
    await assert.rejects(fetchCompleteNhlReport(path, "summary", async () => Response.json(payload)), /invalid report/);
  }
  assert.deepEqual(await fetchCompleteNhlReport(path, "summary", async () => Response.json({ data: [], total: 0 })), []);
});

test("empty, repeated, changing and overfull pages fail instead of dropping players", async () => {
  for (const [next, error] of [
    [{ data: [], total: 3 }, /incomplete/],
    [{ data: [{ playerId: 1 }], total: 3 }, /repeated a page/],
    [{ data: [{ playerId: 2 }], total: 4 }, /changed while loading/],
    [{ data: [{ playerId: 2 }, { playerId: 3 }, { playerId: 4 }], total: 3 }, /inconsistent/],
  ]) {
    let calls = 0;
    await assert.rejects(fetchCompleteNhlReport(path, "summary", async () => Response.json(++calls === 1
      ? { data: [{ playerId: 1 }], total: 3 } : next)), error);
    assert.equal(calls, 2);
  }
});

for (const seasonYear of [2026, 2027]) {
  test(`${seasonYear}: all skaters and goalies survive paging, enrichment and scoring lookup`, async (t) => {
    // Exercise the actual application loader, without Supabase or live NHL calls.
    const built = await build({ entryPoints: ["src/lib/nhl.ts"], bundle: true, format: "esm", platform: "browser", write: false });
    const stats = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64") + `#${seasonYear}`);
    const ids = Array.from({ length: 120 }, (_, i) => 8_000_000 + i);
    const calls = [];
    t.mock.method(globalThis, "fetch", async (requestPath) => {
      const url = new URL(requestPath, "https://test.example");
      calls.push(url.pathname + url.search);
      if (url.pathname.startsWith("/nhl-web-api/live-snapshot/")) return Response.json({
        date: url.pathname.split("/").at(-1), generatedAt: Date.now(), live: false,
        nextRefreshAt: null, scoreboard: { games: [] }, games: [],
      });
      const start = Number(url.searchParams.get("start"));
      const size = url.searchParams.get("limit") === "-1" ? 5 : 500;
      const data = ids.slice(start, start + size).map((playerId) => {
        if (url.pathname.endsWith("/bios")) return { playerId, birthDate: "2000-01-01" };
        if (url.pathname.endsWith("/realtime")) return { playerId, blockedShots: 3, hits: 2 };
        if (url.pathname.endsWith("/faceoffwins")) return { playerId, totalFaceoffWins: 10 };
        if (url.pathname.includes("/goalie/")) return { playerId, goalieFullName: `Goalie ${playerId}`, teamAbbrevs: "TOR", gamesPlayed: 2, gamesStarted: 2, wins: 1, losses: 1, otLosses: 0, goalsAgainst: 3, saves: 50, shutouts: 0, penaltyMinutes: 0, goals: 0, assists: 0, savePct: 50 / 53, goalsAgainstAverage: 1.5 };
        return { playerId, skaterFullName: `Skater ${playerId}`, positionCode: "C", teamAbbrevs: "TOR", gamesPlayed: 2, goals: 2, assists: 3, plusMinus: 1, penaltyMinutes: 2, ppGoals: 0, ppPoints: 0, shGoals: 0, shPoints: 0, gameWinningGoals: 0, shots: 5 };
      });
      return Response.json({ data, total: ids.length });
    });
    const seasonId = (seasonYear - 1) * 10000 + seasonYear;
    const result = seasonYear === 2027 ? await stats.fetchNhlLiveSeasonStats(seasonYear)
      : { skaters: await stats.fetchNhlSkaterStats(seasonId), goalies: await stats.fetchNhlGoalieStats(seasonId) };
    assert.equal(result.skaters.length, 120);
    assert.equal(result.goalies.length, 120);
    if (seasonYear === 2027) {
      await stats.fetchNhlDailyStats(stats.getNhlStatsDate());
      await stats.fetchNhlLivePlayerIds();
      assert.equal(calls.filter((url) => url.includes("/live-snapshot/")).length, 1);
      assert.equal(calls.filter((url) => url.includes("/gamecenter/")).length, 0);
      assert.ok(calls.filter((url) => url.includes("/nhl-api/complete/"))
        .every((requestUrl) => !new URL(requestUrl, "https://test.example").searchParams.get("cayenneExp")?.includes("gameDate")),
      "a quiet-day load should reuse the stable full-season report instead of rebuilding a dated baseline");
    }
    // These are the same string-ID maps used by team pages and standings.
    const skaters = new Map(result.skaters.map((row) => [String(row.playerId), row]));
    const goalies = new Map(result.goalies.map((row) => [String(row.playerId), row]));
    for (const id of ids) {
      assert.ok(stats.getSkaterScore(skaters.get(String(id))) > 0);
      assert.ok(stats.getGoalieScore(goalies.get(String(id))) > 0);
      assert.equal(skaters.get(String(id)).hits, 2);
      assert.equal(skaters.get(String(id)).totalFaceoffWins, 10);
      assert.equal(goalies.get(String(id)).birthDate, undefined);
    }
    assert.ok(calls.some((url) => new URL(url, "https://test.example").pathname.startsWith('/nhl-api/complete/')));
    assert.equal(calls.filter((url) => /^\/nhl-api\/(?:skater|goalie)\//.test(new URL(url, "https://test.example").pathname)).length, 0);
    assert.equal(calls.filter((url) => url.endsWith('/bios')).length, 0);
  });
}

test('complete season baseline remains usable when the live snapshot is rate limited', async t => {
  const built = await build({ entryPoints: ['src/lib/nhl.ts'], bundle: true, format: 'esm', platform: 'browser', write: false });
  const stats = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64') + '#baseline-outage');
  t.mock.method(globalThis, 'fetch', async path => {
    if (path.includes('/live-snapshot/')) return Response.json({ error: 'limited' }, { status: 429, headers: { 'Retry-After': '60' } });
    return Response.json({ data: [{ playerId: 8470001, gamesPlayed: 20, goals: 5 }], total: 1 });
  });
  const result = await stats.fetchNhlLiveSeasonStats(2027);
  assert.equal(result.skaters[0].playerId, 8470001);
  assert.equal(result.skaters[0].goals, 5);
  assert.equal(result.goalies[0].playerId, 8470001);
});
