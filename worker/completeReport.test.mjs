import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCompleteReport, CompleteReportError, validateCompleteReportQuery } from "./completeReport.ts";
import { createWorker } from "./index.ts";

const expression = 'seasonId=20262027 and gameTypeId=2 and gameDate>="2026-07-01" and gameDate<="2026-11-23"';
const sort = JSON.stringify([{ property: "playerId", direction: "ASC" }]);

test("complete report query accepts only bounded regular-season expressions", () => {
  const valid = new URL(`https://league.example/nhl-api/complete/skater/summary?${new URLSearchParams({ cayenneExp: expression })}`);
  assert.equal(validateCompleteReportQuery(valid), expression);
  const frontend = new URL(`https://league.example/nhl-api/complete/skater/summary?${new URLSearchParams({ cayenneExp: expression, sort, start: "0" })}`);
  assert.equal(validateCompleteReportQuery(frontend), expression);
  for (const path of [
    "/nhl-api/complete/skater/summary?cayenneExp=seasonId%3D20262028+and+gameTypeId%3D2",
    "/nhl-api/complete/skater/summary?cayenneExp=seasonId%3D20262027+or+gameTypeId%3D3",
    "/nhl-api/complete/skater/summary?cayenneExp=seasonId%3D20262027+and+gameTypeId%3D2+and+gameDate%3E%3D%222026-02-30%22+and+gameDate%3C%3D%222026-03-01%22",
    `/nhl-api/complete/skater/summary?${new URLSearchParams({ cayenneExp: expression, sort: JSON.stringify([{ property: "goals", direction: "DESC" }]), start: "0" })}`,
    `/nhl-api/complete/skater/summary?${new URLSearchParams({ cayenneExp: expression, sort, start: "100" })}`,
    `/nhl-api/complete/skater/summary?${new URLSearchParams({ cayenneExp: expression, extra: "1" })}`,
  ]) assert.equal(validateCompleteReportQuery(new URL(path, "https://league.example")), undefined);
});

test("complete report follows provider page caps without duplicates or partial results", async () => {
  const starts = [];
  const result = await buildCompleteReport("skater", "summary", expression, async path => {
    const start = Number(new URL(path, "https://league.example").searchParams.get("start"));
    starts.push(start);
    return Response.json({ data: Array.from({ length: Math.min(2, 5 - start) }, (_, index) => ({ playerId: start + index + 1 })), total: 5 });
  });
  assert.deepEqual(starts, [0, 2, 4]);
  assert.equal(result.data.length, 5);
  await assert.rejects(buildCompleteReport("skater", "summary", expression, async () =>
    Response.json({ data: [{ playerId: 1 }], total: 2 })), CompleteReportError);
});

test("one shared Worker response replaces browser-by-browser report paging", async (t) => {
  const entries = new Map();
  const cache = { async match(key) { return entries.get(key.url)?.clone(); }, async put(key, response) { entries.set(key.url, response.clone()); } };
  const worker = createWorker({ cache: async () => cache, statsGapMs: 0 });
  const calls = [];
  t.mock.method(globalThis, "fetch", async upstream => {
    const url = new URL(upstream);
    calls.push(url.pathname + url.search);
    const start = Number(url.searchParams.get("start"));
    return Response.json({ data: Array.from({ length: Math.min(2, 5 - start) }, (_, index) => ({ playerId: start + index + 1 })), total: 5 });
  });
  // This is the exact URL shape produced by the deployed frontend reader.
  const url = `https://league.example/nhl-api/complete/skater/summary?${new URLSearchParams({ cayenneExp: expression, sort, start: "0" })}`;
  const first = await worker.fetch(new Request(url), { ASSETS: { fetch() { throw Error("asset fallback"); } } });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).data.length, 5);
  assert.equal(calls.length, 3);
  const second = await worker.fetch(new Request(url), { ASSETS: { fetch() { throw Error("asset fallback"); } } });
  assert.equal(second.headers.get("X-NHL-Cache"), "HIT");
  assert.equal(calls.length, 3);
});

test("429 and malformed pages never become a complete cached report", async (t) => {
  let puts = 0;
  const worker = createWorker({ cache: async () => ({ async match() {}, async put() { puts++; } }), statsGapMs: 0 });
  t.mock.method(globalThis, "fetch", async () => new Response("limited", {
    status: 429, headers: { "Content-Type": "text/html", "Retry-After": "30" },
  }));
  const url = `https://league.example/nhl-api/complete/skater/realtime?${new URLSearchParams({ cayenneExp: expression })}`;
  const result = await worker.fetch(new Request(url), { ASSETS: { fetch() { throw Error("asset fallback"); } } });
  assert.equal(result.status, 429);
  assert.equal(result.headers.get("Retry-After"), "30");
  assert.equal(puts, 0);
});
