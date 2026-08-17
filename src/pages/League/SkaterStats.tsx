import { useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import {
  fetchNhlSkaterStats,
  formatFantasyPoints,
  formatNhlStat,
  getSkaterScore,
  type NhlSkaterRecord,
} from "../../lib/nhl";
import {
  fetchPlayerSeasonsBySeason,
  type PlayerSeasonWithRelations,
} from "../../lib/fantasyPlayers";
import NhlPlayerCell from "./NhlPlayerCell";
import { fetchPlayerAwards, mapAwardsByPlayer, type PlayerAward } from "../../lib/awards";
import { applyTeamBranding, fetchFantasyTeams, fetchTeamBrandingHistory, type FantasyTeam } from "../../lib/fantasyTeams";
import StatsRightsFilters, { type RightsFilter } from "./StatsRightsFilters";
import { fetchProspectRights, getProspectRight, removeAgedOutProspectRights, type ProspectRight } from "../../lib/prospectRights";
import { fetchTradeBlockListings } from "../../lib/tradeMarket";
import TradeBlockBadge from "./TradeBlockBadge";
import PlayerInterestButton from "./PlayerInterestButton";
import { usePlayerTradeInterest } from "../../hooks/usePlayerTradeInterest";

const statsSeasons = [2026, 2027];
function nhlSeasonId(year: number) { return (year - 1) * 10000 + year; }

export default function SkaterStats() {
  const [records, setRecords] = useState<NhlSkaterRecord[]>([]);
  const [fantasySeasons, setFantasySeasons] = useState<Map<string, PlayerSeasonWithRelations>>(new Map());
  const [prospectRights, setProspectRights] = useState<Map<string, ProspectRight>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [awardsByPlayer, setAwardsByPlayer] = useState<Map<number, PlayerAward[]>>(new Map());
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [positionFilter, setPositionFilter] = useState("all");
  const [rightsFilter, setRightsFilter] = useState<RightsFilter>("all");
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<number>>(new Set());
  const [selectedSeason, setSelectedSeason] = useState(2026);
  const [tradeBlockIds, setTradeBlockIds] = useState<Set<number>>(new Set());
  const tradeInterest = usePlayerTradeInterest(selectedSeason);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchNhlSkaterStats(nhlSeasonId(selectedSeason)),
      fetchProspectRights(selectedSeason).catch(() => new Map<string, ProspectRight>()),
    ])
      .then(async ([data, rights]) => {
        const eligibleRights = await removeAgedOutProspectRights(rights, data.map((record) => ({ playerId: record.playerId, playerName: record.skaterFullName })));
        if (!active) return;
        setRecords(data);
        setProspectRights(eligibleRights);
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load skater stats");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    fetchPlayerSeasonsBySeason(selectedSeason)
      .then((seasonRows) => {
        if (!active) return;
        setFantasySeasons(new Map(seasonRows
          .filter((season) => season.player?.player_api_id)
          .map((season) => [season.player!.player_api_id, season])));
      })
      .catch(() => {
        // NHL stats should remain usable when optional fantasy roster metadata fails.
      });

    fetchTradeBlockListings(selectedSeason)
      .then((rows) => { if (active) setTradeBlockIds(new Set(rows.map((row) => row.player_season_id))); })
      .catch(() => { if (active) setTradeBlockIds(new Set()); });

    fetchPlayerAwards()
      .then((rows) => { if (active) setAwardsByPlayer(mapAwardsByPlayer(rows)); })
      .catch(() => {});
    Promise.all([fetchFantasyTeams(), fetchTeamBrandingHistory()])
      .then(([teamRows, branding]) => { if (active) setTeams(teamRows.map((team) => applyTeamBranding(team, branding, selectedSeason))); })
      .catch(() => {});
    return () => { active = false; };
  }, [selectedSeason]);

  const filteredRecords = useMemo(() => records.filter((record) => {
    const displayPosition = record.positionCode === "L" ? "LW" : record.positionCode === "R" ? "RW" : record.positionCode;
    const fantasySeason = fantasySeasons.get(String(record.playerId));
    const prospectRight = getProspectRight(prospectRights, record.playerId, record.skaterFullName);
    const owned = Boolean(fantasySeason?.fantasy_team_id || prospectRight);
    const ownerTeamId = fantasySeason?.fantasy_team_id || prospectRight?.team.id;
    if (positionFilter !== "all" && displayPosition !== positionFilter) return false;
    if (rightsFilter === "owned" && !owned) return false;
    if (rightsFilter === "unowned" && owned) return false;
    if (selectedTeamIds.size && (!ownerTeamId || !selectedTeamIds.has(ownerTeamId))) return false;
    return true;
  }), [records, fantasySeasons, prospectRights, positionFilter, rightsFilter, selectedTeamIds]);

  return (
    <div>
      <PageMeta title="Great Lakes Dynasty Hockey League" description="NHL skater fantasy statistics for GLDHL" />
      <PageBreadcrumb pageTitle="Skater Stats" />
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><h3 className="mb-2 font-semibold text-gray-800 text-theme-xl dark:text-white/90 sm:text-2xl">Skater Stats</h3><p className="text-sm text-gray-500 dark:text-gray-400 sm:text-base">NHL regular-season scoring and GLDHL ownership for Season {selectedSeason}.</p></div>
          <div className="w-full sm:w-40"><label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Season</label><select value={selectedSeason} onChange={(event) => { setSelectedSeason(Number(event.target.value)); setSelectedTeamIds(new Set()); }} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900">{statsSeasons.map((season) => <option key={season}>{season}</option>)}</select></div>
        </div>
        <StatsRightsFilters
          positions={["C", "LW", "RW", "D"]}
          position={positionFilter}
          onPositionChange={setPositionFilter}
          rights={rightsFilter}
          onRightsChange={setRightsFilter}
          teams={teams}
          selectedTeamIds={selectedTeamIds}
          onToggleTeam={(teamId) => setSelectedTeamIds((current) => { const next = new Set(current); if (next.has(teamId)) next.delete(teamId); else next.add(teamId); return next; })}
          onClear={() => { setPositionFilter("all"); setRightsFilter("all"); setSelectedTeamIds(new Set()); }}
        />
        {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading skater stats…</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-white/[0.03]"><tr>
                {['PLAYER','POS','G','A','+/-','PIMs','PPG','PPA','SHG','SHA','GWG','S','B','H','FOW','SCORE','PPG'].map((label, index) => (
                  <th key={`${label}-${index}`} className="whitespace-nowrap px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">{label}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {[...filteredRecords].sort((a, b) => getSkaterScore(b) - getSkaterScore(a)).map((record) => {
                  const score = getSkaterScore(record);
                  return <tr key={record.playerId} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                    <td className="px-3 py-3"><NhlPlayerCell playerName={record.skaterFullName} playerId={record.playerId} teamAbbreviation={record.teamAbbrevs} fantasySeason={fantasySeasons.get(String(record.playerId))} prospectRight={getProspectRight(prospectRights, record.playerId, record.skaterFullName)} awards={fantasySeasons.get(String(record.playerId))?.player?.id ? awardsByPlayer.get(fantasySeasons.get(String(record.playerId))!.player!.id) || [] : []} leadingAction={tradeInterest.canExpressInterest(fantasySeasons.get(String(record.playerId))) ? <PlayerInterestButton interested={tradeInterest.isInterested(fantasySeasons.get(String(record.playerId))!.id)} busy={tradeInterest.busyPlayerSeasonId === fantasySeasons.get(String(record.playerId))!.id} onClick={() => void tradeInterest.toggleInterest(fantasySeasons.get(String(record.playerId))!)} /> : undefined} />{fantasySeasons.get(String(record.playerId))?.id && tradeBlockIds.has(fantasySeasons.get(String(record.playerId))!.id) && <TradeBlockBadge className="mt-1" />}</td>
                    <td className="px-3 py-3 text-center">{record.positionCode === 'L' ? 'LW' : record.positionCode === 'R' ? 'RW' : record.positionCode}</td>
                    {[record.goals,record.assists,record.plusMinus,record.penaltyMinutes,record.ppGoals,record.ppPoints-record.ppGoals,record.shGoals,record.shPoints-record.shGoals,record.gameWinningGoals,record.shots,record.blockedShots,record.hits,record.totalFaceoffWins].map((value, index) => <td key={index} className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{formatNhlStat(value)}</td>)}
                    <td className="px-3 py-3 text-center font-semibold text-gray-800 dark:text-white/90">{formatFantasyPoints(score)}</td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{record.gamesPlayed ? formatFantasyPoints(score / record.gamesPlayed) : '—'}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
