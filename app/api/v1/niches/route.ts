import { requireApiKey } from "@/lib/api/auth";
import { getTrafficVerticalSummaries } from "@/lib/queries/traffic-research";
import { apiJson } from "@/lib/api/cache-policy";

/**
 * GET /api/v1/niches — every TRAFFIC-researched niche, ranked by average
 * traffic score, for a plugin/website to discover what's available before
 * asking for a specific niche's markets.
 */
export async function GET(request: Request) {
  const unauthorized = await requireApiKey(request);
  if (unauthorized) return unauthorized;

  const summaries = await getTrafficVerticalSummaries();
  return apiJson({
    niches: summaries.map((s) => ({
      vertical: s.vertical,
      rank: s.rank,
      marketCount: s.marketCount,
      scoredMarketCount: s.scoredMarketCount,
      avgScore: s.avgScore,
      avgCpc: s.avgCpc,
      avgKeywordDifficulty: s.avgKeywordDifficulty,
      totalSearchVolume: s.totalSearchVolume,
    })),
  });
}
