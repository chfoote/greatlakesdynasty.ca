// Local workerd check using the runtime/bundler installed by the pinned Wrangler
// dependency. NHL responses are simulated; no production/Supabase calls occur.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const built = await build({ entryPoints: ["worker/index.ts"], bundle: true, format: "esm", platform: "browser", write: false });
let calls = 0;
const statsStarts = [];
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

  const limited = await mf.dispatchFetch("https://league.example/nhl-web-api/draft/picks/2021/all");
  await assertJson(limited, 429);
  const paused = await mf.dispatchFetch("https://league.example/nhl-web-api/draft/picks/2022/all");
  assert.equal(paused.headers.get("X-NHL-Source"), "cooldown");
  await assertJson(paused, 429);
  assert.equal(calls, beforeSnapshot + 6);

  const home = await mf.dispatchFetch("https://league.example/standings");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<!DOCTYPE html>/);
  assert.equal(calls, beforeSnapshot + 6);
  await assertJson(await mf.dispatchFetch("https://league.example/nhl-api/skater/summary?limit=1"));
  await assertJson(await mf.dispatchFetch("https://league.example/nhl-api/goalie/summary?limit=1"));
  assert.equal(statsStarts.length, 2);
  assert.ok(statsStarts[1] - statsStarts[0] >= 1000);
  console.log("PASS: real workerd cache, concurrent snapshots, paced stats, 429 cooldown, and asset delegation.");
} finally {
  await mf.dispose();
}
