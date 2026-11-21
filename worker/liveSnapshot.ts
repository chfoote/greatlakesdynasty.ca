import { gameHasStarted, nhlStatsDate, refreshPlan, type LiveSnapshot, type SnapshotGame } from "../shared/nhl-live.ts";

export class SnapshotError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;
  readonly diagnostics: Record<string, string>;
  constructor(message: string, status: number, retryAfter: string | null = null, diagnostics: Record<string, string> = {}) {
    super(message); this.status = status; this.retryAfter = retryAfter; this.diagnostics = diagnostics;
  }
}

export function createSnapshotBuilder(now: () => number = Date.now) {
  // Completed games are public data; never retain failed or incomplete payloads.
  const completed = new Map<number, { until: number; boxscore: unknown; playByPlay: unknown }>();
  return async function buildSnapshot(date: string, get: (path: string) => Promise<Response>): Promise<LiveSnapshot> {
    async function json(path: string): Promise<unknown> {
      const response = await get(path);
      if (!response.ok) {
        const diagnostics: Record<string, string> = {};
        for (const name of ["X-NHL-Source", "X-NHL-Upstream-Status", "X-NHL-Upstream-CF-Ray", "X-NHL-Upstream-Server"]) {
          const value = response.headers.get(name);
          if (value) diagnostics[name] = value;
        }
        throw new SnapshotError("Unable to load complete NHL live data.", response.status, response.headers.get("Retry-After"), diagnostics);
      }
      try { return await response.json(); }
      catch { throw new SnapshotError("NHL returned invalid live JSON.", 502); }
    }
    const raw = await json(`/nhl-web-api/score/${date}`);
    if (!raw || typeof raw !== "object" || !("games" in raw) || !Array.isArray(raw.games)
      || raw.games.length > 16 || raw.games.some((game) => !Number.isSafeInteger(game?.id)
        || !/^\d{10}$/.test(String(game.id)) || typeof game.gameState !== "string")
      || new Set(raw.games.map((game) => game.id)).size !== raw.games.length) {
      throw new SnapshotError("NHL returned an invalid scoreboard.", 502);
    }
    const scoreboard = raw as LiveSnapshot["scoreboard"];
    const games = await Promise.all(scoreboard.games.map(async (game: SnapshotGame) => {
      if (!gameHasStarted(game, now())) return { game, boxscore: null, playByPlay: null };
      const saved = completed.get(game.id);
      if (saved && saved.until > now()) return { game, boxscore: saved.boxscore, playByPlay: saved.playByPlay };
      const [rawBoxscore, rawPlayByPlay] = await Promise.all([
        json(`/nhl-web-api/gamecenter/${game.id}/boxscore`),
        json(`/nhl-web-api/gamecenter/${game.id}/play-by-play`),
      ]);
      if (!rawBoxscore || typeof rawBoxscore !== "object" || !("playerByGameStats" in rawBoxscore)
        || !rawPlayByPlay || typeof rawPlayByPlay !== "object" || !("plays" in rawPlayByPlay) || !Array.isArray(rawPlayByPlay.plays)) {
        throw new SnapshotError("NHL returned incomplete game data.", 502);
      }
      // Keep every scoring field and event timestamp used by the app, without
      // repeatedly sending unrelated NHL marketing, odds and event-location data.
      const box = rawBoxscore as Record<string, unknown>;
      const play = rawPlayByPlay as Record<string, unknown>;
      const boxscore = { gameState: box.gameState, awayTeam: box.awayTeam, homeTeam: box.homeTeam, playerByGameStats: box.playerByGameStats };
      const playByPlay = { rosterSpots: play.rosterSpots, plays: rawPlayByPlay.plays.map((event: Record<string, unknown>) => ({
        eventId: event.eventId, typeDescKey: event.typeDescKey, sortOrder: event.sortOrder,
        timeInPeriod: event.timeInPeriod, periodDescriptor: event.periodDescriptor,
        ...(event.typeDescKey === "goal" ? { details: event.details } : {}),
      })) };
      if (["OFF", "FINAL"].includes(game.gameState)) {
        if (completed.size >= 64) completed.delete(completed.keys().next().value!);
        completed.set(game.id, { until: now() + (date === nhlStatsDate(0, now()) ? 300_000 : 86400_000), boxscore, playByPlay });
      }
      return { game, boxscore, playByPlay };
    }));
    return { date, generatedAt: now(), ...refreshPlan(scoreboard.games, now()), scoreboard, games };
  };
}
