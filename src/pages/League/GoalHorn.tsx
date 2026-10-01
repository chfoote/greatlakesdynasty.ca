import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { fetchGoalFeed, type GoalFeedEvent, type GoalFeedPlayer } from "../../lib/goalFeed";
import { getNhlStatsDate } from "../../lib/nhl";
import type { FantasyTeam } from "../../lib/fantasyTeams";

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function periodLabel(event: GoalFeedEvent) {
  if (event.periodType === "SO") return "Shootout";
  if (event.periodType === "OT") return event.period > 4 ? `${event.period - 3}OT` : "OT";
  return event.period ? `${event.period}${event.period === 1 ? "st" : event.period === 2 ? "nd" : event.period === 3 ? "rd" : "th"}` : "—";
}

function FantasyOwnership({ player, primary = false }: { player: GoalFeedPlayer; primary?: boolean }) {
  const team = player.fantasyTeam;
  return <div className="flex min-w-0 items-center gap-2">
    {player.headshot && <Link to={`/player-profile?playerId=${player.playerId}`} className={`${primary ? "h-12 w-12" : "h-8 w-8"} shrink-0 overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700`}><img src={player.headshot} alt="" className="h-full w-full object-cover object-top" /></Link>}
    <div className="min-w-0"><Link to={`/player-profile?playerId=${player.playerId}`} className={`${primary ? "text-base" : "text-sm"} block truncate font-black text-gray-900 hover:text-brand-500 dark:text-white`}>{player.name}</Link><div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">{team?.logo && <img src={team.logo} alt="" className="h-4 w-4 object-contain" />}{team ? <Link to={`/teams/${team.abbreviation}`} className="hover:text-brand-500">{team.abbreviation}</Link> : <span>Free Agent</span>}{player.prospect && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[8px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Prospect</span>}</div></div>
  </div>;
}

function GoalCard({ event }: { event: GoalFeedEvent }) {
  const final = ["OFF", "FINAL"].includes(event.gameState);
  return <article className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
    <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-red-500 via-amber-400 to-yellow-300" />
    <div className="grid gap-4 p-4 pl-5 sm:p-5 sm:pl-6 lg:grid-cols-[190px_minmax(190px,1fr)_minmax(260px,1.35fr)_165px] lg:items-center"><div className="flex items-center gap-3">{event.nhlTeam.logo && <img src={event.nhlTeam.logo} alt={`${event.nhlTeam.abbreviation} logo`} className="h-11 w-11 object-contain" />}<div><div className="flex items-center gap-2"><span className="text-xs font-black uppercase tracking-[0.18em] text-red-500">Goal</span>{event.strength && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{event.strength}</span>}</div><p className="mt-1 text-xs font-semibold text-gray-500">{periodLabel(event)} · {event.timeInPeriod}</p>{event.shotType && <p className="mt-0.5 text-[10px] capitalize text-gray-400">{event.shotType.replace(/-/g, " ")}</p>}</div></div>
      <div className="rounded-xl bg-gradient-to-r from-red-50 to-amber-50 p-3 dark:from-red-500/10 dark:to-amber-500/10"><p className="mb-2 text-[9px] font-black uppercase tracking-[0.16em] text-red-500">Scored by</p><FantasyOwnership player={event.scorer} primary /></div>
      <div><p className="mb-2 text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">Assists</p>{event.assists.length ? <div className="grid gap-2 sm:grid-cols-2">{event.assists.map((assist) => <div key={assist.playerId} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-900/50"><FantasyOwnership player={assist} /></div>)}</div> : <p className="text-xs font-semibold text-gray-400">Unassisted</p>}</div>
      <div className="flex items-center justify-center gap-2 rounded-xl bg-gray-50 px-3 py-3 dark:bg-gray-900/70"><span className="text-xs font-black text-gray-500">{event.awayTeam.abbreviation}</span><span className="text-xl font-black text-gray-900 dark:text-white">{event.awayTeam.score}–{event.homeTeam.score}</span><span className="text-xs font-black text-gray-500">{event.homeTeam.abbreviation}</span>{final && <span className="ml-1 text-[8px] font-black uppercase text-gray-400">Final</span>}</div>
    </div>
  </article>;
}

export default function GoalHorn() {
  const today = getNhlStatsDate();
  const [date, setDate] = useState(today);
  const [events, setEvents] = useState<GoalFeedEvent[]>([]);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [games, setGames] = useState(0);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true); else setLoading(true);
    setError("");
    try { const result = await fetchGoalFeed(date); setEvents(result.events); setTeams(result.teams); setGames(result.games); setLive(result.live); setUpdatedAt(new Date()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load The Goal Horn."); }
    finally { setLoading(false); setRefreshing(false); }
  }, [date]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (date !== today) return;
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [date, today, load]);
  const filteredEvents = useMemo(() => selectedTeamId == null ? events : events.filter((event) => [event.scorer, ...event.assists].some((player) => player.fantasyTeam?.id === selectedTeamId)), [events, selectedTeamId]);

  return <div>
    <PageMeta title="The Goal Horn | GLDHL" description="Live NHL goals with GLDHL fantasy ownership" />
    <PageBreadcrumb pageTitle="The Goal Horn" />
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-red-950 via-slate-950 to-amber-950 p-6 text-white shadow-lg sm:p-8"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">🚨 GLDHL Live Scoring</p><h1 className="mt-2 text-3xl font-black sm:text-5xl">The Goal Horn</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Every NHL goal, translated into GLDHL ownership. Scorers, helpers, fantasy franchises, and the live game situation in one place.</p></div><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${live ? "animate-pulse bg-red-400" : "bg-slate-500"}`} /><span className="text-xs font-black uppercase tracking-wider text-slate-300">{live ? "Games live · auto-refreshing" : `${games} ${games === 1 ? "game" : "games"}`}</span></div></div></section>

      <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-white/[0.03] sm:flex-row sm:items-end sm:justify-between sm:p-4"><div className="flex gap-2"><button type="button" onClick={() => setDate((current) => shiftDate(current, -1))} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-black text-gray-600 dark:bg-gray-800 dark:text-gray-300">← Previous</button><button type="button" onClick={() => setDate(today)} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-black text-gray-600 dark:bg-gray-800 dark:text-gray-300">Today</button><button type="button" disabled={date >= today} onClick={() => setDate((current) => shiftDate(current, 1))} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-black text-gray-600 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300">Next →</button></div><div className="flex items-end gap-2"><label className="text-[10px] font-black uppercase tracking-wider text-gray-500">Hockey Date<input type="date" max={today} value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white" /></label><button type="button" disabled={refreshing} onClick={() => void load(true)} className="h-10 rounded-lg bg-red-600 px-4 text-sm font-black text-white disabled:opacity-60">{refreshing ? "Refreshing…" : "Refresh"}</button></div></section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-brand-500">Fantasy Team Filter</p><p className="mt-0.5 text-xs text-gray-500">Show goals scored or assisted by a franchise</p></div>{selectedTeamId != null && <button type="button" onClick={() => setSelectedTeamId(null)} className="text-xs font-black text-brand-500 hover:underline">Clear filter</button>}</div><div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"><button type="button" onClick={() => setSelectedTeamId(null)} className={`flex h-14 min-w-14 shrink-0 items-center justify-center rounded-xl border px-3 text-[10px] font-black uppercase transition ${selectedTeamId == null ? "border-brand-500 bg-brand-50 text-brand-600 ring-2 ring-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300" : "border-gray-200 bg-gray-50 text-gray-500 hover:border-brand-300 dark:border-gray-700 dark:bg-gray-900"}`}>All</button>{teams.map((team) => <button key={team.id} type="button" title={team.team_name} aria-label={`Filter by ${team.team_name}`} onClick={() => setSelectedTeamId((current) => current === team.id ? null : team.id)} className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border p-1.5 transition ${selectedTeamId === team.id ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/20 dark:bg-brand-500/10" : "border-gray-200 bg-gray-50 hover:border-brand-300 dark:border-gray-700 dark:bg-gray-900"}`}>{team.logo ? <img src={team.logo} alt={`${team.team_name} logo`} className="h-full w-full object-contain" /> : <span className="text-[9px] font-black text-gray-500">{team.abbreviation}</span>}</button>)}</div></section>

      {updatedAt && <p className="px-1 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Updated {updatedAt.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</p>}
      {error && <p role="alert" className="rounded-xl border border-error-200 bg-error-50 p-4 text-sm font-semibold text-error-700">{error}</p>}
      {loading ? <div className="space-y-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-36 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />)}</div> : filteredEvents.length ? <div className="space-y-3">{filteredEvents.map((event) => <GoalCard key={event.key} event={event} />)}</div> : <section className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-16 text-center dark:border-gray-700 dark:bg-white/[0.02]"><div className="text-5xl">🥅</div><h2 className="mt-4 text-xl font-black text-gray-900 dark:text-white">The horn is quiet</h2><p className="mt-2 text-sm text-gray-500">{selectedTeamId != null ? "No goals or assists involve this fantasy team on the selected date." : games ? "No goals have been scored yet." : "No NHL games are scheduled for this hockey date."}</p></section>}
    </div>
  </div>;
}
