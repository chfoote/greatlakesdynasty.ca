interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const routes = [
  { prefix: "/nhl-api", origin: "https://api.nhle.com", base: "/stats/rest/en" },
  { prefix: "/nhl-web-api", origin: "https://api-web.nhle.com", base: "/v1" },
  { prefix: "/nhl-search-api", origin: "https://search.d3.nhle.com", base: "/api/v1" },
];

function jsonError(message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = routes.find(({ prefix }) =>
      url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    );
    if (!route) return env.ASSETS.fetch(request);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonError("NHL API routes support GET and HEAD only.", 405, { Allow: "GET, HEAD" });
    }

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
        if (!upstream.ok) headers.set("Cache-Control", "no-store");

        const contentType = upstream.headers.get("Content-Type") || "";
        if (request.method === "GET" && upstream.status !== 204
          && !/^application\/(?:json|[\w.-]+\+json)(?:\s*;|$)/i.test(contentType)) {
          await upstream.body?.cancel();
          const errorHeaders: Record<string, string> = {};
          const retryAfter = headers.get("Retry-After");
          if (retryAfter) errorHeaders["Retry-After"] = retryAfter;
          return jsonError("NHL upstream returned a non-JSON response.", upstream.ok ? 502 : upstream.status, errorHeaders);
        }
        return new Response(request.method === "HEAD" ? null : upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers,
        });
      }
      return jsonError("NHL upstream returned an unsupported redirect.", 502);
    } catch {
      return jsonError(signal.aborted ? "NHL upstream timed out." : "Unable to reach NHL upstream.", signal.aborted ? 504 : 502);
    }
  },
};
