import { useEffect, useState } from "react";
import { Link } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { useAuth } from "../../context/AuthContext";
import { deleteLeagueTransaction, fetchLeagueTransactions, type LeagueTransaction } from "../../lib/transactions";

const money = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

function getPlayerName(transaction: LeagueTransaction) {
  return transaction.player?.full_name
    || [transaction.player?.first_name, transaction.player?.last_name].filter(Boolean).join(" ")
    || "Unknown player";
}

function formatTransactionDate(date: string) {
  const value = new Date(`${date}T00:00:00`);
  const day = value.getDate();
  const lastTwo = day % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13
    ? "TH"
    : day % 10 === 1
      ? "ST"
      : day % 10 === 2
        ? "ND"
        : day % 10 === 3
          ? "RD"
          : "TH";
  const month = value.toLocaleDateString("en-CA", { month: "long" });
  return `${month} ${day}${suffix.toLowerCase()}, ${value.getFullYear()}`;
}

function getTransactionSentence(transaction: LeagueTransaction, fallbackPosition?: string | null) {
  const team = transaction.fantasy_team?.team_name || "Unknown team";
  const position = (transaction.position || transaction.player_season?.position || fallbackPosition)?.toUpperCase();
  const prefixes = {
    signed: `${team} have signed`,
    called_up: `${team} have called-up`,
    waived: `${team} have waived`,
    claimed: `${team} have claimed`,
    bought_out: `${team} have bought out`,
    retained: `${team} have retained`,
    injured_reserve: `${team} have assigned`,
    long_term_injured_reserve: `${team} have assigned`,
    released_to_rfa_offer: `${team} have released`,
    matched_rfa_offer: `${team} have matched an RFA offer for`,
    traded: `${team} have acquired`,
  };
  const suffixes = {
    signed: "",
    called_up: "",
    waived: "",
    claimed: "",
    bought_out: "",
    retained: "",
    injured_reserve: " to Injured Reserve",
    long_term_injured_reserve: " to Long Term Injured Reserve",
    released_to_rfa_offer: " to an RFA offer",
    matched_rfa_offer: "",
    traded: " via trade",
  };
  const contractYears = transaction.term_end_year
    ? Math.max(transaction.term_end_year - transaction.season_year + 1, 1)
    : null;
  const contractValue = contractYears && transaction.salary !== null
    ? contractYears * transaction.salary
    : null;
  const showsContractTerms = transaction.action === "signed" || transaction.action === "called_up";
  const signingTerms = showsContractTerms && contractYears && transaction.salary !== null
    ? ` for ${contractYears} ${contractYears === 1 ? "Year" : "Years"} at ${money.format(transaction.salary)}${transaction.term_end_year ? ` (${transaction.term_end_year})` : ""}`
    : "";

  return {
    prefix: prefixes[transaction.action] || `${team} have updated`,
    position: transaction.action === "traded" && position === "PROSPECT" ? "prospect" : position,
    suffix: `${suffixes[transaction.action] || ""}${signingTerms}.`,
    contractDetail: showsContractTerms && contractValue !== null
      ? `Contract value is ${money.format(contractValue)}.`
      : null,
  };
}

function getActionLabel(transaction: LeagueTransaction) {
  if (transaction.trade_offer_id) return "Trade";
  return {
    signed: "Signed",
    called_up: "Called-up",
    waived: "Waived",
    claimed: "Claimed",
    bought_out: "Bought out",
    retained: "Retained",
    injured_reserve: "Injured Reserve",
    long_term_injured_reserve: "Long Term IR",
    released_to_rfa_offer: "RFA Offer",
    matched_rfa_offer: "RFA Matched",
    traded: "Traded",
  }[transaction.action] || "Transaction";
}

function findRelatedTradeId(
  transaction: LeagueTransaction,
  transactions: LeagueTransaction[],
) {
  if (transaction.related_trade_offer_id) return transaction.related_trade_offer_id;
  if (transaction.action !== "traded" || transaction.trade_offer_id) return null;

  const playerApiId = transaction.player?.player_api_id?.toLowerCase();
  const playerName = getPlayerName(transaction).toLowerCase();
  const matchingTrade = transactions.find((candidate) => {
    if (!candidate.trade_offer_id || candidate.transaction_date !== transaction.transaction_date) return false;
    const tradeText = `${candidate.description || ""} ${candidate.notes || ""}`.toLowerCase();
    return Boolean(
      (playerApiId && tradeText.includes(playerApiId))
      || (playerName !== "unknown player" && tradeText.includes(playerName)),
    );
  });

  return matchingTrade?.trade_offer_id || null;
}

function TeamLogo({ team }: { team: LeagueTransaction["fantasy_team"] }) {
  return (
    <Link
      to={team?.id ? `/teams/${team.id}` : "/teams"}
      className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white shadow-theme-xs transition hover:border-brand-300 hover:shadow-theme-sm dark:border-gray-700 dark:bg-gray-800 dark:hover:border-brand-500"
      title={team?.team_name || "View teams"}
    >
      {team?.logo ? (
        <img src={team.logo} alt={`${team.team_name} logo`} className="h-full w-full object-contain p-1" />
      ) : (
        <span className="text-xs font-bold text-gray-500 dark:text-gray-300">{team?.abbreviation || "GLDHL"}</span>
      )}
    </Link>
  );
}

export function TradeTransactionDetails({ transaction }: { transaction: LeagueTransaction }) {
  const trade = transaction.trade_offer;
  const teams = [trade?.from_team, trade?.to_team, trade?.third_team].filter(Boolean);
  const positionOrder: Record<string, number> = { C: 0, LW: 1, RW: 2, D: 3, G: 4 };

  if (!trade || teams.length === 0) {
    return <p className="text-sm leading-6 text-gray-700 dark:text-gray-300 sm:text-base">{transaction.description || "Trade completed."}</p>;
  }

  return (
    <div className={`mt-4 grid gap-3 ${teams.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
      {teams.map((team) => {
        if (!team) return null;
        const acquired = trade.trade_offer_players
          .filter((move) => move.to_team_id === team.id)
          .sort((a, b) => {
            const aPosition = a.player_season?.position?.toUpperCase() || "";
            const bPosition = b.player_season?.position?.toUpperCase() || "";
            const positionDifference = (positionOrder[aPosition] ?? 99) - (positionOrder[bPosition] ?? 99);
            if (positionDifference !== 0) return positionDifference;
            const aName = a.player_season?.player?.full_name || "";
            const bName = b.player_season?.player?.full_name || "";
            return aName.localeCompare(bName);
          });
        return (
          <section key={team.id} className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-white/[0.03]">
            <div className="mb-4 flex items-center gap-3">
              <TeamLogo team={team} />
              <div className="min-w-0">
                <Link to={team.id ? `/teams/${team.id}` : "/teams"} className="font-semibold text-gray-900 hover:text-brand-500 dark:text-white">
                  {team.team_name}
                </Link>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Acquire</p>
              </div>
            </div>
            <div className="space-y-2">
              {acquired.map((move) => {
                const season = move.player_season;
                const player = season?.player;
                const playerName = player?.full_name || [player?.first_name, player?.last_name].filter(Boolean).join(" ") || "Unknown player";
                return (
                  <div key={move.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-white px-3 py-2.5 shadow-theme-xs dark:bg-gray-900">
                    <div className="min-w-0">
                      <span className="mr-2 text-xs font-bold text-brand-600 dark:text-brand-400">{season?.position?.toUpperCase() || "—"}</span>
                      {player?.player_api_id ? (
                        <Link to={`/player-profile?playerId=${player.player_api_id}`} className="font-medium text-gray-800 hover:text-brand-500 hover:underline dark:text-white/90">
                          {playerName}
                        </Link>
                      ) : <span className="font-medium text-gray-800 dark:text-white/90">{playerName}</span>}
                    </div>
                    <div className="text-right text-xs text-gray-500 dark:text-gray-400">
                      <div className="font-medium text-gray-700 dark:text-gray-300">{season?.salary == null ? "—" : money.format(season.salary)}</div>
                      <div>{season?.term_end_year || "No term"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function Transactions() {
  const { isAdmin } = useAuth();
  const [transactions, setTransactions] = useState<LeagueTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function handleDeleteTransaction(transaction: LeagueTransaction) {
    if (transaction.trade_offer_id) return;
    if (!window.confirm(`Delete this ${getActionLabel(transaction).toLowerCase()} transaction? This will not delete the player season.`)) return;
    setDeletingId(transaction.id);
    setError("");
    try {
      await deleteLeagueTransaction(transaction.id);
      setTransactions((current) => current.filter((item) => item.id !== transaction.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete transaction.");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    fetchLeagueTransactions()
      .then(setTransactions)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Unable to load transactions."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageMeta title="Great Lakes Dynasty Hockey League" description="Great Lakes Dynasty Hockey League transactions" />
      <PageBreadcrumb pageTitle="Transactions" />
      <div className="min-h-screen rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="mb-6">
          <h3 className="font-semibold text-gray-800 text-theme-xl dark:text-white/90 sm:text-2xl">Transactions</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Official GLDHL signings and player transactions.</p>
        </div>

        {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading transactions…</p>}
        {error && <p className="rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700">{error}</p>}
        {!loading && !error && transactions.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No transactions have been posted yet.</p>}

        {!loading && !error && transactions.length > 0 && (
          <div className="space-y-4">
            {transactions.map((transaction) => (
              <article
                key={transaction.id}
                id={transaction.trade_offer_id ? `trade-${transaction.trade_offer_id}` : undefined}
                className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-theme-xs transition hover:border-brand-200 hover:shadow-theme-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-brand-500/40 sm:p-5"
              >
                <div
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ backgroundColor: transaction.fantasy_team?.primary_color || "#465fff" }}
                />
                {transaction.trade_offer_id ? (
                  <div>
                    <div className="flex flex-col items-start gap-1">
                      <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                        Trade
                      </span>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        {formatTransactionDate(transaction.transaction_date)}
                      </span>
                    </div>
                    <TradeTransactionDetails transaction={transaction} />
                    {transaction.notes && (
                      <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">{transaction.notes}</p>
                    )}
                  </div>
                ) : <div className="flex items-start gap-4">
                  <Link
                    to={transaction.fantasy_team?.id ? `/teams/${transaction.fantasy_team.id}` : "/teams"}
                    className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50 shadow-theme-xs transition hover:border-brand-300 hover:shadow-theme-sm dark:border-gray-700 dark:bg-gray-800 dark:hover:border-brand-500"
                    title={transaction.fantasy_team?.team_name || "View teams"}
                  >
                    {transaction.fantasy_team?.logo ? (
                      <img
                        src={transaction.fantasy_team.logo}
                        alt={`${transaction.fantasy_team.team_name} logo`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xs font-bold text-gray-500 dark:text-gray-300">
                        {transaction.fantasy_team?.abbreviation || "GLDHL"}
                      </span>
                    )}
                  </Link>

                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-col items-start gap-1">
                      <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                        {getActionLabel(transaction)}
                      </span>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        {formatTransactionDate(transaction.transaction_date)}
                      </span>
                    </div>
                    {(() => {
                      const fallbackPosition = transactions.find((candidate) =>
                        candidate.id !== transaction.id
                        && candidate.player_id === transaction.player_id
                        && candidate.season_year === transaction.season_year
                        && Boolean(candidate.position),
                      )?.position;
                      const sentence = getTransactionSentence(transaction, fallbackPosition);
                      const apiId = transaction.player?.player_api_id;
                      const relatedTradeId = findRelatedTradeId(transaction, transactions);
                      return (
                        <>
                          <p className="text-sm leading-6 text-gray-700 dark:text-gray-300 sm:text-base">
                            {sentence.prefix} {sentence.position ? `${sentence.position} ` : ""}
                            {apiId ? (
                              <Link
                                to={`/player-profile?playerId=${apiId}`}
                                className="font-medium text-brand-500 hover:text-brand-600 hover:underline"
                              >
                                {getPlayerName(transaction)}
                              </Link>
                            ) : getPlayerName(transaction)}
                            {sentence.suffix}
                          </p>
                          {sentence.contractDetail && (
                            <p className="mt-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                              {sentence.contractDetail}
                            </p>
                          )}
                          {relatedTradeId && (
                            <a
                              href={`#trade-${relatedTradeId}`}
                              className="mt-2 inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-600 transition hover:border-brand-300 hover:bg-brand-100 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300"
                            >
                              Part of Trade #{relatedTradeId} · View full trade
                            </a>
                          )}
                        </>
                      );
                    })()}
                    {transaction.notes && (
                      <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                        {transaction.notes}
                      </p>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleDeleteTransaction(transaction)}
                        disabled={deletingId === transaction.id}
                        className="mt-3 text-xs font-semibold text-error-500 hover:text-error-600 hover:underline disabled:opacity-50"
                      >
                        {deletingId === transaction.id ? "Deleting…" : "Delete Transaction"}
                      </button>
                    )}
                  </div>
                </div>}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
