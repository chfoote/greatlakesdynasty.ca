import { FormEvent, useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import Input from "../../components/form/input/InputField";
import Label from "../../components/form/Label";
import Checkbox from "../../components/form/input/Checkbox";
import {
  createFantasyTeam,
  deactivateFantasyTeam,
  FantasyTeam,
  FantasyTeamInput,
  fetchFantasyTeams,
  updateFantasyTeam,
  uploadTeamLogo,
} from "../../lib/fantasyTeams";
import { PencilIcon, PlusIcon } from "../../icons";

const emptyForm: FantasyTeamInput = {
  team_name: "",
  abbreviation: "",
  logo: "",
  primary_color: "#1d4ed8",
  secondary_color: "#f97316",
  manager_name: "",
  manager_since: "",
  al_farm_system: "",
  nl_farm_system: "",
  championships: 0,
  runner_up_finishes: 0,
  third_place_finishes: 0,
  active: true,
  notes: "",
};

function normalizeForm(form: FantasyTeamInput): FantasyTeamInput {
  return {
    team_name: form.team_name.trim(),
    abbreviation: form.abbreviation.trim().toUpperCase(),
    logo: form.logo?.trim() || null,
    primary_color: form.primary_color || null,
    secondary_color: form.secondary_color || null,
    manager_name: form.manager_name?.trim() || null,
    manager_since: form.manager_since || null,
    al_farm_system: form.al_farm_system?.trim() || null,
    nl_farm_system: form.nl_farm_system?.trim() || null,
    championships: Number(form.championships) || 0,
    runner_up_finishes: Number(form.runner_up_finishes) || 0,
    third_place_finishes: Number(form.third_place_finishes) || 0,
    active: form.active,
    notes: form.notes?.trim() || null,
  };
}

function toForm(team: FantasyTeam): FantasyTeamInput {
  return {
    team_name: team.team_name,
    abbreviation: team.abbreviation,
    logo: team.logo || "",
    primary_color: team.primary_color || "#1d4ed8",
    secondary_color: team.secondary_color || "#f97316",
    manager_name: team.manager_name || "",
    manager_since: team.manager_since || "",
    al_farm_system: team.al_farm_system || "",
    nl_farm_system: team.nl_farm_system || "",
    championships: team.championships,
    runner_up_finishes: team.runner_up_finishes,
    third_place_finishes: team.third_place_finishes,
    active: team.active,
    notes: team.notes || "",
  };
}

export default function TeamAdmin() {
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [form, setForm] = useState<FantasyTeamInput>(emptyForm);
  const [editingTeam, setEditingTeam] = useState<FantasyTeam | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const activeCount = useMemo(
    () => teams.filter((team) => team.active).length,
    [teams],
  );

  async function loadTeams() {
    setLoading(true);
    setError("");
    try {
      setTeams(await fetchFantasyTeams(true));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load teams.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTeams();
  }, []);

  function updateField<K extends keyof FantasyTeamInput>(
    field: K,
    value: FantasyTeamInput[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingTeam(null);
    setError("");
    setSuccess("");
  }

  async function handleLogoUpload(file: File | undefined) {
    if (!file) return;

    setUploading(true);
    setError("");
    try {
      const logoUrl = await uploadTeamLogo(file);
      updateField("logo", logoUrl);
      setSuccess("Logo uploaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to upload logo.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = normalizeForm(form);
      if (!payload.team_name || !payload.abbreviation) {
        throw new Error("Team name and abbreviation are required.");
      }

      if (editingTeam) {
        await updateFantasyTeam(editingTeam.id, payload);
        setSuccess("Team updated.");
      } else {
        await createFantasyTeam(payload);
        setSuccess("Team added.");
      }

      resetForm();
      await loadTeams();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save team.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(team: FantasyTeam) {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await deactivateFantasyTeam(team.id);
      setSuccess(`${team.team_name} deactivated.`);
      if (editingTeam?.id === team.id) resetForm();
      await loadTeams();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to deactivate team.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageMeta title="Off-Speed | Manage Teams" description="Manage fantasy teams for Off-Speed" />
      <PageBreadcrumb pageTitle="Manage Teams" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold text-gray-800 text-theme-xl dark:text-white/90">
                Fantasy Teams
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {activeCount} active of {teams.length} total
              </p>
            </div>
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-theme-xs hover:bg-brand-600"
            >
              <PlusIcon className="h-4 w-4" />
              New Team
            </button>
          </div>

          {loading ? (
            <div className="rounded-lg border border-dashed border-gray-200 px-5 py-10 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
              Loading teams...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-800">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-3">Team</th>
                    <th className="px-3 py-3">Manager</th>
                    <th className="px-3 py-3">Farm Systems</th>
                    <th className="px-3 py-3">Finishes</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {teams.map((team) => (
                    <tr key={team.id} className="text-sm">
                      <td className="px-3 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800">
                            {team.logo ? (
                              <img
                                src={team.logo}
                                alt={`${team.team_name} logo`}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="text-xs font-semibold text-gray-500">
                                {team.abbreviation}
                              </span>
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-gray-800 dark:text-white/90">
                              {team.team_name}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {team.abbreviation}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-gray-600 dark:text-gray-300">
                        {team.manager_name || "Unassigned"}
                      </td>
                      <td className="px-3 py-4 text-gray-500 dark:text-gray-400">
                        {[team.al_farm_system, team.nl_farm_system].filter(Boolean).join(" / ") || "None"}
                      </td>
                      <td className="px-3 py-4 text-gray-500 dark:text-gray-400">
                        {team.championships} / {team.runner_up_finishes} / {team.third_place_finishes}
                      </td>
                      <td className="px-3 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            team.active
                              ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-400"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          }`}
                        >
                          {team.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTeam(team);
                              setForm(toForm(team));
                              setError("");
                              setSuccess("");
                            }}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03]"
                            title="Edit team"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeactivate(team)}
                            disabled={!team.active || saving}
                            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03]"
                          >
                            Deactivate
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {teams.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                        No teams have been added yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h3 className="font-semibold text-gray-800 text-theme-lg dark:text-white/90">
            {editingTeam ? "Edit Team" : "Add Team"}
          </h3>

          <div className="mt-5 grid gap-4">
            <div>
              <Label htmlFor="team_name">Team Name</Label>
              <Input
                id="team_name"
                value={form.team_name}
                onChange={(event) => updateField("team_name", event.target.value)}
                placeholder="Off-Speed Aces"
              />
            </div>

            <div>
              <Label htmlFor="abbreviation">Abbreviation</Label>
              <Input
                id="abbreviation"
                value={form.abbreviation}
                onChange={(event) => updateField("abbreviation", event.target.value)}
                placeholder="OSA"
              />
            </div>

            <div>
              <Label htmlFor="logo">Logo URL</Label>
              <Input
                id="logo"
                value={form.logo || ""}
                onChange={(event) => updateField("logo", event.target.value)}
                placeholder="https://..."
              />
              <input
                type="file"
                accept="image/*"
                onChange={(event) => handleLogoUpload(event.target.files?.[0])}
                className="mt-3 block w-full text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200 dark:text-gray-400 dark:file:bg-gray-800 dark:file:text-gray-300"
              />
              {uploading && <p className="mt-2 text-xs text-gray-500">Uploading logo...</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="primary_color">Primary</Label>
                <input
                  id="primary_color"
                  type="color"
                  value={form.primary_color || "#1d4ed8"}
                  onChange={(event) => updateField("primary_color", event.target.value)}
                  className="h-11 w-full cursor-pointer rounded-lg border border-gray-300 bg-transparent p-1 dark:border-gray-700"
                />
              </div>
              <div>
                <Label htmlFor="secondary_color">Secondary</Label>
                <input
                  id="secondary_color"
                  type="color"
                  value={form.secondary_color || "#f97316"}
                  onChange={(event) => updateField("secondary_color", event.target.value)}
                  className="h-11 w-full cursor-pointer rounded-lg border border-gray-300 bg-transparent p-1 dark:border-gray-700"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="manager_name">Manager</Label>
              <Input
                id="manager_name"
                value={form.manager_name || ""}
                onChange={(event) => updateField("manager_name", event.target.value)}
                placeholder="Manager name"
              />
            </div>

            <div>
              <Label htmlFor="manager_since">Manager Since</Label>
              <Input
                id="manager_since"
                type="date"
                value={form.manager_since || ""}
                onChange={(event) => updateField("manager_since", event.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="al_farm_system">AL Farm System</Label>
              <Input
                id="al_farm_system"
                value={form.al_farm_system || ""}
                onChange={(event) => updateField("al_farm_system", event.target.value)}
                placeholder="Toronto Blue Jays"
              />
            </div>

            <div>
              <Label htmlFor="nl_farm_system">NL Farm System</Label>
              <Input
                id="nl_farm_system"
                value={form.nl_farm_system || ""}
                onChange={(event) => updateField("nl_farm_system", event.target.value)}
                placeholder="New York Mets"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="championships">Titles</Label>
                <Input
                  id="championships"
                  type="number"
                  min="0"
                  step={1}
                  value={form.championships}
                  onChange={(event) => updateField("championships", Number(event.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="runner_up_finishes">Runner-Up</Label>
                <Input
                  id="runner_up_finishes"
                  type="number"
                  min="0"
                  step={1}
                  value={form.runner_up_finishes}
                  onChange={(event) => updateField("runner_up_finishes", Number(event.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="third_place_finishes">Third</Label>
                <Input
                  id="third_place_finishes"
                  type="number"
                  min="0"
                  step={1}
                  value={form.third_place_finishes}
                  onChange={(event) => updateField("third_place_finishes", Number(event.target.value))}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                value={form.notes || ""}
                onChange={(event) => updateField("notes", event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              />
            </div>

            <Checkbox
              label="Active"
              checked={form.active}
              onChange={(checked) => updateField("active", checked)}
            />
          </div>

          {error && (
            <p className="mt-4 rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400">
              {error}
            </p>
          )}
          {success && (
            <p className="mt-4 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400">
              {success}
            </p>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="submit"
              disabled={saving || uploading}
              className="inline-flex flex-1 items-center justify-center rounded-lg bg-brand-500 px-4 py-3 text-sm font-medium text-white shadow-theme-xs hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Team"}
            </button>
            {editingTeam && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/[0.03]"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
