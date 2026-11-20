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
  time += 61000;
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

test("frontend concurrency stays at three", async () => {
  let active = 0;
  let maximum = 0;
  const client = createNhlClient({ fetcher: async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--; return Response.json({ data: [] });
  } });
  await Promise.all(Array.from({ length: 12 }, (_, i) => client(`${path}&offset=${i}`)));
  assert.equal(maximum, 3);
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
  const priorSize = entries.size;
  const limited = createNhlClient({ ...options, fetcher: async () => Response.json({}, { status: 429 }) });
  await limited("/nhl-web-api/draft/picks/2021/all");
  assert.equal(entries.size, priorSize);
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
