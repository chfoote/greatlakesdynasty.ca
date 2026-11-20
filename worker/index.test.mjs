import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./index.ts";

const request = (path, options) => new Request(`https://league.example${path}`, options);
const noAssets = { ASSETS: { fetch() { throw new Error("API fell through to assets"); } } };

for (const [path, expected] of [
  ["/nhl-api/skater/summary?limit=-1&cayenneExp=seasonId%3D20262027+and+gameTypeId%3D2", "https://api.nhle.com/stats/rest/en/skater/summary?limit=-1&cayenneExp=seasonId%3D20262027+and+gameTypeId%3D2"],
  ["/nhl-api/goalie/summary?limit=1", "https://api.nhle.com/stats/rest/en/goalie/summary?limit=1"],
  ["/nhl-web-api/score/2026-11-19", "https://api-web.nhle.com/v1/score/2026-11-19"],
  ["/nhl-search-api/search/player?q=McDavid&culture=en-us&limit=10", "https://search.d3.nhle.com/api/v1/search/player?q=McDavid&culture=en-us&limit=10"],
  ["/nhl-api", "https://api.nhle.com/stats/rest/en"],
  ["/nhl-web-api", "https://api-web.nhle.com/v1"],
  ["/nhl-search-api", "https://search.d3.nhle.com/api/v1"],
  ["/nhl-api//evil.example/path?url=https%3A%2F%2Fevil.example", "https://api.nhle.com/stats/rest/en//evil.example/path?url=https%3A%2F%2Fevil.example"],
]) {
  test(`routes ${path} without changing query encoding or forwarding credentials`, async (t) => {
    t.mock.method(globalThis, "fetch", async (url, init) => {
      assert.equal(String(url), expected);
      assert.equal(init.redirect, "manual");
      assert.deepEqual(init.headers, { Accept: "application/json" });
      return Response.json({ data: [{ playerId: 8478402, goals: 12 }] });
    });
    const result = await worker.fetch(request(path, { headers: { Authorization: "secret", Cookie: "session=private" } }), noAssets);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).data[0].goals, 12);
    assert.equal(result.headers.get("Access-Control-Allow-Origin"), null);
  });
}

test("ordinary routes and prefix lookalikes go to the unchanged asset binding", async () => {
  for (const path of ["/", "/standings", "/teams/42", "/assets/app.js", "/nhl-api-docs"]) {
    const req = request(path);
    const result = await worker.fetch(req, { ASSETS: { async fetch(received) {
      assert.equal(received, req);
      return new Response("asset or SPA fallback");
    } } });
    assert.equal(await result.text(), "asset or SPA fallback");
  }
});

test("rejects write methods without contacting upstream", async () => {
  const result = await worker.fetch(request("/nhl-api/skater/summary", { method: "POST" }), noAssets);
  assert.equal(result.status, 405);
  assert.equal(result.headers.get("Allow"), "GET, HEAD");
});

test("preserves JSON upstream errors and Retry-After without leaking cookies", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "rate limited" }, {
    status: 429, headers: { "Retry-After": "60", "Set-Cookie": "upstream=private" },
  }));
  const result = await worker.fetch(request("/nhl-api/skater/summary"), noAssets);
  assert.equal(result.status, 429);
  assert.equal(result.headers.get("Retry-After"), "60");
  assert.equal(result.headers.get("Set-Cookie"), null);
  assert.deepEqual(await result.json(), { error: "rate limited" });
});

test("converts HTML to JSON errors and preserves upstream failure status", async (t) => {
  for (const [status, expected] of [[200, 502], [404, 404], [503, 503]]) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response("<!DOCTYPE html>", {
      status, headers: { "Content-Type": "text/html" },
    }));
    const result = await worker.fetch(request("/nhl-api/skater/summary"), noAssets);
    assert.equal(result.status, expected);
    assert.match((await result.json()).error, /non-JSON/);
    mock.mock.restore();
  }
});

test("network failure returns JSON 502 instead of the SPA", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  const result = await worker.fetch(request("/nhl-web-api/score/now"), noAssets);
  assert.equal(result.status, 502);
  assert.match((await result.json()).error, /Unable to reach/);
});

test("upstream timeout returns JSON 504", async (t) => {
  t.mock.method(AbortSignal, "timeout", () => AbortSignal.abort());
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    init.signal.throwIfAborted();
  });
  const result = await worker.fetch(request("/nhl-api/skater/summary"), noAssets);
  assert.equal(result.status, 504);
  assert.match((await result.json()).error, /timed out/);
});

test("follows NHL redirects internally", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(String(url));
    return calls.length === 1
      ? new Response(null, { status: 302, headers: { Location: "https://api-web.nhle.com/v1/score/2026-11-19" } })
      : Response.json({ games: [] });
  });
  const result = await worker.fetch(request("/nhl-web-api/score/now"), noAssets);
  assert.deepEqual(await result.json(), { games: [] });
  assert.equal(calls.length, 2);
});

test("blocks redirects outside the approved upstream and limits redirect loops", async (t) => {
  for (const location of ["https://evil.example/v1/score", "https://api-web.nhle.com/other", "/v1/score/now"]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return new Response(null, { status: 302, headers: { Location: location } });
    });
    const result = await worker.fetch(request("/nhl-web-api/score/now"), noAssets);
    assert.equal(result.status, 502);
    assert.ok(calls <= 4);
    mock.mock.restore();
  }
});

test("HEAD returns headers without a response body", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.method, "HEAD");
    return new Response(null, { headers: { "Content-Type": "application/json" } });
  });
  const result = await worker.fetch(request("/nhl-api/skater/summary", { method: "HEAD" }), noAssets);
  assert.equal(result.status, 200);
  assert.equal(await result.text(), "");
});
