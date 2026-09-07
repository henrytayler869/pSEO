# pSEO Pipeline Control Panel

Internal "Head Quarter" control panel for a programmatic SEO operation:
market/niche research → real per-zip data collection → a public dataset API
→ real websites (headless WordPress + Next.js, built separately) that
consume that API and render their own pages → GSC/GA4 reporting on those
sites, all coordinated from here. This is not a public site itself.

**Current shape**: Module 1 (Market Explorer — coverage-import PAYOUT
scoring, or network-free TRAFFIC scoring against real Census zips, see
below) feeds a public `/api/v1` dataset API (real keyword/semantic-keyword
data) that external sites build pages from. Module 2 + 3 (Data Collector +
Validator, real PVWatts/Census/IRS/FEMA adapters, latest-vs-previous
snapshot comparison). `/domains` registers real purchased domains into
Cloudflare; `/publisher` tracks the real external websites live via
WordPress REST API + Google Search Console + GA4.

This app does **not** build, publish, or manage pages itself. The in-app
Page Builder was removed 2026-09-06, and the Publish Queue + GSC Loop
(`/publish`, `Page`/`PublishBatch`/`GscSnapshot`/`Recommendation`) was
removed with it — publishing, on-page optimization, and per-page Search
Console analysis all belong to each real website, which owns its own
content and reports up to `/publisher`.

## `/markets` — one page, tabs

Market Explorer, niche research, traffic trend, and coverage diff used to be
four separate pages/sidebar items. They're one page now (`/markets`), split
into tabs instead — the sidebar has a single "Thị trường" entry. Active tab
is tracked via `?tab=overview|research|trend|diff` so links/back-buttons
still work; `ImportPicker`/`DiffPicker` preserve that param (and each
other's) when they navigate, instead of overwriting the whole query string.

- **Tổng quan (overview)** — PAYOUT-scored verticals (if any coverage import
  exists) and TRAFFIC-researched verticals (if any), as two independent
  sections; neither blocks the other from showing.
- **Nghiên cứu niche (research)** — see "Researching niches without a
  network" below.
- **Xu hướng traffic (trend)** — see "Traffic score trend" below.
- **So sánh phạm vi phủ (diff)** — only means anything once a real
  network/coverage-import relationship exists (see "No manual data-import
  UI" below), which isn't the case yet — so it's **hidden**, not disabled,
  behind `SHOW_DIFF_TAB` in `app/markets/page.tsx` (currently `false`).
  Nothing underneath was deleted: `diffCoverageImports()`, `DiffPicker`, and
  the whole tab's JSX are still there, computed and ready — flip that one
  constant to `true` (and pass a real `showDiff` value through) once there's
  a network to compare against, no rebuild needed.

Detail drill-downs stay as their own routes (`/markets/[vertical]` for
PAYOUT, `/markets/research/[vertical]` for TRAFFIC) since they're reached by
clicking into a card, not by sidebar navigation — consolidating those too
would just be one giant page instead of a cluttered sidebar.

## Researching niches without a network (TRAFFIC mode)

Module 1's original scoring formula (`payoutFloor * estConversionRate *
searchVolume / difficultyIndex`) hard-requires a real coverage import — no
network relationship, no payout data, no score. The "Nghiên cứu niche" tab
adds a second, independent path for exactly the "no network yet, just want
to find traffic-worthy niches" stage:

- **Gợi ý niche tiếp theo (suggestions)** — a curated list of niches with a
  real pay-per-call/lead-gen angle and a real public data source behind
  each one (`lib/markets/candidate-niches.ts`, overridable via AppConfig key
  `candidateNiches`), minus whatever's already been researched (PAYOUT or
  TRAFFIC — either counts as "already researched"). One button per
  suggestion — no need to know a niche name yourself.
- **Tự nhập niche khác (manual)** — for anything not on the curated list.
  Type a niche name (e.g. `tax-relief`) and hit one button. It (1) creates a
  `MarketIdentity` for that niche across every real `Location` on file — no
  coverage file needed, (2) fetches keyword data for it via DataForSEO
  (Settings or `.env`), (3) scores every resulting market on
  `searchVolume * cpc / difficultyIndex` alone — no payout, no network.
- **So sánh các niche đã nghiên cứu (comparison table)** — one researched
  niche's score alone doesn't tell you much; this table is what actually
  answers "which niche should I build first." Ranked by **avgScore**
  descending (not `topScore` — a niche with one lucky zip and 300 mediocre
  ones shouldn't outrank one that's consistently solid, which `topScore`
  alone can't distinguish), rank #1 marked 🏆 and row-highlighted, everything
  else numbered #2, #3, ... down the list. Also shows avg CPC, avg keyword
  difficulty, and total search volume per niche side by side — the point is
  to stop the composite score from hiding *why* one niche beats another (two
  niches can land the same score for opposite reasons: high-volume/low-CPC
  vs. low-volume/high-CPC). One research run already produces everything in
  this table — see "Traffic score trend" below for what a *second* run adds
  on top, which is a different question than "which niche is best right now."
- Every `MarketScore` row now carries a `mode: PAYOUT | TRAFFIC` discriminant.
  PAYOUT scores (from a real coverage import) and TRAFFIC scores (from this
  flow) coexist per `MarketIdentity` with independent, continuous version
  counters — running a real coverage import later doesn't erase or renumber
  a niche's traffic-research history.
- `MarketIdentity.city` is nullable now (previously required) — a
  TRAFFIC-mode identity sourced from real Census `Location` data has no city
  name, same reasoning as `Location.city`.
- This is deliberately re-runnable, not transactional: re-running a niche
  only adds what's missing (`skipDuplicates` on identity creation, a fresh
  score version on rescoring) — safe to run before DataForSEO is configured
  and finish later without losing anything.
- `scripts/run-scheduled-niche-research.ts` processes a few suggested
  niches per run (default 3, env `NICHE_RESEARCH_BATCH_SIZE`) and skips
  whatever's already researched — see "Running data collection on a
  schedule" below for the matching crontab entry.

## Traffic score trend

TRAFFIC-mode `MarketScore` rows carry `calculatedAt` and a per-identity
version, but versions can drift out of sync across a niche's identities (a
zip added later starts at version 1 while older zips are already on version
3), so per-version comparison doesn't line up cleanly across a whole niche.
`getTrafficScoreTrend()` (`lib/queries/traffic-research.ts`) rolls up every
score by **calendar day** instead — average score, top score, and count of
markets scored that day — which is what the "Xu hướng traffic" tab charts
per niche (plain inline SVG, no charting library dependency). Needs at least
two distinct days of scores for a niche to plot anything; with only one,
the tab explains that and tells you to run it again (manually, or via the
scheduled niche-research script) rather than rendering a pointless
single-point chart.

**This is a confirmation signal, not a selection one.** One research run
already gives you everything the comparison table needs to pick a niche
(above) — the trend answers a different, later question: "is the niche I
already picked still good?" A niche can win the initial comparison and
still be worth re-checking a month later; the trend is how you'd notice it
declining before sinking more build effort into it, not a gate you have to
clear before choosing in the first place. Underlying keyword data (search
volume, KD, CPC) typically only moves on a monthly cadence upstream at
DataForSEO, so a single 2-week delta is easy to mistake for signal when
it's just estimate noise — treat the direction as reliable after 2-3 runs
(~1-1.5 months), not after the second data point alone.

## Public dataset API (for a website's own pSEO plugin)

Rather than this app rendering and publishing pages itself, a real website's
own plugin/CMS can pull the researched dataset directly via `/api/v1` and
build pages on its own infrastructure. Three read-only, API-key-authenticated
routes:

- `GET /api/v1/niches` — every TRAFFIC-researched niche, ranked by average
  score (same data as the "So sánh các niche đã nghiên cứu" table).
- `GET /api/v1/niches/{vertical}/markets` — every researched zip for that
  niche: city/state, main keyword, search volume/CPC/KD, score.
- `GET /api/v1/niches/{vertical}/markets/{zip}` — full per-page dataset: the
  main keyword's own numbers, the vertical-wide national baseline to compare
  against, real **semantic/related keywords** (DataForSEO Labs
  `related_keywords`, fetched once per niche — not per zip, since the seed
  is the generic niche phrase, e.g. "moving services", not an already-localized
  long-tail one) for on-page SEO coverage, and `governmentData` (added
  2026-09-06) — every real Collector `DataPoint` (Census/IRS/NOAA/EIA/FEMA/
  PVWatts) from the latest **OK** snapshot of whichever active `DataSource`s
  are tagged `relevantVerticals` for this niche, joined on this zip's
  `Location` row (`lib/queries/collector.ts::getRealDataPointsForZipAndVertical`).
  Often `[]` — see "Location vs. MarketIdentity zip coverage" below for why
  that's expected, not a bug. A SUSPECT (schema-drift) snapshot is never
  surfaced here — same "don't trust it until the gate passes" rule the rest
  of this app applies to Collector data.

Auth: generate a key in Cài đặt → "Cổng API (cho plugin/website)", then send
it as `Authorization: Bearer <key>` (or `X-Api-Key: <key>`) on every request.
Only one key exists at a time — regenerating revokes the old one. Verified
with `crypto.timingSafeEqual`, since this gates a real external-facing route,
not just an internal form.

This app's own page-building path (Page Builder — hard template + AI
interpretation + differentiation gate) has been removed entirely
(2026-09-06) — the API above is now the *only* delivery path. Real websites
(headless WordPress + Next.js, tracked in `/publisher`) build their own
pages from this dataset; this control panel doesn't render page content
itself anymore.

## Domain — the step before Publisher (2026-09-06)

`/publisher` needs a `Website` row, which needs a real WordPress install
plus **verified** GSC and GA4 properties — none of which can exist until a
domain is actually owned and its DNS is under control. `/domains` is that
prerequisite step: register a real, purchased domain here and it
immediately creates a real zone for it in Cloudflare via the Cloudflare
API — not a placeholder record waiting for the rest of the stack to catch
up.

- `POST /zones` (create), `GET /zones/{id}` (refresh status/nameservers) —
  shapes confirmed against Cloudflare's own current API reference
  (developers.cloudflare.com/api/resources/zones/methods/{create,get}/) on
  2026-09-06, not yet exercised against a real account (no
  `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` configured in this
  environment) — same "built from real docs, unverified against a live
  call" status this app's PVWatts/NOAA/EIA adapters shipped with
  originally.
- If the Cloudflare call fails (bad token, domain already on another
  Cloudflare account, etc.), the `Domain` row is still saved with the
  error attached rather than silently discarded — it stays visible in the
  list and "Kiểm tra lại" retries once the underlying issue is fixed.
- Removing a domain from this app's list never deletes the Cloudflare
  zone itself — that's a separate, destructive, hard-to-reverse action
  (drops real DNS records) a "remove from list" button should never do as
  a side effect.
- `relevantVertical` is the same purely-descriptive annotation pattern as
  `DataSource.relevantVerticals` — which niche a domain is meant for, not
  read by any code.

## Publisher — Head Quarter for the real websites

This control panel doesn't just research niches and expose a dataset API —
`/publisher` is where it tracks the actual websites built from that data.
Each connected site is headless WordPress (CMS) + Next.js (frontend);
recommended rendering approach is **ISR with on-demand revalidation**
(WordPress publish hook → a `revalidatePath`/`revalidateTag` call on the
site's own Next.js API route) rather than a full static export — a full
`output: 'export'` rebuild-and-redeploy on every single post doesn't scale
once a site has hundreds/thousands of pSEO pages, while ISR gives the same
served-as-static-HTML result with surgical, per-page regeneration.

Everything on `/publisher` is fetched **live** on every page load — nothing
is mirrored into this app's DB — from three independent real sources:

- **WordPress REST API** (`/wp-json/wp/v2/posts`, public by default) — post
  count, via the `X-WP-Total` header on a `per_page=1` request. Falls back
  to shelling out to `curl` if Node's own `fetch` fails to connect (observed
  live, 2026-09-06: Node's fetch couldn't reach either `api.census.gov` or
  `wordpress.org` from this environment — ETIMEDOUT on IPv4, no IPv6 route —
  while `curl` reached both in under 1.5s every time; a future real
  WordPress site could land on similarly-affected hosting).
- **Google Search Console** (`searchAnalytics.query`, site-wide, no page
  filter) — clicks/impressions/position. "Tỷ lệ index" on the Overview is
  an **estimate** (pages with impressions > 0 in the last 28 days ÷ post
  count) — the real GSC Index Coverage report has no public API; only
  per-URL Inspection does (`fetchUrlIndexStatus()`, 2,000/day quota per
  property), exposed as an on-demand single-URL check, not a bulk sweep.
- **Google Analytics 4 Data API** (`runReport`) — active users, sessions,
  pageviews, traffic-by-channel.

**Auth**: one shared Google Cloud Service Account (JSON key pasted once in
Cài đặt → "Publisher") authenticates all three — well, the latter two;
WordPress needs none. Add the service account's `client_email` as a viewer
on each site's GSC property and GA4 property; no per-site OAuth, and no
hourly-expiring user access token to keep re-pasting as sites are added.
Implemented as a standard OAuth2 "JWT Bearer Token" server-to-server
exchange (`lib/google/service-account.ts`)
using Node's built-in `crypto` for RS256 signing — no `googleapis` SDK,
matching this project's existing no-SDK convention. Verified structurally
live (2026-09-06): a JWT signed with a throwaway keypair was accepted by
Google's real token endpoint and rejected only with `invalid_grant: account
not found`, confirming the signing/encoding is correct; full request/response
shapes for GSC and GA4 were verified against Google's current docs, but
no real website/property exists yet to test an authenticated call against.

## Stack

- Next.js 16 (App Router) + TypeScript
- PostgreSQL + Prisma 6 (classic migrate/generate CLI — see note below)
- Tailwind + shadcn/ui (built on Base UI, not Radix, in this shadcn version)
- Zod for validation, Papaparse for CSV parsing

## Setup

```bash
docker compose up -d          # starts local Postgres on :5433
npm install
npx prisma migrate dev        # applies schema
node scripts/generate-sample-data.mjs   # (re)generates synthetic demo CSVs
npx tsx scripts/seed-demo.ts  # imports them + computes scores (Module 1)
npx tsx scripts/generate-locations-from-census.ts  # real, population-ranked Location registry (needs CENSUS_API_KEY; see below)
npx tsx scripts/seed-collector-demo.ts  # seeds Locations + DataSources, runs PVWatts collection + validation (Module 2+3)
npm run dev
```

Open http://localhost:3000 — it redirects to `/markets`. `/collector` has
the Data Collector + Validator pages, `/publisher` is the Head Quarter
dashboard for real connected websites, `/domains` registers purchased
domains into Cloudflare, and `/settings` has API credential entry (see
"Getting real API keys" below).

Copy `.env.example` to `.env` and fill in `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` /
`CENSUS_API_KEY` / `NREL_API_KEY` when you have them. Without DataForSEO
credentials, keyword metrics fall back to CSV import. Without an NREL key, the
PVWatts collector refuses to run unless you explicitly set
`ALLOW_PVWATTS_MOCK=true` (synthetic data only, never for anything real).
`/publisher`'s GSC + GA4 reporting for real connected websites doesn't come
from `.env` at all — it uses a single Google Service Account JSON key pasted
into Settings, see "Publisher" above.

**Or skip `.env` entirely and use `/settings`** — every credential above
(except `ALLOW_PVWATTS_MOCK`, the one demo flag that stays `.env`-only on
purpose)
can be typed into the Settings page instead. Values entered there are stored
in the `AppConfig` table and take priority over `.env`, apply immediately
(no restart), and are never echoed back in full — only source
("Đã lưu trong Cài đặt" vs "Đang dùng từ .env") and a last-4-characters hint
are shown. This is convenient but means secrets sit in the Postgres database
in plain text, same trust boundary as `.env` on this single-user internal
tool — don't point this control panel at a database or host you wouldn't
also trust with a `.env` file.

## Getting real API keys (to replace the mock/CSV data)

Everything the app shows today (Market Explorer numbers, PVWatts data) is
synthetic demo data — see "What's synthetic vs. real" below. To switch to
real data:

- **NREL_API_KEY (PVWatts, Module 2)** — free, instant. Go to
  https://developer.nlr.gov/signup/ (NREL renamed to NLR — National
  Laboratory of the Rockies — and retired `developer.nrel.gov` on
  2026-05-29; existing keys still work, only the host changed), fill in the
  short form (name, email, intended use), and the key is emailed
  immediately — no approval wait, no payment. Paste it into `.env` as
  `NREL_API_KEY="..."`. Once set, both the
  "Chạy thu thập dữ liệu" button and `scripts/run-scheduled-collection.ts`
  automatically switch to the real adapter — no code changes needed, and
  `ALLOW_PVWATTS_MOCK` is ignored whenever a real key is present.
- **DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD (keyword metrics, Module 1)** —
  sign up at https://app.dataforseo.com/register/ (pay-as-you-go, no fixed
  plan required to start), then go to https://app.dataforseo.com/api-access.
  The API password there is auto-generated and separate from your dashboard
  login password — copy that one, not the one you signed in with. Paste
  both into `.env` or Settings.
- **Coverage data (payout/pricing, Module 1)** itself isn't an API — it's
  whatever file your pay-per-call network actually sends you. There is no
  automatable substitute for this — it only exists once you have an actual
  relationship with a pay-per-call/lead-gen network (Ringba, Invoca,
  Retreaver, or a vertical-specific network); the app never scrapes for it.
  There is no import UI for this anymore (see "No manual data-import UI"
  below) — once you have a real file, import it by script.
- **CENSUS_API_KEY (real Location registry, Module 2)** — free, instant. Go
  to https://api.census.gov/data/key_signup.html. Paste it into `.env` as
  `CENSUS_API_KEY="..."`, then run `npx tsx scripts/generate-locations-from-census.ts`
  to replace the fake 78-city anchor list with the real top-300 US ZIP Code
  Tabulation Areas by population (Census ACS5), then
  `npx tsx scripts/seed-collector-demo.ts` to load them into the Location
  table. This only gives you real zip + state — Census's ZCTA geography
  doesn't carry a city name, so `city` is left blank (Location.city is
  already modeled as nullable/"descriptive only" for exactly this reason).
  This solves Module 2's location registry; it does not create the
  MarketIdentity records Module 1 needs — those still come from a real
  coverage import.
- **GOOGLE_SERVICE_ACCOUNT_JSON (Publisher — GSC + GA4 for connected
  websites)** — free. In Google Cloud Console: create/select a project →
  enable the "Google Search Console API" and "Google Analytics Data API" →
  IAM & Admin → Service Accounts → create one → Keys → Add Key → JSON.
  Paste the whole downloaded file's content into Settings → "Publisher".
  Then, for each website you connect on `/publisher`, add the service
  account's `client_email` as a **Restricted** (Search Console) / **Viewer**
  (GA4) user on that property — in Search Console's own Settings → Users
  and permissions, and in GA4's Admin → Property Access Management.

## No manual data-import UI (by design)

There is deliberately no `/markets/import` page. Module 1's coverage/payout
data can't be pipelined (see above), and building a manual-upload UI as a
stopgap for data that doesn't exist yet was worse than just not having one —
Module 1 stays empty until there's a real network to pull from, same as any
other module without a configured credential. The underlying library
functions are still there and still work, just not wired to a page anymore:

- `lib/coverage/import.ts` (`importCoverageFile`) — parses a coverage
  file into a new immutable `CoverageImport` + `Market` rows.
- `lib/keywords/import.ts` (`importKeywordMetricsForImport`) — joins
  keyword metrics (DataForSEO if configured, otherwise a CSV you pass in)
  onto an existing `CoverageImport`'s markets.
- `lib/scoring/market-score.ts` (`computeMarketScoresForImport`) — scores
  those markets once keyword data exists.

`scripts/seed-demo.ts` calls all three against the generated sample CSVs and
is the reference for how to script this against a real file once you have
one — copy its pattern rather than rebuilding a page for a one-time import.

## Running data collection on a schedule (Module 2)

`scripts/run-scheduled-collection.ts` is the same PVWatts collect + validate
operation as the "Chạy thu thập dữ liệu" button, exposed as a non-interactive
CLI command for cron. It exits `0` if every source's batch gate passed, `1`
if any source failed to collect or its block rate exceeded the threshold —
wire that exit code into whatever alerting your cron setup already has
(mail, a monitoring check, etc.), since nobody is watching a dashboard for
a scheduled run.

Once this is deployed to a server that runs continuously (not a laptop that
sleeps), add a crontab entry — PVWatts data (`P180D` refresh interval) is
slow-moving, so weekly is already generous:

```bash
crontab -e
# Every Monday at 3am server time:
0 3 * * 1 cd /path/to/pseo-control-panel && npx tsx scripts/run-scheduled-collection.ts >> /var/log/pseo-collector.log 2>&1
```

This only produces real data once `NREL_API_KEY` is set in that server's
`.env` — without it, the script fails loudly (exit `1`, clear error in the
log) rather than silently writing mock data, so a misconfigured cron job is
easy to notice instead of quietly polluting the database with fake numbers.

Every run — scheduled or via the button — also prints a **latest-vs-previous
snapshot comparison** (`lib/collector/compare.ts`): per metric, the average
before/after and how many individual zips moved more than 10%, paired by
location rather than just comparing two flat averages (which would hide a
handful of zips swinging hard against the rest holding steady). The same
comparison is always visible on `/collector` itself, not just right after a
run — useful for noticing a source drifting (e.g. an upstream data revision)
between scheduled runs, not just at the moment you triggered one.

Niche research (Module 1) follows the same shape — cron has no native
"every 14 days" schedule, so 1st-and-15th-of-the-month is the practical
stand-in for "twice a month":

```bash
crontab -e
0 3 1,15 * * cd /path/to/pseo-control-panel && npx tsx scripts/run-scheduled-niche-research.ts >> /var/log/pseo-niche-research.log 2>&1
```

`NICHE_RESEARCH_BATCH_SIZE` (default `3`) caps how many suggested niches it
processes per run — each niche fans out to one DataForSEO request per real
zip on file, and DataForSEO bills per call, so this isn't a "process
everything" script by default.

**After editing `prisma/schema.prisma`:** run `npx prisma generate` and
restart `next dev`. Turbopack's dev server caches the previously-generated
Prisma Client in memory — a `prisma migrate` alone updates the database but
not the running server's client, and you'll get a confusing "Unknown
argument" error at the exact line that touches the new field instead of a
missing-column error.

### Data sources — shipped and candidates (Module 2)

Each `DataSource` row has `relevantVerticals: String[]` — shown as badges
in the "Danh mục nguồn dữ liệu" table on `/collector`, purely descriptive
(no adapter or scoring code reads it) so it's clear what each source is
*for* without having to go read the adapter code: `nrel_pvwatts` and
`eia_electricity` → `solar-installation`; `census_acs_housing` and
`noaa_climate_normals` → `roofing-replacement`, `hvac-repair`,
`water-damage-restoration` (plus `moving-services` for
`census_acs_housing` — household income/home value shape moving cost and
decisions too); `fema_disaster_declarations` → `roofing-replacement`,
`water-damage-restoration`; `irs_migration` → `moving-services`. Set in
`scripts/seed-datasources.ts`.

**Shipped**: `nrel_pvwatts` (solar) and `census_acs_housing`
(`lib/collector/adapters/census-acs-housing.ts`, 2026-09-06) — median home
value (`B25077_001E`), median household income (`B19013_001E`), median year
built (`B25035_001E`), and a computed homeownership rate
(`B25003_002E`/`B25003_001E`), all at the same ZCTA resolution already used
for population. Verified live against real zips before building (e.g. Katy,
TX 77494: $450,100 home value, $146,105 income, built 2011, 71% owner-occupied
— all independently plausible for that suburb). One bulk ACS5 call per
collection run (not per zip — cached across the whole run, even under
concurrency, since ACS5 returns every ZCTA nationwide in one response,
unlike PVWatts' one-call-per-zip shape), reusing the same `curl` fallback as
`generate-locations-from-census.ts` for Node's occasional connection
failures to `api.census.gov`. Meaning for pSEO content: these numbers
explain *why* a roofing/HVAC/water-damage/solar job costs what it does in a
given zip — older housing stock and home value both drive real quote
variance, letting a page say something concrete instead of generic.

Also shipped: `irs_migration` (`lib/collector/adapters/irs-migration.ts`,
2026-09-06) — real households/income moving in and out of each **county**
per year, from the IRS's own Statistics of Income county-to-county
migration files (`countyinflow2223.csv` / `countyoutflow2223.csv`, annual
static CSVs, no API key). This is the exact source identified from the
start for `moving-services`
(`lib/markets/candidate-niches.ts`: "Gắn được dữ liệu di cư IRS/Census theo
county"). Structurally different from every other adapter here — an
annual file release, not a live per-location query — and reported at
**county** resolution: every zip in a county gets that county's numbers,
marked `isInferred: true` / confidence 0.85 via `Location.countyFips`
(populated by `scripts/backfill-county-fips.ts`, same real Census
ZCTA-to-County crosswalk already used for state derivation). Verified live
against a real county (Fort Bend County, TX, home to Katy 77494): 27,833
households moved in, 24,556 moved out, net +3,277 — plausible for one of
the fastest-growing counties in the US. Two known, real (not bugs) gaps
found live: Puerto Rico (state FIPS 72) has almost no rows in this file at
all (PR residents largely don't file the federal return this dataset is
built from), and Connecticut's counties were replaced by new "Planning
Region" FIPS codes in this IRS release while the Census crosswalk still
uses CT's legacy county FIPS — both surface as ordinary per-zip collection
failures (5/300 zips in the first real run), not something to guess a fix
for.

Also shipped: `fema_disaster_declarations`
(`lib/collector/adapters/fema-disaster-declarations.ts`, 2026-09-06) — count
of property-damage-relevant federal disaster declarations per **county**
over the trailing 10 years, from OpenFEMA's public `DisasterDeclarations
Summaries` API (no key required). Verified end-to-end: the exact request
URL, filter syntax, and response envelope were confirmed live before
writing the adapter (25,065 US declarations since 2016 returned in one
`$top`-overridden call), then the adapter itself was run for real against
all 300 seeded locations — 300/300 succeeded, 0 failures, validation gate
passed on the first try. One real, load-bearing finding from that live
pull: `incidentType: "Biological"` is the single largest category (7,857 of
25,065 rows) — these are the nationwide COVID-19 declarations, one per
county, and would swamp a raw disaster count into meaninglessness for this
app's actual use (roofing/water-damage urgency framing). The adapter
explicitly counts only property-damage-causing incident types (hurricane,
flood, fire, tornado, winter storm, etc.) and excludes
Biological/Chemical/Toxic Substances/Other. Sanity-checked post-collection:
Los Angeles County, CA tops out at 27 declarations/10yr (plausible — huge,
wildfire/flood/earthquake-prone), while Clark County, NV and Bernalillo
County, NM show 0 (plausible — desert regions outside this window).

**Shipped, unverified against a live call** (2026-09-06) — both built
against each provider's own published documentation, following the same
"ship it, verify for real once a credential exists" precedent as the
original `nrel_pvwatts`/GSC adapters. Neither `NOAA_API_TOKEN` nor
`EIA_API_KEY` is configured yet in this environment; the schema-drift guard
is what catches it if either provider's real response shape differs from
what's assumed below the first time someone runs it with a real
credential:

- **`noaa_climate_normals`**
  (`lib/collector/adapters/noaa-climate-normals.ts`) — NOAA CDO API v2,
  1991-2020 monthly climate normals per zip: annual heating/cooling degree
  days and precipitation, averaged across every nearby station NOAA
  resolves for a given `ZIP:xxxxx` locationid. Auth is a `token` HTTP
  header (not a query param or Bearer token) — and NOAA is the one source
  in this app where even *metadata/discovery* endpoints require a real
  token to call at all (confirmed live: a fake token gets a real `400 "The
  token parameter provided is not valid"`), so genuinely nothing here could
  be checked against a live response before shipping. Two specific
  assumptions to watch once a real token exists: the exact anchor dates
  `NORMAL_MLY` uses to represent "which month" (assumed to be NOAA's
  documented 2010-01-01..2010-12-01 placeholder year), and whether
  `units=standard` fully normalizes precipitation scaling. Meaning:
  degree-days directly explain HVAC load, precipitation directly explains
  roofing/gutter/water-damage risk — the most on-topic real data source for
  those verticals that isn't solar.
- **`eia_electricity`** (`lib/collector/adapters/eia-electricity.ts`) — EIA
  Open Data API v2, state-level average residential retail price per kWh
  (`electricity/retail-sales`, sector `RES`, annual frequency). Auth is an
  `api_key` query param. One bulk call per collection run (same lazy-cache
  pattern as `census_acs_housing` — every state in one response, not
  per-zip), matched to `Location.state` directly. Meaning: turns PVWatts'
  kWh production number into an actual dollar savings-per-year estimate for
  a solar page — currently the page can say "how much sun," not "how much
  money."

**Deferred candidate:**

- **BLS OEWS (metro-level wages)** (real, free). Real median wage per
  occupation per metro. Meaning: a defensible basis for "typical labor
  cost in this area" framing — needs care in copy to stay a labor-cost
  proxy, never presented as "what this job costs" (wage ≠ price). Blocked,
  not just unverified: constructing an OEWS series ID requires encoding
  metro area + industry + occupation + datatype, and the metro-area code
  table isn't published in BLS's general API reference — a separate
  BLS-specific area-code lookup table this app doesn't have yet. Guessing
  this encoding would silently produce wrong series IDs rather than an
  honest failure, so it's deferred to a dedicated research pass rather than
  shipped unverified like NOAA/EIA above.

## Notable version-specific things

This repo pins a few things deliberately, because the toolchain moved
underneath the defaults during setup:

- **Prisma is pinned to 6.19.3.** `npm install prisma` today pulls a 8.0.0
  release candidate with an entirely different, platform-hosting-centric CLI
  (`prisma dev`, `prisma deploy`, no more `migrate dev`). That's the wrong
  fit for a self-hosted internal tool — 6.x is the classic ORM CLI you
  probably expect (`prisma migrate dev`, `prisma studio`, etc).
- **shadcn/ui components here are built on Base UI (`@base-ui/react`), not
  Radix.** shadcn switched its default registry. `Select`'s `onValueChange`
  receives `(value: string | null, eventDetails)` instead of Radix's
  `(value: string)` — the custom picker components in `components/` account
  for this.

## Market identity vs. coverage snapshot

`MarketIdentity` (zip + vertical) is the stable, permanent concept for a
real-world market. `Market` is a coverage-import-scoped snapshot of that
identity's payout/pricing terms, re-created (never updated) on every import.
Everything that should trend over time — `KeywordMetric`, `MarketScore` —
hangs off `MarketIdentity`, not off a particular `Market` snapshot, so score
history survives coverage refreshes instead of resetting every time the
network re-sends its file. It's also what the public `/api/v1` dataset keys
on, so an external site's own pages stay pinned to a stable market concept
rather than to whichever import happened to be latest. `MarketScore.sourceMarketId` still pins each score to the exact
snapshot whose payoutFloor fed the computation, so a specific import's
ranked view shows the score computed from *that* import, not just whatever
is globally latest. `scripts/seed-demo.ts` scores v1 before v2 and prints a
version-continuity check (same identity, version 1 → version 2) to prove
this holds.

## Location vs. MarketIdentity

Module 2 surfaced the same identity question Module 1 did, one layer down.
`MarketIdentity` (zip + vertical) is right for anything vertical-specific
(pages, keyword demand, scores). But external data sources — PVWatts solar
data, and eventually EIA/BLS/Census/NOAA — describe a *place*, independent
of vertical: the same solar numbers for a zip would otherwise need writing
once per vertical that happens to have a page there. `Location` (zip only)
is the home for that: `DataPoint` and `ValidationFlag` point at `Location`,
not `MarketIdentity`. A future Page (scoped by MarketIdentity) joins back to
Location via zip to pull in whatever DataPoints apply. `Location` also
carries the zip↔county↔metro↔state crosswalk (it replaced the originally
unused, standalone `GeoCrosswalk` model — no reason to have two zip-keyed
tables doing overlapping jobs).

### Location vs. MarketIdentity zip coverage — drift found & fixed (2026-09-06)

Because `Location` and `MarketIdentity` are two independently-maintained zip
lists (previous section), they can silently drift apart — and did. An audit
prompted by "does moving-services still need anything?" found that
`Location` had been bulk-recreated (a new 300-zip selection) *after* 9 of
this app's 13 niches — including `moving-services` and, notably,
`solar-installation` itself — had already run `defineNicheAcrossLocations`
against the *old* zip list. Result: those 9 niches' `MarketIdentity` zips
had only ~2% overlap with the current `Location` table, so every Collector
`DataSource` tagged relevant to them (Census ACS5, IRS Migration, NOAA, EIA,
FEMA, PVWatts) had real data to attach to for only ~6 of ~288 markets each
— confirmed both by direct DB query and by the fact that
`getRealDataPointsForZipAndVertical` returned `[]` for the vast majority of
each niche's real, keyword-researched zips. The other 4 niches
(`hvac-repair`, `roofing-replacement`, `water-damage-restoration`,
`garage-door-repair`) were unaffected (80%+ overlap) because they'd been
(re)defined after the current `Location` table existed.

Fixed via `scripts/resync-niche-locations.ts` (re-runnable, safe to call
again after any future `Location` regeneration): for each affected
vertical, `defineNicheAcrossLocations` additively creates `MarketIdentity`
for any `Location` zip not yet present (existing markets/keyword
history/score history untouched, `skipDuplicates`), then
`fetchKeywordMetricsForIdentityIds` (new — a scoped sibling of
`fetchKeywordMetricsForVertical`) fetches keyword data **only for the
newly-created markets**, so re-running this does not re-bill DataForSEO for
markets that already have current data. `computeTrafficScoresForVertical`
then runs for the whole vertical (free, local computation) — this does
bump every pre-existing market in that vertical to a new score version even
though its keyword data didn't change, which is the accepted, intended
"this niche was re-processed" side effect of this app's existing
never-overwrite versioning discipline, not a bug. Result: all 13 niches now
have 300/300 (100% of current `Location`) zip coverage. `moving-services`
specifically went from 6/288 (2.1%) to 300/582 (51.5%) — the other 282
zips are real, keyword-researched markets from before the drift that
simply have no matching `Location` row (and therefore no real government
data) until/unless a future `Location` regeneration happens to include
them; that's a real, surfaceable, non-error state, which is exactly why
`getRealDataPointsForZipAndVertical` returns `[]` rather than throwing.

One unrelated pre-existing data quality bug surfaced by this same audit,
fixed same day: `mortgage-refinance`'s only real DataForSEO keyword data
(`keywordDifficulty: 0` for several real "mortgage refinance {city}" terms)
tripped `computeTrafficScoresForVertical`'s old
`if (difficultyIndexInput <= 0) continue` div-by-zero guard, silently
scoring 0 of its 582 markets — a real KD of 0 means "not competitive," not
"unscoreable." Fixed in `lib/scoring/market-score.ts`
(`FORMULA_VERSION`/`TRAFFIC_FORMULA_VERSION` bumped to v2) by flooring the
divisor (`Math.max(difficultyIndexInput, MIN_DIFFICULTY_FLOOR)`, floor = 1)
instead of skipping the market outright — the raw (possibly 0)
`difficultyIndexInput` is still stored for traceability, only the division
itself is protected. Applied to both `computeTrafficScoresForVertical` and
`computeMarketScoresForImport` for consistency. Verified:
`mortgage-refinance` now scores 46/582 markets (e.g. Seattle, WA
98101-98104 at a KD of 0 score highest, correctly, since low competition is
genuinely good) and appears in the `/markets` ranking (#5 by average
score) instead of being silently absent.

### "Zero is data, not `continue`" — the same bug class, found across 6 places (2026-09-06)

The `mortgage-refinance` fix above turned out to be one instance of a
recurring class of bug in this codebase: a `continue`/early-return guard
written to avoid a division by zero, that also silently discards a
*genuinely meaningful* zero/negative input instead of handling it. A
follow-up audit checked every other formula-shaped module for the same
pattern. Two more were real, confirmed with this app's own live collected
data; two more were real but not yet triggered (no data exists yet to hit
them); the rest were already correct.

**Fixed, confirmed with live data:**

- **`checkOutliers`** (`lib/validation/rules.ts`) — BLOCKs a value more
  than `multiplier`× its regional (state) peer mean, leave-one-out. The old
  code skipped the entire group whenever that peer mean was `<= 0`. Every
  Census/PVWatts/FEMA metric here is non-negative, so this never fired for
  them — but `irs_migration_net_households` (net migration, can be
  genuinely negative for outflow states) regularly produces a
  leave-one-out mean at or below zero: **245 real outlier checks were
  silently skipped** on this app's own current IRS data alone, meaning a
  real bad value in a net-outflow state could never have been caught by
  this gate. Fixed with a hybrid: unchanged ratio check when the peer mean
  is positive (zero behavior change — verified identical flag counts
  against every active DataSource's real snapshot before/after), falling
  back to an absolute-deviation check scaled by peers' mean *magnitude*
  (instead of skipping) when the mean is zero/negative.
- **`compareToPreviousSnapshot`** (`lib/collector/compare.ts`) — a
  location whose previous value was exactly 0 defaulted to "0% change"
  regardless of what the new value became, so a real, meaningful "went
  from 0 to something" event (very plausible for FEMA — many counties
  sit at 0 declarations) would never register in `significantChangeCount`
  and would print a misleading "+0.0%" delta. Fixed: a 0→nonzero move now
  always counts as significant; the aggregate `percentChange` field is now
  `number | null` (`null` = "undefined, not zero" — the same "null means
  N/A" convention `computeTrafficValues` already uses elsewhere), rendered
  via the new shared `formatPercentChange()` helper everywhere it's
  displayed (Collector UI, the scheduled-collection CLI, the manual-run
  action message).

**Fixed, not yet triggered by real data (no live data exists yet to hit
these — fixed proactively so they're correct before they do):**

- **`checkCrossSource`** (`lib/validation/rules.ts`) — skipped the WARN
  entirely whenever the *other* source's value was exactly 0, which is
  precisely the case ("we report something, the reference source reports
  nothing") this rule exists to catch. Currently inert since the app has
  never had two active sources reporting the same metric (a documented,
  pre-existing limitation this file's own comment already flagged). Fixed
  so a 0-vs-nonzero disagreement now flags instead of being silently
  dropped.
- **`diffCoverageImports`** (`lib/coverage/diff.ts`) — `payoutDeltaPct`
  divided by the *old* `payoutFloor` with no zero guard at all (would have
  produced `Infinity`/`NaN`, not just a wrong "0%"). Currently inert since
  no `CoverageImport` exists yet in this system. Guarded; falls back to
  `undefined` (already handled by the existing `!== undefined` check in
  `app/markets/page.tsx`) when the old floor was 0.

**Audited, already correct — no change:** the DataForSEO adapter's
`if (!volume) continue` (checks for a missing map entry, not a falsy
`searchVolume: 0`, which is stored as a real object and never hits this
branch); `computeTrafficValues`/`computeTrafficBaselines` (already
`null`-on-zero, the correct pattern);
`payout-kd-correlation.ts` (already includes zero-KD points in its
correlation input; only returns `null` when there's truly no variance to
correlate against).

## Directory map

- `prisma/schema.prisma` — data model for the modules that ship here:
  MarketIdentity/Market/KeywordMetric/SemanticKeyword/MarketScore/
  CoverageImport (Module 1), Location/DataSource/DataSnapshot/DataPoint
  (Module 2), ValidationRun/ValidationFlag (Module 3), plus Domain
  (Cloudflare), Website (`/publisher`) and AppConfig (Settings). Nothing
  models pages or publishing — real websites own that themselves
- `lib/coverage/` — coverage file parsing, import, flat-rate detection, diff
- `lib/keywords/` — DataForSEO API adapter + CSV fallback adapter, common interface
- `lib/scoring/` — MarketScore formula (PAYOUT + TRAFFIC modes) + payout/KD
  correlation ("trap") check
- `lib/markets/define-niche.ts` — TRAFFIC-mode entry point: defines a
  MarketIdentity for a niche across every real Location, no coverage import
- `lib/collector/` — adapter interface, retry + schema-drift-aware runner,
  source registry, `compare.ts` (latest-vs-previous-snapshot delta per
  metric, paired by location so a few zips swinging hard isn't masked by a
  flat average); `adapters/` has PVWatts (real + explicitly-labeled mock),
  Census ACS5 housing/income, and IRS SOI county migration
- `lib/net/curl-fetch.ts` — shared `fetch`-first/`curl`-fallback helper
  (see "Publisher" above) — used by every adapter that talks to a host
  Node's own networking has shown trouble reaching in this environment
- `lib/validation/` — completeness/outlier/freshness/cross-check rules +
  batch-gate orchestration
- `lib/queries/` — read-side queries backing the UI
- `app/markets/` — the single tabbed Market Explorer page (overview /
  research / trend / diff — see "`/markets` — one page, four tabs" above; no
  import UI, see "No manual data-import UI" below); `app/markets/research/`
  holds the niche-research server actions plus the `[vertical]` TRAFFIC
  ranked-detail route
- `app/collector/` — Data Collector + Validator pages, incl. the
  latest-vs-previous snapshot comparison card
- `app/domains/` — domain registry + Cloudflare zone creation/refresh, the
  prerequisite step before a site can be connected on `/publisher`
- `app/settings/` — Settings page: enter/clear API credentials without
  touching `.env`
- `app/publisher/` — Head Quarter dashboard for connected websites (Overview
  + per-site detail); `lib/queries/publisher.ts` orchestrates the live
  WordPress/GSC/GA4 fetches, isolated per source so one failing connection
  doesn't blank the page
- `lib/google/service-account.ts` — shared Google Cloud Service Account auth
  (JWT Bearer Token exchange, Node's built-in `crypto`, no SDK) for
  `lib/google/search-console.ts` (site-wide Search Analytics + on-demand
  URL Inspection) and `lib/google/analytics-data.ts` (GA4 Data API)
- `lib/wordpress/rest-api.ts` — public WP REST API post count, with a
  `curl` fallback for when Node's own `fetch` can't connect (see
  "Publisher — Head Quarter for the real websites" above)
- `lib/settings/credentials.ts` — DB-backed (`AppConfig` key `"credentials"`)
  credential store, with `.env` fallback; every `resolve*Adapter()` across
  the codebase reads through this instead of `process.env` directly
- `scripts/generate-sample-data.mjs` — deterministic synthetic coverage +
  keyword CSVs (not real network data) so Module 1's UI has something to show
- `scripts/seed-demo.ts` — runs the sample data through the real import →
  keyword join → scoring pipeline (Module 1)
- `scripts/generate-locations.mjs` — generates the fake ~288-zip demo location
  registry (78 hand-typed anchor cities + nearby zips); use this only when
  you don't have a `CENSUS_API_KEY` yet
- `scripts/generate-locations-from-census.ts` — real replacement: pulls the
  top 300 US ZCTAs by population from the Census ACS5 API (needs
  `CENSUS_API_KEY`), joins in state + full county FIPS (ZCTA-to-County
  relationship file — ACS5 itself has no state column for a nationwide ZCTA
  query) and city (ZCTA-to-Place relationship file), writes the same
  `locations.csv` shape as the script above so `seed-collector-demo.ts`
  doesn't need to change — **this is what's currently loaded** (see "What's
  synthetic vs. real" below)
- `scripts/backfill-county-fips.ts` — one-time `UPDATE` for `Location.countyFips`
  on rows seeded before that column existed, using the same real
  ZCTA-to-County crosswalk — deliberately not a re-run of
  `seed-collector-demo.ts`, which would wipe already-collected DataSnapshot/
  DataPoint data just to add one column
- `scripts/seed-datasources.ts` — seeds the DataSource registry with sources
  that have a real, working adapter only (`nrel_pvwatts`,
  `census_acs_housing`, `irs_migration`) — deletes any previously-seeded row
  whose adapterKey isn't in the current list, so a re-run reflects "only
  real adapters," not an ever-growing set of aspirational placeholders
- `scripts/seed-collector-demo.ts` — seeds Locations/DataSources and runs one
  PVWatts collection + validation pass (Module 2 + 3)
- `scripts/run-scheduled-collection.ts` — non-interactive CLI entry point for
  cron: same collect + validate operation as the Data Collector page's
  button, exits non-zero on failure/batch-gate-fail so cron alerting can
  catch it (Module 2)
- `scripts/run-scheduled-niche-research.ts` — non-interactive CLI entry
  point for cron: works through `lib/markets/candidate-niches.ts`'s
  suggestion backlog, `NICHE_RESEARCH_BATCH_SIZE` niches per run (default
  3), skipping anything already researched — same "Chạy nghiên cứu" pipeline
  as the button, just automatic (Module 1)

## What's synthetic vs. real

Everything under `data/samples/` is generated, clearly-labeled fake data.
`coverage-*.csv` / `keyword-metrics-*.csv`: 72 real US city/zip/state
anchors × 4 invented pay-per-call verticals, with payout and
keyword-difficulty numbers picked to deliberately exercise the flat-rate
gate, the pricing-model separation, and the payout/KD correlation warning.
`locations.csv` is no longer the fake anchor-city file — as of 2026-09-05 the
`Location` table runs on `scripts/generate-locations-from-census.ts`'s real
output: the top 300 US ZCTAs by real ACS5 2023 population, state derived
from the real Census ZCTA-to-County relationship file (ACS5 itself doesn't
return a state column for a nationwide ZCTA query — confirmed live, not
assumed), and city from the real Census ZCTA-to-Place relationship file
(100% of the top-300-by-population zips resolved to a real place name; rural
low-population ZCTAs can legitimately have none). `scripts/generate-locations.mjs`
(the old 78-hand-typed-anchor-city generator) still exists for a
no-`CENSUS_API_KEY` fallback, but isn't what's currently loaded.

PVWatts itself: `developer.nrel.gov` was fully retired 2026-05-29 — NREL
renamed to NLR (National Laboratory of the Rockies) and moved everything to
`developer.nlr.gov`. **Verified live (2026-09-05)** with a real
`NREL_API_KEY` and real lat/lon (the `address` param PVWatts used to accept
was also removed by NLR in Feb 2025 — see `lib/collector/adapters/pvwatts.ts`):
real collection runs against all 300 real zips succeed, e.g. Katy, TX
(77494) returned 5,926 kWh/yr at confidence 0.9, the real adapter's
signature. `lib/collector/adapters/pvwatts-mock.ts` (clearly labeled,
synthetic, seeds a couple of deliberate failure/outlier cases so the
Validator has something to catch) is only used when `NREL_API_KEY` isn't
set.

Google Search Console has exactly one integration: `lib/google/search-console.ts`
(Publisher — GSC/GA4 reporting for real external websites). Its
request/response shapes are verified against Google's current docs and its
Service-Account JWT auth is verified structurally live (a signed JWT was
accepted and correctly evaluated by Google's real token endpoint), but it
has no real connected website yet to test an authenticated call against —
so it ships in the same "real code, real shapes, no live property to prove
it end-to-end" state as the newer collector adapters. There is no mock GSC
adapter and no synthetic Search Console data anywhere: unlike PVWatts, GSC
has nothing this app could sensibly fake — the numbers only mean anything
about a specific site that Google has actually crawled. See "Publisher"
above.
