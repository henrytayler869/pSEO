import { prisma } from "@/lib/db/prisma";
import { fetchPublishedPostCount, deriveWpApiBaseUrl, deriveWpAdminUrl, type WpAdminLink } from "@/lib/wordpress/rest-api";
import { fetchSitemapCounts, type SitemapCount } from "@/lib/sitemap/count";
import { normalizeHost } from "@/lib/publisher/link-domain";
import { checkRequiredPages, type RequiredPageStatus } from "@/lib/publisher/required-pages";
import { buildContentRules } from "@/lib/content-rules/registry";
import { fetchSiteSearchTotals, fetchTopPages, listSitemaps, type SubmittedSitemap } from "@/lib/google/search-console";
import { fetchSiteTrafficTotals, fetchTrafficBySource } from "@/lib/google/analytics-data";

const OVERVIEW_WINDOW_DAYS = 28;

export interface WebsiteOverviewRow {
  website: Awaited<ReturnType<typeof prisma.website.findMany>>[number];
  /** URLs the site submits for indexing, read from its sitemap. */
  sitemapCount: SitemapCount | null;
  /** Where WordPress's admin actually lives — derived from the REST base, not
   * from the public origin, which on a headless site has no /wp-admin. */
  wpAdmin: WpAdminLink;
  /**
   * pagesWithImpressions / sitemap total.
   *
   * Both halves now describe the same universe. They did not before: the
   * numerator counts every URL GSC reports for the property, while the
   * denominator was the WordPress POST count — the blog, and on a headless
   * site nothing else. The quotient of those two was not a rate of anything,
   * and it would have rendered as an ordinary percentage.
   */
  indexRateEstimate: number | null;
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
        const wpAdmin = deriveWpAdminUrl(website.wpApiBaseUrl, website.url);
      const [sitemapCount, searchTotals, trafficTotals] = await Promise.all([
          fetchSitemapCounts(website.url),
          fetchSiteSearchTotals(website.gscPropertyUrl, OVERVIEW_WINDOW_DAYS),
          fetchSiteTrafficTotals(website.ga4PropertyId, OVERVIEW_WINDOW_DAYS),
        ]);
        return {
          website,
          wpAdmin,
          sitemapCount,
          indexRateEstimate:
            sitemapCount.total > 0 ? searchTotals.pagesWithImpressions / sitemapCount.total : null,
          totalUsers: trafficTotals.activeUsers,
          error: null,
        };
      } catch (err) {
        return {
          website,
          wpAdmin: deriveWpAdminUrl(website.wpApiBaseUrl, website.url),
          sitemapCount: null,
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
  /**
   * The registered domain behind this website, if it is registered here.
   *
   * Shown because the two failures look identical from Publisher: a site whose
   * numbers are zero because nobody has visited, and a site whose numbers are
   * zero because DNS never pointed anywhere. The second is answered on the
   * Domain screen, and until now nothing on this page said to go look.
   */
  domain: { id: string; name: string; cloudflareStatus: string | null; cloudflareError: string | null } | null;
  wpAdmin: WpAdminLink;
  /** Trust pages every publisher must serve, checked live. */
  requiredPages: RequiredPageStatus[] | null;
  requiredPagesError: string | null;
  /** What Search Console holds, which is not the same as what the site
   * publishes: an empty list means nobody ever submitted the sitemap. */
  sitemaps: SubmittedSitemap[] | null;
  sitemapsError: string | null;
  /** From the sitemap — everything published. */
  sitemapCount: SitemapCount | null;
  sitemapError: string | null;
  /** From WordPress — blog posts only. Kept because it is still a real number
   * about a real thing; it just is not the site's page count, and labelling it
   * as such is what went wrong. */
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

  const host = normalizeHost(website.url);
  const domains = await prisma.domain.findMany({
    select: { id: true, name: true, cloudflareStatus: true, cloudflareError: true },
  });
  const domain = domains.find((d) => normalizeHost(d.name) === host) ?? null;

  const wpApiBaseUrl = website.wpApiBaseUrl ?? deriveWpApiBaseUrl(website.url);
  const [requiredPagesResult, sitemapsResult, sitemapResult, postCountResult, gscResult, ga4Result] = await Promise.all([
    buildContentRules()
      .then((rules) => checkRequiredPages(website.url, rules.requiredPages))
      .then(
        (v) => ({ ok: true as const, value: v }),
        (err) => ({ ok: false as const, error: err instanceof Error ? err.message : "Lỗi không rõ." })
      ),
    listSitemaps(website.gscPropertyUrl).then(
      (v) => ({ ok: true as const, value: v }),
      (err) => ({ ok: false as const, error: err instanceof Error ? err.message : "Lỗi không rõ." })
    ),
    fetchSitemapCounts(website.url).then(
      (v) => ({ ok: true as const, value: v }),
      (err) => ({ ok: false as const, error: err instanceof Error ? err.message : "Lỗi không rõ." })
    ),
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
    domain,
    wpAdmin: deriveWpAdminUrl(website.wpApiBaseUrl, website.url),
    requiredPages: requiredPagesResult.ok ? requiredPagesResult.value : null,
    requiredPagesError: requiredPagesResult.ok ? null : requiredPagesResult.error,
    sitemaps: sitemapsResult.ok ? sitemapsResult.value : null,
    sitemapsError: sitemapsResult.ok ? null : sitemapsResult.error,
    sitemapCount: sitemapResult.ok ? sitemapResult.value : null,
    sitemapError: sitemapResult.ok ? null : sitemapResult.error,
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
