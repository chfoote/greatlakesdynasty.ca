import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { fetchFantasyPlayerByApiId, fetchPlayerSeasonsByPlayer, type FantasyPlayer, type PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import { fetchNhlGoalieStats, fetchNhlPlayerLanding, fetchNhlSkaterStats, formatFantasyPoints, formatNhlStat, getGoalieScore, getSkaterScore, type NhlGoalieRecord, type NhlPlayerLanding, type NhlSkaterRecord } from "../../lib/nhl";
import { fetchPlayerAwards, type PlayerAward } from "../../lib/awards";
import { fetchLeagueTransactions, type LeagueTransaction } from "../../lib/transactions";
import { applyTeamBranding, fetchTeamBrandingHistory } from "../../lib/fantasyTeams";
import { CURRENT_LEAGUE_SEASON } from "../../lib/leagueSeasons";
import { TradeTransactionDetails } from "./Transactions";

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
function nhlSeasonId(year: number) { return (year - 1) * 10000 + year; }
function displayPosition(position?: string | null) { return position === "L" ? "LW" : position === "R" ? "RW" : position || "—"; }
function playerName(player: FantasyPlayer | null, landing: NhlPlayerLanding | null) { return player?.full_name || [player?.first_name, player?.last_name].filter(Boolean).join(" ") || [landing?.firstName?.default, landing?.lastName?.default].filter(Boolean).join(" ") || "Unknown Player"; }
function ageOn(date?: string) { if (!date) return null; const birth = new Date(`${date}T00:00:00`); const today = new Date(); let age = today.getFullYear() - birth.getFullYear(); if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1; return age; }
function formatDate(date: string) { return new Date(`${date}T00:00:00`).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }); }
function actionLabel(action: string) { return action.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase()); }

function InfoCard({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900/70"><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p><div className="mt-1 text-sm font-medium text-gray-800 dark:text-white/90">{value || "—"}</div></div>;
}

function SkaterStats({ record, season }: { record: NhlSkaterRecord; season: number }) {
  const score = getSkaterScore(record);
  const values = [record.gamesPlayed, record.goals, record.assists, record.plusMinus, record.penaltyMinutes, record.ppGoals, record.ppPoints-record.ppGoals, record.shGoals, record.shPoints-record.shGoals, record.gameWinningGoals, record.shots, record.blockedShots, record.hits, record.totalFaceoffWins];
  return <StatsTable title={`Skater Stats · ${season}`} headings={["GP","G","A","+/-","PIM","PPG","PPA","SHG","SHA","GWG","S","B","H","FOW","SCORE","FPPG"]} values={[...values, formatFantasyPoints(score), record.gamesPlayed ? formatFantasyPoints(score/record.gamesPlayed) : "—"]} />;
}

function GoalieStats({ record, season }: { record: NhlGoalieRecord; season: number }) {
  const score = getGoalieScore(record);
  return <StatsTable title={`Goalie Stats · ${season}`} headings={["GP","GS","W","L","OTL","GA","SV","SO","PIM","G","A","SV%","GAA","SCORE","FPPG"]} values={[record.gamesPlayed,record.gamesStarted,record.wins,record.losses,record.otLosses,record.goalsAgainst,record.saves,record.shutouts,record.penaltyMinutes,record.goals,record.assists,record.savePct?.toFixed(3) ?? "—",formatNhlStat(record.goalsAgainstAverage,2),formatFantasyPoints(score),record.gamesPlayed ? formatFantasyPoints(score/record.gamesPlayed) : "—"]} />;
}

function StatsTable({ title, headings, values }: { title: string; headings: string[]; values: Array<string | number> }) {
  return <section className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"><h2 className="border-b border-gray-200 px-4 py-3 font-semibold text-gray-800 dark:border-gray-800 dark:text-white/90">{title}</h2><div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="bg-gray-50 dark:bg-white/[0.03]"><tr>{headings.map((heading) => <th key={heading} className="whitespace-nowrap px-3 py-2.5 text-center text-gray-500">{heading}</th>)}</tr></thead><tbody><tr>{values.map((value, index) => <td key={headings[index]} className={`px-3 py-3 text-center ${headings[index] === "SCORE" ? "font-bold text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-300"}`}>{value}</td>)}</tr></tbody></table></div></section>;
}

function PlayerTransactionCard({ transaction, fallbackPosition }: { transaction: LeagueTransaction; fallbackPosition: string }) {
  if (transaction.trade_offer_id) return <article className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-5">
    <div className="absolute inset-y-0 left-0 w-1 bg-brand-500" />
    <div className="flex flex-col items-start gap-1"><span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">Trade</span><time className="text-xs font-medium text-gray-500">{formatDate(transaction.transaction_date)}</time></div>
    <TradeTransactionDetails transaction={transaction} />
    {transaction.notes && <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">{transaction.notes}</p>}
  </article>;

  return <article className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
    <div className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: transaction.fantasy_team?.primary_color || "#465fff" }} />
    <div className="flex items-start gap-3">{transaction.fantasy_team?.logo && <Link to={`/teams/${transaction.fantasy_team.id}`} className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"><img src={transaction.fantasy_team.logo} alt={`${transaction.fantasy_team.team_name} logo`} className="h-full w-full object-contain" /></Link>}<div className="min-w-0 flex-1"><div className="flex flex-col items-start gap-1"><span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold uppercase text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{actionLabel(transaction.action)}</span><time className="text-xs font-medium text-gray-500">{formatDate(transaction.transaction_date)}</time></div><p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{transaction.fantasy_team?.team_name || "Team"} · {transaction.position || fallbackPosition}{transaction.salary != null ? ` · ${money.format(transaction.salary)}` : ""}{transaction.term_end_year ? ` · ${transaction.term_end_year}` : ""}</p>{transaction.notes && <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-white/[0.03]">{transaction.notes}</p>}</div></div>
  </article>;
}

export default function PlayerProfile() {
  const playerApiId = new URLSearchParams(useLocation().search).get("playerId") || "";
  const [landing, setLanding] = useState<NhlPlayerLanding | null>(null);
  const [fantasyPlayer, setFantasyPlayer] = useState<FantasyPlayer | null>(null);
  const [seasons, setSeasons] = useState<PlayerSeasonWithRelations[]>([]);
  const [awards, setAwards] = useState<PlayerAward[]>([]);
  const [transactions, setTransactions] = useState<LeagueTransaction[]>([]);
  const [skater, setSkater] = useState<NhlSkaterRecord | null>(null);
  const [goalie, setGoalie] = useState<NhlGoalieRecord | null>(null);
  const [statsSeason, setStatsSeason] = useState(CURRENT_LEAGUE_SEASON);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const apiId = Number(playerApiId);
    if (!playerApiId || Number.isNaN(apiId)) { setError("No valid NHL player ID was provided."); setLoading(false); return; }
    async function load() {
      setLoading(true); setError("");
      try {
        const [landingRow, playerRow, currentSkaters, currentGoalies, previousSkaters, previousGoalies, allAwards, allTransactions, branding] = await Promise.all([
          fetchNhlPlayerLanding(apiId),
          fetchFantasyPlayerByApiId(playerApiId),
          fetchNhlSkaterStats(nhlSeasonId(CURRENT_LEAGUE_SEASON)).catch(() => []),
          fetchNhlGoalieStats(nhlSeasonId(CURRENT_LEAGUE_SEASON)).catch(() => []),
          fetchNhlSkaterStats(nhlSeasonId(CURRENT_LEAGUE_SEASON - 1)).catch(() => []),
          fetchNhlGoalieStats(nhlSeasonId(CURRENT_LEAGUE_SEASON - 1)).catch(() => []),
          fetchPlayerAwards(), fetchLeagueTransactions(), fetchTeamBrandingHistory(),
        ]);
        const playerSeasons = playerRow ? await fetchPlayerSeasonsByPlayer(playerRow.id) : [];
        const brandedSeasons = playerSeasons.map((season) => ({ ...season, fantasy_team: season.fantasy_team ? applyTeamBranding(season.fantasy_team, branding, season.season_year) : null }));
        const currentSkater = currentSkaters.find((row) => row.playerId === apiId);
        const currentGoalie = currentGoalies.find((row) => row.playerId === apiId);
        const previousSkater = previousSkaters.find((row) => row.playerId === apiId);
        const previousGoalie = previousGoalies.find((row) => row.playerId === apiId);
        if (!active) return;
        setLanding(landingRow); setFantasyPlayer(playerRow); setSeasons(brandedSeasons);
        setSkater(currentSkater || previousSkater || null); setGoalie(currentGoalie || previousGoalie || null);
        setStatsSeason(currentSkater || currentGoalie ? CURRENT_LEAGUE_SEASON : CURRENT_LEAGUE_SEASON - 1);
        setAwards(playerRow ? allAwards.filter((award) => award.player_id === playerRow.id) : []);
        setTransactions(playerRow ? allTransactions.filter((transaction) => transaction.player_id === playerRow.id || transaction.trade_offer?.trade_offer_players.some((move) => move.player_season?.player_id === playerRow.id)).sort((a,b) => b.transaction_date.localeCompare(a.transaction_date) || b.created_at.localeCompare(a.created_at)) : []);
      } catch (err) { if (active) setError(err instanceof Error ? err.message : "Unable to load player profile."); }
      finally { if (active) setLoading(false); }
    }
    void load(); return () => { active = false; };
  }, [playerApiId]);

  const currentSeason = useMemo(() => seasons.find((season) => season.season_year === CURRENT_LEAGUE_SEASON) || seasons[0] || null, [seasons]);
  const name = playerName(fantasyPlayer, landing);
  const position = displayPosition(currentSeason?.position === "RFA" || currentSeason?.position === "PROSPECT" ? landing?.position : currentSeason?.position || landing?.position);
  const draft = landing?.draftDetails;

  return <div><PageMeta title={`${name} | Great Lakes Dynasty Hockey League`} description={`${name} GLDHL player profile`} /><PageBreadcrumb pageTitle={name} />
    <div className="space-y-6">
      {loading && <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03]">Loading player profile…</div>}
      {error && <div className="rounded-xl border border-error-200 bg-error-50 p-4 text-error-700">{error}</div>}
      {!loading && !error && landing && <>
        <section className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {landing.heroImage && <img src={landing.heroImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-10" />}
          <div className="relative p-5 sm:p-7"><div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-5"><div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">{landing.headshot ? <img src={landing.headshot} alt={`${name} headshot`} className="h-full w-full object-cover" /> : null}</div><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">{name}</h1>{landing.sweaterNumber != null && <span className="rounded-full bg-gray-100 px-2.5 py-1 text-sm font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">#{landing.sweaterNumber}</span>}</div><p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{position} · {landing.fullTeamName?.default || landing.currentTeamAbbrev || "NHL Team Unassigned"}</p>{awards.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{awards.map((assignment) => <div key={assignment.id} title={`${assignment.award?.name} · ${assignment.season_year}`} className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">{assignment.award?.image_url ? <img src={assignment.award.image_url} alt="" className="h-6 w-6 object-contain" /> : <span>🏆</span>}{assignment.award?.name} · {assignment.season_year}</div>)}</div>}</div></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:w-[430px]"><InfoCard label="Current GLDHL Team" value={currentSeason?.fantasy_team ? <Link to={`/teams/${currentSeason.fantasy_team.id}`} className="flex items-center gap-2 text-brand-500 hover:underline">{currentSeason.fantasy_team.logo && <img src={currentSeason.fantasy_team.logo} alt="" className="h-7 w-7 rounded object-contain" />}{currentSeason.fantasy_team.team_name}</Link> : "Not Owned"} /><InfoCard label="Current Contract" value={currentSeason ? `${currentSeason.salary == null ? "No salary" : money.format(currentSeason.salary)} · ${currentSeason.term_end_year || currentSeason.position || "No term"}` : "—"} /><InfoCard label="Birthday" value={landing.birthDate ? `${formatDate(landing.birthDate)} (${ageOn(landing.birthDate)})` : "—"} /><InfoCard label="Shoots / Catches" value={landing.shootsCatches || "—"} /></div></div></div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><InfoCard label="NHL Team" value={<span className="flex items-center gap-2">{landing.teamLogo && <img src={landing.teamLogo} alt="" className="h-7 w-7 object-contain" />}{landing.fullTeamName?.default || landing.currentTeamAbbrev || "—"}</span>} /><InfoCard label="Position / Number" value={`${position}${landing.sweaterNumber != null ? ` · #${landing.sweaterNumber}` : ""}`} /><InfoCard label="Birthplace" value={[landing.birthCity?.default, landing.birthStateProvince?.default, landing.birthCountry].filter(Boolean).join(", ") || "—"} /><InfoCard label="Draft" value={draft ? `${draft.year || "—"} ${draft.teamAbbrev || ""} · Round ${draft.round || "—"} · Pick ${draft.pickInRound || "—"}${draft.overallPick ? ` (${draft.overallPick} overall)` : ""}` : "Undrafted"} /></section>

        {skater ? <SkaterStats record={skater} season={statsSeason} /> : goalie ? <GoalieStats record={goalie} season={statsSeason} /> : <div className="rounded-xl border border-dashed border-gray-300 p-6 text-sm text-gray-500">No current or previous-season NHL stats were returned.</div>}

        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"><h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Trophy Case</h2>{awards.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{awards.map((assignment) => <div key={assignment.id} className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">{assignment.award?.image_url ? <img src={assignment.award.image_url} alt={assignment.award.name} className="h-12 w-12 object-contain" /> : <span className="text-3xl">🏆</span>}<div><p className="font-semibold text-amber-900 dark:text-amber-200">{assignment.award?.name || "Award"}</p><p className="text-xs text-amber-700 dark:text-amber-300">Season {assignment.season_year}</p></div></div>)}</div> : <p className="mt-3 text-sm text-gray-500">No awards yet.</p>}</section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"><h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Transaction History</h2><div className="mt-4 space-y-4">{transactions.length ? transactions.map((transaction) => <PlayerTransactionCard key={transaction.id} transaction={transaction} fallbackPosition={position} />) : <p className="text-sm text-gray-500">No transactions have been posted for this player.</p>}</div></section>
      </>}
    </div>
  </div>;
}
