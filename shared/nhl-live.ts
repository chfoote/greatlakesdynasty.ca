export interface SnapshotGame {
  id: number;
  gameState: string;
  startTimeUTC?: string;
  [key: string]: unknown;
}

export interface LiveSnapshot {
  date: string;
  generatedAt: number;
  live: boolean;
  nextRefreshAt: number | null;
  scoreboard: { games: SnapshotGame[]; [key: string]: unknown };
  games: Array<{ game: SnapshotGame; boxscore: unknown | null; playByPlay: unknown | null }>;
}

export function nhlStatsDate(dayOffset = 0, now = Date.now()) {
  const shifted = new Date(now - 6 * 60 * 60 * 1000 + dayOffset * 86400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(shifted);
}

export function gameHasStarted(game: SnapshotGame, now: number) {
  return ["LIVE", "CRIT", "OFF", "FINAL"].includes(game.gameState)
    || (game.gameState === "PRE" && Date.parse(game.startTimeUTC || "") <= now);
}

export function refreshPlan(games: SnapshotGame[], now: number) {
  const live = games.some((game) => ["LIVE", "CRIT"].includes(game.gameState)
    || (game.gameState === "PRE" && Date.parse(game.startTimeUTC || "") <= now));
  if (live) return { live, nextRefreshAt: now + 30_000 };
  const pending = games.filter((game) => !["OFF", "FINAL"].includes(game.gameState));
  if (!pending.length) return { live, nextRefreshAt: null };
  const next = Math.min(...pending.map((game) => Date.parse(game.startTimeUTC || "")));
  // Delayed/unknown schedules are checked infrequently, never in a tight loop.
  return { live, nextRefreshAt: Number.isFinite(next) && next > now ? Math.max(now + 30_000, next + 5000) : now + 300_000 };
}
