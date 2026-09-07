import { getGoogleAccessToken } from "./service-account";

const GA4_DATA_API_BASE = "https://analyticsdata.googleapis.com/v1beta";
const GA4_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export interface SiteTrafficTotals {
  activeUsers: number;
  sessions: number;
  screenPageViews: number;
}

export interface TrafficBreakdownRow {
  dimensionValue: string;
  sessions: number;
  activeUsers: number;
}

/** Site-wide traffic totals for the Overview dashboard's "total traffic"
 * column — GA4 Data API v1beta runReport, request/response shape verified
 * against Google's current docs (2026-09-06), no live property to test
 * against yet (see saveServiceAccountKey — no real site is connected). */
export async function fetchSiteTrafficTotals(ga4PropertyId: string, days: number): Promise<SiteTrafficTotals> {
  const rows = await runReport(ga4PropertyId, {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }],
  });
  const row = rows[0];
  return {
    activeUsers: row ? Number(row.metricValues[0]?.value ?? 0) : 0,
    sessions: row ? Number(row.metricValues[1]?.value ?? 0) : 0,
    screenPageViews: row ? Number(row.metricValues[2]?.value ?? 0) : 0,
  };
}

/** Per-source breakdown (e.g. "organic search", "direct") for the website
 * detail view. */
export async function fetchTrafficBySource(ga4PropertyId: string, days: number): Promise<TrafficBreakdownRow[]> {
  const rows = await runReport(ga4PropertyId, {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "activeUsers" }],
  });
  return rows
    .map((r) => ({
      dimensionValue: r.dimensionValues[0]?.value ?? "(not set)",
      sessions: Number(r.metricValues[0]?.value ?? 0),
      activeUsers: Number(r.metricValues[1]?.value ?? 0),
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

interface RawGa4Row {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

async function runReport(
  ga4PropertyId: string,
  body: { dateRanges: { startDate: string; endDate: string }[]; metrics: { name: string }[]; dimensions?: { name: string }[] }
): Promise<RawGa4Row[]> {
  const accessToken = await getGoogleAccessToken([GA4_READONLY_SCOPE]);
  const response = await fetch(`${GA4_DATA_API_BASE}/properties/${ga4PropertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`GA4 runReport thất bại cho property ${ga4PropertyId}: HTTP ${response.status}.`);
  }
  const parsed: unknown = await response.json();
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Phản hồi GA4 runReport không đúng cấu trúc mong đợi (schema drift).");
  }
  const rows = (parsed as Record<string, unknown>).rows;
  if (rows === undefined) return []; // no data for the range — valid "nothing yet"
  if (!Array.isArray(rows)) {
    throw new Error("Phản hồi GA4 runReport có trường 'rows' nhưng không phải mảng (schema drift).");
  }
  return rows as RawGa4Row[];
}
