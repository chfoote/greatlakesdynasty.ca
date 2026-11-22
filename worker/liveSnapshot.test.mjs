import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "./index.ts";

const env = { ASSETS: { fetch() { throw Error("Unexpected asset fallback"); } } };
const time = Date.parse("2026-11-19T23:00:00Z");
const url = "https://league.example/nhl-web-api/live-snapshot/2026-11-19";
const jsonFor = (path, games) => path.includes("/score/") ? { games }
  : path.endsWith("/boxscore") ? { playerByGameStats: { homeTeam: {}, awayTeam: {} } }
  : { plays: [], rosterSpots: [] };

test("one browser response bundles all game data and caches the complete snapshot", async (t) => {
  const entries = new Map();
  const cache = { async match(key) { return entries.get(key.url)?.clone(); }, async put(key, response) { entries.set(key.url, response.clone()); } };
  const worker = createWorker({ now: () => time, cache: async () => cache });
  const games = [{ id: 2026020001, gameState: "LIVE" }, { id: 2026020002, gameState: "FINAL" }];
  const paths = [];
  t.mock.method(globalThis, "fetch", async (upstream) => {
    paths.push(new URL(upstream).pathname);
    return Response.json(jsonFor(String(upstream), games));
  });
  const first = await worker.fetch(new Request(url), env);
  const payload = await first.json();
  assert.equal(first.status, 200);
  assert.equal(payload.games.length, 2);
  assert.equal(payload.live, true);
  assert.equal(paths.length, 5);
  assert.equal(entries.size, 2); // Per-game Cache API calls are avoided.
  assert.equal((await worker.fetch(new Request(url), env)).headers.get("X-NHL-Cache"), "HIT");
  assert.equal(paths.length, 5);
});

test("completed games are reused and scheduled games do not fetch box scores", async (t) => {
  const worker = createWorker({ now: () => time, cache: async () => undefined });
  const games = [{ id: 2026020001, gameState: "FINAL" }, { id: 2026020002, gameState: "FUT", startTimeUTC: "2026-11-20T01:00:00Z" }];
  const paths = [];
  t.mock.method(globalThis, "fetch", async (upstream) => { paths.push(String(upstream)); return Response.json(jsonFor(String(upstream), games)); });
  const first = await (await worker.fetch(new Request(url), env)).json();
  assert.equal(first.games[1].boxscore, null);
  assert.equal(first.live, false);
  await worker.fetch(new Request(url), env);
  assert.equal(paths.length, 4); // Two scoreboards + one completed game's pair.
});

test("expired live snapshots return the refreshed score even with a background context", async (t) => {
  let now = time;
  const entries = new Map();
  const cache = {
    async match(key) {
      const entry = entries.get(key.url);
      return entry && entry.expires > now ? entry.response.clone() : undefined;
    },
    async put(key, response) {
      const ttl = Number(response.headers.get("Cache-Control").match(/max-age=(\d+)/)[1]);
      entries.set(key.url, { response: response.clone(), expires: now + ttl * 1000 });
    },
  };
  const worker = createWorker({ now: () => now, cache: async () => cache });
  let score = 3;
  t.mock.method(globalThis, "fetch", async upstream => Response.json(jsonFor(String(upstream),
    [{ id: 2026020001, gameState: "LIVE", homeTeam: { score }, awayTeam: { score: 0 } }])));
  const context = { waitUntil() { assert.fail("Live snapshot must await fresh data, not return old data while refreshing"); } };
  const first = await (await worker.fetch(new Request(url), env, context)).json();
  assert.equal(first.scoreboard.games[0].homeTeam.score, 3);
  score = 8;
  now += 31_000;
  const next = await worker.fetch(new Request(url), env, context);
  assert.equal(next.headers.get("X-NHL-Stale"), null);
  assert.equal((await next.json()).scoreboard.games[0].homeTeam.score, 8);
});

test("snapshot 429 is not cached, passes Retry-After, and queues honor cooldown", async (t) => {
  let puts = 0;
  let calls = 0;
  const worker = createWorker({ now: () => time, cache: async () => ({ async match() {}, async put() { puts++; } }) });
  t.mock.method(globalThis, "fetch", async () => {
    calls++; return Response.json({ error: "limited" }, { status: 429, headers: { "Retry-After": "120" } });
  });
  const first = await worker.fetch(new Request(url), env);
  assert.equal(first.status, 429);
  assert.equal(first.headers.get("Retry-After"), "120");
  assert.equal(first.headers.get("X-NHL-Upstream-Status"), "429");
  assert.equal((await worker.fetch(new Request(url), env)).status, 429);
  assert.equal(calls, 1);
  assert.equal(puts, 0);
});

test("invalid dates, duplicate IDs, and oversized scoreboards cannot fan out", async (t) => {
  const worker = createWorker({ now: () => time, cache: async () => undefined });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ games: Array.from({ length: 17 }, (_, i) => ({ id: 2026020001 + i, gameState: "LIVE" })) }); });
  assert.equal((await worker.fetch(new Request(url.replace("2026-11-19", "2026-02-30")), env)).status, 400);
  assert.equal((await worker.fetch(new Request(url), env)).status, 502);
  assert.equal(calls, 1);
});

test("a maximum sixteen-game bundle stays within 33 external fetches with bounded concurrency", async (t) => {
  const worker = createWorker({ now: () => time, cache: async () => undefined });
  const games = Array.from({ length: 16 }, (_, i) => ({ id: 2026020001 + i, gameState: "LIVE" }));
  let calls = 0;
  let active = 0;
  let maximum = 0;
  t.mock.method(globalThis, "fetch", async (upstream) => {
    calls++; active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--; return Response.json(jsonFor(String(upstream), games));
  });
  assert.equal((await worker.fetch(new Request(url), env)).status, 200);
  assert.equal(calls, 33);
  assert.ok(maximum <= 4);
});

test("simultaneous snapshot builds cannot deadlock the upstream limiter", { timeout: 2000 }, async (t) => {
  const worker = createWorker({ now: () => time, cache: async () => undefined });
  t.mock.method(globalThis, "fetch", async (upstream) => {
    await new Promise((resolve) => setImmediate(resolve));
    const day = Number(new URL(upstream).pathname.split("-").at(-1));
    return Response.json(jsonFor(String(upstream), [{ id: 2026020000 + day, gameState: "FINAL" }]));
  });
  const results = await Promise.all([16, 17, 18, 19].map((day) => worker.fetch(new Request(url.replace("2026-11-19", `2026-11-${day}`)), env)));
  assert.ok(results.every((result) => result.status === 200));
});

test("snapshots preserve goal details, goalie stats, rosters, and non-goal event times", async (t) => {
  const worker = createWorker({ now: () => time, cache: async () => undefined });
  t.mock.method(globalThis, "fetch", async (upstream) => {
    const path = String(upstream);
    if (path.includes("/score/")) return Response.json({ games: [{ id: 2026020001, gameState: "LIVE" }] });
    if (path.endsWith("/boxscore")) return Response.json({
      gameState: "LIVE", awayTeam: { score: 1, abbrev: "TOR" }, homeTeam: { score: 0, abbrev: "MTL" },
      playerByGameStats: { awayTeam: { goalies: [{ playerId: 1, saves: 10 }] } }, unrelated: "omit",
    });
    return Response.json({ rosterSpots: [{ playerId: 1, headshot: "image" }], unrelated: "omit", plays: [
      { eventId: 1, typeDescKey: "goal", details: { scoringPlayerId: 2 }, timeInPeriod: "10:00", periodDescriptor: { number: 1 } },
      { eventId: 2, typeDescKey: "stoppage", details: { irrelevant: 1 }, timeInPeriod: "19:59", periodDescriptor: { number: 3 } },
    ] });
  });
  const payload = await (await worker.fetch(new Request(url), env)).json();
  assert.equal(payload.games[0].boxscore.playerByGameStats.awayTeam.goalies[0].saves, 10);
  assert.equal(payload.games[0].playByPlay.plays[0].details.scoringPlayerId, 2);
  assert.equal(payload.games[0].playByPlay.plays[1].timeInPeriod, "19:59");
  assert.equal(payload.games[0].playByPlay.rosterSpots[0].headshot, "image");
  assert.equal(payload.games[0].boxscore.unrelated, undefined);
});
