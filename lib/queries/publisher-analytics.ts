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
import { checkHostLeak, getLastHostLeakCheck, type HostLeakResult, type LastCheck } from "@/lib/publisher/host-leak";
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
  // Chưa nối Search Console thì KHÔNG có gì để đọc. Trả null, và bảng điều
  // khiển hiện "chưa có dữ liệu".
  //
  // GIỚI HẠN ĐÃ BIẾT, ghi ra chứ không giấu: null ở đây trùng với null của
  // "không tìm thấy website", nên hai trạng thái khác nhau đang nói cùng một
  // câu. Tách chúng là việc tiếp theo, và nó thuộc về tầng trình bày chứ
  // không thuộc chỗ này.
  const gscProperty = website.gscPropertyUrl;
  if (!gscProperty) return null;

  const [totals, pages, queries] = await Promise.all([
    load("gsc-totals", websiteId, fetchSiteSearchTotals(gscProperty, days)),
    load("gsc-pages", websiteId, fetchTopPages(gscProperty, days)),
    load("gsc-queries", websiteId, fetchTopQueries(gscProperty, days)),
  ]);
  return { website: { ...website, gscPropertyUrl: gscProperty }, days, totals, pages, queries };
}

export interface GaTabData {
  website: { id: string; name: string; url: string; ga4PropertyId: string };
  days: Window;
  totals: Loaded<SiteTrafficTotals>;
  bySource: Loaded<TrafficBreakdownRow[]>;
  landing: Loaded<LandingPageRow[]>;
  /** Hồi quy phép chặn gtag, tính TRỰC TIẾP mỗi lần mở — GA4 tự giữ lịch sử
   *  nên không cần lấy mẫu, chỉ cần hỏi. */
  hostLeak: Loaded<HostLeakResult>;
  /** Lần chạy theo lịch gần nhất. Trả lời "nếu không ai mở màn hình thì có ai
   *  kiểm không". Null = chưa lần nào. */
  lastScheduled: LastCheck | null;
}

export async function getGaTabData(websiteId: string, days: Window): Promise<GaTabData | null> {
  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { id: true, name: true, url: true, ga4PropertyId: true },
  });
  if (!website) return null;
  // Chưa cấu hình GA4 property thì không có gì để đọc — xem ghi chú ở
  // getGscTabData về giới hạn của việc dùng chung null.
  const ga4 = website.ga4PropertyId;
  if (!ga4) return null;
  const site = { ...website, ga4PropertyId: ga4 };

  const [totals, bySource, landing, hostLeak, lastScheduled] = await Promise.all([
    load("ga4-totals", websiteId, fetchSiteTrafficTotals(ga4, days)),
    load("ga4-source", websiteId, fetchTrafficBySource(ga4, days)),
    load("ga4-landing", websiteId, fetchLandingPages(ga4, days)),
    // KHÔNG theo `days` của bộ chọn khoảng: câu hỏi "còn đường bắn nào không"
    // không phải câu hỏi về khoảng đang xem. Người chọn 7 ngày để đọc lưu
    // lượng không có ý nói "chỉ quan tâm rò rỉ trong 7 ngày".
    load("ga4-host-leak", websiteId, checkHostLeak(site, 28)),
    getLastHostLeakCheck(websiteId),
  ]);
  return { website: site, days, totals, bySource, landing, hostLeak, lastScheduled };
}
