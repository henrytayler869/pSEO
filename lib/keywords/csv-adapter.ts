import Papa from "papaparse";
import type { KeywordMetricsAdapter, MarketRef, KeywordMetricResult } from "./types";

/**
 * Fallback / demo adapter: reads a CSV with columns
 * zip,vertical,keyword,searchVolume,keywordDifficulty,cpc
 * and matches rows to markets by (zip, vertical). Used when no
 * DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD is configured, or for offline/demo runs.
 */
export class CsvKeywordAdapter implements KeywordMetricsAdapter {
  sourceName = "csv_import";

  constructor(private readonly csvContent: string) {}

  async fetchForMarkets(markets: MarketRef[]): Promise<KeywordMetricResult[]> {
    const parsed = Papa.parse<Record<string, string>>(this.csvContent, {
      header: true,
      skipEmptyLines: true,
    });

    const byKey = new Map<string, Record<string, string>>();
    for (const row of parsed.data) {
      byKey.set(`${row.zip}::${row.vertical}`, row);
    }

    const results: KeywordMetricResult[] = [];
    for (const market of markets) {
      const row = byKey.get(`${market.zip}::${market.vertical}`);
      if (!row) continue;
      results.push({
        marketIdentityId: market.marketIdentityId,
        keyword: row.keyword,
        searchVolume: Number(row.searchVolume),
        keywordDifficulty: Number(row.keywordDifficulty),
        cpc: Number(row.cpc),
      });
    }
    return results;
  }
}
