import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { applyTeamBranding, fetchFantasyTeams, fetchTeamBrandingHistory, type FantasyTeam } from "../../lib/fantasyTeams";
import { fetchPlayerSeasonsBySeasons, type PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import { CURRENT_LEAGUE_SEASON, dashboardSeasons } from "../../lib/leagueSeasons";
import { fetchNhlPlayerBiographies } from "../../lib/nhl";
import { fetchLeagueSeasonStats } from "../../lib/leagueSeasonStats";
import { playerMetadata } from "../../lib/nhlPlayerMetadata";
import { ACTIVE_ROSTER_POSITIONS, CAP_POSITIONS, calculateTeamCap, EMPTY_CAP_ADJUSTMENTS, ROSTER_LIMIT, salaryCapForSeason } from "../../lib/cap";
import { fetchTeamCapAdjustmentTotals, type TeamCapAdjustmentTotal } from "../../lib/capAdjustments";

const seasonOptions = dashboardSeasons;
const rosterLimit = ROSTER_LIMIT;
const outlookLength = 5;
const positionMinimums = { C: 3, LW: 3, RW: 3, D: 6, G: 2 } as const;
const activePositions = ACTIVE_ROSTER_POSITIONS;
const ageRosterPositions = new Set([...activePositions, "W", "IR", "LTIR"]);
const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

function position(season: PlayerSeasonWithRelations) {
  return (season.position || "").toUpperCase();
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
  rosterSalary: number;
  capSpace: number;
  rosterSize: number;
  averageAge: number | null;
  agePlayerCount: number;
  counts: Record<keyof typeof positionMinimums, number>;
  positionSalary: { forwards: number; defense: number; goalies: number };
  capRoster: { id: number; playerName: string; position: string; salary: number }[];
  excludedRoster: { id: number; playerName: string; position: string; salary: number }[];
  buyoutPenaltyTotal: number;
  retentionNet: number;
  buyoutSlotsUsed: number;
  retentionSlotsUsed: number;
};

type RfaOutlook = { playerId: number; name: string; confirmed: boolean };
type DashboardView = "overview" | "outlook";

export default function LeagueDashboard() {
  const [selectedSeason, setSelectedSeason] = useState(CURRENT_LEAGUE_SEASON);
  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [allSeasons, setAllSeasons] = useState<PlayerSeasonWithRelations[]>([]);
  const [capAdjustments, setCapAdjustments] = useState<TeamCapAdjustmentTotal[]>([]);
  const [birthDatesByPlayer, setBirthDatesByPlayer] = useState<Map<string, string>>(new Map());
  const [agesLoading, setAgesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedTeams, setExpandedTeams] = useState<Set<number>>(new Set());
  const [expandedOutlook, setExpandedOutlook] = useState<string | null>(null);
  const outlookYears = useMemo(() => Array.from({ length: outlookLength }, (_, index) => selectedSeason + index), [selectedSeason]);
  const seasons = useMemo(() => allSeasons.filter((season) => season.season_year === selectedSeason), [allSeasons, selectedSeason]);
  const salaryCap = calculateTeamCap([], selectedSeason).salaryCap;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([fetchFantasyTeams(), fetchTeamBrandingHistory(), fetchPlayerSeasonsBySeasons(outlookYears), fetchTeamCapAdjustmentTotals({ seasonYears: outlookYears })])
      .then(([teamRows, brandingRows, seasonRows, adjustmentRows]) => {
        if (!active) return;
        setTeams(teamRows.map((team) => applyTeamBranding(team, brandingRows, selectedSeason)));
        setAllSeasons(seasonRows);
        setCapAdjustments(adjustmentRows);
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Unable to load dashboard."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [outlookYears, selectedSeason]);

  useEffect(() => {
    if (!seasons.length) { setBirthDatesByPlayer(new Map()); return; }
    let active = true;
    setAgesLoading(true);
    const eligibleIds = [...new Set(seasons.filter((season) => ageRosterPositions.has(position(season))).map((season) => season.player?.player_api_id).filter((id): id is string => Boolean(id)))];
    fetchLeagueSeasonStats(selectedSeason).catch(() => ({ skaters: [], goalies: [] })).then(async ({ skaters, goalies }) => {
      const dates = new Map<string, string>();
      [...skaters, ...goalies].forEach((player) => { if (player.birthDate) dates.set(String(player.playerId), player.birthDate); });
      if (active) setBirthDatesByPlayer(new Map(dates));
      const missing = eligibleIds.filter((id) => !dates.has(id));
      try {
        await fetchNhlPlayerBiographies((selectedSeason - 1) * 10000 + selectedSeason, missing, () => {
          missing.forEach((id) => {
            const birthDate = playerMetadata.read(id)?.birthDate;
            if (birthDate) dates.set(id, birthDate);
          });
          if (active) setBirthDatesByPlayer(new Map(dates));
        });
      } catch {
        if (active) setBirthDatesByPlayer(new Map(dates));
      } finally {
        if (active) setBirthDatesByPlayer(new Map(dates));
      }
    }).finally(() => { if (active) setAgesLoading(false); });
    return () => { active = false; };
  }, [seasons, selectedSeason]);

  const rows = useMemo<DashboardRow[]>(() => teams
    .map((team) => {
      const roster = seasons.filter((season) => season.fantasy_team_id === team.id);
      const adjustment = capAdjustments.find((row) => row.fantasyTeamId === team.id && row.seasonYear === selectedSeason) || EMPTY_CAP_ADJUSTMENTS;
      const cap = calculateTeamCap(roster, selectedSeason, adjustment);
      const positionSalary = roster.reduce((totals, season) => {
        const code = position(season);
        const salary = Number.isFinite(season.salary) ? Number(season.salary) : 0;
        if (["C", "LW", "RW", "W"].includes(code)) totals.forwards += salary;
        else if (code === "D") totals.defense += salary;
        else if (code === "G") totals.goalies += salary;
        return totals;
      }, { forwards: 0, defense: 0, goalies: 0 });
      const capRoster = roster.filter((season) => CAP_POSITIONS.has(position(season))).map((season) => ({
        id: season.id,
        playerName: season.player?.full_name || [season.player?.first_name, season.player?.last_name].filter(Boolean).join(" ") || `Player ${season.player_id}`,
        position: position(season) || "—",
        salary: Number.isFinite(season.salary) ? Number(season.salary) : 0,
      })).filter((season) => season.salary !== 0).sort((a, b) => b.salary - a.salary || a.playerName.localeCompare(b.playerName));
      const excludedRoster = roster.filter((season) => !CAP_POSITIONS.has(position(season)) && Number.isFinite(season.salary) && Number(season.salary) !== 0).map((season) => ({
        id: season.id,
        playerName: season.player?.full_name || [season.player?.first_name, season.player?.last_name].filter(Boolean).join(" ") || `Player ${season.player_id}`,
        position: position(season) || "—",
        salary: Number(season.salary),
      })).sort((a, b) => b.salary - a.salary || a.playerName.localeCompare(b.playerName));
      const counts = Object.fromEntries(Object.keys(positionMinimums).map((code) => [
        code,
        roster.filter((season) => position(season) === code).length,
      ])) as DashboardRow["counts"];
      const ageRoster = roster.filter((season) => ageRosterPositions.has(position(season)));
      const ageDate = selectedSeason === CURRENT_LEAGUE_SEASON ? new Date() : new Date(`${selectedSeason - 1}-10-01T12:00:00`);
      const ages = ageRoster.map((season) => birthDatesByPlayer.get(season.player?.player_api_id || "")).filter((date): date is string => Boolean(date)).map((date) => ageOnDate(date, ageDate)).filter((age): age is number => age !== null);
      return {
        team,
        salarySpent: cap.capSalary,
        rosterSalary: cap.rosterSalary,
        capSpace: cap.capSpace,
        rosterSize: Object.values(counts).reduce((total, count) => total + count, 0),
        averageAge: ages.length ? ages.reduce((total, age) => total + age, 0) / ages.length : null,
        agePlayerCount: ageRoster.length,
        counts,
        positionSalary,
        capRoster,
        excludedRoster,
        buyoutPenaltyTotal: adjustment.buyoutPenaltyTotal,
        retentionNet: adjustment.retentionNet,
        buyoutSlotsUsed: adjustment.buyoutSlotsUsed,
        retentionSlotsUsed: adjustment.retentionSlotsUsed,
      };
    })
    .sort((a, b) => a.team.id - b.team.id), [teams, seasons, capAdjustments, birthDatesByPlayer, selectedSeason]);
  const outlook = useMemo(() => teams.map((team) => ({
    team,
    years: outlookYears.map((year) => {
      const yearRows = allSeasons.filter((season) => season.season_year === year);
      const teamRows = yearRows.filter((season) => season.fantasy_team_id === team.id);
      const adjustment = capAdjustments.find((row) => row.fantasyTeamId === team.id && row.seasonYear === year) || EMPTY_CAP_ADJUSTMENTS;
      const cap = calculateTeamCap(teamRows, year, adjustment);
      const capRoster = teamRows.filter((season) => CAP_POSITIONS.has(position(season))).map((season) => ({
        id: season.id,
        name: season.player?.full_name || [season.player?.first_name, season.player?.last_name].filter(Boolean).join(" ") || `Player ${season.player_id}`,
        position: position(season) || "—",
        salary: Number.isFinite(season.salary) ? Number(season.salary) : 0,
        expires: season.term_end_year === year && activePositions.has(position(season)),
      })).filter((season) => season.salary !== 0).sort((a, b) => b.salary - a.salary || a.name.localeCompare(b.name));
      const expiringContracts = teamRows.filter((season) => season.term_end_year === year && activePositions.has(position(season)))
        .map((season) => ({
          id: season.id,
          name: season.player?.full_name || [season.player?.first_name, season.player?.last_name].filter(Boolean).join(" ") || `Player ${season.player_id}`,
          position: position(season) || "—",
          salary: Number.isFinite(season.salary) ? Number(season.salary) : null,
        })).sort((a, b) => a.name.localeCompare(b.name));
      const rfas: RfaOutlook[] = [];
      if (year > selectedSeason) {
        const expiringRows = allSeasons.filter((season) => season.season_year === year - 1
          && season.fantasy_team_id === team.id
          && season.term_end_year === year - 1
          && activePositions.has(position(season)));
        const seenPlayers = new Set<number>();
        expiringRows.forEach((season) => {
          if (seenPlayers.has(season.player_id)) return;
          seenPlayers.add(season.player_id);
          const nextSeasonRow = allSeasons.find((candidate) => candidate.season_year === year && candidate.player_id === season.player_id);
          if (nextSeasonRow && (nextSeasonRow.fantasy_team_id !== team.id || position(nextSeasonRow) !== "RFA")) return;
          rfas.push({
            playerId: season.player_id,
            name: season.player?.full_name || [season.player?.first_name, season.player?.last_name].filter(Boolean).join(" ") || `Player ${season.player_id}`,
            confirmed: Boolean(nextSeasonRow),
          });
        });
      }
      return {
        year,
        salary: cap.capSalary,
        rosterSalary: cap.rosterSalary,
        capSpace: cap.capSpace,
        buyoutPenaltyTotal: adjustment.buyoutPenaltyTotal,
        retentionNet: adjustment.retentionNet,
        buyoutSlotsUsed: adjustment.buyoutSlotsUsed,
        retentionSlotsUsed: adjustment.retentionSlotsUsed,
        capRoster,
        expiringContracts,
        rfas: rfas.sort((a, b) => a.name.localeCompare(b.name)),
      };
    }),
  })).sort((a, b) => a.team.id - b.team.id), [teams, outlookYears, allSeasons, capAdjustments, selectedSeason]);
  const leaguePayroll = rows.reduce((total, row) => total + row.salarySpent, 0);
  const teamsOverCap = rows.filter((row) => row.capSpace < 0).length;
  const rosterSpotsUsed = rows.reduce((total, row) => total + row.rosterSize, 0);

  return <div>
    <PageMeta title="Great Lakes Dynasty Hockey League" description="GLDHL league roster and salary dashboard" />
    <PageBreadcrumb pageTitle="Cap & Roster Overview" />
    <div className="space-y-5">
      <nav aria-label="Cap dashboard views" className="flex gap-2 rounded-2xl border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-white/[0.03]">
        {([{ id: "overview", label: "Cap & Roster Overview" }, { id: "outlook", label: "Multi-year Outlook" }] as const).map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeView === tab.id} onClick={() => setActiveView(tab.id)} className={`rounded-xl px-4 py-2.5 text-sm font-bold transition ${activeView === tab.id ? "bg-brand-500 text-white shadow-sm" : "text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"}`}>{tab.label}</button>)}
      </nav>
      {error && <p role="alert" className="rounded-lg border border-error-200 bg-error-50 p-3 text-sm text-error-700">{error}</p>}
      {activeView === "overview" && <>
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
      <section aria-label={`${selectedSeason} franchise cap and roster comparison`} className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {loading ? <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-12 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />)}</div> : !error && <div className="overflow-x-auto">
          <table className="min-w-[1120px] w-full border-collapse text-sm">
            <thead className="bg-gray-50 dark:bg-white/[0.04]"><tr className="border-b border-gray-200 dark:border-gray-800">{["Franchise / Manager", "Payroll", "Cap space", "Roster", "Avg age", "C", "LW", "RW", "D", "G"].map((label, index) => <th key={label} scope="col" className={`whitespace-nowrap px-3 py-3 text-[10px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400 ${index === 0 || index === 1 ? "text-left" : "text-center"}`}>{index > 4 ? `${label} / ${positionMinimums[label as keyof typeof positionMinimums]}` : label}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{rows.map((row, index) => {
              const capUsed = Math.max(0, Math.min(100, row.salarySpent / salaryCap * 100));
              const positionSalaryTotal = row.positionSalary.forwards + row.positionSalary.defense + row.positionSalary.goalies;
              const otherCapSalary = row.salarySpent - positionSalaryTotal;
              const barDenominator = row.salarySpent > salaryCap ? row.salarySpent : salaryCap;
              const positionBarWidth = otherCapSalary >= 0
                ? (amount: number) => Math.max(0, amount / barDenominator * 100)
                : (amount: number) => positionSalaryTotal > 0 ? capUsed * amount / positionSalaryTotal : 0;
              const otherBarWidth = otherCapSalary > 0 ? positionBarWidth(otherCapSalary) : 0;
              const rosterUsed = Math.max(0, Math.min(100, row.rosterSize / rosterLimit * 100));
              const isExpanded = expandedTeams.has(row.team.id);
              return <Fragment key={row.team.id}><tr className={`group transition-colors hover:bg-brand-50/50 dark:hover:bg-brand-500/[0.06] ${index % 2 ? "bg-gray-50/60 dark:bg-white/[0.015]" : ""}`}>
                <th scope="row" className="relative min-w-64 px-3 py-2.5 text-left font-normal"><span className="absolute inset-y-0 left-0 w-1" style={{ background: `linear-gradient(${row.team.primary_color || "#465fff"}, ${row.team.secondary_color || row.team.primary_color || "#8b5cf6"})` }} /><Link to={`/teams/${row.team.id}`} className="flex items-center gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">{row.team.logo ? <img src={row.team.logo} alt="" className="h-full w-full object-contain" /> : <span className="text-[9px] font-black text-gray-500">{row.team.abbreviation}</span>}</span><span className="min-w-0"><span className="block truncate text-xs font-black text-gray-900 group-hover:text-brand-600 dark:text-white">{row.team.team_name}</span><span className="mt-0.5 block truncate text-[10px] font-medium text-gray-500 dark:text-gray-400">{row.team.manager_name || "Manager not assigned"}</span></span></Link></th>
                <td className="min-w-40 px-3 py-2.5">
                  <p className="text-xs font-black tabular-nums text-gray-900 dark:text-white">{money.format(row.salarySpent)}</p>
                  <div role="img" aria-label={`Cap usage by position: Forwards ${money.format(row.positionSalary.forwards)}, defense ${money.format(row.positionSalary.defense)}, goalies ${money.format(row.positionSalary.goalies)}${otherCapSalary ? `, other cap items ${money.format(otherCapSalary)}` : ""}`} className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    {row.positionSalary.forwards > 0 && <span title={`Forwards: ${money.format(row.positionSalary.forwards)}`} className="h-full bg-sky-500" style={{ width: `${positionBarWidth(row.positionSalary.forwards)}%` }} />}
                    {row.positionSalary.defense > 0 && <span title={`Defense: ${money.format(row.positionSalary.defense)}`} className="h-full bg-violet-500" style={{ width: `${positionBarWidth(row.positionSalary.defense)}%` }} />}
                    {row.positionSalary.goalies > 0 && <span title={`Goalies: ${money.format(row.positionSalary.goalies)}`} className="h-full bg-amber-400" style={{ width: `${positionBarWidth(row.positionSalary.goalies)}%` }} />}
                    {otherBarWidth > 0 && <span title={`Other roster and cap adjustments: ${money.format(otherCapSalary)}`} className="h-full bg-gray-400 dark:bg-gray-500" style={{ width: `${otherBarWidth}%` }} />}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-[9px] font-semibold tabular-nums text-gray-500" aria-hidden="true">
                    <span><i className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />F {money.format(row.positionSalary.forwards)}</span>
                    <span><i className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-violet-500" />D {money.format(row.positionSalary.defense)}</span>
                    <span><i className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />G {money.format(row.positionSalary.goalies)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2"><p className="text-[9px] text-gray-400">{capUsed.toFixed(0)}% of cap</p><button type="button" aria-expanded={isExpanded} aria-controls={`cap-breakdown-${row.team.id}`} onClick={() => setExpandedTeams((current) => { const next = new Set(current); if (next.has(row.team.id)) next.delete(row.team.id); else next.add(row.team.id); return next; })} className="text-[9px] font-bold text-brand-600 hover:underline dark:text-brand-300">{isExpanded ? "Hide details" : "Breakdown"}</button></div>
                </td>
                <td className={`px-3 py-2.5 text-center text-xs font-black tabular-nums ${row.capSpace < 0 ? "text-error-600 dark:text-error-300" : "text-success-700 dark:text-success-300"}`}>{row.capSpace < 0 ? `−${money.format(Math.abs(row.capSpace))}` : money.format(row.capSpace)}</td>
                <td className="min-w-28 px-3 py-2.5"><p className={`text-center text-xs font-black tabular-nums ${row.rosterSize > rosterLimit ? "text-error-600 dark:text-error-300" : "text-gray-800 dark:text-gray-200"}`}>{row.rosterSize}<span className="font-medium text-gray-400"> / {rosterLimit}</span></p><div className="mx-auto mt-1.5 h-1.5 max-w-20 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"><div className={`h-full rounded-full ${row.rosterSize > rosterLimit ? "bg-error-500" : "bg-emerald-500"}`} style={{ width: `${rosterUsed}%` }} /></div></td>
                <td title={`${row.agePlayerCount} active, IR, LTIR and waiver players${agesLoading ? " · refreshing ages" : ""}`} className="px-3 py-2.5 text-center text-xs font-bold tabular-nums text-gray-700 dark:text-gray-200">{row.averageAge === null ? agesLoading ? "…" : "—" : row.averageAge.toFixed(1)}</td>
                {(Object.keys(positionMinimums) as Array<keyof typeof positionMinimums>).map((code) => <td key={code} className={`px-3 py-2.5 text-center text-xs font-black tabular-nums ${row.counts[code] >= positionMinimums[code] ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>{row.counts[code]}<span className="font-medium text-gray-400"> / {positionMinimums[code]}</span></td>)}
              </tr>{isExpanded && <tr id={`cap-breakdown-${row.team.id}`} className="bg-brand-50/40 dark:bg-brand-500/[0.03]"><td colSpan={10} className="px-4 py-4"><div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(15rem,1fr)]"><div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"><div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800"><h3 className="text-xs font-black text-gray-900 dark:text-white">Cap-counting roster salaries</h3><span className="text-xs font-bold tabular-nums text-gray-500">{money.format(row.rosterSalary)}</span></div>{row.capRoster.length ? <div className="max-h-64 overflow-y-auto"><table className="w-full text-xs"><tbody className="divide-y divide-gray-100 dark:divide-gray-800">{row.capRoster.map((player) => <tr key={player.id}><td className="px-3 py-2 font-semibold text-gray-800 dark:text-gray-200">{player.playerName}</td><td className="px-3 py-2 text-center text-gray-500">{player.position}</td><td className="px-3 py-2 text-right font-bold tabular-nums text-gray-800 dark:text-gray-200">{money.format(player.salary)}</td></tr>)}</tbody></table></div> : <p className="px-3 py-4 text-xs text-gray-500">No cap-counting roster salaries.</p>}{row.excludedRoster.length > 0 && <details className="border-t border-gray-100 dark:border-gray-800"><summary className="cursor-pointer px-3 py-2 text-xs font-bold text-gray-500">{row.excludedRoster.length} roster {row.excludedRoster.length === 1 ? "salary excluded" : "salaries excluded"} from cap</summary><table className="w-full text-xs"><tbody className="divide-y divide-gray-100 dark:divide-gray-800">{row.excludedRoster.map((player) => <tr key={player.id}><td className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-300">{player.playerName}</td><td className="px-3 py-2 text-center text-gray-500">{player.position}</td><td className="px-3 py-2 text-right font-bold tabular-nums text-gray-700 dark:text-gray-300">{money.format(player.salary)}</td></tr>)}</tbody></table></details>}</div><div className="space-y-3"><div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"><h3 className="text-xs font-black text-gray-900 dark:text-white">Cap adjustments</h3><dl className="mt-2 space-y-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-gray-500">Roster salaries</dt><dd className="font-bold tabular-nums">{money.format(row.rosterSalary)}</dd></div><div className="flex justify-between gap-3"><dt className="text-gray-500">Buyout penalties · {row.buyoutSlotsUsed} slots</dt><dd className="font-bold tabular-nums">{money.format(row.buyoutPenaltyTotal)}</dd></div><div className="flex justify-between gap-3"><dt className="text-gray-500">Retention {row.retentionNet > 0 ? "charges" : row.retentionNet < 0 ? "relief" : "net"} · {row.retentionSlotsUsed} slots</dt><dd className={`font-bold tabular-nums ${row.retentionNet > 0 ? "text-error-600" : row.retentionNet < 0 ? "text-success-600" : ""}`}>{row.retentionNet > 0 ? "+" : row.retentionNet < 0 ? "−" : ""}{money.format(Math.abs(row.retentionNet))}</dd></div><div className="flex justify-between gap-3 border-t border-gray-100 pt-2 font-black dark:border-gray-800"><dt>Cap used</dt><dd className="tabular-nums">{money.format(row.salarySpent)}</dd></div></dl><p className="mt-2 text-[10px] text-gray-500">Penalty and retention totals are summarized here. Open the franchise page for player-level adjustment details.</p><Link to={`/teams/${row.team.id}`} className="mt-2 inline-flex text-xs font-bold text-brand-600 hover:underline dark:text-brand-300">Open full team payroll details →</Link></div><div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"><p className="text-[10px] font-black uppercase tracking-wider text-gray-400">Available cap</p><p className={`mt-1 text-lg font-black tabular-nums ${row.capSpace < 0 ? "text-error-600 dark:text-error-300" : "text-success-700 dark:text-success-300"}`}>{row.capSpace < 0 ? `Over by ${money.format(Math.abs(row.capSpace))}` : money.format(row.capSpace)}</p><p className="text-[10px] text-gray-500">{money.format(salaryCap)} league ceiling</p></div></div></div></td></tr>}</Fragment>;
            })}</tbody>
          </table>
        </div>}
      </section>
      </>}
      {activeView === "outlook" && <>
      <section className="flex justify-end rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-white/[0.03]">
        <label htmlFor="outlook-season" className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400">Starting season<select id="outlook-season" value={selectedSeason} onChange={(event) => setSelectedSeason(Number(event.target.value))} className="mt-1 block h-11 w-full rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white sm:w-40">{seasonOptions.map((year) => <option key={year}>{year}</option>)}</select></label>
      </section>
      <section aria-label="Multi-year cap outlook" className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-200 bg-gray-50 px-5 py-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-500">Future commitments</p>
          <h2 className="mt-1 text-lg font-black text-gray-900 dark:text-white">Multi-year cap outlook</h2>
          <p className="mt-1 text-xs text-gray-500">Recorded roster salaries, cap adjustments, and cap space. Players whose contracts end are flagged as projected RFA candidates unless next season already records their RFA rights.</p>
        </div>
        {loading ? <div className="h-48 animate-pulse bg-gray-50 dark:bg-gray-900/40" /> : !error && <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full border-collapse text-sm">
            <thead className="bg-white dark:bg-gray-900"><tr className="border-b border-gray-200 dark:border-gray-800"><th scope="col" className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-gray-500 dark:bg-gray-800 dark:text-gray-400">Franchise</th>{outlookYears.map((year) => <th key={year} scope="col" className="px-3 py-3 text-center text-xs font-black text-gray-700 dark:text-gray-200">{year}–{String(year + 1).slice(-2)}<span className="mt-0.5 block text-[9px] font-semibold text-gray-400">{money.format(salaryCapForSeason(year))} cap</span></th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{outlook.map(({ team, years }) => <Fragment key={team.id}><tr className="hover:bg-brand-50/40 dark:hover:bg-brand-500/[0.04]">
              <th scope="row" className="sticky left-0 z-10 min-w-48 bg-white px-4 py-3 text-left dark:bg-gray-900"><Link to={`/teams/${team.id}`} className="flex items-center gap-2 font-bold text-gray-900 hover:text-brand-600 dark:text-white">{team.logo && <img src={team.logo} alt="" className="h-7 w-7 object-contain" />}<span className="truncate">{team.team_name}</span></Link></th>
              {years.map(({ year, salary, capSpace, rfas }) => {
                const detailId = `outlook-breakdown-${team.id}-${year}`;
                const isExpanded = expandedOutlook === detailId;
                return <td key={year} className="min-w-40 px-3 py-3 text-center">
                <p className="text-xs font-bold tabular-nums text-gray-800 dark:text-gray-200">{money.format(salary)}</p>
                <p className={`mt-0.5 text-[11px] font-black tabular-nums ${capSpace < 0 ? "text-error-600 dark:text-error-300" : "text-success-700 dark:text-success-300"}`}>{capSpace < 0 ? `−${money.format(Math.abs(capSpace))}` : money.format(capSpace)} space</p>
                <button type="button" aria-expanded={isExpanded} aria-controls={detailId} onClick={() => setExpandedOutlook((current) => current === detailId ? null : detailId)} className="mt-1 text-[10px] font-bold text-brand-600 hover:underline dark:text-brand-300">{isExpanded ? "Hide details" : "Breakdown"}</button>
                {rfas.length > 0 && <details className="group mt-1 text-left">
                  <summary className="mx-auto w-fit cursor-pointer list-none rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-black text-violet-800 hover:bg-violet-200 dark:bg-violet-500/20 dark:text-violet-200 dark:hover:bg-violet-500/30">{rfas.length} RFA{rfas.length === 1 ? "" : "s"} <span className="group-open:hidden">+</span><span className="hidden group-open:inline">−</span></summary>
                  <ul className="mt-1 space-y-1 rounded-lg border border-violet-200 bg-violet-50 p-2 text-[10px] dark:border-violet-500/30 dark:bg-violet-500/10">{rfas.map((rfa) => <li key={rfa.playerId} className="text-gray-700 dark:text-gray-200"><span className="font-bold">{rfa.name}</span><span className="ml-1 text-violet-700 dark:text-violet-300">{rfa.confirmed ? "RFA rights recorded" : "projected RFA"}</span></li>)}</ul>
                </details>}
              </td>;
              })}
            </tr>{years.map((season) => {
              const detailId = `outlook-breakdown-${team.id}-${season.year}`;
              if (expandedOutlook !== detailId) return null;
              return <tr id={detailId} key={detailId} className="bg-brand-50/40 dark:bg-brand-500/[0.03]"><td colSpan={6} className="px-4 py-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                    <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800"><h3 className="text-xs font-black text-gray-900 dark:text-white">{season.year} cap breakdown</h3><span className="text-xs font-bold tabular-nums text-gray-500">{money.format(season.rosterSalary)} roster</span></div>
                    <dl className="space-y-2 p-3 text-xs">
                      <div className="flex justify-between gap-3"><dt className="text-gray-500">Roster salaries</dt><dd className="font-bold tabular-nums text-gray-800 dark:text-gray-200">{money.format(season.rosterSalary)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-500">Buyout penalties · {season.buyoutSlotsUsed} slots</dt><dd className="font-bold tabular-nums text-gray-800 dark:text-gray-200">{money.format(season.buyoutPenaltyTotal)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-500">Retention {season.retentionNet > 0 ? "charges" : season.retentionNet < 0 ? "relief" : "net"} · {season.retentionSlotsUsed} slots</dt><dd className={`font-bold tabular-nums ${season.retentionNet > 0 ? "text-error-600 dark:text-error-300" : season.retentionNet < 0 ? "text-success-600 dark:text-success-300" : "text-gray-800 dark:text-gray-200"}`}>{season.retentionNet > 0 ? "+" : season.retentionNet < 0 ? "−" : ""}{money.format(Math.abs(season.retentionNet))}</dd></div>
                      <div className="flex justify-between gap-3 border-t border-gray-100 pt-2 font-black dark:border-gray-800"><dt>Cap used</dt><dd className="tabular-nums text-gray-900 dark:text-white">{money.format(season.salary)}</dd></div>
                      <div className="flex justify-between gap-3 font-black"><dt>Cap space · {money.format(salaryCapForSeason(season.year))} ceiling</dt><dd className={`tabular-nums ${season.capSpace < 0 ? "text-error-600 dark:text-error-300" : "text-success-700 dark:text-success-300"}`}>{season.capSpace < 0 ? `−${money.format(Math.abs(season.capSpace))}` : money.format(season.capSpace)}</dd></div>
                    </dl>
                    <div className="border-t border-gray-100 dark:border-gray-800">
                      <h4 className="px-3 py-2 text-[10px] font-black uppercase tracking-wide text-gray-500">Recorded cap-counting salaries</h4>
                      {season.capRoster.length ? <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">{season.capRoster.map((player) => <li key={player.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs"><span className="min-w-0 truncate font-semibold text-gray-800 dark:text-gray-200">{player.name}<span className="ml-1 font-normal text-gray-400">{player.position}</span>{player.expires && <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">expires</span>}</span><span className="shrink-0 font-bold tabular-nums text-gray-800 dark:text-gray-200">{money.format(player.salary)}</span></li>)}</ul> : <p className="px-3 pb-3 text-xs text-gray-500">No recorded cap-counting salaries for this season.</p>}
                    </div>
                  </section>
                  <section className="space-y-4">
                    <div className="overflow-hidden rounded-xl border border-amber-200 bg-white dark:border-amber-500/30 dark:bg-gray-900">
                      <div className="border-b border-amber-100 bg-amber-50 px-3 py-2 dark:border-amber-500/20 dark:bg-amber-500/10"><h3 className="text-xs font-black text-amber-900 dark:text-amber-200">Contracts ending after {season.year}</h3></div>
                      {season.expiringContracts.length ? <ul className="divide-y divide-gray-100 dark:divide-gray-800">{season.expiringContracts.map((contract) => <li key={contract.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs"><span className="min-w-0 truncate font-semibold text-gray-800 dark:text-gray-200">{contract.name}<span className="ml-1 font-normal text-gray-400">{contract.position}</span></span><span className="shrink-0 font-bold tabular-nums text-gray-700 dark:text-gray-300">{contract.salary === null ? "Salary not recorded" : money.format(contract.salary)}</span></li>)}</ul> : <p className="px-3 py-4 text-xs text-gray-500">No recorded roster contracts end this season.</p>}
                    </div>
                    {season.rfas.length > 0 && <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-500/30 dark:bg-violet-500/10"><h3 className="text-xs font-black text-violet-900 dark:text-violet-200">RFA status for {season.year}</h3><ul className="mt-2 space-y-1 text-xs">{season.rfas.map((rfa) => <li key={rfa.playerId} className="text-gray-700 dark:text-gray-200">{rfa.name}<span className="ml-1 font-semibold text-violet-700 dark:text-violet-300">{rfa.confirmed ? "recorded" : "projected"}</span></li>)}</ul></div>}
                    <p className="text-[10px] leading-5 text-gray-500">Only recorded salaries and cap adjustments are included. Missing future contracts and adjustments aren’t projected.</p>
                  </section>
                </div>
              </td></tr>;
            })}</Fragment>)}</tbody>
          </table>
        </div>}
      </section>
      </>}
    </div>
  </div>;
}
