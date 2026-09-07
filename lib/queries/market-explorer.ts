import { prisma } from "@/lib/db/prisma";
import { computePayoutKdCorrelation, type CorrelationResult } from "@/lib/scoring/payout-kd-correlation";
import { latestPerKeyword } from "@/lib/keywords/latest";

export async function getCoverageImports() {
  return prisma.coverageImport.findMany({ orderBy: { importedAt: "desc" } });
}

export async function getLatestCoverageImport() {
  return prisma.coverageImport.findFirst({ orderBy: { importedAt: "desc" } });
}

/** Latest MarketScore computed *from this specific coverage import's
 * snapshots* (via sourceMarketId) — not just the globally latest score for
 * the identity. Viewing an old import should show the ranking as it was
 * computed for that import, even if a newer import has since produced a
 * more recent version for the same MarketIdentity. */
async function getScoresBySourceMarketId(marketIds: string[]) {
  const scores = await prisma.marketScore.findMany({
    where: { sourceMarketId: { in: marketIds } },
    orderBy: { version: "desc" },
  });
  const latestBySourceMarketId = new Map<string, (typeof scores)[number]>();
  for (const s of scores) {
    if (s.sourceMarketId && !latestBySourceMarketId.has(s.sourceMarketId)) {
      latestBySourceMarketId.set(s.sourceMarketId, s);
    }
  }
  return latestBySourceMarketId;
}

export interface VerticalSummary {
  vertical: string;
  pricingModel: string;
  isFlatRate: boolean;
  marketCount: number;
  scoredMarketCount: number;
  topScore: number | null;
  correlation: CorrelationResult | null;
}

export async function getVerticalSummaries(coverageImportId: string): Promise<VerticalSummary[]> {
  const markets = await prisma.market.findMany({
    where: { coverageImportId },
    include: { marketIdentity: true },
  });

  const scoreBySourceMarketId = await getScoresBySourceMarketId(markets.map((m) => m.id));
  const correlations = await computePayoutKdCorrelation(coverageImportId);
  const correlationByVertical = new Map(correlations.map((c) => [c.vertical, c]));

  const byVertical = new Map<string, typeof markets>();
  for (const m of markets) {
    const list = byVertical.get(m.marketIdentity.vertical) ?? [];
    list.push(m);
    byVertical.set(m.marketIdentity.vertical, list);
  }

  const summaries: VerticalSummary[] = [];
  for (const [vertical, list] of byVertical) {
    const scores = list
      .map((m) => scoreBySourceMarketId.get(m.id)?.score)
      .filter((s): s is number => s !== undefined);
    summaries.push({
      vertical,
      pricingModel: list[0].pricingModel,
      isFlatRate: list[0].isFlatRate,
      marketCount: list.length,
      scoredMarketCount: scores.length,
      topScore: scores.length > 0 ? Math.max(...scores) : null,
      correlation: correlationByVertical.get(vertical) ?? null,
    });
  }

  return summaries.sort((a, b) => a.vertical.localeCompare(b.vertical));
}

export interface RankedMarketRow {
  marketId: string;
  zip: string;
  city: string | null;
  state: string;
  payoutFloor: number;
  isFlatRate: boolean;
  pricingModel: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  cpc: number | null;
  score: number | null;
  estConversionRateInput: number | null;
  scoreVersion: number | null;
}

export async function getRankedMarkets(coverageImportId: string, vertical: string): Promise<RankedMarketRow[]> {
  const markets = await prisma.market.findMany({
    where: { coverageImportId, marketIdentity: { vertical } },
    include: {
      marketIdentity: { include: { keywordMetrics: true } },
    },
  });

  const scoreBySourceMarketId = await getScoresBySourceMarketId(markets.map((m) => m.id));

  const rows: RankedMarketRow[] = markets.map((m) => {
    const metrics = latestPerKeyword(m.marketIdentity.keywordMetrics);
    const latestScore = scoreBySourceMarketId.get(m.id);
    const avgKd = metrics.length > 0 ? metrics.reduce((s, k) => s + k.keywordDifficulty, 0) / metrics.length : null;
    const totalVolume = metrics.length > 0 ? metrics.reduce((s, k) => s + k.searchVolume, 0) : null;
    const avgCpc = metrics.length > 0 ? metrics.reduce((s, k) => s + k.cpc, 0) / metrics.length : null;

    return {
      marketId: m.id,
      zip: m.marketIdentity.zip,
      city: m.marketIdentity.city,
      state: m.marketIdentity.state,
      payoutFloor: m.payoutFloor,
      isFlatRate: m.isFlatRate,
      pricingModel: m.pricingModel,
      searchVolume: totalVolume,
      keywordDifficulty: avgKd,
      cpc: avgCpc,
      score: latestScore?.score ?? null,
      estConversionRateInput: latestScore?.estConversionRateInput ?? null,
      scoreVersion: latestScore?.version ?? null,
    };
  });

  return rows.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
}
