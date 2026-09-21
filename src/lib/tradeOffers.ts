import { supabase } from "./supabase";
import type { FantasyTeam } from "./fantasyTeams";
import type { PlayerSeasonWithRelations } from "./fantasyPlayers";

export type TradeOfferStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "admin_declined"
  | "completed"
  | "countered"
  | "revoked";

export type TradeOfferPlayer = {
  id: number;
  trade_offer_id: number;
  player_season_id: number;
  from_team_id: number;
  to_team_id: number;
  created_at: string;
  player_season: PlayerSeasonWithRelations | null;
  from_team: FantasyTeam | null;
  to_team: FantasyTeam | null;
};

export type TradeOffer = {
  id: number;
  season_year: number;
  from_team_id: number;
  to_team_id: number;
  third_team_id: number | null;
  created_by: string;
  status: TradeOfferStatus;
  parent_trade_offer_id: number | null;
  notes: string | null;
  response_notes: string | null;
  admin_notes: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  revoked_at?: string | null;
  completed_at: string | null;
  admin_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  from_team: FantasyTeam | null;
  to_team: FantasyTeam | null;
  third_team: FantasyTeam | null;
  trade_offer_players: TradeOfferPlayer[];
};

export type TradeOfferDismissal = {
  id: number;
  trade_offer_id: number;
  user_id: string;
  dismissed_at: string;
};

export type GmTradeOfferActivity = {
  created_by: string;
  from_team_id: number;
  season_year: number;
  status: TradeOfferStatus;
  is_counter: boolean;
  offer_count: number;
};

const tradeOfferSelect = `
  *,
  from_team:fantasy_teams!trade_offers_from_team_id_fkey(*),
  to_team:fantasy_teams!trade_offers_to_team_id_fkey(*),
  third_team:fantasy_teams!trade_offers_third_team_id_fkey(*),
  trade_offer_players(
    *,
    from_team:fantasy_teams!trade_offer_players_from_team_id_fkey(*),
    to_team:fantasy_teams!trade_offer_players_to_team_id_fkey(*),
    player_season:player_seasons(*, player:players(*), fantasy_team:fantasy_teams(*))
  )
`;

export async function fetchTradeOffers(seasonYear: number) {
  const { data, error } = await supabase
    .from("trade_offers")
    .select(tradeOfferSelect)
    .eq("season_year", seasonYear)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as TradeOffer[];
}

export async function fetchAllTradeOffers() {
  const { data, error } = await supabase
    .from("trade_offers")
    .select(tradeOfferSelect)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TradeOffer[];
}

export async function fetchGmTradeOfferActivity() {
  const { data, error } = await supabase.rpc("get_gm_trade_offer_activity");
  if (error) throw error;
  return (data ?? []) as GmTradeOfferActivity[];
}

export async function createTradeOffer({
  seasonYear,
  fromTeamId,
  toTeamId,
  createdBy,
  notes,
  parentTradeOfferId,
  playerMoves,
}: {
  seasonYear: number;
  fromTeamId: number;
  toTeamId: number;
  createdBy: string;
  notes: string | null;
  parentTradeOfferId?: number | null;
  playerMoves: Array<{
    playerSeasonId: number;
    fromTeamId: number;
    toTeamId: number;
  }>;
}) {
  const { data: offer, error: offerError } = await supabase
    .from("trade_offers")
    .insert({
      season_year: seasonYear,
      from_team_id: fromTeamId,
      to_team_id: toTeamId,
      created_by: createdBy,
      notes,
      parent_trade_offer_id: parentTradeOfferId ?? null,
      status: "pending",
    })
    .select("*")
    .single();

  if (offerError) throw offerError;

  if (playerMoves.length > 0) {
    const { error: playersError } = await supabase
      .from("trade_offer_players")
      .insert(
        playerMoves.map((move) => ({
          trade_offer_id: offer.id,
          player_season_id: move.playerSeasonId,
          from_team_id: move.fromTeamId,
          to_team_id: move.toTeamId,
        })),
      );

    if (playersError) throw playersError;
  }

  const { data, error } = await supabase
    .from("trade_offers")
    .select(tradeOfferSelect)
    .eq("id", offer.id)
    .single();

  if (error) throw error;
  return data as TradeOffer;
}

export async function createAdminTradeOffer({
  seasonYear,
  fromTeamId,
  toTeamId,
  notes,
  playerMoves,
}: {
  seasonYear: number;
  fromTeamId: number;
  toTeamId: number;
  notes: string | null;
  playerMoves: Array<{ playerSeasonId: number; fromTeamId: number; toTeamId: number }>;
}) {
  const { data, error } = await supabase.rpc("create_admin_trade_offer", {
    p_season_year: seasonYear,
    p_from_team_id: fromTeamId,
    p_to_team_id: toTeamId,
    p_notes: notes,
    p_player_moves: playerMoves,
  });
  if (error) throw error;
  return data as TradeOffer;
}

export async function createAdminThreeTeamTrade({
  seasonYear,
  team1Id,
  team2Id,
  team3Id,
  notes,
  playerMoves,
}: {
  seasonYear: number;
  team1Id: number;
  team2Id: number;
  team3Id: number;
  notes: string | null;
  playerMoves: Array<{ playerSeasonId: number; fromTeamId: number; toTeamId: number }>;
}) {
  const { data, error } = await supabase.rpc("create_admin_three_team_trade", {
    p_season_year: seasonYear,
    p_team_1_id: team1Id,
    p_team_2_id: team2Id,
    p_team_3_id: team3Id,
    p_notes: notes,
    p_player_moves: playerMoves,
  });
  if (error) throw error;
  return data;
}

export async function updateTradeOfferStatus({
  tradeOfferId,
  status,
  responseNotes,
  adminNotes,
}: {
  tradeOfferId: number;
  status: Extract<
    TradeOfferStatus,
    "accepted" | "declined" | "admin_declined" | "countered" | "revoked"
  >;
  responseNotes?: string | null;
  adminNotes?: string | null;
}) {
  const now = new Date().toISOString();
  const timestampFields =
    status === "accepted"
      ? { accepted_at: now }
      : status === "declined"
        ? { declined_at: now }
        : status === "revoked"
          ? { revoked_at: now }
          : {};

  const { data, error } = await supabase
    .from("trade_offers")
    .update({
      status,
      response_notes: responseNotes,
      admin_notes: adminNotes,
      ...(status === "admin_declined"
        ? { admin_reviewed_at: now, declined_at: now }
        : timestampFields),
    })
    .eq("id", tradeOfferId)
    .select(tradeOfferSelect)
    .single();

  if (error) throw error;
  return data as TradeOffer;
}

export async function approveTradeOffer(tradeOfferId: number, transactionDate: string) {
  const { data, error } = await supabase.rpc("approve_trade_offer_with_date", {
    p_trade_offer_id: tradeOfferId,
    p_transaction_date: transactionDate,
  });

  if (error) throw error;
  return data as TradeOffer;
}

export async function fetchTradeOfferDismissals(userId: string) {
  const { data, error } = await supabase
    .from("trade_offer_dismissals")
    .select("*")
    .eq("user_id", userId);

  if (error) throw error;
  return (data ?? []) as TradeOfferDismissal[];
}

export async function dismissTradeOffer(tradeOfferId: number, userId: string) {
  const { data, error } = await supabase
    .from("trade_offer_dismissals")
    .upsert(
      {
        trade_offer_id: tradeOfferId,
        user_id: userId,
      },
      { onConflict: "trade_offer_id,user_id" },
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as TradeOfferDismissal;
}
