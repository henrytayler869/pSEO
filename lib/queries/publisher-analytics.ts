import { prisma } from "@/lib/db/prisma";
import {
  fetchSiteSearchTotals,
  fetchTopPages,
  fetchTopQueries,
  type SiteSearchTotals,
  type PageSearchRow,
  type QuerySearchRow,
} from "@/lib/google/search-console";
import {
  fetchSiteTrafficTotals,
  fetchTrafficBySource,
  fetchLandingPages,
  type SiteTrafficTotals,
  type TrafficBreakdownRow,
  type LandingPageRow,
} from "@/lib/google/analytics-data";
import { logDependencyFailure } from "@/lib/observability/dependency-log";

/**
 * Dữ liệu cho hai tab GSC và GA4.
 *
 * Mỗi nguồn hỏng RIÊNG, không kéo cả trang xuống. Service account chưa được
 * thêm vào một property là trạng thái bình thường khi mới dựng site, và một
 * trang trắng vì thế sẽ khiến người ta đi tìm lỗi ở chỗ không có lỗi.
 *
 * KHOẢNG THỜI GIAN LÀ THAM SỐ, không phải hằng số trong file này. Số của 7
 * ngày và số của 90 ngày trả lời hai câu khác nhau, và một trang chỉ có một
 * khoảng cố định sẽ bị đọc như thể nó là toàn bộ sự thật.
 */

export const WINDOWS = [7, 28, 90] as const;
export type Window = (typeof WINDOWS)[number];

export function parseWindow(raw: string | undefined): Window {
  const n = Number(raw);
  return (WINDOWS as readonly number[]).includes(n) ? (n as Window) : 28;
}

type Loaded<T> = { ok: true; value: T } | { ok: false; error: string };

async function load<T>(what: string, websiteId: string, p: Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    logDependencyFailure(what, err, { websiteId });
    return { ok: false, error: err instanceof Error ? err.message : "Lỗi không rõ." };
  }
}

export interface GscTabData {
  website: { id: string; name: string; url: string; gscPropertyUrl: string };
  days: Window;
  totals: Loaded<SiteSearchTotals>;
  pages: Loaded<PageSearchRow[]>;
  queries: Loaded<QuerySearchRow[]>;
}

export async function getGscTabData(websiteId: string, days: Window): Promise<GscTabData | null> {
  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { id: true, name: true, url: true, gscPropertyUrl: true },
  });
  if (!website) return null;

  const [totals, pages, queries] = await Promise.all([
    load("gsc-totals", websiteId, fetchSiteSearchTotals(website.gscPropertyUrl, days)),
    load("gsc-pages", websiteId, fetchTopPages(website.gscPropertyUrl, days)),
    load("gsc-queries", websiteId, fetchTopQueries(website.gscPropertyUrl, days)),
  ]);
  return { website, days, totals, pages, queries };
}

export interface GaTabData {
  website: { id: string; name: string; url: string; ga4PropertyId: string };
  days: Window;
  totals: Loaded<SiteTrafficTotals>;
  bySource: Loaded<TrafficBreakdownRow[]>;
  landing: Loaded<LandingPageRow[]>;
}

export async function getGaTabData(websiteId: string, days: Window): Promise<GaTabData | null> {
  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { id: true, name: true, url: true, ga4PropertyId: true },
  });
  if (!website) return null;

  const [totals, bySource, landing] = await Promise.all([
    load("ga4-totals", websiteId, fetchSiteTrafficTotals(website.ga4PropertyId, days)),
    load("ga4-source", websiteId, fetchTrafficBySource(website.ga4PropertyId, days)),
    load("ga4-landing", websiteId, fetchLandingPages(website.ga4PropertyId, days)),
  ]);
  return { website, days, totals, bySource, landing };
}
