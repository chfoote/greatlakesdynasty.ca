import type { LiveSnapshot } from "../../shared/nhl-live";
import { playerMetadata } from "./nhlPlayerMetadata";
import { inheritNhlFreshness } from "./nhlFreshness";
import { savedNhl, validPlayerRows, NhlBaselineAvailable } from "./nhlSaved";
import { nhlStatsDate } from "../../shared/nhl-live";
import { fetchNhlLiveSnapshot } from "./nhlLive";
import { nhlFetch } from "./nhlRequest";
import { fetchCompleteNhlReport } from "./nhlReports";
import { CURRENT_LEAGUE_SEASON } from "./leagueSeasons";
export const NHL_SEASON_ID = 20252026;
export const FANTASY_SEASON_YEAR = 2026;

const statsCacheTtlMs = 300_000;
const skaterStatsCache = new Map<number, { expiresAt: number; request: Promise<NhlSkaterRecord[]> }>();
const goalieStatsCache = new Map<number, { expiresAt: number; request: Promise<NhlGoalieRecord[]> }>();
const skaterPeriodCache = new Map<string, { expiresAt: number; request: Promise<NhlSkaterRecord[]> }>();
const goaliePeriodCache = new Map<string, { expiresAt: number; request: Promise<NhlGoalieRecord[]> }>();
const playerBiosCache = new Map<string, { expiresAt: number; request: Promise<NhlPlayerBio[]> }>();
const playerSeasonStatsCache = new Map<string, { expiresAt: number; request: Promise<{ skater: NhlSkaterRecord | null; goalie: NhlGoalieRecord | null }> }>();

type NhlSkaterSummary = {
  playerId: number;
  skaterFullName: string;
  positionCode: string;
  teamAbbrevs: string;
  gamesPlayed: number;
  goals: number;
  assists: number;
  plusMinus: number;
  penaltyMinutes: number;
  ppGoals: number;
  ppPoints: number;
  shGoals: number;
  shPoints: number;
  gameWinningGoals: number;
  shots: number;
};

type NhlSkaterRealtime = {
  playerId: number;
  blockedShots: number;
  hits: number;
};

type NhlSkaterFaceoffs = {
  playerId: number;
  totalFaceoffWins: number;
};

type NhlPlayerBio = {
  playerId: number;
  birthDate?: string;
  birthCountryCode?: string;
  birthCountry?: string;
};

export type NhlSkaterRecord = NhlSkaterSummary & {
  blockedShots: number;
  hits: number;
  totalFaceoffWins: number;
  birthDate?: string;
};

export type NhlGoalieRecord = {
  playerId: number;
  goalieFullName: string;
  teamAbbrevs: string;
  gamesPlayed: number;
  gamesStarted: number;
  wins: number;
  losses: number;
  otLosses: number;
  goalsAgainst: number;
  saves: number;
  shutouts: number;
  penaltyMinutes: number;
  goals: number;
  assists: number;
  savePct: number | null;
  goalsAgainstAverage: number | null;
  birthDate?: string;
};

type LocalizedName = { default?: string };
export type NhlPlayerLanding = {
  playerId: number;
  firstName?: LocalizedName;
  lastName?: LocalizedName;
  fullTeamName?: LocalizedName;
  currentTeamAbbrev?: string;
  teamLogo?: string;
  sweaterNumber?: number;
  position?: string;
  headshot?: string;
  heroImage?: string;
  birthDate?: string;
  birthCity?: LocalizedName;
  birthStateProvince?: LocalizedName;
  birthCountry?: string;
  heightInInches?: number;
  weightInPounds?: number;
  shootsCatches?: string;
  draftDetails?: {
    year?: number;
    teamAbbrev?: string;
    round?: number;
    pickInRound?: number;
    overallPick?: number;
  };
};

export type NhlDraftPick = {
  round: number;
  pickInRound: number;
  overallPick: number;
  teamId: number;
  teamAbbrev: string;
  teamName?: LocalizedName;
  teamCommonName?: LocalizedName;
  teamLogoLight?: string;
  teamLogoDark?: string;
  firstName?: LocalizedName;
  lastName?: LocalizedName;
  positionCode?: string;
  countryCode?: string;
};

type NhlDraftResponse = {
  draftYear: number;
  picks?: NhlDraftPick[];
};

export type NhlPlayerSearchResult = {
  playerId: string;
  name: string;
  positionCode?: string;
  teamAbbrev?: string | null;
  lastTeamAbbrev?: string | null;
  active?: boolean;
};

type NhlBoxscorePlayer = { playerId?: number; position?: string; goals?: number; assists?: number; plusMinus?: number; pim?: number; hits?: number; powerPlayGoals?: number; sog?: number; blockedShots?: number; toi?: string; goalsAgainst?: number; saves?: number; savePctg?: number; starter?: boolean; decision?: "W" | "L" | "O"; shotsAgainst?: number };
type NhlBoxscoreTeamPlayers = { forwards?: NhlBoxscorePlayer[]; defense?: NhlBoxscorePlayer[]; goalies?: NhlBoxscorePlayer[] };
type NhlBoxscoreResponse = { gameState?: string; awayTeam?: { abbrev?: string; score?: number }; homeTeam?: { abbrev?: string; score?: number }; playerByGameStats?: { awayTeam?: NhlBoxscoreTeamPlayers; homeTeam?: NhlBoxscoreTeamPlayers } };
type NhlPlayByPlayResponse = { plays?: Array<{ typeDescKey?: string; periodDescriptor?: { periodType?: string }; details?: { scoringPlayerId?: number; assist1PlayerId?: number; assist2PlayerId?: number } }> };

export function getNhlStatsDate(dayOffset = 0) {
  return nhlStatsDate(dayOffset);
}

export async function fetchNhlLivePlayerIds(): Promise<Set<string>> {
  // Avoid /score/now: the NHL responds with an absolute redirect which can
  // escape our same-origin proxy and be blocked by the browser. NHL game dates
  // are published in Eastern time, so request that date directly.
  const snapshot = await fetchNhlLiveSnapshot(getNhlStatsDate());
  const scoreboard = snapshot.scoreboard;
  const now = Date.now();
  const liveGames = (scoreboard.games ?? []).filter((game) =>
    ["LIVE", "CRIT"].includes(game.gameState)
    // During preseason the scoreboard can remain PRE briefly after puck drop.
    // The box score below is the final authority on whether players are active.
    || (game.gameState === "PRE" && Boolean(game.startTimeUTC) && new Date(game.startTimeUTC!).getTime() <= now),
  );
  if (!liveGames.length) return new Set();

  const liveIds = new Set(liveGames.map((game) => game.id));
  const boxscores = snapshot.games.filter(({ game }) => liveIds.has(game.id))
    .map(({ boxscore }) => boxscore as NhlBoxscoreResponse | null);
  const ids = new Set<string>();
  boxscores.forEach((boxscore) => {
    if (!boxscore?.playerByGameStats) return;
    [boxscore.playerByGameStats.awayTeam, boxscore.playerByGameStats.homeTeam].forEach((team) => {
      [...(team?.forwards ?? []), ...(team?.defense ?? []), ...(team?.goalies ?? [])].forEach((player) => {
        if (player.playerId) ids.add(String(player.playerId));
      });
    });
  });
  return ids;
}

export async function fetchNhlDailyStats(date = getNhlStatsDate()): Promise<{ skaters: NhlSkaterRecord[]; goalies: NhlGoalieRecord[] }> {
  return buildNhlDailyStats(await fetchNhlLiveSnapshot(date));
}

export function buildNhlDailyStats(snapshot: LiveSnapshot): { skaters: NhlSkaterRecord[]; goalies: NhlGoalieRecord[] } {
  const gameData = snapshot.games.filter(({ boxscore }) => boxscore !== null).map(({ boxscore, playByPlay }) => ({
    boxscore: boxscore as NhlBoxscoreResponse,
    playByPlay: playByPlay as NhlPlayByPlayResponse | null,
  }));
  const skaters = new Map<number, NhlSkaterRecord>();
  const goalies = new Map<number, NhlGoalieRecord>();

  gameData.forEach(({ boxscore, playByPlay }) => {
    const offense = new Map<number, { goals: number; assists: number }>();
    const addOffense = (playerId: number | undefined, field: "goals" | "assists") => {
      if (!playerId) return;
      const current = offense.get(playerId) || { goals: 0, assists: 0 };
      current[field] += 1;
      offense.set(playerId, current);
    };
    (playByPlay?.plays ?? []).filter((play) => play.typeDescKey === "goal" && play.periodDescriptor?.periodType !== "SO").forEach((play) => {
      addOffense(play.details?.scoringPlayerId, "goals");
      addOffense(play.details?.assist1PlayerId, "assists");
      addOffense(play.details?.assist2PlayerId, "assists");
    });
    const sides = [
      [boxscore.playerByGameStats?.awayTeam, boxscore.awayTeam?.abbrev || "", boxscore.homeTeam?.score],
      [boxscore.playerByGameStats?.homeTeam, boxscore.homeTeam?.abbrev || "", boxscore.awayTeam?.score],
    ] as const;
    sides.forEach(([team, teamAbbrev, opponentScore]) => {
      [...(team?.forwards ?? []), ...(team?.defense ?? [])].forEach((player) => {
        if (!player.playerId) return;
        const current = skaters.get(player.playerId);
        const gamesPlayed = player.toi && player.toi !== "00:00" ? 1 : 0;
        skaters.set(player.playerId, {
          playerId: player.playerId, skaterFullName: "", positionCode: player.position || "", teamAbbrevs: teamAbbrev,
          gamesPlayed: (current?.gamesPlayed || 0) + gamesPlayed, goals: (current?.goals || 0) + (player.goals || 0), assists: (current?.assists || 0) + (player.assists || 0),
          plusMinus: (current?.plusMinus || 0) + (player.plusMinus || 0), penaltyMinutes: (current?.penaltyMinutes || 0) + (player.pim || 0), ppGoals: (current?.ppGoals || 0) + (player.powerPlayGoals || 0),
          ppPoints: (current?.ppPoints || 0) + (player.powerPlayGoals || 0), shGoals: current?.shGoals || 0, shPoints: current?.shPoints || 0, gameWinningGoals: current?.gameWinningGoals || 0,
          shots: (current?.shots || 0) + (player.sog || 0), blockedShots: (current?.blockedShots || 0) + (player.blockedShots || 0), hits: (current?.hits || 0) + (player.hits || 0), totalFaceoffWins: current?.totalFaceoffWins || 0,
        });
      });
      (team?.goalies ?? []).forEach((player) => {
        if (!player.playerId) return;
        const current = goalies.get(player.playerId);
        const playByPlayOffense = offense.get(player.playerId);
        const gamesPlayed = player.toi && player.toi !== "00:00" ? 1 : 0;
        const wins = player.decision === "W" ? 1 : 0;
        const losses = player.decision === "L" ? 1 : 0;
        const otLosses = player.decision === "O" ? 1 : 0;
        const shutouts = player.decision === "W" && opponentScore === 0 && player.goalsAgainst === 0 ? 1 : 0;
        goalies.set(player.playerId, {
          playerId: player.playerId, goalieFullName: "", teamAbbrevs: teamAbbrev, gamesPlayed: (current?.gamesPlayed || 0) + gamesPlayed, gamesStarted: (current?.gamesStarted || 0) + (player.starter && gamesPlayed ? 1 : 0),
          wins: (current?.wins || 0) + wins, losses: (current?.losses || 0) + losses, otLosses: (current?.otLosses || 0) + otLosses, goalsAgainst: (current?.goalsAgainst || 0) + (player.goalsAgainst || 0),
          saves: (current?.saves || 0) + (player.saves || 0), shutouts: (current?.shutouts || 0) + shutouts, penaltyMinutes: (current?.penaltyMinutes || 0) + (player.pim || 0), goals: (current?.goals || 0) + (playByPlayOffense?.goals ?? player.goals ?? 0), assists: (current?.assists || 0) + (playByPlayOffense?.assists ?? player.assists ?? 0),
          savePct: player.savePctg ?? current?.savePct ?? null, goalsAgainstAverage: null,
        });
      });
    });
  });
  return inheritNhlFreshness({ skaters: [...skaters.values()], goalies: [...goalies.values()] }, [snapshot]);
}

function mergeSkaterRecords(baseline: NhlSkaterRecord[], live: NhlSkaterRecord[]) {
  const merged = new Map(baseline.map((record) => [record.playerId, { ...record }]));
  live.forEach((record) => {
    const previous = merged.get(record.playerId);
    if (!previous) { merged.set(record.playerId, record); return; }
    merged.set(record.playerId, {
      ...previous,
      teamAbbrevs: record.teamAbbrevs || previous.teamAbbrevs,
      gamesPlayed: previous.gamesPlayed + record.gamesPlayed,
      goals: previous.goals + record.goals,
      assists: previous.assists + record.assists,
      plusMinus: previous.plusMinus + record.plusMinus,
      penaltyMinutes: previous.penaltyMinutes + record.penaltyMinutes,
      ppGoals: previous.ppGoals + record.ppGoals,
      ppPoints: previous.ppPoints + record.ppPoints,
      shGoals: previous.shGoals + record.shGoals,
      shPoints: previous.shPoints + record.shPoints,
      gameWinningGoals: previous.gameWinningGoals + record.gameWinningGoals,
      shots: previous.shots + record.shots,
      blockedShots: previous.blockedShots + record.blockedShots,
      hits: previous.hits + record.hits,
      totalFaceoffWins: previous.totalFaceoffWins + record.totalFaceoffWins,
    });
  });
  return [...merged.values()];
}

function mergeGoalieRecords(baseline: NhlGoalieRecord[], live: NhlGoalieRecord[]) {
  const merged = new Map(baseline.map((record) => [record.playerId, { ...record }]));
  live.forEach((record) => {
    const previous = merged.get(record.playerId);
    if (!previous) { merged.set(record.playerId, record); return; }
    const saves = previous.saves + record.saves;
    const goalsAgainst = previous.goalsAgainst + record.goalsAgainst;
    merged.set(record.playerId, {
      ...previous,
      teamAbbrevs: record.teamAbbrevs || previous.teamAbbrevs,
      gamesPlayed: previous.gamesPlayed + record.gamesPlayed,
      gamesStarted: previous.gamesStarted + record.gamesStarted,
      wins: previous.wins + record.wins,
      losses: previous.losses + record.losses,
      otLosses: previous.otLosses + record.otLosses,
      goalsAgainst,
      saves,
      shutouts: previous.shutouts + record.shutouts,
      penaltyMinutes: previous.penaltyMinutes + record.penaltyMinutes,
      goals: previous.goals + record.goals,
      assists: previous.assists + record.assists,
      savePct: saves + goalsAgainst > 0 ? saves / (saves + goalsAgainst) : null,
    });
  });
  return [...merged.values()];
}

async function loadNhlLiveSeasonStats(seasonYear: number, today = getNhlStatsDate()) {
  const seasonId = (seasonYear - 1) * 10000 + seasonYear;
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10);
  const seasonStart = `${seasonYear - 1}-07-01`;
  let daily: { skaters: NhlSkaterRecord[]; goalies: NhlGoalieRecord[] };
  try { daily = await fetchNhlDailyStats(today); }
  catch {
    const [skaters, goalies] = await Promise.all([fetchNhlSkaterStats(seasonId), fetchNhlGoalieStats(seasonId)]);
    throw new NhlBaselineAvailable(inheritNhlFreshness({ skaters, goalies }, [skaters, goalies]),
      "Live NHL updates unavailable. Showing the latest complete season totals.");
  }
  // Before today's games begin there is nothing to merge. The NHL's stable
  // full-season report already includes last night's completed games and uses
  // the same cache key every day, avoiding a slow new baseline rebuild each
  // morning. Once any player has appeared today, use the through-yesterday
  // baseline plus box scores so an in-progress game cannot be double-counted.
  if (!daily.skaters.length && !daily.goalies.length) {
    const [skaters, goalies] = await Promise.all([fetchNhlSkaterStats(seasonId), fetchNhlGoalieStats(seasonId)]);
    return inheritNhlFreshness({ skaters, goalies }, [skaters, goalies]);
  }
  const [baselineSkaters, baselineGoalies] = await Promise.all([
    fetchNhlSkaterStatsForPeriod(seasonId, seasonStart, yesterday),
    fetchNhlGoalieStatsForPeriod(seasonId, seasonStart, yesterday),
  ]);
  // A still-valid through-yesterday baseline is intentionally reused. A newer
  // live box score must advance this composite; delayed sources stay labeled.
  return inheritNhlFreshness({
    skaters: mergeSkaterRecords(baselineSkaters, daily.skaters),
    goalies: mergeGoalieRecords(baselineGoalies, daily.goalies),
  }, [baselineSkaters, baselineGoalies, daily], "latest-if-fresh");
}

export async function fetchNhlPlayerLanding(playerId: number): Promise<NhlPlayerLanding> {
  const response = await nhlFetch(`/nhl-web-api/player/${playerId}/landing`);
  if (!response.ok) throw new Error(`Unable to load NHL player profile (${response.status})`);
  const player = await response.json() as NhlPlayerLanding;
  playerMetadata.remember([{ ...player, playerId }]);
  return player;
}

export async function searchNhlPlayers(name: string): Promise<NhlPlayerSearchResult[]> {
  const params = new URLSearchParams({ culture: "en-us", limit: "10", q: name });
  const response = await nhlFetch(`/nhl-search-api/search/player?${params}`);
  if (!response.ok) throw new Error(`Unable to search NHL players (${response.status})`);
  return response.json() as Promise<NhlPlayerSearchResult[]>;
}

export async function fetchNhlDraftPicks(draftYear: number): Promise<NhlDraftPick[]> {
  const response = await nhlFetch(`/nhl-web-api/draft/picks/${draftYear}/all`);
  if (!response.ok) throw new Error(`Unable to load the ${draftYear} NHL Draft (${response.status})`);
  const payload = await response.json() as NhlDraftResponse;
  return payload.picks ?? [];
}

function reportUrl(position: "skater" | "goalie", report: string, seasonId: number) {
  const params = new URLSearchParams({
    cayenneExp: `seasonId=${seasonId} and gameTypeId=2`,
  });

  return `/nhl-api/complete/${position}/${report}?${params}`;
}

function playerReportUrl(position: "skater" | "goalie", report: string, seasonId: number, playerId: number) {
  const params = new URLSearchParams({
    limit: "-1",
    cayenneExp: `seasonId=${seasonId} and gameTypeId=2 and playerId=${playerId}`,
  });
  return `/nhl-api/${position}/${report}?${params}`;
}

function periodReportUrl(position: "skater" | "goalie", report: string, seasonId: number, startDate: string, endDate: string) {
  const params = new URLSearchParams({
    cayenneExp: `seasonId=${seasonId} and gameTypeId=2 and gameDate>="${startDate}" and gameDate<="${endDate}"`,
  });
  return `/nhl-api/complete/${position}/${report}?${params}`;
}

async function fetchReport<T>(url: string, label: string): Promise<T[]> {
  return fetchCompleteNhlReport<T>(url, label);
}

function fetchPlayerBios(position: "skater" | "goalie", seasonId: number) {
  const key = `${position}:${seasonId}`;
  const cached = playerBiosCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.request;
  const request = fetchReport<NhlPlayerBio>(reportUrl(position, "bios", seasonId), `${position} bios`).then(rows => {
    playerMetadata.remember(rows); return rows;
  }).catch(() => { playerBiosCache.delete(key); return []; });
  playerBiosCache.set(key, { expiresAt: Date.now() + 6 * 3600_000, request });
  return request;
}

export async function fetchNhlPlayerBiographies(seasonId: number, playerIds?: string[], onUpdate?: () => void) {
  if (!playerIds) {
    await Promise.all([fetchPlayerBios("skater", seasonId), fetchPlayerBios("goalie", seasonId)]);
    onUpdate?.();
    return;
  }
  const ids = [...new Set(playerIds)].filter(id => /^[1-9]\d{0,9}$/.test(id)).filter(id => !playerMetadata.read(id)?.birthCountry);
  // A roster needs a small biography response, not eight league-wide pages.
  // Keep URL size bounded, preserve the stats client's pacing/deduplication,
  // and leave photos independent of this optional request.
  for (let start = 0; start < ids.length; start += 40) {
    const filter = ids.slice(start, start + 40).map(id => `playerId=${id}`).join(" or ");
    const results = await Promise.allSettled((["skater", "goalie"] as const).map(async position => {
      const params = new URLSearchParams({ limit: "100", cayenneExp: `seasonId=${seasonId} and gameTypeId=2 and (${filter})` });
      const rows = await fetchCompleteNhlReport<NhlPlayerBio>(`/nhl-api/${position}/bios?${params}`, `${position} roster bios`, nhlFetch, { recoverRateLimit: false });
      playerMetadata.remember(rows);
      onUpdate?.();
    }));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}

async function loadNhlSkaterStats(
  seasonId = NHL_SEASON_ID,
): Promise<NhlSkaterRecord[]> {
  const cached = skaterStatsCache.get(seasonId);
  if (cached && cached.expiresAt > Date.now()) return cached.request;

  const request = Promise.all([
      fetchReport<NhlSkaterSummary>(reportUrl("skater", "summary", seasonId), "skater summary"),
      fetchReport<NhlSkaterRealtime>(reportUrl("skater", "realtime", seasonId), "skater realtime stats"),
      fetchReport<NhlSkaterFaceoffs>(reportUrl("skater", "faceoffwins", seasonId), "skater faceoff stats"),
    ])
    .then(([summary, realtime, faceoffs]) => {
      const realtimeByPlayer = new Map(realtime.map((row) => [row.playerId, row]));
      const faceoffsByPlayer = new Map(faceoffs.map((row) => [row.playerId, row]));
      return inheritNhlFreshness(summary.map((row) => ({
        ...row,
        blockedShots: realtimeByPlayer.get(row.playerId)?.blockedShots ?? 0,
        hits: realtimeByPlayer.get(row.playerId)?.hits ?? 0,
        totalFaceoffWins: faceoffsByPlayer.get(row.playerId)?.totalFaceoffWins ?? 0,
        birthDate: playerMetadata.read(String(row.playerId))?.birthDate,
      })), [summary, realtime, faceoffs]);
    })
    .catch((error) => {
      skaterStatsCache.delete(seasonId);
      throw error;
    });
  skaterStatsCache.set(seasonId, { expiresAt: Date.now() + statsCacheTtlMs, request });
  return request;
}

export function fetchNhlPlayerSeasonStats(playerId: number, seasonId: number) {
  const key = `${playerId}:${seasonId}`;
  const cached = playerSeasonStatsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.request;
  const request = Promise.all([
    fetchReport<NhlSkaterSummary>(playerReportUrl("skater", "summary", seasonId, playerId), "player skater summary"),
    fetchReport<NhlSkaterRealtime>(playerReportUrl("skater", "realtime", seasonId, playerId), "player realtime stats"),
    fetchReport<NhlSkaterFaceoffs>(playerReportUrl("skater", "faceoffwins", seasonId, playerId), "player faceoff stats"),
    fetchReport<NhlGoalieRecord>(playerReportUrl("goalie", "summary", seasonId, playerId), "player goalie stats"),
  ]).then(([summary, realtime, faceoffs, goalies]) => {
    const skater = summary[0];
    return {
      skater: skater ? { ...skater, blockedShots: realtime[0]?.blockedShots ?? 0, hits: realtime[0]?.hits ?? 0, totalFaceoffWins: faceoffs[0]?.totalFaceoffWins ?? 0 } : null,
      goalie: goalies[0] ?? null,
    };
  }).catch((error) => {
    playerSeasonStatsCache.delete(key);
    throw error;
  });
  playerSeasonStatsCache.set(key, { expiresAt: Date.now() + statsCacheTtlMs, request });
  return request;
}

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

async function loadNhlGoalieStats(
  seasonId = NHL_SEASON_ID,
): Promise<NhlGoalieRecord[]> {
  const cached = goalieStatsCache.get(seasonId);
  if (cached && cached.expiresAt > Date.now()) return cached.request;

  const request = Promise.all([
      fetchReport<NhlGoalieRecord>(reportUrl("goalie", "summary", seasonId), "goalie stats"),
    ])
    .then(([summary]) => {
      return inheritNhlFreshness(summary.map((row) => ({ ...row, birthDate: playerMetadata.read(String(row.playerId))?.birthDate })), [summary]);
    })
    .catch((error) => {
      goalieStatsCache.delete(seasonId);
      throw error;
    });
  goalieStatsCache.set(seasonId, { expiresAt: Date.now() + statsCacheTtlMs, request });
  return request;
}

async function loadNhlSkaterStatsForPeriod(seasonId: number, startDate: string, endDate: string) {
  const key = `${seasonId}:${startDate}:${endDate}`;
  const cached = skaterPeriodCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.request;

  const request = Promise.all([
      fetchReport<NhlSkaterSummary>(periodReportUrl("skater", "summary", seasonId, startDate, endDate), "weekly skater summary"),
      fetchReport<NhlSkaterRealtime>(periodReportUrl("skater", "realtime", seasonId, startDate, endDate), "weekly skater realtime stats"),
      fetchReport<NhlSkaterFaceoffs>(periodReportUrl("skater", "faceoffwins", seasonId, startDate, endDate), "weekly skater faceoff stats"),
    ])
    .then(([summary, realtime, faceoffs]) => {
      const realtimeByPlayer = new Map(realtime.map((row) => [row.playerId, row]));
      const faceoffsByPlayer = new Map(faceoffs.map((row) => [row.playerId, row]));
      return inheritNhlFreshness(summary.map((row) => ({
        ...row,
        teamAbbrevs: row.teamAbbrevs || "",
        blockedShots: realtimeByPlayer.get(row.playerId)?.blockedShots ?? 0,
        hits: realtimeByPlayer.get(row.playerId)?.hits ?? 0,
        totalFaceoffWins: faceoffsByPlayer.get(row.playerId)?.totalFaceoffWins ?? 0,
        birthDate: playerMetadata.read(String(row.playerId))?.birthDate,
      })), [summary, realtime, faceoffs]);
    })
    .catch((error) => {
      skaterPeriodCache.delete(key);
      throw error;
    });
  skaterPeriodCache.set(key, { expiresAt: Date.now() + statsCacheTtlMs, request });
  return request;
}

async function loadNhlGoalieStatsForPeriod(seasonId: number, startDate: string, endDate: string) {
  const key = `${seasonId}:${startDate}:${endDate}`;
  const cached = goaliePeriodCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.request;

  const request = Promise.all([
    fetchReport<NhlGoalieRecord>(periodReportUrl("goalie", "summary", seasonId, startDate, endDate), "weekly goalie stats"),
  ])
    .then(([rows]) => {
      return inheritNhlFreshness(rows.map((row) => ({ ...row, teamAbbrevs: row.teamAbbrevs || "", birthDate: playerMetadata.read(String(row.playerId))?.birthDate })), [rows]);
    })
    .catch((error) => {
      goaliePeriodCache.delete(key);
      throw error;
    });
  goaliePeriodCache.set(key, { expiresAt: Date.now() + statsCacheTtlMs, request });
  return request;
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

export function formatNhlStat(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-CA", { maximumFractionDigits: digits });
}

export function formatFantasyPoints(value: number) {
  return value.toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fetchNhlSkaterStats(seasonId = NHL_SEASON_ID) {
  const scope = seasonId === (CURRENT_LEAGUE_SEASON - 1) * 10000 + CURRENT_LEAGUE_SEASON
    ? getNhlStatsDate() : undefined;
  return savedNhl<NhlSkaterRecord[]>(`skaters:${seasonId}`, () => loadNhlSkaterStats(seasonId),
    (value): value is NhlSkaterRecord[] => validPlayerRows(value), statsCacheTtlMs, { scope });
}

export function fetchNhlGoalieStats(seasonId = NHL_SEASON_ID) {
  const scope = seasonId === (CURRENT_LEAGUE_SEASON - 1) * 10000 + CURRENT_LEAGUE_SEASON
    ? getNhlStatsDate() : undefined;
  return savedNhl<NhlGoalieRecord[]>(`goalies:${seasonId}`, () => loadNhlGoalieStats(seasonId),
    (value): value is NhlGoalieRecord[] => validPlayerRows(value), statsCacheTtlMs, { scope });
}

export function fetchNhlSkaterStatsForPeriod(seasonId: number, startDate: string, endDate: string) {
  return savedNhl<NhlSkaterRecord[]>(`skaters:${seasonId}:${startDate}:${endDate}`, () => loadNhlSkaterStatsForPeriod(seasonId, startDate, endDate),
    (value): value is NhlSkaterRecord[] => validPlayerRows(value), endDate < getNhlStatsDate() ? 86400_000 : statsCacheTtlMs);
}

export function fetchNhlGoalieStatsForPeriod(seasonId: number, startDate: string, endDate: string) {
  return savedNhl<NhlGoalieRecord[]>(`goalies:${seasonId}:${startDate}:${endDate}`, () => loadNhlGoalieStatsForPeriod(seasonId, startDate, endDate),
    (value): value is NhlGoalieRecord[] => validPlayerRows(value), endDate < getNhlStatsDate() ? 86400_000 : statsCacheTtlMs);
}

// Rankings need both datasets, but starting goalies beside the three skater
// reports creates an avoidable four-report burst against the NHL stats host.
// Keep the pair sequential; every rankings tab reuses the same returned data.
export async function fetchNhlSeasonStats(seasonId: number) {
  const skaters = await fetchNhlSkaterStats(seasonId);
  const goalies = await fetchNhlGoalieStats(seasonId);
  return { skaters, goalies };
}

export async function fetchNhlStatsForPeriod(seasonId: number, startDate: string, endDate: string) {
  const skaters = await fetchNhlSkaterStatsForPeriod(seasonId, startDate, endDate);
  const goalies = await fetchNhlGoalieStatsForPeriod(seasonId, startDate, endDate);
  return { skaters, goalies };
}

export function fetchNhlLiveSeasonStats(seasonYear: number) {
  const hockeyDate = getNhlStatsDate();
  return savedNhl<{ skaters: NhlSkaterRecord[]; goalies: NhlGoalieRecord[] }>(`live-season:${seasonYear}`,
    () => loadNhlLiveSeasonStats(seasonYear, hockeyDate),
    (value): value is { skaters: NhlSkaterRecord[]; goalies: NhlGoalieRecord[] } => Boolean(value && typeof value === 'object'
      && 'skaters' in value && 'goalies' in value && validPlayerRows(value.skaters) && validPlayerRows(value.goalies)), 30_000, { scope: hockeyDate, staleRetryMs: 5000 });
}
