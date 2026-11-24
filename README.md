# TailAdmin React - Free React Tailwind Admin Dashboard Template

For this project's Cloudflare Worker routing, local checks, and release steps, see
[CLOUDFLARE.md](./CLOUDFLARE.md).

TailAdmin is a free and open-source admin dashboard template built on **React and Tailwind CSS**, providing developers
with everything they need to create a comprehensive, data-driven back-end,
dashboard, or admin panel solution for upcoming web projects.

With TailAdmin, you get access to all the necessary dashboard UI components, elements, and pages required to build a
feature-rich and complete dashboard or admin panel. Whether you're building dashboard or admin panel for a complex web
application or a simple website, TailAdmin is the perfect solution to help you get up and running quickly.

![TailAdmin React.js Dashboard Preview](./banner.png)

## Overview

TailAdmin provides essential UI components and layouts for building feature-rich, data-driven admin dashboards and
control panels. It's built on:

- React 19
- TypeScript
- Tailwind CSS v4

### Quick Links

- [✨ Visit Website](https://tailadmin.com)
- [📄 Documentation](https://tailadmin.com/docs)
- [⬇️ Download](https://tailadmin.com/download)
- [🖌️ Figma Design File (Community Edition)](https://www.figma.com/community/file/1214477970819985778)
- [⚡ Get PRO Version](https://tailadmin.com/pricing)

### Demos

- [Free Version](https://free-react-demo.tailadmin.com/)
- [Pro Version](https://react-demo.tailadmin.com)

### Other Versions

- [HTML Version](https://github.com/TailAdmin/tailadmin-free-tailwind-dashboard-template)
- [Next.js Version](https://github.com/TailAdmin/free-nextjs-admin-dashboard)
- [Vue.js Version](https://github.com/TailAdmin/vue-tailwind-admin-dashboard)
- [Angular Version](https://github.com/TailAdmin/free-angular-tailwind-dashboard)
- [Laravel Version](https://github.com/TailAdmin/tailadmin-laravel)

## Installation

### Prerequisites

To get started with TailAdmin, ensure you have the following prerequisites installed and set up:

- Node.js 18.x or later (recommended to use Node.js 20.x or later)

### Cloning the Repository

Clone the repository using the following command:

```bash
git clone https://github.com/TailAdmin/free-react-tailwind-admin-dashboard.git
```

> Windows Users: place the repository near the root of your drive if you face issues while cloning.

1. Install dependencies:

   ```bash
   npm install
   # or
   yarn install
   ```

2. Start the development server:
   ```bash
   npm run dev
   # or
   yarn dev
   ```

## Components

TailAdmin is a pre-designed starting point for building a web-based dashboard using React.js and Tailwind CSS. The
template includes:

- Sophisticated and accessible sidebar
- Data visualization components
- Prebuilt profile management and 404 page
- Tables and Charts(Line and Bar)
- Authentication forms and input elements
- Alerts, Dropdowns, Modals, Buttons and more
- FAQ & Accordion, Testimonials, and Carousels
- Can't forget Dark Mode 🕶️

All components are built with React and styled using Tailwind CSS for easy customization.

## Feature Comparison

### Free Version

- 1 Unique Dashboard
- 35+ dashboard components
- 50+ UI elements
- Basic Figma design files
- Community support

### Pro Version

- 7 Unique Dashboards: Analytics, Ecommerce, Marketing, CRM, SaaS, Stocks, Logistics (more coming soon)
- 500+ dashboard components and UI elements
- Complete Figma design file
- Email support

To learn more about pro version features and pricing, visit our [pricing page](https://tailadmin.com/pricing).

## Changelog

### Version 2.3.0 - [April 28, 2026]
- Added **AI Dashboard** with token usage and revenue tracking.
- Added **Sales Dashboard** with retention and multi-channel analytics.
- Added **Finance Dashboard** with cashflow and balance management.
- Introduced **6 New Layout variations** for improved UI flexibility.
- Integrated **Advanced Data Visualization** with 7+ new chart types.

### Version 2.1.0 - [Dec 30, 2025]

- Resolved Date Picker positioning and input issues in Charts.

### Version 2.0.2 - [March 25, 2025]

- Upgraded to React 19
- Included overrides for packages to prevent peer dependency errors.
- Migrated from react-flatpickr to flatpickr package for React 19 support

### Version 2.0.1 - [February 27, 2025]

#### Update Overview

- Upgraded to Tailwind CSS v4 for better performance and efficiency.
- Updated class usage to match the latest syntax and features.
- Replaced deprecated class and optimized styles.

#### Next Steps

- Run npm install or yarn install to update dependencies.
- Check for any style changes or compatibility issues.
- Refer to the Tailwind CSS v4 [Migration Guide](https://tailwindcss.com/docs/upgrade-guide) on this release. if needed.
- This update keeps the project up to date with the latest Tailwind improvements. 🚀

### Version 2.0.0 - [February 2025]

A major update with comprehensive redesign and modern React patterns implementation.

#### Major Improvements

- Complete UI redesign with modern React patterns
- New features: collapsible sidebar, chat, and calendar
- Improved performance and accessibility
- Updated data visualization using ApexCharts

#### Key Features

- Redesigned dashboards (Ecommerce, Analytics, Marketing, CRM)
- Enhanced navigation with React Router integration
- Advanced tables with sorting and filtering
- Calendar with drag-and-drop support
- New UI components and improved existing ones

#### Breaking Changes

- Updated sidebar component API
- Migrated charts to ApexCharts
- Revised authentication system

[Read more](https://tailadmin.com/docs/update-logs/react) on this release.

### Version 1.3.7 - [June 20, 2024]

#### Enhancements

1. Remove Repetition of DefaultLayout in every Pages
2. Add ClickOutside Component for reduce repeated functionality in Header Message, Notification and User Dropdowns.

### Version 1.3.6 - [Jan 31, 2024]

#### Enhancements

1. Integrate flatpickr in [Date Picker/Form Elements]
2. Change color after select an option [Select Element/Form Elements].
3. Make it functional [Multiselect Dropdown/Form Elements].
4. Make best value editable [Pricing Table One/Pricing Table].
5. Rearrange Folder structure.

### Version 1.2.0 - [Apr 28, 2023]

- Add Typescript in TailAdmin React.

### Version 1.0.0 - Initial Release - [Mar 13, 2023]

- Initial release of TailAdmin React.

## License

TailAdmin React.js Free Version is released under the MIT License.

## Support

If you find this project helpful, please consider giving it a star on GitHub. Your support helps us continue developing
and maintaining this template.

# Power Rankings snapshot pilot

Power Rankings can read a saved result for Full Season, Months, and Scoring Periods. The same result supports Player Rankings, Team Rankings, and Rookie Watch. The browser uses the current loaders if the pilot is disabled, the selected range has no snapshot, or Supabase cannot return it.

The snapshot migration was applied to the connected `greatlakesdynasty.ca`
Supabase project (`ptexqhshfyjfnmlwyzzv`) on November 24, 2026. Server writes,
signed-in reads, anonymous denial, and client write denial were verified with a
rolled-back database probe; an anonymous REST request also returned HTTP 401.
The Worker URL is configured in `wrangler.jsonc`, and the server secret and
snapshot schedule were deployed on November 24, 2026 (initial Worker version
`dfb1007a-a7ee-43ae-85f8-04cb9f4070f7`). A real October 2026-season snapshot
(stats through October 31, 2025) was then saved and verified: 194 rostered players,
10 teams, consistent team totals, and successful signed-in role access. Production
builds enable snapshot reads through `.env.production`; missing ranges retain the
existing loaders while the scheduled backfill progresses. To disable snapshot
reads, set `VITE_RANKING_SNAPSHOTS=false` in the build environment and rebuild.
Worker variables do not set Vite build variables. The activated production Worker
version is `4c70b82e-fbec-4d86-8c0a-5af4d8fd93bb`.

To enable the pilot in another environment:

1. Apply `20261124202832_create_power_ranking_snapshots.sql`, then
   `20261124204724_add_power_ranking_snapshot_sources.sql`, to the test Supabase
   project. The table uses row-level security and only the server can write.
2. Set the snapshot Worker runtime variables `RANKING_SNAPSHOTS_SUPABASE_URL` and `RANKING_SNAPSHOTS_SERVICE_ROLE_KEY`. Store the key as a Cloudflare secret and keep it out of the Vite build and Git. Without both settings the scheduled snapshot job is disabled.
3. Deploy the Worker to the test environment. At minutes 5 and 35 of each UTC hour, it can build one due range. Current ranges use completed games through the previous NHL day. The job fills missing ranges gradually, building missing comparison ranges first. Each run fetches only one range of NHL reports and saves the public NHL inputs in a separate `source_stats` column for later movement comparisons. The browser selects only the ranking results. Completed ranges are revisited after seven days so NHL corrections can be picked up. A failed refresh leaves the stored result in place.
4. Check for a saved row, then set `VITE_RANKING_SNAPSHOTS=true` in the frontend build environment. Compare the three tabs against the existing calculations using a signed-in account and check that an unauthenticated API request cannot read the snapshots. Set the flag to `false` and rebuild to revert the page to the existing loaders.

Run `node --test worker/rankingSnapshots.test.mjs` for offline refresh checks,
`node scripts/test-ranking-snapshot-runtime.mjs` for the database fetch/write
regression in workerd, and `node scripts/test-rankings-runtime.mjs` for the local
Chrome rendering checks. Background NHL requests are spaced 15 seconds apart,
and database pagination uses up to 1,000 rows per page to keep a refresh within
the Worker subrequest budget. With Docker running, `bash scripts/test-ranking-snapshot-migration.sh` applies the migration and verifies permissions in a disposable PostgreSQL database.


## Saved season data for Standings and stat pages

Standings, Skater Stats, and Goalie Stats share the complete NHL season inputs
already saved by the Power Rankings Worker. No additional crawler, cron trigger,
or database table is needed. The current-season snapshot through November 23,
2026 was populated by the scheduled production job on November 24 and verified
against the shared reader: 789 skaters, 79 goalies, and unchanged fantasy totals.

`VITE_SEASON_SNAPSHOTS=true` enables this reader in production builds. Current
season reads require a snapshot covering exactly the previous NHL day, then add
today's shared live box scores with the existing merge and scoring functions.
Historical reads require a full-season snapshot through April 30. Missing,
malformed, or mismatched coverage uses the existing complete-report loaders.
Standings Today and Yesterday retain their existing daily statistics requests.
Fantasy ownership, contracts, branding, and filters continue using their current
league data. Only public NHL arrays enter the existing browser NHL cache.

The three pages share in-flight lookups and a five-minute snapshot lookup cache.
Live totals keep the existing refresh behavior and preserve the last good result
if a refresh fails. Crossing the 6 a.m. Toronto hockey-day boundary requires a new
baseline check so the previous day's live points cannot be carried forward or
counted twice. A first-load live outage displays completed-game totals with a
saved-data notice. Set `VITE_SEASON_SNAPSHOTS=false` in the build environment and
rebuild to roll back these three consumers. The deployed production version is
`ce43c29f-9007-4999-9fc9-4a3bdaf999b9`.

Validation commands:

```bash
node --test src/lib/leagueSeasonStats.test.mjs
node scripts/test-season-pages-runtime.mjs
node scripts/test-standings-runtime.mjs
npm run build
```

The browser checks exercise all three actual pages with saved data and missing
snapshots, compare season totals, switch current/historical seasons, and exercise
stat sorting, search, and ownership filters. Unit checks also cover live merging,
rate-limit outages, invalid source data, shared requests, and the hockey-day
boundary. The optional `NHL_SEASON_SNAPSHOT_FIXTURE` environment variable points to
a local JSON export of public season inputs for checking real stored data; no
credentials or league roster records belong in that fixture.


## Shared saved season data on team pages

Team roster, lineup, and multi-year views now reuse the same saved NHL season
reader as Standings and the stat pages. Today's live scoring still merges with
the through-yesterday baseline. Missing saved seasons use the existing loaders.
Roster, salary, contract, leadership, and multi-year data keep their existing
league queries; future-year contract columns do not trigger extra NHL reports.

Team/season navigation discards late roster and multi-year responses, and only
the newest season or daily score request can update its view. Browser checks in
`node scripts/test-season-pages-runtime.mjs` cover team roster, lineup, multi-year,
historical seasons, saved-data fallback, and rapid season switching with delayed
roster responses.

Team-page production version: `a080091d-4751-479b-8c36-da4f772a4883`.
