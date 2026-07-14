import { useEffect, useState } from "react";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import {
  FANTASY_SEASON_YEAR,
  NHL_SEASON_ID,
  fetchNhlGoalieStats,
  formatFantasyPoints,
  formatNhlStat,
  getGoalieScore,
  type NhlGoalieRecord,
} from "../../lib/nhl";
import { fetchPlayerSeasonsBySeason, type PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import NhlPlayerCell from "./NhlPlayerCell";

export default function GoalieStats() {
  const [records, setRecords] = useState<NhlGoalieRecord[]>([]);
  const [fantasySeasons, setFantasySeasons] = useState<Map<string, PlayerSeasonWithRelations>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchNhlGoalieStats()
      .then((data) => {
        if (!active) return;
        setRecords(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load goalie stats");
      })
      .finally(() => { if (active) setLoading(false); });

    fetchPlayerSeasonsBySeason(FANTASY_SEASON_YEAR)
      .then((seasonRows) => {
        if (!active) return;
        setFantasySeasons(new Map(seasonRows.filter((season) => season.player?.player_api_id).map((season) => [season.player!.player_api_id, season])));
      })
      .catch(() => {
        // NHL stats should remain usable when optional fantasy roster metadata fails.
      });
    return () => { active = false; };
  }, []);

  return (
    <div>
      <PageMeta title="Great Lakes Dynasty Hockey League" description="NHL goalie fantasy statistics for GLDHL" />
      <PageBreadcrumb pageTitle="Goalie Stats" />
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="mb-6">
          <h3 className="mb-2 font-semibold text-gray-800 text-theme-xl dark:text-white/90 sm:text-2xl">Goalie Stats</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 sm:text-base">Live NHL regular-season scoring for 2025–26 ({NHL_SEASON_ID}).</p>
        </div>
        {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading goalie stats…</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!loading && !error && <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-white/[0.03]"><tr>
              {['PLAYER','GP','GS','W','L','OTL','GA','SV','SO','PIM','G','A','SV%','GAA','SCORE','FPPG'].map((label) => <th key={label} className="whitespace-nowrap px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {[...records].sort((a, b) => getGoalieScore(b) - getGoalieScore(a)).map((record) => {
                const score = getGoalieScore(record);
                return <tr key={record.playerId} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                  <td className="px-3 py-3"><NhlPlayerCell playerName={record.goalieFullName} teamAbbreviation={record.teamAbbrevs} fantasySeason={fantasySeasons.get(String(record.playerId))} /></td>
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
