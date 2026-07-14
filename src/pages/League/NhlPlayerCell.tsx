import type { PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";

const currencyFormatter = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

export default function NhlPlayerCell({
  playerName,
  teamAbbreviation,
  fantasySeason,
  showNhlTeam = true,
}: {
  playerName: string;
  teamAbbreviation: string;
  fantasySeason?: PlayerSeasonWithRelations;
  showNhlTeam?: boolean;
}) {
  const salary = fantasySeason?.salary;

  return (
    <div className="flex min-w-52 items-center gap-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
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
        <span className="font-medium text-gray-800 dark:text-white/90">{playerName}</span>
        <p className="mt-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">
          {[
            showNhlTeam ? teamAbbreviation : null,
            salary === null || salary === undefined
              ? "No salary"
              : currencyFormatter.format(salary),
            fantasySeason?.term_end_year,
          ]
            .filter(Boolean)
            .join(" | ")}
        </p>
      </div>
    </div>
  );
}
