import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRefreshNhl } from "./nhlPolling.ts";
import { refreshPlan, nhlStatsDate } from "../../shared/nhl-live.ts";

const time = Date.parse("2026-11-19T23:00:00Z");
const date = "2026-11-19";
const game = (gameState, startTimeUTC = "2026-11-19T23:00:00Z") => ({ id: 2026020001, gameState, startTimeUTC });
const options = { now: time + 30_000, date, mode: "live", lastAttempt: time, lastSuccess: time,
  schedule: { date, generatedAt: time, ...refreshPlan([game("LIVE")], time) }, visible: true };

test("live games refresh every 30 seconds; quiet season views use five minutes", () => {
  assert.equal(shouldRefreshNhl(options), true);
  assert.equal(shouldRefreshNhl({ ...options, now: time + 29_999 }), false);
  assert.equal(shouldRefreshNhl({ ...options, mode: "season" }), true);
  assert.equal(shouldRefreshNhl({ ...options, mode: "season", schedule: { ...options.schedule, live: false } }), false);
  assert.equal(shouldRefreshNhl({ ...options, mode: "season", now: time + 300_000 }), true);
});

test("hidden tabs and quiet overnight schedules do not poll", () => {
  assert.equal(shouldRefreshNhl({ ...options, visible: false }), false);
  assert.equal(shouldRefreshNhl({ ...options, now: time + 86400_000, schedule: { date, generatedAt: time, live: false, nextRefreshAt: null } }), false);
  assert.deepEqual(refreshPlan([], time), { live: false, nextRefreshAt: null });
});

test("future games wake up at scheduled puck drop without intermediate requests", () => {
  const plan = refreshPlan([game("FUT", "2026-11-20T01:00:00Z")], time);
  const schedule = { date, generatedAt: time, ...plan };
  assert.equal(shouldRefreshNhl({ ...options, now: time + 3600_000, schedule }), false);
  assert.equal(shouldRefreshNhl({ ...options, now: plan.nextRefreshAt, schedule }), true);
});

test("final results get one confirmation then stop; the next league day resumes", () => {
  const schedule = { date, generatedAt: time + 1000, ...refreshPlan([game("OFF")], time + 1000) };
  assert.equal(shouldRefreshNhl({ ...options, schedule }), true);
  assert.equal(shouldRefreshNhl({ ...options, schedule, lastSuccess: time + 2000 }), false);
  assert.equal(shouldRefreshNhl({ ...options, schedule, date: "2026-11-20" }), true);
});

test("unknown live schedules recover at 30 seconds, while season requests remain infrequent", () => {
  assert.equal(shouldRefreshNhl({ ...options, schedule: undefined }), true);
  assert.equal(shouldRefreshNhl({ ...options, mode: "season", schedule: undefined }), false);
  assert.equal(shouldRefreshNhl({ ...options, schedule: undefined, now: time + 300_000 }), true);
  assert.equal(refreshPlan([game("FUT", "")], time).nextRefreshAt, time + 300_000);
});

test("league date rollover keeps the existing six-hour shift and Eastern timezone", () => {
  assert.equal(nhlStatsDate(0, Date.parse("2026-11-20T10:59:00Z")), "2026-11-19");
  assert.equal(nhlStatsDate(0, Date.parse("2026-11-20T11:00:00Z")), "2026-11-20");
});

test("season totals recover every five minutes even before puck drop or after finals", () => {
  for (const nextRefreshAt of [null, time + 8 * 3600_000]) {
    const quiet = { date, generatedAt: time, live: false, nextRefreshAt };
    assert.equal(shouldRefreshNhl({ ...options, schedule: quiet, mode: 'season', now: time + 300_000 }), true);
    assert.equal(shouldRefreshNhl({ ...options, schedule: quiet, mode: 'season', now: time + 299_999 }), false);
    assert.equal(shouldRefreshNhl({ ...options, schedule: quiet, mode: 'season', now: time + 300_000, visible: false }), false);
    assert.equal(shouldRefreshNhl({ ...options, schedule: quiet, mode: 'live', now: time + 300_000 }), false);
  }
});
