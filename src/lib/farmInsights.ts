/// <reference types="vite/client" />
import { playerMetadata } from "./nhlPlayerMetadata";
import { createFarmRankingsCache } from "./farmRankingsCache";
import { farmSignature } from "../../shared/farm-signature";
import { nhlStatsDate } from "../../shared/nhl-live";
import { buildFarmRankings } from "../../shared/farm-rankings";
import { inheritNhlFreshness } from "./nhlFreshness";
import { fetchFantasyTeams, fetchTeamBrandingHistory, applyTeamBranding, type FantasyTeam } from "./fantasyTeams";
import { fetchPlayerSeasons } from "./fantasyPlayers";
import { fetchNhlDraftPicks, fetchNhlLiveSeasonStats, fetchNhlPlayerBiographies, getGoalieScore, getSkaterScore, searchNhlPlayers } from "./nhl";
import { CURRENT_LEAGUE_SEASON } from "./leagueSeasons";

export type RankedFarmProspect = { playerId?: number; headshot?: string; name: string; position: string; nhlTeam: string; score: number; draftYear: number; overallPick: number };
export type FarmRanking = { team: Pick<FantasyTeam, "id" | "team_name" | "abbreviation" | "logo" | "primary_color" | "secondary_color">; rank: number; eligible: number; nhlActive: number; production: number; draftQuality: number; farmScore: number; topProspects: RankedFarmProspect[] };
export type AgingProspect = { playerId: number; name: string; position: string; birthDate: string; birthday: string; age: number; draftYear: number; nhlTeam: string; headshot?: string; score: number };
export type FarmInsights = { rankings: FarmRanking[]; agingByTeam: Map<number, AgingProspect[]>; warnings?: string[] };

const insightRequests = new Map<string, { request: Promise<FarmInsights>; expires: number }>();
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const age = (birthDate: string) => { const birth = new Date(`${birthDate}T00:00:00`); const now = new Date(); let value = now.getFullYear() - birth.getFullYear(); if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) value -= 1; return value; };
const earliestDraftYear = () => { const now = new Date(); return now.getFullYear() - ((now.getMonth() > 8 || (now.getMonth() === 8 && now.getDate() >= 15)) ? 6 : 7); };

export function fetchFarmInsights(teamId?: number, options: { rankingsOnly?: boolean } = {}) {
  const sharedEnabled = Boolean((options.rankingsOnly || teamId !== undefined) && import.meta.env?.VITE_FARM_SNAPSHOTS === "true");
  const baseKey = teamId === undefined ? (options.rankingsOnly ? "rankings" : "league") : `${options.rankingsOnly ? "rankings" : "aging"}:${teamId}`;
  const key = `${baseKey}:${nhlStatsDate()}`;
  const cached = insightRequests.get(key);
  if (cached && cached.expires > Date.now()) return cached.request;
  // The Front Office only needs this team's aging alerts, not every team's
  // rankings, photos, draft history and prospect lookups.
  const draftYears = Array.from({ length: CURRENT_LEAGUE_SEASON - earliestDraftYear() }, (_, index) => CURRENT_LEAGUE_SEASON - 1 - index)
    .filter(year => teamId === undefined || year <= earliestDraftYear() + 1);
  const sharedRequest = sharedEnabled ? import("./farmSharedSnapshot").then(module=>module.fetchFarmSharedSnapshot()) : Promise.resolve(null);
  const request = Promise.all([
    fetchFantasyTeams(), fetchTeamBrandingHistory(), sharedEnabled ? import("./farmSharedSnapshot").then(module=>module.fetchFarmOwnershipRows()) : fetchPlayerSeasons(),
    sharedRequest.then(snapshot=>Promise.all(draftYears.map(async (year) => ({ year, picks: snapshot?.drafts.find(draft => draft.year === year)?.picks ?? await fetchNhlDraftPicks(year) })))),
    sharedEnabled ? import("./leagueSeasonStats").then(module=>module.fetchLeagueSeasonStats(CURRENT_LEAGUE_SEASON)) : fetchNhlLiveSeasonStats(CURRENT_LEAGUE_SEASON),
  ]).then(async ([teams, branding, seasons, drafts, stats]) => {
    const displayTeams = teams.filter(team => teamId === undefined || team.id === teamId).map((team) => applyTeamBranding(team, branding, CURRENT_LEAGUE_SEASON));
    const shared = await sharedRequest;
    if (shared && options.rankingsOnly) {
      try {
        if (shared.signature === await farmSignature(displayTeams, seasons, drafts, stats)) {
          return {rankings:inheritNhlFreshness(shared.rankings,[stats]),agingByTeam:new Map<number,AgingProspect[]>()};
        }
      } catch { /* Shared drafts still avoid per-visitor draft history loads. */ }
    }
    const {rankings: rankingRows, rowsFor} = buildFarmRankings(displayTeams, seasons, drafts, stats, {getSkaterScore,getGoalieScore});
    if (options.rankingsOnly) return { rankings: inheritNhlFreshness(rankingRows, [stats]), agingByTeam: new Map<number, AgingProspect[]>() };
    const rankingsWithHeadshots = (teamId === undefined ? rankingRows : []).map(row => ({ ...row,
      topProspects: row.topProspects.map(prospect => prospect.playerId
        ? { ...prospect, headshot: `https://assets.nhle.com/mugs/nhl/latest/${prospect.playerId}.png` } : prospect),
    }));
    const agingByTeam = new Map<number, AgingProspect[]>();
    const warnings: string[] = [];
    await Promise.all(displayTeams.map(async (team) => {
      const candidates = rowsFor(team).filter((row) => !row.signed && row.year <= earliestDraftYear() + 1 && (!row.birthDate || age(row.birthDate) === 24));
      const resolved = await Promise.all(candidates.map(async (row) => {
        try {
          let playerId = row.playerId;
          if (!playerId) playerId = Number((await searchNhlPlayers(row.name)).find((result) => normalize(result.name) === normalize(row.name))?.playerId);
          if (!Number.isFinite(playerId)) return null;
          return { row, playerId: playerId!, birthDate: row.birthDate || playerMetadata.read(playerId!)?.birthDate };
        } catch { return null; }
      }));
      const playerIds = [...new Set(resolved.flatMap(item => item
        && !item.birthDate && !playerMetadata.read(item.playerId)?.birthDate ? [String(item.playerId)] : []))];
      try {
        await fetchNhlPlayerBiographies((CURRENT_LEAGUE_SEASON - 1) * 10000 + CURRENT_LEAGUE_SEASON, playerIds);
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "Prospect birth dates could not be refreshed.");
      }
      const prospects = resolved.flatMap(item => {
        if (!item) return [];
        const birthDate = item.birthDate || playerMetadata.read(item.playerId)?.birthDate;
        if (!birthDate || age(birthDate) !== 24) return [];
        const prospect: AgingProspect = { playerId: item.playerId, name: item.row.name,
          position: item.row.pick.positionCode || "—", birthDate,
          birthday: new Date(`${birthDate}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" }),
          age: 24, draftYear: item.row.year, nhlTeam: playerMetadata.read(item.playerId)?.currentTeamAbbrev || item.row.nhlTeam,
          score: item.row.score, headshot: `https://assets.nhle.com/mugs/nhl/latest/${item.playerId}.png` };
        return [prospect];
      });
      agingByTeam.set(team.id, prospects.sort((a, b) => a.birthDate.localeCompare(b.birthDate)));
    }));
    return { rankings: rankingsWithHeadshots, agingByTeam, ...(warnings.length ? { warnings } : {}) };
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
