# Great Lakes Dynasty: Cloudflare Worker deployment

This repository targets **Workers Static Assets**, not Cloudflare Pages. The existing
Worker is `greatlakesdynasty-ca` at
`https://greatlakesdynasty-ca.chfoote.workers.dev`.

## Proposed local request reductions

These changes are local and require review before committing/publishing. They
preserve the complete-player report reader already present in the checkout.

- Current-season report caches and season-view polling use five minutes. Live
  views update every 30 seconds while games are active. Historical report and
  draft TTLs stay at one day and seven days respectively.
- Team pages, daily standings, and Around the Horn share one public
  `/nhl-web-api/live-snapshot/YYYY-MM-DD` response containing the scoreboard,
  box scores, and play-by-play fields required by the app. No Supabase or private
  data is included. Nothing is removed from the scoring inputs or formulas.
- Upcoming games are not queried for box scores before starting. Polling sleeps
  until scheduled puck drop; unknown/delayed schedules and initial failures use
  five-minute checks. After the final result is confirmed once, network polling
  stops. A local clock check resumes current-day views at the next league date;
  explicitly selected historical dates remain historical.
- Hidden/offline tabs do not poll and overlapping timer refreshes are prevented.
  Failed refreshes retain the last complete daily results instead of clearing them.
- A public-only browser cache shares results across navigation/reloads/tabs, with
  up to 32 tracked entries and a 2 MB entry-data budget. Eviction only removes its
  own `gld:public-nhl:v2:` entries; no authentication keys are touched. Web Locks
  coordinate matching requests and index writes across tabs where supported.
  Without locks/storage the existing per-tab memory cache and deduplication remain.
  Retry-After cooldown timestamps are also shared; error responses are not cached.
- Snapshot age and HTTP cache age are deducted from browser freshness so cache
  layers do not extend live snapshots indefinitely.
- Completed game data is reused within a Worker isolate for five minutes today
  or one day for historical dates. Snapshot JSON omits unrelated upstream fields
  but retains all goal details, rosters, goalie/player stats and event times used
  by scoring and Around the Horn.
- Each snapshot is bounded to 16 unique games and 33 external NHL fetches at most.
  Fan-out is limited to four simultaneous upstream calls and does not follow
  redirects internally. Per-game Cache API operations are skipped for bundle
  construction; the complete bundle uses a single cache match/put. This keeps
  the fan-out within Free-plan limits. Errors and partial bundles are never cached.
- The Vite configureServer middleware runs the same snapshot handler ahead of the
  original development proxies. No Wrangler routes, environment variables,
  database migrations, or additional Cloudflare resources are needed.

For ten games, the scoreboard plus two game requests per game becomes **one
browser-to-Worker live request instead of 21**, before browser reuse. This example
excludes initial season reports/other page metadata and is not an account-usage
measurement. Worker-side caching still counts as a Worker invocation; browser
reuse avoids the request itself. The combined handler does more work per cache
miss, so monitor CPU time and errors after an approved production deployment.

Local tests cover 2026/2027 complete player loading, unchanged scoring lookups,
quiet schedules, final confirmation, cross-tab cache/cooldown reuse, storage
eviction, maximum fan-out, simultaneous bundle builds and the real workerd cache.
The Vite development snapshot route and React `/standings` fallback were also
checked with simulated NHL data, without production or Supabase access.

Final local checks passed: production build and frontend/config/Worker TypeScript
checks, 67 unit tests (32 Worker and 35 NHL/frontend), the real workerd integration
check, the Vite local route check, and Wrangler's deployment dry run. Existing CSS
minification and large-bundle warnings remain. Live production request savings,
upstream access, CPU time, and signed-in behavior require post-deployment checks;
no commit, push, or production deployment was performed for this follow-up.

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
| Current-season stat reports | 5 minutes |
| Combined snapshot during live games | 30 seconds |
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
missing/invalid values default to 60 seconds. The Worker and low-level browser
client never retry automatically. The complete-report reader has one bounded
recovery attempt, described below.
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
There are no database changes, scoring changes, or cache purges. The subsequent
429 follow-up below adds one bounded recovery attempt to complete-report loading.

Invalid, empty intermediate, repeated, changing, or inconsistent pages fail clearly
rather than silently loading partial stats. Team-page fallback request errors now
reach the existing stats error display instead of becoming empty lists. A complete
unlimited report still uses one request; a truncated report requires more requests
to retrieve the missing data. An unresolved 429 fails without accepting partial results.

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
git add CLOUDFLARE.md package.json tsconfig.node.json vite.config.ts \
  worker/index.ts worker/cache.test.mjs worker/liveSnapshot.ts worker/liveSnapshot.test.mjs \
  shared/nhl-policy.ts shared/nhl-policy.test.mjs shared/nhl-live.ts \
  scripts/test-nhl-runtime.mjs src/lib/nhlRequest.ts src/lib/nhlRequest.test.mjs \
  src/lib/nhl.ts src/lib/goalFeed.ts src/lib/nhlReports.test.mjs \
  src/lib/nhlLive.ts src/lib/nhlPolling.ts src/lib/nhlPolling.test.mjs \
  src/pages/League/HockeyTeamDetail.tsx src/pages/League/Standings.tsx \
  src/pages/League/GoalHorn.tsx
git diff --cached --stat
git commit -m "Reduce NHL API request volume"
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

## Follow-up: confirmed production 429 and paced report loading

Read-only production checks of the reported season/date query returned both:

- `X-NHL-Source: upstream`, `X-NHL-Upstream-Status: 429`, and `Retry-After: 1`.
- `X-NHL-Source: cooldown` and `Retry-After: 1` on a subsequent request.

This confirms an upstream subrequest returned 429 and the Worker also enforced its
own cooldown. It does not identify which internal NHL service or upstream CDN rule
issued the original response. `Server: cloudflare` alone is not attribution.

Uncached `api.nhle.com` stats requests now run serially with at least 1.25 seconds
between starts in each browser client and Worker isolate. Browser Web Locks also
serialize the stats lane across tabs when available. This is not a globally shared
rate limiter across Cloudflare isolates. Cache hits avoid the upstream lane.

The complete-report reader may resume the exact blocked page once per report after
at least two seconds and the supplied Retry-After delay, only if that delay is at
most 30 seconds. Missing Retry-After defaults to 60 seconds, so it does not cause an
automatic retry. A second 429 or longer cooldown produces a clear error; already
loaded pages are never presented as complete statistics. A rate-limit failure no
longer triggers an immediate alternate season report on standings/team pages.

Final validation passed: 67 unit tests, production build (including frontend,
configuration and Worker TypeScript), real workerd mock integration including paced
stats requests, and Wrangler deployment dry run. Existing CSS minification and
bundle-size warnings remain. Production success still requires an approved deploy
and real-traffic verification; provider limits and cross-isolate traffic may still
cause 429. No commit, push or deployment was performed.

The Front Office (ManagerCommandCenter) also swallowed each failed NHL report as
an empty list, allowing missing skaters to display zero FPTS beside loaded goalies.
Those failures now reach the existing dashboard error display instead of publishing
misleading totals or mixing a failed current-season report with historical data.
No scoring formulas or contract/roster database operations were changed.

## Worker concurrency correction

A real workerd regression test with six distinct simultaneous uncached stat
requests reproduced HTTP 500 and warnings about promises resolved from another
request context after that context completed. The previous runtime test exercised
same-URL coalescing and sequential stats calls, missing the global queue failure.

The Worker now uses a dedicated scheduler sharing only counters and timestamps.
Each waiting request owns its timer. It retains four concurrent upstream requests
and serial stats pacing, releases slots after failures, and bounds queue waiting
to 30 seconds (JSON 503 with Retry-After, never cached). The browser scheduler is
unchanged. No runtime compatibility flags or production environment variables
are changed.

Validation: 70 unit tests, frontend/config/Worker TypeScript via production build,
real workerd integration with six distinct reports plus a simultaneous snapshot,
and Wrangler dry run passed. The new concurrency test failed on the previous
implementation with runtime-canceled HTTP 500 before passing with the correction.
Production spot checks returned JSON 200 for a small summary query; exact failed
query checks were blocked with 403, so attribution of every reported 500/502 to
this bug is not confirmed. Existing CSS/bundle warnings remain.

## Saved NHL data and background refresh

Complete, assembled NHL skater/goalie datasets are now saved in the browser under
`gld:complete-nhl:v1:` after all required report pages pass completeness checks.
This cache stores only public NHL statistics, not Supabase data or fantasy rosters.
It retains same-season/date datasets for up to seven days, with at most 24 persisted
entries and a three-megabyte serialized budget. Eviction only removes its own keys.
Private/full/disabled browser storage still permits in-memory use.

A fresh copy is reused without fetching. An expired but retained complete copy is
returned immediately and one background refresh starts. Network errors, 429s,
invalid/incomplete reports, or an older shared copy never overwrite a newer complete
local copy. A failed refresh pauses that dataset's next attempt for at least one
minute; the existing NHL client continues to respect longer Retry-After cooldowns.
Visible, online stats pages check their local datasets once per minute; actual
requests still depend on cache expiry, in-flight deduplication and cooldowns.
Background refresh events update only NHL display state, without rerunning league
metadata queries or existing prospect-right maintenance operations.

Standings, team, skater, goalie and Front Office pages reuse these saved datasets.
A notice reports saved data and its update timestamp for the page's season/date.
An existing full live-season snapshot survives live fetch failures. If none exists,
a complete baseline through yesterday can be displayed with a specific notice;
failed live data is never interpreted as zero games or added twice to season totals.
Daily snapshots are keyed by date, so yesterday's results cannot masquerade as today.

The Worker also retains a separate last-successful JSON copy in its existing named
Cloudflare Cache API storage. On expiry, it can immediately return that copy with
`X-NHL-Stale: 1`, `X-NHL-Saved-At`, and `Cache-Control: no-store`, while `waitUntil`
refreshes it. Errors are never written over this copy. Without a background context,
it is available as a fallback after an upstream failure. Retention is six hours for
live snapshots, one day for scoreboards, and seven days for other public NHL routes.
Full path and query string remain part of identity. The frontend carries the saved
source age through report assembly instead of labeling a stale HTTP 200 as fresh.

This shared edge cache is best-effort, per Cloudflare data centre, and may be evicted.
It is not permanent storage. No KV namespace, paid plan, new binding, credential,
production environment variable, database change or manual deployment is required.
A visitor with no retained browser or edge copy still needs one successful NHL load;
this change cannot invent missing statistics during an upstream outage.

Local validation passed: 89 unit tests (49 NHL/frontend and 40 Worker), production
build including frontend/configuration/Worker TypeScript, real workerd integration
covering shared saved fallback and background failure, and Wrangler deployment dry
run. Existing CSS minification and large-bundle warnings remain. Signed-in production
UI behavior still requires post-deployment checking. No commit, push, new Cloudflare
resource, or production deployment was performed for this follow-up.

## Front Office landing-page loading

The initial Front Office render waited on all four current/prior NHL datasets in
one Promise.all with league metadata. Cold, paginated NHL loads and pacing could
therefore hold the entire landing page behind its loading placeholder. Historical
draft/prospect scans also started ahead of these initial stats requests.

The dashboard now renders when its existing account/league metadata reads finish;
NHL loading is separate and cannot fail the entire page. Current skater and goalie
results publish independently before prior-season fallback requests complete. The
existing historical override order is preserved (current season takes precedence).
Missing player scores show an em dash rather than zero, and market rankings wait
for both required current datasets. Prospect scans start after current stats are
available. Unassigned users do not start this NHL work, and leaving the page avoids
starting optional historical requests. No Supabase query definitions, database
writes, authentication, contract math or fantasy scoring formulas were changed.

Four new regression tests cover independent current-result publication, historical
precedence, errors preserving good data, and cancellation of optional work. The NHL
suite now has 53 passing tests; the unchanged Worker suite has 40 passing tests.
The production build/TypeScript checks and deployment dry run passed. Actual signed-in
production load time has not been measured. All follow-up changes remain local.

## Record Book tab loading

Each Record Book tab previously waited for one all-purpose loader: optional daily
record tables, current stats, every roster season (including future contract years),
and all trade/call-up date splits. A failed unrelated report could fail Contracts
and every other tab. The default performance year was also hard-coded to 2026.

The page now selects a loader section for each tab. Contracts uses league/contract
records and stored roster positions without requiring NHL requests. Position leaders
fetch only played/current season reports; franchise views additionally fetch bounded
trade-period reports. Seasonal positional records use the selected/current season.
Future seasons and future date ranges are excluded. Existing fantasy scoring,
contract monetary calculations, and trade-date ownership credit remain in place.
Optional rookie/history failures produce warnings; unavailable rookie rankings are
suppressed instead of being presented as verified complete rankings.

Complete read results are deduplicated and reused in memory by team, season, date,
and section. Supabase data is not added to persistent browser storage. Failed NHL
loads do not silently produce partial all-time totals. Prior successful in-session
results can survive a failed refresh with a timestamp notice. Fast tab switches
ignore obsolete results, historical movement comparisons wait for the main franchise
records, and optional headshots only load for displayed players. A missing franchise
now shows an error rather than leaving the page permanently loading.

The existing admin record-capture action is not executed by these changes or tests.
A guard prevents the saved-data display fallback from being written as fresh verified
daily records, and a successful explicit capture invalidates the in-memory read cache.
No database tables, migrations, credentials, authentication, or production data were
changed. Seven regression tests use mocked read-only sources (database writes throw)
to cover tab isolation, current/future season selection, contract values, franchise
trade credit, deduplication, error handling, and stale-data write protection.

Final local checks passed: 100 unit tests (60 NHL/frontend and 40 Worker), production
build including TypeScript checks, and Wrangler deployment dry run. Existing CSS and
bundle-size warnings remain. No record-capture action, commit, push, or deployment
was performed. Production and signed-in UI verification remain after publication.

## Record Book photo requests

The reported `/nhl-web-api/player/8478402/landing` 429 is a player-profile request
used by the old record cards to discover a photo URL. Those optional requests share
the NHL web/live origin's cooldown and can add avoidable traffic when many cards load.
Record cards now use lazy images directly from NHL's static asset service, retaining
their existing appearance and initials fallback. No profile API call is needed for
these cards. The reported player's static image was checked read-only and returned
HTTP 200 image/png with CDN caching headers. Other profile pages still use their
normal player API data; this change does not replace real statistics with images.

The existing 60 NHL/frontend tests, production build/TypeScript checks, component
render smoke check (lazy image and safe initials fallback), and Wrangler dry run
passed. No push or deployment was initiated for this additional change.

## Measured performance pass

All route pages were eagerly imported into one 2,334,637-byte initial JavaScript
bundle (621,432 bytes gzipped). Routes now load their page code on demand, while the
existing route JSX, protected layout and admin boundaries remain identical. A page
load boundary gives an explicit refresh action for a failed chunk download instead
of leaving a blank screen or retrying indefinitely. No route or feature was removed.

Build-manifest measurements for JavaScript only, including static dependencies:

| Load | Uncompressed bytes | Gzipped bytes |
| --- | ---: | ---: |
| Previous initial bundle | 2,334,637 | 621,432 |
| New application shell | 523,398 | 153,950 |
| New shell plus sign-in | 560,829 | 167,734 |
| New shell plus Front Office | 591,098 | 175,823 |
| New shell plus Record Book | 602,162 | 177,536 |

The cold Front Office JavaScript transfer is about 72% smaller after gzip. These
are bundle measurements, not a promise that production latency falls by that amount.
CSS and data-transfer sizes are not included in this comparison. Vite's build
manifest enables reproducing the entry/static-dependency calculation; generated
build files remain ignored and are not committed.

The Front Office core render now waits only for its roster, branding, penalties and
retention reads after assignment lookup. Auction/trade activity, historical salary
reads, NHL stats and prospect work run independently. Pending activity is labeled
loading rather than shown as a false zero or an all-caught-up message. Historical
NHL fallback is skipped when current statistics already cover the relevant roster.
Farm insights on the landing page now fetch only its manager's team and the two
oldest draft years needed for aging alerts, without league-wide ranking photos or
other teams' prospect lookups. The dedicated farm-ranking pages keep full results.

A real headless Chrome test renders the actual Front Office component with read-only
fixtures: core reads take 100 ms, while NHL/activity/prior-year reads take 30 seconds.
The prior component at commit 43a76cf7c3184bdd3a604c0c4e1cf17e77d8f0d0 failed the
two-second display budget; the updated component showed team/cap/roster at roughly
120 ms while optional reads remained pending. This is a controlled regression test,
not a production Supabase/login timing measurement.

Commands (Node 24; local Chrome/Chromium, CHROME_PATH may override the default):

```sh
npm run build
npm run test:nhl
npm run test:worker
npm run test:frontoffice:runtime
npm run test:routes:runtime
npm run check:deploy
```

The browser tests block outbound connections with CSP, use temporary fresh browser
profiles, and never sign in or contact Supabase. Built-route checks cover sign-in,
unauthenticated record/admin routes, and a failed lazy page download. All 103 unit
tests, production build/TypeScript, five browser checks, and deployment dry run passed.
Existing CSS and large lazy-chunk warnings remain. Live production timing still needs
verification after an approved publication. No commit, push, or deploy was initiated.

## Farm System Rankings skeleton delay

The mobile screenshot showed the Farm System Rankings skeleton after the shell had
loaded. This is a different path from sign-in. The league insights loader computed
rankings, then awaited optional top-prospect profile photos and all teams' aging
lookups before returning any ranking rows. Repeated full-roster scans/normalization
for every draft pick added CPU work, especially on slower phones.

Farm System Rankings now uses a separate `rankingsOnly` mode: it returns the complete
ranking calculation without starting profile-photo, player-search, or birthday work.
Cards use lazy static NHL headshots with initials fallback. Full insights and the
Front Office aging alerts retain their existing behavior. The 85/10/5 ranking weights,
fantasy scoring, farm ownership rules, and original tie/date precedence are preserved.
Ownership/signing lookups now use indexes constructed once per roster instead of
repeated scans. A controlled 1,500-row/2,000-lookup benchmark returned identical
results in about 4 ms versus 4,469 ms for the previous scans; this is a fixture
benchmark, not a production mobile timing guarantee.

A separate browser cache stores only a whitelisted public ranking display by season:
team ID/name/abbreviation/logo/colors and public ranking/prospect metrics. It excludes
team notes, manager/account information, full roster rows, and authentication. It
retains the last complete ranking for up to seven days, refreshes after five minutes,
keeps good data if a refresh fails, deduplicates in-flight refreshes, limits stored
content to 512 KB, and does not re-label older NHL source data as newly updated.
Disabled or full local storage still permits in-memory display. Existing auth keys
are not touched. First-time visitors still need one successful set of required draft
and NHL reports; no placeholder scores are invented.

The page shows saved rankings immediately on reload with an update timestamp, refreshes
in the background on visible/online pages, and reports first-load delays or failures
rather than silently displaying skeletons indefinitely. A ranking-only in-memory
insights cache is separate from full/aging insights and expires after five minutes.

`npm run test:farm:runtime` runs the actual component/calculation/cache in a local
mobile-sized Chrome fixture with production connections blocked. Profile/birthday
requests are delayed 30 seconds. Rankings appeared at about 169 ms on the first
fixture load, and a second visit at about 14 ms made no ranking-source requests.
The old page reproduces the blocked skeleton under the same fixture. No database,
Supabase configuration, authentication, scoring formula, Cloudflare resource, or
production deployment was changed by this follow-up.

Final checks passed: 111 unit tests (71 NHL/frontend and 40 Worker), production
build/TypeScript, ranking first-load and saved-reload browser regressions, existing
built-route/access checks, and Wrangler deployment dry run. Existing CSS/chunk-size
warnings remain. Production first-visit latency and Safari behavior still require
verification after an approved deployment. All changes in this follow-up are local;
no commit, push, database action, or production deployment was performed.

## Live feed, daily roster stats, and preview flags

Around the Horn previously waited for season totals, historical prospect rights,
and age checks before showing live goals. Goal cards also preferred the historical
score at that goal over the current scoreboard, making an older goal look like a
stale current score. Cached live snapshots did not restore the polling schedule on
reload; unknown schedules fell back to five-minute checks. Stale-while-revalidate
could return the previous snapshot again without the feed consuming its refresh.

Live goals and daily fantasy points now use one combined snapshot and render before
optional season standings, prospect ownership, and record enrichment. Cards show
the current score separately from the score at the goal. Pending prospect ownership
is labeled as loading rather than guessed to be free agency. Profile photos for
record cards use static image URLs instead of fetching full player profiles.

Saved snapshots restore live schedule metadata. Visible live pages check every
30 seconds, await the shared snapshot refresh before updating their view, and keep
last-good data on transient failures. The Worker awaits a fresh complete live
snapshot when its short cache expires; other report endpoints retain background
refresh behavior. Saved fallback timestamps and rate-limit cooldowns are preserved.
The live season composite expires after 30 seconds while underlying season reports
keep their five-minute cache, so daily additions can update without refetching
every season report. Hidden/offline pages pause; completed games stop polling after
confirmation. No faster retry loop or automatic 429 retry was introduced.

The browser allows two general requests plus one reserved live request. The Worker
allows four active upstream requests with capacity reserved for live traffic.
Snapshot bodies finish reading before their slots are released. Identical requests
remain deduplicated and public successful JSON remains cached. A sixteen-game
snapshot uses at most 33 external fetches; this is a per-snapshot bound, not a daily
usage guarantee. Cold starts, upstream outages, and separate Cloudflare data centres
can still require fresh calls. No paid resources or configuration changes are added.

Roster metadata requests are reused per player and their results update independently;
receiving one player's flags no longer cancels the remaining callbacks. Single-season
views do not request metadata for hidden future rosters. Daily stat errors are shown,
and temporary live-flag failures preserve the last confirmed flags.

Local mobile-sized browser fixtures exercise the actual Around the Horn component,
feed transformation, and polling with season/prospect/record requests deliberately
unresolved: the feed renders below 200 ms and changes scores on the 30-second poll.
These controlled timings do not measure production mobile latency or authenticate
as a real league user. Worker tests cover fresh scores after live cache expiry,
reserved capacity, successful JSON caching, 429 cooldown, and preserved SPA assets.
Supabase configuration/authentication, database contents, and scoring formulas are
unchanged. This batch remains local until publication is approved.

Final validation for the combined local batch: 120 unit tests passed (78
NHL/frontend and 42 Worker), production build including both TypeScript projects,
actual workerd integration checks, live feed first-render and 30-second score
update browser checks, farm ranking first-load/saved-reload checks, Front Office
optional-request isolation, built-route/access checks, and Wrangler deployment
dry run. Live season freshness tests confirm that newer daily points advance with
an unchanged valid baseline and that delayed sources retain their older timestamp
and warning. Existing CSS minification and large-chunk build warnings remain.
No credentials were found in the pending-file review; no files were staged.

## November 23: old complete reports repeatedly retained

Read-only production checks returned a complete November 22 snapshot (five games)
and complete season-through-November-22 reports: 787 rows each for skater summary,
realtime and faceoff wins, and 78 goalies. The NHL capped pages at 100 rows despite
`limit=-1`/`limit=500`; the existing complete-report reader correctly collected all
25 pages across these four reports. Requests were sequential, paced at 1.5 seconds,
and stopped on failure without retries. These checks establish public endpoint
availability at that time, not what a particular logged-in browser had loaded.

A regression combining the real Worker handler, complete-report reader and saved
browser dataset reproduced stale retention: expired reports immediately returned
the previous successful page while `waitUntil` refreshed the edge copy. The browser
rejected the older source timestamp. On the next cache cycle this could repeat,
keeping the assembled dataset on its original data despite healthy upstream calls.
The regression failed before the fix and passes afterward.

Stats reports under `/nhl-api` now await revalidation after edge expiry, as live
snapshots already do. Successful primary-cache hits are still immediate; concurrent
requests still coalesce; failures still preserve the separately retained last-good
copy with its true timestamp. Profile/draft background refresh is unchanged. No
cache purge, browser authentication reset, configuration change, or paid resource
is required. This may make an expired report wait for upstream rather than return
old data immediately, while assembled browser data remains visible during refresh.

Visible season polls also resume every five minutes before puck drop/after finals,
so recovery of completed-game totals does not depend on today's live-game schedule.
Live polls retain their existing 30-second timing and pause/quiet behavior. Browser
visibility/offline restrictions, request pacing and rate-limit cooldowns remain.

Regression coverage includes successive cache expirations, a two-day-old complete
dataset retained during an outage and replaced after recovery, quiet-season retry
scheduling, and real workerd primary-cache expiry with a newer upstream revision
followed by 429 fallback. Supabase, authentication, league data, fantasy formulas,
website styling, and deployment configuration are untouched. No publishing action
is performed by these local checks.

Validation: 123 unit tests passed (79 NHL/frontend, 44 Worker), production build
including both TypeScript checks, workerd recovery/cooldown/cache integration,
mobile-sized live-feed render/poll regression, and Wrangler deployment dry run.
Existing CSS minification and chunk-size warnings remain. The dry run completed
with local runtime permissions after the sandboxed attempt stalled while bundling.
The target remains `greatlakesdynasty-ca`; no commit, push or deployment was made.

## Rankings, records, Front Office, and roster metadata follow-up

Power Rankings, Team Rankings and Rookie Watch use the same component. Its current
season/period/month reports now publish before optional previous-range comparison
reports, which previously held the entire view. Selected-view report errors preserve
already loaded results with a warning. Source-update notifications and visible-page
expiry checks re-read the selected report cache; changing tabs does not refetch the
league roster. Read-only roster/transaction metadata refreshes separately every five
minutes on visible online pages, with no overlapping metadata loads. The ranking,
eligibility, scoring-lineup, tie and movement calculations are unchanged.

Record Book refreshes the selected category in the background after NHL source
updates and visible-page checks, rather than only loading on category changes.
The shared path covers league/franchise position leaders, franchise records,
seasonal positional records and contracts. Refresh failures keep existing rows and
show a warning. Historical season/section/team cache identities and trade-date
ownership calculations remain unchanged. No admin snapshot capture is invoked.

Farm rankings react to refreshed NHL datasets while retaining the separate public
display cache and ranking-only loader. Full farm insights use static photo URLs.
Front Office aging alerts reuse verified birthdays already supplied by stats/public
bios, only falling back to player profiles when missing. They refresh with NHL data
and no longer wait for unrelated auction/trade activity before starting. The main
manager dashboard still renders its core data independently of optional NHL/activity.

Roster-preview photos now request static NHL images directly from player IDs, with
the existing initials/error fallback. They no longer wait for player-profile API
requests. Country/birthday metadata is stored in a separate public-only cache:
whitelisted player ID, birth-country code, birthday and timestamp; at most 2,500
entries/512 KB, 30-day expiry, no account/roster fields. Country labels retain the
existing birth-country meaning. Known countries render synchronously on navigation
and reload. Missing countries use small roster-specific skater/goalie biography
queries, at most 40 validated IDs per query, through the existing complete-report
reader/pacing/deduplication. No short-cooldown retry is attempted for these optional
queries. Missing/unplayed players and ambiguous multi-team abbreviations retain a
deduplicated profile fallback. Existing full bio reports also seed this cache and
reuse successful reports for six hours instead of five minutes. First-time missing
metadata can still wait for the NHL; no country is guessed or hardcoded.

`npm run test:rankings:runtime` runs the actual rankings page through all nine view
combinations with comparison reports unresolved and confirms only one roster read.
It also exercises the actual Tage Thompson lineup-card rendering: the static image
request and cached USA flag appear together (about 7 ms in the controlled fixture).
This does not measure production mobile latency or download the actual photo.
All runtime browser fixtures block external data connections. New unit coverage
checks metadata persistence/whitelisting/expiry/storage denial, validated scoped
biography queries, and refreshed league/franchise/seasonal record sections without
database writes. Live production biography reads encountered the existing stats
cooldown, so roster-filter upstream behavior still needs verification after that
cooldown; local query construction and fallback behavior are tested.

This follow-up does not change Supabase configuration, authentication, stored league
data, scoring formulas, ranking weights, record-credit rules, or website styling.
No commit, push or deployment is authorized or performed by these local checks.

Final combined validation: 127 unit tests passed (83 NHL/frontend, 44 Worker),
production build including frontend/Worker TypeScript, actual workerd regression,
all nine ranking views, actual roster-card photo/cached-country first render,
farm first-load/saved-reload, Front Office optional-data isolation, protected-route
and failed-download browser checks, and Wrangler deployment dry run. Skater/goalie
fantasy formulas and the complete player/team ranking calculation block were
compared with HEAD and are unchanged. Pending-file review found no credentials or
changes to Supabase/authentication, database files, Wrangler configuration or the
dependency lockfile. Existing CSS-minification and large-chunk warnings remain.

## Standings overlap and device discrepancies

The user confirmed both browsers were on Season 2027 / Season but showed totals
differing by 0.6. Separate browser and edge snapshots can differ in age; account
identity does not synchronize public NHL browser caches. The exact real-world
player/stat difference cannot be established from the two team totals alone.

A separate, reproducible standings race was found: initial stats were held behind
the initial roster/branding Promise.all. A background update could publish newer
stats first, then the delayed initial metadata completion restored the older stats.
Standings now publishes initial stats independently of metadata completion and uses
separate generation guards for season and daily requests across initial loads,
background cache notifications and polling. Superseded requests cannot overwrite
the latest pair of skater/goalie maps. Superseded daily loads also cannot leave the
Updating indicator stuck. No extra API requests, cache purges or scoring changes
are added.

`npm run test:standings:runtime` uses actual standings rendering and the real
source-update hook with isolated Chrome profiles, fixture NHL data and delayed
read-only league metadata. Starting scores of 1544.4 and 1545 are controlled
fixtures; 1545 is the fixture's newer source, not a verified production team total.
The original HEAD fails the delayed-metadata scenario (`--baseline`); the fixed
page converges in both profiles and also passes overlapping Today/Yesterday loads.
The browser fixture blocks external data connections. Production build including
both TypeScript checks and all 127 existing unit tests pass. Supabase, authentication,
league data and standings scoring/lineup calculations are unchanged. This new fix
remains local and is not committed, pushed or deployed.

## Persisted old-data recovery after hard refresh

The subsequent mobile screenshots showed November 20/21 saved data and 1461 points
after hard refreshes. A read-only production check confirmed that the deployed
frontend matched the tested standings build and that one season-through-November-22
summary page returned upstream HTTP 200 (100 of 787 records). This does not establish
the exact production 1544.4/1545.0 player/stat difference or complete refresh success
in either user's browser. A hard refresh does not delete the app's localStorage
datasets, so changing frontend request ordering alone cannot resolve stale fallbacks.

Reproduced cache faults and local fixes:

- A live-data failure raised `NhlBaselineAvailable`, but the complete cache accepted
  that baseline only when no prior dataset existed. An older hockey day's live
  dataset could therefore suppress newer completed games indefinitely during a live
  outage. Live season caches now record the hockey date and whether data is baseline
  only. A new day's completed baseline may replace an older day's saved total;
  same-day live points remain protected from a baseline-only fallback. Baseline-only
  saves may advance as completed-game corrections arrive. Legacy entries infer their
  hockey day from the saved source time without deleting public or authentication
  storage. The hockey date is captured once for the request so midnight/6 a.m.
  rollover cannot mix date bounds inside that request.
- Fresh completed datasets did not consistently retain source metadata after being
  saved/restored, and equal source timestamps rejected changed fresh values. Fresh
  values now retain metadata; changed fresh values at the same source time are
  accepted, older/stale responses are still rejected, and unchanged values produce
  no source-update notification loop. Live composite same-source checks use the
  existing short live recheck delay. Existing scoring calculations are untouched.
- Actual public HTTP fetches revalidate the browser HTTP cache after the app cache
  expires (`cache: no-cache`). Successful app/Worker caches, full query identity,
  pacing, deduplication and 429 cooldowns remain in place; no cache-busting URLs or
  extra automatic retries are introduced.
- Optional cross-tab Web Locks previously had unbounded queue waits. A frozen tab
  can no longer hold new reads indefinitely: timed-out advisory lock acquisition
  falls back to the same paced/deduplicated/cooldown-aware path used when locks are
  denied or unavailable. An operation whose callback already ran is never replayed.
  This is a bounded-wait safeguard, not a confirmed diagnosis of the user's tabs.

The saved-data notice identifies the season belonging to its oldest dataset, so
optional prior-season fallback data is distinguishable from current-season totals.

`npm run test:saved-recovery:runtime` exercises actual NHL fetching, pagination,
saved caches, scoring and standings rendering in mobile-sized Chrome with stored
November 20/21/current-day datasets. Only public HTTP responses and read-only league
metadata are fixtures; external connections are blocked. Old totals converge to a
new completed-game fixture total with live data working or returning 429; account
storage remains untouched and there is one live request. The original saved-cache
code fails the old-data/live-outage case (`--baseline`), while the fix passes.
The fixture disables optional Web Locks because Chrome virtual time can finish
before lock IPC grants arrive; separate unit tests cover cross-tab coordination and
bounded frozen-tab waits. Fixture scores are not verified real production totals.

This follow-up remains local pending approval. No database, Supabase, authentication,
scoring formula, styling, Cloudflare resource/configuration, commit, push or manual
deployment is changed by this work.

Validation: 133 unit tests (89 frontend/NHL, 44 Worker), production build including
both TypeScript projects, actual stored-cache/live-outage recovery, standings
convergence, live polling, Front Office isolation, all nine ranking views, farm
reload, protected-route, real workerd checks, and deployment dry run passed. The
original saved-cache version fails the newly reproduced live-outage recovery case.
Scoring functions were compared with HEAD and are identical. Review found no
protected configuration changes or private-key/GitHub-token patterns. Existing
CSS-minification and large-chunk warnings remain. No files are staged or published.
