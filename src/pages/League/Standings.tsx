import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { applyTeamBranding, fetchFantasyTeams, fetchTeamBrandingHistory, type FantasyTeam } from "../../lib/fantasyTeams";
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
import { CURRENT_LEAGUE_SEASON, playedAndCurrentSeasons } from "../../lib/leagueSeasons";

const seasonOptions = playedAndCurrentSeasons;

const skaterSlots = [
  ...Array.from({ length: 3 }, (_, index) => ({ key: `C${index + 1}`, position: "C", label: `C${index + 1}`, slotIndex: index })),
  ...Array.from({ length: 3 }, (_, index) => ({ key: `LW${index + 1}`, position: "LW", label: `LW${index + 1}`, slotIndex: index })),
  ...Array.from({ length: 3 }, (_, index) => ({ key: `RW${index + 1}`, position: "RW", label: `RW${index + 1}`, slotIndex: index })),
  ...Array.from({ length: 6 }, (_, index) => ({ key: `D${index + 1}`, position: "D", label: `D${index + 1}`, slotIndex: index })),
];
const goalieSlots = Array.from({ length: 2 }, (_, index) => ({ key: `G${index + 1}`, position: "G", label: `G${index + 1}`, slotIndex: index }));
const standingsSlots = [...skaterSlots, ...goalieSlots];
const positionGroups = ["C", "LW", "RW", "D", "G"].map((position) => ({
  position,
  slots: standingsSlots.filter((slot) => slot.position === position),
}));

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
  return (
    players
    .filter((season) => getPosition(season) === slot.position)
    .map((season) => stats.get(getPlayerApiId(season)))
    .filter((record): record is T => Boolean(record))
    .map(getScore)
    .sort((a, b) => b - a)[slot.slotIndex] || 0
  );
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

function heatMapClass(value: number, values: number[]) {
  if (!values.length) return "bg-white dark:bg-transparent";
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) return "bg-white dark:bg-transparent";

  const position = (value - minimum) / (maximum - minimum);
  if (position >= 0.8) return "bg-red-100/80 dark:bg-red-500/15";
  if (position >= 0.6) return "bg-red-50/70 dark:bg-red-500/8";
  if (position <= 0.2) return "bg-blue-100/80 dark:bg-blue-500/15";
  if (position <= 0.4) return "bg-blue-50/70 dark:bg-blue-500/8";
  return "bg-white dark:bg-transparent";
}

function podiumRankClass(rank: number) {
  if (rank === 1) return "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300";
  if (rank === 2) return "bg-slate-200 text-slate-700 dark:bg-slate-400/20 dark:text-slate-200";
  if (rank === 3) return "bg-orange-100 text-orange-800 dark:bg-orange-700/20 dark:text-orange-300";
  return "text-gray-500 dark:text-gray-400";
}

function TeamCell({ row, season }: { row: StandingsRow; season: number }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${podiumRankClass(row.rank)}`}>
        {row.rank}
      </span>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        {row.team.logo ? (
          <img
            src={row.team.logo}
            alt={`${row.team.team_name} logo`}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="text-xs font-semibold text-gray-500">
            {row.team.abbreviation}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <Link to={`/teams/${row.team.id}?season=${season}`} title={row.team.team_name} className="block truncate text-xs font-semibold text-brand-500 hover:text-brand-600 hover:underline">
          {row.team.team_name}
        </Link>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          {row.team.abbreviation}
        </p>
      </div>
    </div>
  );
}

export default function Standings() {
  const [selectedSeason, setSelectedSeason] = useState(CURRENT_LEAGUE_SEASON);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [playerSeasons, setPlayerSeasons] = useState<PlayerSeasonWithRelations[]>([]);
  const [skaterStats, setSkaterStats] = useState<Map<string, NhlSkaterRecord>>(new Map());
  const [goalieStats, setGoalieStats] = useState<Map<string, NhlGoalieRecord>>(new Map());
  const [showHeatMap, setShowHeatMap] = useState(false);
  const [expandedPositions, setExpandedPositions] = useState<Set<string>>(() => new Set(["C", "LW", "RW", "D", "G"]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");

    Promise.all([
      fetchFantasyTeams(),
      fetchTeamBrandingHistory(),
      fetchPlayerSeasonsBySeason(selectedSeason),
      fetchNhlSkaterStats(nhlSeasonId(selectedSeason)).catch(() => [] as NhlSkaterRecord[]),
      fetchNhlGoalieStats(nhlSeasonId(selectedSeason)).catch(() => [] as NhlGoalieRecord[]),
    ])
      .then(([teamRows, brandingRows, seasonRows, skaters, goalies]) => {
        if (!active) return;

        setTeams(teamRows.map((team) => applyTeamBranding(team, brandingRows, selectedSeason)));
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

  const groupScore = (row: StandingsRow, position: string) => positionGroups
    .find((group) => group.position === position)?.slots
    .reduce((total, slot) => total + (row.slotScores[slot.key] || 0), 0) || 0;
  const groupHeatMapValues = Object.fromEntries(positionGroups.map((group) => [
    group.position,
    standings.map((row) => groupScore(row, group.position)),
  ]));
  const heatMapValues = Object.fromEntries(standingsSlots.map((slot) => [
    slot.key,
    standings.map((row) => row.slotScores[slot.key] || 0),
  ]));
  const togglePosition = (position: string) => setExpandedPositions((current) => {
    const next = new Set(current);
    if (next.has(position)) next.delete(position); else next.add(position);
    return next;
  });

  return (
    <div>
      <PageMeta
        title="Great Lakes Dynasty Hockey League"
        description="Great Lakes Dynasty Hockey League standings"
      />
      <PageBreadcrumb pageTitle="Standings" />

      <div className="rounded-2xl border border-gray-200 bg-white px-2 py-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-3 xl:px-4">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="font-semibold text-gray-800 text-theme-xl dark:text-white/90">
              Standings
            </h3>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end lg:w-auto">
            <button
              type="button"
              aria-pressed={showHeatMap}
              onClick={() => setShowHeatMap((current) => !current)}
              className={`inline-flex h-11 items-center justify-between gap-3 rounded-lg border px-3.5 text-sm font-medium shadow-theme-xs transition sm:min-w-40 ${showHeatMap ? "border-gray-300 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-white" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"}`}
            >
              <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-gradient-to-br from-blue-400 via-white to-red-400 ring-1 ring-gray-300 dark:ring-gray-600" />Heat map</span>
              <span className={`relative h-5 w-9 rounded-full transition ${showHeatMap ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-600"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${showHeatMap ? "left-[18px]" : "left-0.5"}`} /></span>
            </button>
            <div className="w-full sm:w-44">
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
            <table className="w-full min-w-[1080px] table-fixed divide-y divide-gray-200 text-[11px] dark:divide-gray-800">
              <colgroup>
                <col className="w-[170px]" />
                {positionGroups.flatMap((group) => expandedPositions.has(group.position) ? group.slots.map((slot) => <col key={slot.key} className="w-[46px]" />) : [<col key={group.position} className="w-[54px]" />])}
                <col className="w-[68px]" /><col className="w-[68px]" />
              </colgroup>
              <thead className="bg-gray-50 dark:bg-white/[0.03]">
                <tr>
                  <th rowSpan={2} className="sticky left-0 z-10 bg-gray-50 px-2 py-2 text-left font-semibold text-gray-700 dark:bg-gray-900 dark:text-gray-200">
                    Team
                  </th>
                  {positionGroups.map((group) => {
                    const expanded = expandedPositions.has(group.position);
                    return <th key={group.position} rowSpan={expanded ? 1 : 2} colSpan={expanded ? group.slots.length : 1} className="border-l border-gray-200 px-1 py-1 text-center font-semibold text-gray-700 dark:border-gray-800 dark:text-gray-200">
                      <button type="button" onClick={() => togglePosition(group.position)} aria-expanded={expanded} className="inline-flex items-center justify-center gap-1 rounded px-1.5 py-0.5 hover:bg-gray-200/70 dark:hover:bg-gray-800" title={`${expanded ? "Collapse" : "Expand"} ${group.position} scoring`}><span>{group.position}</span><span className={`text-[8px] text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}>▼</span></button>
                    </th>;
                  })}
                  <th rowSpan={2} className="border-l border-gray-200 px-1 py-2 text-center font-bold text-gray-900 dark:border-gray-800 dark:text-white">
                    Points
                  </th>
                  <th rowSpan={2} className="px-1 py-2 text-center font-semibold text-gray-700 dark:text-gray-200">
                    Behind
                  </th>
                </tr>
                <tr>{positionGroups.flatMap((group) => expandedPositions.has(group.position) ? group.slots.map((slot) => <th key={slot.key} className="border-l border-t border-gray-200 px-0.5 py-1.5 text-center text-[10px] font-semibold text-gray-500 dark:border-gray-800">{slot.label}</th>) : [])}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {standings.map((row) => (
                  <tr
                    key={row.team.id}
                    className="hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                  >
                    <td className="sticky left-0 z-10 bg-white px-2 py-2 dark:bg-gray-900">
                      <TeamCell row={row} season={selectedSeason} />
                    </td>
                    {positionGroups.flatMap((group) => expandedPositions.has(group.position) ? group.slots.map((slot) => <td key={slot.key} className={`whitespace-nowrap border-l border-gray-100 px-0.5 py-3 text-center font-semibold tabular-nums text-gray-700 transition-colors dark:border-gray-800 dark:text-gray-300 ${showHeatMap ? heatMapClass(row.slotScores[slot.key] || 0, heatMapValues[slot.key]) : ""}`}>{formatPoints(row.slotScores[slot.key] || 0)}</td>) : [<td key={group.position} className={`whitespace-nowrap border-l border-gray-100 px-1 py-3 text-center font-bold tabular-nums text-gray-800 transition-colors dark:border-gray-800 dark:text-gray-200 ${showHeatMap ? heatMapClass(groupScore(row, group.position), groupHeatMapValues[group.position]) : ""}`}>{formatPoints(groupScore(row, group.position))}</td>])}
                    <td className="border-l border-gray-100 px-1 py-3 text-center text-xs font-bold text-gray-900 dark:border-gray-800 dark:text-white">
                      {formatPoints(row.points)}
                    </td>
                    <td className="px-1 py-3 text-center text-gray-600 dark:text-gray-300">
                      {row.pointsBehind === 0 ? "-" : formatPoints(row.pointsBehind)}
                    </td>
                  </tr>
                ))}

                <tr className="bg-gray-50 font-medium dark:bg-white/[0.03]">
                  <td className="sticky left-0 z-10 bg-gray-50 px-3 py-3 text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                    Average
                  </td>
                  {positionGroups.flatMap((group) => expandedPositions.has(group.position) ? group.slots.map((slot) => <td key={slot.key} className="whitespace-nowrap border-l border-gray-200 px-2 py-3 text-center tabular-nums text-gray-600 dark:border-gray-800 dark:text-gray-300">{formatPoints(averageRow.slotScores[slot.key] || 0)}</td>) : [<td key={group.position} className="whitespace-nowrap border-l border-gray-200 px-3 py-3 text-center font-semibold tabular-nums text-gray-700 dark:border-gray-800 dark:text-gray-200">{formatPoints(average(standings.map((row) => groupScore(row, group.position))))}</td>])}
                  <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-200">
                    {formatPoints(averageRow.points)}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-400">-</td>
                </tr>

                <tr className="bg-gray-50 font-medium dark:bg-white/[0.03]">
                  <td className="sticky left-0 z-10 bg-gray-50 px-3 py-3 text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                    Median
                  </td>
                  {positionGroups.flatMap((group) => expandedPositions.has(group.position) ? group.slots.map((slot) => <td key={slot.key} className="whitespace-nowrap border-l border-gray-200 px-2 py-3 text-center tabular-nums text-gray-600 dark:border-gray-800 dark:text-gray-300">{formatPoints(medianRow.slotScores[slot.key] || 0)}</td>) : [<td key={group.position} className="whitespace-nowrap border-l border-gray-200 px-3 py-3 text-center font-semibold tabular-nums text-gray-700 dark:border-gray-800 dark:text-gray-200">{formatPoints(median(standings.map((row) => groupScore(row, group.position))))}</td>])}
                  <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-200">
                    {formatPoints(medianRow.points)}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-400">-</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
