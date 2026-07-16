import { useEffect, useState } from "react";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import {
  approveTradeOffer,
  fetchTradeOffers,
  updateTradeOfferStatus,
  type TradeOffer,
} from "../../lib/tradeOffers";

const seasonOptions = Array.from({ length: 10 }, (_, index) => 2026 + index);

function TradeAdminOfferCard({
  offer,
  busy,
  transactionDate,
  onTransactionDateChange,
  onApprove,
  onDecline,
}: {
  offer: TradeOffer;
  busy: boolean;
  transactionDate: string;
  onTransactionDateChange: (date: string) => void;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const participatingTeams = [offer.from_team, offer.to_team, offer.third_team].filter(Boolean);
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {participatingTeams.map((team) => team?.team_name).join(" / ") || "Unknown Teams"}
            </h3>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold uppercase text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {offer.status.replace("_", " ")}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Offer #{offer.id} | Season {offer.season_year}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`trade-date-${offer.id}`} className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
              Date of Transaction
            </label>
            <input
              id={`trade-date-${offer.id}`}
              type="date"
              value={transactionDate}
              onChange={(event) => onTransactionDateChange(event.target.value)}
              className="h-9 rounded-lg border border-gray-300 bg-transparent px-3 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
          </div>
          <button
            type="button"
            onClick={onApprove}
            disabled={busy || offer.status !== "accepted" || !transactionDate}
            className="rounded-lg bg-success-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-success-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Approve & Move Players
          </button>
          <button
            type="button"
            onClick={onDecline}
            disabled={busy || offer.status === "completed"}
            className="rounded-lg border border-error-200 px-3 py-2 text-xs font-semibold text-error-600 transition hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-error-500/30 dark:text-error-300 dark:hover:bg-error-500/10"
          >
            Admin Decline
          </button>
        </div>
      </div>

      <div className={`mt-4 grid gap-4 ${participatingTeams.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
        {participatingTeams.map((team) => team && (
          <div key={team.id}>
            <p className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{team.team_name} receives</p>
            <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
              {offer.trade_offer_players.filter((player) => player.to_team_id === team.id).map((player) => (
                <li key={player.id}>{player.player_season?.player?.full_name || "Unknown Player"}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {offer.notes && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/30">
          <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
            Notes
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
            {offer.notes}
          </p>
        </div>
      )}
    </article>
  );
}

export default function TradeAdmin() {
  const [selectedSeason, setSelectedSeason] = useState(2026);
  const [offers, setOffers] = useState<TradeOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyOfferId, setBusyOfferId] = useState<number | null>(null);
  const [transactionDates, setTransactionDates] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadOffers() {
    setLoading(true);
    setError("");

    try {
      const rows = await fetchTradeOffers(selectedSeason);
      setOffers(rows);
      setTransactionDates((current) => Object.fromEntries(
        rows.map((offer) => [offer.id, current[offer.id] || new Date().toLocaleDateString("en-CA")]),
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load trade offers.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOffers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeason]);

  async function handleApprove(offer: TradeOffer) {
    setBusyOfferId(offer.id);
    setError("");
    setSuccess("");

    try {
      const transactionDate = transactionDates[offer.id];
      if (!transactionDate) throw new Error("Date of Transaction is required.");
      await approveTradeOffer(offer.id, transactionDate);
      setSuccess(`Trade #${offer.id} approved and posted with a ${transactionDate} transaction date.`);
      await loadOffers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to approve trade.");
    } finally {
      setBusyOfferId(null);
    }
  }

  async function handleDecline(offer: TradeOffer) {
    setBusyOfferId(offer.id);
    setError("");
    setSuccess("");

    try {
      await updateTradeOfferStatus({
        tradeOfferId: offer.id,
        status: "admin_declined",
      });
      setSuccess(`Trade #${offer.id} declined by admin.`);
      await loadOffers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to decline trade.");
    } finally {
      setBusyOfferId(null);
    }
  }

  const reviewableOffers = offers.filter((offer) => offer.status === "accepted");

  return (
    <>
      <PageMeta
        title="Great Lakes Dynasty Hockey League"
        description="Approve or decline fantasy baseball trades"
      />
      <PageBreadcrumb pageTitle="Trade Admin" />

      <div className="space-y-6">
        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                Admin Only
              </p>
              <h1 className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
                Trade Approval
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Complete accepted trades or decline offers before they move players.
              </p>
            </div>

            <div className="w-full sm:w-40">
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Season
              </label>
              <select
                value={selectedSeason}
                onChange={(event) => setSelectedSeason(Number(event.target.value))}
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              >
                {seasonOptions.map((season) => (
                  <option key={season} value={season}>
                    {season}
                  </option>
                ))}
              </select>
            </div>
          </div>

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

        {loading ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
            Loading trade offers...
          </div>
        ) : reviewableOffers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            No accepted trades are waiting for admin review.
          </div>
        ) : (
          <div className="space-y-5">
            {reviewableOffers.map((offer) => (
              <TradeAdminOfferCard
                key={offer.id}
                offer={offer}
                busy={busyOfferId === offer.id}
                transactionDate={transactionDates[offer.id] || ""}
                onTransactionDateChange={(date) => setTransactionDates((current) => ({ ...current, [offer.id]: date }))}
                onApprove={() => handleApprove(offer)}
                onDecline={() => handleDecline(offer)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
