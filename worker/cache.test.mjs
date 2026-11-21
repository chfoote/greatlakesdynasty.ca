import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "./index.ts";

const env = { ASSETS: { fetch() { throw Error("Unexpected asset fallback"); } } };
const req = (path) => new Request(`https://league.example${path}`);
const start = Date.parse("2026-11-19T18:00:00Z");
const path = "/nhl-api/skater/summary?limit=1&cayenneExp=seasonId%3D20262027";

function fixture() {
  let time = start;
  const entries = new Map();
  let puts = 0;
  const cache = {
    async match(key) {
      const hit = entries.get(key.url);
      return hit && hit.expires > time ? hit.response.clone() : undefined;
    },
    async put(key, response) {
      puts++;
      const ttl = Number(response.headers.get("Cache-Control").match(/max-age=(\d+)/)[1]);
      entries.set(key.url, { expires: time + ttl * 1000, response: response.clone() });
    },
  };
  const worker = createWorker({ cache: async () => cache, now: () => time });
  return { worker, entries, puts: () => puts, advance: (ms) => { time += ms; } };
}

test("successful JSON is cached, then refreshed at expiry with query-specific keys", async (t) => {
  const f = fixture();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [++calls] }));
  const first = await f.worker.fetch(req(path), env);
  assert.equal(first.headers.get("X-NHL-Cache"), "MISS");
  assert.equal(first.headers.get("Cache-Control"), "public, max-age=300");
  const second = await f.worker.fetch(req(path), env);
  assert.equal(second.headers.get("X-NHL-Cache"), "HIT");
  assert.deepEqual(await second.json(), { data: [1] });
  await f.worker.fetch(req(path.replace("limit=1", "limit=2")), env);
  assert.equal(calls, 2);
  f.advance(300_001);
  await f.worker.fetch(req(path), env);
  assert.equal(calls, 3);
});

test("identical concurrent requests make one upstream call", async (t) => {
  const f = fixture();
  let calls = 0;
  let finish;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    await new Promise((resolve) => { finish = resolve; });
    return Response.json({ data: [1] });
  });
  const a = f.worker.fetch(req(path), env);
  const b = f.worker.fetch(req(path), env);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  finish();
  const results = await Promise.all([a, b]);
  assert.deepEqual(await results[0].json(), await results[1].json());
  assert.equal(f.puts(), 1);
});

test("429 is never cached; same-origin calls pause until Retry-After without retries", async (t) => {
  const f = fixture();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return calls === 1 ? Response.json({ error: "rate limit" }, {
      status: 429, headers: { "Retry-After": "120", "CF-Ray": "upstream-ray", Server: "test-upstream" },
    }) : Response.json({ data: [3] });
  });
  const first = await f.worker.fetch(req(path), env);
  assert.equal(first.status, 429);
  assert.equal(first.headers.get("X-NHL-Source"), "upstream");
  assert.equal(first.headers.get("X-NHL-Upstream-Status"), "429");
  assert.equal(first.headers.get("X-NHL-Upstream-CF-Ray"), "upstream-ray");
  const paused = await f.worker.fetch(req("/nhl-api/skater/bios"), env);
  assert.equal(paused.status, 429);
  assert.equal(paused.headers.get("X-NHL-Source"), "cooldown");
  assert.equal(paused.headers.get("Retry-After"), "120");
  assert.equal(calls, 1);
  assert.equal(f.puts(), 0);
  // A different NHL origin is not blocked by the stats origin cooldown.
  assert.equal((await f.worker.fetch(req("/nhl-web-api/score/now"), env)).status, 200);
  f.advance(120_001);
  assert.equal((await f.worker.fetch(req(path), env)).status, 200);
  assert.equal(calls, 3);
});

test("HTML 429 preserves diagnostics and errors never enter cache", async (t) => {
  const f = fixture();
  t.mock.method(globalThis, "fetch", async () => new Response("<html>rate limit</html>", {
    status: 429, headers: { "Content-Type": "text/html", "Retry-After": "60", "CF-Ray": "origin-ray" },
  }));
  const response = await f.worker.fetch(req(path), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Content-Type"), "application/json");
  assert.equal(response.headers.get("X-NHL-Upstream-CF-Ray"), "origin-ray");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(f.puts(), 0);
});

test("500 and malformed JSON successes are not cached", async (t) => {
  const f = fixture();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return calls === 1 ? Response.json({ error: "broken" }, { status: 500 })
      : new Response("not json", { headers: { "Content-Type": "application/json" } });
  });
  assert.equal((await f.worker.fetch(req(path), env)).status, 500);
  assert.equal((await f.worker.fetch(req(path), env)).status, 502);
  assert.equal(f.puts(), 0);
});

test("cache outages do not break valid API responses", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [1] }));
  const worker = createWorker({ cache: async () => { throw Error("cache unavailable"); } });
  assert.deepEqual(await (await worker.fetch(req(path), env)).json(), { data: [1] });
});

test("cache hits remain usable during origin cooldown", async (t) => {
  const f = fixture();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls === 1
    ? Response.json({ data: [1] })
    : Response.json({ error: "limited" }, { status: 429 }));
  await f.worker.fetch(req(path), env);
  await f.worker.fetch(req("/nhl-api/skater/realtime"), env);
  const cached = await f.worker.fetch(req(path), env);
  assert.equal(cached.status, 200);
  assert.equal(cached.headers.get("X-NHL-Cache"), "HIT");
  assert.equal(calls, 2);
});

test("upstream concurrency stays bounded", async (t) => {
  const f = fixture();
  let active = 0;
  let maximum = 0;
  t.mock.method(globalThis, "fetch", async () => {
    active++;
    maximum = Math.max(active, maximum);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return Response.json({ data: [1] });
  });
  await Promise.all(Array.from({ length: 16 }, (_, i) => f.worker.fetch(req(`${path}&offset=${i}`), env)));
  assert.equal(maximum, 4);
});
