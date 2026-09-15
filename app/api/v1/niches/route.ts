import { requireApiKey, apiCaller } from "@/lib/api/auth";
import { getTrafficVerticalSummaries } from "@/lib/queries/traffic-research";
import { apiJson } from "@/lib/api/cache-policy";

/**
 * GET /api/v1/niches — every TRAFFIC-researched niche, ranked by average
 * traffic score, for a plugin/website to discover what's available before
 * asking for a specific niche's markets.
 *
 * Lọc xuống đúng niche của khoá. Trước đây trả về cả danh sách, và danh sách
 * đó là bản đồ những gì đang được dựng — thứ không nên đi kèm một khoá chỉ
 * được đọc một niche. Khoá dùng chung cũ (websiteId null) vẫn thấy tất cả.
 *
 * Site đầu không vỡ vì chuyện này: chỗ duy nhất gọi /niches là
 * scripts/hq-check.ts, và nó chỉ tìm vertical của CHÍNH NÓ trong danh sách.
 */
export async function GET(request: Request) {
  const unauthorized = await requireApiKey(request, "no-scope");
  if (unauthorized) return unauthorized;
  const caller = await apiCaller(request);

  const all = await getTrafficVerticalSummaries();
  const summaries = caller?.vertical ? all.filter((s) => s.vertical === caller.vertical) : all;
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
