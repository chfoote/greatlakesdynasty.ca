// Public NHL data only. Never apply this policy to Supabase or other APIs.
export function nhlOrigin(pathname: string): string | undefined {
  for (const [prefix, origin] of [
    ["/nhl-api", "https://api.nhle.com"],
    ["/nhl-web-api", "https://api-web.nhle.com"],
    ["/nhl-search-api", "https://search.d3.nhle.com"],
  ]) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return origin;
  }
}

export function nhlTtl(url: URL, now = Date.now(), payload?: unknown): number {
  const date = new Date(now);
  const draft = url.pathname.match(/^\/nhl-web-api\/draft\/picks\/(\d{4})\/all$/);
  if (draft) return Number(draft[1]) < date.getUTCFullYear() ? 7 * 86400 : 3600;
  if (url.pathname.startsWith("/nhl-search-api/")) return 3600;
  if (/\/player\/\d+\/landing$/.test(url.pathname)) return 3600;
  if (url.pathname.startsWith("/nhl-api/")) {
    const season = url.searchParams.get("cayenneExp")?.match(/seasonId\s*=\s*\d{4}(\d{4})/);
    const currentSeasonEnd = date.getUTCFullYear() + (date.getUTCMonth() >= 6 ? 1 : 0);
    if (season && Number(season[1]) < currentSeasonEnd) return 86400;
    if (url.pathname.endsWith("/bios")) return 6 * 3600;
    return 60;
  }
  const scoreDate = url.pathname.match(/\/score\/(\d{4}-\d{2}-\d{2})$/)?.[1];
  if (scoreDate && now - Date.parse(`${scoreDate}T00:00:00Z`) > 2 * 86400_000) return 6 * 3600;
  const game = url.pathname.match(/\/gamecenter\/(\d{4})\d+\/(?:boxscore|play-by-play)$/);
  if (game && payload && typeof payload === "object" && "gameState" in payload
    && ["OFF", "FINAL"].includes(String(payload.gameState))) {
    const seasonStart = date.getUTCFullYear() - (date.getUTCMonth() < 6 ? 1 : 0);
    return Number(game[1]) < seasonStart ? 86400 : 300;
  }
  return 15;
}

export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (value !== null && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    const ms = Number(value) * 1000;
    if (Number.isFinite(ms)) return Math.max(1000, ms);
  }
  const until = value ? Date.parse(value) : NaN;
  return Number.isFinite(until) ? Math.max(1000, until - now) : 60_000;
}

export function createLimiter(maximum: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function limited<T>(work: () => Promise<T>): Promise<T> {
    if (active >= maximum) await new Promise<void>((resolve) => queue.push(resolve));
    else active++;
    try { return await work(); }
    finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}
