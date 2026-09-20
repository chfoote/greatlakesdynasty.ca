import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import {
  type FantasyTeam,
  type FantasyTeamManagerTenure,
  type FantasyTeamFinish,
  type FantasyTeamBranding,
  applyTeamBranding,
  fetchFantasyTeamByAbbreviation,
  fetchTeamManagerTenures,
  fetchTeamFinishes,
  fetchTeamBrandingHistory,
  getManagerForSeason,
} from "../../lib/fantasyTeams";
import { fetchPlayerSeasonsByTeam, fetchPlayerSeasonsByTeamAndSeason, type PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import {
  fetchNhlGoalieStats,
  fetchNhlSkaterStats,
  formatFantasyPoints,
  formatNhlStat,
  getGoalieScore,
  getSkaterScore,
  type NhlGoalieRecord,
  type NhlSkaterRecord,
} from "../../lib/nhl";
import { fetchAwards, fetchPlayerAwards, mapAwardsByPlayer, type Award, type PlayerAward } from "../../lib/awards";
import PlayerAwardBadges from "./PlayerAwardBadges";
import { CURRENT_LEAGUE_SEASON } from "../../lib/leagueSeasons";
import TeamIdentityCard from "./TeamIdentityCard";
import { fetchTradeBlockListings } from "../../lib/tradeMarket";
import TradeBlockBadge from "./TradeBlockBadge";
import PlayerInterestButton from "./PlayerInterestButton";
import { usePlayerTradeInterest } from "../../hooks/usePlayerTradeInterest";
import { fetchBuyoutPenalties, type BuyoutPenalty } from "../../lib/buyouts";

const ROSTER_LIMIT = 23;
const seasonOptions = Array.from({ length: 10 }, (_, index) => 2026 + index);
const activeSections = [
  { code: "C", label: "Centers", type: "skater" },
  { code: "LW", label: "Left Wings", type: "skater" },
  { code: "RW", label: "Right Wings", type: "skater" },
  { code: "D", label: "Defence", type: "skater" },
  { code: "G", label: "Goalies", type: "goalie" },
] as const;
const nonRosterSections = [
  { code: "RFA", label: "RFA Rights", cap: false },
  { code: "W", label: "Waivers", cap: true },
  { code: "IR", label: "Injured Reserve", cap: true },
  { code: "LTIR", label: "Long-Term Injured Reserve", cap: false },
  { code: "RETENTION", label: "Retention", cap: true },
] as const;
const activePositions = new Set(activeSections.map((section) => section.code));
const capPositions = new Set([...activePositions, "W", "IR", "RETENTION"]);
const prospectPositions = new Set(["PROSPECT", "AP"]);
const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

function nhlSeasonId(year: number) {
  return (year - 1) * 10000 + year;
}

function salaryCapForSeason(year: number) {
  return year <= 2026 ? 45_000_000 : 50_000_000;
}

function playerName(season: PlayerSeasonWithRelations) {
  return season.player?.full_name || [season.player?.first_name, season.player?.last_name].filter(Boolean).join(" ") || "Unknown Player";
}

function fantasyPlayerName(player: PlayerAward["player"]) {
  return player?.full_name || [player?.first_name, player?.last_name].filter(Boolean).join(" ") || "Unknown Player";
}

function playerApiId(season: PlayerSeasonWithRelations) {
  return season.player?.player_api_id || "";
}

function position(season: PlayerSeasonWithRelations) {
  return (season.position || "UNASSIGNED").toUpperCase();
}

function nhlSkaterPosition(code: string | undefined) {
  if (code === "L") return "LW";
  if (code === "R") return "RW";
  return code || "—";
}

function PlayerName({ season, nhlTeam, awards = [], onTradeBlock = false, interestAction }: { season: PlayerSeasonWithRelations; nhlTeam?: string; awards?: PlayerAward[]; onTradeBlock?: boolean; interestAction?: React.ReactNode }) {
  const isExpiring = season.term_end_year === season.season_year;
  const nhlTeamAbbreviation = nhlTeam?.split(",")[0]?.trim();
  return <div className="flex min-w-56 items-center gap-2 text-left">
    {interestAction}
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
      {nhlTeamAbbreviation ? <img src={`https://assets.nhle.com/logos/nhl/svg/${nhlTeamAbbreviation}_light.svg`} alt={`${nhlTeamAbbreviation} NHL club logo`} title={nhlTeamAbbreviation} className="h-full w-full object-contain p-0.5" /> : <span className="text-[10px] font-semibold text-gray-500">NHL</span>}
    </div>
    <div><p className="font-medium text-gray-800 dark:text-white/90">{season.player?.player_api_id ? <Link to={`/player-profile?playerId=${season.player.player_api_id}`} className="text-brand-500 hover:underline">{playerName(season)}</Link> : playerName(season)}<PlayerAwardBadges awards={awards} includeMonthly={false} />{onTradeBlock && <TradeBlockBadge className="ml-2 align-middle" />}</p>
      <p className={`mt-0.5 text-[11px] ${isExpiring ? "font-semibold text-orange-600 dark:text-orange-400" : "text-gray-500 dark:text-gray-400"}`}>
        {[nhlTeam || "—", money.format(season.salary || 0), season.term_end_year || "No term"].join(" | ")}
        {isExpiring && <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">Expiring</span>}
      </p>
    </div>
  </div>;
}

function PayrollCard({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className={`rounded-lg border p-4 ${danger ? "border-error-200 bg-error-50 dark:border-error-500/30 dark:bg-error-500/10" : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"}`}>
    <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">{label}</p>
    <p className={`mt-2 text-base font-semibold ${danger ? "text-error-700 dark:text-error-400" : "text-gray-800 dark:text-white/90"}`}>{value}</p>
  </div>;
}

function Medal({ icon, value, label, years, tone }: { icon: string; value: number; label: string; years: number[]; tone: "gold" | "silver" | "bronze" }) {
  const styles = {
    gold: "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-300",
    silver: "border-gray-300 bg-gray-100 text-gray-800 dark:border-gray-600 dark:bg-gray-500/10 dark:text-gray-200",
    bronze: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
  };
  return <div className={`rounded-lg border p-4 text-center ${styles[tone]}`}>
    <span className="text-2xl" aria-label={label}>{icon}</span>
    <p className="mt-1 text-lg font-semibold">{value}</p>
    <p className="mt-1 min-h-4 text-xs font-medium opacity-80">{years.length ? years.join(", ") : "—"}</p>
  </div>;
}

const featuredAwardOrder = ["Championship", "MVP", "Rookie of the Year", "Top C", "Top LW", "Top RW", "Top D"];
const honourMonths = ["October", "November", "December", "January", "February", "March", "April"];

function normalizedAwardName(name: string) {
  return name.trim().toLowerCase();
}

function TrophyImage({ award, name }: { award?: Award | null; name: string }) {
  return award?.image_url ? (
    <img src={award.image_url} alt={`${name} trophy`} className="h-20 w-20 object-contain drop-shadow-sm" />
  ) : (
    <span className="text-6xl" role="img" aria-label={`${name} trophy`}>🏆</span>
  );
}

function TrophyCase({
  team,
  finishes,
  playerAwards,
  teamSeasons,
  awards,
}: {
  team: FantasyTeam;
  finishes: FantasyTeamFinish[];
  playerAwards: PlayerAward[];
  teamSeasons: PlayerSeasonWithRelations[];
  awards: Award[];
}) {
  const [view, setView] = useState<"seasonal" | "monthly">("seasonal");
  const championshipAward = awards.find((award) => normalizedAwardName(award.name) === "championship");
  const playerSeasonKeys = new Set(teamSeasons.map((season) => `${season.player_id}:${season.season_year}`));
  const seasonalPlayerTrophies = playerAwards
    .filter((assignment) => !assignment.is_monthly)
    .filter((assignment) => assignment.award && normalizedAwardName(assignment.award.name) !== "championship")
    .filter((assignment) => playerSeasonKeys.has(`${assignment.player_id}:${assignment.season_year}`));
  const monthlyPlayerTrophies = playerAwards
    .filter((assignment) => assignment.is_monthly && assignment.fantasy_team_id === team.id);
  const seasonalTrophies = [
    ...finishes
      .filter((finish) => finish.placement === 1)
      .map((finish) => ({
        key: `championship-${finish.id}`,
        name: "Championship",
        year: finish.season_year,
        award: championshipAward,
        player: null as PlayerAward["player"],
        monthIndex: undefined as number | undefined,
      })),
    ...seasonalPlayerTrophies.map((assignment) => ({
      key: `player-award-${assignment.id}`,
      name: assignment.award?.name || "Award",
      year: assignment.season_year,
      award: assignment.award,
      player: assignment.player,
      monthIndex: undefined as number | undefined,
    })),
  ].sort((a, b) => {
    const order = (name: string) => {
      const index = featuredAwardOrder.findIndex((featuredName) => normalizedAwardName(featuredName) === normalizedAwardName(name));
      return index === -1 ? featuredAwardOrder.length : index;
    };
    return order(a.name) - order(b.name) || b.year - a.year;
  });
  const monthlyTrophies = monthlyPlayerTrophies.map((assignment) => ({ key: `monthly-honour-${assignment.id}`, name: assignment.award?.name || "Monthly Honour", year: assignment.season_year, award: assignment.award, player: assignment.player, monthIndex: assignment.month_index })).sort((a, b) => b.year - a.year || (b.monthIndex ?? -1) - (a.monthIndex ?? -1));
  const trophies = view === "seasonal" ? seasonalTrophies : monthlyTrophies;

  return <section id="trophy-case" className="mt-6 scroll-mt-24 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 dark:border-amber-500/30 dark:from-amber-500/10 dark:to-transparent sm:p-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300">Club honours</p>
      <h3 className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">Trophy Case</h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Championships and individual awards won while representing the {team.team_name}.</p>
      </div>
      <div className="inline-flex shrink-0 rounded-lg border border-amber-300/70 bg-white/70 p-1 dark:border-amber-500/30 dark:bg-gray-900/60"><button type="button" onClick={() => setView("seasonal")} className={`rounded-md px-3 py-1.5 text-xs font-bold ${view === "seasonal" ? "bg-amber-500 text-white" : "text-gray-500"}`}>Seasonal Awards</button><button type="button" onClick={() => setView("monthly")} className={`rounded-md px-3 py-1.5 text-xs font-bold ${view === "monthly" ? "bg-amber-500 text-white" : "text-gray-500"}`}>Monthly Honours</button></div>
    </div>
    {trophies.length ? <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {trophies.map((trophy) => {
        const apiId = trophy.player?.player_api_id;
        const winnerName = trophy.player ? fantasyPlayerName(trophy.player) : team.team_name;
        return <article key={trophy.key} className="flex min-h-36 items-center gap-4 rounded-xl border border-amber-200 bg-white/90 p-4 shadow-sm dark:border-amber-500/20 dark:bg-gray-900/80">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-500/10"><TrophyImage award={trophy.award} name={trophy.name} /></div>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">{trophy.monthIndex !== undefined ? `${honourMonths[trophy.monthIndex]} · ` : ""}{trophy.year}</p>
            <h4 className="mt-1 text-base font-bold text-gray-900 dark:text-white">{trophy.name}</h4>
            {apiId ? <Link to={`/player-profile?playerId=${apiId}`} className="mt-1 block truncate text-sm font-medium text-brand-500 hover:underline">{winnerName}</Link> : <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{winnerName}</p>}
          </div>
        </article>;
      })}
    </div> : <p className="mt-5 rounded-lg border border-dashed border-amber-300 p-5 text-center text-sm text-gray-500 dark:border-amber-500/30 dark:text-gray-400">{view === "monthly" ? "No monthly honours have been recorded for this team yet." : "No seasonal trophies have been recorded for this team yet."}</p>}
  </section>;
}

function SkaterTable({ code, label, players, stats, awardsByPlayer, tradeBlockIds, renderInterest }: { code: string; label: string; players: PlayerSeasonWithRelations[]; stats: Map<string, NhlSkaterRecord>; awardsByPlayer: Map<number, PlayerAward[]>; tradeBlockIds: Set<number>; renderInterest: (season: PlayerSeasonWithRelations) => React.ReactNode }) {
  const rows = [...players].sort((a, b) => getSkaterScore(stats.get(playerApiId(b)) || emptySkater) - getSkaterScore(stats.get(playerApiId(a)) || emptySkater));
  return <RosterSection code={code} label={label} count={players.length}>
    <table className="min-w-full divide-y divide-gray-100 text-xs dark:divide-gray-800">
      <thead><tr className="text-center font-semibold uppercase text-gray-500 dark:text-gray-400">
        {['Player','Pos','G','A','+/-','PIMs','PPG','PPA','SHG','SHA','GWG','S','B','H','FOW','Score','PPG'].map((heading, index) => <th key={`${heading}-${index}`} className={`whitespace-nowrap px-2 py-2 ${index === 0 ? "text-left" : ""}`}>{heading}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {rows.length === 0 ? <EmptyRow columns={17} /> : rows.map((season) => {
          const record = stats.get(playerApiId(season));
          const score = record ? getSkaterScore(record) : 0;
          const values = record ? [record.goals, record.assists, record.plusMinus, record.penaltyMinutes, record.ppGoals, record.ppPoints-record.ppGoals, record.shGoals, record.shPoints-record.shGoals, record.gameWinningGoals, record.shots, record.blockedShots, record.hits, record.totalFaceoffWins] : Array(13).fill(null);
          return <tr key={season.id} className="text-center text-gray-600 dark:text-gray-300">
            <td className="px-2 py-2"><PlayerName season={season} nhlTeam={record?.teamAbbrevs} awards={season.player?.id ? awardsByPlayer.get(season.player.id) || [] : []} onTradeBlock={tradeBlockIds.has(season.id)} interestAction={renderInterest(season)} /></td>
            <td className="px-2 py-2">{nhlSkaterPosition(record?.positionCode)}</td>
            {values.map((value, index) => <td key={index} className="px-2 py-2">{formatNhlStat(value)}</td>)}
            <td className="px-2 py-2 font-semibold text-gray-800 dark:text-white/90">{formatFantasyPoints(score)}</td>
            <td className="px-2 py-2">{record?.gamesPlayed ? formatFantasyPoints(score / record.gamesPlayed) : "—"}</td>
          </tr>;
        })}
      </tbody>
    </table>
  </RosterSection>;
}

function GoalieTable({ players, stats, awardsByPlayer, tradeBlockIds, renderInterest }: { players: PlayerSeasonWithRelations[]; stats: Map<string, NhlGoalieRecord>; awardsByPlayer: Map<number, PlayerAward[]>; tradeBlockIds: Set<number>; renderInterest: (season: PlayerSeasonWithRelations) => React.ReactNode }) {
  const rows = [...players].sort((a, b) => getGoalieScore(stats.get(playerApiId(b)) || emptyGoalie) - getGoalieScore(stats.get(playerApiId(a)) || emptyGoalie));
  return <RosterSection code="G" label="Goalies" count={players.length}>
    <table className="min-w-full divide-y divide-gray-100 text-xs dark:divide-gray-800">
      <thead><tr className="text-center font-semibold uppercase text-gray-500 dark:text-gray-400">
        {['Player','Pos','GP','GS','W','L','OTL','GA','SV','SO','PIMs','G','A','SV%','GAA','Score','PPG'].map((heading, index) => <th key={heading} className={`whitespace-nowrap px-2 py-2 ${index === 0 ? "text-left" : ""}`}>{heading}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {rows.length === 0 ? <EmptyRow columns={17} /> : rows.map((season) => {
          const record = stats.get(playerApiId(season));
          const score = record ? getGoalieScore(record) : 0;
          const values = record ? [record.gamesPlayed,record.gamesStarted,record.wins,record.losses,record.otLosses,record.goalsAgainst,record.saves,record.shutouts,record.penaltyMinutes,record.goals,record.assists] : Array(11).fill(null);
          return <tr key={season.id} className="text-center text-gray-600 dark:text-gray-300">
            <td className="px-2 py-2"><PlayerName season={season} nhlTeam={record?.teamAbbrevs} awards={season.player?.id ? awardsByPlayer.get(season.player.id) || [] : []} onTradeBlock={tradeBlockIds.has(season.id)} interestAction={renderInterest(season)} /></td>
            <td className="px-2 py-2">G</td>
            {values.map((value, index) => <td key={index} className="px-2 py-2">{formatNhlStat(value)}</td>)}
            <td className="px-2 py-2">{record?.savePct == null ? "—" : record.savePct.toFixed(3)}</td>
            <td className="px-2 py-2">{formatNhlStat(record?.goalsAgainstAverage, 2)}</td>
            <td className="px-2 py-2 font-semibold text-gray-800 dark:text-white/90">{formatFantasyPoints(score)}</td>
            <td className="px-2 py-2">{record?.gamesPlayed ? formatFantasyPoints(score / record.gamesPlayed) : "—"}</td>
          </tr>;
        })}
      </tbody>
    </table>
  </RosterSection>;
}

function CompactTable({ code, label, players, skaters, goalies, note, awardsByPlayer, tradeBlockIds, renderInterest }: { code: string; label: string; players: PlayerSeasonWithRelations[]; skaters: Map<string, NhlSkaterRecord>; goalies: Map<string, NhlGoalieRecord>; note: string; awardsByPlayer: Map<number, PlayerAward[]>; tradeBlockIds: Set<number>; renderInterest: (season: PlayerSeasonWithRelations) => React.ReactNode }) {
  return <RosterSection code={code} label={label} count={players.length} note={note}>
    <table className="min-w-full divide-y divide-gray-100 text-xs dark:divide-gray-800">
      <thead><tr className="text-left font-semibold uppercase text-gray-500 dark:text-gray-400">
        {['Name','Team','Pos','Salary','Term'].map((heading) => <th key={heading} className="px-2 py-2">{heading}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {players.length === 0 ? <EmptyRow columns={5} /> : players.map((season) => {
          const skater = skaters.get(playerApiId(season));
          const goalie = goalies.get(playerApiId(season));
          const apiPosition = goalie ? "G" : nhlSkaterPosition(skater?.positionCode);
          return <tr key={season.id} className="text-gray-600 dark:text-gray-300">
            <td className="px-2 py-2"><PlayerName season={season} nhlTeam={skater?.teamAbbrevs || goalie?.teamAbbrevs} awards={season.player?.id ? awardsByPlayer.get(season.player.id) || [] : []} onTradeBlock={tradeBlockIds.has(season.id)} interestAction={renderInterest(season)} /></td>
            <td className="px-2 py-2">{skater?.teamAbbrevs || goalie?.teamAbbrevs || "—"}</td>
            <td className="px-2 py-2">{apiPosition || "—"}</td>
            <td className="px-2 py-2">{season.salary == null ? "—" : money.format(season.salary)}</td>
            <td className={`px-2 py-2 ${season.term_end_year === season.season_year ? "font-semibold text-orange-600 dark:text-orange-400" : ""}`}>
              {season.term_end_year || "—"}
              {season.term_end_year === season.season_year && <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">Expiring</span>}
            </td>
          </tr>;
        })}
      </tbody>
    </table>
  </RosterSection>;
}

function RosterSection({ code, label, count, note, children }: { code: string; label: string; count: number; note?: string; children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
    <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-white/[0.03]">
      <h4 className="text-sm font-semibold text-gray-800 dark:text-white/90">{code} <span className="font-normal text-gray-500">({label})</span></h4>
      <span className="text-xs text-gray-500 dark:text-gray-400">{note || `${count} players`}</span>
    </div>
    <div className="overflow-x-auto">{children}</div>
  </section>;
}

function EmptyRow({ columns }: { columns: number }) {
  return <tr><td colSpan={columns} className="px-3 py-4 text-center text-gray-500 dark:text-gray-400">No players.</td></tr>;
}

function MultiYearView({
  years,
  rosters,
  skaters,
  goalies,
  awardsByPlayer,
}: {
  years: number[];
  rosters: Record<number, PlayerSeasonWithRelations[]>;
  skaters: Map<string, NhlSkaterRecord>;
  goalies: Map<string, NhlGoalieRecord>;
  awardsByPlayer: Map<number, PlayerAward[]>;
}) {
  const summaries = years.map((year) => {
    const rows = rosters[year] || [];
    const salary = rows.filter((row) => capPositions.has(position(row) as never)).reduce((total, row) => total + (row.salary || 0), 0);
    const rosterSize = rows.filter((row) => activePositions.has(position(row) as never)).length;
    const cap = salaryCapForSeason(year);
    return { year, salary, rosterSize, cap, space: cap - salary };
  });

  const players = useMemo(() => {
    const grouped = new Map<string, { representative: PlayerSeasonWithRelations; seasons: Map<number, PlayerSeasonWithRelations> }>();
    years.forEach((year) => (rosters[year] || []).forEach((row) => {
      const key = String(row.player?.id || row.player_id || row.player?.player_api_id || row.id);
      const existing = grouped.get(key);
      if (existing) existing.seasons.set(year, row);
      else grouped.set(key, { representative: row, seasons: new Map([[year, row]]) });
    }));
    return [...grouped.values()];
  }, [rosters, years]);

  const scoreForPlayer = ({ representative }: (typeof players)[number]) => {
    const apiId = playerApiId(representative);
    const goalie = goalies.get(apiId);
    const skater = skaters.get(apiId);
    return position(representative) === "G" || (goalie && !skater) ? (goalie ? getGoalieScore(goalie) : 0) : (skater ? getSkaterScore(skater) : 0);
  };

  const renderPlayerTable = (code: string, label: string) => {
    const sectionPlayers = players
      .filter(({ representative }) => position(representative) === code)
      .sort((a, b) => scoreForPlayer(b) - scoreForPlayer(a));
    return <RosterSection key={code} code={code} label={label} count={sectionPlayers.length}>
      <table className="min-w-full divide-y divide-gray-100 text-xs dark:divide-gray-800">
        <thead><tr className="text-center font-semibold uppercase text-gray-500 dark:text-gray-400">
          <th className="px-3 py-3 text-left">Player</th><th className="whitespace-nowrap px-3 py-3">NHL Team</th><th className="px-3 py-3">Pos</th>
          {years.map((year) => <th key={year} className="px-3 py-3">{year}</th>)}
          <th className="px-3 py-3">Score</th><th className="px-3 py-3">PPG</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{sectionPlayers.length === 0 ? <EmptyRow columns={years.length + 5} /> : sectionPlayers.map(({ representative, seasons }) => {
          const apiId = playerApiId(representative);
          const goalie = goalies.get(apiId);
          const skater = skaters.get(apiId);
          const isGoalie = code === "G" || Boolean(goalie && !skater);
          const score = isGoalie ? (goalie ? getGoalieScore(goalie) : 0) : (skater ? getSkaterScore(skater) : 0);
          const gamesPlayed = isGoalie ? goalie?.gamesPlayed : skater?.gamesPlayed;
          const apiPosition = isGoalie ? "G" : nhlSkaterPosition(skater?.positionCode) || code;
          return <tr key={representative.player?.id || representative.id} className="text-center text-gray-600 dark:text-gray-300">
            <td className="px-3 py-3 text-left"><span className="font-medium text-gray-800 dark:text-white/90">{representative.player?.player_api_id ? <Link to={`/player-profile?playerId=${representative.player.player_api_id}`} className="text-brand-500 hover:underline">{playerName(representative)}</Link> : playerName(representative)}</span><PlayerAwardBadges awards={representative.player?.id ? awardsByPlayer.get(representative.player.id) || [] : []} includeMonthly={false} /></td>
            <td className="px-3 py-3">{skater?.teamAbbrevs || goalie?.teamAbbrevs || "—"}</td>
            <td className="px-3 py-3">{apiPosition}</td>
            {years.map((year) => {
              const row = seasons.get(year);
              return <td key={year} className="whitespace-nowrap px-3 py-3 font-medium text-gray-800 dark:text-white/90">{row?.salary == null ? "—" : money.format(row.salary)}</td>;
            })}
            <td className="px-3 py-3 font-semibold text-gray-800 dark:text-white/90">{skater || goalie ? formatFantasyPoints(score) : "—"}</td>
            <td className="px-3 py-3">{gamesPlayed ? formatFantasyPoints(score / gamesPlayed) : "—"}</td>
          </tr>;
        })}</tbody>
      </table>
    </RosterSection>;
  };

  return <div className="mt-5 space-y-5">
    {activeSections.map((section) => renderPlayerTable(section.code, section.label))}

    <div className="pt-2"><h3 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Year-by-Year Payroll</h3><div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-gray-800">
        <thead className="bg-gray-50 dark:bg-white/[0.03]"><tr className="text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400"><th className="px-3 py-3">Season</th><th className="px-3 py-3">Salary Cap</th><th className="px-3 py-3">Salary Spent</th><th className="px-3 py-3">Cap Space</th><th className="px-3 py-3">Roster Size</th></tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{summaries.map((summary) => <tr key={summary.year} className="text-gray-600 dark:text-gray-300"><td className="px-3 py-3 font-semibold text-gray-800 dark:text-white/90">{summary.year}</td><td className="px-3 py-3">{money.format(summary.cap)}</td><td className="px-3 py-3">{money.format(summary.salary)}</td><td className={`px-3 py-3 font-medium ${summary.space < 0 ? "text-error-600 dark:text-error-400" : "text-success-600 dark:text-success-400"}`}>{summary.space < 0 ? `${money.format(Math.abs(summary.space))} over` : money.format(summary.space)}</td><td className={`px-3 py-3 ${summary.rosterSize > ROSTER_LIMIT ? "font-semibold text-error-600 dark:text-error-400" : ""}`}>{summary.rosterSize} / {ROSTER_LIMIT}</td></tr>)}</tbody>
      </table>
    </div></div>
  </div>;
}

const emptySkater: NhlSkaterRecord = { playerId: 0, skaterFullName: "", positionCode: "", teamAbbrevs: "", gamesPlayed: 0, goals: 0, assists: 0, plusMinus: 0, penaltyMinutes: 0, ppGoals: 0, ppPoints: 0, shGoals: 0, shPoints: 0, gameWinningGoals: 0, shots: 0, blockedShots: 0, hits: 0, totalFaceoffWins: 0 };
const emptyGoalie: NhlGoalieRecord = { playerId: 0, goalieFullName: "", teamAbbrevs: "", gamesPlayed: 0, gamesStarted: 0, wins: 0, losses: 0, otLosses: 0, goalsAgainst: 0, saves: 0, shutouts: 0, penaltyMinutes: 0, goals: 0, assists: 0, savePct: null, goalsAgainstAverage: null };

export default function HockeyTeamDetail() {
  const { abbreviation = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSeason = Number(searchParams.get("season"));
  const [team, setTeam] = useState<FantasyTeam | null>(null);
  const [managerTenures, setManagerTenures] = useState<FantasyTeamManagerTenure[]>([]);
  const [teamFinishes, setTeamFinishes] = useState<FantasyTeamFinish[]>([]);
  const [brandingHistory, setBrandingHistory] = useState<FantasyTeamBranding[]>([]);
  const [selectedSeason, setSelectedSeason] = useState(
    seasonOptions.includes(requestedSeason) ? requestedSeason : CURRENT_LEAGUE_SEASON,
  );
  const [viewMode, setViewMode] = useState<"single" | "multi">("single");
  const [roster, setRoster] = useState<PlayerSeasonWithRelations[]>([]);
  const [buyoutPenalties, setBuyoutPenalties] = useState<BuyoutPenalty[]>([]);
  const [tradeBlockIds, setTradeBlockIds] = useState<Set<number>>(new Set());
  const tradeInterest = usePlayerTradeInterest(selectedSeason);
  const [multiYearRosters, setMultiYearRosters] = useState<Record<number, PlayerSeasonWithRelations[]>>({});
  const [skaters, setSkaters] = useState<Map<string, NhlSkaterRecord>>(new Map());
  const [goalies, setGoalies] = useState<Map<string, NhlGoalieRecord>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statsError, setStatsError] = useState("");
  const [awardsByPlayer, setAwardsByPlayer] = useState<Map<number, PlayerAward[]>>(new Map());
  const [playerAwards, setPlayerAwards] = useState<PlayerAward[]>([]);
  const [awardDefinitions, setAwardDefinitions] = useState<Award[]>([]);
  const [teamPlayerSeasons, setTeamPlayerSeasons] = useState<PlayerSeasonWithRelations[]>([]);

  function handleSeasonChange(year: number) {
    setSelectedSeason(year);
    setSearchParams({ season: String(year) }, { replace: true });
  }

  useEffect(() => {
    setLoading(true);
    fetchFantasyTeamByAbbreviation(abbreviation)
      .then(async (row) => {
        setTeam(row);
        if (row) {
          const [tenures, finishes, branding, historicalRosters] = await Promise.all([
            fetchTeamManagerTenures(row.id),
            fetchTeamFinishes(row.id),
            fetchTeamBrandingHistory(row.id),
            fetchPlayerSeasonsByTeam(row.id),
          ]);
          setManagerTenures(tenures);
          setTeamFinishes(finishes);
          setBrandingHistory(branding);
          setTeamPlayerSeasons(historicalRosters);
        } else {
          setManagerTenures([]);
          setTeamFinishes([]);
          setTeamPlayerSeasons([]);
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [abbreviation]);

  useEffect(() => {
    if (!team) return;
    Promise.all([fetchPlayerSeasonsByTeamAndSeason(team.id, selectedSeason), fetchBuyoutPenalties(selectedSeason, team.id).catch(() => [] as BuyoutPenalty[])])
      .then(([seasonRows, penaltyRows]) => {
        setRoster(seasonRows);
        setBuyoutPenalties(penaltyRows);
        setError("");
      })
      .catch((err: Error) => setError(err.message));

    fetchTradeBlockListings(selectedSeason)
      .then((rows) => setTradeBlockIds(new Set(rows.map((row) => row.player_season_id))))
      .catch(() => setTradeBlockIds(new Set()));

    Promise.all([
      fetchNhlSkaterStats(nhlSeasonId(selectedSeason)).catch(() => [] as NhlSkaterRecord[]),
      fetchNhlGoalieStats(nhlSeasonId(selectedSeason)).catch(() => [] as NhlGoalieRecord[]),
      fetchNhlSkaterStats(nhlSeasonId(selectedSeason - 1)).catch(() => [] as NhlSkaterRecord[]),
      fetchNhlGoalieStats(nhlSeasonId(selectedSeason - 1)).catch(() => [] as NhlGoalieRecord[]),
    ])
      .then(([currentSkaters, currentGoalies, previousSkaters, previousGoalies]) => {
        const mergedSkaters = new Map(previousSkaters.map((row) => [String(row.playerId), row]));
        const mergedGoalies = new Map(previousGoalies.map((row) => [String(row.playerId), row]));
        currentSkaters.forEach((row) => mergedSkaters.set(String(row.playerId), row));
        currentGoalies.forEach((row) => mergedGoalies.set(String(row.playerId), row));
        setSkaters(mergedSkaters);
        setGoalies(mergedGoalies);
        setStatsError(mergedSkaters.size || mergedGoalies.size ? "" : "Unable to load current or previous NHL player information.");
      });

    Promise.all([fetchPlayerAwards(), fetchAwards(true)])
      .then(([rows, definitions]) => {
        setPlayerAwards(rows);
        setAwardsByPlayer(mapAwardsByPlayer(rows));
        setAwardDefinitions(definitions);
      })
      .catch(() => {
        setPlayerAwards([]);
        setAwardsByPlayer(new Map());
        setAwardDefinitions([]);
      });
  }, [team, selectedSeason]);

  const multiYearSeasons = useMemo(() => Array.from({ length: 5 }, (_, index) => selectedSeason + index), [selectedSeason]);

  useEffect(() => {
    if (!team || viewMode !== "multi") return;
    Promise.all(multiYearSeasons.map(async (year) => [year, await fetchPlayerSeasonsByTeamAndSeason(team.id, year)] as const))
      .then((results) => {
        setMultiYearRosters(Object.fromEntries(results));
        setError("");
      })
      .catch((err: Error) => setError(err.message));
  }, [team, viewMode, multiYearSeasons]);

  const byPosition = useMemo(() => roster.reduce<Record<string, PlayerSeasonWithRelations[]>>((groups, season) => {
    const code = position(season);
    (groups[code] ||= []).push(season);
    return groups;
  }, {}), [roster]);
  const selectedManager = getManagerForSeason(managerTenures, selectedSeason);
  const displayTeam = team ? applyTeamBranding(team, brandingHistory, selectedSeason) : null;
  const rosterCount = roster.filter((season) => activePositions.has(position(season) as never)).length;
  const buyoutPenaltyTotal = buyoutPenalties.reduce((sum, penalty) => sum + penalty.amount, 0);
  const capSalary = roster.filter((season) => capPositions.has(position(season) as never)).reduce((sum, season) => sum + (season.salary || 0), 0) + buyoutPenaltyTotal;
  const salaryCap = salaryCapForSeason(selectedSeason);
  const capSpace = salaryCap - capSalary;
  const prospects = roster.filter((season) => prospectPositions.has(position(season)));
  const finishYears = (placement: 1 | 2 | 3) => teamFinishes
    .filter((finish) => finish.placement === placement)
    .map((finish) => finish.season_year)
    .sort((a, b) => b - a);
  const renderInterest = (season: PlayerSeasonWithRelations) => tradeInterest.canExpressInterest(season) ? <PlayerInterestButton interested={tradeInterest.isInterested(season.id)} busy={tradeInterest.busyPlayerSeasonId === season.id} onClick={() => void tradeInterest.toggleInterest(season)} /> : null;

  return <div>
    <PageMeta title="Great Lakes Dynasty Hockey League" description="GLDHL team roster and payroll" />
    <PageBreadcrumb pageTitle={displayTeam?.team_name || "Team Detail"} />
    {loading && <div className="rounded-2xl border border-gray-200 p-10 text-center text-sm text-gray-500">Loading team…</div>}
    {!loading && error && !team && <div className="rounded-2xl border border-error-200 bg-error-50 p-5 text-error-700">{error}</div>}
    {!loading && !team && !error && <div className="rounded-2xl border border-gray-200 p-10 text-center"><p>Team not found.</p><Link to="/teams" className="mt-4 inline-block text-brand-500">Back to Teams</Link></div>}
    {team && <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="h-2" style={{ background: `linear-gradient(90deg, ${displayTeam?.primary_color || "#1d4ed8"}, ${displayTeam?.secondary_color || "#f97316"})` }} />
      <div className="p-4 xl:p-6">
        <TeamIdentityCard team={displayTeam || team} season={selectedSeason} managerName={selectedManager?.manager_name || team.manager_name} />
        <div className="mt-4 grid grid-cols-3 gap-3"><Medal icon="🥇" value={team.championships} label="Championships" years={finishYears(1)} tone="gold" /><Medal icon="🥈" value={team.runner_up_finishes} label="Runner-up finishes" years={finishYears(2)} tone="silver" /><Medal icon="🥉" value={team.third_place_finishes} label="Third-place finishes" years={finishYears(3)} tone="bronze" /></div>
        <div className="mt-3 flex flex-wrap justify-end gap-3"><Link to={`/teams/${team.id}/farm-systems`} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700">🏒 View Farm Systems</Link><a href="#trophy-case" className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600">🏆 View Trophy Case</a></div>
        <TrophyCase team={displayTeam || team} finishes={teamFinishes} playerAwards={playerAwards} teamSeasons={teamPlayerSeasons} awards={awardDefinitions} />

        <div className="mt-6 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="font-semibold text-gray-800 text-theme-lg dark:text-white/90">Roster &amp; Payroll</h3><p className="text-xs text-gray-500">Active roster limit: {ROSTER_LIMIT} players.</p></div><div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-end"><div className="inline-flex h-11 rounded-lg border border-gray-300 p-1 dark:border-gray-700"><button type="button" onClick={() => setViewMode("single")} className={`rounded-md px-3 text-sm font-medium ${viewMode === "single" ? "bg-brand-500 text-white" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"}`}>Single Season</button><button type="button" onClick={() => setViewMode("multi")} className={`rounded-md px-3 text-sm font-medium ${viewMode === "multi" ? "bg-brand-500 text-white" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"}`}>Multi-Year</button></div><div className="w-full sm:w-44"><label htmlFor="season" className="mb-1 block text-sm font-medium">{viewMode === "multi" ? "Starting Season" : "Season"}</label><select id="season" value={selectedSeason} onChange={(event) => handleSeasonChange(Number(event.target.value))} className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 dark:border-gray-700 dark:bg-gray-900">{seasonOptions.map((year) => <option key={year}>{year}</option>)}</select></div></div></div>
          {viewMode === "single" && <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><PayrollCard label="Salary Cap" value={money.format(salaryCap)} /><PayrollCard label="Cap Salary" value={money.format(capSalary)} /><PayrollCard label="Buyout Penalties" value={money.format(buyoutPenaltyTotal)} /><PayrollCard label={capSpace >= 0 ? "Cap Space" : "Over Cap"} value={money.format(Math.abs(capSpace))} danger={capSpace < 0} /><PayrollCard label="Active Roster" value={`${rosterCount} / ${ROSTER_LIMIT}`} danger={rosterCount > ROSTER_LIMIT} /></div>}
          {error && <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">{error}</div>}
          {statsError && <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">Roster loaded, but NHL statistics could not be loaded: {statsError}</div>}
          {viewMode === "multi" ? <MultiYearView years={multiYearSeasons} rosters={multiYearRosters} skaters={skaters} goalies={goalies} awardsByPlayer={awardsByPlayer} /> : <div className="mt-5 space-y-4">
            {activeSections.map((section) => section.type === "goalie" ? <GoalieTable key={section.code} players={byPosition.G || []} stats={goalies} awardsByPlayer={awardsByPlayer} tradeBlockIds={tradeBlockIds} renderInterest={renderInterest} /> : <SkaterTable key={section.code} code={section.code} label={section.label} players={byPosition[section.code] || []} stats={skaters} awardsByPlayer={awardsByPlayer} tradeBlockIds={tradeBlockIds} renderInterest={renderInterest} />)}
            <div className="pt-2"><h3 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Non-Rostered Players</h3><div className="space-y-4">{nonRosterSections.map((section) => <CompactTable key={section.code} code={section.code} label={section.label} players={byPosition[section.code] || []} skaters={skaters} goalies={goalies} note={section.cap ? "Counts toward cap only" : "Excluded from cap and roster"} awardsByPlayer={awardsByPlayer} tradeBlockIds={tradeBlockIds} renderInterest={renderInterest} />)}</div></div>
            <div className="pt-2"><h3 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Buyout Penalties</h3><div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"><div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-white/[0.03]"><span className="text-sm font-semibold">Dead cap charges</span><span className="text-xs text-gray-500">Counts toward cap · no roster spot</span></div>{buyoutPenalties.length ? <table className="min-w-full text-sm"><tbody className="divide-y divide-gray-100 dark:divide-gray-800">{buyoutPenalties.map((penalty) => <tr key={penalty.id}><td className="px-3 py-3 font-semibold">{penalty.player?.full_name || "Player buyout"}</td><td className="px-3 py-3 text-center">{penalty.season_year}</td><td className="px-3 py-3 text-right font-black text-error-600">{money.format(penalty.amount)}</td></tr>)}</tbody></table> : <p className="px-3 py-5 text-center text-sm text-gray-500">No buyout penalties this season.</p>}</div></div>
            <div className="pt-2"><h3 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Acquired Prospects</h3><CompactTable code="AP" label="Acquired Prospects" players={prospects} skaters={skaters} goalies={goalies} note="Excluded from cap and roster" awardsByPlayer={awardsByPlayer} tradeBlockIds={tradeBlockIds} renderInterest={renderInterest} /></div>
          </div>}
        </div>
      </div>
    </div>}
  </div>;
}
