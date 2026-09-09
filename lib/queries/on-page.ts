import { prisma } from "@/lib/db/prisma";
import { getCredential } from "@/lib/settings/credentials";
import { fetchOnPageSummary, ON_PAGE_COST_PER_PAGE_USD, type OnPageSummary } from "@/lib/dataforseo/on-page";
import { fetchSitemapCounts } from "@/lib/sitemap/count";

export interface OnPageView {
  website: NonNullable<Awaited<ReturnType<typeof prisma.website.findUnique>>>;
  summary: OnPageSummary | null;
  error: string | null;
  /** How many pages a crawl would cover, taken from the sitemap rather than
   * guessed. A crawl limit pulled out of the air is how a site with a faceted
   * search runs to tens of thousands of pages. */
  sitemapTotal: number;
  estimatedCostUsd: number;
}

const FALLBACK_MAX_PAGES = 200;

export async function getOnPageView(websiteId: string): Promise<OnPageView | null> {
  const website = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!website) return null;

  // The sitemap is the honest bound: it is what the site itself says it
  // publishes. Falls back to a fixed cap when it cannot be read, because a
  // crawl with no limit is the one mistake here that costs real money.
  let sitemapTotal = FALLBACK_MAX_PAGES;
  try {
    sitemapTotal = (await fetchSitemapCounts(website.url)).total;
  } catch {
    // Left at the fallback. Not reported as an error on this screen: the
    // sitemap's own errors belong on the overview, and repeating them here
    // would make a crawl look blocked when it is not.
  }

  const [login, password] = await Promise.all([
    getCredential("DATAFORSEO_LOGIN"),
    getCredential("DATAFORSEO_PASSWORD"),
  ]);

  const base = {
    website,
    sitemapTotal,
    estimatedCostUsd: sitemapTotal * ON_PAGE_COST_PER_PAGE_USD,
  };

  if (!login || !password) {
    return {
      ...base,
      summary: null,
      error: "Chưa cấu hình DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD ở trang Cài đặt — không quét OnPage được.",
    };
  }
  if (!website.onPageTaskId) {
    // Not an error: a site nobody has crawled yet is the normal starting
    // state, and reporting it in red would make it look broken.
    return { ...base, summary: null, error: null };
  }

  try {
    return { ...base, summary: await fetchOnPageSummary(login, password, website.onPageTaskId), error: null };
  } catch (err) {
    return {
      ...base,
      summary: null,
      error: err instanceof Error ? err.message : "Không đọc được kết quả OnPage.",
    };
  }
}
