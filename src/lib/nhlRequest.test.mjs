import assert from "node:assert/strict";
import { test } from "node:test";
import { createNhlClient } from "./nhlRequest.ts";

const path = "/nhl-api/skater/summary?limit=1";
const start = Date.parse("2026-11-19T18:00:00Z");

test("frontend deduplicates concurrent and fresh requests, including encoded queries", async () => {
  let calls = 0;
  let time = start;
  const client = createNhlClient({ now: () => time, fetcher: async (url) => {
    calls++;
    assert.match(url, /limit=1/);
    return Response.json({ data: [calls] });
  } });
  const responses = await Promise.all([client(path), client(path), client(path)]);
  for (const r of responses) assert.deepEqual(await r.json(), { data: [1] });
  await client(path);
  assert.equal(calls, 1);
  time += 301000;
  await client(path);
  assert.equal(calls, 2);
});

test("frontend query values are part of identity and forwarded unchanged", async () => {
  const calls = [];
  const client = createNhlClient({ fetcher: async (url) => { calls.push(url); return Response.json({ data: [] }); } });
  const a = `${path}&cayenneExp=seasonId%3D20262027+and+gameTypeId%3D2`;
  const b = a.replace("20262027", "20252026");
  await client(a); await client(b); await client(a);
  assert.deepEqual(calls, [a, b]);
});

test("frontend respects HTTP-date Retry-After with no automatic or endless retries", async () => {
  let time = start;
  let calls = 0;
  const client = createNhlClient({ now: () => time, fetcher: async () => ++calls === 1
    ? Response.json({ error: "limited" }, { status: 429, headers: { "Retry-After": new Date(time + 90000).toUTCString() } })
    : Response.json({ data: [1] }) });
  assert.equal((await client(path)).status, 429);
  assert.equal((await client("/nhl-api/skater/realtime")).status, 429);
  assert.equal(calls, 1);
  time += 90001;
  assert.equal((await client(path)).status, 200);
  assert.equal(calls, 2);
});

test("queued requests honor a cooldown discovered by an earlier request", async () => {
  let calls = 0;
  const client = createNhlClient({ fetcher: async () => {
    calls++;
    return Response.json({ error: "limited" }, { status: 429, headers: { "Retry-After": "60" } });
  } });
  await Promise.all(Array.from({ length: 12 }, (_, i) => client(`${path}&offset=${i}`)));
  assert.ok(calls <= 3);
});

test("general frontend concurrency reserves a third slot for live requests", async () => {
  let active = 0;
  let maximum = 0;
  const client = createNhlClient({ fetcher: async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--; return Response.json({ data: [] });
  } });
  await Promise.all(Array.from({ length: 12 }, (_, i) => client(`${path}&offset=${i}`)));
  assert.equal(maximum, 2);
});

test("public draft cache survives navigation/reloads, expires, and never stores failures", async () => {
  let calls = 0;
  let time = start;
  const entries = new Map();
  const storage = { getItem: (key) => entries.get(key), setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key) };
  const options = { now: () => time, storage: () => storage, fetcher: async () => {
    calls++; return Response.json({ picks: [{ overallPick: 1 }] });
  } };
  const draft = "/nhl-web-api/draft/picks/2020/all";
  await createNhlClient(options)(draft);
  await createNhlClient(options)(draft);
  assert.equal(calls, 1);
  time += 604800001;
  await createNhlClient(options)(draft);
  assert.equal(calls, 2);
  const limited = createNhlClient({ ...options, fetcher: async () => Response.json({}, { status: 429 }) });
  await limited("/nhl-web-api/draft/picks/2021/all");
  assert.ok(![...entries.keys()].some((key) => key.includes("/draft/picks/2021/all")));
});

test("failed and malformed responses are not cached; private APIs cannot use client", async () => {
  let calls = 0;
  const client = createNhlClient({ fetcher: async () => {
    calls++;
    return calls === 1 ? Response.json({ error: "failed" }, { status: 500 }) : Response.json({ data: [1] });
  } });
  assert.equal((await client(path)).status, 500);
  assert.equal((await client(path)).status, 200);
  assert.equal(calls, 2);
  await assert.rejects(client("https://private.supabase.co/rest/v1/players"), /Only same-origin NHL/);
  await assert.rejects(client("/auth/v1/token"), /Only same-origin NHL/);
});

test("a later short Retry-After cannot shorten a longer active cooldown", async () => {
  let time = start;
  let calls = 0;
  const client = createNhlClient({ now: () => time, fetcher: async () => {
    const number = ++calls;
    await new Promise((resolve) => setImmediate(resolve));
    return Response.json({}, { status: 429, headers: { "Retry-After": number === 1 ? "300" : "60" } });
  } });
  await Promise.all([client(path), client(path + "&offset=1")]);
  time += 120000;
  const paused = await client(path);
  assert.equal(paused.status, 429);
  assert.equal(paused.headers.get("Retry-After"), "180");
  assert.equal(calls, 2);
});

test("invalid JSON and network failures release in-flight state without caching", async () => {
  let calls = 0;
  const client = createNhlClient({ fetcher: async () => {
    calls++;
    if (calls === 1) throw Error("offline");
    if (calls === 2) return new Response("broken", { headers: { "Content-Type": "application/json" } });
    return Response.json({ data: [1] });
  } });
  await assert.rejects(client(path), /offline/);
  assert.equal((await client(path)).status, 502);
  assert.equal((await client(path)).status, 200);
  assert.equal(calls, 3);
});

test("disabled draft storage cannot break fetching or in-memory caching", async () => {
  let calls = 0;
  const client = createNhlClient({
    storage: () => { throw Error("storage unavailable"); },
    fetcher: async () => { calls++; return Response.json({ picks: [] }); },
  });
  const draft = "/nhl-web-api/draft/picks/2020/all";
  assert.equal((await client(draft)).status, 200);
  assert.equal((await client(draft)).status, 200);
  assert.equal(calls, 1);
});

function sharedBrowser() {
  const entries = new Map();
  const store = { getItem: (key) => entries.get(key), setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key) };
  const locks = new Map();
  const lock = (key, work) => {
    const result = (locks.get(key) || Promise.resolve()).then(work);
    locks.set(key, result.catch(() => {}));
    return result;
  };
  return { entries, storage: () => store, lock };
}

test("two tabs share one season request and one fresh snapshot through public storage and locks", async () => {
  const browser = sharedBrowser();
  let calls = 0;
  const options = { ...browser, now: () => start, fetcher: async () => {
    calls++;
    await new Promise((resolve) => setImmediate(resolve));
    return Response.json({ data: [1] });
  } };
  const a = createNhlClient(options);
  const b = createNhlClient(options);
  await Promise.all([a(path), b(path), a(path), b(path)]);
  assert.equal(calls, 1);
  await createNhlClient(options)(path); // Navigation/reload also reuses the data.
  assert.equal(calls, 1);
});

test("rate-limit cooldowns are shared across tabs without storing the error response", async () => {
  const browser = sharedBrowser();
  let calls = 0;
  const options = { ...browser, now: () => start, fetcher: async () => {
    calls++; return Response.json({}, { status: 429, headers: { "Retry-After": "120" } });
  } };
  await createNhlClient(options)(path);
  assert.equal((await createNhlClient(options)(path + "&offset=1")).status, 429);
  assert.equal(calls, 1);
  assert.ok(![...browser.entries.keys()].some((key) => key.includes("/skater/summary")));
});

test("public cache stays within its storage budget and preserves authentication keys", async () => {
  const browser = sharedBrowser();
  browser.entries.set("sb-existing-auth", "untouched");
  const client = createNhlClient({ ...browser, now: () => start, fetcher: async () => Response.json({ picks: [], text: "x".repeat(600_000) }) });
  for (let year = 2017; year <= 2026; year++) await client(`/nhl-web-api/draft/picks/${year}/all`);
  const index = JSON.parse(browser.entries.get("gld:public-nhl:v2:index"));
  assert.ok(index.reduce((sum, entry) => sum + entry.size, 0) <= 2_000_000);
  assert.equal(browser.entries.get("sb-existing-auth"), "untouched");
});

test("cached live snapshot age is deducted so layers do not extend its lifetime", async () => {
  let now = start;
  let calls = 0;
  const client = createNhlClient({ now: () => now, fetcher: async () => {
    calls++; return Response.json({ date: "2026-11-19", live: true, generatedAt: now - 20_000 });
  } });
  const snapshotPath = "/nhl-web-api/live-snapshot/2026-11-19";
  await client(snapshotPath);
  now += 9000;
  await client(snapshotPath);
  assert.equal(calls, 1);
  now += 2000;
  await client(snapshotPath);
  assert.equal(calls, 2);
});

test("denied Web Locks fall back safely without replaying failed fetches", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "locks");
  t.after(() => {
    if (previous) Object.defineProperty(navigator, "locks", previous);
    else delete navigator.locks;
  });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async () => { throw Error("Lock access denied"); } } });
  let calls = 0;
  const client = createNhlClient({ fetcher: async () => { calls++; return Response.json({ data: [] }); } });
  assert.equal((await client(path)).status, 200);
  assert.equal(calls, 1);
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name, work) => work() } });
  const failed = createNhlClient({ fetcher: async () => { calls++; throw Error("offline"); } });
  await assert.rejects(failed(path), /offline/);
  assert.equal(calls, 2);
});

test('shared stale JSON is never promoted into the fresh browser request cache', async () => {
  let calls = 0;
  const client = createNhlClient({ fetcher: async () => {
    calls++;
    return Response.json({ data: [1] }, { headers: { 'X-NHL-Stale': '1', 'X-NHL-Saved-At': '1795000000000' } });
  } });
  const first = await client('/nhl-api/skater/summary?test=stale');
  assert.equal(first.headers.get('X-NHL-Stale'), '1');
  await client('/nhl-api/skater/summary?test=stale');
  assert.equal(calls, 2);
});

test('live data starts even while both general slots are busy',async()=>{
  const releases=[];
  const client=createNhlClient({fetcher:async path=>{
    if(path.includes('/live-snapshot/')) return Response.json({live:true});
    await new Promise(resolve=>releases.push(resolve));return Response.json({playerId:1});
  }});
  const general=[client('/nhl-web-api/player/1/landing'),client('/nhl-web-api/player/2/landing')];
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(releases.length,2);
  const live=await client('/nhl-web-api/live-snapshot/2026-11-21');
  assert.equal(live.status,200);
  releases.forEach(resolve=>resolve());await Promise.all(general);
});
