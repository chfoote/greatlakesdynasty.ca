import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PositionBadge from "../../components/hockey/PositionBadge";
import { useAuth } from "../../context/AuthContext";
import { fetchAuctions, type Auction } from "../../lib/auctions";
import { fetchBuyoutPenalties, type BuyoutPenalty } from "../../lib/buyouts";
import { fetchRetentionAdjustments, type RetentionAdjustment } from "../../lib/retentions";
import { fetchPlayerSeasonsBySeason, type PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import { applyTeamBranding, fetchTeamBrandingHistory, type FantasyTeam } from "../../lib/fantasyTeams";
import { CURRENT_LEAGUE_SEASON } from "../../lib/leagueSeasons";
import { fetchUserTeamAssignment, fetchLatestUserTeamAssignment, type TeamUserAssignmentWithTeam } from "../../lib/teamUserAssignments";
import { fetchPlayerTradeInterests, fetchTradeBlockListings, type PlayerTradeInterest, type TradeBlockListing } from "../../lib/tradeMarket";
import { fetchTradeOffers, type TradeOffer } from "../../lib/tradeOffers";
import { fetchLeagueTransactions, type LeagueTransaction } from "../../lib/transactions";
import { fetchNhlGoalieStats, fetchNhlSkaterStats, formatFantasyPoints, getGoalieScore, getSkaterScore, type NhlGoalieRecord, type NhlSkaterRecord } from "../../lib/nhl";

const activePositions = new Set(["C", "LW", "RW", "D", "G"]);
const capPositions = new Set([...activePositions, "W", "IR", "RETENTION", "BUYOUT"]);
const positionMinimums = { C: 3, LW: 3, RW: 3, D: 6, G: 2 } as const;
const positionOrder: Record<string, number> = { C: 0, LW: 1, RW: 2, D: 3, G: 4 };
const rosterLimit = 23;
const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
function nhlSeasonId(year: number) { return (year - 1) * 10000 + year; }

function salaryCap(year: number) {
  return year <= 2026 ? 45_000_000 : 50_000_000;
}

function position(row: PlayerSeasonWithRelations) {
  return (row.position || "").toUpperCase();
}

function positionRank(row: PlayerSeasonWithRelations | null) {
  return row ? positionOrder[position(row)] ?? 99 : 99;
}

function playerName(row: PlayerSeasonWithRelations) {
  return row.player?.full_name || [row.player?.first_name, row.player?.last_name].filter(Boolean).join(" ") || "Unknown player";
}

function relativeDate(value: string) {
  const time = new Date(value).getTime();
  const hours = Math.floor((Date.now() - time) / 3_600_000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function transactionLabel(transaction: LeagueTransaction) {
  if (transaction.trade_offer_id) return "Trade completed";
  const name = transaction.player?.full_name || "Player";
  const labels: Record<string, string> = {
    signed: `${name} signed`, called_up: `${name} called up`, waived: `${name} waived`,
    claimed: `${name} claimed`, bought_out: `${name} bought out`, retained: `${name} retained`,
    injured_reserve: `${name} placed on IR`, long_term_injured_reserve: `${name} placed on LTIR`,
    released_to_rfa_offer: `${name} released to RFA offer`, matched_rfa_offer: `${name} RFA offer matched`, competitive_balance_drafted: `${name} selected in Competitive Balance Draft`,
    traded: `${name} acquired`,
  };
  return labels[transaction.action] || `${name} updated`;
}

function SummaryCard({ label, value, detail, tone = "brand" }: { label: string; value: string; detail: string; tone?: "brand" | "success" | "warning" | "error" }) {
  const tones = {
    brand: "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300",
    success: "border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300",
    warning: "border-warning-200 bg-warning-50 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300",
    error: "border-error-200 bg-error-50 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300",
  };
  return <div className={`rounded-2xl border p-4 ${tones[tone]}`}><p className="text-[11px] font-bold uppercase tracking-wider opacity-75">{label}</p><p className="mt-1 text-2xl font-black">{value}</p><p className="mt-1 text-xs font-medium opacity-75">{detail}</p></div>;
}

function ActionItem({ title, detail, link, linkLabel, tone = "brand" }: { title: string; detail: string; link: string; linkLabel: string; tone?: "brand" | "warning" | "error" }) {
  const dot = tone === "error" ? "bg-error-500" : tone === "warning" ? "bg-warning-500" : "bg-brand-500";
  return <div className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} /><div><p className="font-semibold text-gray-900 dark:text-white">{title}</p><p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{detail}</p></div></div><Link to={link} className="shrink-0 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300">{linkLabel} →</Link></div>;
}

function CompactActivityCard({ transaction }: { transaction: LeagueTransaction }) {
  const trade = transaction.trade_offer;
  if (!trade) return <Link to={`/transactions#transaction-${transaction.id}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-3 transition hover:bg-gray-50 dark:hover:bg-white/[0.04]"><div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-800 dark:text-gray-200">{transactionLabel(transaction)}</p><p className="mt-0.5 truncate text-xs text-gray-400">{transaction.notes || transaction.fantasy_team?.team_name || "League transaction"}</p></div><span className="shrink-0 text-[11px] font-medium text-gray-400">{relativeDate(transaction.created_at)}</span></Link>;
  const teams = [trade.from_team, trade.to_team, trade.third_team].filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  return <Link to={`/transactions#trade-${transaction.trade_offer_id}`} className="block rounded-xl border border-gray-200 p-3 transition hover:border-brand-300 hover:bg-gray-50/70 dark:border-gray-800 dark:hover:border-brand-500/40 dark:hover:bg-white/[0.03]">
    <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-wider text-brand-500">Trade completed</span><span className="text-[10px] font-medium text-gray-400">{relativeDate(transaction.created_at)}</span></div>
    <div className={`grid gap-2 ${teams.length === 3 ? "sm:grid-cols-3" : "grid-cols-2"}`}>{teams.map((club) => {
      const acquired = trade.trade_offer_players.filter((move) => move.to_team_id === club.id);
      return <div key={club.id} className="min-w-0 rounded-lg bg-gray-50 p-2 dark:bg-white/[0.04]"><div className="flex items-center gap-1.5">{club.logo && <img src={club.logo} alt="" className="h-5 w-5 object-contain" />}<span className="truncate text-[10px] font-black text-gray-700 dark:text-gray-200">{club.abbreviation} receives</span></div><div className="mt-1 space-y-0.5">{acquired.map((move) => { const player = move.player_season?.player; const name = player?.full_name || [player?.first_name, player?.last_name].filter(Boolean).join(" ") || "Unknown player"; return <p key={move.id} className="truncate text-[10px] text-gray-500"><strong className="text-gray-700 dark:text-gray-300">{move.player_season?.position}</strong> {name}</p>; })}</div></div>;
    })}</div>
    {transaction.notes && <p className="mt-2 border-t border-gray-100 pt-2 text-[10px] leading-4 text-gray-500 dark:border-gray-800 dark:text-gray-400">{transaction.notes}</p>}
  </Link>;
}

export default function ManagerCommandCenter() {
  const { user } = useAuth();
  const season = CURRENT_LEAGUE_SEASON;
  const [assignment, setAssignment] = useState<TeamUserAssignmentWithTeam | null>(null);
  const [team, setTeam] = useState<FantasyTeam | null>(null);
  const [roster, setRoster] = useState<PlayerSeasonWithRelations[]>([]);
  const [leagueRoster, setLeagueRoster] = useState<PlayerSeasonWithRelations[]>([]);
  const [previousSeasonPlayers, setPreviousSeasonPlayers] = useState<PlayerSeasonWithRelations[]>([]);
  const [penalties, setPenalties] = useState<BuyoutPenalty[]>([]);
  const [retentionAdjustments, setRetentionAdjustments] = useState<RetentionAdjustment[]>([]);
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [offers, setOffers] = useState<TradeOffer[]>([]);
  const [interests, setInterests] = useState<PlayerTradeInterest[]>([]);
  const [tradeBlock, setTradeBlock] = useState<TradeBlockListing[]>([]);
  const [skaters, setSkaters] = useState<Map<string, NhlSkaterRecord>>(new Map());
  const [goalies, setGoalies] = useState<Map<string, NhlGoalieRecord>>(new Map());
  const [radarMode, setRadarMode] = useState<"needs" | "all">("needs");
  const [transactions, setTransactions] = useState<LeagueTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setError("");
    const load = async () => {
      try {
        const assigned = await fetchUserTeamAssignment(user.id, season) || await fetchLatestUserTeamAssignment(user.id);
        if (!active) return;
        setAssignment(assigned);
        if (!assigned?.fantasy_team_id) return;
        const [leagueRosterRows, previousSeasonRows, penaltyRows, adjustmentRows, auctionRows, offerRows, interestRows, tradeBlockRows, transactionRows, branding, nhlStats] = await Promise.all([
          fetchPlayerSeasonsBySeason(season),
          fetchPlayerSeasonsBySeason(season - 1).catch(() => []),
          fetchBuyoutPenalties(season, assigned.fantasy_team_id).catch(() => []),
          fetchRetentionAdjustments(season, assigned.fantasy_team_id).catch(() => []),
          fetchAuctions(season).catch(() => []),
          fetchTradeOffers(season).catch(() => []),
          fetchPlayerTradeInterests(season).catch(() => []),
          fetchTradeBlockListings(season).catch(() => []),
          fetchLeagueTransactions().catch(() => []),
          fetchTeamBrandingHistory().catch(() => []),
          Promise.all([
            fetchNhlSkaterStats(nhlSeasonId(season)).catch(() => [] as NhlSkaterRecord[]),
            fetchNhlGoalieStats(nhlSeasonId(season)).catch(() => [] as NhlGoalieRecord[]),
            fetchNhlSkaterStats(nhlSeasonId(season - 1)).catch(() => [] as NhlSkaterRecord[]),
            fetchNhlGoalieStats(nhlSeasonId(season - 1)).catch(() => [] as NhlGoalieRecord[]),
          ]),
        ]);
        if (!active) return;
        setTeam(assigned.fantasy_team ? applyTeamBranding(assigned.fantasy_team, branding, season) : null);
        setLeagueRoster(leagueRosterRows);
        setRoster(leagueRosterRows.filter((row) => row.fantasy_team_id === assigned.fantasy_team_id));
        setPreviousSeasonPlayers(previousSeasonRows);
        setPenalties(penaltyRows);
        setRetentionAdjustments(adjustmentRows);
        setAuctions(auctionRows);
        setOffers(offerRows);
        setInterests(interestRows);
        setTradeBlock(tradeBlockRows);
        const skaterMap = new Map(nhlStats[2].map((row) => [String(row.playerId), row]));
        const goalieMap = new Map(nhlStats[3].map((row) => [String(row.playerId), row]));
        nhlStats[0].forEach((row) => skaterMap.set(String(row.playerId), row));
        nhlStats[1].forEach((row) => goalieMap.set(String(row.playerId), row));
        setSkaters(skaterMap);
        setGoalies(goalieMap);
        setTransactions(transactionRows);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load your manager dashboard.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [season, user]);

  const teamId = assignment?.fantasy_team_id;
  const activeRoster = roster.filter((row) => activePositions.has(position(row)));
  const payroll = roster.filter((row) => capPositions.has(position(row))).reduce((sum, row) => sum + (row.salary || 0), 0)
    + penalties.reduce((sum, row) => sum + row.amount, 0)
    + retentionAdjustments.reduce((sum, row) => sum + row.amount, 0);
  const capSpace = salaryCap(season) - payroll;
  const finalContractYear = roster.filter((row) => row.term_end_year === season && !["RFA", "PROSPECT", "AP"].includes(position(row)));
  const restrictedFreeAgents = roster.filter((row) => position(row) === "RFA").map((row) => {
    const previousSeason = previousSeasonPlayers.find((previous) => previous.player_id === row.player_id);
    const previousSalary = previousSeason?.salary ?? null;
    return {
      row,
      previousSalary,
      qualifyingOffer: Math.max(Math.round((previousSalary || 0) * 0.5), 500_000),
    };
  });
  const missingPositions = (Object.keys(positionMinimums) as Array<keyof typeof positionMinimums>).map((code) => ({
    code,
    missing: Math.max(positionMinimums[code] - activeRoster.filter((row) => position(row) === code).length, 0),
  })).filter((item) => item.missing > 0);
  const activeAuctions = auctions.filter((auction) => !["completed", "cancelled"].includes(auction.status));
  const pendingOffers = offers.filter((offer) => offer.status === "pending" && [offer.from_team_id, offer.to_team_id, offer.third_team_id].includes(teamId || -1));
  const offersToReview = pendingOffers.filter((offer) => offer.to_team_id === teamId);
  const receivedInterest = interests.filter((interest) => interest.owner_team_id === teamId);
  const receivedInterestByPlayer = [...receivedInterest.reduce((groups, interest) => {
    const current = groups.get(interest.player_season_id) || { row: interest.player_season, teams: [] as PlayerTradeInterest["interested_team"][] };
    if (interest.interested_team && !current.teams.some((candidate) => candidate?.id === interest.interested_team?.id)) current.teams.push(interest.interested_team);
    groups.set(interest.player_season_id, current);
    return groups;
  }, new Map<number, { row: PlayerSeasonWithRelations | null; teams: PlayerTradeInterest["interested_team"][] }>()).values()];
  const teamTransactions = useMemo(() => {
    const seenTrades = new Set<number>();
    const postedTradeIds = new Set(transactions.map((transaction) => transaction.trade_offer_id).filter((id): id is number => id != null));
    return transactions.filter((transaction) => {
    if (transaction.action === "traded" && transaction.related_trade_offer_id && postedTradeIds.has(transaction.related_trade_offer_id)) return false;
    if (!teamId) return false;
    if (transaction.fantasy_team_id === teamId) return true;
    const trade = transaction.trade_offer;
    return Boolean(trade && [trade.from_team?.id, trade.to_team?.id, trade.third_team?.id].includes(teamId));
    }).filter((transaction) => {
      if (!transaction.trade_offer_id) return true;
      if (seenTrades.has(transaction.trade_offer_id)) return false;
      seenTrades.add(transaction.trade_offer_id);
      return true;
    }).slice(0, 5);
  }, [teamId, transactions]);
  const managerName = assignment?.profile?.display_name || user?.email?.split("@")[0] || "Manager";
  const playerScore = useCallback((row: PlayerSeasonWithRelations) => {
    const apiId = row.player?.player_api_id || "";
    const record = position(row) === "G" ? goalies.get(apiId) : skaters.get(apiId);
    return record ? (position(row) === "G" ? getGoalieScore(record as NhlGoalieRecord) : getSkaterScore(record as NhlSkaterRecord)) : 0;
  }, [goalies, skaters]);
  const marketRadar = useMemo(() => {
    if (!teamId || !leagueRoster.length) return { needs: [] as string[], candidates: [] as PlayerSeasonWithRelations[], allCandidates: [] as PlayerSeasonWithRelations[] };
    const activeRows = leagueRoster.filter((row) => activePositions.has(position(row)));
    const strength = (rows: PlayerSeasonWithRelations[], code: string) => rows.filter((row) => position(row) === code).map(playerScore).sort((a, b) => b - a).slice(0, positionMinimums[code as keyof typeof positionMinimums]).reduce((sum, score) => sum + score, 0);
    const teamIds = [...new Set(activeRows.map((row) => row.fantasy_team_id).filter((id): id is number => id != null))];
    const lowerHalf = new Set(teamIds.map((id) => ({ id, score: Object.keys(positionMinimums).reduce((sum, code) => sum + strength(activeRows.filter((row) => row.fantasy_team_id === id), code), 0) })).sort((a, b) => b.score - a.score).slice(Math.ceil(teamIds.length / 2)).map((row) => row.id));
    const myRows = activeRows.filter((row) => row.fantasy_team_id === teamId);
    const needs = Object.keys(positionMinimums).map((code) => ({ code, ratio: strength(myRows, code) / Math.max(teamIds.reduce((sum, id) => sum + strength(activeRows.filter((row) => row.fantasy_team_id === id), code), 0) / Math.max(teamIds.length, 1), 1) })).sort((a, b) => a.ratio - b.ratio).slice(0, 2).map((row) => row.code);
    const listed = new Set(tradeBlock.map((row) => row.player_season_id));
    const eligible = activeRows.filter((row) => row.fantasy_team_id !== teamId && row.fantasy_team_id != null && lowerHalf.has(row.fantasy_team_id) && row.term_end_year != null && row.term_end_year <= season + 1 && !listed.has(row.id));
    const byBenchOrder = (rows: PlayerSeasonWithRelations[]) => [...rows].sort((a, b) => (positionOrder[position(a)] ?? 99) - (positionOrder[position(b)] ?? 99) || playerScore(b) - playerScore(a));
    const candidates = byBenchOrder(eligible.filter((row) => needs.includes(position(row))).sort((a, b) => playerScore(b) - playerScore(a)).slice(0, 6));
    const allCandidates = byBenchOrder(eligible);
    return { needs, candidates, allCandidates };
  }, [teamId, leagueRoster, tradeBlock, playerScore, season]);

  if (loading) return <div><PageMeta title="My Front Office | Great Lakes Dynasty" description="Your GLDHL manager dashboard" /><div className="grid animate-pulse gap-4"><div className="h-48 rounded-3xl bg-gray-200 dark:bg-gray-800" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1,2,3,4].map((item) => <div key={item} className="h-28 rounded-2xl bg-gray-100 dark:bg-gray-800" />)}</div></div></div>;

  if (error) return <div className="rounded-2xl border border-error-200 bg-error-50 p-5 text-error-700">{error}</div>;

  if (!teamId) return <div><PageMeta title="Manager Command Centre | Great Lakes Dynasty" description="Your GLDHL manager dashboard" /><div className="rounded-3xl border border-warning-200 bg-warning-50 p-8 text-center dark:border-warning-500/30 dark:bg-warning-500/10"><h1 className="text-2xl font-bold text-gray-900 dark:text-white">Welcome to the Command Centre</h1><p className="mx-auto mt-2 max-w-xl text-sm text-gray-600 dark:text-gray-300">Your account is not assigned to a team for Season {season}. Once an administrator assigns your team, your roster, cap, trades, and auctions will appear here.</p><Link to="/league-chat" className="mt-5 inline-flex rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white">Open League Chat</Link></div></div>;

  return <div className="space-y-6">
    <PageMeta title="My Front Office | Great Lakes Dynasty" description="Your GLDHL manager dashboard" />
    <section className="relative overflow-hidden rounded-2xl bg-gray-950 p-4 text-white shadow-lg" style={{ backgroundImage: `linear-gradient(125deg, #111827 0%, ${team?.primary_color || "#1d4ed8"} 72%, ${team?.secondary_color || "#f97316"} 145%)` }}>
      <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full border-[42px] border-white/5" />
      <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/25 bg-white p-1.5 shadow-lg">{team?.logo ? <img src={team.logo} alt={`${team.team_name} logo`} className="h-full w-full object-contain" /> : <span className="font-black text-gray-700">{team?.abbreviation}</span>}</div>
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-white/80">My Front Office</span><span className="rounded-full border border-white/20 bg-black/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">Season {season}</span></div><h1 className="mt-1.5 truncate text-2xl font-black tracking-tight">{team?.team_name || "Your team"}</h1><p className="mt-0.5 text-xs text-white/65">Welcome back, {managerName} · Here’s what needs your attention.</p></div>
        </div>
        <div className="flex flex-wrap gap-2"><Link to={`/teams/${teamId}`} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-gray-900 hover:bg-gray-100">View My Team</Link><Link to="/trade-manager" className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/15">Make a Trade</Link></div>
      </div>
    </section>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label="Cap Space" value={money.format(capSpace)} detail={`${money.format(payroll)} of ${money.format(salaryCap(season))} used`} tone={capSpace < 0 ? "error" : "success"} />
      <SummaryCard label="Active Roster" value={`${activeRoster.length} / ${rosterLimit}`} detail={missingPositions.length ? `${missingPositions.map((item) => `${item.code} ${item.missing}`).join(" · ")} still needed` : "Position minimums satisfied"} tone={activeRoster.length > rosterLimit ? "error" : missingPositions.length ? "warning" : "success"} />
      <SummaryCard label="Pending Trades" value={String(pendingOffers.length)} detail={offersToReview.length ? `${offersToReview.length} waiting for your response` : "No response required right now"} tone={offersToReview.length ? "warning" : "brand"} />
      <SummaryCard label="Active Auctions" value={String(activeAuctions.length)} detail={activeAuctions.length ? "Bidding is currently active" : "No players currently nominated"} tone={activeAuctions.length ? "warning" : "brand"} />
    </section>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
        <div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-brand-500">Your inbox</p><h2 className="mt-1 text-xl font-bold text-gray-900 dark:text-white">Needs attention</h2></div><span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">{offersToReview.length + receivedInterest.length + (missingPositions.length ? 1 : 0) + (restrictedFreeAgents.length ? 1 : 0) + (finalContractYear.length ? 1 : 0)}</span></div>
        <div className="space-y-3">
          {offersToReview.length > 0 && <ActionItem title={`${offersToReview.length} trade ${offersToReview.length === 1 ? "offer needs" : "offers need"} your response`} detail="Review the players, salary impact, and roster compliance before deciding." link="/trade-manager" linkLabel="Review trades" tone="warning" />}
          {receivedInterestByPlayer.length > 0 && <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-500/25 dark:bg-sky-500/[0.07]"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-sky-900 dark:text-sky-200">{receivedInterest.length} expression{receivedInterest.length === 1 ? "" : "s"} of trade interest</p><p className="mt-0.5 text-sm text-sky-700/80 dark:text-sky-300/80">See who is interested before opening a conversation.</p></div><Link to="/trade-market" className="shrink-0 text-xs font-bold text-sky-700 hover:underline dark:text-sky-300">Trade Market →</Link></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{[...receivedInterestByPlayer].sort((a, b) => positionRank(a.row) - positionRank(b.row) || (a.row && b.row ? playerScore(b.row) - playerScore(a.row) : 0)).map(({ row, teams }) => row && <article key={row.id} className="rounded-xl border border-sky-200 bg-white p-3 dark:border-sky-500/25 dark:bg-gray-900"><div className="flex items-center gap-2"><PositionBadge position={position(row)} /><Link to={`/player-profile?playerId=${row.player?.player_api_id}`} className="min-w-0 truncate text-sm font-black text-gray-900 hover:text-brand-500 dark:text-white">{playerName(row)}</Link><span className="ml-auto shrink-0 text-[10px] font-black text-gray-400">{formatFantasyPoints(playerScore(row))} FPTS</span></div><p className="mt-2 text-[9px] font-bold uppercase tracking-wide text-gray-400">Interested teams</p><div className="mt-1 flex flex-wrap gap-1.5">{teams.map((club) => club && <span key={club.id} title={club.team_name} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">{club.logo && <img src={club.logo} alt="" className="h-4 w-4 object-contain" />}{club.abbreviation}</span>)}</div></article>)}</div></div>}
          {missingPositions.length > 0 && <ActionItem title="Your roster has open positions" detail={`Still needed: ${missingPositions.map((item) => `${item.missing} ${item.code}`).join(", ")}.`} link="/trade-market" linkLabel="Find players" tone="error" />}
          {restrictedFreeAgents.length > 0 && <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-500/30 dark:bg-violet-500/10">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-semibold text-violet-900 dark:text-violet-200">{restrictedFreeAgents.length} RFA decision{restrictedFreeAgents.length === 1 ? "" : "s"} due now</p><p className="mt-0.5 text-sm text-violet-700/80 dark:text-violet-300/80">These contracts have already expired. A qualifying offer keeps the player’s rights for one year.</p></div><Link to="/auction-house" className="shrink-0 text-sm font-semibold text-violet-700 hover:underline dark:text-violet-300">Review RFA rights →</Link></div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">{restrictedFreeAgents.map(({ row, previousSalary, qualifyingOffer }) => <div key={row.id} className="rounded-lg border border-violet-200 bg-white px-3 py-2.5 dark:border-violet-500/30 dark:bg-gray-900"><p className="text-sm font-bold text-gray-900 dark:text-white">{playerName(row)}</p><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{season - 1} salary: <strong className="text-gray-700 dark:text-gray-200">{previousSalary === null ? "Unavailable" : money.format(previousSalary)}</strong></p><p className="mt-0.5 text-xs font-semibold text-violet-700 dark:text-violet-300">Qualifying offer: {money.format(qualifyingOffer)} · 1 year</p></div>)}</div>
            <p className="mt-2 text-[11px] text-violet-600/75 dark:text-violet-300/70">Calculated at 50% of the previous salary, with a minimum qualifying salary of {money.format(500_000)}.</p>
          </div>}
          {finalContractYear.length > 0 && <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-4 dark:border-orange-500/25 dark:bg-orange-500/[0.07]"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-orange-900 dark:text-orange-200">Upcoming RFA</p><p className="mt-0.5 text-sm text-orange-700/80 dark:text-orange-300/80">{finalContractYear.length} contract{finalContractYear.length === 1 ? "" : "s"} expire after this season.</p></div><Link to={`/teams/${teamId}`} className="shrink-0 text-xs font-bold text-orange-700 hover:underline dark:text-orange-300">Contract outlook →</Link></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{[...finalContractYear].sort((a, b) => (positionOrder[position(a)] ?? 99) - (positionOrder[position(b)] ?? 99) || playerScore(b) - playerScore(a)).map((row) => { const apiId = row.player?.player_api_id || ""; const record = position(row) === "G" ? goalies.get(apiId) : skaters.get(apiId); const nhlTeam = record?.teamAbbrevs?.split(",")[0]; return <article key={row.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-orange-200 bg-white p-3 dark:border-orange-500/25 dark:bg-gray-900"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-800">{nhlTeam ? <img src={`https://assets.nhle.com/logos/nhl/svg/${nhlTeam}_light.svg`} alt="" className="h-9 w-9 object-contain" /> : <PositionBadge position={position(row)} />}</div><div className="min-w-0 flex-1"><Link to={`/player-profile?playerId=${apiId}`} className="block truncate text-sm font-black text-gray-900 hover:text-brand-500 dark:text-white">{playerName(row)}</Link><p className="mt-0.5 truncate text-[10px] font-semibold text-gray-500"><PositionBadge position={position(row)} className="mr-1" />{formatFantasyPoints(playerScore(row))} FPTS · {money.format(row.salary || 0)}</p></div><span className="shrink-0 rounded-md bg-orange-100 px-2 py-1 text-[9px] font-black uppercase text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">Expiring</span></article>; })}</div></div>}
          {offersToReview.length === 0 && receivedInterest.length === 0 && missingPositions.length === 0 && restrictedFreeAgents.length === 0 && finalContractYear.length === 0 && <div className="rounded-xl border border-dashed border-success-300 bg-success-50 p-7 text-center dark:border-success-500/30 dark:bg-success-500/10"><p className="font-bold text-success-700 dark:text-success-300">You’re all caught up.</p><p className="mt-1 text-sm text-success-600/80 dark:text-success-300/80">No urgent roster, contract, or trade decisions right now.</p></div>}
        </div>
        <div className="mt-6 border-t border-gray-200 pt-5 dark:border-gray-800">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><p className="text-xs font-bold uppercase tracking-wider text-violet-500">Market radar</p>{radarMode === "needs" && marketRadar.needs.map((code) => <PositionBadge key={code} position={code} />)}</div><div className="inline-flex rounded-lg border border-violet-200 bg-white p-1 dark:border-violet-500/30 dark:bg-gray-900"><button type="button" onClick={() => setRadarMode("needs")} className={`rounded-md px-2.5 py-1 text-[10px] font-black transition ${radarMode === "needs" ? "bg-violet-600 text-white" : "text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>My Needs</button><button type="button" onClick={() => setRadarMode("all")} className={`rounded-md px-2.5 py-1 text-[10px] font-black transition ${radarMode === "all" ? "bg-violet-600 text-white" : "text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>All Positions</button></div></div>
          {(radarMode === "needs" ? marketRadar.candidates : marketRadar.allCandidates).length ? <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{(radarMode === "needs" ? marketRadar.candidates : marketRadar.allCandidates).map((row) => <article key={row.id} className="flex min-w-0 flex-col rounded-xl border border-violet-100 bg-violet-50/50 p-3 dark:border-violet-500/20 dark:bg-violet-500/[0.06]"><div className="flex min-w-0 items-center gap-2"><PositionBadge position={position(row)} /><Link to={`/player-profile?playerId=${row.player?.player_api_id}`} className="truncate text-sm font-bold text-gray-900 hover:text-violet-600 dark:text-white">{playerName(row)}</Link></div><p className="mt-1 truncate text-[11px] text-gray-500">{row.fantasy_team?.team_name} · {formatFantasyPoints(playerScore(row))} FPTS</p><p className="mt-1 text-[11px] font-semibold text-violet-700 dark:text-violet-300">{row.salary == null ? "No salary" : money.format(row.salary)} · {row.term_end_year === season ? "Expiring" : "1 year left"}</p><Link to={`/trade-manager?fromTeam=${teamId}&toTeam=${row.fantasy_team_id}&playerSeason=${row.id}&season=${season}`} className="mt-2 text-xs font-bold text-violet-600 hover:underline dark:text-violet-300">Explore offer →</Link></article>)}</div> : <p className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-sm text-gray-500 dark:border-gray-700">No strong radar matches right now.</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
        <div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-gray-400">Around your team</p><h2 className="mt-1 text-xl font-bold text-gray-900 dark:text-white">Recent activity</h2></div><Link to="/transactions" className="text-xs font-semibold text-brand-500 hover:underline">View all</Link></div>
        {teamTransactions.length ? <div className="space-y-2">{teamTransactions.map((transaction) => <CompactActivityCard key={transaction.id} transaction={transaction} />)}</div> : <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-700">No recent team transactions.</p>}
      </section>
    </div>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[{ label: "League Chat", detail: "Talk with other managers", to: "/league-chat" }, { label: "Standings", detail: "See the league race", to: "/standings" }, { label: "Auction House", detail: activeAuctions.length ? `${activeAuctions.length} active now` : "Check nominations", to: "/auction-house" }, { label: "League Overview", detail: "Compare cap and rosters", to: "/league-dashboard" }].map((item) => <Link key={item.to} to={item.to} className="group rounded-2xl border border-gray-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-theme-md dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-500/50"><p className="font-bold text-gray-900 group-hover:text-brand-500 dark:text-white">{item.label} →</p><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{item.detail}</p></Link>)}
    </section>
  </div>;
}
