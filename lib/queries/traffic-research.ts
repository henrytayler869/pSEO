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
/**
 * Một truy vấn gộp thay cho 13 vòng lặp tuần tự.
 *
 * Bản cũ lặp từng vertical và mỗi vòng tải TOÀN BỘ MarketIdentity của niche
 * đó kèm marketScores — 582 hàng chỉ riêng moving-services — rồi tính trung
 * bình trong JavaScript. Đo 15/9/2026 qua SSH tunnel: **10.574 ms**. Trang
 * /domains gọi nó chỉ để đổ một danh sách chọn niche, và trang /markets gọi
 * nó rồi còn gọi thêm getTrafficScoreTrend cho từng niche.
 *
 * Chi phí không nằm ở Postgres mà ở SỐ LẦN ĐI VỀ: 202 ms mỗi round-trip qua
 * tunnel (đo được), nhân với hai truy vấn mỗi niche, nhân 13 niche. Gộp vào
 * một câu SQL biến 26 lần đi về thành 1.
 *
 * DISTINCT ON là cách Postgres lấy "bản mới nhất mỗi nhóm" mà không cần
 * window function lồng nhau — nó chọn hàng đầu tiên của mỗi
 * marketIdentityId theo thứ tự version giảm dần, đúng thứ `orderBy: version
 * desc, take: 1` của bản cũ làm.
 *
 * AVG của SQL bỏ qua NULL, khớp với `filter((v) => v !== null)` của bản cũ
 * cho cpcInput. Với difficultyIndexInput và searchVolumeInput (không
 * nullable) thì hai bên tính trên cùng tập.
 *
 * scripts/test-vertical-summaries.ts đối chiếu bản này với bản cũ trên dữ
 * liệu thật và đòi khớp từng trường.
 */
export async function getTrafficVerticalSummaries(): Promise<TrafficVerticalSummary[]> {
  const rows = await prisma.$queryRaw<
    {
      vertical: string;
      market_count: bigint;
      scored_count: bigint;
      top_score: number | null;
      avg_score: number | null;
      avg_cpc: number | null;
      avg_kd: number | null;
      total_volume: bigint | null;
    }[]
  >`
    WITH latest AS (
      SELECT DISTINCT ON (ms."marketIdentityId")
             ms."marketIdentityId",
             ms.score,
             ms."cpcInput",
             ms."difficultyIndexInput",
             ms."searchVolumeInput"
      FROM "MarketScore" ms
      WHERE ms.mode = 'TRAFFIC'
      ORDER BY ms."marketIdentityId", ms.version DESC
    )
    SELECT mi.vertical                                   AS vertical,
           COUNT(*)                                      AS market_count,
           COUNT(l."marketIdentityId")                   AS scored_count,
           MAX(l.score)                                  AS top_score,
           AVG(l.score)                                  AS avg_score,
           AVG(l."cpcInput")                             AS avg_cpc,
           AVG(l."difficultyIndexInput")                 AS avg_kd,
           SUM(l."searchVolumeInput")                    AS total_volume
    FROM "MarketIdentity" mi
    LEFT JOIN latest l ON l."marketIdentityId" = mi.id
    GROUP BY mi.vertical
  `;

  // Chỉ giữ niche CÓ ít nhất một điểm TRAFFIC — giống điều kiện
  // `marketScores: { some: { mode: "TRAFFIC" } }` của bản cũ. Niche chưa
  // chấm điểm lần nào không phải "điểm 0", nó là chưa nghiên cứu.
  const summaries: Omit<TrafficVerticalSummary, "rank">[] = rows
    .filter((r) => Number(r.scored_count) > 0)
    .map((r) => ({
      vertical: r.vertical,
      marketCount: Number(r.market_count),
      scoredMarketCount: Number(r.scored_count),
      topScore: r.top_score,
      avgScore: r.avg_score,
      avgCpc: r.avg_cpc,
      avgKeywordDifficulty: r.avg_kd,
      totalSearchVolume: r.total_volume === null ? null : Number(r.total_volume),
    }));

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
  /**
   * Từng từ khoá của thị trường này, đã khử trùng lặp bằng latestPerKeyword.
   *
   * DÙNG CHUNG tập đã khử với các cột tổng hợp phía trên, không truy vấn
   * lại: KeywordMetric không bao giờ ghi đè — mỗi lần đo thêm một dòng mới —
   * nên một danh sách thô sẽ hiện "moving services dallas" ba lần và cộng
   * lại KHÔNG bằng con số ở cột Lượng tìm kiếm. Bảng con lệch bảng mẹ là
   * cách nhanh nhất khiến người ta ngừng tin cả hai.
   */
  keywords: KeywordRow[];
  /**
   * Từ khoá cấp HẠT phủ thị trường này (guide §3.6).
   *
   * KHÔNG cộng vào các cột tổng hợp phía trên, và đó là chủ ý: cột Lượng tìm
   * kiếm là cầu của chính ZIP này. Một từ khoá cấp hạt như "movers brooklyn"
   * (6.600 lượt) phủ hàng chục ZIP cùng lúc — cộng nó vào từng ZIP sẽ đếm
   * cùng một nhu cầu nhiều lần và làm mọi xếp hạng sai.
   *
   * Hiện ra vì nó CÓ thật và đang vô hình: 5 từ khoá cấp hạt của
   * moving-services không xuất hiện ở bất cứ đâu trong giao diện.
   */
  countyKeywords: KeywordRow[];
}

export interface KeywordRow {
  keyword: string;
  searchVolume: number;
  keywordDifficulty: number;
  cpc: number;
  /** Null = lần đo đó chưa lấy trường này, KHÔNG phải "không có ý định". */
  mainIntent: string | null;
  fetchedAt: Date;
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

  // Lớp từ khoá cấp hạt, tra theo FIPS. Một truy vấn cho cả niche chứ không
  // theo từng thị trường: số dòng nhỏ và nhiều ZIP dùng chung một hạt.
  const countyKw = await prisma.countyKeywordMetric.findMany({ where: { vertical } });
  const countyByFips = new Map<string, KeywordRow[]>();
  for (const k of latestPerKeyword(countyKw)) {
    countyByFips.set(k.countyFips, [
      ...(countyByFips.get(k.countyFips) ?? []),
      { keyword: k.keyword, searchVolume: k.searchVolume, keywordDifficulty: k.keywordDifficulty, cpc: k.cpc, mainIntent: null, fetchedAt: k.fetchedAt },
    ]);
  }

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
      keywords: [...metrics]
        .sort((a, b) => b.searchVolume - a.searchVolume)
        .map((k) => ({
          keyword: k.keyword,
          searchVolume: k.searchVolume,
          keywordDifficulty: k.keywordDifficulty,
          cpc: k.cpc,
          mainIntent: k.mainIntent,
          fetchedAt: k.fetchedAt,
        })),
      countyKeywords: location?.countyFips ? (countyByFips.get(location.countyFips) ?? []) : [],
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
