import { FormEvent, useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import Input from "../../components/form/input/InputField";
import Label from "../../components/form/Label";
import Checkbox from "../../components/form/input/Checkbox";
import { fetchFantasyTeams, type FantasyTeam } from "../../lib/fantasyTeams";
import {
  createFantasyPlayer,
  createPlayerSeason,
  deleteFantasyPlayer,
  deletePlayerSeason,
  FantasyPlayer,
  FantasyPlayerInput,
  fetchFantasyPlayers,
  fetchPlayerSeasons,
  PlayerSeasonInput,
  PlayerSeasonWithRelations,
  updateFantasyPlayer,
  updatePlayerSeason,
} from "../../lib/fantasyPlayers";
import { PencilIcon, PlusIcon, TrashBinIcon } from "../../icons";

const currentYear = new Date().getFullYear();

const emptyPlayerForm: FantasyPlayerInput = {
  player_api_id: "",
  first_name: "",
  last_name: "",
  full_name: "",
  on_trade_block: false,
  notes: "",
};

type SeasonForm = {
  player_id: string;
  season_year: string;
  fantasy_team_id: string;
  salary: string;
  position: string;
  term_end_year: string;
  contract_group: string;
  notes: string;
};

const emptySeasonForm: SeasonForm = {
  player_id: "",
  season_year: String(currentYear),
  fantasy_team_id: "",
  salary: "",
  position: "",
  term_end_year: "",
  contract_group: "",
  notes: "",
};

function normalizePlayerForm(form: FantasyPlayerInput): FantasyPlayerInput {
  const firstName = form.first_name?.trim() || null;
  const lastName = form.last_name?.trim() || null;
  const fullName =
    form.full_name?.trim() || [firstName, lastName].filter(Boolean).join(" ") || null;

  return {
    player_api_id: form.player_api_id.trim(),
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    on_trade_block: form.on_trade_block,
    notes: form.notes?.trim() || null,
  };
}

function normalizeSeasonForm(form: SeasonForm): PlayerSeasonInput {
  return {
    player_id: Number(form.player_id),
    season_year: Number(form.season_year),
    fantasy_team_id: form.fantasy_team_id ? Number(form.fantasy_team_id) : null,
    salary: form.salary ? Number(form.salary) : null,
    position: form.position.trim() || null,
    term_end_year: form.term_end_year ? Number(form.term_end_year) : null,
    contract_group: form.contract_group.trim() || null,
    notes: form.notes.trim() || null,
  };
}

function playerName(player: FantasyPlayer | null) {
  return player?.full_name || [player?.first_name, player?.last_name].filter(Boolean).join(" ") || "Unnamed Player";
}

export default function PlayerAdmin() {
  const [players, setPlayers] = useState<FantasyPlayer[]>([]);
  const [seasons, setSeasons] = useState<PlayerSeasonWithRelations[]>([]);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [playerForm, setPlayerForm] = useState<FantasyPlayerInput>(emptyPlayerForm);
  const [seasonForm, setSeasonForm] = useState<SeasonForm>(emptySeasonForm);
  const [editingPlayer, setEditingPlayer] = useState<FantasyPlayer | null>(null);
  const [editingSeason, setEditingSeason] = useState<PlayerSeasonWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const tradeBlockCount = useMemo(
    () => players.filter((player) => player.on_trade_block).length,
    [players],
  );

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [playerRows, seasonRows, teamRows] = await Promise.all([
        fetchFantasyPlayers(),
        fetchPlayerSeasons(),
        fetchFantasyTeams(true),
      ]);
      setPlayers(playerRows);
      setSeasons(seasonRows);
      setTeams(teamRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load player data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function resetPlayerForm() {
    setPlayerForm(emptyPlayerForm);
    setEditingPlayer(null);
    setError("");
    setSuccess("");
  }

  function resetSeasonForm() {
    setSeasonForm(emptySeasonForm);
    setEditingSeason(null);
    setError("");
    setSuccess("");
  }

  async function handlePlayerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = normalizePlayerForm(playerForm);
      if (!payload.player_api_id) throw new Error("API player ID is required.");

      if (editingPlayer) {
        await updateFantasyPlayer(editingPlayer.id, payload);
        setSuccess("Player updated.");
      } else {
        await createFantasyPlayer(payload);
        setSuccess("Player added.");
      }

      resetPlayerForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save player.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSeasonSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = normalizeSeasonForm(seasonForm);
      if (!payload.player_id || !payload.season_year) {
        throw new Error("Player and season year are required.");
      }

      if (editingSeason) {
        await updatePlayerSeason(editingSeason.id, payload);
        setSuccess("Player season updated.");
      } else {
        await createPlayerSeason(payload);
        setSuccess("Player season added.");
      }

      resetSeasonForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save player season.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePlayer(player: FantasyPlayer) {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await deleteFantasyPlayer(player.id);
      setSuccess("Player deleted.");
      if (editingPlayer?.id === player.id) resetPlayerForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete player.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSeason(season: PlayerSeasonWithRelations) {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await deletePlayerSeason(season.id);
      setSuccess("Player season deleted.");
      if (editingSeason?.id === season.id) resetSeasonForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete player season.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageMeta title="Off-Speed | Manage Players" description="Manage fantasy players and seasons for Off-Speed" />
      <PageBreadcrumb pageTitle="Manage Players" />

      {error && (
        <p className="mb-5 rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </p>
      )}
      {success && (
        <p className="mb-5 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400">
          {success}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-gray-800 text-theme-xl dark:text-white/90">
                  Players
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {players.length} tracked, {tradeBlockCount} on the trade block
                </p>
              </div>
              <button
                type="button"
                onClick={resetPlayerForm}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-theme-xs hover:bg-brand-600"
              >
                <PlusIcon className="h-4 w-4" />
                New Player
              </button>
            </div>

            {loading ? (
              <div className="rounded-lg border border-dashed border-gray-200 px-5 py-10 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                Loading players...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-800">
                  <thead>
                    <tr className="text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                      <th className="px-3 py-3">Player</th>
                      <th className="px-3 py-3">API ID</th>
                      <th className="px-3 py-3">Trade Block</th>
                      <th className="px-3 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {players.map((player) => (
                      <tr key={player.id} className="text-sm">
                        <td className="px-3 py-4">
                          <p className="font-medium text-gray-800 dark:text-white/90">
                            {playerName(player)}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {[player.first_name, player.last_name].filter(Boolean).join(" ")}
                          </p>
                        </td>
                        <td className="px-3 py-4 text-gray-500 dark:text-gray-400">
                          {player.player_api_id}
                        </td>
                        <td className="px-3 py-4">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              player.on_trade_block
                                ? "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-400"
                                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                            }`}
                          >
                            {player.on_trade_block ? "Yes" : "No"}
                          </span>
                        </td>
                        <td className="px-3 py-4">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPlayer(player);
                                setPlayerForm({
                                  player_api_id: player.player_api_id,
                                  first_name: player.first_name || "",
                                  last_name: player.last_name || "",
                                  full_name: player.full_name || "",
                                  on_trade_block: player.on_trade_block,
                                  notes: player.notes || "",
                                });
                              }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03]"
                              title="Edit player"
                            >
                              <PencilIcon className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePlayer(player)}
                              disabled={saving}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03]"
                              title="Delete player"
                            >
                              <TrashBinIcon className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {players.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                          No players have been added yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-gray-800 text-theme-xl dark:text-white/90">
                  Player Seasons
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  One row per player per season.
                </p>
              </div>
              <button
                type="button"
                onClick={resetSeasonForm}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-theme-xs hover:bg-brand-600"
              >
                <PlusIcon className="h-4 w-4" />
                New Season
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-800">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-3">Player</th>
                    <th className="px-3 py-3">Season</th>
                    <th className="px-3 py-3">Team</th>
                    <th className="px-3 py-3">Contract</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {seasons.map((season) => (
                    <tr key={season.id} className="text-sm">
                      <td className="px-3 py-4 font-medium text-gray-800 dark:text-white/90">
                        {playerName(season.player)}
                      </td>
                      <td className="px-3 py-4 text-gray-500 dark:text-gray-400">
                        {season.season_year}
                      </td>
                      <td className="px-3 py-4 text-gray-500 dark:text-gray-400">
                        {season.fantasy_team?.team_name || "Unassigned"}
                      </td>
                      <td className="px-3 py-4 text-gray-500 dark:text-gray-400">
                        {[season.position, season.salary ? `$${season.salary}` : null, season.term_end_year ? `through ${season.term_end_year}` : null, season.contract_group].filter(Boolean).join(" / ") || "Not set"}
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSeason(season);
                              setSeasonForm({
                                player_id: String(season.player_id),
                                season_year: String(season.season_year),
                                fantasy_team_id: season.fantasy_team_id ? String(season.fantasy_team_id) : "",
                                salary: season.salary === null ? "" : String(season.salary),
                                position: season.position || "",
                                term_end_year: season.term_end_year === null ? "" : String(season.term_end_year),
                                contract_group: season.contract_group || "",
                                notes: season.notes || "",
                              });
                            }}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03]"
                            title="Edit season"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSeason(season)}
                            disabled={saving}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03]"
                            title="Delete season"
                          >
                            <TrashBinIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {seasons.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                        No player seasons have been added yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <form
            onSubmit={handlePlayerSubmit}
            className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
          >
            <h3 className="font-semibold text-gray-800 text-theme-lg dark:text-white/90">
              {editingPlayer ? "Edit Player" : "Add Player"}
            </h3>

            <div className="mt-5 grid gap-4">
              <div>
                <Label htmlFor="player_api_id">API Player ID</Label>
                <Input
                  id="player_api_id"
                  value={playerForm.player_api_id}
                  onChange={(event) =>
                    setPlayerForm((current) => ({ ...current, player_api_id: event.target.value }))
                  }
                  placeholder="Example: 660271"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="first_name">First Name</Label>
                  <Input
                    id="first_name"
                    value={playerForm.first_name || ""}
                    onChange={(event) =>
                      setPlayerForm((current) => ({ ...current, first_name: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="last_name">Last Name</Label>
                  <Input
                    id="last_name"
                    value={playerForm.last_name || ""}
                    onChange={(event) =>
                      setPlayerForm((current) => ({ ...current, last_name: event.target.value }))
                    }
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="full_name">Full Name</Label>
                <Input
                  id="full_name"
                  value={playerForm.full_name || ""}
                  onChange={(event) =>
                    setPlayerForm((current) => ({ ...current, full_name: event.target.value }))
                  }
                />
              </div>

              <div>
                <Label htmlFor="player_notes">Notes</Label>
                <textarea
                  id="player_notes"
                  value={playerForm.notes || ""}
                  onChange={(event) =>
                    setPlayerForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                />
              </div>

              <Checkbox
                label="On trade block"
                checked={playerForm.on_trade_block}
                onChange={(checked) =>
                  setPlayerForm((current) => ({ ...current, on_trade_block: checked }))
                }
              />
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-brand-500 px-4 py-3 text-sm font-medium text-white shadow-theme-xs hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Player"}
              </button>
              {editingPlayer && (
                <button
                  type="button"
                  onClick={resetPlayerForm}
                  className="rounded-lg border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          <form
            onSubmit={handleSeasonSubmit}
            className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
          >
            <h3 className="font-semibold text-gray-800 text-theme-lg dark:text-white/90">
              {editingSeason ? "Edit Player Season" : "Add Player Season"}
            </h3>

            <div className="mt-5 grid gap-4">
              <div>
                <Label htmlFor="season_player">Player</Label>
                <select
                  id="season_player"
                  value={seasonForm.player_id}
                  onChange={(event) =>
                    setSeasonForm((current) => ({ ...current, player_id: event.target.value }))
                  }
                  className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                >
                  <option value="">Select player</option>
                  {players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {playerName(player)} ({player.player_api_id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="season_year">Season</Label>
                  <Input
                    id="season_year"
                    type="number"
                    value={seasonForm.season_year}
                    onChange={(event) =>
                      setSeasonForm((current) => ({ ...current, season_year: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="position">Position</Label>
                  <Input
                    id="position"
                    value={seasonForm.position}
                    onChange={(event) =>
                      setSeasonForm((current) => ({ ...current, position: event.target.value }))
                    }
                    placeholder="SS"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="fantasy_team_id">Fantasy Team</Label>
                <select
                  id="fantasy_team_id"
                  value={seasonForm.fantasy_team_id}
                  onChange={(event) =>
                    setSeasonForm((current) => ({ ...current, fantasy_team_id: event.target.value }))
                  }
                  className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                >
                  <option value="">Unassigned</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.team_name} ({team.abbreviation})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="salary">Salary</Label>
                  <Input
                    id="salary"
                    type="number"
                    min="0"
                    value={seasonForm.salary}
                    onChange={(event) =>
                      setSeasonForm((current) => ({ ...current, salary: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="term_end_year">Term End</Label>
                  <Input
                    id="term_end_year"
                    type="number"
                    value={seasonForm.term_end_year}
                    onChange={(event) =>
                      setSeasonForm((current) => ({ ...current, term_end_year: event.target.value }))
                    }
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="contract_group">Contract Group</Label>
                <Input
                  id="contract_group"
                  value={seasonForm.contract_group}
                  onChange={(event) =>
                    setSeasonForm((current) => ({ ...current, contract_group: event.target.value }))
                  }
                  placeholder="MLB, Farm, Extension"
                />
              </div>

              <div>
                <Label htmlFor="season_notes">Notes</Label>
                <textarea
                  id="season_notes"
                  value={seasonForm.notes}
                  onChange={(event) =>
                    setSeasonForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-brand-500 px-4 py-3 text-sm font-medium text-white shadow-theme-xs hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Season"}
              </button>
              {editingSeason && (
                <button
                  type="button"
                  onClick={resetSeasonForm}
                  className="rounded-lg border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
