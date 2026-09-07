export interface MarketRef {
  marketIdentityId: string;
  zip: string;
  city: string | null; // null for zips sourced from real Census data (TRAFFIC mode) — no city name available
  state: string;
  vertical: string;
}

export interface KeywordMetricResult {
  marketIdentityId: string;
  keyword: string;
  searchVolume: number;
  keywordDifficulty: number;
  cpc: number;
}

export interface KeywordMetricsAdapter {
  /** identifies the adapter for the `source` column on KeywordMetric rows */
  sourceName: string;
  fetchForMarkets(markets: MarketRef[]): Promise<KeywordMetricResult[]>;
}
