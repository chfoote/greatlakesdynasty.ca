// Local workerd check using the runtime/bundler installed by the pinned Wrangler
// dependency. NHL responses are simulated; no production/Supabase calls occur.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const built = await build({ entryPoints: ["worker/index.ts"], bundle: true, format: "esm", platform: "browser", write: false });
let calls = 0;
const statsStarts = [];
let failSavedRequest = false;
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: built.outputFiles[0].text,
  compatibilityDate: "2026-11-19",
  cf: false,
  serviceBindings: {
    ASSETS: async () => new Response("<!DOCTYPE html><html>SPA</html>", { headers: { "Content-Type": "text/html" } }),
  },
  outboundService: async (request) => {
    calls++;
    if (new URL(request.url).hostname === "api.nhle.com") {
      statsStarts.push(Date.now());
      if (failSavedRequest) return Response.json({ error: 'limited' }, { status: 429, headers: { 'Retry-After': '60' } });
      await new Promise((resolve) => setTimeout(resolve, 30));
      return Response.json({ data: [], total: 0 });
    }
    if (new URL(request.url).pathname.endsWith("/2021/all")) {
      return Response.json({ error: "limited" }, { status: 429, headers: { "Retry-After": "60" } });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (new URL(request.url).pathname.includes("/score/")) return Response.json({ games: [
      { id: 2026020001, gameState: "LIVE" }, { id: 2026020002, gameState: "FINAL" },
    ] });
    if (new URL(request.url).pathname.endsWith("/boxscore")) return Response.json({ playerByGameStats: {} });
    if (new URL(request.url).pathname.endsWith("/play-by-play")) return Response.json({ plays: [], rosterSpots: [] });
    return Response.json({ picks: [{ overallPick: 1 }] });
  },
}));

async function assertJson(result, status = 200) {
  const body = await result.text();
  assert.equal(result.status, status, body);
  return JSON.parse(body);
}

try {
  const url = "https://league.example/nhl-web-api/draft/picks/2020/all";
  const first = await mf.dispatchFetch(url);
  await assertJson(first);
  const hit = await mf.dispatchFetch(url);
  assert.equal(hit.headers.get("X-NHL-Cache"), "HIT");
  await assertJson(hit);
  assert.equal(calls, 1);

  const responses = await Promise.all([mf.dispatchFetch(url + "?test=concurrent"), mf.dispatchFetch(url + "?test=concurrent")]);
  await Promise.all(responses.map((result) => assertJson(result)));
  assert.equal(calls, 2);

  const snapshotUrl = "https://league.example/nhl-web-api/live-snapshot/2026-11-19";
  const beforeSnapshot = calls;
  const [snapshotA, snapshotB] = await Promise.all([mf.dispatchFetch(snapshotUrl), mf.dispatchFetch(snapshotUrl)]);
  const [payloadA, payloadB] = await Promise.all([assertJson(snapshotA), assertJson(snapshotB)]);
  assert.equal(payloadA.games.length, 2);
  assert.deepEqual(payloadA, payloadB);
  assert.equal(calls - beforeSnapshot, 5);
  const snapshotHit = await mf.dispatchFetch(snapshotUrl);
  assert.equal(snapshotHit.headers.get("X-NHL-Cache"), "HIT");
  await assertJson(snapshotHit);
  assert.equal(calls - beforeSnapshot, 5);

  // Different uncached reports must also work when separate requests queue.
  const parallelStats = await Promise.all([
    ...Array.from({ length: 6 }, (_, page) =>
      mf.dispatchFetch(`https://league.example/nhl-api/skater/summary?start=${page}&test=parallel`)),
    mf.dispatchFetch('https://league.example/nhl-web-api/live-snapshot/2026-11-20'),
  ]);
  await Promise.all(parallelStats.map((response) => assertJson(response)));
  const limited = await mf.dispatchFetch("https://league.example/nhl-web-api/draft/picks/2021/all");
  await assertJson(limited, 429);
  const paused = await mf.dispatchFetch("https://league.example/nhl-web-api/draft/picks/2022/all");
  assert.equal(paused.headers.get("X-NHL-Source"), "cooldown");
  await assertJson(paused, 429);
  assert.equal(calls, beforeSnapshot + 15);

  const home = await mf.dispatchFetch("https://league.example/standings");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<!DOCTYPE html>/);
  assert.equal(calls, beforeSnapshot + 15);
  await assertJson(await mf.dispatchFetch("https://league.example/nhl-api/skater/summary?limit=1"));
  await assertJson(await mf.dispatchFetch("https://league.example/nhl-api/goalie/summary?limit=1"));
  assert.equal(statsStarts.length, 8);
  assert.ok(statsStarts[1] - statsStarts[0] >= 1000);
  // Expire only the primary entry; the separate shared saved copy survives.
  const savedUrl = 'https://league.example/nhl-api/skater/summary?test=stale-runtime';
  await assertJson(await mf.dispatchFetch(savedUrl));
  const cache = await (await mf.getCaches()).open('gld-public-nhl-v1');
  assert.equal(await cache.delete(savedUrl), true);
  failSavedRequest = true;
  const savedResult = await mf.dispatchFetch(savedUrl);
  assert.equal(savedResult.headers.get('X-NHL-Stale'), '1');
  await assertJson(savedResult);
  // Allow the waitUntil refresh to record its 429 without storing an error.
  await new Promise(resolve => setTimeout(resolve, 1500));
  const stillSaved = await mf.dispatchFetch(savedUrl);
  assert.equal(stillSaved.headers.get('X-NHL-Stale'), '1');
  await assertJson(stillSaved);
  console.log("PASS: real workerd cache, concurrent snapshots and six distinct reports, paced stats, 429 cooldown, shared saved fallback, and asset delegation.");
} finally {
  await mf.dispose();
}
