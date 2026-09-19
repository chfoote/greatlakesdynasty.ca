export const NHL_SEASON_ID = 20252026;
export const FANTASY_SEASON_YEAR = 2026;

type NhlStatsResponse<T> = {
  data?: T[];
};

const statsCacheTtlMs = 60_000;
const skaterStatsCache = new Map<number, { expiresAt: number; request: Promise<NhlSkaterRecord[]> }>();
const goalieStatsCache = new Map<number, { expiresAt: number; request: Promise<NhlGoalieRecord[]> }>();
const skaterPeriodCache = new Map<string, { expiresAt: number; request: Promise<NhlSkaterRecord[]> }>();
const goaliePeriodCache = new Map<string, { expiresAt: number; request: Promise<NhlGoalieRecord[]> }>();
const playerBiosCache = new Map<string, { expiresAt: number; request: Promise<NhlPlayerBio[]> }>();

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

export async function fetchNhlPlayerLanding(playerId: number): Promise<NhlPlayerLanding> {
  const response = await fetch(`/nhl-web-api/player/${playerId}/landing`);
  if (!response.ok) throw new Error(`Unable to load NHL player profile (${response.status})`);
  return response.json() as Promise<NhlPlayerLanding>;
}

export async function searchNhlPlayers(name: string): Promise<NhlPlayerSearchResult[]> {
  const params = new URLSearchParams({ culture: "en-us", limit: "10", q: name });
  const response = await fetch(`/nhl-search-api/search/player?${params}`);
  if (!response.ok) throw new Error(`Unable to search NHL players (${response.status})`);
  return response.json() as Promise<NhlPlayerSearchResult[]>;
}

export async function fetchNhlDraftPicks(draftYear: number): Promise<NhlDraftPick[]> {
  const response = await fetch(`/nhl-web-api/draft/picks/${draftYear}/all`);
  if (!response.ok) throw new Error(`Unable to load the ${draftYear} NHL Draft (${response.status})`);
  const payload = await response.json() as NhlDraftResponse;
  return payload.picks ?? [];
}

function reportUrl(position: "skater" | "goalie", report: string, seasonId: number) {
  const params = new URLSearchParams({
    limit: "-1",
    cayenneExp: `seasonId=${seasonId} and gameTypeId=2`,
  });

  return `/nhl-api/${position}/${report}?${params}`;
}

function periodReportUrl(position: "skater" | "goalie", report: string, seasonId: number, startDate: string, endDate: string) {
  const params = new URLSearchParams({
    limit: "-1",
    isAggregate: "true",
    cayenneExp: `seasonId=${seasonId} and gameTypeId=2 and gameDate>="${startDate}" and gameDate<="${endDate}"`,
  });
  return `/nhl-api/${position}/${report}?${params}`;
}

async function fetchReport<T>(url: string, label: string): Promise<T[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load NHL ${label} (${response.status})`);
  }

  const payload = (await response.json()) as NhlStatsResponse<T>;
  return payload.data ?? [];
}

function fetchPlayerBios(position: "skater" | "goalie", seasonId: number) {
  const key = `${position}:${seasonId}`;
  const cached = playerBiosCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.request;
  const request = fetchReport<NhlPlayerBio>(reportUrl(position, "bios", seasonId), `${position} bios`).catch(() => []);
  playerBiosCache.set(key, { expiresAt: Date.now() + statsCacheTtlMs, request });
  return request;
}

export async function fetchNhlSkaterStats(
  seasonId = NHL_SEASON_ID,
): Promise<NhlSkaterRecord[]> {
  const cached = skaterStatsCache.get(seasonId);
  if (cached && cached.expiresAt > Date.now()) return cached.request;

  const request = Promise.all([
      fetchReport<NhlSkaterSummary>(reportUrl("skater", "summary", seasonId), "skater summary"),
      fetchReport<NhlSkaterRealtime>(reportUrl("skater", "realtime", seasonId), "skater realtime stats"),
      fetchReport<NhlSkaterFaceoffs>(reportUrl("skater", "faceoffwins", seasonId), "skater faceoff stats"),
      fetchPlayerBios("skater", seasonId),
    ])
    .then(([summary, realtime, faceoffs, bios]) => {
      const realtimeByPlayer = new Map(realtime.map((row) => [row.playerId, row]));
      const faceoffsByPlayer = new Map(faceoffs.map((row) => [row.playerId, row]));
      const biosByPlayer = new Map(bios.map((row) => [row.playerId, row]));
      return summary.map((row) => ({
        ...row,
        blockedShots: realtimeByPlayer.get(row.playerId)?.blockedShots ?? 0,
        hits: realtimeByPlayer.get(row.playerId)?.hits ?? 0,
        totalFaceoffWins: faceoffsByPlayer.get(row.playerId)?.totalFaceoffWins ?? 0,
        birthDate: biosByPlayer.get(row.playerId)?.birthDate,
      }));
    })
    .catch((error) => {
      skaterStatsCache.delete(seasonId);
      throw error;
    });
  skaterStatsCache.set(seasonId, { expiresAt: Date.now() + statsCacheTtlMs, request });
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

export async function fetchNhlGoalieStats(
  seasonId = NHL_SEASON_ID,
): Promise<NhlGoalieRecord[]> {
  const cached = goalieStatsCache.get(seasonId);
  if (cached && cached.expiresAt > Date.now()) return cached.request;

  const request = Promise.all([
      fetchReport<NhlGoalieRecord>(reportUrl("goalie", "summary", seasonId), "goalie stats"),
      fetchPlayerBios("goalie", seasonId),
    ])
    .then(([summary, bios]) => {
      const biosByPlayer = new Map(bios.map((row) => [row.playerId, row]));
      return summary.map((row) => ({ ...row, birthDate: biosByPlayer.get(row.playerId)?.birthDate }));
    })
    .catch((error) => {
      goalieStatsCache.delete(seasonId);
      throw error;
    });
  goalieStatsCache.set(seasonId, { expiresAt: Date.now() + statsCacheTtlMs, request });
  return request;
}

export async function fetchNhlSkaterStatsForPeriod(seasonId: number, startDate: string, endDate: string) {
  const key = `${seasonId}:${startDate}:${endDate}`;
  const cached = skaterPeriodCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.request;

  const request = Promise.all([
      fetchReport<NhlSkaterSummary>(periodReportUrl("skater", "summary", seasonId, startDate, endDate), "weekly skater summary"),
      fetchReport<NhlSkaterRealtime>(periodReportUrl("skater", "realtime", seasonId, startDate, endDate), "weekly skater realtime stats"),
      fetchReport<NhlSkaterFaceoffs>(periodReportUrl("skater", "faceoffwins", seasonId, startDate, endDate), "weekly skater faceoff stats"),
      fetchPlayerBios("skater", seasonId),
    ])
    .then(([summary, realtime, faceoffs, bios]) => {
      const realtimeByPlayer = new Map(realtime.map((row) => [row.playerId, row]));
      const faceoffsByPlayer = new Map(faceoffs.map((row) => [row.playerId, row]));
      const biosByPlayer = new Map(bios.map((row) => [row.playerId, row]));
      return summary.map((row) => ({
        ...row,
        teamAbbrevs: row.teamAbbrevs || "",
        blockedShots: realtimeByPlayer.get(row.playerId)?.blockedShots ?? 0,
        hits: realtimeByPlayer.get(row.playerId)?.hits ?? 0,
        totalFaceoffWins: faceoffsByPlayer.get(row.playerId)?.totalFaceoffWins ?? 0,
        birthDate: biosByPlayer.get(row.playerId)?.birthDate,
      }));
    })
    .catch((error) => {
      skaterPeriodCache.delete(key);
      throw error;
    });
  skaterPeriodCache.set(key, { expiresAt: Date.now() + statsCacheTtlMs, request });
  return request;
}

export async function fetchNhlGoalieStatsForPeriod(seasonId: number, startDate: string, endDate: string) {
  const key = `${seasonId}:${startDate}:${endDate}`;
  const cached = goaliePeriodCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.request;

  const request = Promise.all([
    fetchReport<NhlGoalieRecord>(periodReportUrl("goalie", "summary", seasonId, startDate, endDate), "weekly goalie stats"),
    fetchPlayerBios("goalie", seasonId),
  ])
    .then(([rows, bios]) => {
      const biosByPlayer = new Map(bios.map((row) => [row.playerId, row]));
      return rows.map((row) => ({ ...row, teamAbbrevs: row.teamAbbrevs || "", birthDate: biosByPlayer.get(row.playerId)?.birthDate }));
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
