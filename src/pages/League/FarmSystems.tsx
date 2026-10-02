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
  fetchNhlPlayerLanding,
  fetchNhlSkaterStats,
  formatNhlStat,
  searchNhlPlayers,
  type NhlDraftPick,
  type NhlGoalieRecord,
  type NhlSkaterRecord,
} from "../../lib/nhl";
import { CURRENT_LEAGUE_SEASON } from "../../lib/leagueSeasons";
import TeamIdentityCard from "./TeamIdentityCard";

const DRAFT_YEAR_COUNT = 10;

type FarmProspect = {
  key: string;
  draftYear: number;
  pick: NhlDraftPick;
  playerId?: number;
  birthDate?: string;
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
  const draftYears = useMemo(() => Array.from({ length: DRAFT_YEAR_COUNT }, (_, index) => lastDraftYear - index), [lastDraftYear]);

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

        const [draftResults, currentSkaters, currentGoalies, previousSkaters, previousGoalies, fantasySeasons, fantasyTeams, allBranding] = await Promise.all([
          Promise.all(draftYears.map(async (year) => ({ year, picks: await fetchNhlDraftPicks(year) }))),
          fetchNhlSkaterStats(nhlSeasonId(CURRENT_LEAGUE_SEASON)).catch(() => []),
          fetchNhlGoalieStats(nhlSeasonId(CURRENT_LEAGUE_SEASON)).catch(() => []),
          fetchNhlSkaterStats(nhlSeasonId(CURRENT_LEAGUE_SEASON - 1)).catch(() => []),
          fetchNhlGoalieStats(nhlSeasonId(CURRENT_LEAGUE_SEASON - 1)).catch(() => []),
          fetchPlayerSeasons().catch(() => [] as PlayerSeasonWithRelations[]),
          fetchFantasyTeams().catch(() => [] as FantasyTeam[]),
          fetchTeamBrandingHistory().catch(() => []),
        ]);
        const skaterCurrent = new Map(currentSkaters.map((record) => [normalize(record.skaterFullName), record]));
        const goalieCurrent = new Map(currentGoalies.map((record) => [normalize(record.goalieFullName), record]));
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
        const resolvedRows = await Promise.all(rows.map(async (row) => {
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
            previouslySigned: recordedSeasons.some((season) => Boolean(season.fantasy_team_id)),
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
        <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-gray-500">NHL Draft classes {draftYears[draftYears.length - 1]}–{draftYears[0]}</p><Link to={`/teams/${team.id}`} className="text-sm font-semibold text-brand-500 hover:underline">Back to team</Link></div>
      </div>}
      <DraftBoard team={team} draftYears={draftYears} easternProspects={easternProspects} westernProspects={westernProspects} loading={loading} />
    </>}
  </div>;
}
