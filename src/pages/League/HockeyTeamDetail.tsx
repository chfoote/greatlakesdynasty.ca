import { useNhlDataRevision } from "../../lib/useNhlDataRevision";
import { startNhlPolling } from "../../lib/nhlPolling";
import { isNhlRateLimit } from "../../../shared/nhl-policy";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import {
  type FantasyTeam,
  type FantasyTeamManagerTenure,
  type FantasyTeamFinish,
  type FantasyTeamBranding,
  applyTeamBranding,
  fetchFantasyTeamByAbbreviation,
  fetchTeamManagerTenures,
  fetchTeamFinishes,
  fetchTeamBrandingHistory,
  getManagerForSeason,
} from "../../lib/fantasyTeams";
import { fetchPlayerSeasons, fetchPlayerSeasonsByTeam, fetchPlayerSeasonsByTeamAndSeason, type PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import {
  fetchNhlGoalieStats,
  fetchNhlDailyStats,
  getNhlStatsDate,
  fetchNhlLivePlayerIds,
  fetchNhlLiveSeasonStats,
  fetchNhlPlayerLanding,
  fetchNhlSkaterStats,
  formatFantasyPoints,
  formatNhlStat,
  getGoalieScore,
  getSkaterScore,
  type NhlGoalieRecord,
  type NhlSkaterRecord,
} from "../../lib/nhl";
import { fetchAwards, fetchPlayerAwards, mapAwardsByPlayer, type Award, type PlayerAward } from "../../lib/awards";
import PlayerAwardBadges from "./PlayerAwardBadges";
import { CURRENT_LEAGUE_SEASON, playedAndCurrentSeasons } from "../../lib/leagueSeasons";
import TeamIdentityCard from "./TeamIdentityCard";
import { fetchTradeBlockListings } from "../../lib/tradeMarket";
import TradeBlockBadge from "./TradeBlockBadge";
import PlayerInterestButton from "./PlayerInterestButton";
import { usePlayerTradeInterest } from "../../hooks/usePlayerTradeInterest";
import { fetchBuyoutPenalties, type BuyoutPenalty } from "../../lib/buyouts";
import { fetchRetentionAdjustments, type RetentionAdjustment } from "../../lib/retentions";
import { useAuth } from "../../context/AuthContext";
import { fetchUserTeamAssignment } from "../../lib/teamUserAssignments";
import { fetchTeamLeadership, setTeamLeadershipSlot, type LeadershipSlot, type TeamLeadership } from "../../lib/teamLeadership";
import PositionBadge from "../../components/hockey/PositionBadge";
import InjuryDesignationBadge from "../../components/hockey/InjuryDesignationBadge";
import CountryFlagBadge from "../../components/hockey/CountryFlagBadge";

const ROSTER_LIMIT = 23;
const seasonOptions = playedAndCurrentSeasons;
const activeSections = [
  { code: "C", label: "Centers", type: "skater" },
  { code: "LW", label: "Left Wings", type: "skater" },
  { code: "RW", label: "Right Wings", type: "skater" },
  { code: "D", label: "Defence", type: "skater" },
  { code: "G", label: "Goalies", type: "goalie" },
] as const;
const nonRosterSections = [
  { code: "RFA", label: "RFA Rights", cap: false },
  { code: "W", label: "Waivers", cap: true },
  { code: "IR", label: "Injured Reserve", cap: true },
  { code: "LTIR", label: "Long-Term Injured Reserve", cap: false },
  { code: "RETENTION", label: "Retention", cap: true },
] as const;
const activePositions = new Set(activeSections.map((section) => section.code));
const capPositions = new Set([...activePositions, "W", "IR", "RETENTION"]);
const ageRosterPositions = new Set([...activePositions, "W", "IR", "LTIR"]);
const prospectPositions = new Set(["PROSPECT", "AP"]);
const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

function nhlSeasonId(year: number) {
  return (year - 1) * 10000 + year;
}

function salaryCapForSeason(year: number) {
  return year <= 2026 ? 45_000_000 : 50_000_000;
}

function playerName(season: PlayerSeasonWithRelations) {
  return season.player?.full_name || [season.player?.first_name, season.player?.last_name].filter(Boolean).join(" ") || "Unknown Player";
}

function fantasyPlayerName(player: PlayerAward["player"]) {
  return player?.full_name || [player?.first_name, player?.last_name].filter(Boolean).join(" ") || "Unknown Player";
}

function playerApiId(season: PlayerSeasonWithRelations) {
  return season.player?.player_api_id || "";
}

function ageOnDate(birthDate: string, asOf: Date) {
  const [year, month, day] = birthDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  let age = asOf.getFullYear() - year;
  if (asOf.getMonth() + 1 < month || (asOf.getMonth() + 1 === month && asOf.getDate() < day)) age -= 1;
  return age;
}

function position(season: PlayerSeasonWithRelations) {
  return (season.position || "UNASSIGNED").toUpperCase();
}

function nhlSkaterPosition(code: string | undefined) {
  if (code === "L") return "LW";
  if (code === "R") return "RW";
  return code || "—";
}

function LiveBadge() {
  return <span className="ml-2 inline-flex animate-pulse rounded-full bg-error-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-error-700 ring-1 ring-error-200 dark:bg-error-500/10 dark:text-error-300 dark:ring-error-500/30"><span className="mr-1.5 mt-1 h-1.5 w-1.5 rounded-full bg-error-500" />Live</span>;
}

function LeadershipBadge({ role }: { role?: "C" | "A" }) {
  if (!role) return null;
  return <span title={role === "C" ? "Team Captain" : "Alternate Captain"} className={`ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-black ring-1 ${role === "C" ? "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/40" : "bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/40"}`}>{role}</span>;
}

function PlayerName({ season, nhlTeam, awards = [], onTradeBlock = false, interestAction, isLive = false, leadershipRole }: { season: PlayerSeasonWithRelations; nhlTeam?: string; awards?: PlayerAward[]; onTradeBlock?: boolean; interestAction?: React.ReactNode; isLive?: boolean; leadershipRole?: "C" | "A" }) {
  const isExpiring = season.term_end_year === season.season_year;
  const nhlTeamAbbreviation = nhlTeam?.split(",")[0]?.trim();
  return <div className="flex min-w-56 items-center gap-2 text-left">
    {interestAction}
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
      {nhlTeamAbbreviation ? <img src={`https://assets.nhle.com/logos/nhl/svg/${nhlTeamAbbreviation}_light.svg`} alt={`${nhlTeamAbbreviation} NHL club logo`} title={nhlTeamAbbreviation} className="h-full w-full object-contain p-0.5" /> : <span className="text-[10px] font-semibold text-gray-500">NHL</span>}
    </div>
    <div><p className="font-medium text-gray-800 dark:text-white/90">{season.player?.player_api_id ? <Link to={`/player-profile?playerId=${season.player.player_api_id}`} className="text-brand-500 hover:underline">{playerName(season)}</Link> : playerName(season)}<InjuryDesignationBadge position={season.position} /><LeadershipBadge role={leadershipRole} />{isLive && <LiveBadge />}<PlayerAwardBadges awards={awards} includeMonthly={false} />{onTradeBlock && <TradeBlockBadge className="ml-2 align-middle" />}</p>
      <p className={`mt-0.5 text-[11px] ${isExpiring ? "font-semibold text-orange-600 dark:text-orange-400" : "text-gray-500 dark:text-gray-400"}`}>
        {[nhlTeam || "—", money.format(season.salary || 0), season.term_end_year || "No term"].join(" | ")}
        {isExpiring && <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">Expiring</span>}
      </p>
    </div>
  </div>;
}

function MobileRosterCard({ season, nhlTeam, awards, onTradeBlock, interestAction, isLive, leadershipRole, details }: { season: PlayerSeasonWithRelations; nhlTeam?: string; awards: PlayerAward[]; onTradeBlock: boolean; interestAction?: React.ReactNode; isLive: boolean; leadershipRole?: "C" | "A"; details: Array<[string, React.ReactNode]> }) {
  return <article className="p-3">
    <PlayerName season={season} nhlTeam={nhlTeam} awards={awards} onTradeBlock={onTradeBlock} interestAction={interestAction} isLive={isLive} leadershipRole={leadershipRole} />
    <dl className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-gray-50 p-2 dark:bg-white/[0.03]">
      {details.map(([label, value]) => <div key={label} className="min-w-0 text-center"><dt className="truncate text-[9px] font-bold uppercase tracking-wide text-gray-400">{label}</dt><dd className="mt-1 truncate text-xs font-semibold text-gray-700 dark:text-gray-200">{value}</dd></div>)}
    </dl>
  </article>;
}

function PayrollCard({ label, value, danger = false, detail }: { label: string; value: string; danger?: boolean; detail?: string }) {
  return <div className={`rounded-lg border px-3 py-2.5 ${danger ? "border-error-200 bg-error-50 dark:border-error-500/30 dark:bg-error-500/10" : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"}`}>
    <p className="text-[9px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
    <p className={`mt-1 text-sm font-black ${danger ? "text-error-700 dark:text-error-400" : "text-gray-800 dark:text-white/90"}`}>{value}</p>
    {detail && <p className="mt-0.5 truncate text-[8px] font-medium text-gray-400" title={detail}>{detail}</p>}
  </div>;
}

const lineupCardTone: Record<string, string> = {
  LW: "border-green-300 ring-green-100 shadow-[0_7px_20px_rgba(34,197,94,0.22)] dark:border-green-500/60 dark:ring-green-500/20",
  C: "border-red-300 ring-red-100 shadow-[0_7px_20px_rgba(239,68,68,0.22)] dark:border-red-500/60 dark:ring-red-500/20",
  RW: "border-blue-300 ring-blue-100 shadow-[0_7px_20px_rgba(59,130,246,0.22)] dark:border-blue-500/60 dark:ring-blue-500/20",
  D: "border-teal-300 ring-teal-100 shadow-[0_7px_20px_rgba(20,184,166,0.22)] dark:border-teal-500/60 dark:ring-teal-500/20",
  G: "border-purple-300 ring-purple-100 shadow-[0_7px_20px_rgba(168,85,247,0.22)] dark:border-purple-500/60 dark:ring-purple-500/20",
};

function LineupPlayerCard({ season, score, ppg, headshot, nhlTeam, birthCountry, role, isLive, contractYear, contractLength }: { season?: PlayerSeasonWithRelations; score?: number; ppg?: number; headshot?: string; nhlTeam?: string; birthCountry?: string; role?: "C" | "A"; isLive?: boolean; contractYear?: number; contractLength?: number }) {
  if (!season) return <div className="h-[92px] rounded-2xl border border-dashed border-sky-200/80 bg-white/35 dark:border-sky-900/70 dark:bg-gray-950/30" />;
  const apiId = playerApiId(season);
  const nhlAbbreviation = nhlTeam?.split(",")[0]?.trim();
  const cardTone = lineupCardTone[position(season)] || "border-gray-300 ring-gray-100 shadow-[0_7px_20px_rgba(100,116,139,0.2)] dark:border-gray-600 dark:ring-gray-700";
  return <Link to={apiId ? `/player-profile?playerId=${apiId}` : "#"} className={`group relative flex h-[92px] min-w-0 overflow-hidden rounded-2xl border-2 bg-white/95 ring-2 transition hover:z-20 hover:-translate-y-1 hover:shadow-[0_13px_30px_rgba(15,23,42,0.24)] dark:bg-gray-900/95 ${cardTone}`}>
    {nhlAbbreviation && <img src={`https://assets.nhle.com/logos/nhl/svg/${nhlAbbreviation}_light.svg`} alt="" aria-hidden="true" className="pointer-events-none absolute -right-[72px] top-[62%] h-[216px] w-[216px] -translate-y-1/2 object-contain opacity-10 grayscale transition group-hover:opacity-[0.15] dark:opacity-[0.12]" />}
    <div className="relative z-10 flex w-[72px] shrink-0 items-center justify-center bg-white dark:bg-gray-900">
      <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white shadow-sm ring-1 ring-gray-200 dark:border-gray-900 dark:bg-gray-900 dark:ring-gray-700">
        {headshot ? <img src={headshot} alt="" className="h-full w-full scale-[1.12] object-cover object-[center_22%] transition duration-200 group-hover:scale-[1.18]" /> : <span className="text-lg font-black text-gray-400 dark:text-gray-500">{playerName(season).split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>}
      </div>
    </div>
    <div className="relative z-10 min-w-0 flex-1 px-2.5 py-2">
      <div className="flex items-start justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1"><PositionBadge position={position(season)} /><CountryFlagBadge countryCode={birthCountry} />{role && <LeadershipBadge role={role} />}{isLive && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-error-500" title="Live now" />}</div>
        <span className="shrink-0 rounded-md bg-slate-900 px-1.5 py-1 text-[8px] font-black tabular-nums text-white dark:bg-brand-500">{formatFantasyPoints(score || 0)} <span className="text-white/65">({(ppg || 0).toFixed(2)})</span></span>
      </div>
      <p className="mt-1.5 truncate text-[13px] font-black leading-tight text-gray-900 group-hover:text-brand-600 dark:text-white dark:group-hover:text-brand-300">{playerName(season)}</p>
      <p className="mt-1 truncate text-[9px] font-bold uppercase tracking-wide text-gray-400">{nhlAbbreviation || "NHL"} · {money.format(season.salary || 0)} · {season.term_end_year || "—"}</p>
      {contractLength && contractYear ? <div className="mt-1" title={`Year ${contractYear} of ${contractLength}`}><div className="flex max-w-28 gap-0.5">{Array.from({ length: contractLength }, (_, index) => <span key={index} className={`h-1 flex-1 rounded-full ${index < contractYear ? "bg-emerald-500" : "bg-gray-200 dark:bg-gray-700"}`} />)}</div><p className="mt-0.5 text-[8px] font-black uppercase tracking-wide text-gray-400">Year {contractYear} of {contractLength}</p></div> : null}
    </div>
  </Link>;
}

function IceRinkMarkings() {
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-t-3xl rounded-b-[12rem]">
    <div className="absolute bottom-[13%] left-0 right-0 h-1 bg-red-500/30" />
    <div className="absolute bottom-[3%] left-1/2 h-16 w-28 -translate-x-1/2 rounded-t-[50%] border-4 border-b-0 border-red-500/25" />
    <div className="absolute bottom-[13%] left-1/2 h-16 w-32 -translate-x-1/2 rounded-t-full border-4 border-b-0 border-sky-500/20 bg-sky-200/10" />
    <div className="absolute bottom-[24%] left-[22%] h-28 w-28 -translate-x-1/2 rounded-full border-[3px] border-red-500/20"><span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500/30" /></div>
    <div className="absolute bottom-[24%] right-[22%] h-28 w-28 translate-x-1/2 rounded-full border-[3px] border-red-500/20"><span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500/30" /></div>
    <div className="absolute left-0 right-0 top-[9%] h-1.5 bg-blue-500/30" />
    <div className="absolute left-1/2 top-[4%] h-3 w-3 -translate-x-1/2 rounded-full bg-red-500/25" />
  </div>;
}

function LineupPreview({ roster, contractHistory, seasonYear, skaters, goalies, headshots, nhlTeams, birthCountries, leadershipByPlayer, livePlayerIds, team }: { roster: PlayerSeasonWithRelations[]; contractHistory: PlayerSeasonWithRelations[]; seasonYear: number; skaters: Map<string, NhlSkaterRecord>; goalies: Map<string, NhlGoalieRecord>; headshots: Map<string, string>; nhlTeams: Map<string, string>; birthCountries: Map<string, string>; leadershipByPlayer: Map<number, "C" | "A">; livePlayerIds: Set<string>; team: FantasyTeam }) {
  const sorted = (code: string) => roster.filter((season) => position(season) === code).map((season) => {
    const skater = skaters.get(playerApiId(season));
    const goalie = goalies.get(playerApiId(season));
    const score = skater ? getSkaterScore(skater) : goalie ? getGoalieScore(goalie) : 0;
    const gamesPlayed = skater?.gamesPlayed || goalie?.gamesPlayed || 0;
    return { season, score, ppg: gamesPlayed ? score / gamesPlayed : 0, nhlTeam: skater?.teamAbbrevs || goalie?.teamAbbrevs || nhlTeams.get(playerApiId(season)) };
  }).sort((a, b) => b.score - a.score || playerName(a.season).localeCompare(playerName(b.season)));
  const groups = { LW: sorted("LW"), C: sorted("C"), RW: sorted("RW"), D: sorted("D"), G: sorted("G") };
  const contractProgress = (season: PlayerSeasonWithRelations) => {
    if (!season.term_end_year) return {};
    const matching = contractHistory.filter((row) => row.player_id === season.player_id && row.salary === season.salary && row.term_end_year === season.term_end_year);
    const start = matching.length ? Math.min(...matching.map((row) => row.season_year)) : seasonYear;
    return { contractYear: Math.max(seasonYear - start + 1, 1), contractLength: Math.max(season.term_end_year - start + 1, 1) };
  };
  const card = (entry?: (typeof groups.C)[number]) => <LineupPlayerCard season={entry?.season} score={entry?.score} ppg={entry?.ppg} nhlTeam={entry?.nhlTeam} headshot={entry ? headshots.get(playerApiId(entry.season)) : undefined} birthCountry={entry ? birthCountries.get(playerApiId(entry.season)) : undefined} role={entry ? leadershipByPlayer.get(entry.season.id) : undefined} isLive={entry ? livePlayerIds.has(playerApiId(entry.season)) : false} {...(entry ? contractProgress(entry.season) : {})} />;
  const pressBox = [...groups.C.slice(3), ...groups.LW.slice(3), ...groups.RW.slice(3), ...groups.D.slice(6), ...groups.G.slice(2)];
  return <div className="mt-5 overflow-hidden rounded-3xl border border-gray-200 bg-slate-50/80 shadow-theme-sm dark:border-gray-800 dark:bg-gray-950/40">
    <div className="relative overflow-hidden border-b border-gray-200 px-5 py-5 dark:border-gray-800">
      <div className="absolute inset-0 opacity-[0.07]" style={{ background: `linear-gradient(120deg, ${team.primary_color || "#2563eb"}, transparent 65%, ${team.secondary_color || "#f97316"})` }} />
      <div className="relative flex items-center gap-3">{team.logo && <img src={team.logo} alt="" className="h-12 w-12 object-contain" />}<div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-500">Automatic scoring order</p><h3 className="text-xl font-black text-gray-900 dark:text-white">{team.team_name} Lineup Preview</h3><p className="mt-1 text-xs text-gray-500">Every player is active · ordered by season fantasy points</p></div></div>
    </div>
    <div className="space-y-5 p-3 sm:p-5">
      <section className="relative mx-auto max-w-5xl overflow-x-auto rounded-t-[2.75rem] rounded-b-[6rem] border-4 border-sky-200 bg-gradient-to-b from-sky-50 via-white to-sky-100 p-2 shadow-inner dark:border-sky-900/70 dark:from-slate-950 dark:via-slate-900 dark:to-sky-950/50 sm:p-3">
        <div className="relative min-w-[820px] overflow-hidden rounded-t-3xl rounded-b-[10rem] border border-sky-200/80 px-3 pb-9 pt-7 dark:border-sky-900/70 sm:px-4">
          <IceRinkMarkings />
          <div className="relative z-10 mx-auto max-w-4xl space-y-5">
            <div className="space-y-2.5 rounded-3xl border border-white/80 bg-white/30 p-3 backdrop-blur-[2px] dark:border-white/10 dark:bg-slate-950/30">
              {Array.from({ length: 3 }, (_, index) => <div key={index} className="grid grid-cols-3 gap-2.5"><div><p className="mb-1 text-center text-[8px] font-black text-slate-400">LW{index + 1}</p>{card(groups.LW[index])}</div><div><p className="mb-1 text-center text-[8px] font-black text-slate-400">C{index + 1}</p>{card(groups.C[index])}</div><div><p className="mb-1 text-center text-[8px] font-black text-slate-400">RW{index + 1}</p>{card(groups.RW[index])}</div></div>)}
            </div>
            <div className="space-y-2.5 rounded-3xl border border-white/80 bg-white/30 p-3 backdrop-blur-[2px] dark:border-white/10 dark:bg-slate-950/30">
              <div className="grid grid-cols-3 gap-2.5">
                <div><p className="mb-1 text-center text-[8px] font-black text-slate-400">D1</p>{card(groups.D[0])}</div>
                <div><p className="mb-1 text-center text-[8px] font-black text-slate-400">Team</p><div className="flex h-[92px] items-center justify-center">{team.logo ? <img src={team.logo} alt={`${team.team_name} logo`} className="h-20 w-20 object-contain drop-shadow-[0_8px_12px_rgba(15,23,42,0.18)]" /> : <span className="text-center text-xs font-black uppercase tracking-wider text-slate-400">{team.team_name}</span>}</div></div>
                <div><p className="mb-1 text-center text-[8px] font-black text-slate-400">D2</p>{card(groups.D[1])}</div>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <div><p className="mb-1 text-center text-[8px] font-black text-slate-400">D3</p>{card(groups.D[2])}</div>
                <div><p className="mb-1 text-center text-[8px] font-black text-slate-400">G1</p>{card(groups.G[0])}</div>
                <div><p className="mb-1 text-center text-[8px] font-black text-slate-400">D4</p>{card(groups.D[3])}</div>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <div><p className="mb-1 text-center text-[8px] font-black text-slate-400">D5</p>{card(groups.D[4])}</div>
                <div><p className="mb-1 text-center text-[8px] font-black text-slate-400">G2</p>{card(groups.G[1])}</div>
                <div><p className="mb-1 text-center text-[8px] font-black text-slate-400">D6</p>{card(groups.D[5])}</div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {pressBox.length > 0 && <section className="mx-auto w-full max-w-5xl rounded-2xl border border-dashed border-gray-300 bg-white p-3 shadow-theme-xs dark:border-gray-700 dark:bg-white/[0.025]"><div className="mx-auto max-w-4xl"><div className="mb-4 flex items-end justify-between gap-3"><div><div className="flex items-center gap-3"><span className="h-6 w-1 rounded-full bg-gray-400" /><h4 className="text-sm font-black uppercase tracking-[0.18em] text-gray-700 dark:text-gray-200">Press Box</h4></div><p className="ml-4 mt-1 text-xs text-gray-500">Sorted C · LW · RW · D · G, then by FPTS</p></div><span className="rounded-full bg-gray-200 px-2.5 py-1 text-[10px] font-black text-gray-600 dark:bg-gray-800 dark:text-gray-300">{pressBox.length} players</span></div><div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">{pressBox.map((entry) => <div key={entry.season.id}>{card(entry)}</div>)}</div></div></section>}
    </div>
  </div>;
}

function Medal({ icon, value, label, years, tone }: { icon: string; value: number; label: string; years: number[]; tone: "gold" | "silver" | "bronze" }) {
  const styles = {
    gold: "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-300",
    silver: "border-gray-300 bg-gray-100 text-gray-800 dark:border-gray-600 dark:bg-gray-500/10 dark:text-gray-200",
    bronze: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
  };
  return <div className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-center ${styles[tone]}`}>
    <span className="text-lg" aria-label={label}>{icon}</span>
    <p className="text-base font-black">{value}</p>
    <p className="truncate text-[10px] font-medium opacity-80">{years.length ? years.join(", ") : "—"}</p>
  </div>;
}

const featuredAwardOrder = ["Championship", "MVP", "Rookie of the Year", "Top C", "Top LW", "Top RW", "Top D"];
const honourMonths = ["October", "November", "December", "January", "February", "March", "April"];

function normalizedAwardName(name: string) {
  return name.trim().toLowerCase();
}

function TrophyImage({ award, name }: { award?: Award | null; name: string }) {
  return award?.image_url ? (
    <img src={award.image_url} alt={`${name} trophy`} className="h-20 w-20 object-contain drop-shadow-sm" />
  ) : (
    <span className="text-6xl" role="img" aria-label={`${name} trophy`}>🏆</span>
  );
}

function TrophyCase({
  team,
  finishes,
  playerAwards,
  teamSeasons,
  awards,
}: {
  team: FantasyTeam;
  finishes: FantasyTeamFinish[];
  playerAwards: PlayerAward[];
  teamSeasons: PlayerSeasonWithRelations[];
  awards: Award[];
}) {
  const [view, setView] = useState<"seasonal" | "monthly">("seasonal");
  const championshipAward = awards.find((award) => normalizedAwardName(award.name) === "championship");
  const playerSeasonKeys = new Set(teamSeasons.map((season) => `${season.player_id}:${season.season_year}`));
  const seasonalPlayerTrophies = playerAwards
    .filter((assignment) => !assignment.is_monthly)
    .filter((assignment) => assignment.award && normalizedAwardName(assignment.award.name) !== "championship")
    .filter((assignment) => playerSeasonKeys.has(`${assignment.player_id}:${assignment.season_year}`));
  const monthlyPlayerTrophies = playerAwards
    .filter((assignment) => assignment.is_monthly && assignment.fantasy_team_id === team.id);
  const seasonalTrophies = [
    ...finishes
      .filter((finish) => finish.placement === 1)
      .map((finish) => ({
        key: `championship-${finish.id}`,
        name: "Championship",
        year: finish.season_year,
        award: championshipAward,
        player: null as PlayerAward["player"],
        monthIndex: undefined as number | undefined,
      })),
    ...seasonalPlayerTrophies.map((assignment) => ({
      key: `player-award-${assignment.id}`,
      name: assignment.award?.name || "Award",
      year: assignment.season_year,
      award: assignment.award,
      player: assignment.player,
      monthIndex: undefined as number | undefined,
    })),
  ].sort((a, b) => {
    const order = (name: string) => {
      const index = featuredAwardOrder.findIndex((featuredName) => normalizedAwardName(featuredName) === normalizedAwardName(name));
      return index === -1 ? featuredAwardOrder.length : index;
    };
    return order(a.name) - order(b.name) || b.year - a.year;
  });
  const monthlyTrophies = monthlyPlayerTrophies.map((assignment) => ({ key: `monthly-honour-${assignment.id}`, name: assignment.award?.name || "Monthly Honour", year: assignment.season_year, award: assignment.award, player: assignment.player, monthIndex: assignment.month_index })).sort((a, b) => b.year - a.year || (b.monthIndex ?? -1) - (a.monthIndex ?? -1));
  const trophies = view === "seasonal" ? seasonalTrophies : monthlyTrophies;

  return <section id="trophy-case" className="mt-6 scroll-mt-24 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 dark:border-amber-500/30 dark:from-amber-500/10 dark:to-transparent sm:p-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300">Club honours</p>
      <h3 className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">Trophy Case</h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Championships and individual awards won while representing the {team.team_name}.</p>
      </div>
      <div className="inline-flex shrink-0 rounded-lg border border-amber-300/70 bg-white/70 p-1 dark:border-amber-500/30 dark:bg-gray-900/60"><button type="button" onClick={() => setView("seasonal")} className={`rounded-md px-3 py-1.5 text-xs font-bold ${view === "seasonal" ? "bg-amber-500 text-white" : "text-gray-500"}`}>Seasonal Awards</button><button type="button" onClick={() => setView("monthly")} className={`rounded-md px-3 py-1.5 text-xs font-bold ${view === "monthly" ? "bg-amber-500 text-white" : "text-gray-500"}`}>Monthly Honours</button></div>
    </div>
    {trophies.length ? <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {trophies.map((trophy) => {
        const apiId = trophy.player?.player_api_id;
        const winnerName = trophy.player ? fantasyPlayerName(trophy.player) : team.team_name;
        return <article key={trophy.key} className="flex min-h-36 items-center gap-4 rounded-xl border border-amber-200 bg-white/90 p-4 shadow-sm dark:border-amber-500/20 dark:bg-gray-900/80">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-500/10"><TrophyImage award={trophy.award} name={trophy.name} /></div>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">{trophy.monthIndex !== undefined ? `${honourMonths[trophy.monthIndex]} · ` : ""}{trophy.year}</p>
            <h4 className="mt-1 text-base font-bold text-gray-900 dark:text-white">{trophy.name}</h4>
            {apiId ? <Link to={`/player-profile?playerId=${apiId}`} className="mt-1 block truncate text-sm font-medium text-brand-500 hover:underline">{winnerName}</Link> : <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{winnerName}</p>}
          </div>
        </article>;
      })}
    </div> : <p className="mt-5 rounded-lg border border-dashed border-amber-300 p-5 text-center text-sm text-gray-500 dark:border-amber-500/30 dark:text-gray-400">{view === "monthly" ? "No monthly honours have been recorded for this team yet." : "No seasonal trophies have been recorded for this team yet."}</p>}
  </section>;
}

function SkaterTable({ code, label, players, stats, nhlTeams, awardsByPlayer, tradeBlockIds, livePlayerIds, leadershipByPlayer, renderInterest }: { code: string; label: string; players: PlayerSeasonWithRelations[]; stats: Map<string, NhlSkaterRecord>; nhlTeams: Map<string, string>; awardsByPlayer: Map<number, PlayerAward[]>; tradeBlockIds: Set<number>; livePlayerIds: Set<string>; leadershipByPlayer: Map<number, "C" | "A">; renderInterest: (season: PlayerSeasonWithRelations) => React.ReactNode }) {
  const rows = [...players].sort((a, b) => getSkaterScore(stats.get(playerApiId(b)) || emptySkater) - getSkaterScore(stats.get(playerApiId(a)) || emptySkater));
  return <RosterSection code={code} label={label} count={players.length}>
    <div className="divide-y divide-gray-100 dark:divide-gray-800 md:hidden">{rows.length ? rows.map((season) => { const record = stats.get(playerApiId(season)); const score = record ? getSkaterScore(record) : 0; const nhlTeam = record?.teamAbbrevs || nhlTeams.get(playerApiId(season)); return <MobileRosterCard key={season.id} season={season} nhlTeam={nhlTeam} awards={season.player?.id ? awardsByPlayer.get(season.player.id) || [] : []} onTradeBlock={tradeBlockIds.has(season.id)} interestAction={renderInterest(season)} isLive={livePlayerIds.has(playerApiId(season))} leadershipRole={leadershipByPlayer.get(season.id)} details={[["GP", record?.gamesPlayed ?? "—"], ["G", record?.goals ?? "—"], ["A", record?.assists ?? "—"], ["Score", record ? formatFantasyPoints(score) : "—"], ["FPPG", record?.gamesPlayed ? formatFantasyPoints(score / record.gamesPlayed) : "—"]]} />; }) : <p className="p-4 text-center text-sm text-gray-500">No players.</p>}</div>
    <table className="hidden min-w-full divide-y divide-gray-100 text-xs dark:divide-gray-800 md:table">
      <thead><tr className="text-center font-semibold uppercase text-gray-500 dark:text-gray-400">
        {['Player','Pos','GP','G','A','+/-','PIMs','PPG','PPA','SHG','SHA','GWG','S','B','H','FOW','Score','PPG'].map((heading, index) => <th key={`${heading}-${index}`} className={`whitespace-nowrap px-2 py-2 ${index === 0 ? "text-left" : ""}`}>{heading}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {rows.length === 0 ? <EmptyRow columns={18} /> : rows.map((season) => {
          const record = stats.get(playerApiId(season));
          const score = record ? getSkaterScore(record) : 0;
          const values = record ? [record.gamesPlayed, record.goals, record.assists, record.plusMinus, record.penaltyMinutes, record.ppGoals, record.ppPoints-record.ppGoals, record.shGoals, record.shPoints-record.shGoals, record.gameWinningGoals, record.shots, record.blockedShots, record.hits, record.totalFaceoffWins] : Array(14).fill(null);
          return <tr key={season.id} className="text-center text-gray-600 dark:text-gray-300">
            <td className="px-2 py-2"><PlayerName season={season} nhlTeam={record?.teamAbbrevs || nhlTeams.get(playerApiId(season))} awards={season.player?.id ? awardsByPlayer.get(season.player.id) || [] : []} onTradeBlock={tradeBlockIds.has(season.id)} interestAction={renderInterest(season)} isLive={livePlayerIds.has(playerApiId(season))} leadershipRole={leadershipByPlayer.get(season.id)} /></td>
            <td className="px-2 py-2"><PositionBadge position={record ? nhlSkaterPosition(record.positionCode) : code} /></td>
            {values.map((value, index) => <td key={index} className="px-2 py-2">{formatNhlStat(value)}</td>)}
            <td className="px-2 py-2 font-semibold text-gray-800 dark:text-white/90">{formatFantasyPoints(score)}</td>
            <td className="px-2 py-2">{record?.gamesPlayed ? formatFantasyPoints(score / record.gamesPlayed) : "—"}</td>
          </tr>;
        })}
      </tbody>
    </table>
  </RosterSection>;
}

function GoalieTable({ players, stats, nhlTeams, awardsByPlayer, tradeBlockIds, livePlayerIds, leadershipByPlayer, renderInterest }: { players: PlayerSeasonWithRelations[]; stats: Map<string, NhlGoalieRecord>; nhlTeams: Map<string, string>; awardsByPlayer: Map<number, PlayerAward[]>; tradeBlockIds: Set<number>; livePlayerIds: Set<string>; leadershipByPlayer: Map<number, "C" | "A">; renderInterest: (season: PlayerSeasonWithRelations) => React.ReactNode }) {
  const rows = [...players].sort((a, b) => getGoalieScore(stats.get(playerApiId(b)) || emptyGoalie) - getGoalieScore(stats.get(playerApiId(a)) || emptyGoalie));
  return <RosterSection code="G" label="Goalies" count={players.length}>
    <div className="divide-y divide-gray-100 dark:divide-gray-800 md:hidden">{rows.length ? rows.map((season) => { const record = stats.get(playerApiId(season)); const score = record ? getGoalieScore(record) : 0; return <MobileRosterCard key={season.id} season={season} nhlTeam={record?.teamAbbrevs || nhlTeams.get(playerApiId(season))} awards={season.player?.id ? awardsByPlayer.get(season.player.id) || [] : []} onTradeBlock={tradeBlockIds.has(season.id)} interestAction={renderInterest(season)} isLive={livePlayerIds.has(playerApiId(season))} leadershipRole={leadershipByPlayer.get(season.id)} details={[["GP", record?.gamesPlayed ?? "—"], ["W", record?.wins ?? "—"], ["G", record?.goals ?? "—"], ["A", record?.assists ?? "—"], ["SV%", record?.savePct?.toFixed(3) ?? "—"], ["Score", record ? formatFantasyPoints(score) : "—"], ["FPPG", record?.gamesPlayed ? formatFantasyPoints(score / record.gamesPlayed) : "—"]]} />; }) : <p className="p-4 text-center text-sm text-gray-500">No players.</p>}</div>
    <table className="hidden min-w-full divide-y divide-gray-100 text-xs dark:divide-gray-800 md:table">
      <thead><tr className="text-center font-semibold uppercase text-gray-500 dark:text-gray-400">
        {['Player','Pos','GP','GS','W','L','OTL','GA','SV','SO','PIMs','G','A','SV%','GAA','Score','PPG'].map((heading, index) => <th key={heading} className={`whitespace-nowrap px-2 py-2 ${index === 0 ? "text-left" : ""}`}>{heading}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {rows.length === 0 ? <EmptyRow columns={17} /> : rows.map((season) => {
          const record = stats.get(playerApiId(season));
          const score = record ? getGoalieScore(record) : 0;
          const values = record ? [record.gamesPlayed,record.gamesStarted,record.wins,record.losses,record.otLosses,record.goalsAgainst,record.saves,record.shutouts,record.penaltyMinutes,record.goals,record.assists] : Array(11).fill(null);
          return <tr key={season.id} className="text-center text-gray-600 dark:text-gray-300">
            <td className="px-2 py-2"><PlayerName season={season} nhlTeam={record?.teamAbbrevs || nhlTeams.get(playerApiId(season))} awards={season.player?.id ? awardsByPlayer.get(season.player.id) || [] : []} onTradeBlock={tradeBlockIds.has(season.id)} interestAction={renderInterest(season)} isLive={livePlayerIds.has(playerApiId(season))} leadershipRole={leadershipByPlayer.get(season.id)} /></td>
            <td className="px-2 py-2"><PositionBadge position="G" /></td>
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

function CompactTable({ code, label, players, skaters, goalies, nhlTeams, note, awardsByPlayer, tradeBlockIds, livePlayerIds, renderInterest }: { code: string; label: string; players: PlayerSeasonWithRelations[]; skaters: Map<string, NhlSkaterRecord>; goalies: Map<string, NhlGoalieRecord>; nhlTeams: Map<string, string>; note: string; awardsByPlayer: Map<number, PlayerAward[]>; tradeBlockIds: Set<number>; livePlayerIds: Set<string>; renderInterest: (season: PlayerSeasonWithRelations) => React.ReactNode }) {
  return <RosterSection code={code} label={label} count={players.length} note={note}>
    <div className="divide-y divide-gray-100 dark:divide-gray-800 md:hidden">{players.length ? players.map((season) => { const skater = skaters.get(playerApiId(season)); const goalie = goalies.get(playerApiId(season)); const nhlTeam = skater?.teamAbbrevs || goalie?.teamAbbrevs || nhlTeams.get(playerApiId(season)); return <MobileRosterCard key={season.id} season={season} nhlTeam={nhlTeam} awards={season.player?.id ? awardsByPlayer.get(season.player.id) || [] : []} onTradeBlock={tradeBlockIds.has(season.id)} interestAction={renderInterest(season)} isLive={livePlayerIds.has(playerApiId(season))} details={[["NHL", nhlTeam || "—"], ["Pos", <PositionBadge position={goalie ? "G" : skater ? nhlSkaterPosition(skater.positionCode) : position(season)} />], ["Salary", season.salary == null ? "—" : money.format(season.salary)], ["Term", season.term_end_year || "—"]]} />; }) : <p className="p-4 text-center text-sm text-gray-500">No players.</p>}</div>
    <table className="hidden min-w-full divide-y divide-gray-100 text-xs dark:divide-gray-800 md:table">
      <thead><tr className="text-left font-semibold uppercase text-gray-500 dark:text-gray-400">
        {['Name','Team','Pos','Salary','Term'].map((heading) => <th key={heading} className="px-2 py-2">{heading}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {players.length === 0 ? <EmptyRow columns={5} /> : players.map((season) => {
          const skater = skaters.get(playerApiId(season));
          const goalie = goalies.get(playerApiId(season));
          const apiPosition = goalie ? "G" : skater ? nhlSkaterPosition(skater.positionCode) : position(season);
          const nhlTeam = skater?.teamAbbrevs || goalie?.teamAbbrevs || nhlTeams.get(playerApiId(season));
          return <tr key={season.id} className="text-gray-600 dark:text-gray-300">
            <td className="px-2 py-2"><PlayerName season={season} nhlTeam={nhlTeam} awards={season.player?.id ? awardsByPlayer.get(season.player.id) || [] : []} onTradeBlock={tradeBlockIds.has(season.id)} interestAction={renderInterest(season)} isLive={livePlayerIds.has(playerApiId(season))} /></td>
            <td className="px-2 py-2">{nhlTeam || "—"}</td>
            <td className="px-2 py-2"><PositionBadge position={apiPosition} /></td>
            <td className="px-2 py-2">{season.salary == null ? "—" : money.format(season.salary)}</td>
            <td className={`px-2 py-2 ${season.term_end_year === season.season_year ? "font-semibold text-orange-600 dark:text-orange-400" : ""}`}>
              {season.term_end_year || "—"}
              {season.term_end_year === season.season_year && <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">Expiring</span>}
            </td>
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

function MultiYearView({
  years,
  rosters,
  skaters,
  goalies,
  awardsByPlayer,
  leadershipByPlayer,
  nhlTeams,
}: {
  years: number[];
  rosters: Record<number, PlayerSeasonWithRelations[]>;
  skaters: Map<string, NhlSkaterRecord>;
  goalies: Map<string, NhlGoalieRecord>;
  awardsByPlayer: Map<number, PlayerAward[]>;
  leadershipByPlayer: Map<number, "C" | "A">;
  nhlTeams: Map<string, string>;
}) {
  const summaries = years.map((year) => {
    const rows = rosters[year] || [];
    const salary = rows.filter((row) => capPositions.has(position(row) as never)).reduce((total, row) => total + (row.salary || 0), 0);
    const rosterSize = rows.filter((row) => activePositions.has(position(row) as never)).length;
    const cap = salaryCapForSeason(year);
    return { year, salary, rosterSize, cap, space: cap - salary };
  });

  const players = useMemo(() => {
    const grouped = new Map<string, { representative: PlayerSeasonWithRelations; seasons: Map<number, PlayerSeasonWithRelations> }>();
    years.forEach((year) => (rosters[year] || []).forEach((row) => {
      const key = String(row.player?.id || row.player_id || row.player?.player_api_id || row.id);
      const existing = grouped.get(key);
      if (existing) existing.seasons.set(year, row);
      else grouped.set(key, { representative: row, seasons: new Map([[year, row]]) });
    }));
    return [...grouped.values()];
  }, [rosters, years]);

  const scoreForPlayer = ({ representative }: (typeof players)[number]) => {
    const apiId = playerApiId(representative);
    const goalie = goalies.get(apiId);
    const skater = skaters.get(apiId);
    return position(representative) === "G" || (goalie && !skater) ? (goalie ? getGoalieScore(goalie) : 0) : (skater ? getSkaterScore(skater) : 0);
  };

  const renderPlayerTable = (code: string, label: string) => {
    const sectionPlayers = players
      .filter(({ representative }) => position(representative) === code)
      .sort((a, b) => scoreForPlayer(b) - scoreForPlayer(a));
    return <RosterSection key={code} code={code} label={label} count={sectionPlayers.length}>
      <table className="min-w-full divide-y divide-gray-100 text-xs dark:divide-gray-800">
        <thead><tr className="text-center font-semibold uppercase text-gray-500 dark:text-gray-400">
          <th className="px-3 py-3 text-left">Player</th><th className="whitespace-nowrap px-3 py-3">NHL Team</th><th className="px-3 py-3">Pos</th>
          {years.map((year) => <th key={year} className="px-3 py-3">{year}</th>)}
          <th className="px-3 py-3">Score</th><th className="px-3 py-3">PPG</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{sectionPlayers.length === 0 ? <EmptyRow columns={years.length + 5} /> : sectionPlayers.map(({ representative, seasons }) => {
          const apiId = playerApiId(representative);
          const goalie = goalies.get(apiId);
          const skater = skaters.get(apiId);
          const isGoalie = code === "G" || Boolean(goalie && !skater);
          const score = isGoalie ? (goalie ? getGoalieScore(goalie) : 0) : (skater ? getSkaterScore(skater) : 0);
          const gamesPlayed = isGoalie ? goalie?.gamesPlayed : skater?.gamesPlayed;
          const apiPosition = isGoalie ? "G" : skater ? nhlSkaterPosition(skater.positionCode) : code;
          return <tr key={representative.player?.id || representative.id} className="text-center text-gray-600 dark:text-gray-300">
            <td className="px-3 py-3 text-left"><span className="font-medium text-gray-800 dark:text-white/90">{representative.player?.player_api_id ? <Link to={`/player-profile?playerId=${representative.player.player_api_id}`} className="text-brand-500 hover:underline">{playerName(representative)}</Link> : playerName(representative)}</span><PlayerAwardBadges awards={representative.player?.id ? awardsByPlayer.get(representative.player.id) || [] : []} includeMonthly={false} /></td>
            <td className="px-3 py-3">{skater?.teamAbbrevs || goalie?.teamAbbrevs || nhlTeams.get(apiId) || "—"}</td>
            <td className="px-3 py-3"><PositionBadge position={apiPosition} /></td>
            {years.map((year) => {
              const row = seasons.get(year);
              return <td key={year} className="whitespace-nowrap px-3 py-3 font-medium text-gray-800 dark:text-white/90">{row?.salary == null ? "—" : money.format(row.salary)}{row && <LeadershipBadge role={leadershipByPlayer.get(row.id)} />}</td>;
            })}
            <td className="px-3 py-3 font-semibold text-gray-800 dark:text-white/90">{skater || goalie ? formatFantasyPoints(score) : "—"}</td>
            <td className="px-3 py-3">{gamesPlayed ? formatFantasyPoints(score / gamesPlayed) : "—"}</td>
          </tr>;
        })}</tbody>
      </table>
    </RosterSection>;
  };

  return <div className="mt-5 space-y-5">
    {activeSections.map((section) => renderPlayerTable(section.code, section.label))}

    <div className="pt-2"><h3 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Year-by-Year Payroll</h3><div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-gray-800">
        <thead className="bg-gray-50 dark:bg-white/[0.03]"><tr className="text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400"><th className="px-3 py-3">Season</th><th className="px-3 py-3">Salary Cap</th><th className="px-3 py-3">Salary Spent</th><th className="px-3 py-3">Cap Space</th><th className="px-3 py-3">Roster Size</th></tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{summaries.map((summary) => <tr key={summary.year} className="text-gray-600 dark:text-gray-300"><td className="px-3 py-3 font-semibold text-gray-800 dark:text-white/90">{summary.year}</td><td className="px-3 py-3">{money.format(summary.cap)}</td><td className="px-3 py-3">{money.format(summary.salary)}</td><td className={`px-3 py-3 font-medium ${summary.space < 0 ? "text-error-600 dark:text-error-400" : "text-success-600 dark:text-success-400"}`}>{summary.space < 0 ? `${money.format(Math.abs(summary.space))} over` : money.format(summary.space)}</td><td className={`px-3 py-3 ${summary.rosterSize > ROSTER_LIMIT ? "font-semibold text-error-600 dark:text-error-400" : ""}`}>{summary.rosterSize} / {ROSTER_LIMIT}</td></tr>)}</tbody>
      </table>
    </div></div>
  </div>;
}

const emptySkater: NhlSkaterRecord = { playerId: 0, skaterFullName: "", positionCode: "", teamAbbrevs: "", gamesPlayed: 0, goals: 0, assists: 0, plusMinus: 0, penaltyMinutes: 0, ppGoals: 0, ppPoints: 0, shGoals: 0, shPoints: 0, gameWinningGoals: 0, shots: 0, blockedShots: 0, hits: 0, totalFaceoffWins: 0 };
const emptyGoalie: NhlGoalieRecord = { playerId: 0, goalieFullName: "", teamAbbrevs: "", gamesPlayed: 0, gamesStarted: 0, wins: 0, losses: 0, otLosses: 0, goalsAgainst: 0, saves: 0, shutouts: 0, penaltyMinutes: 0, goals: 0, assists: 0, savePct: null, goalsAgainstAverage: null };

function TeamLeadershipEditor({ roster, leadership, disabled, onChange }: { roster: PlayerSeasonWithRelations[]; leadership: TeamLeadership[]; disabled: boolean; onChange: (slot: LeadershipSlot, playerSeasonId: number | null) => void }) {
  const eligible = roster.filter((season) => ["C", "LW", "RW", "D", "G"].includes(position(season))).sort((a, b) => playerName(a).localeCompare(playerName(b)));
  const selected = new Map(leadership.map((entry) => [entry.slot, entry.player_season_id]));
  const slots: Array<[LeadershipSlot, string]> = [["C", "Captain"], ["A1", "Alternate Captain 1"], ["A2", "Alternate Captain 2"]];
  return <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/[0.06]">
    <div><h4 className="font-semibold text-gray-900 dark:text-white">Team Leadership</h4><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Choose one captain and two alternate captains for this season.</p></div>
    <div className="mt-3 grid gap-3 md:grid-cols-3">{slots.map(([slot, label]) => {
      const current = selected.get(slot) ?? "";
      const chosenElsewhere = new Set([...selected.entries()].filter(([otherSlot]) => otherSlot !== slot).map(([, playerId]) => playerId));
      return <label key={slot} className="text-xs font-semibold text-gray-700 dark:text-gray-300">{label}<select disabled={disabled} value={current} onChange={(event) => onChange(slot, event.target.value ? Number(event.target.value) : null)} className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm disabled:cursor-wait disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"><option value="">Unassigned</option>{eligible.map((season) => <option key={season.id} value={season.id} disabled={chosenElsewhere.has(season.id)}>{playerName(season)} · {position(season)}</option>)}</select></label>;
    })}</div>
  </div>;
}

export default function HockeyTeamDetail() {
  const { user, isAdmin } = useAuth();
  const { abbreviation = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSeason = Number(searchParams.get("season"));
  const [team, setTeam] = useState<FantasyTeam | null>(null);
  const [managerTenures, setManagerTenures] = useState<FantasyTeamManagerTenure[]>([]);
  const [teamFinishes, setTeamFinishes] = useState<FantasyTeamFinish[]>([]);
  const [brandingHistory, setBrandingHistory] = useState<FantasyTeamBranding[]>([]);
  const [selectedSeason, setSelectedSeason] = useState(
    seasonOptions.includes(requestedSeason) ? requestedSeason : CURRENT_LEAGUE_SEASON,
  );
  const [viewMode, setViewMode] = useState<"single" | "lineup" | "multi">("lineup");
  const [showTrophyCase, setShowTrophyCase] = useState(false);
  const [roster, setRoster] = useState<PlayerSeasonWithRelations[]>([]);
  const [buyoutPenalties, setBuyoutPenalties] = useState<BuyoutPenalty[]>([]);
  const [retentionAdjustments, setRetentionAdjustments] = useState<RetentionAdjustment[]>([]);
  const [tradeBlockIds, setTradeBlockIds] = useState<Set<number>>(new Set());
  const tradeInterest = usePlayerTradeInterest(selectedSeason);
  const [multiYearRosters, setMultiYearRosters] = useState<Record<number, PlayerSeasonWithRelations[]>>({});
  const [multiYearLeadership, setMultiYearLeadership] = useState<Map<number, "C" | "A">>(new Map());
  const [skaters, setSkaters] = useState<Map<string, NhlSkaterRecord>>(new Map());
  const [goalies, setGoalies] = useState<Map<string, NhlGoalieRecord>>(new Map());
  const [lineupHeadshots, setLineupHeadshots] = useState<Map<string, string>>(new Map());
  const [nhlTeamsByPlayer, setNhlTeamsByPlayer] = useState<Map<string, string>>(new Map());
  const [birthCountriesByPlayer, setBirthCountriesByPlayer] = useState<Map<string, string>>(new Map());
  const [birthDatesByPlayer, setBirthDatesByPlayer] = useState<Map<string, string>>(new Map());
  const [statsView, setStatsView] = useState<"season" | "today" | "yesterday">("season");
  const [dailySkaters, setDailySkaters] = useState<Map<string, NhlSkaterRecord>>(new Map());
  const [dailyGoalies, setDailyGoalies] = useState<Map<string, NhlGoalieRecord>>(new Map());
  const playerCards = useRef(new Map<string, Promise<{ headshot?: string; currentTeamAbbrev?: string; birthCountry?: string; birthDate?: string }>>());
  const [dailyStatsError, setDailyStatsError] = useState("");
  const [dailyStatsLoading, setDailyStatsLoading] = useState(false);
  const [livePlayerIds, setLivePlayerIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statsError, setStatsError] = useState("");
  const [awardsByPlayer, setAwardsByPlayer] = useState<Map<number, PlayerAward[]>>(new Map());
  const [playerAwards, setPlayerAwards] = useState<PlayerAward[]>([]);
  const [awardDefinitions, setAwardDefinitions] = useState<Award[]>([]);
  const [teamPlayerSeasons, setTeamPlayerSeasons] = useState<PlayerSeasonWithRelations[]>([]);
  const [contractHistory, setContractHistory] = useState<PlayerSeasonWithRelations[]>([]);
  const [leadership, setLeadership] = useState<TeamLeadership[]>([]);
  const [canManageLeadership, setCanManageLeadership] = useState(false);
  const [leadershipBusy, setLeadershipBusy] = useState(false);
  const [leadershipError, setLeadershipError] = useState("");

  function handleSeasonChange(year: number) {
    setSelectedSeason(year);
    setSearchParams({ season: String(year) }, { replace: true });
  }

  const revision = useNhlDataRevision(statsView === 'season'
    ? [`live-season:${selectedSeason}`, `skaters:${nhlSeasonId(selectedSeason)}`, `goalies:${nhlSeasonId(selectedSeason)}`]
    : [`live:${getNhlStatsDate(statsView === 'yesterday' ? -1 : 0)}`]);
  useEffect(() => {
    if (!revision) return;
    let active = true;
    const request = statsView === 'season'
      ? (selectedSeason === CURRENT_LEAGUE_SEASON ? fetchNhlLiveSeasonStats(selectedSeason)
        : Promise.all([fetchNhlSkaterStats(nhlSeasonId(selectedSeason)), fetchNhlGoalieStats(nhlSeasonId(selectedSeason))])
          .then(([skaters, goalies]) => ({ skaters, goalies })))
      : fetchNhlDailyStats(getNhlStatsDate(statsView === 'yesterday' ? -1 : 0));
    request.then(stats => {
      if (!active) return;
      if (statsView === 'season') {
        setSkaters(new Map(stats.skaters.map(row => [String(row.playerId), row])));
        setGoalies(new Map(stats.goalies.map(row => [String(row.playerId), row])));
        setStatsError('');
      } else {
        setDailySkaters(new Map(stats.skaters.map(row => [String(row.playerId), row])));
        setDailyGoalies(new Map(stats.goalies.map(row => [String(row.playerId), row])));
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [revision, selectedSeason, statsView]);

  useEffect(() => {
    setViewMode("lineup");
  }, [abbreviation]);

  useEffect(() => {
    setLoading(true);
    fetchFantasyTeamByAbbreviation(abbreviation)
      .then(async (row) => {
        setTeam(row);
        if (row) {
          const [tenures, finishes, branding, historicalRosters, allContractRows] = await Promise.all([
            fetchTeamManagerTenures(row.id),
            fetchTeamFinishes(row.id),
            fetchTeamBrandingHistory(row.id),
            fetchPlayerSeasonsByTeam(row.id),
            fetchPlayerSeasons(),
          ]);
          setManagerTenures(tenures);
          setTeamFinishes(finishes);
          setBrandingHistory(branding);
          setTeamPlayerSeasons(historicalRosters);
          setContractHistory(allContractRows);
        } else {
          setManagerTenures([]);
          setTeamFinishes([]);
            setTeamPlayerSeasons([]);
            setContractHistory([]);
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [abbreviation]);

  useEffect(() => {
    if (!team) return;
    Promise.all([fetchPlayerSeasonsByTeamAndSeason(team.id, selectedSeason), fetchBuyoutPenalties(selectedSeason, team.id).catch(() => [] as BuyoutPenalty[]), fetchRetentionAdjustments(selectedSeason, team.id).catch(() => [] as RetentionAdjustment[])])
      .then(([seasonRows, penaltyRows, adjustmentRows]) => {
        setRoster(seasonRows);
        setBuyoutPenalties(penaltyRows);
        setRetentionAdjustments(adjustmentRows);
        setError("");
      })
      .catch((err: Error) => setError(err.message));

    fetchTradeBlockListings(selectedSeason)
      .then((rows) => setTradeBlockIds(new Set(rows.map((row) => row.player_season_id))))
      .catch(() => setTradeBlockIds(new Set()));

    const finalizedStatsRequest = () => Promise.all([
      fetchNhlSkaterStats(nhlSeasonId(selectedSeason)),
      fetchNhlGoalieStats(nhlSeasonId(selectedSeason)),
    ]).then(([seasonSkaters, seasonGoalies]) => ({ skaters: seasonSkaters, goalies: seasonGoalies }));
    const statsRequest = selectedSeason === CURRENT_LEAGUE_SEASON
      ? fetchNhlLiveSeasonStats(selectedSeason).catch((error: unknown) => {
          if (isNhlRateLimit(error)) throw error;
          return finalizedStatsRequest();
        })
      : finalizedStatsRequest();
    statsRequest
      .then((stats) => {
        setSkaters(new Map(stats.skaters.map((row) => [String(row.playerId), row])));
        setGoalies(new Map(stats.goalies.map((row) => [String(row.playerId), row])));
        setStatsError("");
      })
      .catch((err: Error) => setStatsError(err.message));

    Promise.all([fetchPlayerAwards(), fetchAwards(true)])
      .then(([rows, definitions]) => {
        setPlayerAwards(rows);
        setAwardsByPlayer(mapAwardsByPlayer(rows));
        setAwardDefinitions(definitions);
      })
      .catch(() => {
        setPlayerAwards([]);
        setAwardsByPlayer(new Map());
        setAwardDefinitions([]);
      });
  }, [team, selectedSeason]);

  useEffect(() => {
    if (selectedSeason !== CURRENT_LEAGUE_SEASON || statsView !== "season") return;
    let active = true;
    const refreshSeasonStats = async () => {
      try {
        const stats = await fetchNhlLiveSeasonStats(selectedSeason);
        if (!active) return;
        setSkaters(new Map(stats.skaters.map((row) => [String(row.playerId), row])));
        setGoalies(new Map(stats.goalies.map((row) => [String(row.playerId), row])));
        setStatsError("");
      } catch {
        // Retain the latest composite if a live refresh temporarily fails.
        return false;
      }
    };
    const stop = startNhlPolling(refreshSeasonStats, "season");
    return () => { active = false; stop(); };
  }, [selectedSeason, statsView]);

  useEffect(() => {
    if (!team) return;
    let active = true;
    Promise.all([
      fetchTeamLeadership(team.id, selectedSeason),
      user ? fetchUserTeamAssignment(user.id, selectedSeason).catch(() => null) : Promise.resolve(null),
    ]).then(([rows, assignment]) => {
      if (!active) return;
      setLeadership(rows);
      setCanManageLeadership(isAdmin || assignment?.fantasy_team_id === team.id);
      setLeadershipError("");
    }).catch((err: Error) => {
      if (active) setLeadershipError(err.message);
    });
    return () => { active = false; };
  }, [team, selectedSeason, user, isAdmin]);

  async function updateLeadership(slot: LeadershipSlot, playerSeasonId: number | null) {
    if (!team || !canManageLeadership) return;
    setLeadershipBusy(true);
    setLeadershipError("");
    try {
      await setTeamLeadershipSlot({ teamId: team.id, seasonYear: selectedSeason, slot, playerSeasonId });
      setLeadership(await fetchTeamLeadership(team.id, selectedSeason));
    } catch (err) {
      setLeadershipError(err instanceof Error ? err.message : "Unable to update team leadership.");
    } finally {
      setLeadershipBusy(false);
    }
  }

  const multiYearSeasons = useMemo(() => Array.from({ length: 5 }, (_, index) => selectedSeason + index), [selectedSeason]);

  useEffect(() => {
    if (!team || viewMode !== "multi") return;
    Promise.all(multiYearSeasons.map(async (year) => {
      const [players, leaders] = await Promise.all([fetchPlayerSeasonsByTeamAndSeason(team.id, year), fetchTeamLeadership(team.id, year)]);
      return { year, players, leaders };
    }))
      .then((results) => {
        setMultiYearRosters(Object.fromEntries(results.map(({ year, players }) => [year, players])));
        setMultiYearLeadership(new Map(results.flatMap(({ leaders }) => leaders.map((entry) => [entry.player_season_id, entry.slot === "C" ? "C" as const : "A" as const] as const))));
        setError("");
      })
      .catch((err: Error) => setError(err.message));
  }, [team, viewMode, multiYearSeasons]);

  useEffect(() => {
    let active = true;
    const metadataRows = viewMode === "multi" ? [...roster, ...Object.values(multiYearRosters).flat()] : roster;
    const ids = [...new Set(metadataRows.map(playerApiId))].filter(Boolean);
    ids.forEach(id => {
      let request = playerCards.current.get(id);
      if (!request) {
        request = fetchNhlPlayerLanding(Number(id)).then(({ headshot, currentTeamAbbrev, birthCountry, birthDate }) =>
          ({ headshot, currentTeamAbbrev, birthCountry, birthDate }));
        playerCards.current.set(id, request);
        request.catch(() => { if (playerCards.current.get(id) === request) playerCards.current.delete(id); });
      }
      void request.then(landing => {
        if (!active) return;
        if (landing.headshot) setLineupHeadshots(current => new Map(current).set(id, landing.headshot!));
        if (landing.currentTeamAbbrev) setNhlTeamsByPlayer(current => new Map(current).set(id, landing.currentTeamAbbrev!));
        if (landing.birthCountry) setBirthCountriesByPlayer(current => new Map(current).set(id, landing.birthCountry!));
        if (landing.birthDate) setBirthDatesByPlayer(current => new Map(current).set(id, landing.birthDate!));
      }).catch(() => {});
    });
    return () => { active = false; };
  }, [roster, multiYearRosters, viewMode, revision]);

  useEffect(() => {
    let active = true;
    const refreshLivePlayers = async () => {
      try {
        const ids = await fetchNhlLivePlayerIds();
        if (active) setLivePlayerIds(ids);
      } catch {
        // Keep the last confirmed flags while the NHL is temporarily unavailable.
        return false;
      }
    };
    void refreshLivePlayers();
    const stop = startNhlPolling(refreshLivePlayers, "live");
    return () => { active = false; stop(); };
  }, []);

  useEffect(() => {
    if (statsView === "season") return;
    let active = true;
    let requestedDate = "";
    const refreshDailyStats = async () => {
      setDailyStatsLoading(true);
      try {
        const date = getNhlStatsDate(statsView === "yesterday" ? -1 : 0);
        if (requestedDate !== date) {
          requestedDate = date;
          setDailySkaters(new Map()); setDailyGoalies(new Map());
        }
        const result = await fetchNhlDailyStats(date);
        if (active) {
          setDailyStatsError("");
          setDailySkaters(new Map(result.skaters.map((row) => [String(row.playerId), row])));
          setDailyGoalies(new Map(result.goalies.map((row) => [String(row.playerId), row])));
        }
      } catch {
        // Preserve the last complete daily results during transient API failures.
        if (active) setDailyStatsError("Daily NHL data is delayed. Any last successful results remain visible.");
        return false;
      } finally {
        if (active) setDailyStatsLoading(false);
      }
    };
    void refreshDailyStats();
    const stop = statsView === "today" ? startNhlPolling(refreshDailyStats, "live") : () => {};
    return () => { active = false; stop(); };
  }, [statsView]);

  const byPosition = useMemo(() => roster.reduce<Record<string, PlayerSeasonWithRelations[]>>((groups, season) => {
    const code = position(season);
    (groups[code] ||= []).push(season);
    return groups;
  }, {}), [roster]);
  const selectedManager = getManagerForSeason(managerTenures, selectedSeason);
  const displayTeam = team ? applyTeamBranding(team, brandingHistory, selectedSeason) : null;
  const rosterCount = roster.filter((season) => activePositions.has(position(season) as never)).length;
  const ageRoster = roster.filter((season) => ageRosterPositions.has(position(season) as never));
  const ageDate = selectedSeason === CURRENT_LEAGUE_SEASON ? new Date() : new Date(`${selectedSeason - 1}-10-01T12:00:00`);
  const rosterAges = ageRoster.map((season) => birthDatesByPlayer.get(playerApiId(season))).filter((date): date is string => Boolean(date)).map((date) => ageOnDate(date, ageDate)).filter((age): age is number => age !== null);
  const averageRosterAge = rosterAges.length ? rosterAges.reduce((sum, age) => sum + age, 0) / rosterAges.length : null;
  const buyoutPenaltyTotal = buyoutPenalties.reduce((sum, penalty) => sum + penalty.amount, 0);
  const retentionNet = retentionAdjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0);
  const buyoutSlotsUsed = new Set(buyoutPenalties.map((penalty) => penalty.buyout_id)).size;
  const retentionSlotsUsed = new Set(retentionAdjustments.filter((adjustment) => adjustment.adjustment_type === "charge").map((adjustment) => adjustment.retention_id)).size;
  const capSalary = roster.filter((season) => capPositions.has(position(season) as never)).reduce((sum, season) => sum + (season.salary || 0), 0) + buyoutPenaltyTotal + retentionNet;
  const salaryCap = salaryCapForSeason(selectedSeason);
  const capSpace = salaryCap - capSalary;
  const prospects = roster.filter((season) => prospectPositions.has(position(season)));
  const displayedSkaters = statsView === "season" ? skaters : dailySkaters;
  const displayedGoalies = statsView === "season" ? goalies : dailyGoalies;
  const leadershipByPlayer = new Map(leadership.map((entry) => [entry.player_season_id, entry.slot === "C" ? "C" as const : "A" as const]));
  const finishYears = (placement: 1 | 2 | 3) => teamFinishes
    .filter((finish) => finish.placement === placement)
    .map((finish) => finish.season_year)
    .sort((a, b) => b - a);
  const renderInterest = (season: PlayerSeasonWithRelations) => tradeInterest.canExpressInterest(season) ? <PlayerInterestButton interested={tradeInterest.isInterested(season.id)} busy={tradeInterest.busyPlayerSeasonId === season.id} onClick={() => void tradeInterest.toggleInterest(season)} /> : null;

  return <div>
    <PageMeta title="Great Lakes Dynasty Hockey League" description="GLDHL team roster and payroll" />
    <PageBreadcrumb pageTitle={displayTeam?.team_name || "Team Detail"} />
    {loading && <div className="rounded-2xl border border-gray-200 p-10 text-center text-sm text-gray-500">Loading team…</div>}
    {!loading && error && !team && <div className="rounded-2xl border border-error-200 bg-error-50 p-5 text-error-700">{error}</div>}
    {!loading && !team && !error && <div className="rounded-2xl border border-gray-200 p-10 text-center"><p>Team not found.</p><Link to="/teams" className="mt-4 inline-block text-brand-500">Back to Teams</Link></div>}
    {team && <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="h-2" style={{ background: `linear-gradient(90deg, ${displayTeam?.primary_color || "#1d4ed8"}, ${displayTeam?.secondary_color || "#f97316"})` }} />
      <div className="p-3 xl:p-4">
        <TeamIdentityCard team={displayTeam || team} season={selectedSeason} managerName={selectedManager?.manager_name || team.manager_name} />
        <div className="mt-2 grid grid-cols-3 gap-2"><Medal icon="🥇" value={team.championships} label="Championships" years={finishYears(1)} tone="gold" /><Medal icon="🥈" value={team.runner_up_finishes} label="Runner-up finishes" years={finishYears(2)} tone="silver" /><Medal icon="🥉" value={team.third_place_finishes} label="Third-place finishes" years={finishYears(3)} tone="bronze" /></div>
        <div className="mt-2 flex flex-wrap justify-end gap-2"><Link to={`/teams/${team.id}/farm-systems`} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700">🏒 Farm Systems</Link><Link to={`/teams/${team.id}/records`} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700">📚 Record Book</Link><button type="button" onClick={() => setShowTrophyCase((visible) => !visible)} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600">🏆 {showTrophyCase ? "Hide Trophy Case" : "View Trophy Case"}</button></div>
        {showTrophyCase && <TrophyCase team={displayTeam || team} finishes={teamFinishes} playerAwards={playerAwards} teamSeasons={teamPlayerSeasons} awards={awardDefinitions} />}

        <div className="mt-3 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="font-semibold text-gray-800 text-theme-lg dark:text-white/90">Roster &amp; Payroll</h3><p className="text-xs text-gray-500">Active roster limit: {ROSTER_LIMIT} players.</p></div><div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-end"><div className="inline-flex min-h-11 flex-wrap rounded-lg border border-gray-300 p-1 dark:border-gray-700"><button type="button" onClick={() => setViewMode("lineup")} className={`rounded-md px-3 py-2 text-sm font-medium ${viewMode === "lineup" ? "bg-brand-500 text-white" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"}`}>Lineup</button><button type="button" onClick={() => setViewMode("single")} className={`rounded-md px-3 py-2 text-sm font-medium ${viewMode === "single" ? "bg-brand-500 text-white" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"}`}>Roster</button><button type="button" onClick={() => setViewMode("multi")} className={`rounded-md px-3 py-2 text-sm font-medium ${viewMode === "multi" ? "bg-brand-500 text-white" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"}`}>Multi-Year</button></div><div className="w-full sm:w-44"><label htmlFor="season" className="mb-1 block text-sm font-medium">{viewMode === "multi" ? "Starting Season" : "Season"}</label><select id="season" value={selectedSeason} onChange={(event) => handleSeasonChange(Number(event.target.value))} className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 dark:border-gray-700 dark:bg-gray-900">{seasonOptions.map((year) => <option key={year}>{year}</option>)}</select></div></div></div>
          {viewMode === "single" && <div className="mt-4 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center"><div className="inline-flex rounded-lg border border-gray-300 p-1 dark:border-gray-700"><button type="button" onClick={() => setStatsView("season")} className={`rounded-md px-3 py-1.5 text-xs font-bold ${statsView === "season" ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "text-gray-500"}`}>Season</button><button type="button" onClick={() => setStatsView("today")} className={`rounded-md px-3 py-1.5 text-xs font-bold ${statsView === "today" ? "bg-error-500 text-white" : "text-gray-500"}`}>Today</button><button type="button" onClick={() => setStatsView("yesterday")} className={`rounded-md px-3 py-1.5 text-xs font-bold ${statsView === "yesterday" ? "bg-brand-500 text-white" : "text-gray-500"}`}>Yesterday</button></div>{statsView !== "season" && <span className="text-xs text-gray-500">{dailyStatsLoading ? "Updating…" : statsView === "today" ? "Live provisional stats · updates every 30 seconds" : `${getNhlStatsDate(-1)} results`}</span>}</div>}
          {viewMode !== "multi" && <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7"><PayrollCard label="Salary Cap" value={money.format(salaryCap)} /><PayrollCard label="Cap Salary" value={money.format(capSalary)} /><PayrollCard label="Buyout Penalties" value={money.format(buyoutPenaltyTotal)} detail={`${buyoutSlotsUsed} of 2 used`} danger={buyoutSlotsUsed > 2} /><PayrollCard label="Retention Net" value={money.format(retentionNet)} detail={`${retentionSlotsUsed} of 1 used`} danger={retentionNet > 0 || retentionSlotsUsed > 1} /><PayrollCard label={capSpace >= 0 ? "Cap Space" : "Over Cap"} value={money.format(Math.abs(capSpace))} danger={capSpace < 0} /><PayrollCard label="Active Roster" value={`${rosterCount} / ${ROSTER_LIMIT}`} danger={rosterCount > ROSTER_LIMIT} /><PayrollCard label="Average Age" value={averageRosterAge === null ? "Loading…" : `${averageRosterAge.toFixed(1)} years`} detail={`${ageRoster.length} active, IR, LTIR and waiver players`} /></div>}
          {viewMode === "single" && canManageLeadership && <TeamLeadershipEditor roster={roster} leadership={leadership} disabled={leadershipBusy} onChange={(slot, playerSeasonId) => void updateLeadership(slot, playerSeasonId)} />}
          {leadershipError && <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">Team leadership: {leadershipError}</div>}
          {error && <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">{error}</div>}
          {statsView !== "season" && dailyStatsError && <p role="status" className="mt-3 text-sm text-gray-500 dark:text-gray-400">{dailyStatsError}</p>}
          {statsError && <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">Roster loaded, but NHL statistics could not be loaded: {statsError}</div>}
          {viewMode === "multi" ? <MultiYearView years={multiYearSeasons} rosters={multiYearRosters} skaters={skaters} goalies={goalies} nhlTeams={nhlTeamsByPlayer} awardsByPlayer={awardsByPlayer} leadershipByPlayer={multiYearLeadership} /> : viewMode === "lineup" ? <LineupPreview roster={roster} contractHistory={contractHistory} seasonYear={selectedSeason} skaters={skaters} goalies={goalies} headshots={lineupHeadshots} nhlTeams={nhlTeamsByPlayer} birthCountries={birthCountriesByPlayer} leadershipByPlayer={leadershipByPlayer} livePlayerIds={livePlayerIds} team={displayTeam || team} /> : <div className="mt-5 space-y-4">
            {activeSections.map((section) => section.type === "goalie" ? <GoalieTable key={section.code} players={byPosition.G || []} stats={displayedGoalies} nhlTeams={nhlTeamsByPlayer} awardsByPlayer={awardsByPlayer} tradeBlockIds={tradeBlockIds} livePlayerIds={livePlayerIds} leadershipByPlayer={leadershipByPlayer} renderInterest={renderInterest} /> : <SkaterTable key={section.code} code={section.code} label={section.label} players={byPosition[section.code] || []} stats={displayedSkaters} nhlTeams={nhlTeamsByPlayer} awardsByPlayer={awardsByPlayer} tradeBlockIds={tradeBlockIds} livePlayerIds={livePlayerIds} leadershipByPlayer={leadershipByPlayer} renderInterest={renderInterest} />)}
            <div className="pt-2"><h3 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Non-Rostered Players</h3><div className="space-y-4">{nonRosterSections.map((section) => <CompactTable key={section.code} code={section.code} label={section.label} players={byPosition[section.code] || []} skaters={displayedSkaters} goalies={displayedGoalies} nhlTeams={nhlTeamsByPlayer} note={section.cap ? "Counts toward cap only" : "Excluded from cap and roster"} awardsByPlayer={awardsByPlayer} tradeBlockIds={tradeBlockIds} livePlayerIds={livePlayerIds} renderInterest={renderInterest} />)}</div></div>
            <div className="pt-2"><h3 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Buyout Penalties</h3><div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"><div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-white/[0.03]"><span className="text-sm font-semibold">Dead cap charges</span><span className="text-xs text-gray-500">Counts toward cap · no roster spot</span></div>{buyoutPenalties.length ? <table className="min-w-full text-sm"><tbody className="divide-y divide-gray-100 dark:divide-gray-800">{buyoutPenalties.map((penalty) => <tr key={penalty.id}><td className="px-3 py-3 font-semibold">{penalty.player?.full_name || "Player buyout"}</td><td className="px-3 py-3 text-center">{penalty.season_year}</td><td className="px-3 py-3 text-right font-black text-error-600">{money.format(penalty.amount)}</td></tr>)}</tbody></table> : <p className="px-3 py-5 text-center text-sm text-gray-500">No buyout penalties this season.</p>}</div></div>
            <div className="pt-2"><h3 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Salary Retention</h3><div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"><div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-white/[0.03]"><span className="text-sm font-semibold">Retention charges and relief</span><span className="text-xs text-gray-500">Net adjustment: {money.format(retentionNet)}</span></div>{retentionAdjustments.length ? <table className="min-w-full text-sm"><tbody className="divide-y divide-gray-100 dark:divide-gray-800">{retentionAdjustments.map((adjustment) => { const counterpart = adjustment.adjustment_type === "charge" ? adjustment.retention?.receiving_team : adjustment.retention?.retaining_team; return <tr key={adjustment.id}><td className="px-3 py-3 font-semibold">{adjustment.player?.full_name || "Retained contract"}</td><td className="px-3 py-3 text-center capitalize">{adjustment.adjustment_type}{counterpart ? ` · ${counterpart.abbreviation}` : ""}</td><td className={`px-3 py-3 text-right font-black ${adjustment.amount > 0 ? "text-error-600" : "text-success-600"}`}>{adjustment.amount > 0 ? "+" : "−"}{money.format(Math.abs(adjustment.amount))}</td></tr>; })}</tbody></table> : <p className="px-3 py-5 text-center text-sm text-gray-500">No retention adjustments this season.</p>}</div></div>
            <div className="pt-2"><h3 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Acquired Prospects</h3><CompactTable code="AP" label="Acquired Prospects" players={prospects} skaters={displayedSkaters} goalies={displayedGoalies} nhlTeams={nhlTeamsByPlayer} note="Excluded from cap and roster" awardsByPlayer={awardsByPlayer} tradeBlockIds={tradeBlockIds} livePlayerIds={livePlayerIds} renderInterest={renderInterest} /></div>
          </div>}
        </div>
      </div>
    </div>}
  </div>;
}
