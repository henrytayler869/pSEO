import { latestPerKeyword } from "./latest";

export interface TrafficMetricValues {
  searchVolume: number;
  cpc: number;
  keywordDifficulty: number;
}

interface KeywordMetricLike {
  keyword: string;
  fetchedAt: Date;
  searchVolume: number;
  cpc: number;
  keywordDifficulty: number;
}

/** Real, aggregated local search-demand numbers for one MarketIdentity —
 * shared by the (optional) TRAFFIC-mode page builder and the public
 * dataset API, so both ever report exactly the same numbers for the same
 * zip. Null means "no usable keyword data for this zip", not zero. */
export function computeTrafficValues(keywordMetrics: KeywordMetricLike[]): TrafficMetricValues | null {
  const latest = latestPerKeyword(keywordMetrics);
  if (latest.length === 0) return null;
  const totalVolume = latest.reduce((s, k) => s + k.searchVolume, 0);
  if (totalVolume === 0) return null;
  return {
    searchVolume: totalVolume,
    cpc: latest.reduce((s, k) => s + k.cpc, 0) / latest.length,
    keywordDifficulty: latest.reduce((s, k) => s + k.keywordDifficulty, 0) / latest.length,
  };
}

/** Vertical-wide average across every identity that has usable keyword
 * data — the "national average" a single zip is compared against. */
export function computeTrafficBaselines(identities: { keywordMetrics: KeywordMetricLike[] }[]): TrafficMetricValues {
  const perIdentity = identities.map((i) => computeTrafficValues(i.keywordMetrics)).filter((v): v is TrafficMetricValues => v !== null);
  if (perIdentity.length === 0) return { searchVolume: 0, cpc: 0, keywordDifficulty: 0 };
  return {
    searchVolume: perIdentity.reduce((s, v) => s + v.searchVolume, 0) / perIdentity.length,
    cpc: perIdentity.reduce((s, v) => s + v.cpc, 0) / perIdentity.length,
    keywordDifficulty: perIdentity.reduce((s, v) => s + v.keywordDifficulty, 0) / perIdentity.length,
  };
}
