import { useEffect, useState } from "react";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { useAuth } from "../../context/AuthContext";
import { fetchFantasyTeams, type FantasyTeam } from "../../lib/fantasyTeams";
import {
  fetchProfiles,
  updateProfileDisplayName,
  upsertProfile,
  type Profile,
} from "../../lib/profiles";
import {
  deleteTeamUserAssignment,
  fetchTeamUserAssignments,
  upsertTeamUserAssignment,
  type TeamUserAssignmentWithTeam,
} from "../../lib/teamUserAssignments";

const seasonOptions = Array.from({ length: 10 }, (_, index) => 2026 + index);

function getProfileLabel(profile: Profile) {
  return profile.display_name || profile.email || profile.id;
}

function getAssignmentUserLabel(assignment: TeamUserAssignmentWithTeam) {
  return (
    assignment.profile?.display_name ||
    assignment.profile?.email ||
    assignment.user_email ||
    assignment.user_id
  );
}

export default function AuctionAdmin() {
  const { user } = useAuth();
  const [selectedSeason, setSelectedSeason] = useState(2027);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [assignments, setAssignments] = useState<TeamUserAssignmentWithTeam[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedDisplayProfileId, setSelectedDisplayProfileId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [editingAssignmentId, setEditingAssignmentId] = useState<number | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [deletingAssignmentId, setDeletingAssignmentId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [profileRows, teamRows, assignmentRows] = await Promise.all([
        fetchProfiles(),
        fetchFantasyTeams(),
        fetchTeamUserAssignments(selectedSeason),
      ]);
      setProfiles(profileRows);
      setTeams(teamRows);
      setAssignments(assignmentRows);
      setEditingAssignmentId(null);
      setSelectedProfileId("");
      setSelectedTeamId("");

      if (user && !profileRows.some((profile) => profile.id === user.id)) {
        const currentProfile = await upsertProfile({
          userId: user.id,
          email: user.email || null,
          displayName: null,
        });
        setProfiles([currentProfile, ...profileRows]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load auction admin data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeason]);

  useEffect(() => {
    if (selectedDisplayProfileId) return;

    const currentProfile =
      profiles.find((profile) => profile.id === user?.id) || profiles[0];

    if (currentProfile) {
      setSelectedDisplayProfileId(currentProfile.id);
      setDisplayName(currentProfile.display_name || "");
    }
  }, [profiles, selectedDisplayProfileId, user]);

  async function handleSaveDisplayName() {
    const selectedProfile = profiles.find(
      (profile) => profile.id === selectedDisplayProfileId,
    );
    if (!selectedProfile) return;

    setSavingProfile(true);
    setError("");
    setSuccess("");

    try {
      const nextProfile = await updateProfileDisplayName({
        userId: selectedProfile.id,
        displayName: displayName.trim() || null,
      });
      setProfiles((current) =>
        current.map((profile) =>
          profile.id === nextProfile.id ? nextProfile : profile,
        ),
      );
      setAssignments((current) =>
        current.map((assignment) =>
          assignment.user_id === nextProfile.id
            ? { ...assignment, profile: nextProfile }
            : assignment,
        ),
      );
      setSuccess("Display name saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save display name.");
    } finally {
      setSavingProfile(false);
    }
  }

  function handleSelectDisplayProfile(profileId: string) {
    const selectedProfile = profiles.find((profile) => profile.id === profileId);
    setSelectedDisplayProfileId(profileId);
    setDisplayName(selectedProfile?.display_name || "");
    setError("");
    setSuccess("");
  }

  async function handleSaveAssignment() {
    const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
    if (!selectedProfile || !selectedTeamId) return;

    setSavingAssignment(true);
    setError("");
    setSuccess("");

    try {
      const nextAssignment = await upsertTeamUserAssignment({
        userId: selectedProfile.id,
        userEmail: selectedProfile.email,
        fantasyTeamId: Number(selectedTeamId),
        seasonYear: selectedSeason,
      });
      setAssignments((current) => [
        { ...nextAssignment, profile: selectedProfile },
        ...current.filter((assignment) => assignment.id !== nextAssignment.id),
      ]);
      setSuccess("Team assignment saved.");
      setEditingAssignmentId(null);
      setSelectedProfileId("");
      setSelectedTeamId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save team assignment.");
    } finally {
      setSavingAssignment(false);
    }
  }

  function handleEditAssignment(assignment: TeamUserAssignmentWithTeam) {
    setEditingAssignmentId(assignment.id);
    setSelectedProfileId(assignment.user_id);
    setSelectedTeamId(String(assignment.fantasy_team_id));
    setError("");
    setSuccess("");
  }

  function handleClearAssignmentForm() {
    setEditingAssignmentId(null);
    setSelectedProfileId("");
    setSelectedTeamId("");
    setError("");
    setSuccess("");
  }

  async function handleDeleteAssignment(assignment: TeamUserAssignmentWithTeam) {
    const userLabel = getAssignmentUserLabel(assignment);
    const teamLabel = assignment.fantasy_team?.team_name || "this team";
    const confirmed = window.confirm(
      `Remove ${userLabel}'s access to ${teamLabel} for ${assignment.season_year}?`,
    );

    if (!confirmed) return;

    setDeletingAssignmentId(assignment.id);
    setError("");
    setSuccess("");

    try {
      await deleteTeamUserAssignment(assignment.id);
      setAssignments((current) =>
        current.filter((row) => row.id !== assignment.id),
      );

      if (editingAssignmentId === assignment.id) {
        handleClearAssignmentForm();
      }

      setSuccess("Team assignment removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove team assignment.");
    } finally {
      setDeletingAssignmentId(null);
    }
  }

  return (
    <>
      <PageMeta
        title="Great Lakes Dynasty Hockey League"
        description="Manage GLDHL auction users and team assignments"
      />
      <PageBreadcrumb pageTitle="Auction Admin" />

      <div className="space-y-6">
        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                Auction Admin
              </p>
              <h1 className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
                Users and Team Assignments
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Assign league users to fantasy teams by auction season.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Season
              </label>
              <select
                value={selectedSeason}
                onChange={(event) => setSelectedSeason(Number(event.target.value))}
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 sm:w-36"
              >
                {seasonOptions.map((season) => (
                  <option key={season} value={season}>
                    {season}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading && (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              Loading auction admin data...
            </p>
          )}
          {error && (
            <div className="mt-4 rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
              {error}
            </div>
          )}
          {success && (
            <div className="mt-4 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300">
              {success}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
              Display Names
            </p>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Edit user display names
            </h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                  User
                </label>
                <select
                  value={selectedDisplayProfileId}
                  onChange={(event) => handleSelectDisplayProfile(event.target.value)}
                  className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                >
                  <option value="">Choose a user</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.email || profile.id}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                  Display Name
                </label>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Charles F."
                  className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveDisplayName}
              disabled={savingProfile || !selectedDisplayProfileId}
              className="h-11 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingProfile ? "Saving..." : "Save Display Name"}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
              {editingAssignmentId ? "Edit Assignment" : "Create Assignment"}
            </p>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {editingAssignmentId
                ? "Change this user's fantasy team"
                : "Assign a user to a fantasy team"}
            </h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                  User
                </label>
                <select
                  value={selectedProfileId}
                  onChange={(event) => setSelectedProfileId(event.target.value)}
                  disabled={editingAssignmentId !== null}
                  className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                >
                  <option value="">Choose a user</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {getProfileLabel(profile)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                  Fantasy Team
                </label>
                <select
                  value={selectedTeamId}
                  onChange={(event) => setSelectedTeamId(event.target.value)}
                  className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                >
                  <option value="">Choose a team</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.team_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
              <button
                type="button"
                onClick={handleSaveAssignment}
                disabled={!selectedProfileId || !selectedTeamId || savingAssignment}
                className="h-11 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingAssignment
                  ? "Saving..."
                  : editingAssignmentId
                  ? "Update Assignment"
                  : "Save Assignment"}
              </button>
              {editingAssignmentId && (
                <button
                  type="button"
                  onClick={handleClearAssignmentForm}
                  className="h-11 rounded-lg border border-gray-200 px-4 text-sm font-semibold text-gray-700 transition hover:border-brand-300 hover:text-brand-600 dark:border-gray-800 dark:text-gray-300"
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                User Team Assignments
              </p>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {selectedSeason} Auction Access
              </h2>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {assignments.length} Assigned
            </span>
          </div>

          {assignments.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              No users are assigned to teams for this season yet.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-gray-800">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                    <th className="px-3 py-3">User</th>
                    <th className="px-3 py-3">Email</th>
                    <th className="px-3 py-3">Team</th>
                    <th className="px-3 py-3">Role</th>
                    <th className="px-3 py-3">Season</th>
                    <th className="px-3 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {assignments.map((assignment) => (
                    <tr key={assignment.id} className="text-gray-700 dark:text-gray-300">
                      <td className="px-3 py-3 font-medium text-gray-900 dark:text-white">
                        {getAssignmentUserLabel(assignment)}
                      </td>
                      <td className="px-3 py-3">
                        {assignment.profile?.email || assignment.user_email || "Not set"}
                      </td>
                      <td className="px-3 py-3">
                        {assignment.fantasy_team?.team_name || "Unknown team"}
                      </td>
                      <td className="px-3 py-3 capitalize">
                        {assignment.role.replace("_", " ")}
                      </td>
                      <td className="px-3 py-3">{assignment.season_year}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditAssignment(assignment)}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-brand-300 hover:text-brand-600 dark:border-gray-800 dark:text-gray-300"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAssignment(assignment)}
                            disabled={deletingAssignmentId === assignment.id}
                            className="rounded-lg border border-error-200 px-3 py-1.5 text-xs font-semibold text-error-600 transition hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-error-500/30 dark:text-error-300 dark:hover:bg-error-500/10"
                          >
                            {deletingAssignmentId === assignment.id
                              ? "Removing..."
                              : "Unassign"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
