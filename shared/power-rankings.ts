import type { NhlGoalieRecord, NhlSkaterRecord } from "../src/lib/nhl";
import { getGoalieScore, getSkaterScore } from "./nhl-scoring.ts";

export type RankingTeam = { id: number; team_name: string; abbreviation: string; logo: string | null; primary_color?: string | null; secondary_color?: string | null };
export type RankingRosterRow = {
  id: number;
  player_id: number;
  fantasy_team_id: number | null;
  position: string | null;
  salary: number | null;
  term_end_year: number | null;
  contract_group: string | null;
  player: { player_api_id: string; full_name: string | null; first_name: string | null; last_name: string | null } | null;
};
export type RankingTrade = {
  transaction_date: string;
  trade_offer: {
    trade_offer_players: Array<{from_team_id: number; player_season: {player_id: number} | null}>;
  } | null;
};

export type Position = "C" | "LW" | "RW" | "D" | "G";
export type PeriodMode = "period" | "month" | "season";
export type PlayerRanking = { season: RankingRosterRow; team: RankingTeam; position: Position; nhlTeam: string; birthDate?: string; gamesPlayed: number; goals: number; assists: number; nhlPoints: number; wins: number; saves: number; savePct: number | null; goalsAgainstAverage: number | null; points: number; rank: number; movement: number | null };
export type TeamRanking = { team: RankingTeam; gamesPlayed: number; points: number; rank: number; movement: number | null; units: Record<Position, { gamesPlayed: number; points: number }> };
export type GoalieTandem = { team: RankingTeam; goalies: PlayerRanking[]; gamesPlayed: number; wins: number; saves: number; goalsAgainst: number; points: number };

export const positions: Position[] = ["C", "LW", "RW", "D", "G"];
const scoringLimits: Record<Position, number> = { C: 3, LW: 3, RW: 3, D: 6, G: 2 };
function normalizePosition(value?: string | null): Position | null {
  const code = (value || "").toUpperCase();
  if (code === "L") return "LW";
  if (code === "R") return "RW";
  return positions.includes(code as Position) ? code as Position : null;
}
export function indexTradeHistory(trades: RankingTrade[]) {
  const history = new Map<number, Array<{ date: string; fromTeamId: number }>>();
  // The query returns newest first. Rewind those trades to reconstruct ownership.
  for (const trade of trades) {
    const seenPlayers = new Set<number>();
    for (const move of trade.trade_offer?.trade_offer_players ?? []) {
      const playerId = move.player_season?.player_id;
      if (playerId == null || seenPlayers.has(playerId)) continue;
      seenPlayers.add(playerId);
      const entry = { date: trade.transaction_date, fromTeamId: move.from_team_id };
      const playerHistory = history.get(playerId);
      if (playerHistory) playerHistory.push(entry);
      else history.set(playerId, [entry]);
    }
  }
  return history;
}
function scoreForPlayer(row: RankingRosterRow, skaters: Map<string, NhlSkaterRecord>, goalies: Map<string, NhlGoalieRecord>) {
  const id = row.player?.player_api_id || "";
  const goalie = goalies.get(id);
  const skater = skaters.get(id);
  return goalie
    ? { teamAbbrevs: goalie.teamAbbrevs, birthDate: goalie.birthDate, gamesPlayed: goalie.gamesPlayed, goals: goalie.goals, assists: goalie.assists, nhlPoints: goalie.goals + goalie.assists, wins: goalie.wins, saves: goalie.saves, savePct: goalie.savePct, goalsAgainstAverage: goalie.goalsAgainstAverage, points: getGoalieScore(goalie) }
    : skater
      ? { teamAbbrevs: skater.teamAbbrevs, birthDate: skater.birthDate, gamesPlayed: skater.gamesPlayed, goals: skater.goals, assists: skater.assists, nhlPoints: skater.goals + skater.assists, wins: 0, saves: 0, savePct: null, goalsAgainstAverage: null, points: getSkaterScore(skater) }
      : { teamAbbrevs: "", birthDate: undefined, gamesPlayed: 0, goals: 0, assists: 0, nhlPoints: 0, wins: 0, saves: 0, savePct: null, goalsAgainstAverage: null, points: 0 };
}

export function buildRankings({
  currentSkaters, currentGoalies, previousSkaters, previousGoalies,
  teams, playerSeasons, tradeHistory, mode, rankingEndDate, previousRankingEndDate,
}: {
  currentSkaters: NhlSkaterRecord[];
  currentGoalies: NhlGoalieRecord[];
  previousSkaters: NhlSkaterRecord[];
  previousGoalies: NhlGoalieRecord[];
  teams: RankingTeam[];
  playerSeasons: RankingRosterRow[];
  tradeHistory: ReturnType<typeof indexTradeHistory>;
  mode: PeriodMode;
  rankingEndDate: string;
  previousRankingEndDate: string;
}) {
  const currentSkaterMap = new Map(currentSkaters.map((row) => [String(row.playerId), row]));
  const currentGoalieMap = new Map(currentGoalies.map((row) => [String(row.playerId), row]));
  const previousSkaterMap = new Map(previousSkaters.map((row) => [String(row.playerId), row]));
  const previousGoalieMap = new Map(previousGoalies.map((row) => [String(row.playerId), row]));
  const teamMap = new Map(teams.map((team) => [team.id, team]));
  const rosterAt = (asOfDate: string) => playerSeasons
    .map((row) => {
      let teamId = row.fantasy_team_id;
      for (const move of tradeHistory.get(row.player_id) ?? []) {
        if (move.date <= asOfDate) break;
        teamId = move.fromTeamId;
      }
      return { ...row, fantasy_team_id: teamId };
    })
    .filter((row) => Boolean(row.fantasy_team_id && row.player?.player_api_id && normalizePosition(row.position)));
  const eligible = rosterAt(rankingEndDate);
  const previousEligible = rosterAt(previousRankingEndDate);
  const previousRanks = new Map<number, number>();
  positions.forEach((pos) => eligible.filter((row) => normalizePosition(row.position) === pos).map((row) => ({ row, ...scoreForPlayer(row, previousSkaterMap, previousGoalieMap) })).filter((item) => item.gamesPlayed > 0).sort((a, b) => b.points - a.points).forEach((item, index) => previousRanks.set(item.row.id, index + 1)));
  const players: PlayerRanking[] = [];
  positions.forEach((pos) => {
    const positional = eligible.filter((row) => normalizePosition(row.position) === pos).map((row) => ({ row, team: teamMap.get(row.fantasy_team_id!), ...scoreForPlayer(row, currentSkaterMap, currentGoalieMap) })).filter((item): item is typeof item & { team: RankingTeam } => Boolean(item.team)).sort((a, b) => Number(b.gamesPlayed > 0) - Number(a.gamesPlayed > 0) || b.points - a.points || b.gamesPlayed - a.gamesPlayed);
    let playedRank = 0;
    positional.forEach((item) => { const rank = item.gamesPlayed > 0 ? ++playedRank : 0; const prior = previousRanks.get(item.row.id); players.push({ season: item.row, team: item.team, position: pos, nhlTeam: item.teamAbbrevs, birthDate: item.birthDate, gamesPlayed: item.gamesPlayed, goals: item.goals, assists: item.assists, nhlPoints: item.nhlPoints, wins: item.wins, saves: item.saves, savePct: item.savePct, goalsAgainstAverage: item.goalsAgainstAverage, points: item.points, rank, movement: mode === "season" ? 0 : prior && rank ? prior - rank : null }); });
  });
  const emptyUnits = () => Object.fromEntries(positions.map((pos) => [pos, { gamesPlayed: 0, points: 0 }])) as TeamRanking["units"];
  const scoringLineup = (roster: RankingRosterRow[], teamId: number, skaterMap: Map<string, NhlSkaterRecord>, goalieMap: Map<string, NhlGoalieRecord>) => positions.flatMap((pos) => roster
    .filter((row) => row.fantasy_team_id === teamId && normalizePosition(row.position) === pos)
    .map((row) => ({ row, pos, score: scoreForPlayer(row, skaterMap, goalieMap) }))
    .sort((a, b) => b.score.points - a.score.points || b.score.gamesPlayed - a.score.gamesPlayed)
    .slice(0, scoringLimits[pos]));
  const currentTeams = teams.map((team) => {
    const units = emptyUnits();
    scoringLineup(eligible, team.id, currentSkaterMap, currentGoalieMap).forEach(({ pos, score }) => { units[pos].gamesPlayed += score.gamesPlayed; units[pos].points += score.points; });
    return { team, units, gamesPlayed: positions.reduce((sum, pos) => sum + units[pos].gamesPlayed, 0), points: positions.reduce((sum, pos) => sum + units[pos].points, 0) };
  }).sort((a, b) => b.points - a.points);
  const previousTeamRanks = new Map<number, number>();
  teams.map((team) => ({ team, points: scoringLineup(previousEligible, team.id, previousSkaterMap, previousGoalieMap).reduce((sum, item) => sum + item.score.points, 0) })).sort((a, b) => b.points - a.points).forEach((row, index) => previousTeamRanks.set(row.team.id, index + 1));
  const rankedTeams: TeamRanking[] = currentTeams.map((row, index) => ({ ...row, rank: index + 1, movement: mode === "season" ? 0 : (previousTeamRanks.get(row.team.id) || 0) - (index + 1) }));
  const goalieTandems = teams.map((team) => {
    const goalies = players.filter((row) => row.team.id === team.id && row.position === "G" && row.gamesPlayed > 0).sort((a, b) => b.points - a.points).slice(0, scoringLimits.G);
    const source = goalies.map((row) => currentGoalieMap.get(row.season.player?.player_api_id || "")).filter(Boolean) as NhlGoalieRecord[];
    return { team, goalies, gamesPlayed: source.reduce((sum, row) => sum + row.gamesPlayed, 0), wins: source.reduce((sum, row) => sum + row.wins, 0), saves: source.reduce((sum, row) => sum + row.saves, 0), goalsAgainst: source.reduce((sum, row) => sum + row.goalsAgainst, 0), points: goalies.reduce((sum, row) => sum + row.points, 0) };
  }).filter((row) => row.goalies.length >= 2).sort((a, b) => b.points - a.points);
  return { playerRankings: players, teamRankings: rankedTeams, goalieTandems };
}
export type RankingResults = ReturnType<typeof buildRankings>;
