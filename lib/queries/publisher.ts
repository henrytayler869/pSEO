import { prisma } from "@/lib/db/prisma";
import { fetchPublishedPostCount, deriveWpApiBaseUrl } from "@/lib/wordpress/rest-api";
import { fetchSiteSearchTotals, fetchTopPages } from "@/lib/google/search-console";
import { fetchSiteTrafficTotals, fetchTrafficBySource } from "@/lib/google/analytics-data";

const OVERVIEW_WINDOW_DAYS = 28;

export interface WebsiteOverviewRow {
  website: Awaited<ReturnType<typeof prisma.website.findMany>>[number];
  postCount: number | null;
  indexRateEstimate: number | null; // pagesWithImpressions / postCount — null if either input is missing
  totalUsers: number | null;
  error: string | null; // set (and other fields null) when any live fetch failed for this site
}

/** Every number here is fetched live from WordPress/GSC/GA4 on each call —
 * nothing is mirrored into this app's DB, so the Overview can never show a
 * stale number relative to the real source. One site's fetch failing
 * (wrong property ID, site down, service account not yet added as viewer)
 * is reported per-row rather than failing the whole dashboard. */
export async function getWebsiteOverviewRows(): Promise<WebsiteOverviewRow[]> {
  const websites = await prisma.website.findMany({ orderBy: { createdAt: "asc" } });
  return Promise.all(
    websites.map(async (website): Promise<WebsiteOverviewRow> => {
      try {
        const wpApiBaseUrl = website.wpApiBaseUrl ?? deriveWpApiBaseUrl(website.url);
        const [postCount, searchTotals, trafficTotals] = await Promise.all([
          fetchPublishedPostCount(wpApiBaseUrl),
          fetchSiteSearchTotals(website.gscPropertyUrl, OVERVIEW_WINDOW_DAYS),
          fetchSiteTrafficTotals(website.ga4PropertyId, OVERVIEW_WINDOW_DAYS),
        ]);
        return {
          website,
          postCount,
          indexRateEstimate: postCount > 0 ? searchTotals.pagesWithImpressions / postCount : null,
          totalUsers: trafficTotals.activeUsers,
          error: null,
        };
      } catch (err) {
        return {
          website,
          postCount: null,
          indexRateEstimate: null,
          totalUsers: null,
          error: err instanceof Error ? err.message : "Lỗi không rõ khi lấy dữ liệu.",
        };
      }
    })
  );
}

export interface WebsiteDetail {
  website: NonNullable<Awaited<ReturnType<typeof prisma.website.findUnique>>>;
  postCount: number | null;
  postCountError: string | null;
  search: Awaited<ReturnType<typeof fetchSiteSearchTotals>> | null;
  topPages: Awaited<ReturnType<typeof fetchTopPages>> | null;
  gscError: string | null;
  traffic: Awaited<ReturnType<typeof fetchSiteTrafficTotals>> | null;
  trafficBySource: Awaited<ReturnType<typeof fetchTrafficBySource>> | null;
  ga4Error: string | null;
}

/** Each of WordPress / GSC / GA4 fails independently (wrong property ID,
 * service account not yet added as viewer on just one of them, site down)
 * — isolated per source so one broken connection doesn't blank the whole
 * page; each section reports its own error instead. */
export async function getWebsiteDetail(websiteId: string, days = OVERVIEW_WINDOW_DAYS): Promise<WebsiteDetail | null> {
  const website = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!website) return null;

  const wpApiBaseUrl = website.wpApiBaseUrl ?? deriveWpApiBaseUrl(website.url);
  const [postCountResult, gscResult, ga4Result] = await Promise.all([
    fetchPublishedPostCount(wpApiBaseUrl).then(
      (v) => ({ ok: true as const, value: v }),
      (err) => ({ ok: false as const, error: err instanceof Error ? err.message : "Lỗi không rõ." })
    ),
    Promise.all([fetchSiteSearchTotals(website.gscPropertyUrl, days), fetchTopPages(website.gscPropertyUrl, days)]).then(
      ([search, topPages]) => ({ ok: true as const, value: { search, topPages } }),
      (err) => ({ ok: false as const, error: err instanceof Error ? err.message : "Lỗi không rõ." })
    ),
    Promise.all([fetchSiteTrafficTotals(website.ga4PropertyId, days), fetchTrafficBySource(website.ga4PropertyId, days)]).then(
      ([traffic, trafficBySource]) => ({ ok: true as const, value: { traffic, trafficBySource } }),
      (err) => ({ ok: false as const, error: err instanceof Error ? err.message : "Lỗi không rõ." })
    ),
  ]);

  return {
    website,
    postCount: postCountResult.ok ? postCountResult.value : null,
    postCountError: postCountResult.ok ? null : postCountResult.error,
    search: gscResult.ok ? gscResult.value.search : null,
    topPages: gscResult.ok ? gscResult.value.topPages : null,
    gscError: gscResult.ok ? null : gscResult.error,
    traffic: ga4Result.ok ? ga4Result.value.traffic : null,
    trafficBySource: ga4Result.ok ? ga4Result.value.trafficBySource : null,
    ga4Error: ga4Result.ok ? null : ga4Result.error,
  };
}
