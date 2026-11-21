import assert from "node:assert/strict";
import { test } from "node:test";
import { createPacer, nhlOrigin, nhlTtl, retryAfterMs } from "./nhl-policy.ts";

const now = Date.parse("2026-11-19T18:00:00Z");
const ttl = (path, payload) => nhlTtl(new URL(path, "https://test.example"), now, payload);

test("freshness policy keeps live data short and historical data longer", () => {
  assert.equal(ttl("/nhl-web-api/score/2026-11-19"), 15);
  assert.equal(ttl("/nhl-api/skater/summary?cayenneExp=seasonId%3D20262027"), 300);
  assert.equal(ttl("/nhl-api/skater/summary?cayenneExp=seasonId%3D20252026"), 86400);
  assert.equal(ttl("/nhl-api/skater/bios"), 21600);
  assert.equal(ttl("/nhl-web-api/draft/picks/2020/all"), 604800);
  assert.equal(ttl("/nhl-web-api/draft/picks/2026/all"), 3600);
  assert.equal(ttl("/nhl-web-api/gamecenter/2026020001/boxscore", { gameState: "LIVE" }), 15);
  assert.equal(ttl("/nhl-web-api/gamecenter/2026020001/boxscore", { gameState: "FINAL" }), 300);
  assert.equal(ttl("/nhl-web-api/gamecenter/2025020001/boxscore", { gameState: "OFF" }), 86400);
});

test("Retry-After supports seconds, HTTP dates, missing and invalid values", () => {
  assert.equal(retryAfterMs("120", now), 120000);
  assert.equal(retryAfterMs(new Date(now + 90000).toUTCString(), now), 90000);
  assert.equal(retryAfterMs(null, now), 60000);
  assert.equal(retryAfterMs("invalid", now), 60000);
  assert.equal(retryAfterMs("0", now), 1000);
});

test("only exact NHL prefixes are classified as NHL", () => {
  assert.equal(nhlOrigin("/nhl-api/skater/summary"), "https://api.nhle.com");
  assert.equal(nhlOrigin("/nhl-api-docs"), undefined);
  assert.equal(nhlOrigin("/auth/v1/token"), undefined);
  assert.equal(nhlOrigin("/rest/v1/players"), undefined);
});

test("stats pacing serializes different reports and spaces uncached starts", async () => {
  let clock = 0;
  const starts = [];
  const pace = createPacer(1250, () => clock, async (ms) => { clock += ms; });
  await Promise.all(Array.from({ length: 4 }, () => pace(async () => { starts.push(clock); })));
  assert.deepEqual(starts, [0, 1250, 2500, 3750]);
});
