import { fetchPlayerSeasonsBySeason, type PlayerSeasonWithRelations } from "./fantasyPlayers";
import { fetchFantasyTeams, type FantasyTeam } from "./fantasyTeams";
import { fetchLeagueTransactions, type LeagueTransaction } from "./transactions";
import { fetchProspectRights, getProspectRight } from "./prospectRights";

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

export type GoalFeedPlayer = {
  playerId: string;
  name: string;
  headshot?: string;
  fantasyTeam: FantasyTeam | null;
  prospect: boolean;
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

export async function fetchGoalFeed(date: string): Promise<{ events: GoalFeedEvent[]; games: number; live: boolean; teams: FantasyTeam[] }> {
  const season = seasonForDate(date);
  const [scoreResponse, roster, teams, transactions, prospectRights] = await Promise.all([
    fetch(`/nhl-web-api/score/${date}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(`Unable to load NHL games (${response.status})`);
      return response.json() as Promise<ScoreResponse>;
    }),
    fetchPlayerSeasonsBySeason(season),
    fetchFantasyTeams(true),
    fetchLeagueTransactions(),
    fetchProspectRights(season),
  ]);
  const games = scoreResponse.games ?? [];
  const playByPlay = await Promise.all(games.map(async (game) => {
    const response = await fetch(`/nhl-web-api/gamecenter/${game.id}/play-by-play`, { cache: "no-store" });
    if (!response.ok) return { game, data: null };
    return { game, data: await response.json() as PlayByPlay };
  }));
  const teamMap = new Map(teams.map((team) => [team.id, team]));
  const fantasyPlayers = new Map(roster.filter((row) => row.player?.player_api_id).map((row) => {
    const teamId = historicalTeamId(row, transactions, date);
    return [row.player!.player_api_id, { row, team: teamId ? teamMap.get(teamId) || null : null }] as const;
  }));
  const events = playByPlay.flatMap(({ game, data }) => {
    if (!data) return [];
    const nhlPlayers = new Map((data.rosterSpots ?? []).map((player) => [player.playerId, player]));
    const player = (playerId?: number): GoalFeedPlayer | null => {
      if (!playerId) return null;
      const nhl = nhlPlayers.get(playerId);
      const fantasy = fantasyPlayers.get(String(playerId));
      const name = [nhl?.firstName?.default, nhl?.lastName?.default].filter(Boolean).join(" ") || fantasy?.row.player?.full_name || "Unknown player";
      const prospectRight = getProspectRight(prospectRights, playerId, name);
      const rosterPosition = (fantasy?.row.position || "").toUpperCase();
      const isRosterProspect = ["PROSPECT", "AP"].includes(rosterPosition);
      return { playerId: String(playerId), name, headshot: nhl?.headshot, fantasyTeam: fantasy?.team || prospectRight?.team || null, prospect: isRosterProspect || (!fantasy && Boolean(prospectRight)) };
    };
    return (data.plays ?? []).filter((play) => play.typeDescKey === "goal" && play.details?.scoringPlayerId).map((play) => {
      const details = play.details!;
      const scoringIsHome = details.eventOwnerTeamId === game.homeTeam?.id;
      const scorer = player(details.scoringPlayerId)!;
      const assists = [player(details.assist1PlayerId), player(details.assist2PlayerId)].filter((value): value is GoalFeedPlayer => Boolean(value));
      const period = play.periodDescriptor?.number || 0;
      const [minutes, seconds] = (play.timeInPeriod || "00:00").split(":").map(Number);
      const start = game.startTimeUTC ? new Date(game.startTimeUTC).getTime() : 0;
      return {
        key: `${game.id}:${play.eventId}`, gameId: game.id, gameState: game.gameState, startTimeUTC: game.startTimeUTC,
        nhlTeam: { abbreviation: (scoringIsHome ? game.homeTeam?.abbrev : game.awayTeam?.abbrev) || "NHL", logo: scoringIsHome ? game.homeTeam?.logo : game.awayTeam?.logo },
        awayTeam: { abbreviation: game.awayTeam?.abbrev || "AWAY", score: details.awayScore ?? game.awayTeam?.score ?? 0, logo: game.awayTeam?.logo },
        homeTeam: { abbreviation: game.homeTeam?.abbrev || "HOME", score: details.homeScore ?? game.homeTeam?.score ?? 0, logo: game.homeTeam?.logo },
        scorer, assists, period, periodType: play.periodDescriptor?.periodType || "REG", timeInPeriod: play.timeInPeriod || "00:00",
        strength: strengthLabel(details.situationCode, scoringIsHome), shotType: details.shotType,
        sortValue: start + period * 1_000_000 + (minutes * 60 + seconds) * 1_000 + (play.sortOrder || 0),
      } satisfies GoalFeedEvent;
    });
  }).sort((a, b) => b.sortValue - a.sortValue);
  return { events, games: games.length, live: games.some((game) => ["LIVE", "CRIT"].includes(game.gameState)), teams };
}
