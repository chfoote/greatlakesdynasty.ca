import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { fetchGoalFeed, type FeedStanding, type GoalieFeedEvent, type GoalFeedEvent, type GoalFeedPlayer, type RecordMovementEvent } from "../../lib/goalFeed";
import { getNhlStatsDate } from "../../lib/nhl";
import type { FantasyTeam } from "../../lib/fantasyTeams";
import { useAuth } from "../../context/AuthContext";
import { fetchLatestUserTeamAssignment, fetchUserTeamAssignment } from "../../lib/teamUserAssignments";

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
    <div className="min-w-0"><Link to={`/player-profile?playerId=${player.playerId}`} className={`${primary ? "text-base" : "text-sm"} block truncate font-black text-gray-900 hover:text-brand-500 dark:text-white`}>{player.name}</Link><div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">{team?.logo && <img src={team.logo} alt="" className="h-4 w-4 object-contain" />}{team ? <Link to={`/teams/${team.abbreviation}`} className="hover:text-brand-500">{team.abbreviation}</Link> : <span>Free Agent</span>}{player.prospect && <><span>·</span><span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[8px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Prospect</span></>}{player.tonightPoints != null && <><span>·</span><span className="text-brand-500">{player.tonightPoints.toFixed(2)} FPTS tonight</span></>}</div></div>
  </div>;
}

function GoalieCard({ event, records = [], viewerTeamId }: { event: GoalieFeedEvent; records?: RecordFeedEvent[]; viewerTeamId: number | null }) {
  const highlighted = event.goalie.fantasyTeam?.id === viewerTeamId;
  return <article className="relative overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-theme-xs dark:border-sky-900/70 dark:bg-white/[0.03]">
    <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-sky-500 via-blue-500 to-indigo-500" />
    <div className="grid gap-4 p-4 pl-5 sm:p-5 sm:pl-6 lg:grid-cols-[190px_minmax(260px,1fr)_165px] lg:items-center">
      <div className="flex items-center gap-3">{event.nhlTeam.logo && <img src={event.nhlTeam.logo} alt={`${event.nhlTeam.abbreviation} logo`} className="h-11 w-11 object-contain" />}<div><p className="text-xs font-black uppercase tracking-[0.18em] text-sky-600">{event.shutout ? "Shutout" : "Goalie Win"}</p><p className="mt-1 text-xs font-semibold text-gray-500">Final · {event.saves} saves</p></div></div>
      <div className={`rounded-xl p-3 ${highlighted ? "bg-gradient-to-r from-amber-100 to-yellow-50 ring-1 ring-amber-300 dark:from-amber-500/20 dark:to-yellow-500/10 dark:ring-amber-700" : "bg-gray-50 dark:bg-gray-900/60"}`}><p className={`mb-2 text-[9px] font-black uppercase tracking-[0.16em] ${highlighted ? "text-amber-700 dark:text-amber-300" : "text-sky-600"}`}>{event.shutout ? `Shuts the door · ${event.saves}-save shutout` : `Earns the win · ${event.saves} saves`}</p><FantasyOwnership player={event.goalie} primary /><PlayerRecordLines events={records} playerId={event.goalie.playerId} /></div>
      <div className="flex items-center justify-center gap-2 rounded-xl bg-gray-50 px-3 py-3 dark:bg-gray-900/70"><span className="text-xs font-black text-gray-500">{event.awayTeam.abbreviation}</span><span className="text-xl font-black text-gray-900 dark:text-white">{event.awayTeam.score}–{event.homeTeam.score}</span><span className="text-xs font-black text-gray-500">{event.homeTeam.abbreviation}</span><span className="ml-1 text-[8px] font-black uppercase text-gray-400">Final</span></div>
    </div>
  </article>;
}

type AroundHornEvent = ({ kind: "goal" } & GoalFeedEvent) | ({ kind: "goalie" } & GoalieFeedEvent);

type StandingsFeedEvent = { kind: "standings"; key: string; team: FantasyTeam; passedTeam: FantasyTeam; rank: number; points: number; sortValue: number };
type RecordFeedEvent = { kind: "record" } & RecordMovementEvent;
type DisplayFeedEvent = AroundHornEvent | StandingsFeedEvent | RecordFeedEvent;

function PlayerRecordLines({ events, playerId }: { events: RecordFeedEvent[]; playerId: string }) {
  const movements = events.filter((event) => event.player.playerId === playerId).flatMap((event) => event.movements);
  if (!movements.length) return null;
  return <div className="mt-3 space-y-1.5 border-t border-gray-200/80 pt-2.5 dark:border-gray-700/80">
    <Link to="/record-book" className="flex w-fit items-center gap-1 text-[8px] font-black uppercase tracking-[0.14em] text-amber-700 hover:text-amber-600 dark:text-amber-300"><span>🏆</span><span>Record Book</span></Link>
    {movements.map((movement) => {
      const league = movement.scope === "league";
      return <Link key={`${movement.scope}:${movement.abbreviation}`} to="/record-book" className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-[10px] transition hover:-translate-y-px hover:shadow-sm ${league ? "border-rose-200 bg-gradient-to-r from-rose-50 to-orange-50 dark:border-rose-900/70 dark:from-rose-500/10 dark:to-orange-500/10" : "border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 dark:border-violet-900/70 dark:from-violet-500/10 dark:to-indigo-500/10"}`}><span className={`font-black ${league ? "text-rose-700 dark:text-rose-300" : "text-violet-700 dark:text-violet-300"}`}>{league ? "League" : "Franchise"} ({movement.abbreviation})</span><span className="flex items-center gap-1.5"><span className={`rounded-md px-1.5 py-0.5 font-black text-white shadow-sm ${league ? "bg-gradient-to-r from-red-600 to-rose-500" : "bg-gradient-to-r from-violet-600 to-indigo-500"}`}>{movement.tied ? "T-" : ""}#{movement.afterRank}</span><span className="font-bold text-gray-500">({movement.value})</span></span></Link>;
    })}
  </div>;
}

function StandingsCard({ event }: { event: StandingsFeedEvent }) {
  const place = event.rank === 1 ? "1st" : event.rank === 2 ? "2nd" : event.rank === 3 ? "3rd" : `${event.rank}th`;
  return <article className="relative overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-theme-xs dark:border-violet-900/70 dark:bg-white/[0.03]">
    <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-violet-500 to-fuchsia-500" />
    <div className="flex flex-col gap-4 p-5 pl-6 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3">{event.team.logo && <img src={event.team.logo} alt="" className="h-12 w-12 object-contain" />}<div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-600">Standings movement</p><p className="mt-1 font-black text-gray-900 dark:text-white">{event.team.team_name} moves into {place}</p><p className="mt-1 text-xs text-gray-500">Passes {event.passedTeam.team_name}</p></div></div><div className="rounded-xl bg-violet-50 px-4 py-3 text-center dark:bg-violet-500/10"><p className="text-xl font-black text-violet-700 dark:text-violet-300">{event.points.toFixed(2)}</p><p className="text-[9px] font-black uppercase tracking-wider text-violet-500">Season FPTS</p></div></div>
  </article>;
}

function GoalCard({ event, records = [], viewerTeamId }: { event: GoalFeedEvent; records?: RecordFeedEvent[]; viewerTeamId: number | null }) {
  const final = ["OFF", "FINAL"].includes(event.gameState);
  const scorerHighlighted = event.scorer.fantasyTeam?.id === viewerTeamId;
  return <article className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
    <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-red-500 via-amber-400 to-yellow-300" />
    <div className="grid gap-4 p-4 pl-5 sm:p-5 sm:pl-6 lg:grid-cols-[190px_minmax(190px,1fr)_minmax(260px,1.35fr)_165px] lg:items-center"><div className="flex items-center gap-3">{event.nhlTeam.logo && <img src={event.nhlTeam.logo} alt={`${event.nhlTeam.abbreviation} logo`} className="h-11 w-11 object-contain" />}<div><div className="flex items-center gap-2"><span className="text-xs font-black uppercase tracking-[0.18em] text-red-500">Goal</span>{event.strength && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{event.strength}</span>}</div><p className="mt-1 text-xs font-semibold text-gray-500">{periodLabel(event)} · {event.timeInPeriod}</p>{event.shotType && <p className="mt-0.5 text-[10px] capitalize text-gray-400">{event.shotType.replace(/-/g, " ")}</p>}</div></div>
      <div className={`rounded-xl p-3 ${scorerHighlighted ? "bg-gradient-to-r from-amber-100 to-yellow-50 ring-1 ring-amber-300 dark:from-amber-500/20 dark:to-yellow-500/10 dark:ring-amber-700" : "bg-gray-50 dark:bg-gray-900/60"}`}><p className={`mb-2 text-[9px] font-black uppercase tracking-[0.16em] ${scorerHighlighted ? "text-amber-700 dark:text-amber-300" : "text-gray-400"}`}>Scored by</p><FantasyOwnership player={event.scorer} primary /><PlayerRecordLines events={records} playerId={event.scorer.playerId} /></div>
      <div><p className="mb-2 text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">Assists</p>{event.assists.length ? <div className="grid h-full gap-2 sm:grid-cols-2">{event.assists.map((assist) => { const highlighted = assist.fantasyTeam?.id === viewerTeamId; return <div key={assist.playerId} className={`rounded-lg border px-3 py-2 ${highlighted ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-500/10" : "border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/50"}`}><FantasyOwnership player={assist} /><PlayerRecordLines events={records} playerId={assist.playerId} /></div>; })}</div> : <p className="text-xs font-semibold text-gray-400">Unassisted</p>}</div>
      <div className="flex items-center justify-center gap-2 rounded-xl bg-gray-50 px-3 py-3 dark:bg-gray-900/70"><span className="text-xs font-black text-gray-500">{event.awayTeam.abbreviation}</span><span className="text-xl font-black text-gray-900 dark:text-white">{event.awayTeam.score}–{event.homeTeam.score}</span><span className="text-xs font-black text-gray-500">{event.homeTeam.abbreviation}</span>{final && <span className="ml-1 text-[8px] font-black uppercase text-gray-400">Final</span>}</div>
    </div>
  </article>;
}

export default function GoalHorn() {
  const { user } = useAuth();
  const today = getNhlStatsDate();
  const [date, setDate] = useState(today);
  const [events, setEvents] = useState<DisplayFeedEvent[]>([]);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [games, setGames] = useState(0);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [viewerTeamId, setViewerTeamId] = useState<number | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const feedOrder = useRef(new Map<string, number>());
  const feedOrderDate = useRef("");
  const previousStandings = useRef<FeedStanding[]>([]);
  const standingsEvents = useRef<StandingsFeedEvent[]>([]);
  const recordEvents = useRef<RecordFeedEvent[]>([]);
  const recordRequest = useRef(0);

  const load = useCallback(async (background = false) => {
    const requestId = ++recordRequest.current;
    if (background) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const result = await fetchGoalFeed(date);
      if (feedOrderDate.current !== date) { feedOrder.current.clear(); feedOrderDate.current = date; previousStandings.current = []; standingsEvents.current = []; recordEvents.current = []; }
      if (!previousStandings.current.length) previousStandings.current = result.baselineStandings;
      if (previousStandings.current.length && result.standings.length) {
        const previousByTeam = new Map(previousStandings.current.map((row) => [row.team.id, row]));
        const currentByTeam = new Map(result.standings.map((row) => [row.team.id, row]));
        result.standings.forEach((row) => {
          const previous = previousByTeam.get(row.team.id);
          if (!previous || row.rank >= previous.rank) return;
          const passed = previousStandings.current.find((candidate) => candidate.rank >= row.rank && candidate.rank < previous.rank && (currentByTeam.get(candidate.team.id)?.rank || 0) > row.rank);
          if (!passed) return;
          const movement: StandingsFeedEvent = { kind: "standings", key: `standings:${date}:${row.team.id}:${passed.team.id}:${row.rank}`, team: row.team, passedTeam: passed.team, rank: row.rank, points: row.points, sortValue: Date.now() };
          if (!standingsEvents.current.some((event) => event.key === movement.key)) standingsEvents.current.unshift(movement);
        });
      }
      previousStandings.current = result.standings;
      const firstLoad = feedOrder.current.size === 0;
      const nextEvents: DisplayFeedEvent[] = [
        ...result.events.map((event) => ({ ...event, kind: "goal" as const })),
        ...result.goalieEvents.map((event) => ({ ...event, kind: "goalie" as const })),
        ...recordEvents.current,
        ...standingsEvents.current,
      ];
      if (firstLoad) {
        nextEvents.forEach((event) => feedOrder.current.set(event.key, event.sortValue));
      } else {
        const newEvents = nextEvents.filter((event) => !feedOrder.current.has(event.key));
        const highestExistingOrder = Math.max(0, ...feedOrder.current.values());
        newEvents.forEach((event, index) => {
          // Newly detected events always belong above everything already in the
          // feed. NHL play data has no reliable cross-game wall-clock timestamp,
          // so comparing an arrival time with earlier estimates can misorder it.
          feedOrder.current.set(event.key, highestExistingOrder + newEvents.length - index);
        });
      }
      setEvents(nextEvents.sort((a, b) => (feedOrder.current.get(b.key) || b.sortValue) - (feedOrder.current.get(a.key) || a.sortValue)));
      setTeams(result.teams); setGames(result.games); setLive(result.live); setUpdatedAt(new Date());
      setRecordsLoading(true);
      void result.recordEventsPromise.then((rows) => {
        if (recordRequest.current !== requestId || feedOrderDate.current !== date) return;
        const nextRecords = rows.map((event) => ({ ...event, kind: "record" as const }));
        recordEvents.current = nextRecords;
        setEvents((current) => [...current.filter((event) => event.kind !== "record"), ...nextRecords].sort((a, b) => (feedOrder.current.get(b.key) || b.sortValue) - (feedOrder.current.get(a.key) || a.sortValue)));
        setRecordsLoading(false);
      });
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load Around the Horn."); }
    finally { setLoading(false); setRefreshing(false); }
  }, [date]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    if (!user) { setViewerTeamId(null); return; }
    const [year, month] = date.split("-").map(Number);
    const season = month >= 9 ? year + 1 : year;
    fetchUserTeamAssignment(user.id, season).then((assignment) => assignment || fetchLatestUserTeamAssignment(user.id)).then((assignment) => { if (active) setViewerTeamId(assignment?.fantasy_team_id ?? null); }).catch(() => { if (active) setViewerTeamId(null); });
    return () => { active = false; };
  }, [date, user]);
  useEffect(() => {
    if (date !== today) return;
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [date, today, load]);
  const filteredEvents = useMemo(() => selectedTeamId == null ? events : events.filter((event) => event.kind === "goal" ? [event.scorer, ...event.assists].some((player) => player.fantasyTeam?.id === selectedTeamId) : event.kind === "goalie" ? event.goalie.fantasyTeam?.id === selectedTeamId : event.kind === "record" ? event.player.fantasyTeam?.id === selectedTeamId : event.team.id === selectedTeamId || event.passedTeam.id === selectedTeamId), [events, selectedTeamId]);
  const visibleEvents = useMemo(() => filteredEvents.filter((event) => event.kind !== "record"), [filteredEvents]);
  const recordsFor = useCallback((event: GoalFeedEvent | GoalieFeedEvent) => filteredEvents.filter((candidate): candidate is RecordFeedEvent => candidate.kind === "record" && Math.abs(candidate.sortValue - event.sortValue - 0.5) < 0.001), [filteredEvents]);

  return <div>
    <PageMeta title="Around the Horn | GLDHL" description="Live NHL scoring and GLDHL fantasy updates" />
    <PageBreadcrumb pageTitle="Around the Horn" />
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-red-950 via-slate-950 to-sky-950 p-6 text-white shadow-lg sm:p-8"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">🚨 GLDHL Live Scoring</p><h1 className="mt-2 text-3xl font-black sm:text-5xl">Around the Horn</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Goals, helpers, goalie wins, shutouts, and live fantasy production from around the league.</p></div><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${live ? "animate-pulse bg-red-400" : "bg-slate-500"}`} /><span className="text-xs font-black uppercase tracking-wider text-slate-300">{live ? "Games live · auto-refreshing" : `${games} ${games === 1 ? "game" : "games"}`}</span></div></div></section>

      <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-white/[0.03] sm:flex-row sm:items-end sm:justify-between sm:p-4"><div className="flex gap-2"><button type="button" onClick={() => setDate((current) => shiftDate(current, -1))} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-black text-gray-600 dark:bg-gray-800 dark:text-gray-300">← Previous</button><button type="button" onClick={() => setDate(today)} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-black text-gray-600 dark:bg-gray-800 dark:text-gray-300">Today</button><button type="button" disabled={date >= today} onClick={() => setDate((current) => shiftDate(current, 1))} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-black text-gray-600 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300">Next →</button></div><div className="flex items-end gap-2"><label className="text-[10px] font-black uppercase tracking-wider text-gray-500">Hockey Date<input type="date" max={today} value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white" /></label><button type="button" disabled={refreshing} onClick={() => void load(true)} className="h-10 rounded-lg bg-red-600 px-4 text-sm font-black text-white disabled:opacity-60">{refreshing ? "Refreshing…" : "Refresh"}</button></div></section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-brand-500">Fantasy Team Filter</p><p className="mt-0.5 text-xs text-gray-500">Show goals scored or assisted by a franchise</p></div>{selectedTeamId != null && <button type="button" onClick={() => setSelectedTeamId(null)} className="text-xs font-black text-brand-500 hover:underline">Clear filter</button>}</div><div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"><button type="button" onClick={() => setSelectedTeamId(null)} className={`flex h-14 min-w-14 shrink-0 items-center justify-center rounded-xl border px-3 text-[10px] font-black uppercase transition ${selectedTeamId == null ? "border-brand-500 bg-brand-50 text-brand-600 ring-2 ring-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300" : "border-gray-200 bg-gray-50 text-gray-500 hover:border-brand-300 dark:border-gray-700 dark:bg-gray-900"}`}>All</button>{teams.map((team) => <button key={team.id} type="button" title={team.team_name} aria-label={`Filter by ${team.team_name}`} onClick={() => setSelectedTeamId((current) => current === team.id ? null : team.id)} className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border p-1.5 transition ${selectedTeamId === team.id ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/20 dark:bg-brand-500/10" : "border-gray-200 bg-gray-50 hover:border-brand-300 dark:border-gray-700 dark:bg-gray-900"}`}>{team.logo ? <img src={team.logo} alt={`${team.team_name} logo`} className="h-full w-full object-contain" /> : <span className="text-[9px] font-black text-gray-500">{team.abbreviation}</span>}</button>)}</div></section>

      {updatedAt && <div className="flex items-center justify-end gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{recordsLoading && <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />Loading record notes</span>}<span>Updated {updatedAt.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span></div>}
      {error && <p role="alert" className="rounded-xl border border-error-200 bg-error-50 p-4 text-sm font-semibold text-error-700">{error}</p>}
      {loading ? <div className="space-y-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-36 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />)}</div> : visibleEvents.length ? <div className="space-y-3">{visibleEvents.map((event) => event.kind === "goal" ? <GoalCard key={event.key} event={event} records={recordsFor(event)} viewerTeamId={viewerTeamId} /> : event.kind === "goalie" ? <GoalieCard key={event.key} event={event} records={recordsFor(event)} viewerTeamId={viewerTeamId} /> : <StandingsCard key={event.key} event={event} />)}</div> : <section className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-16 text-center dark:border-gray-700 dark:bg-white/[0.02]"><div className="text-5xl">🥅</div><h2 className="mt-4 text-xl font-black text-gray-900 dark:text-white">The horn is quiet</h2><p className="mt-2 text-sm text-gray-500">{selectedTeamId != null ? "No scoring events involve this fantasy team on the selected date." : games ? "No scoring events yet." : "No NHL games are scheduled for this hockey date."}</p></section>}
    </div>
  </div>;
}
