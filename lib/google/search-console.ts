import { getGoogleAccessToken } from "./service-account";

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
    throw new Error(`GSC searchAnalytics.query thất bại cho ${propertyUrl}: HTTP ${response.status}.`);
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
