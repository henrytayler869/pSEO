import { prisma } from "@/lib/db/prisma";
import { requireApiKey } from "@/lib/api/auth";
import { latestPerKeyword } from "@/lib/keywords/latest";
import { computeTrafficValues, computeTrafficBaselines } from "@/lib/keywords/traffic-metrics";
import { getLatestSemanticKeywords } from "@/lib/keywords/related-keywords";
import { getRealDataPointsForZipAndVertical, getCountyKeywordForZip } from "@/lib/queries/collector";
import { apiJson } from "@/lib/api/cache-policy";

/**
 * GET /api/v1/niches/{vertical}/markets/{zip} — the full real dataset for
 * one page: the main keyword this zip is built around (with its own
 * numbers), the vertical-wide national baseline to compare against, real
 * topically-related keywords (DataForSEO Labs related_keywords), and real
 * government data (Census/IRS/NOAA/EIA/FEMA/PVWatts — whichever active
 * DataSources are tagged relevant to this vertical and have collected data
 * for this exact zip) — everything a plugin needs to write one
 * locally-differentiated, SEO-optimized page without this app rendering
 * anything itself. `governmentData` is often `[]`: it depends on this zip
 * having a Location row (Module 2's own zip list, independently maintained
 * from Module 1's researched markets) — an empty array means no real
 * collected data yet for this specific zip, not an error.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/niches/[vertical]/markets/[zip]">) {
  const unauthorized = await requireApiKey(request);
  if (unauthorized) return unauthorized;

  const { vertical, zip } = await ctx.params;

  const identity = await prisma.marketIdentity.findUnique({
    where: { zip_vertical: { zip, vertical } },
    include: { keywordMetrics: true, marketScores: { where: { mode: "TRAFFIC" }, orderBy: { version: "desc" }, take: 1 } },
  });
  if (!identity) {
    return apiJson({ error: `No researched market found for vertical "${vertical}", zip "${zip}".` }, { status: 404 });
  }

  const location = await prisma.location.findFirst({ where: { zip } });
  const cityName = location?.city ?? identity.city;

  const values = computeTrafficValues(identity.keywordMetrics);
  if (!values) {
    return apiJson({ error: `No keyword data with search volume for vertical "${vertical}", zip "${zip}".` }, { status: 404 });
  }
  const latestKeywordRow = latestPerKeyword(identity.keywordMetrics)[0];
  const mainKeyword = latestKeywordRow?.keyword ?? null;

  const allVerticalIdentities = await prisma.marketIdentity.findMany({
    where: { vertical },
    include: { keywordMetrics: true },
  });
  const baseline = computeTrafficBaselines(allVerticalIdentities);

  const semanticKeywords = await getLatestSemanticKeywords(vertical);
  const governmentData = await getRealDataPointsForZipAndVertical(zip, vertical);
  const countyKeyword = await getCountyKeywordForZip(zip, vertical);

  const latestScore = identity.marketScores[0];

  return apiJson({
    vertical,
    zip,
    city: cityName,
    state: identity.state,
    // Real county name (e.g. "Bexar County"), sourced from the IRS SOI
    // file via scripts/backfill-county-names.ts — NOT derived from the
    // FIPS code. null where that source genuinely has no name (Puerto
    // Rico, Connecticut's Planning Region renumbering). A consumer must
    // fall back to "the county containing ZIP {zip}" when it's null rather
    // than guessing a name, since every COUNTY-resolution metric in
    // governmentData has to disclose its real scope.
    county: location?.county ?? null,
    // Stable join key for grouping zips that share a county — the same
    // grouping that makes COUNTY-resolution metrics (IRS migration, FEMA)
    // identical across those zips, which a consumer needs to know about to
    // avoid publishing near-duplicate pages.
    countyFips: location?.countyFips ?? null,
    // ZCTA internal-point centroid (Census Gazetteer), 100% populated.
    // Structural only: use it to order things by real proximity, never to
    // print a derived figure — a distance a consumer computes is that
    // consumer's own number, not a measured one (§7.1).
    lat: location?.lat ?? null,
    lon: location?.lon ?? null,
    // CBSA from the Census/OMB July 2023 delineation file. Real place name
    // that can legitimately be absent (rural counties belong to no CBSA) —
    // same rule as `county`: never guess one.
    metro: location?.metro ?? null,
    cbsaCode: location?.cbsaCode ?? null,
    mainKeyword: mainKeyword && {
      keyword: mainKeyword,
      searchVolume: values.searchVolume,
      cpc: values.cpc,
      keywordDifficulty: values.keywordDifficulty,
    },
    // When this market's keyword was last measured. `keyword` itself is a
    // measurement, not an identifier (see "BỀN vs ĐỔI ĐƯỢC" in
    // docs/SITE_INTEGRATION_GUIDE.md §3.5) — re-running keyword research
    // can change the phrase, which silently invalidates anything a
    // consumer keyed on the old string. A consumer that stores this
    // timestamp can tell "the keyword was re-measured since my last sync"
    // without having to keep its own copy of the previous keyword to diff
    // against.
    keywordMeasuredAt: latestKeywordRow?.fetchedAt ?? null,
    // The measured keyword for a COUNTY-sized place, when that county has a
    // name people genuinely search by. `mainKeyword` above comes from the
    // Census "Place" name, which for all 48 NYC zips is "New York" — so
    // every borough inherits the hardest phrase in the niche while its own
    // far easier term goes unused. null for most zips: most counties have
    // no distinct search name, and inventing one would fabricate a place.
    // Keyed on countyFips, never on a keyword string.
    countyKeyword,
    nationalBaseline: baseline,
    semanticKeywords,
    governmentData,
    score: latestScore?.score ?? null,
    scoreVersion: latestScore?.version ?? null,
    lastUpdated: latestScore?.calculatedAt ?? null,
  });
}
