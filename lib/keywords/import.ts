import { prisma } from "@/lib/db/prisma";
import type { KeywordMetricsAdapter } from "./types";
import { DataForSeoKeywordAdapter } from "./dataforseo-adapter";
import { CsvKeywordAdapter } from "./csv-adapter";
import { getCredential } from "@/lib/settings/credentials";

/** Picks the live DataForSEO adapter if credentials are configured,
 * otherwise falls back to a CSV adapter the caller must supply content for.
 * This keeps the "join with a real keyword-data API" requirement real while
 * still letting the pipeline be reviewed without a live credential. */
export async function resolveKeywordAdapter(csvContent?: string): Promise<KeywordMetricsAdapter> {
  const login = await getCredential("DATAFORSEO_LOGIN");
  const password = await getCredential("DATAFORSEO_PASSWORD");
  if (login && password) return new DataForSeoKeywordAdapter(login, password);
  if (csvContent) return new CsvKeywordAdapter(csvContent);
  throw new Error(
    "Chưa cấu hình DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD (ở trang Cài đặt hoặc biến môi trường) và không có tệp CSV nào được cung cấp — không thể lấy số liệu từ khóa."
  );
}

export async function importKeywordMetricsForImport(coverageImportId: string, csvContent?: string) {
  const markets = await prisma.market.findMany({
    where: { coverageImportId },
    include: { marketIdentity: true },
  });
  const adapter = await resolveKeywordAdapter(csvContent);

  const results = await adapter.fetchForMarkets(
    markets.map((m) => ({
      marketIdentityId: m.marketIdentityId,
      zip: m.marketIdentity.zip,
      city: m.marketIdentity.city,
      state: m.marketIdentity.state,
      vertical: m.marketIdentity.vertical,
    }))
  );

  await prisma.keywordMetric.createMany({
    data: results.map((r) => ({
      marketIdentityId: r.marketIdentityId,
      keyword: r.keyword,
      searchVolume: r.searchVolume,
      keywordDifficulty: r.keywordDifficulty,
      cpc: r.cpc,
      source: adapter.sourceName,
    })),
  });

  return { sourceName: adapter.sourceName, count: results.length, marketsMissingData: markets.length - results.length };
}

interface IdentityForKeywordFetch {
  id: string;
  zip: string;
  city: string | null;
  state: string;
  vertical: string;
}

async function fetchAndStoreKeywordMetrics(identities: IdentityForKeywordFetch[], csvContent?: string) {
  const adapter = await resolveKeywordAdapter(csvContent);

  const results = await adapter.fetchForMarkets(
    identities.map((identity) => ({
      marketIdentityId: identity.id,
      zip: identity.zip,
      city: identity.city,
      state: identity.state,
      vertical: identity.vertical,
    }))
  );

  await prisma.keywordMetric.createMany({
    data: results.map((r) => ({
      marketIdentityId: r.marketIdentityId,
      keyword: r.keyword,
      searchVolume: r.searchVolume,
      keywordDifficulty: r.keywordDifficulty,
      cpc: r.cpc,
      source: adapter.sourceName,
    })),
  });

  return {
    sourceName: adapter.sourceName,
    count: results.length,
    marketsMissingData: identities.length - results.length,
  };
}

/** TRAFFIC-mode counterpart to importKeywordMetricsForImport — joins
 * keyword data directly onto every MarketIdentity in a vertical, with no
 * CoverageImport/Market involved. This is what "researching a niche without
 * a network yet" fetches keyword data through. */
export async function fetchKeywordMetricsForVertical(vertical: string, csvContent?: string) {
  const identities = await prisma.marketIdentity.findMany({ where: { vertical } });
  if (identities.length === 0) {
    throw new Error(`Chưa có MarketIdentity nào cho ngành "${vertical}" — hãy tạo thị trường trước.`);
  }
  return fetchAndStoreKeywordMetrics(identities, csvContent);
}

/** Same as fetchKeywordMetricsForVertical but scoped to an explicit list of
 * MarketIdentity ids — for resyncing just the markets newly created by
 * defineNicheAcrossLocations (e.g. after Location's zip list changed)
 * without re-billing DataForSEO for markets that already have current
 * keyword data. */
export async function fetchKeywordMetricsForIdentityIds(identityIds: string[], csvContent?: string) {
  if (identityIds.length === 0) {
    return { sourceName: "(none)", count: 0, marketsMissingData: 0 };
  }
  const identities = await prisma.marketIdentity.findMany({ where: { id: { in: identityIds } } });
  return fetchAndStoreKeywordMetrics(identities, csvContent);
}
