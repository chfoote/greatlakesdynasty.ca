// Local workerd check using the runtime/bundler installed by the pinned Wrangler
// dependency. NHL responses are simulated; no production/Supabase calls occur.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const built = await build({ entryPoints: ["worker/index.ts"], bundle: true, format: "esm", platform: "browser", write: false });
let calls = 0;
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
    if (new URL(request.url).pathname.endsWith("/2021/all")) {
      return Response.json({ error: "limited" }, { status: 429, headers: { "Retry-After": "60" } });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
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

  const limited = await mf.dispatchFetch("https://league.example/nhl-web-api/draft/picks/2021/all");
  await assertJson(limited, 429);
  const paused = await mf.dispatchFetch("https://league.example/nhl-web-api/draft/picks/2022/all");
  assert.equal(paused.headers.get("X-NHL-Source"), "cooldown");
  await assertJson(paused, 429);
  assert.equal(calls, 3);

  const home = await mf.dispatchFetch("https://league.example/standings");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<!DOCTYPE html>/);
  assert.equal(calls, 3);
  console.log("PASS: real workerd Cache API MISS/HIT, concurrent request deduplication, JSON, 429 cooldown without retries, and asset delegation.");
} finally {
  await mf.dispose();
}
