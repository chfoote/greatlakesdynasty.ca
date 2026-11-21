import { createLimiter, createPacer, nhlOrigin, nhlTtl, retryAfterMs } from "../../shared/nhl-policy.ts";

interface Options {
  fetcher?: typeof fetch;
  now?: () => number;
  storage?: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
  lock?: <T>(key: string, work: () => Promise<T>) => Promise<T>;
  statsGapMs?: number;
}

export function createNhlClient(options: Options = {}) {
  const now = options.now ?? Date.now;
  const limited = createLimiter(3);
  const statsGap = options.statsGapMs ?? (typeof window === "undefined" ? 0 : 1250);
  const paceStats = createPacer(statsGap, now);
  const pending = new Map<string, Promise<Response>>();
  const successful = new Map<string, { expires: number; body: string }>();
  const cooldowns = new Map<string, number>();
  const storage = options.storage ?? (() => {
    try { return globalThis.localStorage; } catch { return undefined; }
  });
  const response = (body: string) => new Response(body, { headers: { "Content-Type": "application/json" } });
  const lock = options.lock ?? (async <T>(key: string, work: () => Promise<T>) => {
    let manager: LockManager | undefined;
    try { manager = typeof navigator === "undefined" ? undefined : navigator.locks; }
    catch { return work(); }
    if (!manager) return work();
    let entered = false;
    try { return await manager.request(key, () => { entered = true; return work(); }); }
    catch (error) {
      if (entered) throw error; // Never retry an operation that already ran.
      return work(); // Private/restricted contexts may expose but deny Web Locks.
    }
  });
  const prefix = "gld:public-nhl:v2:";
  const indexKey = `${prefix}index`;
  function persist(key: string, entry: { expires: number; body: string }) {
    try {
      const store = storage();
      if (!store) return;
      let index = JSON.parse(store.getItem(indexKey) || "[]") as Array<{ key: string; expires: number; size: number }>;
      if (!Array.isArray(index)) index = [];
      index = index.filter((item) => {
        if (typeof item?.key !== "string" || !item.key.startsWith(prefix)) return false;
        if (item.key === key || item.expires <= now()) { store.removeItem(item.key); return false; }
        return true;
      });
      const encoded = JSON.stringify(entry);
      const size = encoded.length * 2;
      if (size > 2_000_000) return;
      while (index.length && (index.length >= 32 || index.reduce((sum, item) => sum + item.size, 0) + size > 2_000_000)) {
        store.removeItem(index.shift()!.key);
      }
      store.setItem(key, encoded);
      store.setItem(indexKey, JSON.stringify([...index, { key, expires: entry.expires, size }]));
    } catch { /* Optional public cache must not affect Supabase/browser storage. */ }
  }

  return async function nhlFetch(path: string, _init?: { cache?: RequestCache }): Promise<Response> {
    const url = new URL(path, "https://nhl-client.invalid");
    const origin = nhlOrigin(url.pathname);
    if (!origin || url.origin !== "https://nhl-client.invalid") throw new Error("Only same-origin NHL routes are supported.");
    const key = url.pathname + url.search;
    const storageKey = prefix + key;
    const cooldownKey = `${prefix}cooldown:${origin}`;
    const readCached = () => {
      const cached = successful.get(key);
      if (cached && cached.expires > now()) return response(cached.body);
      successful.delete(key);
      try {
        const stored = storage()?.getItem(storageKey);
        if (stored) {
          const entry = JSON.parse(stored) as { expires: number; body: string };
          if (Number.isFinite(entry.expires) && entry.expires > now() && typeof entry.body === "string") {
            JSON.parse(entry.body);
            return response(entry.body);
          }
          storage()?.removeItem(storageKey);
        }
      } catch { /* Storage may be disabled, full, or contain invalid data. */ }
    };
    const cached = readCached();
    if (cached) return cached;
    const inFlight = pending.get(key);
    if (inFlight) return (await inFlight).clone();
    const fetchPublic = () => lock(`gld:nhl:${key}`, async () => {
      // Another tab may have fetched this while we waited for its Web Lock.
      const shared = readCached();
      if (shared) return shared;
      let until = cooldowns.get(origin) ?? 0;
      try { until = Math.max(until, Number(storage()?.getItem(cooldownKey)) || 0); } catch { /* Optional storage. */ }
      if (until > now()) return Response.json({ error: "NHL requests paused after rate limiting. Try again later." }, {
        status: 429, headers: { "Retry-After": String(Math.ceil((until - now()) / 1000)), "Cache-Control": "no-store" },
      });
      // No automatic retry: subsequent user actions/polls must respect cooldown.
      const result = await (options.fetcher ?? fetch)(key, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (result.status === 429) {
        try { until = Math.max(until, Number(storage()?.getItem(cooldownKey)) || 0); } catch { /* Optional storage. */ }
        const blockedUntil = Math.max(until, cooldowns.get(origin) ?? 0,
          now() + retryAfterMs(result.headers.get("Retry-After"), now()));
        cooldowns.set(origin, blockedUntil);
        try { storage()?.setItem(cooldownKey, String(blockedUntil)); } catch { /* Optional storage. */ }
      }
      if (result.status === 200 && /^application\/(?:json|[\w.-]+\+json)(?:\s*;|$)/i.test(result.headers.get("Content-Type") || "")) {
        const body = await result.text();
        let payload: unknown;
        try { payload = JSON.parse(body); } catch { return Response.json({ error: "NHL returned invalid JSON." }, { status: 502 }); }
        const generated = url.pathname.startsWith("/nhl-web-api/live-snapshot/")
          ? (payload as { generatedAt?: number })?.generatedAt : undefined;
        const responseDate = Date.parse(result.headers.get("Date") || "");
        const age = Math.max(Number(result.headers.get("Age")) || 0,
          Number.isFinite(responseDate) ? Math.max(0, (now() - responseDate) / 1000) : 0,
          typeof generated === "number" ? Math.max(0, (now() - generated) / 1000) : 0);
        if (result.headers.get("X-NHL-Stale") === "1") {
          return new Response(body, { status: 200, headers: result.headers });
        }
        const entry = { expires: now() + Math.max(0, nhlTtl(url, now(), payload) - age) * 1000, body };
        if (successful.size >= 100) successful.delete(successful.keys().next().value!);
        successful.set(key, entry);
        await lock("gld:nhl:storage-index", async () => { persist(storageKey, entry); });
        return new Response(body, { status: result.status, headers: result.headers });
      }
      return result;
    });
    // All stats reports share this lane, including pages of different reports.
    // Cached responses return above without consuming a paced network slot.
    const work = limited(() => origin === "https://api.nhle.com" && statsGap > 0
      ? lock("gld:nhl:stats-origin", () => paceStats(fetchPublic)) : fetchPublic());
    pending.set(key, work);
    try { return (await work).clone(); }
    finally { if (pending.get(key) === work) pending.delete(key); }
  };
}

export const nhlFetch = createNhlClient();
