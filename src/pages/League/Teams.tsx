import { useEffect, useState } from "react";
import { Link } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { applyTeamBranding, fetchFantasyTeams, fetchTeamBrandingHistory, FantasyTeam } from "../../lib/fantasyTeams";
import { CURRENT_LEAGUE_SEASON } from "../../lib/leagueSeasons";

export default function Teams() {
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([fetchFantasyTeams(), fetchTeamBrandingHistory()])
      .then(([teamRows, branding]) => setTeams(teamRows.map((team) => applyTeamBranding(team, branding, CURRENT_LEAGUE_SEASON))))
      .catch((err) => setError(err.message || "Unable to load teams."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageMeta title="Great Lakes Dynasty Hockey League" description="Great Lakes Dynasty Hockey League teams" />
      <PageBreadcrumb pageTitle="Teams" />

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03] xl:px-8">
        <div className="mb-6">
          <h3 className="font-semibold text-gray-800 text-theme-xl dark:text-white/90">
            League Teams
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Active fantasy teams in the Great Lakes Dynasty Hockey League.
          </p>
        </div>

        {loading && (
          <div className="rounded-lg border border-dashed border-gray-200 px-5 py-10 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            Loading teams...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400">
            {error}
          </div>
        )}

        {!loading && !error && teams.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-200 px-5 py-10 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            No active teams have been added yet.
          </div>
        )}

        {!loading && !error && teams.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {teams.map((team) => (
              <Link
                key={team.id}
                to={`/teams/${team.id}`}
                className="rounded-lg border border-gray-200 bg-white p-5 shadow-theme-xs transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-theme-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-brand-500"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800">
                    {team.logo ? (
                      <img
                        src={team.logo}
                        alt={`${team.team_name} logo`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                        {team.abbreviation}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h4 className="truncate font-semibold text-gray-800 dark:text-white/90">
                      {team.team_name}
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {team.abbreviation}
                    </p>
                    {team.manager_name && (
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                        Manager: {team.manager_name}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2" aria-label="League finishes">
                  <div className="rounded-lg bg-amber-50 px-2 py-2 text-center dark:bg-amber-500/10">
                    <span className="block text-lg" aria-hidden="true">🥇</span>
                    <span className="block text-sm font-semibold text-amber-700 dark:text-amber-300">
                      {team.championships}
                    </span>
                  </div>
                  <div className="rounded-lg bg-gray-100 px-2 py-2 text-center dark:bg-gray-500/10">
                    <span className="block text-lg" aria-hidden="true">🥈</span>
                    <span className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {team.runner_up_finishes}
                    </span>
                  </div>
                  <div className="rounded-lg bg-orange-50 px-2 py-2 text-center dark:bg-orange-500/10">
                    <span className="block text-lg" aria-hidden="true">🥉</span>
                    <span className="block text-sm font-semibold text-orange-700 dark:text-orange-300">
                      {team.third_place_finishes}
                    </span>
                  </div>
                </div>

                {(team.eastern_farm_system || team.western_farm_system) && (
                  <div className="mt-4 grid gap-2 text-xs text-gray-500 dark:text-gray-400">
                    {team.eastern_farm_system && <p>Eastern farm: {team.eastern_farm_system}</p>}
                    {team.western_farm_system && <p>Western farm: {team.western_farm_system}</p>}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
