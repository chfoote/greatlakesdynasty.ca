import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import {
  fetchMlbPlayerProfile,
  formatStatValue,
  type MlbPlayerProfile,
} from "../../lib/mlb";

function getBatterScore(stats: Record<string, string | number | null> | null | undefined) {
  if (!stats) return 0;

  return (
    Number(stats.runs ?? 0) * 1 +
    Number(stats.hits ?? 0) * 1 +
    Number(stats.doubles ?? 0) * 1 +
    Number(stats.triples ?? 0) * 2 +
    Number(stats.homeRuns ?? 0) * 3 +
    Number(stats.rbi ?? 0) * 1 +
    Number(stats.stolenBases ?? 0) * 2
  );
}

function getPitcherScore(stats: Record<string, string | number | null> | null | undefined) {
  if (!stats) return 0;

  return (
    Number(stats.wins ?? 0) * 8 +
    Number(stats.strikeOuts ?? 0) * 1 +
    Number(stats.saves ?? 0) * 6 +
    Number(stats.completeGames ?? 0) * 5 +
    Number(stats.shutouts ?? 0) * 5
  );
}

function getBatterPpg(stats: Record<string, string | number | null> | null | undefined) {
  if (!stats) return null;

  const gamesPlayed = Number(stats.gamesPlayed ?? 0);
  const score = getBatterScore(stats);

  if (!gamesPlayed) {
    return null;
  }

  return score / gamesPlayed;
}

function getPitcherPpg(stats: Record<string, string | number | null> | null | undefined) {
  if (!stats) return null;

  const gamesPlayed = Number(stats.gamesPlayed ?? 0);
  const score = getPitcherScore(stats);

  if (!gamesPlayed) {
    return null;
  }

  return score / gamesPlayed;
}

function ProfileStatTable({
  title,
  stats,
  type,
}: {
  title: string;
  stats: Record<string, string | number | null> | null | undefined;
  type: "batter" | "pitcher";
}) {
  if (!stats) {
    return null;
  }

  const score = type === "batter" ? getBatterScore(stats) : getPitcherScore(stats);
  const ppg = type === "batter" ? getBatterPpg(stats) : getPitcherPpg(stats);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div className="border-b border-gray-100 px-5 py-3 dark:border-white/[0.05]">
        <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">{title}</h4>
      </div>
      <div className="max-w-full overflow-x-auto">
        <Table>
          <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
            <TableRow>
              {type === "batter" ? (
                <>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">G</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">AB</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">R</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">H</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">2B</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">3B</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">HR</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">RBI</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">BB</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">SO</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">SB</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">SCORE</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">PPG</TableCell>
                </>
              ) : (
                <>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">G</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">GS</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">IP</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">W</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">L</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">SV</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">H</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">ER</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">HR</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">BB</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">SO</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">C</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">SHO</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">SCORE</TableCell>
                  <TableCell isHeader className="px-3 py-3 text-center font-medium text-gray-500 text-theme-xs dark:text-gray-400">PPG</TableCell>
                </>
              )}
            </TableRow>
          </TableHeader>

          <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
            <TableRow>
              {type === "batter" ? (
                <>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.gamesPlayed)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.atBats)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.runs)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.hits)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.doubles)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.triples)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.homeRuns)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.rbi)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.baseOnBalls)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.strikeOuts)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.stolenBases)}</TableCell>
                  <TableCell className="px-3 py-4 text-center font-medium text-gray-800 text-theme-sm dark:text-white/90">{score}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{ppg === null ? "—" : ppg.toFixed(2)}</TableCell>
                </>
              ) : (
                <>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.gamesPlayed)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.gamesStarted)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.inningsPitched)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.wins)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.losses)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.saves)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.hits)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.earnedRuns)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.homeRuns)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.baseOnBalls)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.strikeOuts)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.completeGames)}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{formatStatValue(stats.shutouts)}</TableCell>
                  <TableCell className="px-3 py-4 text-center font-medium text-gray-800 text-theme-sm dark:text-white/90">{score}</TableCell>
                  <TableCell className="px-3 py-4 text-center text-gray-500 text-theme-sm dark:text-gray-400">{ppg === null ? "—" : ppg.toFixed(2)}</TableCell>
                </>
              )}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function PlayerProfile() {
  const location = useLocation();
  const playerIdParam = new URLSearchParams(location.search).get("playerId");
  const [profile, setProfile] = useState<MlbPlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = Number(playerIdParam);

    if (!playerIdParam || Number.isNaN(id)) {
      setError("No player ID was provided.");
      setLoading(false);
      return;
    }

    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchMlbPlayerProfile(id);
        if (active) {
          setProfile(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Unable to load player profile");
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
  }, [playerIdParam]);

  const hasHitting = Boolean(profile?.hittingStats && Object.keys(profile.hittingStats).length);
  const hasPitching = Boolean(profile?.pitchingStats && Object.keys(profile.pitchingStats).length);
  const isTwoWay = profile?.position === "TWP" || profile?.primaryPosition?.toLowerCase().includes("two-way");

  return (
    <div>
      <PageMeta title="Off-Speed | Player Profile" description="Player profile for Off-Speed" />
      <PageBreadcrumb pageTitle="Player Profile" />
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="mb-6">
          <h3 className="mb-2 font-semibold text-gray-800 text-theme-xl dark:text-white/90 sm:text-2xl">
            Player Profile
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 sm:text-base">
            Current season details for the selected player.
          </p>
        </div>

        {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading player profile…</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}

        {!loading && !error && profile && (
          <>
            <div className="mb-8 rounded-2xl border border-gray-200 bg-gray-50 p-6 dark:border-gray-800 dark:bg-white/[0.03]">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-20 w-20 overflow-hidden rounded-full border border-gray-200 bg-white p-1 dark:border-gray-700">
                    <img
                      src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_180,q_auto:good/v1/people/${profile.playerId}/headshot/67/current`}
                      alt={`${profile.playerName} headshot`}
                      className="h-full w-full rounded-full object-cover"
                    />
                  </div>
                  <div>
                    <h4 className="text-2xl font-semibold text-gray-900 dark:text-white">{profile.playerName}</h4>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                      {profile.teamLogoUrl ? (
                        <img src={profile.teamLogoUrl} alt={`${profile.teamName} logo`} className="h-5 w-5 object-contain" />
                      ) : null}
                      <span>{profile.teamAbbreviation}</span>
                      <span>•</span>
                      <span>{profile.position}</span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900/60">
                    <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Height</p>
                    <p className="mt-1 text-sm font-medium text-gray-800 dark:text-white/90">{profile.height ?? "—"}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900/60">
                    <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Weight</p>
                    <p className="mt-1 text-sm font-medium text-gray-800 dark:text-white/90">{profile.weight ? `${profile.weight} lb` : "—"}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900/60">
                    <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">From</p>
                    <p className="mt-1 text-sm font-medium text-gray-800 dark:text-white/90">
                      {profile.birthCity && profile.birthCountry
                        ? `${profile.birthCity}, ${profile.birthCountry}`
                        : profile.birthCity ?? profile.birthCountry ?? "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900/60">
                    <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Hands</p>
                    <p className="mt-1 text-sm font-medium text-gray-800 dark:text-white/90">
                      {profile.batSide && profile.pitchHand
                        ? `Bat: ${profile.batSide} • Throw: ${profile.pitchHand}`
                        : profile.batSide ?? profile.pitchHand ?? "—"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900/60">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Draft</p>
                  <p className="mt-1 text-sm font-medium text-gray-800 dark:text-white/90">
                    {profile.draftYear || profile.draftRound || profile.draftPick || profile.draftTeam
                      ? [
                          profile.draftYear ? `${profile.draftYear}` : null,
                          profile.draftRound ? `Round ${profile.draftRound}` : null,
                          profile.draftPick ? `Pick ${profile.draftPick}` : null,
                          profile.draftTeam ? `${profile.draftTeam}` : null,
                        ]
                          .filter(Boolean)
                          .join(" • ")
                      : "Not Drafted"}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900/60">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Birthday</p>
                  <p className="mt-1 text-sm font-medium text-gray-800 dark:text-white/90">
                    {profile.birthDate ? `${profile.birthDate} (${profile.currentAge})` : "—"}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-8">
              {hasHitting && (
                <ProfileStatTable title="Batter Stats" stats={profile.hittingStats} type="batter" />
              )}
              {hasPitching && (
                <ProfileStatTable title="Pitcher Stats" stats={profile.pitchingStats} type="pitcher" />
              )}
              {!hasHitting && !hasPitching && (
                <div className="rounded-xl border border-dashed border-gray-300 p-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  No current-season stats were returned for this player.
                </div>
              )}
              {isTwoWay && hasHitting && hasPitching && (
                <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-700 dark:border-brand-900/60 dark:bg-brand-500/10 dark:text-brand-300">
                  This player is listed as a two-way player, so both batting and pitching stat sections are shown.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
