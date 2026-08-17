import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { useAuth } from "../../context/AuthContext";
import { CURRENT_LEAGUE_SEASON } from "../../lib/leagueSeasons";
import { fetchPlayerSeasonsByTeamAndSeason, type PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import { fetchLatestUserTeamAssignment, fetchUserTeamAssignment } from "../../lib/teamUserAssignments";
import {
  addPlayerTradeInterest,
  addTradeBlockListing,
  fetchPlayerTradeInterests,
  fetchTradeBlockListings,
  removePlayerTradeInterest,
  removeTradeBlockListing,
  type PlayerTradeInterest,
  type TradeBlockListing,
} from "../../lib/tradeMarket";

const seasons = Array.from({ length: 10 }, (_, index) => 2026 + index);
const tradeablePositions = new Set(["C", "LW", "RW", "D", "G", "RFA", "PROSPECT", "AP"]);
const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

function playerName(season: PlayerSeasonWithRelations | null) {
  const player = season?.player;
  return player?.full_name || [player?.first_name, player?.last_name].filter(Boolean).join(" ") || "Unknown Player";
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unable to update the Trade Market.";
}

export default function TradeMarket() {
  const { user } = useAuth();
  const [season, setSeason] = useState(CURRENT_LEAGUE_SEASON);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [teamName, setTeamName] = useState("");
  const [roster, setRoster] = useState<PlayerSeasonWithRelations[]>([]);
  const [listings, setListings] = useState<TradeBlockListing[]>([]);
  const [interests, setInterests] = useState<PlayerTradeInterest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) return;
      setLoading(true);
      setError("");
      try {
        const assignment = (await fetchUserTeamAssignment(user.id, season)) || (await fetchLatestUserTeamAssignment(user.id));
        const assignedTeamId = assignment?.fantasy_team_id ?? null;
        if (!active) return;
        setTeamId(assignedTeamId);
        setTeamName(assignment?.fantasy_team?.team_name || "Your team");

        if (!assignedTeamId) {
          setRoster([]);
          setListings([]);
          setInterests([]);
          return;
        }

        const [rosterResult, listingsResult, interestsResult] = await Promise.allSettled([
          fetchPlayerSeasonsByTeamAndSeason(assignedTeamId, season),
          fetchTradeBlockListings(season),
          fetchPlayerTradeInterests(season),
        ]);
        if (!active) return;

        if (rosterResult.status === "fulfilled") {
          setRoster(rosterResult.value.filter((row) => tradeablePositions.has((row.position || "").toUpperCase())));
        } else {
          setRoster([]);
        }
        if (listingsResult.status === "fulfilled") setListings(listingsResult.value);
        else setListings([]);
        if (interestsResult.status === "fulfilled") setInterests(interestsResult.value);
        else setInterests([]);

        const failedResult = [rosterResult, listingsResult, interestsResult].find((result) => result.status === "rejected");
        if (failedResult?.status === "rejected") setError(errorMessage(failedResult.reason));
      } catch (err) {
        if (active) setError(errorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [season, user]);

  const listingByPlayerSeason = useMemo(() => new Map(listings.map((listing) => [listing.player_season_id, listing])), [listings]);
  const interestByPlayerSeason = useMemo(() => new Map(interests.filter((interest) => interest.interested_team_id === teamId).map((interest) => [interest.player_season_id, interest])), [interests, teamId]);
  const myListings = listings.filter((listing) => listing.fantasy_team_id === teamId);
  const leagueListings = listings.filter((listing) => listing.fantasy_team_id !== teamId);
  const receivedInterests = interests.filter((interest) => interest.owner_team_id === teamId);

  async function toggleListing(seasonRow: PlayerSeasonWithRelations) {
    if (!user || !teamId) return;
    const current = listingByPlayerSeason.get(seasonRow.id);
    setBusyKey(`listing-${seasonRow.id}`);
    setError(""); setSuccess("");
    try {
      if (current) {
        await removeTradeBlockListing(current.id);
        setListings((rows) => rows.filter((row) => row.id !== current.id));
        setSuccess(`${playerName(seasonRow)} was removed from your trade block.`);
      } else {
        const created = await addTradeBlockListing({ playerSeasonId: seasonRow.id, fantasyTeamId: teamId, seasonYear: season, listedBy: user.id });
        setListings((rows) => [created, ...rows]);
        setSuccess(`${playerName(seasonRow)} is now on your trade block.`);
      }
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusyKey(""); }
  }

  async function toggleInterest(listing: TradeBlockListing) {
    if (!user || !teamId) return;
    const current = interestByPlayerSeason.get(listing.player_season_id);
    setBusyKey(`interest-${listing.player_season_id}`);
    setError(""); setSuccess("");
    try {
      if (current) {
        await removePlayerTradeInterest(current.id);
        setInterests((rows) => rows.filter((row) => row.id !== current.id));
        setSuccess("Your interest was withdrawn.");
      } else {
        const created = await addPlayerTradeInterest({ playerSeasonId: listing.player_season_id, interestedTeamId: teamId, ownerTeamId: listing.fantasy_team_id, seasonYear: season, createdBy: user.id });
        setInterests((rows) => [created, ...rows]);
        setSuccess(`${listing.fantasy_team?.team_name || "The player's team"} was notified privately.`);
      }
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusyKey(""); }
  }

  return <div>
    <PageMeta title="Trade Market | Great Lakes Dynasty" description="Manage your trade block and discover available players" />
    <PageBreadcrumb pageTitle="Trade Market" />
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] xl:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><h1 className="text-xl font-semibold text-gray-900 dark:text-white">Trade Market</h1><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">List players, privately signal interest, and turn conversations into offers.</p></div>
          <div className="w-full sm:w-44"><label htmlFor="market-season" className="mb-1 block text-sm font-medium">Season</label><select id="market-season" value={season} onChange={(event) => setSeason(Number(event.target.value))} className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 dark:border-gray-700 dark:bg-gray-900">{seasons.map((year) => <option key={year}>{year}</option>)}</select></div>
        </div>
        {error && <p className="mt-4 rounded-lg border border-error-200 bg-error-50 p-3 text-sm text-error-700">{error}</p>}
        {success && <p className="mt-4 rounded-lg border border-success-200 bg-success-50 p-3 text-sm text-success-700">{success}</p>}
      </section>

      {loading ? <div className="rounded-2xl border border-gray-200 p-10 text-center text-sm text-gray-500">Loading Trade Market…</div> : !teamId ? <div className="rounded-2xl border border-warning-200 bg-warning-50 p-5 text-sm text-warning-700">Your account is not assigned to a team for this season. Ask an administrator to add the assignment.</div> : <>
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] xl:p-6">
          <div className="mb-4 flex items-end justify-between gap-4"><div><h2 className="text-lg font-semibold text-gray-900 dark:text-white">My Trade Block</h2><p className="text-sm text-gray-500">Choose which {teamName} players the league should see as available.</p></div><span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">{myListings.length} listed</span></div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{roster.map((row) => {
            const listed = listingByPlayerSeason.has(row.id);
            const interestedTeams = receivedInterests.filter((interest) => interest.player_season_id === row.id);
            return <div key={row.id} className={`rounded-xl border p-4 ${listed ? "border-brand-300 bg-brand-50/50" : "border-gray-200 dark:border-gray-800"}`}>
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link to={`/player-profile?playerId=${row.player?.player_api_id}`} className="font-semibold text-brand-500 hover:underline">{playerName(row)}</Link><p className="mt-1 text-xs text-gray-500">{(row.position || "—").toUpperCase()} · {row.salary == null ? "No salary" : money.format(row.salary)}</p></div><button type="button" disabled={busyKey === `listing-${row.id}`} onClick={() => toggleListing(row)} className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50 ${listed ? "border border-error-200 text-error-600 hover:bg-error-50" : "bg-brand-500 text-white hover:bg-brand-600"}`}>{listed ? "Remove" : "List player"}</button></div>
              {interestedTeams.length > 0 && <div className="mt-3 border-t border-gray-200 pt-3"><p className="text-xs font-semibold text-gray-700">Interested teams</p>{interestedTeams.map((interest) => <div key={interest.id} className="mt-2 flex items-center justify-between gap-2 text-xs"><span>{interest.interested_team?.team_name || "Another team"}</span><Link to={`/trade-manager?fromTeam=${teamId}&toTeam=${interest.interested_team_id}&playerSeason=${row.id}&season=${season}`} className="font-semibold text-brand-500 hover:underline">Start Offer</Link></div>)}</div>}
            </div>;
          })}</div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] xl:p-6">
          <div className="mb-4"><h2 className="text-lg font-semibold text-gray-900 dark:text-white">League Trade Block</h2><p className="text-sm text-gray-500">Interest is visible only to your team and the player’s current team.</p></div>
          {leagueListings.length === 0 ? <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">No other teams have listed players for this season yet.</p> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{leagueListings.map((listing) => {
            const row = listing.player_season;
            const interested = interestByPlayerSeason.has(listing.player_season_id);
            return <article key={listing.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <div className="flex items-center gap-3">{listing.fantasy_team?.logo && <img src={listing.fantasy_team.logo} alt="" className="h-10 w-10 rounded-lg object-contain" />}<div className="min-w-0"><Link to={`/player-profile?playerId=${row?.player?.player_api_id}`} className="font-semibold text-brand-500 hover:underline">{playerName(row)}</Link><p className="text-xs text-gray-500">{listing.fantasy_team?.team_name} · {(row?.position || "—").toUpperCase()}</p></div></div>
              <p className="mt-3 text-sm text-gray-600">{row?.salary == null ? "No salary" : money.format(row.salary)}{row?.term_end_year ? ` through ${row.term_end_year}` : ""}</p>
              <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busyKey === `interest-${listing.player_season_id}`} onClick={() => toggleInterest(listing)} className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50 ${interested ? "border border-brand-300 bg-brand-50 text-brand-700" : "border border-gray-300 text-gray-700 hover:border-brand-300 hover:text-brand-600"}`}>{interested ? "★ Interested" : "☆ I'm Interested"}</button><Link to={`/trade-manager?fromTeam=${teamId}&toTeam=${listing.fantasy_team_id}&playerSeason=${listing.player_season_id}&season=${season}`} className="rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600">Start Offer</Link></div>
            </article>;
          })}</div>}
        </section>
      </>}
    </div>
  </div>;
}
