import { fetchPlayerSeasonsBySeason, type PlayerSeasonWithRelations } from "./fantasyPlayers";
import { fetchFantasyTeams, type FantasyTeam } from "./fantasyTeams";
import { fetchLeagueTransactions, type LeagueTransaction } from "./transactions";
import { fetchProspectRights, getProspectRight, removeAgedOutProspectRights } from "./prospectRights";
import { fetchNhlDailyStats, fetchNhlLiveSeasonStats, getGoalieScore, getNhlStatsDate, getSkaterScore } from "./nhl";
import { fetchRecordBookData, type FranchiseStatLine } from "./recordBook";

type Localized = { default?: string };
type ScoreTeam = { id?: number; abbrev?: string; score?: number; logo?: string; commonName?: Localized; placeName?: Localized };
type ScoreGame = { id: number; gameState: string; startTimeUTC?: string; awayTeam?: ScoreTeam; homeTeam?: ScoreTeam };
type ScoreResponse = { games?: ScoreGame[] };
type RosterSpot = { playerId: number; teamId?: number; firstName?: Localized; lastName?: Localized; headshot?: string; sweaterNumber?: number; positionCode?: string };
type Play = {
  eventId: number; sortOrder?: number; typeDescKey?: string; timeInPeriod?: string;
  periodDescriptor?: { number?: number; periodType?: string; maxRegulationPeriods?: number };
  details?: { eventOwnerTeamId?: number; scoringPlayerId?: number; assist1PlayerId?: number; assist2PlayerId?: number; awayScore?: number; homeScore?: number; situationCode?: string; shotType?: string };
};
type PlayByPlay = { rosterSpots?: RosterSpot[]; plays?: Play[] };
type BoxscoreGoalie = { playerId?: number; saves?: number; goalsAgainst?: number; decision?: "W" | "L" | "O"; headshot?: string };
type Boxscore = { playerByGameStats?: { awayTeam?: { goalies?: BoxscoreGoalie[] }; homeTeam?: { goalies?: BoxscoreGoalie[] } } };

export type GoalFeedPlayer = {
  playerId: string;
  name: string;
  headshot?: string;
  fantasyTeam: FantasyTeam | null;
  prospect: boolean;
  tonightPoints: number | null;
};

export type GoalFeedEvent = {
  key: string;
  gameId: number;
  gameState: string;
  startTimeUTC?: string;
  nhlTeam: { abbreviation: string; logo?: string };
  awayTeam: { abbreviation: string; score: number; logo?: string };
  homeTeam: { abbreviation: string; score: number; logo?: string };
  scorer: GoalFeedPlayer;
  assists: GoalFeedPlayer[];
  period: number;
  periodType: string;
  timeInPeriod: string;
  strength: "PP" | "SH" | "EN" | null;
  shotType?: string;
  sortValue: number;
};

export type GoalieFeedEvent = {
  key: string;
  gameId: number;
  gameState: string;
  goalie: GoalFeedPlayer;
  saves: number;
  shutout: boolean;
  nhlTeam: { abbreviation: string; logo?: string };
  awayTeam: { abbreviation: string; score: number; logo?: string };
  homeTeam: { abbreviation: string; score: number; logo?: string };
  sortValue: number;
};

export type FeedStanding = { team: FantasyTeam; rank: number; points: number };

export type RecordMovement = {
  scope: "league" | "franchise";
  category: "Goals" | "Assists" | "Points" | "Game-Winning Goals" | "Wins" | "Shutouts";
  abbreviation: "G" | "A" | "P" | "GWG" | "W" | "SO";
  beforeRank: number | null;
  afterRank: number;
  value: number;
  moved: boolean;
  tied: boolean;
  passedNames: string[];
  tiedNames: string[];
  team: FantasyTeam | null;
};

export type RecordMovementEvent = {
  key: string;
  player: GoalFeedPlayer;
  movements: RecordMovement[];
  sortValue: number;
};

type RecordMetric = {
  category: RecordMovement["category"];
  abbreviation: RecordMovement["abbreviation"];
  kind: "skater" | "goalie";
  value: (line: FranchiseStatLine) => number;
  dailyValue: (row: Record<string, unknown>) => number;
};

const recordMetrics: RecordMetric[] = [
  { category: "Goals", abbreviation: "G", kind: "skater", value: (line) => line.skater?.goals || 0, dailyValue: (row) => Number(row.goals || 0) },
  { category: "Assists", abbreviation: "A", kind: "skater", value: (line) => line.skater?.assists || 0, dailyValue: (row) => Number(row.assists || 0) },
  { category: "Points", abbreviation: "P", kind: "skater", value: (line) => line.skater?.points || 0, dailyValue: (row) => Number(row.goals || 0) + Number(row.assists || 0) },
  { category: "Game-Winning Goals", abbreviation: "GWG", kind: "skater", value: (line) => line.skater?.gameWinningGoals || 0, dailyValue: (row) => Number(row.gameWinningGoals || 0) },
  { category: "Wins", abbreviation: "W", kind: "goalie", value: (line) => line.goalie?.wins || 0, dailyValue: (row) => Number(row.wins || 0) },
  { category: "Shutouts", abbreviation: "SO", kind: "goalie", value: (line) => line.goalie?.shutouts || 0, dailyValue: (row) => Number(row.shutouts || 0) },
];

const recordBookCache = new Map<string, { expiresAt: number; request: ReturnType<typeof fetchRecordBookData> }>();

function fetchDatedRecordBook(date: string) {
  const cached = recordBookCache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.request;
  const request = fetchRecordBookData(null, null, date);
  recordBookCache.set(date, { expiresAt: Date.now() + (date === getNhlStatsDate() ? 60_000 : 15 * 60_000), request });
  request.catch(() => { if (recordBookCache.get(date)?.request === request) recordBookCache.delete(date); });
  return request;
}

function competitionRank(values: number[], value: number) {
  return 1 + values.filter((candidate) => candidate > value).length;
}

function buildRecordMovements(
  lines: FranchiseStatLine[],
  dailySkaters: Record<string, unknown>[],
  dailyGoalies: Record<string, unknown>[],
  players: Map<string, GoalFeedPlayer>,
  metricSortValues: Map<string, number>,
  ownerByPlayer: Map<string, number | null>,
) {
  const dailyByKind = {
    skater: new Map(dailySkaters.map((row) => [String(row.playerId), row])),
    goalie: new Map(dailyGoalies.map((row) => [String(row.playerId), row])),
  };
  const results: RecordMovementEvent[] = [];

  players.forEach((player, playerId) => {
    const playerLines = lines.filter((line) => line.playerId === playerId);
    const teamId = player.fantasyTeam?.id;
    if (!playerLines.length || !teamId) return;
    const movementsByEvent = new Map<number, RecordMovement[]>();

    recordMetrics.forEach((metric) => {
      const dailyRow = dailyByKind[metric.kind].get(playerId);
      const dailyValue = dailyRow ? metric.dailyValue(dailyRow) : 0;
      if (dailyValue <= 0) return;

      (["league", "franchise"] as const).forEach((scope) => {
        const scopedLines = scope === "league" ? lines : lines.filter((line) => line.team?.id === teamId);
        const grouped = new Map<string, { name: string; current: number; before: number }>();
        scopedLines.forEach((line) => {
          const current = grouped.get(line.playerId) || { name: line.playerName, current: 0, before: 0 };
          const value = metric.value(line);
          current.current += value;
          current.before += value;
          grouped.set(line.playerId, current);
        });
        grouped.forEach((row, candidateId) => {
          const candidateDaily = dailyByKind[metric.kind].get(candidateId);
          if (!candidateDaily) return;
          if (scope === "league" || ownerByPlayer.get(candidateId) === teamId) row.before -= metric.dailyValue(candidateDaily);
        });
        const subject = grouped.get(playerId);
        if (!subject || subject.current < dailyValue) return;
        const beforeValues = [...grouped.values()].map((row) => row.before);
        const currentValues = [...grouped.values()].map((row) => row.current);
        const beforeRank = competitionRank(beforeValues, subject.before);
        const afterRank = competitionRank(currentValues, subject.current);
        if (afterRank > 5) return;
        const moved = afterRank < beforeRank;
        const passedNames = [...grouped.entries()].filter(([id, row]) => id !== playerId && row.before > subject.before && row.current < subject.current).map(([, row]) => row.name);
        const tiedNames = [...grouped.entries()].filter(([id, row]) => id !== playerId && row.current === subject.current).map(([, row]) => row.name);
        const sortValue = metricSortValues.get(`${playerId}:${metric.abbreviation}`);
        if (sortValue == null) return;
        const movement: RecordMovement = {
          scope, category: metric.category, abbreviation: metric.abbreviation,
          beforeRank: beforeRank <= 5 ? beforeRank : null, afterRank, value: subject.current,
          moved, tied: tiedNames.length > 0, passedNames: passedNames.slice(0, 2), tiedNames: tiedNames.slice(0, 2),
          team: scope === "franchise" ? player.fantasyTeam : null,
        };
        movementsByEvent.set(sortValue, [...(movementsByEvent.get(sortValue) || []), movement]);
      });
    });

    movementsByEvent.forEach((movements, sortValue) => {
      const signature = movements.map((movement) => `${movement.scope}:${movement.abbreviation}:${movement.afterRank}:${movement.value}`).join("|");
      results.push({ key: `records:${playerId}:${signature}`, player, movements, sortValue: sortValue + 0.5 });
    });
  });
  return results;
}

function seasonForDate(date: string) {
  const [year, month] = date.split("-").map(Number);
  return month >= 9 ? year + 1 : year;
}

function historicalTeamId(row: PlayerSeasonWithRelations, transactions: LeagueTransaction[], date: string) {
  let teamId = row.fantasy_team_id;
  transactions.filter((transaction) => transaction.season_year === row.season_year && transaction.transaction_type === "trade" && transaction.transaction_date > date)
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.created_at.localeCompare(a.created_at))
    .forEach((transaction) => {
      const move = transaction.trade_offer?.trade_offer_players.find((candidate) => candidate.player_season?.player_id === row.player_id);
      if (move) teamId = move.from_team_id;
    });
  return teamId;
}

function strengthLabel(code: string | undefined, scoringIsHome: boolean) {
  if (!code || code.length < 4) return null;
  const awayGoalie = Number(code[0]);
  const awaySkaters = Number(code[1]);
  const homeSkaters = Number(code[2]);
  const homeGoalie = Number(code[3]);
  const scoringSkaters = scoringIsHome ? homeSkaters : awaySkaters;
  const defendingSkaters = scoringIsHome ? awaySkaters : homeSkaters;
  const defendingGoalie = scoringIsHome ? awayGoalie : homeGoalie;
  if (defendingGoalie === 0) return "EN" as const;
  if (scoringSkaters > defendingSkaters) return "PP" as const;
  if (scoringSkaters < defendingSkaters) return "SH" as const;
  return null;
}

function estimatedGoalTime(startTimeUTC: string | undefined, period: number, periodType: string, minutes: number, seconds: number, sortOrder: number) {
  const start = startTimeUTC ? new Date(startTimeUTC).getTime() : 0;
  const playedSeconds = minutes * 60 + seconds;
  // NHL events do not include a wall-clock timestamp. Estimate it from puck
  // drop while accounting for intermissions so simultaneous games interleave
  // naturally instead of grouping primarily by scheduled start time.
  let elapsedSeconds: number;
  if (period <= 3) elapsedSeconds = Math.max(period - 1, 0) * (20 * 60 + 18 * 60) + playedSeconds;
  else if (periodType === "SO") elapsedSeconds = 3 * 20 * 60 + 2 * 18 * 60 + 8 * 60 + playedSeconds;
  else elapsedSeconds = 3 * 20 * 60 + 2 * 18 * 60 + 3 * 60 + Math.max(period - 4, 0) * (20 * 60 + 18 * 60) + playedSeconds;
  return start + elapsedSeconds * 1_000 + sortOrder / 1_000;
}

export async function fetchGoalFeed(date: string): Promise<{ events: GoalFeedEvent[]; goalieEvents: GoalieFeedEvent[]; recordEvents: RecordMovementEvent[]; standings: FeedStanding[]; baselineStandings: FeedStanding[]; games: number; live: boolean; teams: FantasyTeam[] }> {
  const season = seasonForDate(date);
  const [scoreResponse, roster, teams, transactions, prospectRights, dailyStats, seasonStats] = await Promise.all([
    fetch(`/nhl-web-api/score/${date}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(`Unable to load NHL games (${response.status})`);
      return response.json() as Promise<ScoreResponse>;
    }),
    fetchPlayerSeasonsBySeason(season),
    fetchFantasyTeams(true),
    fetchLeagueTransactions(),
    fetchProspectRights(season),
    fetchNhlDailyStats(date).catch(() => ({ skaters: [], goalies: [] })),
    date === getNhlStatsDate() ? fetchNhlLiveSeasonStats(season).catch(() => null) : Promise.resolve(null),
  ]);
  const games = scoreResponse.games ?? [];
  const playByPlay = await Promise.all(games.map(async (game) => {
    const [playResponse, boxscoreResponse] = await Promise.all([
      fetch(`/nhl-web-api/gamecenter/${game.id}/play-by-play`, { cache: "no-store" }),
      fetch(`/nhl-web-api/gamecenter/${game.id}/boxscore`, { cache: "no-store" }),
    ]);
    return {
      game,
      data: playResponse.ok ? await playResponse.json() as PlayByPlay : null,
      boxscore: boxscoreResponse.ok ? await boxscoreResponse.json() as Boxscore : null,
    };
  }));
  const gamePlayers = new Map<number, string>();
  playByPlay.forEach(({ data }) => (data?.rosterSpots ?? []).forEach((player) => {
    gamePlayers.set(player.playerId, [player.firstName?.default, player.lastName?.default].filter(Boolean).join(" "));
  }));
  const eligibleProspectRights = await removeAgedOutProspectRights(prospectRights, [...gamePlayers].map(([playerId, playerName]) => ({ playerId, playerName })));
  const tonightPoints = new Map<string, number>([
    ...dailyStats.skaters.map((record) => [String(record.playerId), getSkaterScore(record)] as const),
    ...dailyStats.goalies.map((record) => [String(record.playerId), getGoalieScore(record)] as const),
  ]);
  const teamMap = new Map(teams.map((team) => [team.id, team]));
  const fantasyPlayers = new Map(roster.filter((row) => row.player?.player_api_id).map((row) => {
    const teamId = historicalTeamId(row, transactions, date);
    return [row.player!.player_api_id, { row, team: teamId ? teamMap.get(teamId) || null : null }] as const;
  }));
  const playerForGame = (data: PlayByPlay | null, playerId?: number, fallbackHeadshot?: string): GoalFeedPlayer | null => {
    if (!playerId) return null;
    const nhl = (data?.rosterSpots ?? []).find((candidate) => candidate.playerId === playerId);
    const fantasy = fantasyPlayers.get(String(playerId));
    const name = [nhl?.firstName?.default, nhl?.lastName?.default].filter(Boolean).join(" ") || fantasy?.row.player?.full_name || "Unknown player";
    const prospectRight = getProspectRight(eligibleProspectRights, playerId, name);
    const rosterPosition = (fantasy?.row.position || "").toUpperCase();
    const isRosterProspect = ["PROSPECT", "AP"].includes(rosterPosition);
    return { playerId: String(playerId), name, headshot: nhl?.headshot || fallbackHeadshot, fantasyTeam: fantasy?.team || prospectRight?.team || null, prospect: Boolean(prospectRight) && (isRosterProspect || !fantasy), tonightPoints: tonightPoints.get(String(playerId)) ?? null };
  };
  const events = playByPlay.flatMap(({ game, data }) => {
    if (!data) return [];
    const player = (playerId?: number) => playerForGame(data, playerId);
    return (data.plays ?? []).filter((play) => play.typeDescKey === "goal" && play.details?.scoringPlayerId).map((play) => {
      const details = play.details!;
      const scoringIsHome = details.eventOwnerTeamId === game.homeTeam?.id;
      const scorer = player(details.scoringPlayerId)!;
      const assists = [player(details.assist1PlayerId), player(details.assist2PlayerId)].filter((value): value is GoalFeedPlayer => Boolean(value));
      const period = play.periodDescriptor?.number || 0;
      const [minutes, seconds] = (play.timeInPeriod || "00:00").split(":").map(Number);
      return {
        key: `${game.id}:${play.eventId}`, gameId: game.id, gameState: game.gameState, startTimeUTC: game.startTimeUTC,
        nhlTeam: { abbreviation: (scoringIsHome ? game.homeTeam?.abbrev : game.awayTeam?.abbrev) || "NHL", logo: scoringIsHome ? game.homeTeam?.logo : game.awayTeam?.logo },
        awayTeam: { abbreviation: game.awayTeam?.abbrev || "AWAY", score: details.awayScore ?? game.awayTeam?.score ?? 0, logo: game.awayTeam?.logo },
        homeTeam: { abbreviation: game.homeTeam?.abbrev || "HOME", score: details.homeScore ?? game.homeTeam?.score ?? 0, logo: game.homeTeam?.logo },
        scorer, assists, period, periodType: play.periodDescriptor?.periodType || "REG", timeInPeriod: play.timeInPeriod || "00:00",
        strength: strengthLabel(details.situationCode, scoringIsHome), shotType: details.shotType,
        sortValue: estimatedGoalTime(game.startTimeUTC, period, play.periodDescriptor?.periodType || "REG", minutes, seconds, play.sortOrder || 0),
      } satisfies GoalFeedEvent;
    });
  }).sort((a, b) => b.sortValue - a.sortValue);
  const goalieEvents = playByPlay.flatMap(({ game, data, boxscore }) => {
    if (!["OFF", "FINAL"].includes(game.gameState) || !boxscore) return [];
    const winnerIsHome = (game.homeTeam?.score ?? 0) > (game.awayTeam?.score ?? 0);
    const goalies = winnerIsHome ? boxscore.playerByGameStats?.homeTeam?.goalies : boxscore.playerByGameStats?.awayTeam?.goalies;
    const winner = goalies?.find((goalie) => goalie.decision === "W");
    const goalie = playerForGame(data, winner?.playerId, winner?.headshot);
    if (!winner || !goalie) return [];
    const saves = winner.saves || 0;
    const shutout = (winner.goalsAgainst || 0) === 0;
    const latestPlay = Math.max(0, ...(data?.plays ?? []).map((play) => estimatedGoalTime(game.startTimeUTC, play.periodDescriptor?.number || 0, play.periodDescriptor?.periodType || "REG", ...((play.timeInPeriod || "00:00").split(":").map(Number) as [number, number]), play.sortOrder || 0)));
    return [{
      key: `${game.id}:goalie-win:${winner.playerId}`, gameId: game.id, gameState: game.gameState, goalie, saves, shutout,
      nhlTeam: { abbreviation: (winnerIsHome ? game.homeTeam?.abbrev : game.awayTeam?.abbrev) || "NHL", logo: winnerIsHome ? game.homeTeam?.logo : game.awayTeam?.logo },
      awayTeam: { abbreviation: game.awayTeam?.abbrev || "AWAY", score: game.awayTeam?.score || 0, logo: game.awayTeam?.logo },
      homeTeam: { abbreviation: game.homeTeam?.abbrev || "HOME", score: game.homeTeam?.score || 0, logo: game.homeTeam?.logo },
      sortValue: latestPlay + 1,
    } satisfies GoalieFeedEvent];
  });
  let recordEvents: RecordMovementEvent[] = [];
  try {
    const recordBook = await fetchDatedRecordBook(date);
    const feedPlayers = new Map<string, GoalFeedPlayer>();
    const metricSortValues = new Map<string, number>();
    const noteMetric = (player: GoalFeedPlayer, abbreviation: RecordMovement["abbreviation"], sortValue: number) => {
      feedPlayers.set(player.playerId, player);
      const key = `${player.playerId}:${abbreviation}`;
      metricSortValues.set(key, Math.max(metricSortValues.get(key) || 0, sortValue));
    };
    events.forEach((event) => {
      noteMetric(event.scorer, "G", event.sortValue);
      noteMetric(event.scorer, "P", event.sortValue);
      noteMetric(event.scorer, "GWG", event.sortValue);
      event.assists.forEach((player) => {
        noteMetric(player, "A", event.sortValue);
        noteMetric(player, "P", event.sortValue);
      });
    });
    goalieEvents.forEach((event) => {
      noteMetric(event.goalie, "W", event.sortValue);
      noteMetric(event.goalie, "SO", event.sortValue);
    });
    recordEvents = buildRecordMovements(
      recordBook.franchiseStatLines,
      dailyStats.skaters as unknown as Record<string, unknown>[],
      dailyStats.goalies as unknown as Record<string, unknown>[],
      feedPlayers,
      metricSortValues,
      new Map([...fantasyPlayers].map(([playerId, value]) => [playerId, value.team?.id || null])),
    );
  } catch {
    // Record movement is an enhancement; live scoring should remain available
    // if the historical record book cannot be loaded.
  }
  const skaterScores = new Map(seasonStats?.skaters.map((record) => [String(record.playerId), getSkaterScore(record)]) ?? []);
  const goalieScores = new Map(seasonStats?.goalies.map((record) => [String(record.playerId), getGoalieScore(record)]) ?? []);
  const dailySkaterScores = new Map(dailyStats.skaters.map((record) => [String(record.playerId), getSkaterScore(record)]));
  const dailyGoalieScores = new Map(dailyStats.goalies.map((record) => [String(record.playerId), getGoalieScore(record)]));
  const baselineSkaterScores = new Map([...skaterScores].map(([playerId, score]) => [playerId, score - (dailySkaterScores.get(playerId) || 0)]));
  const baselineGoalieScores = new Map([...goalieScores].map(([playerId, score]) => [playerId, score - (dailyGoalieScores.get(playerId) || 0)]));
  const slotCounts: Record<string, number> = { C: 3, LW: 3, RW: 3, D: 6, G: 2 };
  const rankTeams = (skaters: Map<string, number>, goalies: Map<string, number>) => teams.filter((team) => team.active).map((team) => {
    const players = roster.filter((row) => row.fantasy_team_id === team.id);
    const points = Object.entries(slotCounts).reduce((total, [position, count]) => {
      const source = position === "G" ? goalies : skaters;
      const scores = players.filter((row) => (row.position || "").toUpperCase() === position).map((row) => source.get(row.player?.player_api_id || "") || 0).sort((a, b) => b - a).slice(0, count);
      return total + scores.reduce((sum, score) => sum + score, 0);
    }, 0);
    return { team, rank: 0, points };
  }).sort((a, b) => b.points - a.points || a.team.id - b.team.id).map((row, index) => ({ ...row, rank: index + 1 }));
  const standings = seasonStats ? rankTeams(skaterScores, goalieScores) : [];
  const baselineStandings = seasonStats ? rankTeams(baselineSkaterScores, baselineGoalieScores) : [];
  return { events, goalieEvents, recordEvents, standings, baselineStandings, games: games.length, live: games.some((game) => ["LIVE", "CRIT"].includes(game.gameState)), teams };
}
