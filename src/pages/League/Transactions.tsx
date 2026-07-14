import { useEffect, useState } from "react";
import { Link } from "react-router";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { fetchLeagueTransactions, type LeagueTransaction } from "../../lib/transactions";

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

function getTransactionSentence(transaction: LeagueTransaction) {
  const team = transaction.fantasy_team?.team_name || "Unknown team";
  const position = transaction.player_season?.position?.toUpperCase();
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
    traded: `${team} have traded`,
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
    traded: "",
  };
  const contractYears = transaction.term_end_year
    ? Math.max(transaction.term_end_year - transaction.season_year + 1, 1)
    : null;
  const contractValue = contractYears && transaction.salary !== null
    ? contractYears * transaction.salary
    : null;
  const isContractSigning = transaction.action === "signed";
  const signingTerms = isContractSigning && contractYears && transaction.salary !== null
    ? ` for ${contractYears} ${contractYears === 1 ? "Year" : "Years"} at ${money.format(transaction.salary)}${transaction.term_end_year ? ` (${transaction.term_end_year})` : ""}`
    : "";

  return {
    prefix: prefixes[transaction.action] || `${team} have updated`,
    position,
    suffix: `${suffixes[transaction.action] || ""}${signingTerms}.`,
    contractDetail: isContractSigning && contractValue !== null
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

export default function Transactions() {
  const [transactions, setTransactions] = useState<LeagueTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
                className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-theme-xs transition hover:border-brand-200 hover:shadow-theme-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-brand-500/40 sm:p-5"
              >
                <div
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ backgroundColor: transaction.fantasy_team?.primary_color || "#465fff" }}
                />
                <div className="flex items-start gap-4">
                  <Link
                    to={transaction.fantasy_team?.abbreviation ? `/teams/${transaction.fantasy_team.abbreviation}` : "/teams"}
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
                    {transaction.trade_offer_id ? (
                      <p className="text-sm leading-6 text-gray-700 dark:text-gray-300 sm:text-base">
                        {transaction.description || "Trade completed."}
                      </p>
                    ) : (() => {
                      const sentence = getTransactionSentence(transaction);
                      const apiId = transaction.player?.player_api_id;
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
                        </>
                      );
                    })()}
                    {transaction.notes && (
                      <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                        {transaction.notes}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
