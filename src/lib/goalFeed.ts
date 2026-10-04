import { fetchPlayerSeasonsBySeason, type PlayerSeasonWithRelations } from "./fantasyPlayers";
import { fetchFantasyTeams, type FantasyTeam } from "./fantasyTeams";
import { fetchLeagueTransactions, type LeagueTransaction } from "./transactions";
import { fetchProspectRights, getProspectRight, removeAgedOutProspectRights } from "./prospectRights";
import { fetchNhlDailyStats, fetchNhlLiveSeasonStats, getGoalieScore, getNhlStatsDate, getSkaterScore } from "./nhl";

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

export async function fetchGoalFeed(date: string): Promise<{ events: GoalFeedEvent[]; goalieEvents: GoalieFeedEvent[]; standings: FeedStanding[]; baselineStandings: FeedStanding[]; games: number; live: boolean; teams: FantasyTeam[] }> {
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
  return { events, goalieEvents, standings, baselineStandings, games: games.length, live: games.some((game) => ["LIVE", "CRIT"].includes(game.gameState)), teams };
}
