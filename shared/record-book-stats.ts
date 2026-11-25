import type { NhlSkaterRecord, NhlGoalieRecord } from "../src/lib/nhl";
import { getSkaterScore, getGoalieScore } from "./nhl-scoring.ts";
export type RecordStats = { skaters: NhlSkaterRecord[]; goalies: NhlGoalieRecord[] };
export function validRecordStats(value: unknown): value is RecordStats {
  const stats = value as RecordStats | null;
  if (!stats || !Array.isArray(stats.skaters) || !Array.isArray(stats.goalies)) return false;
  return ([['skaters',getSkaterScore],['goalies',getGoalieScore]] as const).every(([kind,score]) => {
    const fields=kind==='skaters' ? ['goals','assists','plusMinus','penaltyMinutes','ppGoals','ppPoints','shGoals','shPoints','gameWinningGoals','shots','blockedShots','hits','totalFaceoffWins'] : ['gamesStarted','wins','losses','otLosses','goalsAgainst','saves','shutouts','penaltyMinutes','goals','assists'];
    const ids = new Set<number>();
    return stats[kind].every(row => {
      if (!row || !Number.isSafeInteger(row.playerId) || row.playerId <= 0 || ids.has(row.playerId)
        || !fields.every(field=>typeof (row as unknown as Record<string,unknown>)[field]==='number'&&Number.isFinite((row as unknown as Record<string,number>)[field]))
        || !Number.isFinite(row.gamesPlayed) || row.gamesPlayed < 0 || !Number.isFinite(score(row as NhlSkaterRecord & NhlGoalieRecord))) return false;
      ids.add(row.playerId); return true;
    });
  });
}
