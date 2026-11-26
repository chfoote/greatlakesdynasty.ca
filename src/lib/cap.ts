export const ROSTER_LIMIT = 23;
export const ACTIVE_ROSTER_POSITIONS = new Set(["C", "LW", "RW", "D", "G"]);
export const CAP_POSITIONS = new Set([...ACTIVE_ROSTER_POSITIONS, "W", "IR", "RETENTION", "BUYOUT"]);

export type CapRosterRow = { position?: string | null; salary?: number | null };
export type CapAdjustments = {
  buyoutPenaltyTotal: number;
  retentionNet: number;
  buyoutSlotsUsed: number;
  retentionSlotsUsed: number;
};

export const EMPTY_CAP_ADJUSTMENTS: CapAdjustments = {
  buyoutPenaltyTotal: 0,
  retentionNet: 0,
  buyoutSlotsUsed: 0,
  retentionSlotsUsed: 0,
};

export function salaryCapForSeason(year: number) {
  return year <= 2026 ? 45_000_000 : 50_000_000;
}

export function calculateTeamCap(rows: CapRosterRow[], seasonYear: number, adjustments: CapAdjustments = EMPTY_CAP_ADJUSTMENTS) {
  const rosterSalary = rows
    .filter((row) => CAP_POSITIONS.has((row.position || "").toUpperCase()))
    .reduce((sum, row) => sum + (Number.isFinite(row.salary) ? Number(row.salary) : 0), 0);
  const capSalary = rosterSalary + adjustments.buyoutPenaltyTotal + adjustments.retentionNet;
  const salaryCap = salaryCapForSeason(seasonYear);
  return {
    ...adjustments,
    rosterSalary,
    capSalary,
    salaryCap,
    capSpace: salaryCap - capSalary,
    rosterCount: rows.filter((row) => ACTIVE_ROSTER_POSITIONS.has((row.position || "").toUpperCase())).length,
  };
}
