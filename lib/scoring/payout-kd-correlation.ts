import { prisma } from "@/lib/db/prisma";
import { latestPerKeyword } from "@/lib/keywords/latest";

export interface CorrelationResult {
  vertical: string;
  correlation: number | null; // Pearson r between payoutFloor and avg KD; null if not computable
  sampleSize: number;
  isTrap: boolean; // high payout correlates with high difficulty — "can't rank where it pays"
}

const TRAP_THRESHOLD = 0.5;

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null; // too few points to mean anything
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denomX = 0, denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  if (denomX === 0 || denomY === 0) return null; // no variance (e.g. flat-rate payout) — undefined, not zero
  return num / Math.sqrt(denomX * denomY);
}

/** For each non-flat-rate vertical in a coverage import, correlates
 * payoutFloor against average keyword difficulty across its markets. A
 * strong positive correlation means the highest-paying markets are also the
 * hardest to rank in — the "attractive payout, can't win the SERP" trap the
 * UI needs to surface before anyone commits build effort to those markets. */
export async function computePayoutKdCorrelation(coverageImportId: string): Promise<CorrelationResult[]> {
  const markets = await prisma.market.findMany({
    where: { coverageImportId },
    include: { marketIdentity: { include: { keywordMetrics: true } } },
  });

  const byVertical = new Map<string, { payout: number; kd: number }[]>();
  for (const market of markets) {
    if (market.isFlatRate) continue;
    const metrics = latestPerKeyword(market.marketIdentity.keywordMetrics);
    if (metrics.length === 0) continue;
    const avgKd = metrics.reduce((s, k) => s + k.keywordDifficulty, 0) / metrics.length;
    const list = byVertical.get(market.marketIdentity.vertical) ?? [];
    list.push({ payout: market.payoutFloor, kd: avgKd });
    byVertical.set(market.marketIdentity.vertical, list);
  }

  const results: CorrelationResult[] = [];
  for (const [vertical, points] of byVertical) {
    const correlation = pearson(points.map((p) => p.payout), points.map((p) => p.kd));
    results.push({
      vertical,
      correlation,
      sampleSize: points.length,
      isTrap: correlation !== null && correlation >= TRAP_THRESHOLD,
    });
  }
  return results;
}
