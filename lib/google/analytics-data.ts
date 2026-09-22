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

import { getGoogleAccessToken, explainGoogleApiError } from "./service-account";
import { requireProperty } from "./property";

const GA4_DATA_API_BASE = "https://analyticsdata.googleapis.com/v1beta";
const GA4_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

/**
 * Viewport 800×600 — mặc định của Chrome chạy headless, và là dấu vết duy nhất
 * ở đây đủ sạch để lọc bằng.
 *
 * Đo trên hai property thật ngày 19/9/2026: 800×600 chiếm 22/51 phiên của
 * atmovingservices.com và 12/22 của theaccidentrecord.com, và CẢ 34 phiên đó
 * đều có engagedSessions = 0. Loại chúng không làm mất một phiên có tương tác
 * nào — bộ lọc cắt nhiễu mà không cắt người.
 *
 * MỘT giá trị, không phải một danh sách. Năm độ phân giải khả nghi khác
 * (1024×768, 1600×1200, 1080×600, 1920×1049, 1280×1200) mỗi cái chỉ 1–3 phiên,
 * và vài cái trong đó là màn hình thật của máy cũ. Thêm chúng vào cắt thêm
 * được 7 phiên, nhưng đổi bản chất bộ lọc từ "một dấu vết kỹ thuật cụ thể"
 * thành "một danh sách phỏng đoán" — và danh sách phỏng đoán thì không ai biết
 * lúc nào nó bắt đầu cắt nhầm.
 *
 * KHÔNG phải bộ lọc bot đầy đủ, và không được trình bày như thế. Sau khi lọc,
 * atmovingservices.com còn 29 phiên mà chỉ 8 có tương tác: 21 phiên còn lại là
 * client tự động đặt viewport trông như thật, và không còn dấu hiệu nào để bắt
 * chúng. Đó là lý do engagedSessions là chỉ số chính, còn bộ lọc này chỉ là
 * lớp thứ hai.
 */
const HEADLESS_VIEWPORT = "800x600";

/**
 * Loại phiên có viewport headless, ở tầng TRUY VẤN.
 *
 * Không đặt được ở tầng property: GA4 Admin > Data Filters chỉ làm được
 * Internal Traffic (theo IP) và Developer Traffic, không có filter theo
 * viewport hay hành vi. Đặt ở đây lại có một ưu điểm mà tầng property không
 * có: dữ liệu gốc trong GA4 không bị đụng tới, nên tắt bộ lọc là số cũ quay
 * lại nguyên vẹn — kể cả cho dữ liệu đã thu trong quá khứ.
 */
const EXCLUDE_HEADLESS = {
  notExpression: {
    filter: { fieldName: "screenResolution", stringFilter: { value: HEADLESS_VIEWPORT } },
  },
};

export interface SiteTrafficTotals {
  /**
   * Số THÔ của GA4, không lọc gì.
   *
   * Giữ lại chứ không thay thế. Khoảng cách giữa số thô và số có tương tác
   * chính là thông tin: hôm nay nó đo áp lực bot lên site, và khi lưu lượng
   * thật bắt đầu về thì chính khoảng cách đó thu hẹp lại sẽ là tín hiệu sớm
   * nhất. Thay 48 bằng 8 rồi thôi là đổi một con số sai lấy một con số không
   * kiểm chứng được.
   */
  activeUsers: number;
  sessions: number;
  screenPageViews: number;

  /**
   * Phiên CÓ TƯƠNG TÁC (GA4 engagedSessions): trên 10 giây, hoặc từ 2 lượt xem
   * trang, hoặc có conversion. Đây là chỉ số chính, KHÔNG phải activeUsers.
   *
   * Vì sao không phải là một bộ lọc tốt hơn: mọi bộ lọc dựa trên dấu vết kỹ
   * thuật (viewport, user agent, IP) đều mục đi khi client tự động đổi dấu
   * vết, và mục trong im lặng — không ai thấy nó ngừng hoạt động. Còn "có
   * tương tác" là định nghĩa HÀNH VI: một bot muốn qua được nó phải ở lại trang
   * trên 10 giây hoặc xem hai trang, tức là phải trả chi phí thật.
   */
  engagedSessions: number;

  /** Phiên còn lại sau khi loại HEADLESS_VIEWPORT. */
  sessionsExcludingHeadless: number;

  /** Số phiên bộ lọc đã loại. Tính ở đây chứ không để giao diện tự trừ hai số:
   *  một phép trừ nằm trong JSX là một phép trừ không có chỗ để giải thích. */
  headlessSessions: number;
}

export interface TrafficBreakdownRow {
  dimensionValue: string;
  sessions: number;
  activeUsers: number;
  /** Có bao nhiêu phiên trong số đó là thật sự có tương tác. Thiếu cột này,
   *  một dòng "Direct 50" đọc như 50 người quan tâm. */
  engagedSessions: number;
}

/** Site-wide traffic totals for the Overview dashboard's "total traffic"
 * column — GA4 Data API v1beta runReport, request/response shape verified
 * against Google's current docs (2026-09-06), no live property to test
 * against yet (see saveServiceAccountKey — no real site is connected). */
export async function fetchSiteTrafficTotals(ga4Property: string | null, days: number): Promise<SiteTrafficTotals> {
  const ga4PropertyId = requireProperty(ga4Property, "ga4");
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: "today" }];
  const metrics = [
    { name: "activeUsers" },
    { name: "sessions" },
    { name: "screenPageViews" },
    { name: "engagedSessions" },
  ];

  // HAI lần gọi, không phải một lần gọi kèm chiều screenResolution rồi tự cộng.
  //
  // Cách một-lần-gọi trông rẻ hơn và SAI: activeUsers là metric đã khử trùng
  // lặp, một người xuất hiện ở nhiều dòng chiều vẫn là một người, nên cộng các
  // dòng lại là đếm họ nhiều lần. Chỉ bản không có chiều mới cho con số đúng.
  const [raw, filtered] = await Promise.all([
    runReport(ga4PropertyId, { dateRanges, metrics }),
    runReport(ga4PropertyId, { dateRanges, metrics: [{ name: "sessions" }], dimensionFilter: EXCLUDE_HEADLESS }),
  ]);

  const row = raw[0];
  const metric = (i: number) => (row ? Number(row.metricValues[i]?.value ?? 0) : 0);
  const sessions = metric(1);
  const sessionsExcludingHeadless = filtered[0] ? Number(filtered[0].metricValues[0]?.value ?? 0) : 0;

  return {
    activeUsers: metric(0),
    sessions,
    screenPageViews: metric(2),
    engagedSessions: metric(3),
    sessionsExcludingHeadless,
    // Kẹp ở 0. Hai con số đến từ hai lần gọi riêng và không có gì đảm bảo GA4
    // tính chúng trên cùng một ảnh chụp dữ liệu; một hiệu âm hiện lên giao
    // diện dưới dạng "-3 phiên bot" thì vô nghĩa hơn là 0.
    headlessSessions: Math.max(0, sessions - sessionsExcludingHeadless),
  };
}

export interface LandingPageRow {
  path: string;
  sessions: number;
  activeUsers: number;
  /** Giây. GA4 trả averageSessionDuration theo giây, số thực. */
  avgSessionSeconds: number;
  /** Phiên có tương tác vào đúng trang này. Với site pSEO đây là con số nói
   *  mẫu trang nào ĐANG hoạt động: một cửa mở 48 lần mà không ai bước qua
   *  ngưỡng thì cửa đó chưa hoạt động. */
  engagedSessions: number;
}

/**
 * Trang nào là CỬA VÀO, không phải trang nào được xem nhiều.
 *
 * Với site pSEO đây là con số đáng đọc hơn pageviews: mỗi trang thị trường là
 * một cửa riêng cho một truy vấn riêng, nên "cửa nào mở" nói thẳng mẫu nào
 * đang hoạt động. Pageviews trộn cả lượt người đã vào rồi bấm quanh.
 *
 * `landingPagePlusQueryString` chứ không phải `pagePath`: GA4 chỉ có chiều
 * landing page ở dạng kèm query string. Cắt query ở phía này để hai trang chỉ
 * khác tham số UTM không thành hai dòng.
 */
export async function fetchLandingPages(ga4Property: string | null, days: number, limit = 50): Promise<LandingPageRow[]> {
  const ga4PropertyId = requireProperty(ga4Property, "ga4");
  const rows = await runReport(ga4PropertyId, {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "landingPagePlusQueryString" }],
    metrics: [
      { name: "sessions" },
      { name: "activeUsers" },
      { name: "averageSessionDuration" },
      { name: "engagedSessions" },
    ],
    limit,
  });
  const merged = new Map<string, LandingPageRow>();
  for (const r of rows) {
    const raw = r.dimensionValues[0]?.value ?? "";
    const path = raw.split("?")[0] || "/";
    const sessions = Number(r.metricValues[0]?.value ?? 0);
    const activeUsers = Number(r.metricValues[1]?.value ?? 0);
    const avg = Number(r.metricValues[2]?.value ?? 0);
    const engagedSessions = Number(r.metricValues[3]?.value ?? 0);
    const prev = merged.get(path);
    if (prev) {
      // Trung bình có TRỌNG SỐ theo phiên. Cộng rồi chia đôi sẽ cho một trang
      // 1 phiên cùng sức nặng với một trang 900 phiên.
      const total = prev.sessions + sessions;
      merged.set(path, {
        path,
        sessions: total,
        activeUsers: prev.activeUsers + activeUsers,
        avgSessionSeconds: total > 0 ? (prev.avgSessionSeconds * prev.sessions + avg * sessions) / total : 0,
        engagedSessions: prev.engagedSessions + engagedSessions,
      });
    } else {
      merged.set(path, { path, sessions, activeUsers, avgSessionSeconds: avg, engagedSessions });
    }
  }
  return [...merged.values()].sort((a, b) => b.sessions - a.sessions);
}

/** Per-source breakdown (e.g. "organic search", "direct") for the website
 * detail view. */
export async function fetchTrafficBySource(ga4Property: string | null, days: number): Promise<TrafficBreakdownRow[]> {
  const ga4PropertyId = requireProperty(ga4Property, "ga4");
  const rows = await runReport(ga4PropertyId, {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "engagedSessions" }],
  });
  return rows
    .map((r) => ({
      dimensionValue: r.dimensionValues[0]?.value ?? "(not set)",
      sessions: Number(r.metricValues[0]?.value ?? 0),
      activeUsers: Number(r.metricValues[1]?.value ?? 0),
      engagedSessions: Number(r.metricValues[2]?.value ?? 0),
    }))
    .sort((a, b) => b.sessions - a.sessions);
}


export interface HostSessionRow {
  hostName: string;
  /** YYYYMMDD như GA4 trả về. */
  date: string;
  sessions: number;
}

/**
 * Phiên theo TÊN MIỀN và theo NGÀY.
 *
 * KHÔNG lọc headless ở đây, khác mọi hàm còn lại trong file. Câu hỏi là "có
 * lưu lượng nào báo cáo từ một host không phải site không" — và một phiên bot
 * từ localhost vẫn là bằng chứng rằng thẻ đo đang bắn ở chỗ không được phép.
 * Lọc nó đi là bỏ mất đúng thứ cần tìm.
 */
export async function fetchSessionsByHost(ga4Property: string | null, days: number): Promise<HostSessionRow[]> {
  const ga4PropertyId = requireProperty(ga4Property, "ga4");
  assertValidGa4PropertyId(ga4PropertyId);
  const rows = await runReport(ga4PropertyId, {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "hostName" }, { name: "date" }],
    metrics: [{ name: "sessions" }],
    limit: 500,
  });
  return rows.map((r) => ({
    hostName: r.dimensionValues?.[0]?.value ?? "(không rõ)",
    date: r.dimensionValues?.[1]?.value ?? "",
    sessions: Number(r.metricValues?.[0]?.value ?? 0),
  }));
}

interface RawGa4Row {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

async function runReport(
  ga4PropertyId: string,
  body: {
    dateRanges: { startDate: string; endDate: string }[];
    metrics: { name: string }[];
    dimensions?: { name: string }[];
    /** GA4 mặc định trả 10.000 dòng. Đặt khi chỉ cần phần đầu — một bảng
     *  hiển thị 50 dòng không có lý do kéo về mười nghìn. */
    limit?: number;
    /** FilterExpression của GA4 Data API. Để `unknown` thay vì dựng lại cây
     *  kiểu của Google ở đây: cây đó lồng nhau nhiều tầng và chỉ có đúng một
     *  chỗ trong file này dùng tới, nên một bản sao gần-đúng của nó sẽ là thứ
     *  lệch khỏi API mà không ai phát hiện. Giá trị duy nhất truyền vào là
     *  EXCLUDE_HEADLESS ở đầu file. */
    dimensionFilter?: unknown;
  }
): Promise<RawGa4Row[]> {
  const accessToken = await getGoogleAccessToken([GA4_READONLY_SCOPE]);
  const response = await fetch(`${GA4_DATA_API_BASE}/properties/${ga4PropertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GA4 runReport thất bại cho property ${ga4PropertyId}: ${explainGoogleApiError(response.status, body)}`
    );
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
