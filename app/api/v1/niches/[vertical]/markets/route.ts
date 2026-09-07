import { requireApiKey } from "@/lib/api/auth";
import { getTrafficRankedMarkets } from "@/lib/queries/traffic-research";

/**
 * GET /api/v1/niches/{vertical}/markets — every real zip researched for this
 * niche, with its main keyword and core numbers. Meant for a plugin to
 * enumerate which pages it could build, then call the per-zip detail route
 * for the full dataset (semantic keywords, national baseline) of the ones
 * it actually builds.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/niches/[vertical]/markets">) {
  const unauthorized = await requireApiKey(request);
  if (unauthorized) return unauthorized;

  const { vertical } = await ctx.params;
  const markets = await getTrafficRankedMarkets(vertical);
  if (markets.length === 0) {
    return Response.json({ error: `No researched markets found for vertical "${vertical}".` }, { status: 404 });
  }

  return Response.json({
    vertical,
    markets: markets.map((m) => ({
      zip: m.zip,
      city: m.city,
      state: m.state,
      county: m.county,
      countyFips: m.countyFips,
      lat: m.lat,
      lon: m.lon,
      metro: m.metro,
      cbsaCode: m.cbsaCode,
      mainKeyword: m.mainKeyword,
      keywordMeasuredAt: m.keywordMeasuredAt,
      searchVolume: m.searchVolume,
      cpc: m.cpc,
      keywordDifficulty: m.keywordDifficulty,
      score: m.score,
    })),
  });
}
