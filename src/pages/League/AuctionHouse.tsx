import { useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { useAuth } from "../../context/AuthContext";
import {
  fetchFantasyPlayers,
  fetchPlayerSeasonsByTeamAndSeason,
  type FantasyPlayer,
  type PlayerSeasonWithRelations,
} from "../../lib/fantasyPlayers";
import {
  fetchMlbPlayerProfile,
  formatStatValue,
  type MlbPlayerProfile,
} from "../../lib/mlb";
import { fetchProfile, upsertProfile } from "../../lib/profiles";
import {
  fetchUserTeamAssignment,
  upsertUserTeamAssignment,
  type TeamUserAssignmentWithTeam,
} from "../../lib/teamUserAssignments";
import { fetchFantasyTeams } from "../../lib/fantasyTeams";

const salaryCap = 47_000_000;
const rosterLimit = 27;
const minimumFutureSalary = 250_000;
const seasonOptions = Array.from({ length: 10 }, (_, index) => 2026 + index);
const nonRosterPositions = new Set(["W", "IR"]);
const permanentTeamAssignments: Record<string, string> = {
  "charlesfoote13@gmail.com": "St Thomas Mallards",
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type AuctionBid = {
  id: number;
  teamName: string;
  aav: number;
  years: number;
  totalValue: number;
  createdAt: string;
};

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatTimer(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getPosition(season: PlayerSeasonWithRelations) {
  return (season.position || "Unassigned").toUpperCase();
}

function getRosterCount(roster: PlayerSeasonWithRelations[]) {
  return roster.filter((season) => !nonRosterPositions.has(getPosition(season))).length;
}

function getPlayerName(player: FantasyPlayer) {
  return (
    player.full_name ||
    [player.first_name, player.last_name].filter(Boolean).join(" ") ||
    "Unknown Player"
  );
}

function getBatterScore(stats: Record<string, string | number | null> | null | undefined) {
  if (!stats) return 0;

  return (
    Number(stats.runs ?? 0) +
    Number(stats.hits ?? 0) +
    Number(stats.doubles ?? 0) +
    Number(stats.triples ?? 0) * 2 +
    Number(stats.homeRuns ?? 0) * 3 +
    Number(stats.rbi ?? 0) +
    Number(stats.stolenBases ?? 0) * 2
  );
}

function getPitcherScore(stats: Record<string, string | number | null> | null | undefined) {
  if (!stats) return 0;

  return (
    Number(stats.wins ?? 0) * 8 +
    Number(stats.strikeOuts ?? 0) +
    Number(stats.saves ?? 0) * 6 +
    Number(stats.completeGames ?? 0) * 5 +
    Number(stats.shutouts ?? 0) * 5
  );
}

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
      <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "bad";
}) {
  const styles = {
    default: "border-gray-200 bg-gray-50 text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-white",
    good: "border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300",
    bad: "border-error-200 bg-error-50 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300",
  };

  return (
    <div className={`rounded-lg border p-3 ${styles[tone]}`}>
      <p className="text-xs font-medium uppercase opacity-75">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

export default function AuctionHouse() {
  const { user } = useAuth();
  const [mode, setMode] = useState<"slow_week" | "fast_live">("slow_week");
  const [selectedSeason, setSelectedSeason] = useState(2027);
  const [assignment, setAssignment] = useState<TeamUserAssignmentWithTeam | null>(null);
  const [roster, setRoster] = useState<PlayerSeasonWithRelations[]>([]);
  const [players, setPlayers] = useState<FantasyPlayer[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [nomineeProfile, setNomineeProfile] = useState<MlbPlayerProfile | null>(null);
  const [aav, setAav] = useState("250000");
  const [years, setYears] = useState("1");
  const [bids, setBids] = useState<AuctionBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingNominee, setLoadingNominee] = useState(false);
  const [error, setError] = useState("");

  const timerSeconds = mode === "slow_week" ? 12 * 60 * 60 : 60;
  const statsSeason = selectedSeason - 1;
  const bidAav = Number(aav) || 0;
  const bidYears = Number(years) || 0;
  const totalValue = bidAav * bidYears;
  const assignedTeam = assignment?.fantasy_team ?? null;
  const activeRosterCount = getRosterCount(roster);
  const salarySpent = roster.reduce((total, season) => total + (season.salary ?? 0), 0);
  const capSpace = salaryCap - salarySpent;
  const openRosterSpots = Math.max(rosterLimit - activeRosterCount, 0);
  const minimumReserveNeeded = openRosterSpots * minimumFutureSalary;
  const auctionBudget = Math.max(capSpace - minimumReserveNeeded, 0);
  const canAffordPreviewBid = totalValue <= auctionBudget;
  const selectedPlayer = players.find((player) => String(player.id) === selectedPlayerId);
  const currentUserBid = bids.find((bid) => bid.teamName === assignedTeam?.team_name);

  const highBid = useMemo(
    () =>
      [...bids].sort((a, b) => {
        if (b.totalValue !== a.totalValue) return b.totalValue - a.totalValue;
        return b.aav - a.aav;
      })[0] ?? null,
    [bids],
  );

  const bidStatus = !currentUserBid
    ? "You have not bid"
    : highBid?.id === currentUserBid.id
    ? "You are high bid"
    : "You have been outbid";

  useEffect(() => {
    let active = true;

    async function loadData() {
      if (!user) return;

      setLoading(true);
      setError("");

      try {
        const [teamRows, playerRows, userAssignment] = await Promise.all([
          fetchFantasyTeams(),
          fetchFantasyPlayers(),
          fetchUserTeamAssignment(user.id, selectedSeason),
        ]);

        let nextAssignment = userAssignment;
        const permanentTeamName =
          permanentTeamAssignments[user.email?.toLowerCase() || ""];
        const permanentTeam = permanentTeamName
          ? teamRows.find(
              (team) =>
                team.team_name.toLowerCase() === permanentTeamName.toLowerCase(),
            )
          : null;

        if (!nextAssignment && permanentTeam && user.email) {
          const profile = await fetchProfile(user.id);
          if (!profile) {
            await upsertProfile({
              userId: user.id,
              email: user.email,
              displayName: null,
            });
          }

          nextAssignment = await upsertUserTeamAssignment({
            userId: user.id,
            userEmail: user.email,
            fantasyTeamId: permanentTeam.id,
            seasonYear: selectedSeason,
          });
        }

        if (!active) return;
        setAssignment(nextAssignment);
        setPlayers(playerRows);

        if (nextAssignment?.fantasy_team_id) {
          const rows = await fetchPlayerSeasonsByTeamAndSeason(
            nextAssignment.fantasy_team_id,
            selectedSeason,
          );
          if (active) setRoster(rows);
        } else {
          setRoster([]);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Unable to load auction room.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadData();

    return () => {
      active = false;
    };
  }, [user, selectedSeason]);

  useEffect(() => {
    let active = true;

    async function loadNominee() {
      const player = players.find((row) => String(row.id) === selectedPlayerId);
      if (!player?.player_api_id) {
        setNomineeProfile(null);
        return;
      }

      setLoadingNominee(true);
      setError("");

      try {
        const profile = await fetchMlbPlayerProfile(
          Number(player.player_api_id),
          statsSeason,
        );
        if (active) setNomineeProfile(profile);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Unable to load nominee profile.");
        }
      } finally {
        if (active) setLoadingNominee(false);
      }
    }

    loadNominee();

    return () => {
      active = false;
    };
  }, [players, selectedPlayerId, statsSeason]);

  function handleSubmitBid() {
    if (!assignedTeam || !selectedPlayer || !canAffordPreviewBid || totalValue <= 0) {
      return;
    }

    const nextBid: AuctionBid = {
      id: Date.now(),
      teamName: assignedTeam.team_name,
      aav: bidAav,
      years: bidYears,
      totalValue,
      createdAt: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    };

    setBids((current) => [nextBid, ...current]);
  }

  const hasPitchingStats = Boolean(nomineeProfile?.pitchingStats);
  const nomineeStats = hasPitchingStats
    ? nomineeProfile?.pitchingStats
    : nomineeProfile?.hittingStats;
  const nomineeScore = hasPitchingStats
    ? getPitcherScore(nomineeProfile?.pitchingStats)
    : getBatterScore(nomineeProfile?.hittingStats);

  return (
    <>
      <PageMeta
        title="Off-Speed | Auction House"
        description="Fantasy baseball Auction House for Off-Speed"
      />
      <PageBreadcrumb pageTitle="Auction House" />

      <div className="space-y-6">
        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                Auction Room
              </p>
              <h1 className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
                Auction House
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Live-room preview for bidding, clock mode, and auction history.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                  Season
                </label>
                <select
                  value={selectedSeason}
                  onChange={(event) => {
                    setSelectedSeason(Number(event.target.value));
                    setSelectedPlayerId("");
                    setBids([]);
                  }}
                  className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 sm:w-36"
                >
                  {seasonOptions.map((season) => (
                    <option key={season} value={season}>
                      {season}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                  Clock Mode
                </label>
                <div className="flex h-11 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-800 dark:bg-gray-900">
                  <button
                    type="button"
                    onClick={() => setMode("slow_week")}
                    className={`rounded-md px-3 text-sm font-medium ${
                      mode === "slow_week"
                        ? "bg-white text-brand-600 shadow-theme-xs dark:bg-gray-800 dark:text-brand-300"
                        : "text-gray-600 dark:text-gray-300"
                    }`}
                  >
                    Week
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("fast_live")}
                    className={`rounded-md px-3 text-sm font-medium ${
                      mode === "fast_live"
                        ? "bg-white text-brand-600 shadow-theme-xs dark:bg-gray-800 dark:text-brand-300"
                        : "text-gray-600 dark:text-gray-300"
                    }`}
                  >
                    Fast
                  </button>
                </div>
              </div>
            </div>
          </div>

          {loading && (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              Loading auction room...
            </p>
          )}
          {error && (
            <div className="mt-4 rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
              {error}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {assignedTeam?.logo ? (
              <img
                src={assignedTeam.logo}
                alt={`${assignedTeam.team_name} logo`}
                className="h-16 w-16 rounded object-contain"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded border border-gray-200 bg-gray-50 text-sm font-semibold text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                Team
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                Your Auction Team
              </p>
              <h2 className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
                {assignedTeam?.team_name || "No team assigned"}
              </h2>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <SummaryItem label="Team" value={assignedTeam?.team_name || "Blank"} />
            <SummaryItem label="Salary Spent" value={formatCurrency(salarySpent)} />
            <SummaryItem
              label="Cap Space"
              value={formatCurrency(capSpace)}
              tone={capSpace >= 0 ? "good" : "bad"}
            />
            <SummaryItem
              label="Roster Spots"
              value={`${activeRosterCount} / ${rosterLimit}`}
              tone={activeRosterCount <= rosterLimit ? "good" : "bad"}
            />
            <SummaryItem label="Open Spots" value={openRosterSpots} />
            <SummaryItem
              label="Auction Budget After Minimum Fill"
              value={formatCurrency(auctionBudget)}
              tone={auctionBudget > 0 ? "good" : "bad"}
            />
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                Current Nomination
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                {nomineeProfile?.playerName || selectedPlayer ? getPlayerName(selectedPlayer!) : "No player nominated"}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Showing {statsSeason} stats for the {selectedSeason} auction.
              </p>
            </div>

            <div className="rounded-lg border border-brand-200 bg-brand-50 px-5 py-4 text-center dark:border-brand-500/30 dark:bg-brand-500/10">
              <p className="text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
                Clock
              </p>
              <p className="mt-1 text-3xl font-semibold text-brand-700 dark:text-brand-300">
                {formatTimer(timerSeconds)}
              </p>
            </div>
          </div>

          <div className="mt-5">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Nomination Preview
            </label>
            <select
              value={selectedPlayerId}
              onChange={(event) => {
                setSelectedPlayerId(event.target.value);
                setBids([]);
              }}
              className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            >
              <option value="">Choose a player</option>
              {players.map((player) => (
                <option key={player.id} value={player.id}>
                  {getPlayerName(player)}
                </option>
              ))}
            </select>
          </div>

          {loadingNominee ? (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              Loading nominee profile...
            </p>
          ) : nomineeProfile ? (
            <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
                  {nomineeProfile.teamLogoUrl ? (
                    <img
                      src={nomineeProfile.teamLogoUrl}
                      alt={`${nomineeProfile.teamName || "MLB team"} logo`}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs font-semibold text-gray-500">
                      MLB
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {nomineeProfile.playerName}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {nomineeProfile.teamAbbreviation} | {nomineeProfile.position}
                  </p>
                </div>
              </div>

              {nomineeStats ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  <StatPill label="G" value={formatStatValue(nomineeStats.gamesPlayed)} />
                  {hasPitchingStats ? (
                    <>
                      <StatPill label="IP" value={formatStatValue(nomineeStats.inningsPitched)} />
                      <StatPill label="W" value={formatStatValue(nomineeStats.wins)} />
                      <StatPill label="SV" value={formatStatValue(nomineeStats.saves)} />
                      <StatPill label="SO" value={formatStatValue(nomineeStats.strikeOuts)} />
                    </>
                  ) : (
                    <>
                      <StatPill label="AB" value={formatStatValue(nomineeStats.atBats)} />
                      <StatPill label="HR" value={formatStatValue(nomineeStats.homeRuns)} />
                      <StatPill label="RBI" value={formatStatValue(nomineeStats.rbi)} />
                      <StatPill label="SB" value={formatStatValue(nomineeStats.stolenBases)} />
                    </>
                  )}
                  <StatPill label="Score" value={nomineeScore} />
                </div>
              ) : (
                <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                  No {statsSeason} MLB stats found for this player.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Select a player to preview profile and prior-season stats.
            </div>
          )}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                AAV
              </label>
              <input
                value={aav}
                onChange={(event) => setAav(event.target.value)}
                inputMode="numeric"
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Years
              </label>
              <input
                value={years}
                onChange={(event) => setYears(event.target.value)}
                inputMode="numeric"
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              />
            </div>
          </div>

          <div
            className={`mt-4 rounded-lg border p-4 ${
              canAffordPreviewBid
                ? "border-success-200 bg-success-50 dark:border-success-500/30 dark:bg-success-500/10"
                : "border-error-200 bg-error-50 dark:border-error-500/30 dark:bg-error-500/10"
            }`}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                  Bid Preview
                </p>
                <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
                  {formatCurrency(totalValue)} total / {formatCurrency(bidAav)} AAV
                </p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {bidYears} {bidYears === 1 ? "year" : "years"} |{" "}
                  {canAffordPreviewBid
                    ? "This preview bid fits the current budget buffer."
                    : "This preview bid would break the current budget buffer."}
                </p>
                <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                  {bidStatus}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSubmitBid}
                disabled={!selectedPlayer || !assignedTeam || !canAffordPreviewBid || totalValue <= 0}
                className="h-11 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Submit Bid
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                Bid History
              </p>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Permanent Auction Log
              </h2>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              Local Preview
            </span>
          </div>

          {bids.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              No bids yet. This section will read from permanent auction bid history once the auction tables and RPC functions are added.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-gray-800">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                    <th className="px-3 py-3">Time</th>
                    <th className="px-3 py-3">Team</th>
                    <th className="px-3 py-3">AAV</th>
                    <th className="px-3 py-3">Years</th>
                    <th className="px-3 py-3">Total</th>
                    <th className="px-3 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {bids.map((bid) => (
                    <tr key={bid.id} className="text-gray-700 dark:text-gray-300">
                      <td className="px-3 py-3">{bid.createdAt}</td>
                      <td className="px-3 py-3 font-medium text-gray-900 dark:text-white">
                        {bid.teamName}
                      </td>
                      <td className="px-3 py-3">{formatCurrency(bid.aav)}</td>
                      <td className="px-3 py-3">{bid.years}</td>
                      <td className="px-3 py-3 font-semibold">
                        {formatCurrency(bid.totalValue)}
                      </td>
                      <td className="px-3 py-3">
                        {highBid?.id === bid.id ? "High bid" : "Outbid"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
