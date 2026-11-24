import type { NhlGoalieRecord, NhlSkaterRecord } from "../src/lib/nhl";

export function getSkaterScore(record: NhlSkaterRecord) {
  const powerPlayAssists = record.ppPoints - record.ppGoals;
  const shortHandedAssists = record.shPoints - record.shGoals;

  return (
    record.goals * 3 +
    record.assists * 2 +
    record.plusMinus * 0.25 +
    record.penaltyMinutes * 0.2 +
    record.ppGoals +
    powerPlayAssists +
    record.shGoals * 2 +
    shortHandedAssists * 2 +
    record.gameWinningGoals +
    record.shots * 0.2 +
    record.blockedShots * 0.2 +
    record.hits * 0.2 +
    record.totalFaceoffWins * 0.025
  );
}

export function getGoalieScore(record: NhlGoalieRecord) {
  return (
    record.wins * 3 +
    record.otLosses +
    record.goalsAgainst * -0.5 +
    record.saves * 0.2 +
    record.shutouts * 2 +
    record.penaltyMinutes * 0.2 +
    record.goals * 3 +
    record.assists * 2
  );
}
