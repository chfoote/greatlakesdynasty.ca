import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import PositionBadge from "../../components/hockey/PositionBadge";
import { applyTeamBranding, fetchFantasyTeamByAbbreviation, fetchFantasyTeams, fetchTeamBrandingHistory, type FantasyTeam } from "../../lib/fantasyTeams";
import { fetchPlayerSeasons, type PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import {
  fetchNhlDraftPicks,
  fetchNhlGoalieStats,
  fetchNhlLiveSeasonStats,
  fetchNhlPlayerLanding,
  fetchNhlSkaterStats,
  formatFantasyPoints,
  formatNhlStat,
  getGoalieScore,
  getSkaterScore,
  searchNhlPlayers,
  type NhlDraftPick,
  type NhlGoalieRecord,
  type NhlSkaterRecord,
} from "../../lib/nhl";
import { CURRENT_LEAGUE_SEASON } from "../../lib/leagueSeasons";
import TeamIdentityCard from "./TeamIdentityCard";

function earliestPotentiallyEligibleDraftYear() {
  const today = new Date();
  const youngestDraftClassPlayersHaveTurned25 = today.getMonth() > 8 || (today.getMonth() === 8 && today.getDate() >= 15);
  return today.getFullYear() - (youngestDraftClassPlayersHaveTurned25 ? 6 : 7);
}

type FarmProspect = {
  key: string;
  draftYear: number;
  pick: NhlDraftPick;
  playerId?: number;
  birthDate?: string;
  headshot?: string;
  statsSeason?: number;
  skater?: NhlSkaterRecord;
  goalie?: NhlGoalieRecord;
  previouslySigned?: boolean;
  currentRights?: {
    team: FantasyTeam;
    seasonYear: number;
  };
};

function nhlSeasonId(year: number) {
  return (year - 1) * 10000 + year;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizePosition(value?: string) {
  if (value === "LW") return "L";
  if (value === "RW") return "R";
  return value || "";
}

function pickName(pick: NhlDraftPick) {
  return [pick.firstName?.default, pick.lastName?.default].filter(Boolean).join(" ") || "Unknown Player";
}

function farmTeamsForDraftYear(farmTeam: string, draftYear: number) {
  const requested = normalize(farmTeam);
  if (requested === "detroitredrings") return ["Detroit Red Wings", "DET"];
  if (requested === "anaheimduck") return ["Anaheim Ducks", "ANA"];
  const isUtahFranchise = requested === "utahmammoth"
    || requested === "utahhockeyclub"
    || requested === "uta";
  if (!isUtahFranchise) return [farmTeam];
  if (draftYear < 2024) return ["Arizona Coyotes", "ARI"];
  if (draftYear === 2024) return ["Utah Hockey Club", "UTA"];
  return [farmTeam, "Utah Mammoth", "UTA"];
}

function pickBelongsToTeam(pick: NhlDraftPick, farmTeam: string, draftYear: number) {
  const requested = farmTeamsForDraftYear(farmTeam, draftYear).map(normalize);
  if (!requested.length || requested.includes("tbd") || requested.includes("notassigned")) return false;
  const pickNames = [
    pick.teamName?.default || "",
    pick.teamCommonName?.default || "",
    pick.teamAbbrev,
  ].map(normalize);
  return pickNames.some((candidate) => requested.includes(candidate));
}

function ageOnDate(birthDate?: string) {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const birthdayPending = today.getMonth() < birth.getMonth()
    || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (birthdayPending) age -= 1;
  return age;
}

function formatBirthDate(birthDate?: string) {
  if (!birthDate) return "Birthday unavailable";
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return "Birthday unavailable";
  return `Born ${birth.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}`;
}

function SkaterStats({ record, season }: { record?: NhlSkaterRecord; season?: number }) {
  if (!record) return <span className="text-gray-400">No NHL stats</span>;
  return <span className="whitespace-nowrap">{season}: {record.gamesPlayed} GP · {record.goals} G · {record.assists} A · {record.goals + record.assists} P</span>;
}

function GoalieStats({ record, season }: { record?: NhlGoalieRecord; season?: number }) {
  if (!record) return <span className="text-gray-400">No NHL stats</span>;
  return <span className="whitespace-nowrap">{season}: {record.gamesPlayed} GP · {record.wins} W · {record.goals} G · {record.assists} A · {record.savePct == null ? "—" : record.savePct.toFixed(3)} SV% · {formatNhlStat(record.goalsAgainstAverage, 2)} GAA</span>;
}

function ordinal(value: number) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

function FarmTeamHeading({ label, farmTeam, prospects }: { label: string; farmTeam: string | null; prospects: FarmProspect[] }) {
  const teamLogo = prospects.find((prospect) => prospect.pick.teamLogoLight)?.pick.teamLogoLight;
  return <div className="flex items-center gap-4 px-5 py-5">
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white p-1.5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      {teamLogo ? <img src={teamLogo} alt="" className="h-full w-full object-contain" /> : <span className="text-2xl">🏒</span>}
    </div>
    <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.15em] text-gray-500">{label} Farm System</p><h2 className="mt-1 truncate text-xl font-bold text-gray-900 dark:text-white">{farmTeam || "Not assigned"}</h2></div>
  </div>;
}

function ProspectSpotlight({ team, prospects, loading }: { team: FantasyTeam | null; prospects: FarmProspect[]; loading: boolean }) {
  const leaders = prospects.map((prospect) => {
    const score = prospect.goalie ? getGoalieScore(prospect.goalie) : prospect.skater ? getSkaterScore(prospect.skater) : 0;
    const gamesPlayed = prospect.goalie?.gamesPlayed || prospect.skater?.gamesPlayed || 0;
    return { prospect, score, gamesPlayed };
  }).filter(({ prospect, score }) => {
    const age = ageOnDate(prospect.birthDate);
    const rightsBelongHere = !prospect.currentRights || prospect.currentRights.team.id === team?.id;
    return prospect.statsSeason === CURRENT_LEAGUE_SEASON && !prospect.previouslySigned && rightsBelongHere && (age === null || age < 25) && score > 0;
  }).sort((a, b) => b.score - a.score || b.gamesPlayed - a.gamesPlayed).slice(0, 5);

  return <section className="mb-5 overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-theme-xs dark:border-emerald-500/30 dark:bg-white/[0.03]"><div className="flex flex-col gap-2 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-cyan-50 px-5 py-4 dark:border-emerald-500/20 dark:from-emerald-500/10 dark:to-cyan-500/10 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-300">Farm Report · {CURRENT_LEAGUE_SEASON}</p><h2 className="mt-1 text-xl font-black text-gray-900 dark:text-white">Prospect Spotlight</h2><p className="mt-1 text-xs text-gray-500">Top NHL-performing prospects ranked by GLDHL fantasy score.</p></div><span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">Goalies and skaters · one leaderboard</span></div>{loading ? <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-48 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />)}</div> : leaders.length ? <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto p-4 xl:grid xl:grid-cols-5 xl:overflow-visible">{leaders.map(({ prospect, score, gamesPlayed }, index) => { const record = prospect.goalie || prospect.skater; return <article key={prospect.key} className="relative w-[78vw] max-w-[280px] shrink-0 snap-start overflow-hidden rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60 xl:w-auto"><span className="absolute right-3 top-3 text-2xl font-black text-emerald-200 dark:text-emerald-500/20">#{index + 1}</span><div className="flex items-center gap-3"><Link to={prospect.playerId ? `/player-profile?playerId=${prospect.playerId}` : "#"} className="flex h-14 w-14 shrink-0 items-end justify-center overflow-hidden rounded-full bg-white ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">{prospect.headshot ? <img src={prospect.headshot} alt="" className="h-full w-full object-cover object-top" /> : <span className="text-lg font-black text-gray-300">{pickName(prospect.pick).split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>}</Link><div className="min-w-0"><Link to={prospect.playerId ? `/player-profile?playerId=${prospect.playerId}` : "#"} className="block truncate text-sm font-black text-gray-900 hover:text-brand-500 dark:text-white">{pickName(prospect.pick)}</Link><div className="mt-1 flex items-center gap-1.5"><PositionBadge position={prospect.pick.positionCode} />{prospect.pick.teamLogoLight && <img src={prospect.pick.teamLogoLight} alt="" className="h-5 w-5 object-contain" />}</div></div></div><div className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-white p-2 text-center dark:bg-gray-950/60"><div><p className="text-[8px] font-black uppercase text-gray-400">GP</p><p className="mt-0.5 text-sm font-black text-gray-800 dark:text-white">{gamesPlayed}</p></div><div><p className="text-[8px] font-black uppercase text-gray-400">{prospect.goalie ? "W" : "PTS"}</p><p className="mt-0.5 text-sm font-black text-gray-800 dark:text-white">{prospect.goalie ? prospect.goalie.wins : prospect.skater ? prospect.skater.goals + prospect.skater.assists : 0}</p></div><div><p className="text-[8px] font-black uppercase text-gray-400">FPPG</p><p className="mt-0.5 text-sm font-black text-gray-800 dark:text-white">{gamesPlayed ? formatFantasyPoints(score / gamesPlayed) : "—"}</p></div></div><div className="mt-3 flex items-end justify-between"><div><p className="text-[8px] font-black uppercase tracking-wider text-gray-400">Fantasy Score</p><p className="text-xl font-black text-emerald-600 dark:text-emerald-300">{formatFantasyPoints(score)}</p></div><p className="text-[9px] font-semibold text-gray-400">{record?.teamAbbrevs || prospect.pick.teamAbbrev}</p></div></article>; })}</div> : <div className="px-5 py-10 text-center"><p className="text-sm font-bold text-gray-600 dark:text-gray-300">No prospect fantasy points yet</p><p className="mt-1 text-xs text-gray-400">This leaderboard will populate as eligible prospects produce in the NHL.</p></div>}</section>;
}

function ProspectCells({ prospect }: { prospect?: FarmProspect }) {
  if (!prospect) return <>
    <td className="px-3 py-3 text-center text-gray-300 dark:text-gray-700">—</td>
    <td className="px-3 py-3 text-gray-300 dark:text-gray-700">No selection</td>
    <td className="px-3 py-3 text-center text-gray-300 dark:text-gray-700">—</td>
    <td className="px-3 py-3 text-center text-gray-300 dark:text-gray-700">—</td>
    <td className="px-3 py-3 text-gray-300 dark:text-gray-700">—</td>
  </>;
  const age = ageOnDate(prospect.birthDate);
  const agedOut = age !== null && age >= 25;
  const unavailable = agedOut || prospect.previouslySigned;
  const status = [
    agedOut ? "Aged out (25 or older)" : "",
    prospect.previouslySigned ? "Previously signed to a GLDHL team" : "",
  ].filter(Boolean).join(" · ");
  return <>
    <td className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">#{prospect.pick.overallPick}</td>
    <td className="whitespace-nowrap px-3 py-3 font-medium text-gray-900 dark:text-white">
      <span title={status || undefined} className={unavailable ? "text-gray-400 line-through decoration-gray-400" : ""}>{prospect.playerId ? <Link to={`/player-profile?playerId=${prospect.playerId}`} className={unavailable ? "hover:text-gray-500" : "text-brand-500 hover:underline"}>{pickName(prospect.pick)}</Link> : pickName(prospect.pick)}</span>
      {prospect.currentRights?.team.logo && <img src={prospect.currentRights.team.logo} alt="" title={`Current rights: ${prospect.currentRights.team.team_name} (${prospect.currentRights.seasonYear})`} className="ml-2 inline-block h-6 w-6 rounded object-contain align-middle" />}
    </td>
    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300"><PositionBadge position={prospect.pick.positionCode} /></td>
    <td className={`px-3 py-3 text-center dark:text-gray-300 ${agedOut ? "text-gray-400 line-through" : "text-gray-600"}`}><span title={formatBirthDate(prospect.birthDate)} className={prospect.birthDate ? "cursor-help border-b border-dotted border-gray-400" : ""}>{age ?? "—"}</span></td>
    <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-300">{prospect.pick.positionCode === "G" ? <GoalieStats record={prospect.goalie} season={prospect.statsSeason} /> : <SkaterStats record={prospect.skater} season={prospect.statsSeason} />}</td>
  </>;
}

function DraftBoard({
  team,
  draftYears,
  easternProspects,
  westernProspects,
  loading,
}: {
  team: FantasyTeam | null;
  draftYears: number[];
  easternProspects: FarmProspect[];
  westernProspects: FarmProspect[];
  loading: boolean;
}) {
  const [expandedYears, setExpandedYears] = useState<Set<number>>(() => new Set([draftYears[0]]));

  return <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
    <div className="grid divide-y divide-gray-200 bg-gray-50 dark:divide-gray-800 dark:bg-white/[0.03] md:grid-cols-2 md:divide-x md:divide-y-0">
      <FarmTeamHeading label="Eastern" farmTeam={team?.eastern_farm_system || null} prospects={easternProspects} />
      <FarmTeamHeading label="Western" farmTeam={team?.western_farm_system || null} prospects={westernProspects} />
    </div>
    {loading ? <p className="px-5 py-12 text-center text-sm text-gray-500">Loading draft history…</p> : <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {draftYears.map((year) => {
        const eastForYear = easternProspects.filter((prospect) => prospect.draftYear === year);
        const westForYear = westernProspects.filter((prospect) => prospect.draftYear === year);
        const rounds = [...new Set([...eastForYear, ...westForYear].map((prospect) => prospect.pick.round))].sort((a, b) => a - b);
        const expanded = expandedYears.has(year);
        return <div key={year}>
          <button type="button" onClick={() => setExpandedYears((current) => {
            const next = new Set(current);
            if (next.has(year)) next.delete(year); else next.add(year);
            return next;
          })} className="flex w-full items-center justify-between bg-white px-5 py-4 text-left transition hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800">
            <span><span className="text-lg font-bold text-gray-900 dark:text-white">{year} NHL Draft</span><span className="ml-3 text-xs text-gray-500">{eastForYear.length + westForYear.length} franchise picks</span></span>
            <span className={`text-lg text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}>⌄</span>
          </button>
          {expanded && (rounds.length ? <div className="overflow-x-auto bg-gray-50/70 p-4 dark:bg-black/10 sm:p-5">
            <table className="min-w-full overflow-hidden rounded-xl border border-gray-200 bg-white text-sm dark:border-gray-700 dark:bg-gray-900">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-100 text-xs font-bold uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:bg-gray-800">
                  <th rowSpan={2} className="border-r border-gray-200 px-3 py-3 text-left dark:border-gray-700">Round</th>
                  <th colSpan={5} className="border-r border-gray-200 px-3 py-3 text-center dark:border-gray-700">{team?.eastern_farm_system || "Eastern Farm"}</th>
                  <th colSpan={5} className="px-3 py-3 text-center">{team?.western_farm_system || "Western Farm"}</th>
                </tr>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:bg-gray-900">
                  {["Pick", "Player", "Pos", "Age", "NHL Stats", "Pick", "Player", "Pos", "Age", "NHL Stats"].map((heading, index) => <th key={`${heading}-${index}`} className={`px-3 py-2.5 ${heading === "Pick" || heading === "Pos" || heading === "Age" ? "text-center" : ""} ${index === 4 ? "border-r border-gray-200 dark:border-gray-700" : ""}`}>{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rounds.flatMap((round) => {
                  const eastPicks = eastForYear.filter((prospect) => prospect.pick.round === round);
                  const westPicks = westForYear.filter((prospect) => prospect.pick.round === round);
                  const rowCount = Math.max(eastPicks.length, westPicks.length, 1);
                  return Array.from({ length: rowCount }, (_, index) => <tr key={`${round}-${index}`} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                    {index === 0 && <td rowSpan={rowCount} className="whitespace-nowrap border-r border-gray-200 px-3 py-3 align-top font-semibold text-gray-800 dark:border-gray-700 dark:text-white">{ordinal(round)} Round</td>}
                    <ProspectCells prospect={eastPicks[index]} />
                    <ProspectCells prospect={westPicks[index]} />
                  </tr>);
                })}
              </tbody>
            </table>
          </div> : <p className="bg-gray-50/70 px-5 py-10 text-center text-sm text-gray-500 dark:bg-black/10">No picks were found for either farm system in this draft.</p>)}
        </div>;
      })}
    </div>}
  </section>;
}

export default function FarmSystems() {
  const { abbreviation = "" } = useParams();
  const [team, setTeam] = useState<FantasyTeam | null>(null);
  const [prospects, setProspects] = useState<FarmProspect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const lastDraftYear = CURRENT_LEAGUE_SEASON - 1;
  const firstRelevantDraftYear = earliestPotentiallyEligibleDraftYear();
  const draftYears = useMemo(() => Array.from({ length: lastDraftYear - firstRelevantDraftYear + 1 }, (_, index) => lastDraftYear - index), [firstRelevantDraftYear, lastDraftYear]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetchFantasyTeamByAbbreviation(abbreviation)
      .then(async (teamRow) => {
        if (!teamRow) throw new Error("Team not found.");
        const branding = await fetchTeamBrandingHistory(teamRow.id);
        const displayTeam = applyTeamBranding(teamRow, branding, CURRENT_LEAGUE_SEASON);
        if (active) setTeam(displayTeam);

        const [draftResults, currentStats, previousSkaters, previousGoalies, fantasySeasons, fantasyTeams, allBranding] = await Promise.all([
          Promise.all(draftYears.map(async (year) => ({ year, picks: await fetchNhlDraftPicks(year) }))),
          fetchNhlLiveSeasonStats(CURRENT_LEAGUE_SEASON).catch(() => ({ skaters: [] as NhlSkaterRecord[], goalies: [] as NhlGoalieRecord[] })),
          fetchNhlSkaterStats(nhlSeasonId(CURRENT_LEAGUE_SEASON - 1)).catch(() => []),
          fetchNhlGoalieStats(nhlSeasonId(CURRENT_LEAGUE_SEASON - 1)).catch(() => []),
          fetchPlayerSeasons().catch(() => [] as PlayerSeasonWithRelations[]),
          fetchFantasyTeams().catch(() => [] as FantasyTeam[]),
          fetchTeamBrandingHistory().catch(() => []),
        ]);
        const currentSkaters = currentStats.skaters;
        const currentGoalies = currentStats.goalies;
        const skaterCurrent = new Map(currentSkaters.map((record) => [normalize(record.skaterFullName), record]));
        const goalieCurrent = new Map(currentGoalies.map((record) => [normalize(record.goalieFullName), record]));
        const skaterCurrentById = new Map(currentSkaters.map((record) => [String(record.playerId), record]));
        const goalieCurrentById = new Map(currentGoalies.map((record) => [String(record.playerId), record]));
        const skaterPrevious = new Map(previousSkaters.map((record) => [normalize(record.skaterFullName), record]));
        const goaliePrevious = new Map(previousGoalies.map((record) => [normalize(record.goalieFullName), record]));
        const farmNames = [displayTeam.eastern_farm_system, displayTeam.western_farm_system].filter((name): name is string => Boolean(name));
        const rows = draftResults.flatMap(({ year, picks }) => picks
          .filter((pick) => farmNames.some((farmName) => pickBelongsToTeam(pick, farmName, year)))
          .map((pick) => {
            const name = normalize(pickName(pick));
            const current = pick.positionCode === "G" ? goalieCurrent.get(name) : skaterCurrent.get(name);
            const previous = pick.positionCode === "G" ? goaliePrevious.get(name) : skaterPrevious.get(name);
            const record = current || previous;
            return {
              key: `${year}-${pick.teamAbbrev}-${pick.overallPick}`,
              draftYear: year,
              pick,
              playerId: record?.playerId,
              statsSeason: current ? CURRENT_LEAGUE_SEASON : previous ? CURRENT_LEAGUE_SEASON - 1 : undefined,
              skater: pick.positionCode === "G" ? undefined : record as NhlSkaterRecord | undefined,
              goalie: pick.positionCode === "G" ? record as NhlGoalieRecord | undefined : undefined,
            } satisfies FarmProspect;
          }));
        const acquiredRows = fantasySeasons.filter((season) => season.season_year === CURRENT_LEAGUE_SEASON && season.fantasy_team_id === displayTeam.id && ["PROSPECT", "AP"].includes((season.position || "").toUpperCase()) && season.player?.player_api_id)
          .filter((season) => !rows.some((row) => String(row.playerId || "") === season.player!.player_api_id || normalize(pickName(row.pick)) === normalize(season.player!.full_name || "")))
          .map((season) => {
            const playerId = Number(season.player!.player_api_id);
            const goalie = goalieCurrentById.get(String(playerId));
            const skater = skaterCurrentById.get(String(playerId));
            const fullName = season.player!.full_name || [season.player!.first_name, season.player!.last_name].filter(Boolean).join(" ") || "Unknown Player";
            return {
              key: `acquired-${season.id}`, draftYear: CURRENT_LEAGUE_SEASON - 1, playerId,
              pick: { round: 0, pickInRound: 0, overallPick: 0, teamId: 0, teamAbbrev: goalie?.teamAbbrevs || skater?.teamAbbrevs || "NHL", firstName: { default: fullName }, positionCode: goalie ? "G" : skater?.positionCode || "" },
              statsSeason: goalie || skater ? CURRENT_LEAGUE_SEASON : undefined, goalie, skater,
            } satisfies FarmProspect;
          });
        const resolvedRows = await Promise.all([...rows, ...acquiredRows].map(async (row) => {
          if (row.playerId) return row;
          try {
            const searchResults = await searchNhlPlayers(pickName(row.pick));
            const exactMatch = searchResults.find((result) =>
              normalize(result.name) === normalize(pickName(row.pick))
              && (!row.pick.positionCode || !result.positionCode || normalizePosition(result.positionCode) === normalizePosition(row.pick.positionCode)),
            );
            const playerId = exactMatch ? Number(exactMatch.playerId) : undefined;
            return { ...row, playerId: Number.isFinite(playerId) ? playerId : undefined };
          } catch {
            return row;
          }
        }));
        const landingEntries = await Promise.all(resolvedRows.map(async (row) => {
          if (!row.playerId) return [row.playerId, undefined] as const;
          try { return [row.playerId, await fetchNhlPlayerLanding(row.playerId)] as const; }
          catch { return [row.playerId, undefined] as const; }
        }));
        const landingByPlayer = new Map(landingEntries);
        const fantasySeasonsByPlayer = fantasySeasons.reduce<Map<string, PlayerSeasonWithRelations[]>>((map, season) => {
          const apiId = season.player?.player_api_id;
          if (apiId) map.set(apiId, [...(map.get(apiId) || []), season]);
          return map;
        }, new Map());
        if (active) setProspects(resolvedRows.map((row) => {
          const recordedSeasons = row.playerId ? fantasySeasonsByPlayer.get(String(row.playerId)) || [] : [];
          const latestSeason = [...recordedSeasons].sort((a, b) => b.season_year - a.season_year)[0];
          const rightsTeam = latestSeason?.fantasy_team_id ? fantasyTeams.find((candidate) => candidate.id === latestSeason.fantasy_team_id) : undefined;
          return {
            ...row,
            birthDate: row.playerId ? landingByPlayer.get(row.playerId)?.birthDate : undefined,
            headshot: row.playerId ? landingByPlayer.get(row.playerId)?.headshot : undefined,
            previouslySigned: recordedSeasons.some((season) => Boolean(season.fantasy_team_id) && !["PROSPECT", "AP"].includes((season.position || "").toUpperCase())),
            currentRights: rightsTeam ? {
              team: applyTeamBranding(rightsTeam, allBranding, latestSeason.season_year),
              seasonYear: latestSeason.season_year,
            } : undefined,
          };
        }));
      })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Unable to load farm systems."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [abbreviation, draftYears]);

  const easternProspects = prospects.filter((prospect) => team?.eastern_farm_system && pickBelongsToTeam(prospect.pick, team.eastern_farm_system, prospect.draftYear));
  const westernProspects = prospects.filter((prospect) => team?.western_farm_system && pickBelongsToTeam(prospect.pick, team.western_farm_system, prospect.draftYear));

  return <div>
    <PageMeta title={`${team?.team_name || "Team"} Farm Systems`} description="GLDHL franchise NHL draft history and prospect statistics" />
    <PageBreadcrumb pageTitle={team ? `${team.team_name} Farm Systems` : "Farm Systems"} />
    {error ? <div className="rounded-2xl border border-error-200 bg-error-50 p-5 text-error-700">{error}</div> : <>
      {team && <div className="mb-5 space-y-3">
        <TeamIdentityCard team={team} season={CURRENT_LEAGUE_SEASON} managerName={team.manager_name} />
        <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-gray-500">NHL Draft classes {draftYears[draftYears.length - 1]}–{draftYears[0]}</p><div className="flex items-center gap-4"><Link to="/farm-system-rankings" className="text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-300">View Farm System Rankings</Link><Link to={`/teams/${team.id}`} className="text-sm font-semibold text-brand-500 hover:underline">Back to team</Link></div></div>
      </div>}
      <ProspectSpotlight team={team} prospects={prospects} loading={loading} />
      <DraftBoard team={team} draftYears={draftYears} easternProspects={easternProspects} westernProspects={westernProspects} loading={loading} />
    </>}
  </div>;
}
