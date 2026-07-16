import type { PlayerAward } from "../../lib/awards";

export default function PlayerAwardBadges({ awards }: { awards: PlayerAward[] }) {
  if (!awards.length) return null;
  return <span className="ml-2 inline-flex flex-wrap items-center gap-1 align-middle">
    {awards.map((assignment) => assignment.award?.image_url ? (
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
