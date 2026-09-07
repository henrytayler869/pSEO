import { prisma } from "@/lib/db/prisma";
import { latestPerKeyword } from "@/lib/keywords/latest";

export interface TrafficVerticalSummary {
  vertical: string;
  marketCount: number;
  scoredMarketCount: number;
  topScore: number | null;
  avgScore: number | null;
  avgCpc: number | null;
  avgKeywordDifficulty: number | null;
  totalSearchVolume: number | null;
  rank: number | null; // 1 = best avgScore among researched niches, null if unscored
}

/** One row per vertical that has at least one TRAFFIC-mode score — niches
 * being researched purely on SEO opportunity, no network relationship
 * involved. Parallel to getVerticalSummaries() in market-explorer.ts, but
 * deliberately a separate, smaller shape: TRAFFIC rows never have
 * payout/pricingModel/isFlatRate, so there is nothing to make nullable
 * here — this type is honest about what a niche without a network actually
 * has. marketCount is every MarketIdentity defined for the niche (across
 * every real Location), separate from scoredMarketCount — most will lack a
 * score until keyword data has been fetched for them too.
 *
 * Sorted by avgScore descending (best niche first) — avgScore, not
 * topScore, is the fairer cross-niche comparison metric: a niche with one
 * lucky zip and 300 mediocre ones shouldn't outrank a niche that's
 * consistently good, which topScore alone can't tell apart. topScore is
 * still returned too (useful for "best zip to build first" within a niche
 * you've already picked), just not what ranks niches against each other. */
export async function getTrafficVerticalSummaries(): Promise<TrafficVerticalSummary[]> {
  const scoredVerticals = await prisma.marketIdentity.findMany({
    where: { marketScores: { some: { mode: "TRAFFIC" } } },
    select: { vertical: true },
    distinct: ["vertical"],
  });

  const summaries: Omit<TrafficVerticalSummary, "rank">[] = [];
  for (const { vertical } of scoredVerticals) {
    const [marketCount, scored] = await Promise.all([
      prisma.marketIdentity.count({ where: { vertical } }),
      prisma.marketIdentity.findMany({
        where: { vertical, marketScores: { some: { mode: "TRAFFIC" } } },
        include: { marketScores: { where: { mode: "TRAFFIC" }, orderBy: { version: "desc" }, take: 1 } },
      }),
    ]);
    const latestScores = scored.map((i) => i.marketScores[0]).filter((s) => s !== undefined);
    const scoreValues = latestScores.map((s) => s.score);
    const cpcValues = latestScores.map((s) => s.cpcInput).filter((v): v is number => v !== null);
    const kdValues = latestScores.map((s) => s.difficultyIndexInput);
    const volumeValues = latestScores.map((s) => s.searchVolumeInput);

    summaries.push({
      vertical,
      marketCount,
      scoredMarketCount: scored.length,
      topScore: scoreValues.length > 0 ? Math.max(...scoreValues) : null,
      avgScore: scoreValues.length > 0 ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length : null,
      avgCpc: cpcValues.length > 0 ? cpcValues.reduce((a, b) => a + b, 0) / cpcValues.length : null,
      avgKeywordDifficulty: kdValues.length > 0 ? kdValues.reduce((a, b) => a + b, 0) / kdValues.length : null,
      totalSearchVolume: volumeValues.length > 0 ? volumeValues.reduce((a, b) => a + b, 0) : null,
    });
  }

  const ranked = [...summaries].sort((a, b) => (b.avgScore ?? -Infinity) - (a.avgScore ?? -Infinity));
  const rankByVertical = new Map(ranked.filter((s) => s.avgScore !== null).map((s, i) => [s.vertical, i + 1]));

  return ranked.map((s) => ({ ...s, rank: rankByVertical.get(s.vertical) ?? null }));
}

export interface TrafficRankedRow {
  marketIdentityId: string;
  zip: string;
  city: string | null;
  state: string;
  /** Real county name from the IRS SOI source (scripts/backfill-county-names.ts);
   * null where that source has no name for the FIPS — never derived/guessed. */
  county: string | null;
  /** Grouping key for zips sharing a county. Two zips with the same
   * countyFips receive byte-identical values for every COUNTY-resolution
   * metric (IRS migration, FEMA declarations), so a consumer can use this
   * plus mainKeyword to spot near-duplicate pages before building them. */
  countyFips: string | null;
  /** ZCTA internal-point centroid (Census Gazetteer). Structural only —
   * meant for ordering things by real proximity (e.g. "nearest markets"
   * instead of "same state"), NOT for printing a distance: a distance
   * computed by a consumer is that consumer's own number, not a measured
   * one, and printing it would breach the "only show measured values" rule. */
  lat: number | null;
  lon: number | null;
  /** CBSA (Core Based Statistical Area) — the real metro/micro area the
   * county belongs to, from the Census/OMB July 2023 delineation file.
   * null for counties outside any CBSA (genuinely rural), so treat it like
   * `county`: a real place name that may be absent, never to be guessed. */
  metro: string | null;
  cbsaCode: string | null;
  mainKeyword: string | null;
  /** When mainKeyword was last measured. The keyword string is a
   * measurement, not an identifier — re-running research can change it, so
   * a consumer keying on the string needs a way to notice. */
  keywordMeasuredAt: Date | null;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  cpc: number | null;
  score: number | null;
  scoreVersion: number | null;
}

export async function getTrafficRankedMarkets(vertical: string): Promise<TrafficRankedRow[]> {
  const identities = await prisma.marketIdentity.findMany({
    where: { vertical },
    include: {
      keywordMetrics: true,
      marketScores: { where: { mode: "TRAFFIC" }, orderBy: { version: "desc" }, take: 1 },
    },
  });

  // Location is a separate, independently-maintained zip registry (see
  // "Location vs. MarketIdentity" in README) — one bulk lookup keyed by zip
  // rather than a join, since plenty of researched zips have no Location row.
  const locations = await prisma.location.findMany({
    where: { zip: { in: identities.map((i) => i.zip) } },
    select: { zip: true, county: true, countyFips: true, lat: true, lon: true, metro: true, cbsaCode: true },
  });
  const locationByZip = new Map(locations.map((l) => [l.zip, l]));

  const rows: TrafficRankedRow[] = identities.map((identity) => {
    const metrics = latestPerKeyword(identity.keywordMetrics);
    const latestScore = identity.marketScores[0];
    const location = locationByZip.get(identity.zip);
    const avgKd = metrics.length > 0 ? metrics.reduce((s, k) => s + k.keywordDifficulty, 0) / metrics.length : null;
    const totalVolume = metrics.length > 0 ? metrics.reduce((s, k) => s + k.searchVolume, 0) : null;
    const avgCpc = metrics.length > 0 ? metrics.reduce((s, k) => s + k.cpc, 0) / metrics.length : null;

    return {
      marketIdentityId: identity.id,
      zip: identity.zip,
      city: identity.city,
      state: identity.state,
      county: location?.county ?? null,
      lat: location?.lat ?? null,
      lon: location?.lon ?? null,
      metro: location?.metro ?? null,
      cbsaCode: location?.cbsaCode ?? null,
      countyFips: location?.countyFips ?? null,
      mainKeyword: metrics[0]?.keyword ?? null,
      keywordMeasuredAt: metrics[0]?.fetchedAt ?? null,
      searchVolume: totalVolume,
      keywordDifficulty: avgKd,
      cpc: avgCpc,
      score: latestScore?.score ?? null,
      scoreVersion: latestScore?.version ?? null,
    };
  });

  return rows.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
}

export interface TrafficTrendPoint {
  date: string; // yyyy-mm-dd — one point per calendar day a research run happened
  avgScore: number;
  topScore: number;
  scoredCount: number;
}

/** Rolls up every TRAFFIC-mode score for a vertical by calendar day of
 * calculatedAt, across all its MarketIdentity rows. A day-level rollup
 * (rather than per-identity version) is what actually lines up with "so
 * sánh theo thời gian" here — running scripts/run-scheduled-niche-research.ts
 * scores every identity in one pass, but each identity's own version
 * counter can drift out of sync with the others (e.g. a zip added after the
 * niche's first run starts at version 1 while older zips are already on
 * version 3), so grouping by day is the only honest way to say "this was
 * the state of the niche on this date." */
export async function getTrafficScoreTrend(vertical: string): Promise<TrafficTrendPoint[]> {
  const scores = await prisma.marketScore.findMany({
    where: { mode: "TRAFFIC", marketIdentity: { vertical } },
    select: { score: true, calculatedAt: true },
    orderBy: { calculatedAt: "asc" },
  });

  const byDate = new Map<string, number[]>();
  for (const s of scores) {
    const day = s.calculatedAt.toISOString().slice(0, 10);
    const list = byDate.get(day) ?? [];
    list.push(s.score);
    byDate.set(day, list);
  }

  const points: TrafficTrendPoint[] = [];
  for (const [date, list] of byDate) {
    points.push({
      date,
      avgScore: list.reduce((a, b) => a + b, 0) / list.length,
      topScore: Math.max(...list),
      scoredCount: list.length,
    });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}
