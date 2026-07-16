import { useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { fetchFantasyTeams, type FantasyTeam } from "../../lib/fantasyTeams";
import {
  fetchPlayerSeasonsBySeason,
  type PlayerSeasonWithRelations,
} from "../../lib/fantasyPlayers";
import {
  fetchNhlGoalieStats,
  fetchNhlSkaterStats,
  getGoalieScore,
  getSkaterScore,
  type NhlGoalieRecord,
  type NhlSkaterRecord,
} from "../../lib/nhl";

const seasonOptions = Array.from({ length: 10 }, (_, index) => 2026 + index);

const skaterSlots = [
  ...Array.from({ length: 3 }, (_, index) => ({ key: `C${index + 1}`, position: "C", label: `C${index + 1}`, slotIndex: index })),
  ...Array.from({ length: 3 }, (_, index) => ({ key: `LW${index + 1}`, position: "LW", label: `LW${index + 1}`, slotIndex: index })),
  ...Array.from({ length: 3 }, (_, index) => ({ key: `RW${index + 1}`, position: "RW", label: `RW${index + 1}`, slotIndex: index })),
  ...Array.from({ length: 6 }, (_, index) => ({ key: `D${index + 1}`, position: "D", label: `D${index + 1}`, slotIndex: index })),
];
const goalieSlots = Array.from({ length: 2 }, (_, index) => ({ key: `G${index + 1}`, position: "G", label: `G${index + 1}`, slotIndex: index }));
const standingsSlots = [...skaterSlots, ...goalieSlots];

type StandingsRow = {
  team: FantasyTeam;
  rank: number;
  slotScores: Record<string, number>;
  points: number;
  pointsBehind: number;
};

function getPlayerApiId(season: PlayerSeasonWithRelations) {
  return season.player?.player_api_id || "";
}

function getPosition(season: PlayerSeasonWithRelations) {
  return (season.position || "").toUpperCase();
}

function scoreSlot<T>(
  players: PlayerSeasonWithRelations[],
  slot: { position: string; slotIndex: number },
  stats: Map<string, T>,
  getScore: (record: T) => number,
) {
  return players
    .filter((season) => getPosition(season) === slot.position)
    .map((season) => stats.get(getPlayerApiId(season)))
    .filter((record): record is T => Boolean(record))
    .map(getScore)
    .sort((a, b) => b - a)
    [slot.slotIndex] || 0;
}

function nhlSeasonId(year: number) {
  return (year - 1) * 10000 + year;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: number[]) {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatPoints(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function TeamCell({ row }: { row: StandingsRow }) {
  return (
    <div className="flex min-w-56 items-center gap-3">
      <span className="w-8 shrink-0 text-sm font-semibold text-gray-500 dark:text-gray-400">
        {row.rank}
      </span>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
        {row.team.logo ? (
          <img
            src={row.team.logo}
            alt={`${row.team.team_name} logo`}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-xs font-semibold text-gray-500">
            {row.team.abbreviation}
          </span>
        )}
      </div>
      <div>
        <p className="font-medium text-gray-800 dark:text-white/90">
          {row.team.team_name}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {row.team.abbreviation}
        </p>
      </div>
    </div>
  );
}

export default function Standings() {
  const [selectedSeason, setSelectedSeason] = useState(2026);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [playerSeasons, setPlayerSeasons] = useState<PlayerSeasonWithRelations[]>([]);
  const [skaterStats, setSkaterStats] = useState<Map<string, NhlSkaterRecord>>(new Map());
  const [goalieStats, setGoalieStats] = useState<Map<string, NhlGoalieRecord>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");

    Promise.all([
      fetchFantasyTeams(),
      fetchPlayerSeasonsBySeason(selectedSeason),
      fetchNhlSkaterStats(nhlSeasonId(selectedSeason)),
      fetchNhlGoalieStats(nhlSeasonId(selectedSeason)),
    ])
      .then(([teamRows, seasonRows, skaters, goalies]) => {
        if (!active) return;

        setTeams(teamRows);
        setPlayerSeasons(seasonRows);
        setSkaterStats(new Map(skaters.map((record) => [String(record.playerId), record])));
        setGoalieStats(new Map(goalies.map((record) => [String(record.playerId), record])));
      })
      .catch((err) => {
        if (active) {
          setError(err.message || "Unable to load standings.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedSeason]);

  const standings = useMemo<StandingsRow[]>(() => {
    const rows = teams.map((team) => {
      const teamPlayers = playerSeasons.filter(
        (season) => season.fantasy_team_id === team.id,
      );
      const slotScores: Record<string, number> = {};

      skaterSlots.forEach((slot) => {
        slotScores[slot.key] = scoreSlot(teamPlayers, slot, skaterStats, getSkaterScore);
      });

      goalieSlots.forEach((slot) => {
        slotScores[slot.key] = scoreSlot(teamPlayers, slot, goalieStats, getGoalieScore);
      });

      return {
        team,
        rank: 0,
        slotScores,
        points: standingsSlots.reduce(
          (total, slot) => total + (slotScores[slot.key] || 0),
          0,
        ),
        pointsBehind: 0,
      };
    });

    const sortedRows = rows.sort((a, b) => b.points - a.points);
    const leaderPoints = sortedRows[0]?.points ?? 0;

    return sortedRows.map((row, index) => ({
      ...row,
      rank: index + 1,
      pointsBehind: leaderPoints - row.points,
    }));
  }, [teams, playerSeasons, skaterStats, goalieStats]);

  const averageRow = useMemo(() => {
    const slotScores = Object.fromEntries(
      standingsSlots.map((slot) => [
        slot.key,
        average(standings.map((row) => row.slotScores[slot.key] || 0)),
      ]),
    );

    return {
      slotScores,
      points: average(standings.map((row) => row.points)),
    };
  }, [standings]);

  const medianRow = useMemo(() => {
    const slotScores = Object.fromEntries(
      standingsSlots.map((slot) => [
        slot.key,
        median(standings.map((row) => row.slotScores[slot.key] || 0)),
      ]),
    );

    return {
      slotScores,
      points: median(standings.map((row) => row.points)),
    };
  }, [standings]);

  return (
    <div>
      <PageMeta
        title="Great Lakes Dynasty Hockey League"
        description="Great Lakes Dynasty Hockey League standings"
      />
      <PageBreadcrumb pageTitle="Standings" />

      <div className="rounded-2xl border border-gray-200 bg-white px-4 py-5 dark:border-gray-800 dark:bg-white/[0.03] xl:px-6">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="font-semibold text-gray-800 text-theme-xl dark:text-white/90">
              Standings
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Top 3 centers, left wings and right wings, top 6 defence, and top 2 goalies using GLDHL scoring.
            </p>
          </div>

          <div className="w-full lg:w-44">
            <label
              htmlFor="standings_season"
              className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
            >
              Season
            </label>
            <select
              id="standings_season"
              value={selectedSeason}
              onChange={(event) => setSelectedSeason(Number(event.target.value))}
              className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            >
              {seasonOptions.map((season) => (
                <option key={season} value={season}>
                  {season}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading && (
          <div className="rounded-lg border border-dashed border-gray-200 px-5 py-10 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            Loading standings...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400">
            {error}
          </div>
        )}

        {!loading && !error && standings.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-200 px-5 py-10 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            No teams have been added yet.
          </div>
        )}

        {!loading && !error && standings.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-white/[0.03]">
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-3 py-3 text-left font-semibold text-gray-700 dark:bg-gray-900 dark:text-gray-200">
                    Team
                  </th>
                  {standingsSlots.map((slot) => (
                    <th
                      key={slot.key}
                      className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200"
                    >
                      {slot.label}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">
                    Points
                  </th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">
                    Behind
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {standings.map((row) => (
                  <tr
                    key={row.team.id}
                    className="hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                  >
                    <td className="sticky left-0 z-10 bg-white px-3 py-3 dark:bg-gray-900">
                      <TeamCell row={row} />
                    </td>
                    {standingsSlots.map((slot) => (
                      <td
                        key={slot.key}
                        className="px-3 py-3 text-center font-medium text-gray-700 dark:text-gray-300"
                      >
                        {formatPoints(row.slotScores[slot.key] || 0)}
                      </td>
                    ))}
                    <td className="px-3 py-3 text-center font-semibold text-gray-900 dark:text-white">
                      {formatPoints(row.points)}
                    </td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">
                      {row.pointsBehind === 0 ? "-" : formatPoints(row.pointsBehind)}
                    </td>
                  </tr>
                ))}

                <tr className="bg-gray-50 font-medium dark:bg-white/[0.03]">
                  <td className="sticky left-0 z-10 bg-gray-50 px-3 py-3 text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                    Average
                  </td>
                  {standingsSlots.map((slot) => (
                    <td
                      key={slot.key}
                      className="px-3 py-3 text-center text-gray-600 dark:text-gray-300"
                    >
                      {formatPoints(averageRow.slotScores[slot.key] || 0)}
                    </td>
                  ))}
                  <td className="px-3 py-3 text-center text-gray-700 dark:text-gray-200">
                    {formatPoints(averageRow.points)}
                  </td>
                  <td className="px-3 py-3 text-center text-gray-400">-</td>
                </tr>

                <tr className="bg-gray-50 font-medium dark:bg-white/[0.03]">
                  <td className="sticky left-0 z-10 bg-gray-50 px-3 py-3 text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                    Median
                  </td>
                  {standingsSlots.map((slot) => (
                    <td
                      key={slot.key}
                      className="px-3 py-3 text-center text-gray-600 dark:text-gray-300"
                    >
                      {formatPoints(medianRow.slotScores[slot.key] || 0)}
                    </td>
                  ))}
                  <td className="px-3 py-3 text-center text-gray-700 dark:text-gray-200">
                    {formatPoints(medianRow.points)}
                  </td>
                  <td className="px-3 py-3 text-center text-gray-400">-</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
