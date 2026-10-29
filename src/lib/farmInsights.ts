import { fetchFantasyTeams, fetchTeamBrandingHistory, applyTeamBranding, type FantasyTeam } from "./fantasyTeams";
import { fetchPlayerSeasons, type PlayerSeasonWithRelations } from "./fantasyPlayers";
import { fetchNhlDraftPicks, fetchNhlLiveSeasonStats, fetchNhlPlayerLanding, getGoalieScore, getSkaterScore, searchNhlPlayers, type NhlDraftPick } from "./nhl";
import { CURRENT_LEAGUE_SEASON } from "./leagueSeasons";

export type FarmRanking = { team: FantasyTeam; rank: number; eligible: number; nhlActive: number; production: number; farmScore: number };
export type AgingProspect = { playerId: number; name: string; position: string; birthDate: string; birthday: string; age: number; draftYear: number; nhlTeam: string; headshot?: string; score: number };
export type FarmInsights = { rankings: FarmRanking[]; agingByTeam: Map<number, AgingProspect[]> };

let insightRequest: Promise<FarmInsights> | null = null;
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
const wasSigned = (name: string, playerId: number | undefined, seasons: PlayerSeasonWithRelations[]) => seasons.some((row) => {
  const same = playerId ? row.player?.player_api_id === String(playerId) : normalize(row.player?.full_name || "") === normalize(name);
  return same && Boolean(row.fantasy_team_id) && !["PROSPECT", "AP"].includes((row.position || "").toUpperCase());
});
const prospectRightsTeam = (name: string, playerId: number | undefined, seasons: PlayerSeasonWithRelations[]) => {
  const latest = seasons.filter((row) => {
    const same = playerId ? row.player?.player_api_id === String(playerId) : normalize(row.player?.full_name || "") === normalize(name);
    return same && Boolean(row.fantasy_team_id);
  }).sort((a, b) => b.season_year - a.season_year || b.updated_at.localeCompare(a.updated_at))[0];
  return latest && ["PROSPECT", "AP"].includes((latest.position || "").toUpperCase()) ? latest.fantasy_team_id : null;
};

export function fetchFarmInsights() {
  if (insightRequest) return insightRequest;
  insightRequest = Promise.all([
    fetchFantasyTeams(), fetchTeamBrandingHistory(), fetchPlayerSeasons(),
    Promise.all(Array.from({ length: CURRENT_LEAGUE_SEASON - earliestDraftYear() }, (_, index) => CURRENT_LEAGUE_SEASON - 1 - index).map(async (year) => ({ year, picks: await fetchNhlDraftPicks(year) }))),
    fetchNhlLiveSeasonStats(CURRENT_LEAGUE_SEASON),
  ]).then(async ([teams, branding, seasons, drafts, stats]) => {
    const displayTeams = teams.map((team) => applyTeamBranding(team, branding, CURRENT_LEAGUE_SEASON));
    const skaters = new Map(stats.skaters.map((row) => [normalize(row.skaterFullName), row]));
    const goalies = new Map(stats.goalies.map((row) => [normalize(row.goalieFullName), row]));
    const allRows = drafts.flatMap(({ year, picks }) => picks.map((pick) => {
      const name = pickName(pick); const record = pick.positionCode === "G" ? goalies.get(normalize(name)) : skaters.get(normalize(name));
      const score = record ? (pick.positionCode === "G" ? getGoalieScore(record as Parameters<typeof getGoalieScore>[0]) : getSkaterScore(record as Parameters<typeof getSkaterScore>[0])) : 0;
      return { year, pick, name, playerId: record?.playerId, birthDate: record?.birthDate, nhlTeam: record?.teamAbbrevs?.split(",")[0] || pick.teamAbbrev, score, signed: wasSigned(name, record?.playerId, seasons), rightsTeamId: prospectRightsTeam(name, record?.playerId, seasons) };
    }));
    const rowsFor = (team: FantasyTeam) => allRows.filter((row) => row.rightsTeamId ? row.rightsTeamId === team.id : belongs(row.pick, team.eastern_farm_system, row.year) || belongs(row.pick, team.western_farm_system, row.year));
    const rankingRows = displayTeams.map((team) => { const eligible = rowsFor(team).filter((row) => !row.signed && (!row.birthDate || age(row.birthDate) < 25)); const production = eligible.map((row) => row.score).sort((a, b) => b - a).slice(0, 5).reduce((sum, value) => sum + value, 0); return { team, rank: 0, eligible: eligible.length, nhlActive: eligible.filter((row) => row.score > 0).length, production, farmScore: production + eligible.length * 2 }; }).sort((a, b) => b.farmScore - a.farmScore || b.nhlActive - a.nhlActive || b.eligible - a.eligible).map((row, index) => ({ ...row, rank: index + 1 }));
    const agingByTeam = new Map<number, AgingProspect[]>();
    await Promise.all(displayTeams.map(async (team) => {
      const candidates = rowsFor(team).filter((row) => !row.signed && row.year <= earliestDraftYear() + 1);
      const resolved = await Promise.all(candidates.map(async (row) => {
        try {
          let playerId = row.playerId;
          if (!playerId) playerId = Number((await searchNhlPlayers(row.name)).find((result) => normalize(result.name) === normalize(row.name))?.playerId);
          if (!Number.isFinite(playerId)) return null;
          const landing = await fetchNhlPlayerLanding(playerId!); if (!landing.birthDate) return null;
          const playerAge = age(landing.birthDate); if (playerAge !== 24) return null;
          const prospect: AgingProspect = { playerId: playerId!, name: row.name, position: row.pick.positionCode || landing.position || "—", birthDate: landing.birthDate, birthday: new Date(`${landing.birthDate}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" }), age: playerAge, draftYear: row.year, nhlTeam: landing.currentTeamAbbrev || row.nhlTeam, score: row.score };
          if (landing.headshot) prospect.headshot = landing.headshot;
          return prospect;
        } catch { return null; }
      }));
      agingByTeam.set(team.id, resolved.filter((row): row is AgingProspect => Boolean(row)).sort((a, b) => a.birthDate.localeCompare(b.birthDate)));
    }));
    return { rankings: rankingRows, agingByTeam };
  }).catch((error) => { insightRequest = null; throw error; });
  return insightRequest;
}
