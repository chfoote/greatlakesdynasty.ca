import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { applyTeamBranding, fetchFantasyTeams, fetchTeamBrandingHistory, type FantasyTeam } from "../../lib/fantasyTeams";
import { fetchPlayerSeasonsBySeason, type PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import { CURRENT_LEAGUE_SEASON, dashboardSeasons } from "../../lib/leagueSeasons";
import { fetchBuyoutPenalties, type BuyoutPenalty } from "../../lib/buyouts";
import { fetchRetentionAdjustments, type RetentionAdjustment } from "../../lib/retentions";
import { fetchNhlGoalieStats, fetchNhlPlayerLanding, fetchNhlSkaterStats } from "../../lib/nhl";

const seasonOptions = dashboardSeasons;
const rosterLimit = 23;
const positionMinimums = { C: 3, LW: 3, RW: 3, D: 6, G: 2 } as const;
const activePositions = new Set(Object.keys(positionMinimums));
const capPositions = new Set([...activePositions, "W", "IR", "RETENTION", "BUYOUT"]);
const ageRosterPositions = new Set([...activePositions, "W", "IR", "LTIR"]);
const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

function salaryCapForSeason(year: number) {
  return year <= 2026 ? 45_000_000 : 50_000_000;
}

function position(season: PlayerSeasonWithRelations) {
  return (season.position || "").toUpperCase();
}

function nhlSeasonId(year: number) {
  return (year - 1) * 10000 + year;
}

function ageOnDate(birthDate: string, asOf: Date) {
  const [year, month, day] = birthDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  let age = asOf.getFullYear() - year;
  if (asOf.getMonth() + 1 < month || (asOf.getMonth() + 1 === month && asOf.getDate() < day)) age -= 1;
  return age;
}

type DashboardRow = {
  team: FantasyTeam;
  salarySpent: number;
  capSpace: number;
  rosterSize: number;
  averageAge: number | null;
  agePlayerCount: number;
  counts: Record<keyof typeof positionMinimums, number>;
};

export default function LeagueDashboard() {
  const [selectedSeason, setSelectedSeason] = useState(CURRENT_LEAGUE_SEASON);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [seasons, setSeasons] = useState<PlayerSeasonWithRelations[]>([]);
  const [buyoutPenalties, setBuyoutPenalties] = useState<BuyoutPenalty[]>([]);
  const [retentionAdjustments, setRetentionAdjustments] = useState<RetentionAdjustment[]>([]);
  const [birthDatesByPlayer, setBirthDatesByPlayer] = useState<Map<string, string>>(new Map());
  const [agesLoading, setAgesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const salaryCap = salaryCapForSeason(selectedSeason);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([fetchFantasyTeams(), fetchTeamBrandingHistory(), fetchPlayerSeasonsBySeason(selectedSeason), fetchBuyoutPenalties(selectedSeason), fetchRetentionAdjustments(selectedSeason)])
      .then(([teamRows, brandingRows, seasonRows, penaltyRows, adjustmentRows]) => {
        if (!active) return;
        setTeams(teamRows.map((team) => applyTeamBranding(team, brandingRows, selectedSeason)));
        setSeasons(seasonRows);
        setBuyoutPenalties(penaltyRows);
        setRetentionAdjustments(adjustmentRows);
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Unable to load dashboard."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedSeason]);

  useEffect(() => {
    if (!seasons.length) { setBirthDatesByPlayer(new Map()); return; }
    let active = true;
    setAgesLoading(true);
    const eligibleIds = [...new Set(seasons.filter((season) => ageRosterPositions.has(position(season))).map((season) => season.player?.player_api_id).filter((id): id is string => Boolean(id)))];
    Promise.all([
      fetchNhlSkaterStats(nhlSeasonId(selectedSeason)).catch(() => []),
      fetchNhlGoalieStats(nhlSeasonId(selectedSeason)).catch(() => []),
    ]).then(async ([skaters, goalies]) => {
      const dates = new Map<string, string>();
      [...skaters, ...goalies].forEach((player) => { if (player.birthDate) dates.set(String(player.playerId), player.birthDate); });
      await Promise.all(eligibleIds.filter((id) => !dates.has(id)).map(async (id) => {
        try { const landing = await fetchNhlPlayerLanding(Number(id)); if (landing.birthDate) dates.set(id, landing.birthDate); } catch { /* Keep the other teams available if one NHL profile fails. */ }
      }));
      if (active) setBirthDatesByPlayer(dates);
    }).finally(() => { if (active) setAgesLoading(false); });
    return () => { active = false; };
  }, [seasons, selectedSeason]);

  const rows = useMemo<DashboardRow[]>(() => teams
    .map((team) => {
      const roster = seasons.filter((season) => season.fantasy_team_id === team.id);
      const salarySpent = roster
        .filter((season) => capPositions.has(position(season)))
        .reduce((total, season) => total + (season.salary || 0), 0)
        + buyoutPenalties.filter((penalty) => penalty.fantasy_team_id === team.id).reduce((total, penalty) => total + penalty.amount, 0)
        + retentionAdjustments.filter((adjustment) => adjustment.fantasy_team_id === team.id).reduce((total, adjustment) => total + adjustment.amount, 0);
      const counts = Object.fromEntries(Object.keys(positionMinimums).map((code) => [
        code,
        roster.filter((season) => position(season) === code).length,
      ])) as DashboardRow["counts"];
      const ageRoster = roster.filter((season) => ageRosterPositions.has(position(season)));
      const ageDate = selectedSeason === CURRENT_LEAGUE_SEASON ? new Date() : new Date(`${selectedSeason - 1}-10-01T12:00:00`);
      const ages = ageRoster.map((season) => birthDatesByPlayer.get(season.player?.player_api_id || "")).filter((date): date is string => Boolean(date)).map((date) => ageOnDate(date, ageDate)).filter((age): age is number => age !== null);
      return {
        team,
        salarySpent,
        capSpace: salaryCap - salarySpent,
        rosterSize: Object.values(counts).reduce((total, count) => total + count, 0),
        averageAge: ages.length ? ages.reduce((total, age) => total + age, 0) / ages.length : null,
        agePlayerCount: ageRoster.length,
        counts,
      };
    })
    .sort((a, b) => a.team.id - b.team.id), [teams, seasons, salaryCap, buyoutPenalties, retentionAdjustments, birthDatesByPlayer, selectedSeason]);
  const leaguePayroll = rows.reduce((total, row) => total + row.salarySpent, 0);
  const teamsOverCap = rows.filter((row) => row.capSpace < 0).length;
  const rosterSpotsUsed = rows.reduce((total, row) => total + row.rosterSize, 0);

  return <div>
    <PageMeta title="Great Lakes Dynasty Hockey League" description="GLDHL league roster and salary dashboard" />
    <PageBreadcrumb pageTitle="Cap & Roster Overview" />
    <div className="space-y-5">
      <section className="flex justify-end rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-white/[0.03]">
        <label htmlFor="dashboard-season" className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400">Season<select id="dashboard-season" value={selectedSeason} onChange={(event) => setSelectedSeason(Number(event.target.value))} className="mt-1 block h-11 w-full rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white sm:w-40">{seasonOptions.map((year) => <option key={year}>{year}</option>)}</select></label>
      </section>
      <section aria-label="League summary" className="grid grid-cols-2 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] sm:grid-cols-4">
        {loading ? Array.from({ length: 4 }, (_, index) => <div key={index} className="h-20 animate-pulse border-r border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-900" />) : [
          { label: "League payroll", value: money.format(leaguePayroll), tone: "text-brand-600 dark:text-brand-300" },
          { label: "Cap ceiling", value: money.format(salaryCap), tone: "text-gray-900 dark:text-white" },
          { label: "Active roster", value: rosterSpotsUsed.toLocaleString(), tone: "text-gray-900 dark:text-white" },
          { label: "Over the cap", value: String(teamsOverCap), tone: teamsOverCap ? "text-error-600 dark:text-error-300" : "text-success-600 dark:text-success-300" },
        ].map((metric, index) => <div key={metric.label} className={`px-4 py-3 ${index > 0 ? "border-l border-gray-100 dark:border-gray-800" : ""}`}><p className="text-[9px] font-black uppercase tracking-wider text-gray-400">{metric.label}</p><p className={`mt-1 text-lg font-black tabular-nums sm:text-xl ${metric.tone}`}>{metric.value}</p></div>)}
      </section>
      {error && <p className="rounded-lg border border-error-200 bg-error-50 p-3 text-sm text-error-700">{error}</p>}
      <section aria-label={`${selectedSeason} franchise cap and roster comparison`} className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {loading ? <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-12 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />)}</div> : !error && <div className="overflow-x-auto">
          <table className="min-w-[1120px] w-full border-collapse text-sm">
            <thead className="bg-gray-50 dark:bg-white/[0.04]"><tr className="border-b border-gray-200 dark:border-gray-800">{["Franchise / Manager", "Payroll", "Cap space", "Roster", "Avg age", "C", "LW", "RW", "D", "G"].map((label, index) => <th key={label} scope="col" className={`whitespace-nowrap px-3 py-3 text-[10px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400 ${index === 0 || index === 1 ? "text-left" : "text-center"}`}>{index > 4 ? `${label} / ${positionMinimums[label as keyof typeof positionMinimums]}` : label}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{rows.map((row, index) => {
              const capUsed = Math.max(0, Math.min(100, row.salarySpent / salaryCap * 100));
              const rosterUsed = Math.max(0, Math.min(100, row.rosterSize / rosterLimit * 100));
              return <tr key={row.team.id} className={`group transition-colors hover:bg-brand-50/50 dark:hover:bg-brand-500/[0.06] ${index % 2 ? "bg-gray-50/60 dark:bg-white/[0.015]" : ""}`}>
                <th scope="row" className="relative min-w-64 px-3 py-2.5 text-left font-normal"><span className="absolute inset-y-0 left-0 w-1" style={{ background: `linear-gradient(${row.team.primary_color || "#465fff"}, ${row.team.secondary_color || row.team.primary_color || "#8b5cf6"})` }} /><Link to={`/teams/${row.team.id}`} className="flex items-center gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">{row.team.logo ? <img src={row.team.logo} alt="" className="h-full w-full object-contain" /> : <span className="text-[9px] font-black text-gray-500">{row.team.abbreviation}</span>}</span><span className="min-w-0"><span className="block truncate text-xs font-black text-gray-900 group-hover:text-brand-600 dark:text-white">{row.team.team_name}</span><span className="mt-0.5 block truncate text-[10px] font-medium text-gray-500 dark:text-gray-400">{row.team.manager_name || "Manager not assigned"}</span></span></Link></th>
                <td className="min-w-40 px-3 py-2.5"><p className="text-xs font-black tabular-nums text-gray-900 dark:text-white">{money.format(row.salarySpent)}</p><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"><div className={`h-full rounded-full ${row.capSpace < 0 ? "bg-error-500" : capUsed >= 85 ? "bg-amber-400" : "bg-brand-500"}`} style={{ width: `${capUsed}%` }} /></div><p className="mt-0.5 text-right text-[9px] text-gray-400">{capUsed.toFixed(0)}% of cap</p></td>
                <td className={`px-3 py-2.5 text-center text-xs font-black tabular-nums ${row.capSpace < 0 ? "text-error-600 dark:text-error-300" : "text-success-700 dark:text-success-300"}`}>{row.capSpace < 0 ? `−${money.format(Math.abs(row.capSpace))}` : money.format(row.capSpace)}</td>
                <td className="min-w-28 px-3 py-2.5"><p className={`text-center text-xs font-black tabular-nums ${row.rosterSize > rosterLimit ? "text-error-600 dark:text-error-300" : "text-gray-800 dark:text-gray-200"}`}>{row.rosterSize}<span className="font-medium text-gray-400"> / {rosterLimit}</span></p><div className="mx-auto mt-1.5 h-1.5 max-w-20 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"><div className={`h-full rounded-full ${row.rosterSize > rosterLimit ? "bg-error-500" : "bg-emerald-500"}`} style={{ width: `${rosterUsed}%` }} /></div></td>
                <td title={`${row.agePlayerCount} active, IR, LTIR and waiver players${agesLoading ? " · refreshing ages" : ""}`} className="px-3 py-2.5 text-center text-xs font-bold tabular-nums text-gray-700 dark:text-gray-200">{row.averageAge === null ? agesLoading ? "…" : "—" : row.averageAge.toFixed(1)}</td>
                {(Object.keys(positionMinimums) as Array<keyof typeof positionMinimums>).map((code) => <td key={code} className={`px-3 py-2.5 text-center text-xs font-black tabular-nums ${row.counts[code] >= positionMinimums[code] ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>{row.counts[code]}<span className="font-medium text-gray-400"> / {positionMinimums[code]}</span></td>)}
              </tr>;
            })}</tbody>
          </table>
        </div>}
      </section>
    </div>
  </div>;
}
