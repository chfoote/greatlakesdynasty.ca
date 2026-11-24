import { useNhlDataRevision } from "../../lib/useNhlDataRevision";
import { CURRENT_LEAGUE_SEASON } from "../../lib/leagueSeasons";
import NhlHeadshot from "../../components/hockey/NhlHeadshot";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import PositionBadge from "../../components/hockey/PositionBadge";
import { fetchFarmRankings, readFarmRankings, type FarmRanking, type RankedFarmProspect } from "../../lib/farmInsights";
import type { FarmRankingsSnapshot } from "../../lib/farmRankingsCache";
import { formatFantasyPoints } from "../../lib/nhl";

const podiumTone: Record<number, string> = { 1: "from-amber-300 via-yellow-100 to-amber-500 text-amber-950", 2: "from-slate-200 via-white to-slate-400 text-slate-800", 3: "from-orange-300 via-orange-100 to-orange-500 text-orange-950" };

function ProspectCard({ prospect, place }: { prospect: RankedFarmProspect; place: number }) {
  const content = <><div className="relative h-12 w-12 shrink-0"><div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white shadow-sm ring-1 ring-gray-200 dark:border-gray-900 dark:bg-gray-900 dark:ring-gray-700"><NhlHeadshot playerId={prospect.playerId?.toString()} name={prospect.name} className="h-full w-full scale-110 object-cover object-[center_22%]" fallbackClassName="text-xs font-black text-gray-400" /></div>{prospect.nhlTeam && <img src={`https://assets.nhle.com/logos/nhl/svg/${prospect.nhlTeam}_light.svg`} alt="" className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-white p-0.5 object-contain shadow ring-1 ring-gray-200" />}<span className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gray-950 text-[8px] font-black text-white">{place}</span></div><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><PositionBadge position={prospect.position} /><span className="truncate text-xs font-black text-gray-900 dark:text-white">{prospect.name}</span></div><p className="mt-1 truncate text-[9px] font-semibold text-gray-400">{prospect.draftYear} · #{prospect.overallPick} overall</p></div><div className="shrink-0 text-right"><p className="text-sm font-black text-emerald-600 dark:text-emerald-300">{formatFantasyPoints(prospect.score)}</p><p className="text-[8px] font-black uppercase text-gray-400">FPTS</p></div></>;
  const classes = "flex min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-white/90 p-2.5 transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-sm dark:border-gray-700 dark:bg-gray-900/80";
  return prospect.playerId ? <Link to={`/player-profile?playerId=${prospect.playerId}`} className={classes}>{content}</Link> : <div className={classes}>{content}</div>;
}

function PodiumCard({ row }: { row: FarmRanking }) {
  return <Link to={`/teams/${row.team.id}/farm-systems`} className={`group relative overflow-hidden rounded-2xl border p-5 shadow-lg transition hover:-translate-y-1 ${row.rank === 1 ? "border-amber-300 bg-gradient-to-br from-amber-50 to-white md:-mt-5 md:min-h-52 dark:border-amber-500/50 dark:from-amber-500/15 dark:to-gray-950" : "border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"}`}><div className={`absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br opacity-20 ${podiumTone[row.rank]}`} /><div className="relative flex items-start justify-between gap-3"><div className="flex items-center gap-3">{row.team.logo && <img src={row.team.logo} alt="" className="h-14 w-14 object-contain" />}<div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-400">#{row.rank} Pipeline</p><h2 className="mt-1 font-black text-gray-900 group-hover:text-brand-500 dark:text-white">{row.team.team_name}</h2></div></div><span className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br text-lg font-black shadow ${podiumTone[row.rank]}`}>{row.rank}</span></div><div className="relative mt-5 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-gray-50 p-2 dark:bg-white/[0.05]"><p className="text-[8px] font-black uppercase text-gray-400">Score</p><p className="mt-1 text-xl font-black text-indigo-600 dark:text-indigo-300">{row.farmScore.toFixed(1)}</p></div><div className="rounded-xl bg-gray-50 p-2 dark:bg-white/[0.05]"><p className="text-[8px] font-black uppercase text-gray-400">Top 5</p><p className="mt-1 text-xl font-black text-gray-900 dark:text-white">{formatFantasyPoints(row.production)}</p></div><div className="rounded-xl bg-gray-50 p-2 dark:bg-white/[0.05]"><p className="text-[8px] font-black uppercase text-gray-400">Active</p><p className="mt-1 text-xl font-black text-gray-900 dark:text-white">{row.nhlActive}</p></div></div></Link>;
}

export default function FarmSystemRankings() {
  const [snapshot, setSnapshot] = useState<FarmRankingsSnapshot | undefined>(readFarmRankings);
  const rankings = snapshot?.rankings || [];
  const [loading, setLoading] = useState(!snapshot);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const revision = useNhlDataRevision([`league-season:${CURRENT_LEAGUE_SEASON}`, `live-season:${CURRENT_LEAGUE_SEASON}`]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await fetchFarmRankings();
        if (active) { setSnapshot(result); setError(""); }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load farm rankings.");
      } finally { if (active) setLoading(false); }
    };
    setLoading(!readFarmRankings()); setSlow(false);
    void refresh();
    const slowTimer = window.setTimeout(() => { if (active) setSlow(true); }, 10_000);
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine !== false) void refresh();
    }, 300_000);
    return () => { active = false; window.clearTimeout(slowTimer); window.clearInterval(refreshTimer); };
  }, [attempt, revision]);
  const podium = [rankings[1], rankings[0], rankings[2]].filter((row): row is FarmRanking => Boolean(row));
  return <div><PageMeta title="Farm System Rankings | GLDHL" description="League-wide GLDHL prospect pipeline rankings" /><PageBreadcrumb pageTitle="Farm System Rankings" />
    {snapshot && <p role="status" className="mb-4 text-sm text-gray-500 dark:text-gray-400">{error ? "Ranking updates are temporarily unavailable. Showing saved rankings." : snapshot.warning || "Last complete rankings"} · Updated {new Date(snapshot.updatedAt).toLocaleString()}.</p>}
    {loading && <p role="status" className="mb-4 text-sm text-gray-500 dark:text-gray-400">{slow ? "NHL data is taking longer than usual. Waiting for the first complete ranking." : "Loading farm rankings…"}</p>}
    {error && !rankings.length ? <div className="rounded-2xl border border-error-200 bg-error-50 p-5 text-error-700">{error}<button type="button" onClick={() => setAttempt(value => value + 1)} className="ml-3 font-semibold underline">Try again</button></div> : loading && !rankings.length ? <div className="grid animate-pulse gap-4 md:grid-cols-3"><div className="h-52 rounded-2xl bg-gray-100 dark:bg-gray-800" /><div className="h-52 rounded-2xl bg-gray-100 dark:bg-gray-800" /><div className="h-52 rounded-2xl bg-gray-100 dark:bg-gray-800" /></div> : <><section className="mb-8"><div className="mb-7 text-center"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500">The podium</p><h1 className="mt-1 text-2xl font-black text-gray-900 dark:text-white">Farm System Rankings</h1><p className="mt-2 text-xs text-gray-500">85% top-five production · 10% draft quality · 5% eligible depth</p></div><div className="grid items-end gap-4 md:grid-cols-3">{podium.map((row) => <PodiumCard key={row.team.id} row={row} />)}</div></section>
      <section className="space-y-4">{rankings.map((row) => <article key={row.team.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]"><div className="grid items-center gap-4 p-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.6fr)] lg:p-5"><div className="flex items-center gap-4"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-black ${row.rank <= 3 ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300"}`}>{row.rank}</span>{row.team.logo && <img src={row.team.logo} alt="" className="h-14 w-14 shrink-0 object-contain" />}<div className="min-w-0"><Link to={`/teams/${row.team.id}/farm-systems`} className="block truncate text-lg font-black text-gray-900 hover:text-brand-500 dark:text-white">{row.team.team_name}</Link><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold uppercase text-gray-400"><span><strong className="text-indigo-600 dark:text-indigo-300">{row.farmScore.toFixed(1)}</strong> score</span><span>{formatFantasyPoints(row.production)} top-5</span><span>{row.eligible} eligible</span><span>{row.nhlActive} active</span><span>{row.draftQuality.toFixed(0)} draft quality</span></div></div></div><div><p className="mb-2 text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">Top assets</p><div className="grid gap-2 sm:grid-cols-3">{row.topProspects.map((prospect, index) => <ProspectCard key={`${prospect.name}-${prospect.draftYear}`} prospect={prospect} place={index + 1} />)}</div></div></div></article>)}</section></>}
  </div>;
}
