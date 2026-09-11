import { fetchWithCurlFallback } from "@/lib/net/curl-fetch";

export interface SitemapCount {
  /** Every URL the site submits for indexing. */
  total: number;
  /** URLs that are generated content rather than structure — the pages this
   * pipeline exists to produce. Structure means the home page, section
   * indexes, and state hubs. */
  content: number;
  /** Where the numbers came from, so a surprising figure can be traced without
   * re-deriving it by hand. */
  breakdown: { label: string; count: number }[];
  /** Sitemaps actually read, including nested ones. */
  sourcesRead: string[];
  /**
   * Every URL, not just the count.
   *
   * Exposed 2026-09-11 for the article QC checklist, which validates internal
   * links against the pages the site ACTUALLY serves. The function already
   * collected these in order to count them; returning them avoids a second
   * sitemap fetcher, and a second fetcher is a second definition of "what this
   * site publishes" that drifts from the first.
   */
  urls: string[];
}

/** A sitemap index may point at more sitemaps. Bounded so a misconfigured or
 * self-referencing index cannot spin. */
const MAX_NESTED_SITEMAPS = 50;

/**
 * Counts what a site actually publishes, from its sitemap.
 *
 * Replaces WordPress's `X-WP-Total` as the denominator of the index-rate
 * estimate, and the reason is not that one number was slightly better than the
 * other — the two were counting different universes.
 *
 * The numerator is "pages with impressions on the GSC property": every URL
 * Google reports, including the home page, section indexes and state hubs. The
 * denominator was the count of WordPress POSTS, which on a headless site is the
 * blog and nothing else. Divide the first by the second and the result is not a
 * rate of anything; on this site it would have exceeded 100% while looking like
 * an ordinary percentage, and nothing in the UI could have shown that.
 *
 * The sitemap is the right denominator because it is definitionally the set we
 * asked Google to index — the same universe the numerator is drawn from.
 *
 * `content` is reported alongside `total` rather than instead of it. They
 * answer different questions: total is "how much of what we submitted is
 * getting seen", content is "how many pages did this pipeline actually build".
 * Collapsing them would repeat the mistake this function exists to fix.
 */
export async function fetchSitemapCounts(siteUrl: string): Promise<SitemapCount> {
  const root = `${siteUrl.replace(/\/+$/, "")}/sitemap.xml`;
  const urls: string[] = [];
  const sourcesRead: string[] = [];

  const queue = [root];
  const seenSitemaps = new Set<string>();
  while (queue.length > 0 && sourcesRead.length < MAX_NESTED_SITEMAPS) {
    const target = queue.shift()!;
    if (seenSitemaps.has(target)) continue; // a self-referencing index is a real thing
    seenSitemaps.add(target);

    const { status, body } = await fetchWithCurlFallback(target);
    if (status !== 200) {
      throw new Error(
        `Sitemap ${target} trả HTTP ${status}. Không đếm được số trang, nên tỷ lệ index sẽ không hiển thị — thà bỏ trống còn hơn chia cho một con số đoán.`
      );
    }
    sourcesRead.push(target);
    const xml = body.toString("utf-8");

    const { isIndex, locs } = parseSitemapXml(xml);
    if (isIndex) queue.push(...locs);
    else urls.push(...locs);
  }

  if (urls.length === 0) {
    throw new Error(`Sitemap ${root} không chứa URL nào (đã đọc ${sourcesRead.length} file).`);
  }

  return { urls, total: urls.length, sourcesRead, ...categoriseSitemapUrls(urls, siteUrl) };
}

/**
 * A <sitemapindex> lists sitemaps; a <urlset> lists pages. Both use <loc>, so
 * the CONTAINER tag is the only thing that tells them apart — reading <loc>
 * without checking would count sitemap files as if they were pages, and a site
 * with 12 nested sitemaps would report 12 pages.
 */
export function parseSitemapXml(xml: string): { isIndex: boolean; locs: string[] } {
  return {
    isIndex: /<sitemapindex[\s>]/i.test(xml),
    locs: [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]),
  };
}

/**
 * Splits sitemap URLs into content and structure by path DEPTH, not by matching
 * known section names.
 *
 * Depth is a property of how these sites are laid out — `/vertical/state/slug`
 * is a generated page, `/vertical/state` is a hub over them, `/vertical` is an
 * index, `/` is the home page. A list of section names would need editing every
 * time a vertical is added, and would silently miscount until someone noticed.
 *
 * Verified against the live sitemap on 2026-09-08: 158 content pages, which is
 * exactly what the site independently reports as publishedPages, plus 24 state
 * hubs and 4 root-level pages for 186 total.
 */
/**
 * Phân loại TỪNG URL, không chỉ đếm.
 *
 * Cùng một quy tắc với categoriseSitemapUrls bên dưới — số tầng đường dẫn —
 * nên hai bên không thể lệch nhau. Tách ra vì màn hình cần biết từng trang
 * thuộc loại gì, còn ô thống kê chỉ cần con số.
 */
export type PageKind = "home" | "section" | "hub" | "content";

export function classifySitemapUrl(url: string, siteUrl: string): { path: string; kind: PageKind } {
  const origin = siteUrl.replace(/\/+$/, "");
  const path = url.replace(origin, "").split(/[?#]/)[0];
  const segments = path.split("/").filter(Boolean);
  const kind: PageKind = segments.length === 0 ? "home" : segments.length === 1 ? "section" : segments.length === 2 ? "hub" : "content";
  return { path: path || "/", kind };
}

export function categoriseSitemapUrls(urls: string[], siteUrl: string): { content: number; breakdown: { label: string; count: number }[] } {
  const origin = siteUrl.replace(/\/+$/, "");
  let home = 0;
  let section = 0;
  let hub = 0;
  let content = 0;

  for (const url of urls) {
    const path = url.replace(origin, "").split(/[?#]/)[0];
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) home++;
    else if (segments.length === 1) section++;
    else if (segments.length === 2) hub++;
    else content++;
  }

  return {
    content,
    breakdown: [
      { label: "Trang nội dung", count: content },
      { label: "Hub khu vực", count: hub },
      { label: "Trang mục", count: section },
      { label: "Trang chủ", count: home },
    ].filter((row) => row.count > 0),
  };
}
