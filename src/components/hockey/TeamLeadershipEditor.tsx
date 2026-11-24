import type { PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import type { LeadershipSlot, TeamLeadership } from "../../lib/teamLeadership";

const eligiblePositions = new Set(["C", "LW", "RW", "D", "G"]);
const position = (row: PlayerSeasonWithRelations) => (row.position || "").toUpperCase();
const playerName = (row: PlayerSeasonWithRelations) => row.player?.full_name
  || [row.player?.first_name, row.player?.last_name].filter(Boolean).join(" ") || "Unknown player";

export default function TeamLeadershipEditor({ roster, leadership, disabled, onChange }: {
  roster: PlayerSeasonWithRelations[];
  leadership: TeamLeadership[];
  disabled: boolean;
  onChange: (slot: LeadershipSlot, playerSeasonId: number | null) => void;
}) {
  const eligible = roster.filter((row) => eligiblePositions.has(position(row)))
    .sort((a, b) => playerName(a).localeCompare(playerName(b)));
  const selected = new Map(leadership.map((entry) => [entry.slot, entry.player_season_id]));
  const slots: Array<[LeadershipSlot, string]> = [["C", "Captain"], ["A1", "Alternate 1"], ["A2", "Alternate 2"]];

  return <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/[0.06]">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
      <div className="min-w-48 lg:mr-2"><p className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-300">Roster management</p><h2 className="mt-0.5 font-bold text-gray-900 dark:text-white">Team Leadership</h2><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Choose one captain and two alternates.</p></div>
      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">{slots.map(([slot, label]) => {
        const current = selected.get(slot) ?? "";
        const chosenElsewhere = new Set([...selected.entries()].filter(([other]) => other !== slot).map(([, id]) => id));
        return <label key={slot} className="text-[11px] font-bold text-gray-600 dark:text-gray-300">{label}<select disabled={disabled} value={current} onChange={(event) => onChange(slot, event.target.value ? Number(event.target.value) : null)} className="mt-1 h-10 w-full rounded-lg border border-amber-200 bg-white px-2.5 text-xs font-semibold text-gray-800 disabled:cursor-wait disabled:opacity-60 dark:border-amber-500/30 dark:bg-gray-900 dark:text-white"><option value="">Unassigned</option>{eligible.map((row) => <option key={row.id} value={row.id} disabled={chosenElsewhere.has(row.id)}>{playerName(row)} · {position(row)}</option>)}</select></label>;
      })}</div>
    </div>
  </section>;
}
