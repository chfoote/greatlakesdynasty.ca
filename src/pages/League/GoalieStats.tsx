import { useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import {
  fetchNhlGoalieStats,
  formatFantasyPoints,
  formatNhlStat,
  getGoalieScore,
  type NhlGoalieRecord,
} from "../../lib/nhl";
import { fetchPlayerSeasonsBySeason, type PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import NhlPlayerCell from "./NhlPlayerCell";
import { fetchPlayerAwards, mapAwardsByPlayer, type PlayerAward } from "../../lib/awards";
import { applyTeamBranding, fetchFantasyTeams, fetchTeamBrandingHistory, type FantasyTeam } from "../../lib/fantasyTeams";
import StatsRightsFilters, { type RightsFilter } from "./StatsRightsFilters";
import { fetchProspectRights, getProspectRight, removeAgedOutProspectRights, type ProspectRight } from "../../lib/prospectRights";

const statsSeasons = [2026, 2027];
function nhlSeasonId(year: number) { return (year - 1) * 10000 + year; }

export default function GoalieStats() {
  const [records, setRecords] = useState<NhlGoalieRecord[]>([]);
  const [fantasySeasons, setFantasySeasons] = useState<Map<string, PlayerSeasonWithRelations>>(new Map());
  const [prospectRights, setProspectRights] = useState<Map<string, ProspectRight>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [awardsByPlayer, setAwardsByPlayer] = useState<Map<number, PlayerAward[]>>(new Map());
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [rightsFilter, setRightsFilter] = useState<RightsFilter>("all");
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<number>>(new Set());
  const [selectedSeason, setSelectedSeason] = useState(2026);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchNhlGoalieStats(nhlSeasonId(selectedSeason)),
      fetchProspectRights(selectedSeason).catch(() => new Map<string, ProspectRight>()),
    ])
      .then(async ([data, rights]) => {
        const eligibleRights = await removeAgedOutProspectRights(rights, data.map((record) => ({ playerId: record.playerId, playerName: record.goalieFullName })));
        if (!active) return;
        setRecords(data);
        setProspectRights(eligibleRights);
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load goalie stats");
      })
      .finally(() => { if (active) setLoading(false); });

    fetchPlayerSeasonsBySeason(selectedSeason)
      .then((seasonRows) => {
        if (!active) return;
        setFantasySeasons(new Map(seasonRows.filter((season) => season.player?.player_api_id).map((season) => [season.player!.player_api_id, season])));
      })
      .catch(() => {
        // NHL stats should remain usable when optional fantasy roster metadata fails.
      });

    fetchPlayerAwards()
      .then((rows) => { if (active) setAwardsByPlayer(mapAwardsByPlayer(rows)); })
      .catch(() => {});
    Promise.all([fetchFantasyTeams(), fetchTeamBrandingHistory()])
      .then(([teamRows, branding]) => { if (active) setTeams(teamRows.map((team) => applyTeamBranding(team, branding, selectedSeason))); })
      .catch(() => {});
    return () => { active = false; };
  }, [selectedSeason]);

  const filteredRecords = useMemo(() => records.filter((record) => {
    const fantasySeason = fantasySeasons.get(String(record.playerId));
    const prospectRight = getProspectRight(prospectRights, record.playerId, record.goalieFullName);
    const owned = Boolean(fantasySeason?.fantasy_team_id || prospectRight);
    const ownerTeamId = fantasySeason?.fantasy_team_id || prospectRight?.team.id;
    if (rightsFilter === "owned" && !owned) return false;
    if (rightsFilter === "unowned" && owned) return false;
    if (selectedTeamIds.size && (!ownerTeamId || !selectedTeamIds.has(ownerTeamId))) return false;
    return true;
  }), [records, fantasySeasons, prospectRights, rightsFilter, selectedTeamIds]);

  return (
    <div>
      <PageMeta title="Great Lakes Dynasty Hockey League" description="NHL goalie fantasy statistics for GLDHL" />
      <PageBreadcrumb pageTitle="Goalie Stats" />
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><h3 className="mb-2 font-semibold text-gray-800 text-theme-xl dark:text-white/90 sm:text-2xl">Goalie Stats</h3><p className="text-sm text-gray-500 dark:text-gray-400 sm:text-base">NHL regular-season scoring and GLDHL ownership for Season {selectedSeason}.</p></div>
          <div className="w-full sm:w-40"><label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Season</label><select value={selectedSeason} onChange={(event) => { setSelectedSeason(Number(event.target.value)); setSelectedTeamIds(new Set()); }} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900">{statsSeasons.map((season) => <option key={season}>{season}</option>)}</select></div>
        </div>
        <StatsRightsFilters
          rights={rightsFilter}
          onRightsChange={setRightsFilter}
          teams={teams}
          selectedTeamIds={selectedTeamIds}
          onToggleTeam={(teamId) => setSelectedTeamIds((current) => { const next = new Set(current); if (next.has(teamId)) next.delete(teamId); else next.add(teamId); return next; })}
          onClear={() => { setRightsFilter("all"); setSelectedTeamIds(new Set()); }}
        />
        {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading goalie stats…</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!loading && !error && <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-white/[0.03]"><tr>
              {['PLAYER','GP','GS','W','L','OTL','GA','SV','SO','PIM','G','A','SV%','GAA','SCORE','FPPG'].map((label) => <th key={label} className="whitespace-nowrap px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {[...filteredRecords].sort((a, b) => getGoalieScore(b) - getGoalieScore(a)).map((record) => {
                const score = getGoalieScore(record);
                return <tr key={record.playerId} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                  <td className="px-3 py-3"><NhlPlayerCell playerName={record.goalieFullName} playerId={record.playerId} teamAbbreviation={record.teamAbbrevs} fantasySeason={fantasySeasons.get(String(record.playerId))} prospectRight={getProspectRight(prospectRights, record.playerId, record.goalieFullName)} awards={fantasySeasons.get(String(record.playerId))?.player?.id ? awardsByPlayer.get(fantasySeasons.get(String(record.playerId))!.player!.id) || [] : []} /></td>
                  {[record.gamesPlayed,record.gamesStarted,record.wins,record.losses,record.otLosses,record.goalsAgainst,record.saves,record.shutouts,record.penaltyMinutes,record.goals,record.assists].map((value, index) => <td key={index} className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{formatNhlStat(value)}</td>)}
                  <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{record.savePct === null ? '—' : record.savePct.toFixed(3)}</td>
                  <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{formatNhlStat(record.goalsAgainstAverage, 2)}</td>
                  <td className="px-3 py-3 text-center font-semibold text-gray-800 dark:text-white/90">{formatFantasyPoints(score)}</td>
                  <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{record.gamesPlayed ? formatFantasyPoints(score / record.gamesPlayed) : '—'}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
      </div>
    </div>
  );
}
