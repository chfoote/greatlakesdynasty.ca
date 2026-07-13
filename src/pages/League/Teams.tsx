import { useEffect, useState } from "react";
import { Link } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { fetchFantasyTeams, FantasyTeam } from "../../lib/fantasyTeams";

export default function Teams() {
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchFantasyTeams()
      .then(setTeams)
      .catch((err) => setError(err.message || "Unable to load teams."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageMeta title="Off-Speed | Teams" description="League teams for Off-Speed" />
      <PageBreadcrumb pageTitle="Teams" />

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03] xl:px-8">
        <div className="mb-6">
          <h3 className="font-semibold text-gray-800 text-theme-xl dark:text-white/90">
            League Teams
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Active fantasy teams in the Off-Speed league.
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
                to={`/teams/${team.abbreviation}`}
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

                <div className="mt-4 flex gap-2">
                  <span
                    className="h-6 w-6 rounded-full border border-gray-200 dark:border-gray-700"
                    style={{ backgroundColor: team.primary_color || "#e5e7eb" }}
                    title="Primary color"
                  />
                  <span
                    className="h-6 w-6 rounded-full border border-gray-200 dark:border-gray-700"
                    style={{ backgroundColor: team.secondary_color || "#f9fafb" }}
                    title="Secondary color"
                  />
                </div>

                {(team.al_farm_system || team.nl_farm_system) && (
                  <div className="mt-4 grid gap-2 text-xs text-gray-500 dark:text-gray-400">
                    {team.al_farm_system && <p>AL farm: {team.al_farm_system}</p>}
                    {team.nl_farm_system && <p>NL farm: {team.nl_farm_system}</p>}
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
