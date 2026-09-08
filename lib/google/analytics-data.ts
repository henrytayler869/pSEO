/**
 * The two GA4 identifiers, and why each is validated against the other's shape.
 *
 * A GA4 property has two IDs that arrive from the same screens, look equally
 * official, and do opposite jobs:
 *
 *   ga4PropertyId    553102895        numeric — READS reports (Data API)
 *   measurementId    G-1TL8MDDEJH     "G-" —   WRITES events (gtag on the site)
 *
 * Neither can be derived from the other, and swapping them fails quietly in
 * both directions. A "G-" string sent to the Data API is rejected with an error
 * nobody sees until a dashboard stays empty. A numeric ID placed in a gtag call
 * is worse: the script loads, the page renders normally, no console error
 * appears, and the events go nowhere — indistinguishable from a site with no
 * visitors, for as long as anyone is willing to believe that.
 *
 * So each is checked for the other's shape specifically, and told which field
 * it probably belongs in. A validator that only says "invalid" leaves the
 * person staring at a value that is perfectly valid — somewhere else.
 */
export function assertValidGa4MeasurementId(value: string): void {
  const v = value.trim();
  if (/^G-[A-Z0-9]{6,}$/i.test(v)) return;
  if (/^\d+$/.test(v)) {
    throw new Error(
      `"${v}" là GA4 property ID (dãy số), không phải Measurement ID. Measurement ID có dạng G-XXXXXXXXXX và nằm ở Admin > Data streams. Có thể bạn đã dán nhầm sang ô này — dãy số thuộc về ô "GA4 property ID".`
    );
  }
  throw new Error(
    `Measurement ID "${v}" sai định dạng. Phải có dạng G-XXXXXXXXXX (chữ G, gạch ngang, rồi chữ và số), lấy ở Admin > Data streams của property GA4.`
  );
}

/**
 * The numeric property ID, guarded against the same confusion from the other
 * side. See assertValidGa4MeasurementId for why both directions matter.
 */
export function assertValidGa4PropertyId(value: string): void {
  const v = value.trim();
  if (/^\d+$/.test(v)) return;
  if (/^G-/i.test(v)) {
    throw new Error(
      `"${v}" là Measurement ID, không phải property ID. GA4 Data API dùng property ID dạng dãy số (VD 553102895), lấy ở Admin > Property settings. Có thể bạn đã dán nhầm sang ô này.`
    );
  }
  if (/^properties\/\d+$/.test(v)) {
    throw new Error(`"${v}" thừa tiền tố "properties/". Chỉ nhập phần số: ${v.slice("properties/".length)}.`);
  }
  throw new Error(`GA4 property ID "${v}" phải là một dãy số (VD 553102895), lấy ở Admin > Property settings.`);
}

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
