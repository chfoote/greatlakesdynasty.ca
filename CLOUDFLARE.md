# Great Lakes Dynasty: Cloudflare Worker deployment

This repository targets **Workers Static Assets**, not Cloudflare Pages. The existing
Worker is `greatlakesdynasty-ca` at
`https://greatlakesdynasty-ca.chfoote.workers.dev`.

## Why statistics failed

Vite's `server.proxy` works only under `npm run dev`. Cloudflare does not execute
the rewrites in `vercel.json`. An assets-only deployment therefore returned the
React `index.html` fallback for NHL API requests. The app attempted to parse HTML
as JSON. Standings also swallowed failed stats requests into empty arrays, producing
zero totals; failures now reach the page's existing error display.

`wrangler.jsonc` now selects `worker/index.ts` and the built `dist` assets. Only
the three NHL prefixes run the Worker first, including requests made as browser
navigations. Other routes retain Cloudflare's React SPA fallback and asset serving.

| Browser prefix | Fixed upstream |
| --- | --- |
| `/nhl-api` | `https://api.nhle.com/stats/rest/en` |
| `/nhl-web-api` | `https://api-web.nhle.com/v1` |
| `/nhl-search-api` | `https://search.d3.nhle.com/api/v1` |

Path suffixes and encoded query strings are preserved. The proxy only supports GET
and HEAD, forwards no browser credentials, and adds no CORS permissions. It follows
up to three redirects within the same approved NHL origin and base path. Upstream
errors retain their status; non-JSON success responses and network failures become
JSON 502 errors, and upstream timeouts become JSON 504 errors. It never falls back
to React for a matching API route.

The Vite development proxies, Vercel configuration, Supabase configuration, database,
authentication, and credentials are unchanged. `keep_vars` preserves dashboard-set
Worker variables when deploying. No account IDs, routes, custom domains, or secrets
are added to Wrangler. API proxy requests still count as Worker invocations; this
initial routing fix did not reduce frontend polling or promise free-tier capacity.

## Local follow-up: caching and rate-limit handling

The currently proposed follow-up is local only; it has not been committed, pushed,
or deployed. The user observed HTTP 429 on about ten historical draft requests.
A skater summary response was HTTP 200 from browser disk cache, which does not
verify a fresh production fetch. Diagnostic requests from this environment to both
production and direct NHL endpoints returned Cloudflare HTTP 403 / error 1010
(`browser_signature_banned`), not the reported 429. Therefore the precise limiter
is **unconfirmed**. The original Worker has no application-generated 429 branch or
rate-limit binding: a 429 reaching its upstream-response branch is passed through,
but Cloudflare can also reject requests before that code runs. `Server: cloudflare`
alone does not distinguish these cases. Actual 429 headers/body or Cloudflare
request/security logs are needed to establish the source.

Confirmed request amplification: the original Worker forwarded every request, the
browser fetched overlapping stats/game data, and `fetchProspectRights` started ten
draft-year fetches alongside optional stats metadata. It also kept rejected draft
promises indefinitely. These are traffic/recovery defects, not proof of which
service imposed the observed limit.

The follow-up uses Cloudflare's supported named Cache API for **HTTP 200, valid
JSON, public NHL GET responses only**. Full URL queries remain part of identity.
Only the existing fixed NHL origins are reachable. No Supabase URLs or responses
enter this cache or the frontend NHL client.

| Data | Maximum configured TTL per cache layer |
| --- | --- |
| Live scoreboard/game data | 15 seconds |
| Current-season stat reports | 60 seconds |
| Current-season player bios | 6 hours |
| Completed-season reports | 24 hours |
| Current-season completed games | 5 minutes |
| Completed games from older seasons | 24 hours |
| Scoreboards more than two days old | 6 hours |
| Prior-calendar-year draft picks | 7 days |
| Current/future-calendar-year draft picks | 1 hour |
| Player landing pages and searches | 1 hour |

All errors, including HTTP 429, bypass caching. Only a per-origin cooldown timestamp
is retained after 429. Both seconds and HTTP-date `Retry-After` values are respected;
missing/invalid values default to 60 seconds. There are **no automatic retries**.
Requests already in flight may finish; queued requests check cooldown before fetching.
Fresh successful cache entries remain usable during cooldown.

The Worker deduplicates identical requests and bounds upstream concurrency to four
per isolate. It shares buffered bytes, not live Response streams, across request
contexts, as required by workerd. The frontend uses three concurrent NHL requests,
an expiring/bounded in-memory success cache, in-flight deduplication, and a public
draft-only localStorage cache. Disabling/full localStorage degrades to network and
memory caching without breaking the app. Public draft caches are shared across
page visits/reloads; private roster and ownership data is read fresh.

Stats pages load draft/rights enrichment only after stats succeed and while the
page is still active. Historical draft fetching also waits for valid league/farm
metadata. The original draft range is preserved for correct ownership badges; a
cold cache still needs the draft classes for features that actually use them.
The main hockey team, standings, and Around the Horn polling timers skip hidden
tabs. Scoring formulas, authentication, database content, and styling are unchanged.

### Diagnostics after an approved deployment

- `X-NHL-Source: upstream` and `X-NHL-Upstream-Status: 429` identify a 429 received
  by the Worker from its NHL subrequest (possibly an upstream CDN).
- `X-NHL-Source: cooldown` identifies the Worker's deliberate pause after a prior
  upstream 429. `Retry-After` reports the remaining wait.
- `X-NHL-Upstream-CF-Ray` and `X-NHL-Upstream-Server`, when present, are copied from
  the upstream response; the ordinary `CF-Ray` identifies the outer request.
- `X-NHL-Cache: HIT`, `MISS`, `COALESCED`, or `BYPASS` describes Worker caching.
- A 429 without Worker diagnostics still requires Cloudflare logs/body inspection;
  absence of these headers alone is not proof of a specific limiter.

The Cache API is local to each Cloudflare data center. In-flight deduplication,
concurrency and cooldown state are best-effort **per isolate**, not a globally
coordinated limiter. Frontend caching is per browser. Layered caches can compound
data age. Cache hits within a Worker still count as Worker invocations, so this
does not bypass Cloudflare account quotas or guarantee free-tier capacity.

### Follow-up checks

```sh
npm run build
npx --no-install tsc -p tsconfig.app.json
npx --no-install tsc -p tsconfig.worker.json
npm run test:worker
npm run test:nhl
npm run test:nhl:runtime
npm run check:deploy
```

The runtime check uses workerd and simulated NHL responses, without calling
production or Supabase. It verifies real Cache API MISS/HIT behavior, simultaneous
request deduplication, cooldown and asset delegation. Live NHL success/rate-limit
verification remains limited by the diagnostic 403 responses noted above. The
runtime/bundler are the versions already installed and locked with Wrangler; no
new dependency installation is required.

Final local results: production build, frontend and Worker TypeScript checks, all
38 unit tests (25 Worker and 13 frontend/policy), the workerd runtime check, and
Wrangler deployment dry run passed. Existing CSS minification/bundle warnings
remain. No signed-in production test or database access was performed.

## Local checks (no deployment)

### Local follow-up: missing player records

After the caching release, missing players were reported in both 2026 and 2027.
An application-loader defect was reproduced using simulated NHL responses: the
old reader ignored the report's `total` and accepted only the first `data` array,
even when additional records were advertised. This can drop most players and
leave their IDs absent from the maps used for team statistics and standings.
Live production response counts remain unverified because diagnostic requests
from this environment returned HTTP 403 / Cloudflare error 1010.

The proposed local fix adds `src/lib/nhlReports.ts` and routes every stat report
through it. It retains the unlimited first request, requests additional pages
sequentially only when necessary, sorts consistently by player ID, advances by
actual returned row counts, and checks completeness before publishing the result
to the application. New sort/start query parameters avoid reusing the old report
cache keys. Existing rate-limit cooldown, caching, and concurrency limits apply.
There are no automatic retries, database changes, scoring changes, or cache purges.

Invalid, empty intermediate, repeated, changing, or inconsistent pages fail clearly
rather than silently loading partial stats. Team-page fallback request errors now
reach the existing stats error display instead of becoming empty lists. A complete
unlimited report still uses one request; a truncated report requires more requests
to retrieve the missing data, and a 429 aborts without accepting partial results.

Local validation passed: production build, both TypeScript checks, 46 unit tests
(25 Worker and 21 NHL/frontend), the workerd runtime check, and Wrangler dry run.
New regression tests exercise the actual 2026/2027 skater and goalie loaders with
120 players while the initial API response contains only five; all player IDs,
enrichment fields, and scoring lookups survive. Existing build warnings remain.
The fix is not committed, pushed, or deployed. Production must still be checked
after an approved deployment to confirm the reported symptom is resolved.

Use Node 24 LTS (the tests import TypeScript using Node's built-in type stripping).

```sh
npm ci
npm run build
npm run test:worker
npm run check:deploy
npm run preview:worker
```

`check:deploy` is a Wrangler **dry run**, not a deployment. The preview serves the
last `dist` build, so rebuild after frontend changes. It proxies real NHL requests;
do not use write features in the preview, because the app still connects to your
existing Supabase project. Local development can continue with `npm run dev`.

With the Worker preview running, open the local URL Wrangler prints. Check these
paths using browser developer tools (Network tab):

- `/nhl-api/skater/summary?limit=1&cayenneExp=seasonId%3D20262027%20and%20gameTypeId%3D2`
- `/nhl-api/goalie/summary?limit=1&cayenneExp=seasonId%3D20262027%20and%20gameTypeId%3D2`
- `/nhl-web-api/score/2026-11-19`
- `/nhl-search-api/search/player?culture=en-us&limit=1&q=McDavid`
- `/standings` (including a direct reload), `/`, and the JS/CSS files under `/assets/`.

API responses should be JSON with their real status, never HTML 200. An empty NHL
`data` array is valid for a season/date with no available records. Standings depend
on both NHL records and matching Supabase roster player IDs and seasons. Routing
tests cannot verify private roster records. If totals remain zero after JSON is
restored, inspect the selected season, roster IDs, and returned records before
changing scoring rules or league data.

### Local verification completed

- Production build and frontend/Worker TypeScript checks passed. Vite reported CSS
  minification warnings and a large bundle warning; styling was not changed.
- All 17 Worker tests passed, covering mappings, encoded queries, credential
  isolation, asset delegation, methods, upstream errors, redirects, and timeouts.
- Wrangler's deployment dry run validated the Worker and asset configuration.
- The local Wrangler runtime returned HTTP 200 JSON for skater summary, goalie
  summary, scores, and player search using live NHL upstreams. A nonexistent NHL
  report returned HTTP 500 JSON rather than HTML 200.
- The homepage, `/standings` deep link, and built JavaScript asset returned HTTP
  200 with appropriate content types. An NHL browser-navigation request returned
  JSON, verifying Worker-first routing overrides SPA navigation fallback.
- A read-only production request confirmed the old NHL route still returned HTML.
  No production deployment, Supabase queries, or data writes were performed.

Dependency installation also reported 22 npm audit findings. These have not been
remediated or attributed in this routing change; no automatic audit fixes were run.

## Verify GitHub deployment settings before pushing

There is no GitHub Actions workflow or previous Wrangler configuration in this
checkout. The reported deployment uses Cloudflare's GitHub connection; its actual
dashboard settings cannot be verified from repository files.

In Cloudflare, open **Workers & Pages → greatlakesdynasty-ca → Settings → Build**.
Check the following before pushing, since a push may immediately deploy:

| Setting | Required value |
| --- | --- |
| Connected repository | `chfoote/greatlakesdynasty.ca` |
| Production branch | Your intended release branch; verify its actual name |
| Root directory | Repository root |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch command, if enabled | `npx wrangler versions upload` |

An assets-only deploy command such as `wrangler deploy --assets dist` must be
replaced by `npx wrangler deploy` so the checked-in Worker entrypoint is included.
Do not add a second GitHub Actions deployment alongside Workers Builds.
If automatic builds are disabled, pushing alone will not deploy: trigger a build
for the approved commit from the Worker's Builds screen.

The build must retain its existing `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` values. Do not replace, rotate, or expose them, or add a
Supabase service-role key. These Vite values are compiled into the frontend at
build time; runtime Worker variables do not substitute for missing build values.
If the connected workflow differs, inspect it before proceeding.

## Commit, push, and deploy — only after review and approval

First review `git status --short` and `git diff`. Record the currently active
Cloudflare deployment/version in the dashboard for rollback. Confirm the commands
above and the intended release branch. Then:

```sh
git add CLOUDFLARE.md package.json tsconfig.worker.json \
  worker/index.ts worker/index.test.mjs worker/cache.test.mjs \
  shared/nhl-policy.ts shared/nhl-policy.test.mjs \
  scripts/test-nhl-runtime.mjs src/lib/nhlRequest.ts src/lib/nhlRequest.test.mjs \
  src/lib/nhl.ts src/lib/goalFeed.ts src/lib/prospectRights.ts \
  src/pages/League/SkaterStats.tsx src/pages/League/GoalieStats.tsx \
  src/pages/League/HockeyTeamDetail.tsx src/pages/League/Standings.tsx \
  src/pages/League/GoalHorn.tsx
git diff --cached --stat
git commit -m "Cache public NHL responses and respect rate limits"
git push origin HEAD
```

Use `git push origin HEAD` only on the intended branch with an existing same-named
remote branch. If working on a new review branch, push it with
`git push -u origin YOUR_REVIEW_BRANCH` and review/merge through GitHub instead.
Do not stage `.env`, `dist`, or `.wrangler`.

If production Workers Builds is enabled, the release-branch push/merge starts the
deployment automatically; do not also deploy locally. Check its logs for the new
commit and Worker entrypoint. Otherwise, manually trigger the connected build for
that commit. If deploying manually from this checkout instead of Workers Builds,
verify the Cloudflare account with `npx wrangler whoami`, run `npm run build`, then
run `npx wrangler deploy` only after approval.

After deployment, repeat the JSON checks at the production URL, sign in, check team
stats and standings, and reload a deep link. No DNS changes are needed for this
existing workers.dev URL. If checks fail, roll back to the recorded deployment
using Cloudflare's deployment/version history; database changes are unnecessary.
