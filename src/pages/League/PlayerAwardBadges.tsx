import type { PlayerAward } from "../../lib/awards";

const awardOrder = ["championship", "mvp", "rookie of the year", "top c", "top lw", "top rw", "top d"];

function awardPriority(assignment: PlayerAward) {
  const index = awardOrder.indexOf((assignment.award?.name || "").trim().toLowerCase());
  return index === -1 ? awardOrder.length : index;
}

export default function PlayerAwardBadges({ awards }: { awards: PlayerAward[] }) {
  if (!awards.length) return null;
  return <span className="ml-2 inline-flex flex-wrap items-center gap-1 align-middle">
    {[...awards].sort((a, b) => awardPriority(a) - awardPriority(b) || b.season_year - a.season_year).map((assignment) => assignment.award?.image_url ? (
      <img
        key={assignment.id}
        src={assignment.award.image_url}
        alt={assignment.award.name}
        title={`${assignment.award.name} · ${assignment.season_year}`}
        className="inline-block h-6 w-6 rounded object-contain"
      />
    ) : (
      <span key={assignment.id} title={`${assignment.award?.name || "Award"} · ${assignment.season_year}`} className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs">🏆</span>
    ))}
  </span>;
}
