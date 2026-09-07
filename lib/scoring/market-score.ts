import { prisma } from "@/lib/db/prisma";
import { latestPerKeyword } from "@/lib/keywords/latest";

export const FORMULA_VERSION = "v2: payoutFloor * estConversionRate * searchVolume / max(difficultyIndex, 1)";

// DataForSEO can legitimately return keywordDifficulty: 0 for genuinely
// low-competition real terms (confirmed live, 2026-09-06: several real
// "mortgage refinance {city}" keywords came back this way) — a difficulty
// of 0 means "not competitive," not "unscoreable." The original guard
// (`if (difficultyIndexInput <= 0) continue`) treated it as the latter and
// silently skipped every market in mortgage-refinance, scoring 0 of them.
// Flooring the divisor instead lets these markets score (correctly, very
// well — low competition is a good thing) while still preventing
// div-by-zero/Infinity. difficultyIndexInput itself still stores the raw
// (possibly 0) value for traceability; only the division is protected.
const MIN_DIFFICULTY_FLOOR = 1;

// Conservative, clearly-labeled-as-assumptions conversion rate priors per
// vertical. These are guesses, not measured data — that's why every score
// stores estConversionRateInput alongside the result, so a market's ranking
// can always be traced back to (and challenged on) this specific number.
// Overridable via AppConfig key "estConversionRateByVertical" ({ [vertical]: number }).
const DEFAULT_CONVERSION_RATE_BY_VERTICAL: Record<string, number> = {
  "water-damage-restoration": 0.18,
  "hvac-repair": 0.22,
  "roofing-replacement": 0.08, // PER_APPOINTMENT — harder to convert, priced accordingly
  "garage-door-repair": 0.15,
};
const FALLBACK_CONVERSION_RATE = 0.15;

async function getConversionRateByVertical(): Promise<Record<string, number>> {
  const config = await prisma.appConfig.findUnique({ where: { key: "estConversionRateByVertical" } });
  if (config && typeof config.value === "object" && config.value !== null) {
    return { ...DEFAULT_CONVERSION_RATE_BY_VERTICAL, ...(config.value as Record<string, number>) };
  }
  return DEFAULT_CONVERSION_RATE_BY_VERTICAL;
}

export interface ScoreComputation {
  marketIdentityId: string;
  sourceMarketId: string;
  score: number;
  payoutFloorInput: number;
  estConversionRateInput: number;
  searchVolumeInput: number;
  difficultyIndexInput: number;
}

export const TRAFFIC_FORMULA_VERSION = "v2-traffic: searchVolume * cpc / max(difficultyIndex, 1)";

export interface TrafficScoreComputation {
  marketIdentityId: string;
  score: number;
  cpcInput: number;
  searchVolumeInput: number;
  difficultyIndexInput: number;
}

/** Computes and persists a new versioned MarketScore for every Market
 * snapshot in a given coverage import. Version numbers increment per
 * MarketIdentity — not per import — so a real market's score history stays
 * continuous across coverage refreshes instead of resetting to version 1
 * every time the network re-sends its file. Never overwrites a prior score. */
export async function computeMarketScoresForImport(coverageImportId: string): Promise<ScoreComputation[]> {
  const conversionRates = await getConversionRateByVertical();

  const markets = await prisma.market.findMany({
    where: { coverageImportId },
    include: { marketIdentity: { include: { keywordMetrics: true } } },
  });

  const computations: ScoreComputation[] = [];

  for (const market of markets) {
    const metrics = latestPerKeyword(market.marketIdentity.keywordMetrics);
    if (metrics.length === 0) continue; // no keyword data yet — nothing to score

    const searchVolumeInput = metrics.reduce((sum, k) => sum + k.searchVolume, 0);
    const difficultyIndexInput = metrics.reduce((sum, k) => sum + k.keywordDifficulty, 0) / metrics.length;
    const estConversionRateInput = conversionRates[market.marketIdentity.vertical] ?? FALLBACK_CONVERSION_RATE;

    const score = (market.payoutFloor * estConversionRateInput * searchVolumeInput) / Math.max(difficultyIndexInput, MIN_DIFFICULTY_FLOOR);

    computations.push({
      marketIdentityId: market.marketIdentityId,
      sourceMarketId: market.id,
      score,
      payoutFloorInput: market.payoutFloor,
      estConversionRateInput,
      searchVolumeInput,
      difficultyIndexInput,
    });
  }

  // Determine next version per MarketIdentity — continuing whatever history
  // already exists for that real market, from any prior import.
  const existingVersions = await prisma.marketScore.groupBy({
    by: ["marketIdentityId"],
    where: { marketIdentityId: { in: computations.map((c) => c.marketIdentityId) } },
    _max: { version: true },
  });
  const nextVersionByIdentity = new Map(existingVersions.map((v) => [v.marketIdentityId, (v._max.version ?? 0) + 1]));

  await prisma.marketScore.createMany({
    data: computations.map((c) => ({
      marketIdentityId: c.marketIdentityId,
      sourceMarketId: c.sourceMarketId,
      mode: "PAYOUT",
      version: nextVersionByIdentity.get(c.marketIdentityId) ?? 1,
      score: c.score,
      payoutFloorInput: c.payoutFloorInput,
      estConversionRateInput: c.estConversionRateInput,
      searchVolumeInput: c.searchVolumeInput,
      difficultyIndexInput: c.difficultyIndexInput,
      formulaVersion: FORMULA_VERSION,
    })),
  });

  return computations;
}

/** Scores every MarketIdentity in a vertical purely on SEO opportunity —
 * searchVolume * cpc / difficulty — with no payout data involved at all.
 * This is the scoring path for niches researched before (or without ever)
 * having a pay-per-call/lead-gen network relationship: rank by traffic
 * potential now, layer in real payout economics later once a network
 * exists (see computeMarketScoresForImport). Same never-overwrite,
 * continuous-version-per-identity discipline as the payout path. */
export async function computeTrafficScoresForVertical(vertical: string): Promise<TrafficScoreComputation[]> {
  const identities = await prisma.marketIdentity.findMany({
    where: { vertical },
    include: { keywordMetrics: true },
  });

  const computations: TrafficScoreComputation[] = [];

  for (const identity of identities) {
    const metrics = latestPerKeyword(identity.keywordMetrics);
    if (metrics.length === 0) continue; // no keyword data yet — nothing to score

    const searchVolumeInput = metrics.reduce((sum, k) => sum + k.searchVolume, 0);
    const difficultyIndexInput = metrics.reduce((sum, k) => sum + k.keywordDifficulty, 0) / metrics.length;
    const cpcInput = metrics.reduce((sum, k) => sum + k.cpc, 0) / metrics.length;

    const score = (searchVolumeInput * cpcInput) / Math.max(difficultyIndexInput, MIN_DIFFICULTY_FLOOR);

    computations.push({
      marketIdentityId: identity.id,
      score,
      cpcInput,
      searchVolumeInput,
      difficultyIndexInput,
    });
  }

  const existingVersions = await prisma.marketScore.groupBy({
    by: ["marketIdentityId"],
    where: { marketIdentityId: { in: computations.map((c) => c.marketIdentityId) } },
    _max: { version: true },
  });
  const nextVersionByIdentity = new Map(existingVersions.map((v) => [v.marketIdentityId, (v._max.version ?? 0) + 1]));

  await prisma.marketScore.createMany({
    data: computations.map((c) => ({
      marketIdentityId: c.marketIdentityId,
      sourceMarketId: null,
      mode: "TRAFFIC",
      version: nextVersionByIdentity.get(c.marketIdentityId) ?? 1,
      score: c.score,
      cpcInput: c.cpcInput,
      searchVolumeInput: c.searchVolumeInput,
      difficultyIndexInput: c.difficultyIndexInput,
      formulaVersion: TRAFFIC_FORMULA_VERSION,
    })),
  });

  return computations;
}
