import { savedKey, savedRetention, savedResponse } from "./saved.ts";
import { isLiveNhlPath, nhlTtl, retryAfterMs } from "../shared/nhl-policy.ts";
import { nhlStatsDate } from "../shared/nhl-live.ts";
import { createSnapshotBuilder, SnapshotError } from "./liveSnapshot.ts";
import { createWorkerScheduler, WorkerQueueFullError } from "./scheduler.ts";
import { buildCompleteReport, CompleteReportError, validateCompleteReportQuery } from "./completeReport.ts";
import { farmSnapshotCron, refreshFarmSnapshot } from "./farmSnapshots.ts";
import { rankingSnapshotCron, refreshRankingSnapshot } from "./rankingSnapshots.ts";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  RANKING_SNAPSHOTS_SUPABASE_URL?: string;
  RANKING_SNAPSHOTS_SERVICE_ROLE_KEY?: string;
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

function preventOuterNhlCaching(response: Response) {
  const headers = new Headers(response.headers);
  // The Worker Cache API above is the single freshness authority for public
  // NHL JSON. Prevent zone/browser defaults from stretching a 30-second or
  // five-minute API response to four hours on the custom domain.
  headers.set("Cache-Control", "no-store");
  headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

interface PublicCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

interface BackgroundContext { waitUntil(work: Promise<unknown>): void; }

interface WorkerOptions {
  cache?: () => Promise<PublicCache | undefined>;
  now?: () => number;
  statsGapMs?: number;
  fetcher?: typeof fetch;
}

interface ResponseSnapshot {
  body: ArrayBuffer | null;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
}

export function dailyWarmPaths(timestamp = Date.now()) {
  const hockeyDate = nhlStatsDate(0, timestamp);
  const year = Number(hockeyDate.slice(0, 4));
  const month = Number(hockeyDate.slice(5, 7));
  const startYear = month >= 7 ? year : year - 1;
  const seasonId = startYear * 10000 + startYear + 1;
  const expression = `seasonId=${seasonId} and gameTypeId=2`;
  const sort = JSON.stringify([{ property: "playerId", direction: "ASC" }]);
  const report = (position: "skater" | "goalie", name: "summary" | "realtime" | "faceoffwins") => {
    const params = new URLSearchParams({ cayenneExp: expression, sort, start: "0" });
    return `/nhl-api/complete/${position}/${name}?${params}`;
  };
  return [
    report("skater", "summary"), report("skater", "realtime"),
    report("skater", "faceoffwins"), report("goalie", "summary"),
    `/nhl-web-api/live-snapshot/${hockeyDate}`,
  ];
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
  const statsGap = options.statsGapMs ?? (typeof caches === "undefined" ? 0 : 1250);
  const schedule = createWorkerScheduler({ maximum: 4, statsGapMs: statsGap, now, reserveLiveSlot: true, maximumWaitMs: 60_000 });
  const buildSnapshot = createSnapshotBuilder(now);
  // Only cooldown timestamps are kept, never a cached 429/error response.
  const cooldowns = new Map<string, number>();
  const getCache = options.cache ?? (async () =>
    typeof caches === "undefined" ? undefined : caches.open("gld-public-nhl-v1"));
  async function remember(cache: PublicCache | undefined, key: Request, result: Response) {
    if (!cache) return;
    try {
      const stored = result.clone();
      stored.headers.set("X-NHL-Saved-At", String(now()));
      stored.headers.set("Cache-Control", `public, max-age=${savedRetention(new URL(key.url).pathname)}`);
      await cache.put(savedKey(key), stored);
    } catch { /* Shared edge fallback is optional. */ }
  }
  async function handle(request: Request, env: Env, cacheEnabled = true, context?: BackgroundContext): Promise<Response> {
      const url = new URL(request.url);
      const route = routes.find(({ prefix }) =>
        url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
      );
      if (!route) return env.ASSETS.fetch(request);

      if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonError("NHL API routes support GET and HEAD only.", 405, { Allow: "GET, HEAD" });
      }

      const snapshotRoute = url.pathname.startsWith("/nhl-web-api/live-snapshot");
      const snapshotDate = url.pathname.match(/^\/nhl-web-api\/live-snapshot\/(\d{4}-\d{2}-\d{2})$/)?.[1];
      if (snapshotRoute && (!snapshotDate || url.search || !Number.isFinite(Date.parse(snapshotDate))
        || new Date(snapshotDate).toISOString().slice(0, 10) !== snapshotDate)) {
        return jsonError("A valid live snapshot date is required.", 400);
      }
      const completeMatch = url.pathname.match(/^\/nhl-api\/complete\/(skater|goalie)\/(summary|realtime|faceoffwins)$/);
      const completeExpression = completeMatch ? validateCompleteReportQuery(url) : undefined;
      if (completeMatch && (!completeExpression || (completeMatch[1] === "goalie" && completeMatch[2] !== "summary"))) {
        return jsonError("A valid complete NHL report query is required.", 400);
      }
      let cache: PublicCache | undefined;
      // Strip browser credentials/headers from cache identity; these fixed NHL APIs
      // always fetch the same public representation. Keep the entire query string.
      const key = new Request(url.toString(), { method: "GET" });
      if (request.method === "GET") {
        try {
          cache = cacheEnabled ? await getCache() : undefined;
          const hit = await cache?.match(key);
          if (hit) {
            const result = new Response(hit.body, hit);
            result.headers.set("X-NHL-Cache", "HIT");
            return result;
          }
          // Report pages feed a second complete-dataset cache in the browser.
          // Returning stale pages on every expiry can keep that dataset one
          // cycle behind forever. Await revalidation here; errors still use the
          // last-good fallback in fetch() below. Profiles/drafts may refresh later.
          if (cache && context && route.prefix !== "/nhl-api"
            && !url.pathname.startsWith("/nhl-web-api/live-snapshot/")) {
            const saved = await cache.match(savedKey(key));
            const stale = saved && savedResponse(saved, undefined, now(), url.pathname);
            if (stale) {
              // waitUntil keeps this request's own timers/fetches alive after
              // returning the saved JSON. Background errors never replace it.
              context.waitUntil(handle(request, env, true).then(async result => {
                await result.body?.cancel();
              }).catch(() => {}));
              return stale;
            }
          }
        } catch { /* Edge cache availability must not break NHL routing. */ }
      }

      const loadUpstream = async () => {
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
          for (let redirects = 0; redirects <= (cacheEnabled ? 3 : 0); redirects++) {
            const upstream = await (options.fetcher ?? fetch)(upstreamUrl, {
              method: request.method,
              headers: { Accept: "application/json" },
              redirect: "manual",
              signal,
            });

            if ([301, 302, 303, 307, 308].includes(upstream.status)) {
              const location = upstream.headers.get("Location");
              await upstream.body?.cancel();
              if (!location || !cacheEnabled || redirects === 3) break;
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
            // Internal snapshot calls must finish reading their body before
            // releasing the scheduler slot (not just after response headers).
            const body = request.method === "HEAD" ? null
              : !cacheEnabled && upstream.body ? await upstream.arrayBuffer() : upstream.body;
            const result = new Response(body, {
              status: upstream.status,
              statusText: upstream.statusText,
              headers,
            });
            if (cacheEnabled && request.method === "GET" && upstream.status === 200) {
              // Validate before caching so an invalid JSON success cannot poison cache.
              let payload: unknown;
              try { payload = await result.clone().json(); }
              catch { return jsonError("NHL upstream returned invalid JSON.", 502, { "X-NHL-Source": "upstream" }); }
              result.headers.set("Cache-Control", `public, max-age=${nhlTtl(url, now(), payload)}`);
              result.headers.set("X-NHL-Cache", "MISS");
              if (cache) {
                try { await cache.put(key, result.clone()); await remember(cache, key, result); }
                catch { /* A cache write failure must not hide valid NHL data. */ }
              }
            }
            return result;
          }
          return jsonError("NHL upstream returned an unsupported redirect.", 502);
        } catch {
          return jsonError(signal.aborted ? "NHL upstream timed out." : "Unable to reach NHL upstream.", signal.aborted ? 504 : 502);
        }
      };
      // Build the bundle outside the limiter: its individual fixed NHL requests
      // acquire slots themselves, avoiding nested-limiter deadlocks.
      const work = (completeMatch && completeExpression ? (async () => {
        try {
          const payload = await buildCompleteReport(completeMatch[1] as "skater" | "goalie",
            completeMatch[2] as "summary" | "realtime" | "faceoffwins", completeExpression, async path => {
              const pageRequest = new Request(url.origin + path);
              const result = await handle(pageRequest, env, true);
              if (result.status < 400) return result;
              try {
                const saved = await cache?.match(savedKey(pageRequest));
                const fallback = saved && savedResponse(saved, result, now(), new URL(path, url.origin).pathname);
                if (fallback) { await result.body?.cancel(); return fallback; }
              } catch { /* Keep the page error when no last-good page is available. */ }
              return result;
            });
          const headers = new Headers({
            "Cache-Control": `public, max-age=${nhlTtl(url, now(), payload)}`,
            "X-NHL-Cache": "MISS",
            "X-NHL-Source": "complete-report",
          });
          if (payload.savedAt) {
            headers.set("Cache-Control", "no-store");
            headers.set("X-NHL-Stale", "1");
            headers.set("X-NHL-Saved-At", String(payload.savedAt));
            if (payload.failureStatus) headers.set("X-NHL-Failure-Status", payload.failureStatus);
          }
          const result = Response.json({ data: payload.data, total: payload.total }, { headers });
          // A complete response assembled from last-good pages is safe to return,
          // but must not replace a newer complete report in shared storage.
          if (cache && request.method === "GET" && !payload.savedAt) {
            try { await cache.put(key, result.clone()); await remember(cache, key, result); } catch { /* Cache is optional. */ }
          }
          return request.method === "HEAD" ? new Response(null, result) : result;
        } catch (error) {
          if (error instanceof CompleteReportError) return jsonError(error.message, error.status, {
            ...error.diagnostics,
            "X-NHL-Source": `complete-${error.diagnostics["X-NHL-Source"] || "error"}`,
            ...(error.retryAfter ? { "Retry-After": error.retryAfter } : {}),
          });
          return jsonError("Unable to build complete NHL statistics.", 502);
        }
      })() : snapshotDate ? (async () => {
        try {
          const payload = await buildSnapshot(snapshotDate, (path) => handle(new Request(url.origin + path), env, false));
          const result = Response.json(payload, { headers: {
            "Cache-Control": `public, max-age=${nhlTtl(url, now(), payload)}`,
            "X-NHL-Cache": "MISS", "X-NHL-Source": "snapshot",
          } });
          if (cache && request.method === "GET") {
            try { await cache.put(key, result.clone()); await remember(cache, key, result); } catch { /* Cache is optional. */ }
          }
          return request.method === "HEAD" ? new Response(null, result) : result;
        } catch (error) {
          if (error instanceof SnapshotError) return jsonError(error.message, error.status, {
            ...error.diagnostics,
            "X-NHL-Source": `snapshot-${error.diagnostics["X-NHL-Source"] || "error"}`,
            ...(error.retryAfter ? { "Retry-After": error.retryAfter } : {}),
          });
          return jsonError("Unable to build complete NHL live data.", 502);
        }
      })() : schedule(route.origin === "https://api.nhle.com" && statsGap > 0, loadUpstream, isLiveNhlPath(url.pathname))
        .catch((error: unknown) => {
          if (!(error instanceof WorkerQueueFullError)) throw error;
          return jsonError(error.message, 503, { "Retry-After": "5", "X-NHL-Source": "queue", "X-NHL-Cache": "BYPASS" });
        })).then(async (result): Promise<ResponseSnapshot> => ({
        body: result.body ? await result.arrayBuffer() : null,
        status: result.status,
        statusText: result.statusText,
        headers: [...result.headers.entries()],
      }));
      // Do not share an in-flight promise across Worker requests. Even if its
      // eventual value is copied into plain bytes, workerd can reject awaiting
      // I/O owned by another request context (error 1101). The browser client
      // already deduplicates identical calls, while Cache API handles completed
      // responses safely across visitors.
      return fromSnapshot(await work);
  }
  const worker = { async fetch(request: Request, env: Env, context?: BackgroundContext) {
    let result: Response;
    try { result = await handle(request, env, true, context); }
    catch { return jsonError("Unable to complete the NHL request.", 502, { "X-NHL-Source": "worker-error" }); }
    const url = new URL(request.url);
    const nhlRoute = routes.some(({ prefix }) => url.pathname === prefix || url.pathname.startsWith(prefix + "/"));
    if (!nhlRoute) return result;
    if (request.method !== "GET" || result.status < 400 || [400, 404, 405].includes(result.status)) {
      return preventOuterNhlCaching(result);
    }
    try {
      const cache = await getCache();
      const saved = await cache?.match(savedKey(request));
      if (saved) {
        const fallback = savedResponse(saved, result, now(), url.pathname);
        if (fallback) { await result.body?.cancel(); return preventOuterNhlCaching(fallback); }
      }
    } catch { /* Keep the original error if shared storage is unavailable. */ }
    return preventOuterNhlCaching(result);
  }, async scheduled(controller: { cron?: string }, env: Env, context: BackgroundContext) {
    if (controller.cron === farmSnapshotCron) {
      const url = env.RANKING_SNAPSHOTS_SUPABASE_URL, key = env.RANKING_SNAPSHOTS_SERVICE_ROLE_KEY;
      if (!url || !key) return;
      let subrequests = 0;
      const limitedFetch: typeof fetch = (input, init) => {
        if (++subrequests > 49) return Promise.reject(new Error("Farm snapshot subrequest budget exhausted."));
        return fetch(input, init);
      };
      const source = createWorker({cache:async()=>undefined,fetcher:limitedFetch});
      context.waitUntil(refreshFarmSnapshot({url,key,fetcher:limitedFetch,now:now(),
        getReport:path=>source.fetch(new Request(`https://farm-snapshot.gldhl.invalid${path}`),env)}));
      return;
    }
    if (controller.cron === rankingSnapshotCron) {
      const url = env.RANKING_SNAPSHOTS_SUPABASE_URL;
      const key = env.RANKING_SNAPSHOTS_SERVICE_ROLE_KEY;
      if (!url || !key) return;
      // Read from the provider so completed ranges can pick up corrections
      // even when the visitor-facing historical report cache is still warm.
      let subrequests = 0;
      const limitedFetch: typeof fetch = (input, init) => {
        if (++subrequests > 49) return Promise.reject(new Error("Ranking snapshot subrequest budget exhausted."));
        return fetch(input, init);
      };
      const source = createWorker({ cache: async () => undefined, statsGapMs: 15_000, now, fetcher: limitedFetch });
      context.waitUntil(refreshRankingSnapshot({
        url, key, now: now(), fetcher: limitedFetch,
        getReport: path => source.fetch(new Request(`https://ranking-snapshot.gldhl.invalid${path}`), env),
      }));
      return;
    }
    // One shared refresh after the overnight NHL window keeps every stats-backed
    // page ready without making every member rebuild the same reports. Keep the
    // work sequential so this maintenance run cannot burst the upstream API.
    context.waitUntil((async () => {
      for (const path of dailyWarmPaths(now())) {
        try {
          const response = await worker.fetch(new Request(`https://daily-cache.gldhl.invalid${path}`), env, context);
          await response.body?.cancel();
        } catch { /* The next visitor can safely retry any dataset that failed to warm. */ }
      }
    })());
  } };
  return worker;

}

export default createWorker();
