import { createLimiter, nhlOrigin, nhlTtl, retryAfterMs } from "../../shared/nhl-policy.ts";

interface Options {
  fetcher?: typeof fetch;
  now?: () => number;
  storage?: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
}

export function createNhlClient(options: Options = {}) {
  const now = options.now ?? Date.now;
  const limited = createLimiter(3);
  const pending = new Map<string, Promise<Response>>();
  const successful = new Map<string, { expires: number; body: string }>();
  const cooldowns = new Map<string, number>();
  const storage = options.storage ?? (() => {
    try { return globalThis.localStorage; } catch { return undefined; }
  });
  const response = (body: string) => new Response(body, { headers: { "Content-Type": "application/json" } });

  return async function nhlFetch(path: string, _init?: { cache?: RequestCache }): Promise<Response> {
    const url = new URL(path, "https://nhl-client.invalid");
    const origin = nhlOrigin(url.pathname);
    if (!origin || url.origin !== "https://nhl-client.invalid") throw new Error("Only same-origin NHL routes are supported.");
    const key = url.pathname + url.search;
    const storageKey = `gld:public-nhl:v1:${key}`;
    const draft = /^\/nhl-web-api\/draft\/picks\/\d{4}\/all$/.test(url.pathname);
    const cached = successful.get(key);
    if (cached && cached.expires > now()) return response(cached.body);
    successful.delete(key);
    if (draft) {
      try {
        const stored = storage()?.getItem(storageKey);
        if (stored) {
          const entry = JSON.parse(stored) as { expires: number; body: string };
          if (entry.expires > now() && Array.isArray(JSON.parse(entry.body).picks)) return response(entry.body);
          storage()?.removeItem(storageKey);
        }
      } catch { /* Storage may be disabled, full, or contain invalid data. */ }
    }
    const inFlight = pending.get(key);
    if (inFlight) return (await inFlight).clone();
    const work = limited(async () => {
      const until = cooldowns.get(origin) ?? 0;
      if (until > now()) return Response.json({ error: "NHL requests paused after rate limiting. Try again later." }, {
        status: 429, headers: { "Retry-After": String(Math.ceil((until - now()) / 1000)), "Cache-Control": "no-store" },
      });
      // No automatic retry: subsequent user actions/polls must respect cooldown.
      const result = await (options.fetcher ?? fetch)(key, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (result.status === 429) cooldowns.set(origin, Math.max(
        cooldowns.get(origin) ?? 0,
        now() + retryAfterMs(result.headers.get("Retry-After"), now()),
      ));
      if (result.status === 200 && /^application\/(?:json|[\w.-]+\+json)(?:\s*;|$)/i.test(result.headers.get("Content-Type") || "")) {
        const body = await result.text();
        let payload: unknown;
        try { payload = JSON.parse(body); } catch { return Response.json({ error: "NHL returned invalid JSON." }, { status: 502 }); }
        const entry = { expires: now() + nhlTtl(url, now(), payload) * 1000, body };
        if (successful.size >= 100) successful.delete(successful.keys().next().value!);
        successful.set(key, entry);
        if (draft) {
          try { storage()?.setItem(storageKey, JSON.stringify(entry)); } catch { /* Cache is optional. */ }
        }
        return new Response(body, { status: result.status, headers: result.headers });
      }
      return result;
    });
    pending.set(key, work);
    try { return (await work).clone(); }
    finally { if (pending.get(key) === work) pending.delete(key); }
  };
}

export const nhlFetch = createNhlClient();
