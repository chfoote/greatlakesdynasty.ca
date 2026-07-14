import { useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import Checkbox from "../../components/form/input/Checkbox";
import { useAuth } from "../../context/AuthContext";
import { fetchFantasyTeams, type FantasyTeam } from "../../lib/fantasyTeams";
import {
  fetchPlayerSeasonsByTeamAndSeason,
  type PlayerSeasonWithRelations,
} from "../../lib/fantasyPlayers";
import { fetchMlbStats, type MlbStatRecord } from "../../lib/mlb";
import {
  fetchLatestUserTeamAssignment,
  fetchUserTeamAssignment,
} from "../../lib/teamUserAssignments";
import {
  createTradeOffer,
  dismissTradeOffer,
  fetchTradeOfferDismissals,
  fetchTradeOffers,
  updateTradeOfferStatus,
  type TradeOffer,
  type TradeOfferPlayer,
} from "../../lib/tradeOffers";

const seasonOptions = Array.from({ length: 10 }, (_, index) => 2026 + index);
const salaryCap = 47_000_000;
const rosterLimit = 27;
const positionOrder = ["C", "1B", "2B", "SS", "3B", "OF", "DH", "SP", "RP"];
const pitcherPositions = new Set(["SP", "RP"]);
const nonRosterPositions = new Set(["W", "IR"]);
const dismissableTradeStatuses = new Set(["admin_declined", "completed", "countered"]);

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type MlbPlayerStatMaps = {
  hitting: Map<string, MlbStatRecord>;
  pitching: Map<string, MlbStatRecord>;
};

const emptyMlbPlayerStatMaps = (): MlbPlayerStatMaps => ({
  hitting: new Map(),
  pitching: new Map(),
});

function formatCurrency(value: number | null | undefined) {
  return value === null || value === undefined
    ? "No salary"
    : currencyFormatter.format(value);
}

function formatSignedCurrency(value: number) {
  if (value === 0) return "No cap change";

  const prefix = value > 0 ? "+" : "-";
  return `${prefix}${currencyFormatter.format(Math.abs(value))}`;
}

function formatPlayerChange(value: number) {
  if (value === 0) return "No roster size change";

  const prefix = value > 0 ? "+" : "";
  const playerLabel = Math.abs(value) === 1 ? "Player" : "Players";
  return `${prefix}${value} ${playerLabel}`;
}

function formatImpact(salaryChange: number, rosterChange: number) {
  return `${formatSignedCurrency(salaryChange)} / ${formatPlayerChange(rosterChange)}`;
}

function getErrorMessage(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message;

  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }

  return fallback;
}

function formatScore(score: number) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function formatProjectedValue(currentValue: string | number, projectedValue: string | number) {
  return currentValue === projectedValue
    ? String(currentValue)
    : `${currentValue} -> ${projectedValue}`;
}

function getPlayerName(season: PlayerSeasonWithRelations) {
  const player = season.player;
  return (
    player?.full_name ||
    [player?.first_name, player?.last_name].filter(Boolean).join(" ") ||
    "Unknown Player"
  );
}

function isOlderThanOneDay(value: string | null | undefined) {
  if (!value) return false;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  return Date.now() - date.getTime() > 24 * 60 * 60 * 1000;
}

function getPosition(season: PlayerSeasonWithRelations) {
  return (season.position || "Unassigned").toUpperCase();
}

function getPlayerApiId(season: PlayerSeasonWithRelations) {
  return season.player?.player_api_id || "";
}

function getContractLine(season: PlayerSeasonWithRelations) {
  return `${formatCurrency(season.salary)}${
    season.term_end_year ? ` | ${season.term_end_year}` : ""
  }`;
}

function getBatterScore(record: MlbStatRecord | undefined) {
  if (!record) return 0;

  return (
    Number(record.stats.runs ?? 0) * 1 +
    Number(record.stats.hits ?? 0) * 1 +
    Number(record.stats.doubles ?? 0) * 1 +
    Number(record.stats.triples ?? 0) * 2 +
    Number(record.stats.homeRuns ?? 0) * 3 +
    Number(record.stats.rbi ?? 0) * 1 +
    Number(record.stats.stolenBases ?? 0) * 2
  );
}

function getPitcherScore(record: MlbStatRecord | undefined) {
  if (!record) return 0;

  return (
    Number(record.stats.wins ?? 0) * 8 +
    Number(record.stats.strikeOuts ?? 0) * 1 +
    Number(record.stats.saves ?? 0) * 6 +
    Number(record.stats.completeGames ?? 0) * 5 +
    Number(record.stats.shutouts ?? 0) * 5
  );
}

function getScore(
  season: PlayerSeasonWithRelations,
  mlbPlayerStats: MlbPlayerStatMaps,
) {
  const record = pitcherPositions.has(getPosition(season))
    ? mlbPlayerStats.pitching.get(getPlayerApiId(season))
    : mlbPlayerStats.hitting.get(getPlayerApiId(season));

  return pitcherPositions.has(getPosition(season))
    ? getPitcherScore(record)
    : getBatterScore(record);
}

function getDisplayRecord(
  season: PlayerSeasonWithRelations,
  mlbPlayerStats: MlbPlayerStatMaps,
) {
  const apiId = getPlayerApiId(season);
  return pitcherPositions.has(getPosition(season))
    ? mlbPlayerStats.pitching.get(apiId) || mlbPlayerStats.hitting.get(apiId)
    : mlbPlayerStats.hitting.get(apiId) || mlbPlayerStats.pitching.get(apiId);
}

function getPositionRank(position: string) {
  const index = positionOrder.indexOf(position);
  return index === -1 ? positionOrder.length : index;
}

function sortRoster(
  roster: PlayerSeasonWithRelations[],
  mlbPlayerStats: MlbPlayerStatMaps,
) {
  return [...roster].sort((a, b) => {
    const aPositionRank = getPositionRank(getPosition(a));
    const bPositionRank = getPositionRank(getPosition(b));

    if (aPositionRank !== bPositionRank) {
      return aPositionRank - bPositionRank;
    }

    const aScore = getScore(a, mlbPlayerStats);
    const bScore = getScore(b, mlbPlayerStats);

    if (bScore !== aScore) {
      return bScore - aScore;
    }

    return getPlayerName(a).localeCompare(getPlayerName(b));
  });
}

function sumSalary(players: PlayerSeasonWithRelations[]) {
  return players.reduce((total, season) => total + (season.salary ?? 0), 0);
}

function getTradeableRoster(roster: PlayerSeasonWithRelations[]) {
  return roster.filter((season) => !nonRosterPositions.has(getPosition(season)));
}

function getRosterCount(roster: PlayerSeasonWithRelations[]) {
  return getTradeableRoster(roster).length;
}

function ComplianceItem({
  label,
  value,
  status,
}: {
  label: string;
  value: string | number;
  status?: "good" | "bad";
}) {
  const statusStyles = {
    good: "border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300",
    bad: "border-error-200 bg-error-50 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300",
  };

  return (
    <div
      className={`rounded-lg border p-3 ${
        status
          ? statusStyles[status]
          : "border-gray-200 bg-gray-50 text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-white"
      }`}
    >
      <p className="text-xs font-medium uppercase opacity-75">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function TradeSummaryCard({
  teamName,
  sourceTeamName,
  players,
  tradeNotes,
}: {
  teamName: string;
  sourceTeamName: string;
  players: PlayerSeasonWithRelations[];
  tradeNotes: string;
}) {
  const trimmedNotes = tradeNotes.trim();

  return (
    <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
      <p className="text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
        Trade Summary
      </p>
      <h3 className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
        {teamName} receives
      </h3>
      {players.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          No players selected from {sourceTeamName}.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {players.map((season) => (
            <li
              key={season.id}
              className="text-sm text-gray-700 dark:text-gray-300"
            >
              <span className="font-medium">{getPlayerName(season)}</span>
              <span className="text-gray-500 dark:text-gray-400">
                {" "}
                ({getContractLine(season)})
              </span>
            </li>
          ))}
        </ul>
      )}
      {trimmedNotes && (
        <div className="mt-4 rounded-lg border border-brand-200 bg-white/70 p-3 dark:border-brand-500/20 dark:bg-gray-950/30">
          <p className="text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
            Notes
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
            {trimmedNotes}
          </p>
        </div>
      )}
    </div>
  );
}

function TradeOfferPlayerList({ players }: { players: TradeOfferPlayer[] }) {
  if (!players.length) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Notes-only offer.
      </p>
    );
  }

  return (
    <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
      {players.map((player) => (
        <li key={player.id}>
          <span className="font-medium">
            {player.player_season?.player?.full_name || "Unknown Player"}
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            {" "}
            ({player.from_team?.abbreviation || "?"} to{" "}
            {player.to_team?.abbreviation || "?"})
          </span>
        </li>
      ))}
    </ul>
  );
}

function TradeOfferCard({
  offer,
  canRespond,
  canRevoke,
  canDismiss,
  responding,
  onAccept,
  onDecline,
  onCounter,
  onRevoke,
  onDismiss,
}: {
  offer: TradeOffer;
  canRespond: boolean;
  canRevoke: boolean;
  canDismiss: boolean;
  responding: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCounter: () => void;
  onRevoke: () => void;
  onDismiss: () => void;
}) {
  const statusStyles = {
    pending: "bg-warning-50 text-warning-700 ring-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:ring-warning-500/30",
    accepted: "bg-success-50 text-success-700 ring-success-200 dark:bg-success-500/10 dark:text-success-300 dark:ring-success-500/30",
    declined: "bg-error-50 text-error-700 ring-error-200 dark:bg-error-500/10 dark:text-error-300 dark:ring-error-500/30",
    admin_declined: "bg-error-50 text-error-700 ring-error-200 dark:bg-error-500/10 dark:text-error-300 dark:ring-error-500/30",
    completed: "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/30",
    countered: "bg-gray-100 text-gray-700 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700",
    revoked: "bg-gray-100 text-gray-700 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700",
  };

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {offer.from_team?.team_name || "Unknown Team"} to{" "}
              {offer.to_team?.team_name || "Unknown Team"}
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ring-1 ${
                statusStyles[offer.status]
              }`}
            >
              {offer.status.replace("_", " ")}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Offer #{offer.id} | {offer.season_year}
          </p>
        </div>

        {canRespond && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onAccept}
              disabled={responding}
              className="rounded-lg bg-success-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-success-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={onDecline}
              disabled={responding}
              className="rounded-lg border border-error-200 px-3 py-2 text-xs font-semibold text-error-600 transition hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-error-500/30 dark:text-error-300 dark:hover:bg-error-500/10"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={onCounter}
              disabled={responding}
              className="rounded-lg border border-brand-200 px-3 py-2 text-xs font-semibold text-brand-600 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-500/30 dark:text-brand-300 dark:hover:bg-brand-500/10"
            >
              Counter
            </button>
          </div>
        )}

        {canRevoke && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onRevoke}
              disabled={responding}
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Revoke
            </button>
          </div>
        )}

        {canDismiss && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDismiss}
              disabled={responding}
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Discard Notification
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
            {offer.to_team?.team_name || "Receiving Team"} receives
          </p>
          <TradeOfferPlayerList
            players={offer.trade_offer_players.filter(
              (player) => player.to_team_id === offer.to_team_id,
            )}
          />
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
            {offer.from_team?.team_name || "Offering Team"} receives
          </p>
          <TradeOfferPlayerList
            players={offer.trade_offer_players.filter(
              (player) => player.to_team_id === offer.from_team_id,
            )}
          />
        </div>
      </div>

      {offer.notes && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/30">
          <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
            Notes
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
            {offer.notes}
          </p>
        </div>
      )}
    </article>
  );
}

type TeamColumnProps = {
  label: string;
  teams: FantasyTeam[];
  selectedTeamId: string;
  otherTeamId: string;
  onTeamChange: (teamId: string) => void;
  roster: PlayerSeasonWithRelations[];
  selectedIds: Set<number>;
  onTogglePlayer: (playerSeasonId: number, checked: boolean) => void;
  loading: boolean;
  mlbPlayerStats: MlbPlayerStatMaps;
  salaryGoingOut: number;
  salaryComingIn: number;
  netSalaryChange: number;
  netRosterChange: number;
  currentSalary: number;
  currentRosterCount: number;
  teamName: string;
  sourceTeamName: string;
  incomingPlayers: PlayerSeasonWithRelations[];
  tradeNotes: string;
};

function TeamColumn({
  label,
  teams,
  selectedTeamId,
  otherTeamId,
  onTeamChange,
  roster,
  selectedIds,
  onTogglePlayer,
  loading,
  mlbPlayerStats,
  salaryGoingOut,
  salaryComingIn,
  netSalaryChange,
  netRosterChange,
  currentSalary,
  currentRosterCount,
  teamName,
  sourceTeamName,
  incomingPlayers,
  tradeNotes,
}: TeamColumnProps) {
  const selectedTeam = teams.find((team) => String(team.id) === selectedTeamId);
  const tradeableRoster = useMemo(() => getTradeableRoster(roster), [roster]);
  const sortedRoster = useMemo(
    () => sortRoster(tradeableRoster, mlbPlayerStats),
    [tradeableRoster, mlbPlayerStats],
  );
  const projectedSalary = currentSalary + netSalaryChange;
  const projectedCapSpace = salaryCap - projectedSalary;
  const currentCapSpace = salaryCap - currentSalary;
  const projectedRosterCount = currentRosterCount + netRosterChange;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
            {label}
          </p>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {selectedTeam?.team_name || "Select a team"}
          </h2>
        </div>
        {selectedTeam?.logo && (
          <img
            src={selectedTeam.logo}
            alt={`${selectedTeam.team_name} logo`}
            className="h-10 w-10 rounded object-contain"
          />
        )}
      </div>

      <div className="mt-4">
        <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
          Team
        </label>
        <select
          value={selectedTeamId}
          onChange={(event) => onTeamChange(event.target.value)}
          className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
        >
          <option value="">Choose a team</option>
          {teams.map((team) => (
            <option
              key={team.id}
              value={team.id}
              disabled={String(team.id) === otherTeamId}
            >
              {team.team_name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
            Going Out
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            {formatCurrency(salaryGoingOut)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
            Coming In
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            {formatCurrency(salaryComingIn)}
          </p>
        </div>
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 dark:border-brand-500/30 dark:bg-brand-500/10">
          <p className="text-xs font-medium uppercase text-brand-700 dark:text-brand-300">
            Net Impact
          </p>
          <p className="mt-1 text-sm font-semibold text-brand-700 dark:text-brand-300">
            {formatImpact(netSalaryChange, netRosterChange)}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ComplianceItem label="Salary Cap" value={formatCurrency(salaryCap)} />
        <ComplianceItem
          label="Salary Spent"
          value={formatProjectedValue(
            formatCurrency(currentSalary),
            formatCurrency(projectedSalary),
          )}
          status={projectedSalary <= salaryCap ? "good" : "bad"}
        />
        <ComplianceItem
          label={projectedCapSpace >= 0 ? "Cap Space" : "Over Cap"}
          value={formatProjectedValue(
            formatCurrency(Math.abs(currentCapSpace)),
            formatCurrency(Math.abs(projectedCapSpace)),
          )}
          status={projectedCapSpace >= 0 ? "good" : "bad"}
        />
        <ComplianceItem
          label="Roster Size"
          value={formatProjectedValue(
            `${currentRosterCount} / ${rosterLimit}`,
            `${projectedRosterCount} / ${rosterLimit}`,
          )}
          status={projectedRosterCount <= rosterLimit ? "good" : "bad"}
        />
      </div>

      <TradeSummaryCard
        teamName={teamName}
        sourceTeamName={sourceTeamName}
        players={incomingPlayers}
        tradeNotes={tradeNotes}
      />

      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            Roster
          </p>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {tradeableRoster.length} Tradeable Players
          </span>
        </div>

        {!selectedTeamId ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            Select a team to preview its roster.
          </div>
        ) : loading ? (
          <div className="rounded-lg border border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            Loading roster...
          </div>
        ) : tradeableRoster.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            No tradeable active-roster players found for this team and season.
          </div>
        ) : (
          <div className="space-y-2">
            {sortedRoster.map((season) => {
              const checked = selectedIds.has(season.id);
              const record = getDisplayRecord(season, mlbPlayerStats);
              const score = getScore(season, mlbPlayerStats);

              return (
                <div
                  key={season.id}
                  className={`rounded-lg border p-3 transition ${
                    checked
                      ? "border-brand-300 bg-brand-50 dark:border-brand-500/40 dark:bg-brand-500/10"
                      : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={checked}
                      onChange={(nextChecked) =>
                        onTogglePlayer(season.id, nextChecked)
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
                            {record?.teamLogoUrl ? (
                              <img
                                src={record.teamLogoUrl}
                                alt={`${record.teamName} logo`}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <span className="text-[10px] font-semibold text-gray-500">
                                MLB
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                              {getPlayerName(season)}
                            </p>
                            <p className="mt-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                              {getContractLine(season)}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="w-fit rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                            {getPosition(season)}
                          </span>
                          <span className="w-fit rounded-full bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                            Score {formatScore(score)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export default function TradeManager() {
  const { user } = useAuth();
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [team1Id, setTeam1Id] = useState("");
  const [team2Id, setTeam2Id] = useState("");
  const [selectedSeason, setSelectedSeason] = useState(2026);
  const [team1Roster, setTeam1Roster] = useState<PlayerSeasonWithRelations[]>([]);
  const [team2Roster, setTeam2Roster] = useState<PlayerSeasonWithRelations[]>([]);
  const [tradeOffers, setTradeOffers] = useState<TradeOffer[]>([]);
  const [dismissedTradeOfferIds, setDismissedTradeOfferIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [counteringOffer, setCounteringOffer] = useState<TradeOffer | null>(null);
  const [pendingCounterSelection, setPendingCounterSelection] = useState<{
    offerId: number;
    team1Id: string;
    team2Id: string;
    team1PlayerSeasonIds: number[];
    team2PlayerSeasonIds: number[];
  } | null>(null);
  const [team1SelectedIds, setTeam1SelectedIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [team2SelectedIds, setTeam2SelectedIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [tradeNotes, setTradeNotes] = useState("");
  const [mlbPlayerStats, setMlbPlayerStats] = useState<MlbPlayerStatMaps>(
    emptyMlbPlayerStatMaps,
  );
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingTeam1Roster, setLoadingTeam1Roster] = useState(false);
  const [loadingTeam2Roster, setLoadingTeam2Roster] = useState(false);
  const [loadingMlbTeams, setLoadingMlbTeams] = useState(false);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [sendingOffer, setSendingOffer] = useState(false);
  const [respondingOfferId, setRespondingOfferId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    async function loadTeams() {
      setLoadingTeams(true);
      setError("");

      try {
        const teamRows = await fetchFantasyTeams();
        if (active) setTeams(teamRows);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Unable to load teams.");
        }
      } finally {
        if (active) setLoadingTeams(false);
      }
    }

    loadTeams();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function preloadAssignedTeam() {
      if (!user) return;

      try {
        const assignment =
          (await fetchUserTeamAssignment(user.id, selectedSeason)) ||
          (await fetchLatestUserTeamAssignment(user.id));

        if (!active || !assignment?.fantasy_team_id) return;

        const assignedTeamId = String(assignment.fantasy_team_id);
        setTeam1Id(assignedTeamId);
        setTeam2Id((currentTeam2Id) =>
          currentTeam2Id === assignedTeamId ? "" : currentTeam2Id,
        );
      } catch {
        // If a user has no readable assignment, leave the selectors manual.
      }
    }

    preloadAssignedTeam();

    return () => {
      active = false;
    };
  }, [selectedSeason, user]);

  useEffect(() => {
    let active = true;

    async function loadOffers() {
      setLoadingOffers(true);

      try {
        const [offers, dismissals] = await Promise.all([
          fetchTradeOffers(selectedSeason),
          user ? fetchTradeOfferDismissals(user.id) : Promise.resolve([]),
        ]);

        if (active) {
          setTradeOffers(offers);
          setDismissedTradeOfferIds(
            new Set(dismissals.map((dismissal) => dismissal.trade_offer_id)),
          );
        }
      } catch {
        if (active) {
          setTradeOffers([]);
          setDismissedTradeOfferIds(new Set());
        }
      } finally {
        if (active) setLoadingOffers(false);
      }
    }

    loadOffers();

    return () => {
      active = false;
    };
  }, [selectedSeason, success, user]);

  useEffect(() => {
    let active = true;

    async function loadMlbData() {
      setLoadingMlbTeams(true);

      try {
        const [hitters, pitchers] = await Promise.all([
          fetchMlbStats("hitting", selectedSeason),
          fetchMlbStats("pitching", selectedSeason),
        ]);
        const hittingMap = new Map<string, MlbStatRecord>();
        const pitchingMap = new Map<string, MlbStatRecord>();

        hitters.forEach((record) => {
          if (record.playerId) {
            hittingMap.set(String(record.playerId), record);
          }
        });

        pitchers.forEach((record) => {
          if (record.playerId) {
            pitchingMap.set(String(record.playerId), record);
          }
        });

        if (active) {
          setMlbPlayerStats({
            hitting: hittingMap,
            pitching: pitchingMap,
          });
        }
      } catch {
        if (active) setMlbPlayerStats(emptyMlbPlayerStatMaps());
      } finally {
        if (active) setLoadingMlbTeams(false);
      }
    }

    loadMlbData();

    return () => {
      active = false;
    };
  }, [selectedSeason]);

  useEffect(() => {
    let active = true;

    async function loadRoster() {
      setTeam1SelectedIds(new Set());

      if (!team1Id) {
        setTeam1Roster([]);
        return;
      }

      setLoadingTeam1Roster(true);
      setError("");

      try {
        const rows = await fetchPlayerSeasonsByTeamAndSeason(
          Number(team1Id),
          selectedSeason,
        );
        if (active) setTeam1Roster(rows);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Unable to load Team 1 roster.",
          );
        }
      } finally {
        if (active) setLoadingTeam1Roster(false);
      }
    }

    loadRoster();

    return () => {
      active = false;
    };
  }, [team1Id, selectedSeason]);

  useEffect(() => {
    let active = true;

    async function loadRoster() {
      setTeam2SelectedIds(new Set());

      if (!team2Id) {
        setTeam2Roster([]);
        return;
      }

      setLoadingTeam2Roster(true);
      setError("");

      try {
        const rows = await fetchPlayerSeasonsByTeamAndSeason(
          Number(team2Id),
          selectedSeason,
        );
        if (active) setTeam2Roster(rows);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Unable to load Team 2 roster.",
          );
        }
      } finally {
        if (active) setLoadingTeam2Roster(false);
      }
    }

    loadRoster();

    return () => {
      active = false;
    };
  }, [team2Id, selectedSeason]);

  useEffect(() => {
    if (
      !pendingCounterSelection ||
      pendingCounterSelection.team1Id !== team1Id ||
      pendingCounterSelection.team2Id !== team2Id
    ) {
      return;
    }

    setTeam1SelectedIds(new Set(pendingCounterSelection.team1PlayerSeasonIds));
    setTeam2SelectedIds(new Set(pendingCounterSelection.team2PlayerSeasonIds));
    setPendingCounterSelection(null);
  }, [pendingCounterSelection, team1Id, team2Id]);

  const team1OutgoingPlayers = useMemo(
    () =>
      getTradeableRoster(team1Roster).filter((season) =>
        team1SelectedIds.has(season.id),
      ),
    [team1Roster, team1SelectedIds],
  );
  const team2OutgoingPlayers = useMemo(
    () =>
      getTradeableRoster(team2Roster).filter((season) =>
        team2SelectedIds.has(season.id),
      ),
    [team2Roster, team2SelectedIds],
  );

  const team1CurrentSalary = sumSalary(team1Roster);
  const team2CurrentSalary = sumSalary(team2Roster);
  const team1CurrentRosterCount = getRosterCount(team1Roster);
  const team2CurrentRosterCount = getRosterCount(team2Roster);
  const team1OutgoingSalary = sumSalary(team1OutgoingPlayers);
  const team2OutgoingSalary = sumSalary(team2OutgoingPlayers);
  const team1NetSalaryChange = team2OutgoingSalary - team1OutgoingSalary;
  const team2NetSalaryChange = team1OutgoingSalary - team2OutgoingSalary;
  const team1NetRosterChange =
    team2OutgoingPlayers.length - team1OutgoingPlayers.length;
  const team2NetRosterChange =
    team1OutgoingPlayers.length - team2OutgoingPlayers.length;

  function toggleTeam1Player(playerSeasonId: number, checked: boolean) {
    setTeam1SelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(playerSeasonId);
      else next.delete(playerSeasonId);
      return next;
    });
  }

  function toggleTeam2Player(playerSeasonId: number, checked: boolean) {
    setTeam2SelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(playerSeasonId);
      else next.delete(playerSeasonId);
      return next;
    });
  }

  function handleTeam1Change(nextTeamId: string) {
    setTeam1Id(nextTeamId);
    setSuccess("");
    setCounteringOffer(null);
    setPendingCounterSelection(null);
    if (nextTeamId && nextTeamId === team2Id) setTeam2Id("");
  }

  function handleTeam2Change(nextTeamId: string) {
    setTeam2Id(nextTeamId);
    setSuccess("");
    setCounteringOffer(null);
    setPendingCounterSelection(null);
    if (nextTeamId && nextTeamId === team1Id) setTeam1Id("");
  }

  async function handleSendOffer() {
    if (!user || !team1Id || !team2Id) return;

    const playerMoves = [
      ...team1OutgoingPlayers.map((season) => ({
        playerSeasonId: season.id,
        fromTeamId: Number(team1Id),
        toTeamId: Number(team2Id),
      })),
      ...team2OutgoingPlayers.map((season) => ({
        playerSeasonId: season.id,
        fromTeamId: Number(team2Id),
        toTeamId: Number(team1Id),
      })),
    ];

    if (playerMoves.length === 0 && !tradeNotes.trim()) {
      setError("Select at least one player or add trade notes before sending an offer.");
      return;
    }

    setSendingOffer(true);
    setError("");
    setSuccess("");

    try {
      await createTradeOffer({
        seasonYear: selectedSeason,
        fromTeamId: Number(team1Id),
        toTeamId: Number(team2Id),
        createdBy: user.id,
        notes: tradeNotes.trim() || null,
        parentTradeOfferId: counteringOffer?.id ?? null,
        playerMoves,
      });

      if (counteringOffer) {
        await updateTradeOfferStatus({
          tradeOfferId: counteringOffer.id,
          status: "countered",
        });
      }

      setTeam1SelectedIds(new Set());
      setTeam2SelectedIds(new Set());
      setTradeNotes("");
      setCounteringOffer(null);
      setSuccess(
        counteringOffer
          ? `Counter offer sent to ${team2Name}.`
          : `Trade offer sent to ${team2Name}.`,
      );
    } catch (err) {
      setError(getErrorMessage(err, "Unable to send trade offer."));
    } finally {
      setSendingOffer(false);
    }
  }

  async function handleRespondToOffer(
    tradeOfferId: number,
    status: "accepted" | "declined",
  ) {
    setRespondingOfferId(tradeOfferId);
    setError("");
    setSuccess("");

    try {
      const nextOffer = await updateTradeOfferStatus({
        tradeOfferId,
        status,
      });
      setTradeOffers((current) =>
        status === "declined"
          ? current.filter((offer) => offer.id !== nextOffer.id)
          : current.map((offer) => (offer.id === nextOffer.id ? nextOffer : offer)),
      );
      setSuccess(
        status === "accepted"
          ? "Trade accepted and sent to admin for approval."
          : "Trade offer declined.",
      );
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update trade offer."));
    } finally {
      setRespondingOfferId(null);
    }
  }

  function handleStartCounterOffer(offer: TradeOffer) {
    const nextTeam1Id = String(offer.to_team_id);
    const nextTeam2Id = String(offer.from_team_id);
    const team1PlayerSeasonIds = offer.trade_offer_players
      .filter((player) => player.from_team_id === offer.to_team_id)
      .map((player) => player.player_season_id);
    const team2PlayerSeasonIds = offer.trade_offer_players
      .filter((player) => player.from_team_id === offer.from_team_id)
      .map((player) => player.player_season_id);

    setTeam1Id(nextTeam1Id);
    setTeam2Id(nextTeam2Id);
    setCounteringOffer(offer);
    setPendingCounterSelection({
      offerId: offer.id,
      team1Id: nextTeam1Id,
      team2Id: nextTeam2Id,
      team1PlayerSeasonIds,
      team2PlayerSeasonIds,
    });
    setTradeNotes(offer.notes ? `Counter to offer #${offer.id}\n\n${offer.notes}` : "");
    setSuccess(`Countering offer #${offer.id}. Adjust the players below and submit the counter offer.`);
    setError("");
  }

  async function handleRevokeOffer(tradeOfferId: number) {
    setRespondingOfferId(tradeOfferId);
    setError("");
    setSuccess("");

    try {
      const nextOffer = await updateTradeOfferStatus({
        tradeOfferId,
        status: "revoked",
      });
      setTradeOffers((current) =>
        current.filter((offer) => offer.id !== nextOffer.id),
      );
      setSuccess("Trade offer revoked.");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to revoke trade offer."));
    } finally {
      setRespondingOfferId(null);
    }
  }

  async function handleDismissOffer(tradeOfferId: number) {
    if (!user) return;

    setRespondingOfferId(tradeOfferId);
    setError("");
    setSuccess("");

    try {
      await dismissTradeOffer(tradeOfferId, user.id);
      setDismissedTradeOfferIds((current) => {
        const next = new Set(current);
        next.add(tradeOfferId);
        return next;
      });
      setSuccess("Trade notification discarded.");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to discard trade notification."));
    } finally {
      setRespondingOfferId(null);
    }
  }

  const team1Name =
    teams.find((team) => String(team.id) === team1Id)?.team_name || "Team 1";
  const team2Name =
    teams.find((team) => String(team.id) === team2Id)?.team_name || "Team 2";
  const visibleTradeOffers = tradeOffers.filter(
    (offer) =>
      !["declined", "revoked"].includes(offer.status) &&
      !dismissedTradeOfferIds.has(offer.id) &&
      !(
        dismissableTradeStatuses.has(offer.status) &&
        isOlderThanOneDay(
          offer.completed_at ||
            offer.admin_reviewed_at ||
            offer.declined_at ||
            offer.updated_at,
        )
      ),
  );
  const pendingOffers = visibleTradeOffers.filter(
    (offer) => offer.status === "pending",
  );
  const otherOffers = visibleTradeOffers.filter(
    (offer) => offer.status !== "pending",
  );

  return (
    <>
      <PageMeta
        title="Great Lakes Dynasty Hockey League"
        description="Manage GLDHL fantasy hockey trades"
      />
      <PageBreadcrumb pageTitle="Trade Manager" />

      <div className="space-y-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                Preview Only
              </p>
              <h1 className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
                Trade Manager
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Simulate roster and salary impact without saving changes.
              </p>
            </div>

            <div className="w-full lg:w-48">
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Season
              </label>
              <select
                value={selectedSeason}
                onChange={(event) => setSelectedSeason(Number(event.target.value))}
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              >
                {seasonOptions.map((season) => (
                  <option key={season} value={season}>
                    {season}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(loadingTeams || loadingMlbTeams) && (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              Loading trade data...
            </p>
          )}
          {error && (
            <div className="mt-4 rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
              {error}
            </div>
          )}
          {success && (
            <div className="mt-4 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300">
              {success}
            </div>
          )}
        </div>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                Trade Offers
              </p>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Inbox and Sent Offers
              </h2>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {visibleTradeOffers.length} Offers
            </span>
          </div>

          {loadingOffers ? (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              Loading trade offers...
            </p>
          ) : visibleTradeOffers.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              No trade offers for this season yet.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {pendingOffers.map((offer) => (
                <TradeOfferCard
                  key={offer.id}
                  offer={offer}
                  canRespond={String(offer.to_team_id) === team1Id}
                  canRevoke={String(offer.from_team_id) === team1Id}
                  canDismiss={false}
                  responding={respondingOfferId === offer.id}
                  onAccept={() => handleRespondToOffer(offer.id, "accepted")}
                  onDecline={() => handleRespondToOffer(offer.id, "declined")}
                  onCounter={() => handleStartCounterOffer(offer)}
                  onRevoke={() => handleRevokeOffer(offer.id)}
                  onDismiss={() => undefined}
                />
              ))}
              {otherOffers.map((offer) => (
                <TradeOfferCard
                  key={offer.id}
                  offer={offer}
                  canRespond={false}
                  canRevoke={false}
                  canDismiss={dismissableTradeStatuses.has(offer.status)}
                  responding={respondingOfferId === offer.id}
                  onAccept={() => undefined}
                  onDecline={() => undefined}
                  onCounter={() => undefined}
                  onRevoke={() => undefined}
                  onDismiss={() => handleDismissOffer(offer.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <label
            htmlFor="trade-notes"
            className="block text-sm font-semibold text-gray-900 dark:text-white"
          >
            Trade Notes
          </label>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Add prospects, non-rostered pieces, picks, conditions, or other context.
          </p>
          {counteringOffer && (
            <div className="mt-3 flex flex-col gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Countering offer #{counteringOffer.id}. The original players are selected below.
              </span>
              <button
                type="button"
                onClick={() => {
                  setCounteringOffer(null);
                  setPendingCounterSelection(null);
                  setTeam1SelectedIds(new Set());
                  setTeam2SelectedIds(new Set());
                  setTradeNotes("");
                  setSuccess("");
                }}
                className="w-fit rounded-lg border border-brand-200 px-3 py-2 text-xs font-semibold transition hover:bg-white/70 dark:border-brand-500/30 dark:hover:bg-gray-950/30"
              >
                Cancel Counter
              </button>
            </div>
          )}
          <textarea
            id="trade-notes"
            value={tradeNotes}
            onChange={(event) => setTradeNotes(event.target.value)}
            rows={4}
            placeholder="Example: Team 1 also receives non-rostered prospect Roman Anthony."
            className="mt-3 min-h-28 w-full resize-y rounded-lg border border-gray-300 bg-transparent px-4 py-3 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Sending creates a pending offer for the other manager. Players move only after admin approval.
            </p>
            <button
              type="button"
              onClick={handleSendOffer}
              disabled={
                sendingOffer ||
                !team1Id ||
                !team2Id ||
                (!team1OutgoingPlayers.length &&
                  !team2OutgoingPlayers.length &&
                  !tradeNotes.trim())
              }
              className="h-11 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sendingOffer
                ? "Sending..."
                : counteringOffer
                  ? "Submit Counter Offer"
                  : "Send Offer"}
            </button>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <TeamColumn
            label="Team 1"
            teams={teams}
            selectedTeamId={team1Id}
            otherTeamId={team2Id}
            onTeamChange={handleTeam1Change}
            roster={team1Roster}
            selectedIds={team1SelectedIds}
            onTogglePlayer={toggleTeam1Player}
            loading={loadingTeam1Roster}
            mlbPlayerStats={mlbPlayerStats}
            salaryGoingOut={team1OutgoingSalary}
            salaryComingIn={team2OutgoingSalary}
            netSalaryChange={team1NetSalaryChange}
            netRosterChange={team1NetRosterChange}
            currentSalary={team1CurrentSalary}
            currentRosterCount={team1CurrentRosterCount}
            teamName={team1Name}
            sourceTeamName={team2Name}
            incomingPlayers={team2OutgoingPlayers}
            tradeNotes={tradeNotes}
          />

          <TeamColumn
            label="Team 2"
            teams={teams}
            selectedTeamId={team2Id}
            otherTeamId={team1Id}
            onTeamChange={handleTeam2Change}
            roster={team2Roster}
            selectedIds={team2SelectedIds}
            onTogglePlayer={toggleTeam2Player}
            loading={loadingTeam2Roster}
            mlbPlayerStats={mlbPlayerStats}
            salaryGoingOut={team2OutgoingSalary}
            salaryComingIn={team1OutgoingSalary}
            netSalaryChange={team2NetSalaryChange}
            netRosterChange={team2NetRosterChange}
            currentSalary={team2CurrentSalary}
            currentRosterCount={team2CurrentRosterCount}
            teamName={team2Name}
            sourceTeamName={team1Name}
            incomingPlayers={team1OutgoingPlayers}
            tradeNotes={tradeNotes}
          />
        </div>
      </div>
    </>
  );
}
