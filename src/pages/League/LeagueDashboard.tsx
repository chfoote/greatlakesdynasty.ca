import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { applyTeamBranding, fetchFantasyTeams, fetchTeamBrandingHistory, type FantasyTeam } from "../../lib/fantasyTeams";
import { fetchPlayerSeasonsBySeason, type PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import { CURRENT_LEAGUE_SEASON, dashboardSeasons } from "../../lib/leagueSeasons";

const seasonOptions = dashboardSeasons;
const rosterLimit = 23;
const positionMinimums = { C: 3, LW: 3, RW: 3, D: 6, G: 2 } as const;
const activePositions = new Set(Object.keys(positionMinimums));
const capPositions = new Set([...activePositions, "W", "IR", "RETENTION", "BUYOUT"]);
const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

function salaryCapForSeason(year: number) {
  return year <= 2026 ? 45_000_000 : 50_000_000;
}

function position(season: PlayerSeasonWithRelations) {
  return (season.position || "").toUpperCase();
}

type DashboardRow = {
  team: FantasyTeam;
  salarySpent: number;
  capSpace: number;
  rosterSize: number;
  counts: Record<keyof typeof positionMinimums, number>;
};

export default function LeagueDashboard() {
  const [selectedSeason, setSelectedSeason] = useState(CURRENT_LEAGUE_SEASON);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [seasons, setSeasons] = useState<PlayerSeasonWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const salaryCap = salaryCapForSeason(selectedSeason);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([fetchFantasyTeams(), fetchTeamBrandingHistory(), fetchPlayerSeasonsBySeason(selectedSeason)])
      .then(([teamRows, brandingRows, seasonRows]) => {
        if (!active) return;
        setTeams(teamRows.map((team) => applyTeamBranding(team, brandingRows, selectedSeason)));
        setSeasons(seasonRows);
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Unable to load dashboard."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedSeason]);

  const rows = useMemo<DashboardRow[]>(() => teams
    .map((team) => {
      const roster = seasons.filter((season) => season.fantasy_team_id === team.id);
      const salarySpent = roster
        .filter((season) => capPositions.has(position(season)))
        .reduce((total, season) => total + (season.salary || 0), 0);
      const counts = Object.fromEntries(Object.keys(positionMinimums).map((code) => [
        code,
        roster.filter((season) => position(season) === code).length,
      ])) as DashboardRow["counts"];
      return {
        team,
        salarySpent,
        capSpace: salaryCap - salarySpent,
        rosterSize: Object.values(counts).reduce((total, count) => total + count, 0),
        counts,
      };
    })
    .sort((a, b) => a.team.id - b.team.id), [teams, seasons, salaryCap]);

  return <div>
    <PageMeta title="Great Lakes Dynasty Hockey League" description="GLDHL league roster and salary dashboard" />
    <PageBreadcrumb pageTitle="League Dashboard" />
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-5 dark:border-gray-800 dark:bg-white/[0.03] xl:px-6">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">League Dashboard</h1><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Salary-cap and active-roster overview for every GLDHL team.</p></div>
        <div className="w-full sm:w-44"><label htmlFor="dashboard-season" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">Season</label><select id="dashboard-season" value={selectedSeason} onChange={(event) => setSelectedSeason(Number(event.target.value))} className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm dark:border-gray-700 dark:bg-gray-900">{seasonOptions.map((year) => <option key={year}>{year}</option>)}</select></div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400"><span className="rounded-full bg-gray-100 px-3 py-1 dark:bg-gray-800">Cap: {money.format(salaryCap)}</span><span className="rounded-full bg-gray-100 px-3 py-1 dark:bg-gray-800">Roster limit: {rosterLimit}</span></div>
      {loading && <p className="py-10 text-center text-sm text-gray-500">Loading league dashboard…</p>}
      {error && <p className="rounded-lg border border-error-200 bg-error-50 p-3 text-sm text-error-700">{error}</p>}
      {!loading && !error && <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
        <thead className="bg-gray-50 dark:bg-white/[0.03]"><tr>{["Team", "Salary Spent", "Cap Space", "Roster", "C / 3", "LW / 3", "RW / 3", "D / 6", "G / 2"].map((label) => <th key={label} className={`whitespace-nowrap px-3 py-3 font-semibold text-gray-700 dark:text-gray-200 ${label === "Team" ? "text-left" : "text-center"}`}>{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{rows.map((row) => <tr key={row.team.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
          <td className="px-3 py-3"><Link to={`/teams/${row.team.id}`} className="flex min-w-56 items-center gap-3 font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"><div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">{row.team.logo ? <img src={row.team.logo} alt={`${row.team.team_name} logo`} className="h-full w-full object-contain" /> : row.team.abbreviation}</div><span>{row.team.team_name}</span></Link></td>
          <td className="px-3 py-3 text-center font-medium text-gray-700 dark:text-gray-300">{money.format(row.salarySpent)}</td>
          <td className={`px-3 py-3 text-center font-semibold ${row.capSpace < 0 ? "text-error-500" : "text-success-600 dark:text-success-400"}`}>{row.capSpace < 0 ? `Over ${money.format(Math.abs(row.capSpace))}` : money.format(row.capSpace)}</td>
          <td className={`px-3 py-3 text-center font-semibold ${row.rosterSize > rosterLimit ? "text-error-500" : "text-gray-700 dark:text-gray-300"}`}>{row.rosterSize} / {rosterLimit}</td>
          {(Object.keys(positionMinimums) as Array<keyof typeof positionMinimums>).map((code) => <td key={code} className={`px-3 py-3 text-center font-semibold ${row.counts[code] >= positionMinimums[code] ? "text-success-600 dark:text-success-400" : "text-warning-600 dark:text-warning-400"}`}>{row.counts[code]} / {positionMinimums[code]}</td>)}
        </tr>)}</tbody>
      </table></div>}
    </div>
  </div>;
}
