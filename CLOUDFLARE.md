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
fix does not reduce frontend polling or promise free-tier capacity.

## Local checks (no deployment)

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
git add .gitignore README.md package.json package-lock.json wrangler.jsonc tsconfig.worker.json worker/index.ts worker/index.test.mjs src/pages/League/Standings.tsx CLOUDFLARE.md
git diff --cached --stat
git commit -m "Fix NHL API proxy routing on Cloudflare Workers"
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
