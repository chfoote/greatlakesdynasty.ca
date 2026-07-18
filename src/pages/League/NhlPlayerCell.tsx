import type { PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import type { PlayerAward } from "../../lib/awards";
import PlayerAwardBadges from "./PlayerAwardBadges";
import { Link } from "react-router";

const currencyFormatter = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

export default function NhlPlayerCell({
  playerName,
  playerId,
  teamAbbreviation,
  fantasySeason,
  showNhlTeam = true,
  awards = [],
}: {
  playerName: string;
  playerId?: string | number;
  teamAbbreviation: string;
  fantasySeason?: PlayerSeasonWithRelations;
  showNhlTeam?: boolean;
  awards?: PlayerAward[];
}) {
  const salary = fantasySeason?.salary;
  const profilePlayerId = fantasySeason?.player?.player_api_id || playerId;
  const isExpiring = Boolean(
    fantasySeason?.term_end_year
    && fantasySeason.term_end_year === fantasySeason.season_year,
  );

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
        {profilePlayerId ? <Link to={`/player-profile?playerId=${profilePlayerId}`} className="font-medium text-brand-500 hover:text-brand-600 hover:underline">{playerName}</Link> : <span className="font-medium text-gray-800 dark:text-white/90">{playerName}</span>}
        <PlayerAwardBadges awards={awards} />
        <p className={`mt-0.5 text-[11px] font-medium ${isExpiring ? "text-orange-600 dark:text-orange-400" : "text-gray-500 dark:text-gray-400"}`}>
          {[
            showNhlTeam ? teamAbbreviation : null,
            salary === null || salary === undefined
              ? "No salary"
              : currencyFormatter.format(salary),
            fantasySeason?.term_end_year,
          ]
            .filter(Boolean)
            .join(" | ")}
          {isExpiring && (
            <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
              Expiring
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
