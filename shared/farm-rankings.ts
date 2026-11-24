import type { FantasyTeam } from "../src/lib/fantasyTeams";
import type { ProspectOwnershipRow } from "../src/lib/prospectOwnership";
import type { NhlSkaterRecord, NhlGoalieRecord, NhlDraftPick } from "../src/lib/nhl";
import type { FarmRanking } from "../src/lib/farmInsights";
import { createProspectOwnershipIndex } from "../src/lib/prospectOwnership.ts";
import { getSkaterScore, getGoalieScore } from "./nhl-scoring.ts";
export function farmDate(now = Date.now()) {
  return new Date(new Intl.DateTimeFormat("en-CA", {timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit"}).format(now)+"T12:00:00");
}
export function farmDraftYears(season: number, date = farmDate()) {
  const earliest = date.getFullYear() - ((date.getMonth() > 8 || (date.getMonth() === 8 && date.getDate() >= 15)) ? 6 : 7);
  return Array.from({length:season-earliest},(_,index)=>season-1-index);
}
export function buildFarmRankings(displayTeams: FantasyTeam[], seasons: ProspectOwnershipRow[], drafts: Array<{year:number;picks:NhlDraftPick[]}>, stats: {skaters:NhlSkaterRecord[];goalies:NhlGoalieRecord[]},
  scoring = {getSkaterScore,getGoalieScore}, date = farmDate()) {
  const {getSkaterScore,getGoalieScore} = scoring;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const pickName = (pick: NhlDraftPick) => [pick.firstName?.default, pick.lastName?.default].filter(Boolean).join(" ") || "Unknown Player";
const age = (birthDate: string) => { const birth = new Date(`${birthDate}T00:00:00`); const now = date; let value = now.getFullYear() - birth.getFullYear(); if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) value -= 1; return value; };
const farmNames = (name: string | null, year: number) => {
  if (!name) return [];
  const key = normalize(name);
  if (key === "detroitredrings") return ["detroitredwings", "det"];
  if (key === "anaheimduck") return ["anaheimducks", "ana"];
  if (["utahmammoth", "utahhockeyclub", "uta"].includes(key)) return year < 2024 ? ["arizonacoyotes", "ari"] : year === 2024 ? ["utahhockeyclub", "uta"] : ["utahmammoth", "uta"];
  return [key];
};
const belongs = (pick: NhlDraftPick, name: string | null, year: number) => {
  const requested = farmNames(name, year);
  return [pick.teamName?.default, pick.teamCommonName?.default, pick.teamAbbrev].filter(Boolean).map((value) => normalize(String(value))).some((value) => requested.includes(value));
};
    const skaters = new Map(stats.skaters.map((row) => [normalize(row.skaterFullName), row]));
    const goalies = new Map(stats.goalies.map((row) => [normalize(row.goalieFullName), row]));
    const ownership = createProspectOwnershipIndex(seasons);
    const allRows = drafts.flatMap(({ year, picks }) => picks.map((pick) => {
      const name = pickName(pick); const record = pick.positionCode === "G" ? goalies.get(normalize(name)) : skaters.get(normalize(name));
      const score = record ? (pick.positionCode === "G" ? getGoalieScore(record as Parameters<typeof getGoalieScore>[0]) : getSkaterScore(record as Parameters<typeof getSkaterScore>[0])) : 0;
      return { year, pick, name, playerId: record?.playerId, birthDate: record?.birthDate, nhlTeam: record?.teamAbbrevs?.split(",")[0] || pick.teamAbbrev, score, signed: ownership.wasSigned(name, record?.playerId), rightsTeamId: ownership.rightsTeam(name, record?.playerId) };
    }));
    const rowsFor = (team: FantasyTeam) => allRows.filter((row) => row.rightsTeamId ? row.rightsTeamId === team.id : belongs(row.pick, team.eastern_farm_system, row.year) || belongs(row.pick, team.western_farm_system, row.year));
    const rankingBase = displayTeams.map((team) => {
      const eligible = rowsFor(team).filter((row) => !row.signed && (!row.birthDate || age(row.birthDate) < 25));
      const production = eligible.map((row) => row.score).sort((a, b) => b - a).slice(0, 5).reduce((sum, value) => sum + value, 0);
      const draftCapital = eligible.map((row) => Math.max(225 - row.pick.overallPick, 0) / 224).sort((a, b) => b - a).slice(0, 10).reduce((sum, value) => sum + value, 0);
      const topProspects = [...eligible].sort((a, b) => b.score - a.score).slice(0, 3).map((row) => ({ playerId: row.playerId, name: row.name, position: row.pick.positionCode || "—", nhlTeam: row.nhlTeam, score: row.score, draftYear: row.year, overallPick: row.pick.overallPick }));
      return { team, eligible: eligible.length, nhlActive: eligible.filter((row) => row.score > 0).length, production, draftCapital, topProspects };
    });
    const productionLeader = Math.max(...rankingBase.map((row) => row.production), 1);
    const draftCapitalLeader = Math.max(...rankingBase.map((row) => row.draftCapital), 1);
    const depthLeader = Math.max(...rankingBase.map((row) => Math.min(row.eligible, 25)), 1);
    const rankingRows: FarmRanking[] = rankingBase.map((row) => {
      const productionIndex = row.production / productionLeader;
      const draftQuality = row.draftCapital / draftCapitalLeader * 100;
      const depthIndex = Math.min(row.eligible, 25) / depthLeader;
      return { team: row.team, rank: 0, eligible: row.eligible, nhlActive: row.nhlActive, production: row.production, draftQuality, farmScore: productionIndex * 85 + draftQuality * 0.10 + depthIndex * 5, topProspects: row.topProspects };
    }).sort((a, b) => b.farmScore - a.farmScore || b.production - a.production || b.draftQuality - a.draftQuality).map((row, index) => ({ ...row, rank: index + 1 }));

  return { rankings: rankingRows, rowsFor };
}
