import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRefreshNhl } from "./nhlPolling.ts";
import { refreshPlan, nhlStatsDate } from "../../shared/nhl-live.ts";

const time = Date.parse("2026-11-19T23:00:00Z");
const date = "2026-11-19";
const game = (gameState, startTimeUTC = "2026-11-19T23:00:00Z") => ({ id: 2026020001, gameState, startTimeUTC });
const options = { now: time + 30_000, date, mode: "live", lastAttempt: time, lastSuccess: time,
  schedule: { date, generatedAt: time, ...refreshPlan([game("LIVE")], time) }, visible: true };

test("live checks run every 30 seconds and season checks every five minutes", () => {
  assert.equal(shouldRefreshNhl(options), true);
  assert.equal(shouldRefreshNhl({ ...options, now: time + 29_999 }), false);
  assert.equal(shouldRefreshNhl({ ...options, mode: "season" }), false);
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

test("unknown schedules and initial failures use a five-minute recovery interval", () => {
  assert.equal(shouldRefreshNhl({ ...options, schedule: undefined }), false);
  assert.equal(shouldRefreshNhl({ ...options, schedule: undefined, now: time + 300_000 }), true);
  assert.equal(refreshPlan([game("FUT", "")], time).nextRefreshAt, time + 300_000);
});

test("league date rollover keeps the existing six-hour shift and Eastern timezone", () => {
  assert.equal(nhlStatsDate(0, Date.parse("2026-11-20T10:59:00Z")), "2026-11-19");
  assert.equal(nhlStatsDate(0, Date.parse("2026-11-20T11:00:00Z")), "2026-11-20");
});
