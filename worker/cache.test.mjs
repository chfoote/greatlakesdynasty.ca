import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker, dailyWarmPaths } from "./index.ts";
import { createSavedNhlCache, validPlayerRows } from "../src/lib/nhlSaved.ts";
import { fetchCompleteNhlReport } from "../src/lib/nhlReports.ts";

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

test("daily warm-up covers every shared current-season report and today's live snapshot", () => {
  const paths = dailyWarmPaths(Date.parse("2026-11-24T17:00:00Z"));
  assert.equal(paths.length, 5);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.every((value) => value.includes("20262027") || value.endsWith("/2026-11-24")));
  for (const report of ["skater/summary", "skater/realtime", "skater/faceoffwins", "goalie/summary"]) {
    const path = paths.find((value) => value.includes(report));
    assert.ok(path);
    assert.equal(new URL(path, "https://test.invalid").searchParams.get("start"), "0");
  }
});

test("successful JSON is cached, then refreshed at expiry with query-specific keys", async (t) => {
  const f = fixture();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [++calls] }));
  const first = await f.worker.fetch(req(path), env);
  assert.equal(first.headers.get("X-NHL-Cache"), "MISS");
  assert.equal(first.headers.get("Cache-Control"), "no-store");
  assert.equal(first.headers.get("Cloudflare-CDN-Cache-Control"), "no-store");
  const second = await f.worker.fetch(req(path), env);
  assert.equal(second.headers.get("X-NHL-Cache"), "HIT");
  assert.deepEqual(await second.json(), { data: [1] });
  await f.worker.fetch(req(path.replace("limit=1", "limit=2")), env);
  assert.equal(calls, 2);
  f.advance(300_001);
  await f.worker.fetch(req(path), env);
  assert.equal(calls, 3);
});

test("identical concurrent requests stay isolated and both return valid JSON", async (t) => {
  const f = fixture();
  let calls = 0;
  const finish = [];
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    await new Promise((resolve) => { finish.push(resolve); });
    return Response.json({ data: [1] });
  });
  const a = f.worker.fetch(req(path), env);
  const b = f.worker.fetch(req(path), env);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  finish.forEach(resolve => resolve());
  const results = await Promise.all([a, b]);
  assert.deepEqual(await results[0].json(), await results[1].json());
  assert.equal(f.puts(), 4);
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

test("general upstream concurrency reserves a slot for live requests", async (t) => {
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
  assert.equal(maximum, 3);
});

for (const status of [429, 500, 502]) {
  test(`expired successful JSON is shared as an explicitly stale fallback after ${status}`, async t => {
    const f = fixture();
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => ++calls === 1
      ? Response.json({ data: [{ playerId: 1 }], total: 1 })
      : Response.json({ error: 'unavailable' }, { status, headers: { 'Retry-After': '60' } }));
    await f.worker.fetch(req(path), env);
    f.advance(300_001);
    const result = await f.worker.fetch(req(path), env);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('X-NHL-Stale'), '1');
    assert.equal(result.headers.get('X-NHL-Failure-Status'), String(status));
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.equal(Number(result.headers.get('X-NHL-Saved-At')), start);
    assert.deepEqual(await result.json(), { data: [{ playerId: 1 }], total: 1 });
    assert.equal(f.puts(), 2); // No error/fallback write.
    const differentQuery = await f.worker.fetch(req(path + '&start=100'), env);
    assert.equal(differentQuery.status, status === 429 ? 429 : status);
  });
}

test('shared saved data expires and malformed successes cannot replace it', async t => {
  const f = fixture();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? Response.json({ data: [1] })
    : new Response('invalid', { headers: { 'Content-Type': 'application/json' } }));
  await f.worker.fetch(req(path), env);
  f.advance(300_001);
  assert.equal((await f.worker.fetch(req(path), env)).headers.get('X-NHL-Stale'), '1');
  f.advance(7 * 86400_000);
  assert.equal((await f.worker.fetch(req(path), env)).status, 502);
  assert.equal(f.puts(), 2);
});

test('shared saved profile JSON returns immediately while waitUntil refreshes in the background', async t => {
  const f = fixture();
  let calls = 0, finish;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return Response.json({ data: [1] });
    return new Promise(resolve => { finish = resolve; });
  });
  const profile = '/nhl-web-api/player/8478402/landing';
  await f.worker.fetch(req(profile), env);
  f.advance(3600_001);
  const work = [];
  const result = await f.worker.fetch(req(profile), env, { waitUntil: promise => work.push(promise) });
  assert.equal(result.headers.get('X-NHL-Stale'), '1');
  assert.deepEqual(await result.json(), { data: [1] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  finish(Response.json({ data: [2] }));
  await Promise.all(work);
  const fresh = await f.worker.fetch(req(profile), env);
  assert.equal(fresh.headers.get('X-NHL-Stale'), null);
  assert.deepEqual(await fresh.json(), { data: [2] });
});

test('successive expired report refreshes advance the assembled browser dataset instead of perpetually serving the previous cycle', async t => {
  const f = fixture();
  let time = start, goals = 1;
  const saved = createSavedNhlCache({ now: () => time, storage: () => undefined, onChange() {} });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: [{ playerId: 1, goals }], total: 1 }));
  const background = [];
  const load = () => fetchCompleteNhlReport(path, 'summary', url => f.worker.fetch(req(url), env,
    { waitUntil: promise => background.push(promise) }));
  const first = await saved('skaters:20262027', load, validPlayerRows);
  assert.equal(first[0].goals, 1);
  for (goals = 2; goals <= 3; goals++) {
    time += 300_001; f.advance(300_001);
    const next = await saved('skaters:20262027', load, validPlayerRows, 300_000, { waitForRefresh: true });
    await Promise.all(background);
    assert.equal(next[0].goals, goals, 'A successful upstream refresh must replace the prior complete report');
  }
});

test('a two-day-old complete dataset survives an outage and is replaced when upstream recovers', async t => {
  const f = fixture();
  let time = start, unavailable = false, goals = 1;
  const saved = createSavedNhlCache({ now: () => time, storage: () => undefined, onChange() {} });
  t.mock.method(globalThis, 'fetch', async () => unavailable
    ? Response.json({ error: 'unavailable' }, { status: 503 })
    : Response.json({ data: [{ playerId: 1, goals }], total: 1 }));
  const work = [];
  const load = () => fetchCompleteNhlReport(path, 'summary', url => f.worker.fetch(req(url), env,
    { waitUntil: promise => work.push(promise) }));
  await saved('skaters:20262027', load, validPlayerRows);
  time += 2 * 86400_000; f.advance(2 * 86400_000); unavailable = true;
  const old = await saved('skaters:20262027', load, validPlayerRows, 300_000, { waitForRefresh: true });
  await Promise.all(work);
  assert.equal(old[0].goals, 1);
  time += 60_001; f.advance(60_001); unavailable = false; goals = 8;
  const recovered = await saved('skaters:20262027', load, validPlayerRows, 300_000, { waitForRefresh: true });
  assert.equal(recovered[0].goals, 8);
});
