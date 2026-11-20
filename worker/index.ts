import { createLimiter, nhlTtl, retryAfterMs } from "../shared/nhl-policy.ts";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const routes = [
  { prefix: "/nhl-api", origin: "https://api.nhle.com", base: "/stats/rest/en" },
  { prefix: "/nhl-web-api", origin: "https://api-web.nhle.com", base: "/v1" },
  { prefix: "/nhl-search-api", origin: "https://search.d3.nhle.com", base: "/api/v1" },
];

function jsonError(message: string, status: number, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  return Response.json({ error: message }, {
    status,
    headers: responseHeaders,
  });
}

interface PublicCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

interface WorkerOptions {
  cache?: () => Promise<PublicCache | undefined>;
  now?: () => number;
}

interface ResponseSnapshot {
  body: ArrayBuffer | null;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
}

function fromSnapshot(snapshot: ResponseSnapshot) {
  return new Response(snapshot.body?.slice(0) ?? null, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
}

export function createWorker(options: WorkerOptions = {}) {
  const now = options.now ?? Date.now;
  const limited = createLimiter(4);
  // Share bytes rather than Response streams: workerd forbids consuming I/O
  // created by a different request context, even within the same isolate.
  const pending = new Map<string, Promise<ResponseSnapshot>>();
  // Only cooldown timestamps are kept, never a cached 429/error response.
  const cooldowns = new Map<string, number>();
  const getCache = options.cache ?? (async () =>
    typeof caches === "undefined" ? undefined : caches.open("gld-public-nhl-v1"));
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const route = routes.find(({ prefix }) =>
        url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
      );
      if (!route) return env.ASSETS.fetch(request);

      if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonError("NHL API routes support GET and HEAD only.", 405, { Allow: "GET, HEAD" });
      }

      let cache: PublicCache | undefined;
      // Strip browser credentials/headers from cache identity; these fixed NHL APIs
      // always fetch the same public representation. Keep the entire query string.
      const key = new Request(url.toString(), { method: "GET" });
      if (request.method === "GET") {
        try {
          cache = await getCache();
          const hit = await cache?.match(key);
          if (hit) {
            const result = new Response(hit.body, hit);
            result.headers.set("X-NHL-Cache", "HIT");
            return result;
          }
        } catch { /* Edge cache availability must not break NHL routing. */ }
        const inFlight = pending.get(key.url);
        if (inFlight) {
          const result = fromSnapshot(await inFlight);
          result.headers.set("X-NHL-Cache", "COALESCED");
          return result;
        }
      }

      const work = limited(async () => {
        const until = cooldowns.get(route.origin) ?? 0;
        if (until > now()) return jsonError("NHL requests paused after upstream rate limiting.", 429, {
          "Retry-After": String(Math.ceil((until - now()) / 1000)),
          "X-NHL-Source": "cooldown",
          "X-NHL-Cache": "BYPASS",
        });
        // Concatenation keeps even a double-slash suffix on the fixed NHL host.
        // Do not forward browser cookies, Authorization, Origin, or arbitrary headers.
        let upstreamUrl = new URL(route.origin + route.base + url.pathname.slice(route.prefix.length) + url.search);
        const signal = AbortSignal.timeout(15_000);
        try {
          for (let redirects = 0; redirects <= 3; redirects++) {
            const upstream = await fetch(upstreamUrl, {
              method: request.method,
              headers: { Accept: "application/json" },
              redirect: "manual",
              signal,
            });

            if ([301, 302, 303, 307, 308].includes(upstream.status)) {
              const location = upstream.headers.get("Location");
              await upstream.body?.cancel();
              if (!location || redirects === 3) break;
              const next = new URL(location, upstreamUrl);
              // Follow NHL redirects internally, never redirect the browser off-site
              // or allow an upstream redirect to turn this into an arbitrary proxy.
              if (next.origin !== route.origin || next.username || next.password
                || !(next.pathname === route.base || next.pathname.startsWith(`${route.base}/`))) break;
              upstreamUrl = next;
              continue;
            }

            const headers = new Headers();
            for (const name of ["Content-Type", "Cache-Control", "ETag", "Last-Modified", "Retry-After"]) {
              const value = upstream.headers.get(name);
              if (value) headers.set(name, value);
            }
            headers.set("X-Content-Type-Options", "nosniff");
            headers.set("X-NHL-Source", "upstream");
            headers.set("X-NHL-Upstream-Status", String(upstream.status));
            headers.set("X-NHL-Cache", "BYPASS");
            for (const [original, diagnostic] of [["CF-Ray", "X-NHL-Upstream-CF-Ray"], ["Server", "X-NHL-Upstream-Server"]]) {
              const value = upstream.headers.get(original);
              if (value) headers.set(diagnostic, value);
            }
            if (upstream.status === 429) {
              const delay = retryAfterMs(upstream.headers.get("Retry-After"), now());
              cooldowns.set(route.origin, Math.max(cooldowns.get(route.origin) ?? 0, now() + delay));
              if (!headers.has("Retry-After")) headers.set("Retry-After", String(Math.ceil(delay / 1000)));
            }
            if (!upstream.ok) headers.set("Cache-Control", "no-store");

            const contentType = upstream.headers.get("Content-Type") || "";
            if (request.method === "GET" && upstream.status !== 204
              && !/^application\/(?:json|[\w.-]+\+json)(?:\s*;|$)/i.test(contentType)) {
              await upstream.body?.cancel();
              const errorHeaders: Record<string, string> = Object.fromEntries(headers.entries());
              delete errorHeaders["content-type"];
              return jsonError("NHL upstream returned a non-JSON response.", upstream.ok ? 502 : upstream.status, errorHeaders);
            }
            const result = new Response(request.method === "HEAD" ? null : upstream.body, {
              status: upstream.status,
              statusText: upstream.statusText,
              headers,
            });
            if (request.method === "GET" && upstream.status === 200) {
              // Validate before caching so an invalid JSON success cannot poison cache.
              let payload: unknown;
              try { payload = await result.clone().json(); }
              catch { return jsonError("NHL upstream returned invalid JSON.", 502, { "X-NHL-Source": "upstream" }); }
              result.headers.set("Cache-Control", `public, max-age=${nhlTtl(url, now(), payload)}`);
              result.headers.set("X-NHL-Cache", "MISS");
              if (cache) {
                try { await cache.put(key, result.clone()); }
                catch { /* A cache write failure must not hide valid NHL data. */ }
              }
            }
            return result;
          }
          return jsonError("NHL upstream returned an unsupported redirect.", 502);
        } catch {
          return jsonError(signal.aborted ? "NHL upstream timed out." : "Unable to reach NHL upstream.", signal.aborted ? 504 : 502);
        }
      }).then(async (result): Promise<ResponseSnapshot> => ({
        body: result.body ? await result.arrayBuffer() : null,
        status: result.status,
        statusText: result.statusText,
        headers: [...result.headers.entries()],
      }));
      if (request.method === "GET") pending.set(key.url, work);
      try { return fromSnapshot(await work); }
      finally { if (pending.get(key.url) === work) pending.delete(key.url); }
    },
  };
}

export default createWorker();
