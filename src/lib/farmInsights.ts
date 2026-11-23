import { playerMetadata } from "./nhlPlayerMetadata";
import { createFarmRankingsCache } from "./farmRankingsCache";
import { createProspectOwnershipIndex } from "./prospectOwnership";
import { inheritNhlFreshness } from "./nhlFreshness";
import { fetchFantasyTeams, fetchTeamBrandingHistory, applyTeamBranding, type FantasyTeam } from "./fantasyTeams";
import { fetchPlayerSeasons } from "./fantasyPlayers";
import { fetchNhlDraftPicks, fetchNhlLiveSeasonStats, fetchNhlPlayerLanding, getGoalieScore, getSkaterScore, searchNhlPlayers, type NhlDraftPick } from "./nhl";
import { CURRENT_LEAGUE_SEASON } from "./leagueSeasons";

export type RankedFarmProspect = { playerId?: number; headshot?: string; name: string; position: string; nhlTeam: string; score: number; draftYear: number; overallPick: number };
export type FarmRanking = { team: Pick<FantasyTeam, "id" | "team_name" | "abbreviation" | "logo" | "primary_color" | "secondary_color">; rank: number; eligible: number; nhlActive: number; production: number; draftQuality: number; farmScore: number; topProspects: RankedFarmProspect[] };
export type AgingProspect = { playerId: number; name: string; position: string; birthDate: string; birthday: string; age: number; draftYear: number; nhlTeam: string; headshot?: string; score: number };
export type FarmInsights = { rankings: FarmRanking[]; agingByTeam: Map<number, AgingProspect[]> };

const insightRequests = new Map<string, { request: Promise<FarmInsights>; expires: number }>();
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const pickName = (pick: NhlDraftPick) => [pick.firstName?.default, pick.lastName?.default].filter(Boolean).join(" ") || "Unknown Player";
const age = (birthDate: string) => { const birth = new Date(`${birthDate}T00:00:00`); const now = new Date(); let value = now.getFullYear() - birth.getFullYear(); if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) value -= 1; return value; };
const earliestDraftYear = () => { const now = new Date(); return now.getFullYear() - ((now.getMonth() > 8 || (now.getMonth() === 8 && now.getDate() >= 15)) ? 6 : 7); };
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

export function fetchFarmInsights(teamId?: number, options: { rankingsOnly?: boolean } = {}) {
  const key = teamId === undefined ? (options.rankingsOnly ? "rankings" : "league") : `${options.rankingsOnly ? "rankings" : "aging"}:${teamId}`;
  const cached = insightRequests.get(key);
  if (cached && cached.expires > Date.now()) return cached.request;
  // The Front Office only needs this team's aging alerts, not every team's
  // rankings, photos, draft history and prospect lookups.
  const draftYears = Array.from({ length: CURRENT_LEAGUE_SEASON - earliestDraftYear() }, (_, index) => CURRENT_LEAGUE_SEASON - 1 - index)
    .filter(year => teamId === undefined || year <= earliestDraftYear() + 1);
  const request = Promise.all([
    fetchFantasyTeams(), fetchTeamBrandingHistory(), fetchPlayerSeasons(),
    Promise.all(draftYears.map(async (year) => ({ year, picks: await fetchNhlDraftPicks(year) }))),
    fetchNhlLiveSeasonStats(CURRENT_LEAGUE_SEASON),
  ]).then(async ([teams, branding, seasons, drafts, stats]) => {
    const displayTeams = teams.filter(team => teamId === undefined || team.id === teamId).map((team) => applyTeamBranding(team, branding, CURRENT_LEAGUE_SEASON));
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
    if (options.rankingsOnly) return { rankings: inheritNhlFreshness(rankingRows, [stats]), agingByTeam: new Map<number, AgingProspect[]>() };
    const rankingsWithHeadshots = (teamId === undefined ? rankingRows : []).map(row => ({ ...row,
      topProspects: row.topProspects.map(prospect => prospect.playerId
        ? { ...prospect, headshot: `https://assets.nhle.com/mugs/nhl/latest/${prospect.playerId}.png` } : prospect),
    }));
    const agingByTeam = new Map<number, AgingProspect[]>();
    await Promise.all(displayTeams.map(async (team) => {
      const candidates = rowsFor(team).filter((row) => !row.signed && row.year <= earliestDraftYear() + 1 && (!row.birthDate || age(row.birthDate) === 24));
      const resolved = await Promise.all(candidates.map(async (row) => {
        try {
          let playerId = row.playerId;
          if (!playerId) playerId = Number((await searchNhlPlayers(row.name)).find((result) => normalize(result.name) === normalize(row.name))?.playerId);
          if (!Number.isFinite(playerId)) return null;
          const knownBirthDate = row.birthDate || playerMetadata.read(playerId!)?.birthDate;
          const landing = knownBirthDate ? { birthDate: knownBirthDate, currentTeamAbbrev: row.nhlTeam, position: row.pick.positionCode,
            headshot: `https://assets.nhle.com/mugs/nhl/latest/${playerId}.png` } : await fetchNhlPlayerLanding(playerId!);
          if (!landing.birthDate) return null;
          const playerAge = age(landing.birthDate); if (playerAge !== 24) return null;
          const prospect: AgingProspect = { playerId: playerId!, name: row.name, position: row.pick.positionCode || landing.position || "—", birthDate: landing.birthDate, birthday: new Date(`${landing.birthDate}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" }), age: playerAge, draftYear: row.year, nhlTeam: landing.currentTeamAbbrev || row.nhlTeam, score: row.score };
          if (landing.headshot) prospect.headshot = landing.headshot;
          return prospect;
        } catch { return null; }
      }));
      agingByTeam.set(team.id, resolved.filter((row): row is AgingProspect => Boolean(row)).sort((a, b) => a.birthDate.localeCompare(b.birthDate)));
    }));
    return { rankings: rankingsWithHeadshots, agingByTeam };
  }).then(result => {
    const entry = insightRequests.get(key);
    if (entry?.request === request) entry.expires = Date.now() + 300_000;
    return result;
  }).catch((error) => { insightRequests.delete(key); throw error; });
  if (insightRequests.size >= 16) insightRequests.delete(insightRequests.keys().next().value!);
  insightRequests.set(key, { request, expires: Infinity });
  return request;
}

const rankingCache = createFarmRankingsCache({ seasonYear: CURRENT_LEAGUE_SEASON,
  load: async () => (await fetchFarmInsights(undefined, { rankingsOnly: true })).rankings });
export const readFarmRankings = rankingCache.read;
export const fetchFarmRankings = rankingCache.load;
