import { getGoogleAccessToken, explainGoogleApiError } from "./service-account";

const SEARCH_ANALYTICS_BASE = "https://www.googleapis.com/webmasters/v3";
const GSC_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export interface SiteSearchTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
  pagesWithImpressions: number;
}

export interface PageSearchRow {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * Site-wide Search Analytics totals for the Overview dashboard — no page
 * filter and no "dimensions" array, which makes GSC return one aggregate
 * row for the whole property.
 *
 * "pagesWithImpressions" (dimensions: ["page"], counting rows with
 * impressions > 0) is used as an honest PROXY for index rate: the real GSC
 * Index Coverage report isn't exposed by any public API — only per-URL
 * Inspection is (one URL at a time, 2,000/day quota per property), which
 * doesn't scale to a bulk Overview refresh across many sites. A page
 * getting impressions is strong evidence it's indexed; a page with zero
 * impressions could still be indexed but not ranking for anything, so this
 * UNDERCOUNTS true index rate — labeled as an estimate in the UI, never
 * presented as the real GSC verdict. Use fetchUrlIndexStatus() below for a
 * real per-URL check when the estimate isn't enough.
 */
export async function fetchSiteSearchTotals(propertyUrl: string, days: number): Promise<SiteSearchTotals> {
  const accessToken = await getGoogleAccessToken([GSC_READONLY_SCOPE]);
  const { startDate, endDate } = dateRange(days);

  const [totalsResponse, pagesResponse] = await Promise.all([
    querySearchAnalytics(propertyUrl, accessToken, { startDate, endDate, rowLimit: 1 }),
    querySearchAnalytics(propertyUrl, accessToken, { startDate, endDate, dimensions: ["page"], rowLimit: 25000 }),
  ]);

  const totalsRow = totalsResponse[0];
  const pagesWithImpressions = pagesResponse.filter((r) => r.impressions > 0).length;

  return {
    clicks: totalsRow?.clicks ?? 0,
    impressions: totalsRow?.impressions ?? 0,
    ctr: totalsRow?.ctr ?? 0,
    avgPosition: totalsRow?.position ?? 0,
    pagesWithImpressions,
  };
}

/** Per-page breakdown for the website detail view. */
export async function fetchTopPages(propertyUrl: string, days: number, limit = 50): Promise<PageSearchRow[]> {
  const accessToken = await getGoogleAccessToken([GSC_READONLY_SCOPE]);
  const { startDate, endDate } = dateRange(days);
  const rows = await querySearchAnalytics(propertyUrl, accessToken, { startDate, endDate, dimensions: ["page"], rowLimit: limit });
  return rows
    .map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
    .sort((a, b) => b.clicks - a.clicks);
}

/** Real per-URL index verdict (URL Inspection API) — the ground truth
 * fetchSiteSearchTotals()'s pagesWithImpressions can only approximate.
 * Quota-limited by Google (2,000/day, 600/min per property) so this is
 * exposed as a single-URL, on-demand check, not a bulk sweep. */
export async function fetchUrlIndexStatus(propertyUrl: string, inspectionUrl: string): Promise<boolean> {
  const accessToken = await getGoogleAccessToken(["https://www.googleapis.com/auth/webmasters.readonly"]);
  const response = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inspectionUrl, siteUrl: propertyUrl }),
  });
  if (!response.ok) {
    throw new Error(`GSC urlInspection thất bại cho ${inspectionUrl}: HTTP ${response.status}.`);
  }
  const body = (await response.json()) as { inspectionResult?: { indexStatusResult?: { verdict?: string } } };
  const verdict = body.inspectionResult?.indexStatusResult?.verdict;
  if (verdict === undefined) {
    throw new Error(`Phản hồi GSC urlInspection cho ${inspectionUrl} thiếu indexStatusResult.verdict (schema drift).`);
  }
  return verdict === "PASS";
}

interface RawSearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * A Search Console property is addressed by a STRING, and the string is not a
 * URL for half of all properties.
 *
 * Two kinds exist and they are not interchangeable:
 *
 *   Domain property      sc-domain:atmovingservices.com
 *   URL-prefix property  https://atmovingservices.com/
 *
 * The API matches the value EXACTLY against how the property was registered.
 * Passing the URL form for a Domain property does not fall back or redirect —
 * it returns 403, the same status a genuine permissions problem returns, and
 * the two are indistinguishable from the response alone.
 *
 * That collision is why this is validated up front rather than left to fail at
 * query time. Verifying through a DNS provider (Cloudflare's one-click flow,
 * which is the easier and better path) always produces a DOMAIN property, so
 * the person most likely to hit this is the person who did the setup correctly.
 *
 * Deliberately does NOT normalise a bare "example.com" into either form.
 * Guessing would pick one of two real properties that may both exist with
 * different data, and a wrong guess here surfaces as an empty dashboard rather
 * than an error — the worst available outcome. Ask instead.
 */
export function assertValidGscProperty(propertyUrl: string): void {
  const value = propertyUrl.trim();
  if (value.startsWith("sc-domain:")) {
    const host = value.slice("sc-domain:".length);
    if (host.length > 0 && !host.includes("/") && host.includes(".")) return;
    throw new Error(
      `GSC property "${value}" sai định dạng. Dạng Domain phải là sc-domain:<tên miền>, ví dụ sc-domain:atmovingservices.com — không kèm https:// và không có dấu / nào.`
    );
  }
  if (value.startsWith("http://") || value.startsWith("https://")) return;
  throw new Error(
    `GSC property "${value}" không hợp lệ. Search Console có HAI dạng và API phân biệt chúng:\n` +
      `  • Domain (xác minh bằng DNS, kể cả qua Cloudflare):  sc-domain:atmovingservices.com\n` +
      `  • URL-prefix (xác minh bằng file/thẻ HTML):          https://atmovingservices.com/\n` +
      `Dùng đúng dạng mà property đã được tạo. Dán nhầm dạng sẽ nhận HTTP 403 giống hệt lỗi thiếu quyền.`
  );
}

async function querySearchAnalytics(
  propertyUrl: string,
  accessToken: string,
  params: { startDate: string; endDate: string; dimensions?: string[]; rowLimit: number }
): Promise<RawSearchAnalyticsRow[]> {
  const response = await fetch(`${SEARCH_ANALYTICS_BASE}/sites/${encodeURIComponent(propertyUrl)}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    // CORRECTED. This used to name exactly two causes for a 403 — missing
    // permission, or the wrong property format — and both were wrong the first
    // time it fired. The real cause was a third one it did not mention: the
    // Search Console API was never enabled in the Google Cloud project, so the
    // request never reached Search Console at all.
    //
    // That is the cause that hits every new project FIRST, and the message sent
    // someone to re-check property permissions they had already set correctly.
    // Google's own response says precisely what is wrong, with the console URL
    // to fix it; explainGoogleApiError surfaces that instead of paraphrasing.
    const body = await response.text();
    const explained = explainGoogleApiError(response.status, body);
    const formatHint =
      (response.status === 403 || response.status === 404) && !/has not been used in project|is disabled/i.test(body)
        ? propertyUrl.startsWith("sc-domain:")
          ? ` Nếu quyền đã cấp đúng: property có thể là dạng URL-prefix chứ không phải Domain — khi đó dùng "https://..." thay vì "${propertyUrl}".`
          : ` Nếu quyền đã cấp đúng: property có thể là dạng Domain (xác minh bằng DNS) — khi đó dùng "sc-domain:<tên miền>" thay vì URL.`
        : "";
    throw new Error(`GSC searchAnalytics.query thất bại cho ${propertyUrl}: ${explained}${formatHint}`);
  }
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null) {
    throw new Error("Phản hồi GSC searchAnalytics.query không đúng cấu trúc mong đợi (schema drift).");
  }
  const rows = (body as Record<string, unknown>).rows;
  if (rows === undefined) return []; // no data for the range — a real, valid "nothing yet", not an error
  if (!Array.isArray(rows)) {
    throw new Error("Phản hồi GSC searchAnalytics.query có trường 'rows' nhưng không phải mảng (schema drift).");
  }
  return rows as RawSearchAnalyticsRow[];
}

function dateRange(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

const GSC_FULL_SCOPE = "https://www.googleapis.com/auth/webmasters";

export interface SubmittedSitemap {
  path: string;
  lastSubmitted: string | null;
  isPending: boolean;
  warnings: number;
  errors: number;
  submittedUrls: number | null;
}

/**
 * Sitemaps Search Console currently knows about for a property.
 *
 * Needs the FULL webmasters scope, not the readonly one — Google treats the
 * sitemap list as part of the write surface. Worth knowing before wondering
 * why a readonly token returns 403 on a plain GET.
 */
export async function listSitemaps(propertyUrl: string): Promise<SubmittedSitemap[]> {
  assertValidGscProperty(propertyUrl);
  const token = await getGoogleAccessToken([GSC_FULL_SCOPE]);
  const response = await fetch(
    `${SEARCH_ANALYTICS_BASE}/sites/${encodeURIComponent(propertyUrl)}/sitemaps`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) {
    throw new Error(`GSC sitemaps.list thất bại cho ${propertyUrl}: ${explainGoogleApiError(response.status, await response.text())}`);
  }
  const body = (await response.json()) as { sitemap?: unknown };
  // No sitemaps submitted returns {} with no `sitemap` key at all — an empty
  // answer, not a malformed one. Reading that as drift would report a problem
  // for the normal state of a property nobody has submitted to yet.
  if (!Array.isArray(body.sitemap)) return [];
  return (body.sitemap as Record<string, unknown>[]).map((s) => ({
    path: typeof s.path === "string" ? s.path : "(không rõ)",
    lastSubmitted: typeof s.lastSubmitted === "string" ? s.lastSubmitted : null,
    isPending: s.isPending === true,
    warnings: Number(s.warnings ?? 0),
    errors: Number(s.errors ?? 0),
    submittedUrls: Array.isArray(s.contents)
      ? (s.contents as Record<string, unknown>[]).reduce((sum, c) => sum + Number(c.submitted ?? 0), 0)
      : null,
  }));
}

/**
 * Submits a sitemap to Search Console.
 *
 * Idempotent from Google's side: submitting a sitemap that is already there
 * updates it rather than duplicating, so a second click is harmless.
 *
 * Returns nothing useful on success — Google answers 200 with an empty body —
 * so callers should re-read listSitemaps rather than trust the call's silence.
 * A 200 here means "accepted for processing", not "crawled and valid"; the
 * errors and warnings counts only appear later, which is why the UI shows the
 * list rather than a success message.
 */
export async function submitSitemap(propertyUrl: string, sitemapUrl: string): Promise<void> {
  assertValidGscProperty(propertyUrl);
  const token = await getGoogleAccessToken([GSC_FULL_SCOPE]);
  const response = await fetch(
    `${SEARCH_ANALYTICS_BASE}/sites/${encodeURIComponent(propertyUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
    { method: "PUT", headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) {
    throw new Error(`GSC sitemaps.submit thất bại cho ${sitemapUrl}: ${explainGoogleApiError(response.status, await response.text())}`);
  }
}
