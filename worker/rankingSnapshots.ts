import { buildRankings, indexTradeHistory, type PeriodMode, type RankingRosterRow, type RankingTeam, type RankingTrade } from "../shared/power-rankings.ts";
import { monthNames, periodsPerSeason, periodStart, rankingRange } from "../shared/ranking-ranges.ts";
import { nhlStatsDate } from "../shared/nhl-live.ts";
import { CURRENT_LEAGUE_SEASON, playedAndCurrentSeasons } from "../src/lib/leagueSeasons.ts";
import type { NhlGoalieRecord, NhlSkaterRecord } from "../src/lib/nhl";

const table = "power_ranking_snapshots";
const schemaVersion = 1;
const dayMs = 86_400_000;
export const rankingSnapshotCron = "5,35 * * * *";

type Range = { season_year: number; mode: PeriodMode; range_index: number };
type SavedRange = Range & { generated_at: string; schema_version: number; stats_through: string; source_schema_version?: string };
type SourceStats = { schema_version: number; skaters: NhlSkaterRecord[]; goalies: NhlGoalieRecord[] };
type TeamBranding = Omit<RankingTeam, "id"> & { fantasy_team_id: number; end_season: number | null };
type Options = { url: string; key: string; getReport: (path: string) => Promise<Response>; now?: number; fetcher?: typeof fetch };

function rangeKey(range: Range) {
  return `${range.season_year}:${range.mode}:${range.range_index}`;
}

function previousRange(range: Range): Range | undefined {
  return range.mode === "month" && range.range_index > 0 || range.mode === "period" && range.range_index > 1
    ? { ...range, range_index: range.range_index - 1 } : undefined;
}

export function selectRankingRange(saved: SavedRange[], now: number) {
  const through = nhlStatsDate(-1, now);
  const existing = new Map(saved.map(row => [rangeKey(row), row]));
  const candidates = playedAndCurrentSeasons.flatMap(season_year => {
    const ranges: Range[] = [
      { season_year, mode: "season", range_index: 0 },
      ...monthNames.map((_, range_index): Range => ({ season_year, mode: "month", range_index })),
      ...Array.from({ length: periodsPerSeason }, (_, i): Range => ({ season_year, mode: "period", range_index: i + 1 })),
    ];
    return ranges.flatMap(range => {
      const dates = rankingRange(season_year, range.mode, range.range_index);
      if ((dates.start ?? periodStart(season_year, 1)) > through) return [];
      const active = season_year === CURRENT_LEAGUE_SEASON && dates.end >= through;
      const snapshot = existing.get(rangeKey(range));
      const stamp = snapshot?.schema_version === schemaVersion ? Date.parse(snapshot.generated_at) : 0;
      const statsThrough = dates.end < through ? dates.end : through;
      const coverageChanged = snapshot?.stats_through !== statsThrough;
      if (stamp && !coverageChanged && now - stamp < (active ? dayMs : 7 * dayMs)) return [];
      return [{ range, statsThrough, active }];
    });
  });
  const active = candidates.filter(candidate => candidate.active);
  const completed = candidates.filter(candidate => !candidate.active);
  const preferred = new Date(now).getUTCMinutes() < 30 ? active : completed;
  const pool = preferred.length ? preferred : candidates;
  // Rotate even after a failure so one unavailable range cannot block the rest.
  let next = pool.length ? pool[Math.floor(now / 3_600_000) % pool.length] : undefined;
  // Build missing comparison inputs first. Each invocation fetches just one
  // range's NHL reports, even when movement needs a previous range as well.
  while (next) {
    const prior = previousRange(next.range);
    if (!prior) break;
    const dates = rankingRange(prior.season_year, prior.mode, prior.range_index);
    const snapshot = existing.get(rangeKey(prior));
    if (snapshot?.schema_version === schemaVersion && snapshot.source_schema_version === String(schemaVersion)
      && snapshot.stats_through === dates.end && now - Date.parse(snapshot.generated_at) < 7 * dayMs) break;
    next = { range: prior, statsThrough: dates.end, active: false };
  }
  return next;
}

export async function refreshRankingSnapshot({ url, key, getReport, now = Date.now(), fetcher = fetch }: Options) {
  const root = new URL("/rest/v1/", url);
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  async function read<T>(resource: string, params: Record<string, string>): Promise<T[]> {
    const rows: T[] = [];
    const limit = 1000;
    for (let offset = 0; ; offset += limit) {
      const endpoint = new URL(resource, root);
      endpoint.search = new URLSearchParams({ ...params, offset: String(offset), limit: String(limit) }).toString();
      const result = await fetcher(endpoint, { headers, redirect: "manual", signal: AbortSignal.timeout(12_000) });
      if (!result.ok) throw new Error(`Ranking snapshot database read failed (${result.status}).`);
      const page = await result.json() as T[];
      if (!Array.isArray(page)) throw new Error("Invalid ranking snapshot database response.");
      rows.push(...page);
      if (page.length < limit) return rows;
    }
  }
  const saved = await read<SavedRange>(table, {
    select: "season_year,mode,range_index,schema_version,generated_at,stats_through,source_schema_version:source_stats->>schema_version", order: "season_year,mode,range_index",
  });
  const next = selectRankingRange(saved, now);
  if (!next) return;
  const { range, statsThrough } = next;
  const { season_year: year, mode, range_index: index } = range;
  const dates = rankingRange(year, mode, index);
  const priorRange = previousRange(range);
  const previous = priorRange ? rankingRange(year, mode, index - 1) : undefined;
  let prior: Pick<SourceStats, "skaters" | "goalies"> = { skaters: [], goalies: [] };
  if (priorRange) {
    const [row] = await read<{ source_stats: SourceStats | null }>(table, {
      select: "source_stats", season_year: `eq.${year}`, mode: `eq.${mode}`,
      range_index: `eq.${priorRange.range_index}`, schema_version: `eq.${schemaVersion}`,
    });
    if (!row?.source_stats || row.source_stats.schema_version !== schemaVersion
      || !Array.isArray(row.source_stats.skaters) || !Array.isArray(row.source_stats.goalies)) {
      throw new Error("Ranking snapshot comparison inputs are unavailable.");
    }
    prior = row.source_stats;
  }
  const seasonFilter = `eq.${year}`;
  const [teams, branding, playerSeasons, trades] = await Promise.all([
    read<RankingTeam>("fantasy_teams", { select: "id,team_name,abbreviation,logo", active: "eq.true", order: "id" }),
    read<TeamBranding>("fantasy_team_branding_history", {
      select: "fantasy_team_id,start_season,end_season,team_name,abbreviation,logo", start_season: `lte.${year}`, order: "start_season.desc,id",
    }),
    read<RankingRosterRow>("player_seasons", { select: "id,player_id,fantasy_team_id,position,salary,term_end_year,contract_group,player:players(player_api_id,full_name,first_name,last_name)", season_year: seasonFilter, order: "id" }),
    read<RankingTrade>("league_transactions", {
      select: "transaction_date,trade_offer:trade_offers!league_transactions_trade_offer_id_fkey(trade_offer_players(from_team_id,player_season:player_seasons(player_id)))",
      season_year: seasonFilter, transaction_type: "eq.trade", order: "transaction_date.desc,created_at.desc,id",
    }),
  ]);
  if (!teams.length || !playerSeasons.length) throw new Error("Ranking snapshot roster data is empty.");
  const brandedTeams = teams.map(team => {
    const brand = branding.find(row => row.fantasy_team_id === team.id && (row.end_season === null || row.end_season >= year));
    return brand ? { id: team.id, team_name: brand.team_name, abbreviation: brand.abbreviation, logo: brand.logo } : team;
  });

  async function loadStats(start?: string, end?: string) {
    const seasonId = (year - 1) * 10000 + year;
    const expression = `seasonId=${seasonId} and gameTypeId=2`
      + (start && end ? ` and gameDate>="${start}" and gameDate<="${end}"` : "");
    const query = new URLSearchParams({ cayenneExp: expression });
    async function report<T extends { playerId: number }>(path: string): Promise<T[]> {
      const response = await getReport(`/nhl-api/complete/${path}?${query}`);
      if (!response.ok || response.headers.get("X-NHL-Stale") === "1") {
        const source = response.headers.get("X-NHL-Source") ?? "unknown";
        const retryAfter = response.headers.get("Retry-After");
        throw new Error(`Ranking snapshot NHL ${path} unavailable (${response.status}, ${source}${retryAfter ? `, retry after ${retryAfter}s` : ""}).`);
      }
      const payload = await response.json() as { data?: T[]; total?: number };
      if (!Array.isArray(payload.data) || payload.data.length !== payload.total) {
        throw new Error("Ranking snapshot requires a complete NHL report.");
      }
      return payload.data;
    }
    const summary = await report<NhlSkaterRecord>("skater/summary");
    const realtime = await report<Pick<NhlSkaterRecord, "playerId" | "blockedShots" | "hits">>("skater/realtime");
    const faceoffs = await report<Pick<NhlSkaterRecord, "playerId" | "totalFaceoffWins">>("skater/faceoffwins");
    const goalies = await report<NhlGoalieRecord>("goalie/summary");
    if (Boolean(summary.length) !== Boolean(goalies.length) || (summary.length && !realtime.length)) {
      throw new Error("Ranking snapshot received inconsistent NHL report coverage.");
    }
    const extras = new Map(realtime.map(row => [row.playerId, row]));
    const wins = new Map(faceoffs.map(row => [row.playerId, row.totalFaceoffWins]));
    return {
      goalies,
      skaters: summary.map(row => ({
        ...row, teamAbbrevs: row.teamAbbrevs || "", hits: extras.get(row.playerId)?.hits ?? 0,
        blockedShots: extras.get(row.playerId)?.blockedShots ?? 0, totalFaceoffWins: wins.get(row.playerId) ?? 0,
      })),
    };
  }

  const current = await loadStats(dates.start ?? (year === CURRENT_LEAGUE_SEASON ? `${year - 1}-07-01` : undefined), statsThrough);
  const results = buildRankings({
    currentSkaters: current.skaters, currentGoalies: current.goalies, previousSkaters: prior.skaters, previousGoalies: prior.goalies,
    teams: brandedTeams, playerSeasons, tradeHistory: indexTradeHistory(trades), mode,
    rankingEndDate: dates.end, previousRankingEndDate: previous?.end ?? dates.end,
  });
  if (results.playerRankings.some(row => !Number.isFinite(row.points))
    || (current.skaters.length && !results.playerRankings.some(row => row.gamesPlayed > 0))
    || (!current.skaters.length && (dates.end >= nhlStatsDate(-1, now) || saved.some(row => rangeKey(row) === rangeKey(range))))) {
    throw new Error("Ranking snapshot contains no valid scoring results.");
  }
  const result = await fetcher(new URL(table, root), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ ...range, schema_version: schemaVersion, generated_at: new Date(now).toISOString(), stats_through: statsThrough, results,
      source_stats: { schema_version: schemaVersion, ...current } }),
    redirect: "manual",
    signal: AbortSignal.timeout(12_000),
  });
  if (!result.ok) throw new Error(`Ranking snapshot database write failed (${result.status}).`);
}
