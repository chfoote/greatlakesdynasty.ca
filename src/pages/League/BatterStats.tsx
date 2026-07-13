import { useEffect, useState } from "react";
import { Link } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { fetchMlbStats, formatStatValue, type MlbStatRecord } from "../../lib/mlb";
import {
  fetchPlayerSeasonsBySeason,
  type PlayerSeasonWithRelations,
} from "../../lib/fantasyPlayers";

const SEASON_YEAR = 2026;

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function getBatterScore(record: MlbStatRecord) {
  return (
    Number(record.stats.runs ?? 0) * 1 +
    Number(record.stats.hits ?? 0) * 1 +
    Number(record.stats.doubles ?? 0) * 1 +
    Number(record.stats.triples ?? 0) * 2 +
    Number(record.stats.homeRuns ?? 0) * 3 +
    Number(record.stats.rbi ?? 0) * 1 +
    Number(record.stats.stolenBases ?? 0) * 2
  );
}

function getBatterPpg(record: MlbStatRecord) {
  const gamesPlayed = Number(record.stats.gamesPlayed ?? 0);
  const score = getBatterScore(record);

  if (!gamesPlayed) {
    return null;
  }

  return score / gamesPlayed;
}

function formatSalary(salary: number | null | undefined) {
  return salary === null || salary === undefined
    ? "No salary"
    : currencyFormatter.format(salary);
}

function PlayerCell({
  record,
  fantasySeason,
}: {
  record: MlbStatRecord;
  fantasySeason?: PlayerSeasonWithRelations;
}) {
  const name = record.playerId ? (
    <Link
      to={`/player-profile?playerId=${record.playerId}`}
      className="font-medium text-brand-500 transition hover:text-brand-600 hover:underline"
    >
      {record.playerName}
    </Link>
  ) : (
    <span className="font-medium text-gray-800 dark:text-white/90">
      {record.playerName}
    </span>
  );

  return (
    <div className="flex min-w-44 items-center gap-2">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
        {fantasySeason?.fantasy_team?.logo ? (
          <img
            src={fantasySeason.fantasy_team.logo}
            alt={`${fantasySeason.fantasy_team.team_name} logo`}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-[10px] font-semibold text-gray-500">
            {fantasySeason?.fantasy_team?.abbreviation || "FA"}
          </span>
        )}
      </div>
      <div className="text-left">
        {name}
        <p className="mt-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">
          {[
            record.teamAbbreviation,
            formatSalary(fantasySeason?.salary),
            fantasySeason?.term_end_year,
          ]
            .filter(Boolean)
            .join(" | ")}
        </p>
      </div>
    </div>
  );
}

export default function BatterStats() {
  const [records, setRecords] = useState<MlbStatRecord[]>([]);
  const [fantasySeasons, setFantasySeasons] = useState<
    Map<string, PlayerSeasonWithRelations>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        const [data, seasonRows] = await Promise.all([
          fetchMlbStats("hitting", SEASON_YEAR),
          fetchPlayerSeasonsBySeason(SEASON_YEAR),
        ]);
        if (active) {
          setRecords(data);
          setFantasySeasons(
            new Map(
              seasonRows
                .filter((season) => season.player?.player_api_id)
                .map((season) => [season.player!.player_api_id, season]),
            ),
          );
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Unable to load batter stats");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <PageMeta title="Off-Speed | Batter Stats" description="Batter statistics for Off-Speed" />
      <PageBreadcrumb pageTitle="Batter Stats" />
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="mb-6">
          <h3 className="mb-2 font-semibold text-gray-800 text-theme-xl dark:text-white/90 sm:text-2xl">
            Batter Stats
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 sm:text-base">
            Live MLB hitting data from the official stats API.
          </p>
        </div>

        {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading batter stats…</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-white/[0.03]">
                <tr>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">PLAYER</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">POSITION</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">G</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">AB</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">R</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">H</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">2B</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">3B</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">HR</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">RBI</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">BB</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">SO</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">SB</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">SCORE</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-200">PPG</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {[...records]
                  .sort((a, b) => getBatterScore(b) - getBatterScore(a))
                  .map((record) => (
                  <tr key={`${record.playerName}-${record.teamName}`} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                    <td className="px-3 py-3">
                      <PlayerCell
                        record={record}
                        fantasySeason={
                          record.playerId
                            ? fantasySeasons.get(String(record.playerId))
                            : undefined
                        }
                      />
                    </td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{record.position}</td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{formatStatValue(record.stats.gamesPlayed)}</td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{formatStatValue(record.stats.atBats)}</td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{formatStatValue(record.stats.runs)}</td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{formatStatValue(record.stats.hits)}</td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{formatStatValue(record.stats.doubles)}</td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{formatStatValue(record.stats.triples)}</td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{formatStatValue(record.stats.homeRuns)}</td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{formatStatValue(record.stats.rbi)}</td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{formatStatValue(record.stats.baseOnBalls)}</td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{formatStatValue(record.stats.strikeOuts)}</td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">{formatStatValue(record.stats.stolenBases)}</td>
                    <td className="px-3 py-3 text-center font-semibold text-gray-800 dark:text-white/90">{getBatterScore(record)}</td>
                    <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-300">
                      {getBatterPpg(record) === null ? "—" : getBatterPpg(record)!.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
