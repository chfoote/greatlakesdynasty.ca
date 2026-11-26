import assert from "node:assert/strict";
import test from "node:test";
import { calculateTeamCap, salaryCapForSeason } from "./cap.ts";

test("team cap includes roster salary, buyouts and net retention", () => {
  const result = calculateTeamCap([
    { position: "C", salary: 20_000_000 },
    { position: "IR", salary: 30_075_000 },
    { position: "LTIR", salary: 9_000_000 },
    { position: "PROSPECT", salary: 1_000_000 },
  ], 2027, { buyoutPenaltyTotal: 0, retentionNet: -837_500, buyoutSlotsUsed: 0, retentionSlotsUsed: 0 });
  assert.equal(result.rosterSalary, 50_075_000);
  assert.equal(result.capSalary, 49_237_500);
  assert.equal(result.capSpace, 762_500);
  assert.equal(result.rosterCount, 1);
});

test("cap limits retain the league's season boundary", () => {
  assert.equal(salaryCapForSeason(2026), 45_000_000);
  assert.equal(salaryCapForSeason(2027), 50_000_000);
});
