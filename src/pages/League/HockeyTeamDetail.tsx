import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import {
  type FantasyTeam,
  type FantasyTeamManagerTenure,
  fetchFantasyTeamByAbbreviation,
  fetchTeamManagerTenures,
  getManagerForSeason,
} from "../../lib/fantasyTeams";
import { fetchPlayerSeasonsByTeamAndSeason, type PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import {
  fetchNhlGoalieStats,
  fetchNhlSkaterStats,
  formatFantasyPoints,
  formatNhlStat,
  getGoalieScore,
  getSkaterScore,
  type NhlGoalieRecord,
  type NhlSkaterRecord,
} from "../../lib/nhl";

const SALARY_CAP = 45_000_000;
const ROSTER_LIMIT = 23;
const seasonOptions = Array.from({ length: 10 }, (_, index) => 2026 + index);
const activeSections = [
  { code: "C", label: "Centers", type: "skater" },
  { code: "LW", label: "Left Wings", type: "skater" },
  { code: "RW", label: "Right Wings", type: "skater" },
  { code: "D", label: "Defence", type: "skater" },
  { code: "G", label: "Goalies", type: "goalie" },
] as const;
const nonRosterSections = [
  { code: "W", label: "Waivers", cap: true },
  { code: "IR", label: "Injured Reserve", cap: true },
  { code: "LTIR", label: "Long-Term Injured Reserve", cap: false },
  { code: "RETENTION", label: "Retention", cap: true },
  { code: "BUYOUT", label: "Buyout", cap: true },
] as const;
const activePositions = new Set(activeSections.map((section) => section.code));
const capPositions = new Set([...activePositions, "W", "IR", "RETENTION", "BUYOUT"]);
const prospectPositions = new Set(["PROSPECT", "AP"]);
const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

function nhlSeasonId(year: number) {
  return (year - 1) * 10000 + year;
}

function playerName(season: PlayerSeasonWithRelations) {
  return season.player?.full_name || [season.player?.first_name, season.player?.last_name].filter(Boolean).join(" ") || "Unknown Player";
}

function playerApiId(season: PlayerSeasonWithRelations) {
  return season.player?.player_api_id || "";
}

function position(season: PlayerSeasonWithRelations) {
  return (season.position || "UNASSIGNED").toUpperCase();
}

function nhlSkaterPosition(code: string | undefined) {
  if (code === "L") return "LW";
  if (code === "R") return "RW";
  return code || "—";
}

function PlayerName({ season }: { season: PlayerSeasonWithRelations }) {
  return <div className="min-w-44 text-left">
    <p className="font-medium text-gray-800 dark:text-white/90">{playerName(season)}</p>
    <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
      {money.format(season.salary || 0)} · {season.term_end_year || "No term"}
    </p>
  </div>;
}

function PayrollCard({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className={`rounded-lg border p-4 ${danger ? "border-error-200 bg-error-50 dark:border-error-500/30 dark:bg-error-500/10" : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"}`}>
    <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">{label}</p>
    <p className={`mt-2 text-base font-semibold ${danger ? "text-error-700 dark:text-error-400" : "text-gray-800 dark:text-white/90"}`}>{value}</p>
  </div>;
}

function Medal({ icon, value, label }: { icon: string; value: number; label: string }) {
  return <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center dark:border-gray-800 dark:bg-gray-900">
    <span className="text-2xl" aria-label={label}>{icon}</span>
    <p className="mt-1 text-lg font-semibold text-gray-800 dark:text-white/90">{value}</p>
  </div>;
}

function SkaterTable({ code, label, players, stats }: { code: string; label: string; players: PlayerSeasonWithRelations[]; stats: Map<string, NhlSkaterRecord> }) {
  const rows = [...players].sort((a, b) => getSkaterScore(stats.get(playerApiId(b)) || emptySkater) - getSkaterScore(stats.get(playerApiId(a)) || emptySkater));
  return <RosterSection code={code} label={label} count={players.length}>
    <table className="min-w-full divide-y divide-gray-100 text-xs dark:divide-gray-800">
      <thead><tr className="text-center font-semibold uppercase text-gray-500 dark:text-gray-400">
        {['Player','NHL Team','Pos','G','A','+/-','PIMs','PPG','PPA','SHG','SHA','GWG','S','B','H','FOW','Score','PPG'].map((heading, index) => <th key={`${heading}-${index}`} className={`whitespace-nowrap px-2 py-2 ${index === 0 ? "text-left" : ""}`}>{heading}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {rows.length === 0 ? <EmptyRow columns={18} /> : rows.map((season) => {
          const record = stats.get(playerApiId(season));
          const score = record ? getSkaterScore(record) : 0;
          const values = record ? [record.goals, record.assists, record.plusMinus, record.penaltyMinutes, record.ppGoals, record.ppPoints-record.ppGoals, record.shGoals, record.shPoints-record.shGoals, record.gameWinningGoals, record.shots, record.blockedShots, record.hits, record.totalFaceoffWins] : Array(13).fill(null);
          return <tr key={season.id} className="text-center text-gray-600 dark:text-gray-300">
            <td className="px-2 py-2"><PlayerName season={season} /></td>
            <td className="px-2 py-2">{record?.teamAbbrevs || "—"}</td>
            <td className="px-2 py-2">{nhlSkaterPosition(record?.positionCode)}</td>
            {values.map((value, index) => <td key={index} className="px-2 py-2">{formatNhlStat(value)}</td>)}
            <td className="px-2 py-2 font-semibold text-gray-800 dark:text-white/90">{formatFantasyPoints(score)}</td>
            <td className="px-2 py-2">{record?.gamesPlayed ? formatFantasyPoints(score / record.gamesPlayed) : "—"}</td>
          </tr>;
        })}
      </tbody>
    </table>
  </RosterSection>;
}

function GoalieTable({ players, stats }: { players: PlayerSeasonWithRelations[]; stats: Map<string, NhlGoalieRecord> }) {
  const rows = [...players].sort((a, b) => getGoalieScore(stats.get(playerApiId(b)) || emptyGoalie) - getGoalieScore(stats.get(playerApiId(a)) || emptyGoalie));
  return <RosterSection code="G" label="Goalies" count={players.length}>
    <table className="min-w-full divide-y divide-gray-100 text-xs dark:divide-gray-800">
      <thead><tr className="text-center font-semibold uppercase text-gray-500 dark:text-gray-400">
        {['Player','NHL Team','Pos','GP','GS','W','L','OTL','GA','SV','SO','PIMs','G','A','SV%','GAA','Score','PPG'].map((heading, index) => <th key={heading} className={`whitespace-nowrap px-2 py-2 ${index === 0 ? "text-left" : ""}`}>{heading}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {rows.length === 0 ? <EmptyRow columns={18} /> : rows.map((season) => {
          const record = stats.get(playerApiId(season));
          const score = record ? getGoalieScore(record) : 0;
          const values = record ? [record.gamesPlayed,record.gamesStarted,record.wins,record.losses,record.otLosses,record.goalsAgainst,record.saves,record.shutouts,record.penaltyMinutes,record.goals,record.assists] : Array(11).fill(null);
          return <tr key={season.id} className="text-center text-gray-600 dark:text-gray-300">
            <td className="px-2 py-2"><PlayerName season={season} /></td>
            <td className="px-2 py-2">{record?.teamAbbrevs || "—"}</td>
            <td className="px-2 py-2">G</td>
            {values.map((value, index) => <td key={index} className="px-2 py-2">{formatNhlStat(value)}</td>)}
            <td className="px-2 py-2">{record?.savePct == null ? "—" : record.savePct.toFixed(3)}</td>
            <td className="px-2 py-2">{formatNhlStat(record?.goalsAgainstAverage, 2)}</td>
            <td className="px-2 py-2 font-semibold text-gray-800 dark:text-white/90">{formatFantasyPoints(score)}</td>
            <td className="px-2 py-2">{record?.gamesPlayed ? formatFantasyPoints(score / record.gamesPlayed) : "—"}</td>
          </tr>;
        })}
      </tbody>
    </table>
  </RosterSection>;
}

function CompactTable({ code, label, players, skaters, goalies, note }: { code: string; label: string; players: PlayerSeasonWithRelations[]; skaters: Map<string, NhlSkaterRecord>; goalies: Map<string, NhlGoalieRecord>; note: string }) {
  return <RosterSection code={code} label={label} count={players.length} note={note}>
    <table className="min-w-full divide-y divide-gray-100 text-xs dark:divide-gray-800">
      <thead><tr className="text-left font-semibold uppercase text-gray-500 dark:text-gray-400">
        {['Name','Team','Pos','Salary','Term'].map((heading) => <th key={heading} className="px-2 py-2">{heading}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {players.length === 0 ? <EmptyRow columns={5} /> : players.map((season) => {
          const skater = skaters.get(playerApiId(season));
          const goalie = goalies.get(playerApiId(season));
          const apiPosition = goalie ? "G" : nhlSkaterPosition(skater?.positionCode);
          return <tr key={season.id} className="text-gray-600 dark:text-gray-300">
            <td className="px-2 py-2 font-medium text-gray-800 dark:text-white/90">{playerName(season)}</td>
            <td className="px-2 py-2">{skater?.teamAbbrevs || goalie?.teamAbbrevs || "—"}</td>
            <td className="px-2 py-2">{apiPosition || "—"}</td>
            <td className="px-2 py-2">{money.format(season.salary || 0)}</td>
            <td className="px-2 py-2">{season.term_end_year || "—"}</td>
          </tr>;
        })}
      </tbody>
    </table>
  </RosterSection>;
}

function RosterSection({ code, label, count, note, children }: { code: string; label: string; count: number; note?: string; children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
    <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-white/[0.03]">
      <h4 className="text-sm font-semibold text-gray-800 dark:text-white/90">{code} <span className="font-normal text-gray-500">({label})</span></h4>
      <span className="text-xs text-gray-500 dark:text-gray-400">{note || `${count} players`}</span>
    </div>
    <div className="overflow-x-auto">{children}</div>
  </section>;
}

function EmptyRow({ columns }: { columns: number }) {
  return <tr><td colSpan={columns} className="px-3 py-4 text-center text-gray-500 dark:text-gray-400">No players.</td></tr>;
}

const emptySkater: NhlSkaterRecord = { playerId: 0, skaterFullName: "", positionCode: "", teamAbbrevs: "", gamesPlayed: 0, goals: 0, assists: 0, plusMinus: 0, penaltyMinutes: 0, ppGoals: 0, ppPoints: 0, shGoals: 0, shPoints: 0, gameWinningGoals: 0, shots: 0, blockedShots: 0, hits: 0, totalFaceoffWins: 0 };
const emptyGoalie: NhlGoalieRecord = { playerId: 0, goalieFullName: "", teamAbbrevs: "", gamesPlayed: 0, gamesStarted: 0, wins: 0, losses: 0, otLosses: 0, goalsAgainst: 0, saves: 0, shutouts: 0, penaltyMinutes: 0, goals: 0, assists: 0, savePct: null, goalsAgainstAverage: null };

export default function HockeyTeamDetail() {
  const { abbreviation = "" } = useParams();
  const [team, setTeam] = useState<FantasyTeam | null>(null);
  const [managerTenures, setManagerTenures] = useState<FantasyTeamManagerTenure[]>([]);
  const [selectedSeason, setSelectedSeason] = useState(2026);
  const [roster, setRoster] = useState<PlayerSeasonWithRelations[]>([]);
  const [skaters, setSkaters] = useState<Map<string, NhlSkaterRecord>>(new Map());
  const [goalies, setGoalies] = useState<Map<string, NhlGoalieRecord>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statsError, setStatsError] = useState("");

  useEffect(() => {
    setLoading(true);
    fetchFantasyTeamByAbbreviation(abbreviation)
      .then(async (row) => {
        setTeam(row);
        setManagerTenures(row ? await fetchTeamManagerTenures(row.id) : []);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [abbreviation]);

  useEffect(() => {
    if (!team) return;
    fetchPlayerSeasonsByTeamAndSeason(team.id, selectedSeason)
      .then((seasonRows) => {
        setRoster(seasonRows);
        setError("");
      })
      .catch((err: Error) => setError(err.message));

    Promise.all([
      fetchNhlSkaterStats(nhlSeasonId(selectedSeason)),
      fetchNhlGoalieStats(nhlSeasonId(selectedSeason)),
    ])
      .then(([skaterRows, goalieRows]) => {
        setSkaters(new Map(skaterRows.map((row) => [String(row.playerId), row])));
        setGoalies(new Map(goalieRows.map((row) => [String(row.playerId), row])));
        setStatsError("");
      })
      .catch((err: Error) => {
        setSkaters(new Map());
        setGoalies(new Map());
        setStatsError(err.message || "Unable to load NHL statistics.");
      });
  }, [team, selectedSeason]);

  const byPosition = useMemo(() => roster.reduce<Record<string, PlayerSeasonWithRelations[]>>((groups, season) => {
    const code = position(season);
    (groups[code] ||= []).push(season);
    return groups;
  }, {}), [roster]);
  const selectedManager = getManagerForSeason(managerTenures, selectedSeason);
  const rosterCount = roster.filter((season) => activePositions.has(position(season) as never)).length;
  const capSalary = roster.filter((season) => capPositions.has(position(season) as never)).reduce((sum, season) => sum + (season.salary || 0), 0);
  const capSpace = SALARY_CAP - capSalary;
  const prospects = roster.filter((season) => prospectPositions.has(position(season)));

  return <div>
    <PageMeta title="Great Lakes Dynasty Hockey League" description="GLDHL team roster and payroll" />
    <PageBreadcrumb pageTitle={team?.team_name || "Team Detail"} />
    {loading && <div className="rounded-2xl border border-gray-200 p-10 text-center text-sm text-gray-500">Loading team…</div>}
    {!loading && error && !team && <div className="rounded-2xl border border-error-200 bg-error-50 p-5 text-error-700">{error}</div>}
    {!loading && !team && !error && <div className="rounded-2xl border border-gray-200 p-10 text-center"><p>Team not found.</p><Link to="/teams" className="mt-4 inline-block text-brand-500">Back to Teams</Link></div>}
    {team && <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="h-3" style={{ background: `linear-gradient(90deg, ${team.primary_color || "#1d4ed8"}, ${team.secondary_color || "#f97316"})` }} />
      <div className="p-4 xl:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">{team.logo ? <img src={team.logo} alt={`${team.team_name} logo`} className="h-full w-full object-cover" /> : team.abbreviation}</div>
            <div><h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">{team.team_name}</h2><p className="text-sm text-gray-500">{team.abbreviation} · Team ID {team.id}</p></div>
          </div>
          <div className="rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800"><p className="text-xs uppercase text-gray-500">Manager · {selectedSeason}</p><p className="font-medium text-gray-800 dark:text-white/90">{selectedManager?.manager_name || team.manager_name || "Not set"}</p></div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3"><Medal icon="🥇" value={team.championships} label="Championships" /><Medal icon="🥈" value={team.runner_up_finishes} label="Runner-up finishes" /><Medal icon="🥉" value={team.third_place_finishes} label="Third-place finishes" /></div>

        <div className="mt-6 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="font-semibold text-gray-800 text-theme-lg dark:text-white/90">Roster &amp; Payroll</h3><p className="text-xs text-gray-500">Active roster limit: {ROSTER_LIMIT} players.</p></div><div className="w-full sm:w-44"><label htmlFor="season" className="mb-1 block text-sm font-medium">Season</label><select id="season" value={selectedSeason} onChange={(event) => setSelectedSeason(Number(event.target.value))} className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 dark:border-gray-700 dark:bg-gray-900">{seasonOptions.map((year) => <option key={year}>{year}</option>)}</select></div></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><PayrollCard label="Salary Cap" value={money.format(SALARY_CAP)} /><PayrollCard label="Cap Salary" value={money.format(capSalary)} /><PayrollCard label={capSpace >= 0 ? "Cap Space" : "Over Cap"} value={money.format(Math.abs(capSpace))} danger={capSpace < 0} /><PayrollCard label="Active Roster" value={`${rosterCount} / ${ROSTER_LIMIT}`} danger={rosterCount > ROSTER_LIMIT} /></div>
          {error && <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">{error}</div>}
          {statsError && <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">Roster loaded, but NHL statistics could not be loaded: {statsError}</div>}
          <div className="mt-5 space-y-4">
            {activeSections.map((section) => section.type === "goalie" ? <GoalieTable key={section.code} players={byPosition.G || []} stats={goalies} /> : <SkaterTable key={section.code} code={section.code} label={section.label} players={byPosition[section.code] || []} stats={skaters} />)}
            <div className="pt-2"><h3 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Non-Rostered Players</h3><div className="space-y-4">{nonRosterSections.map((section) => <CompactTable key={section.code} code={section.code} label={section.label} players={byPosition[section.code] || []} skaters={skaters} goalies={goalies} note={section.cap ? "Counts toward cap only" : "Excluded from cap and roster"} />)}</div></div>
            <div className="pt-2"><h3 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Acquired Prospects</h3><CompactTable code="AP" label="Acquired Prospects" players={prospects} skaters={skaters} goalies={goalies} note="Excluded from cap and roster" /></div>
          </div>
        </div>
      </div>
    </div>}
  </div>;
}
