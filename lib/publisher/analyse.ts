import type { PageSearchRow, QuerySearchRow } from "@/lib/google/search-console";
import type { LandingPageRow } from "@/lib/google/analytics-data";
import type { Goal } from "@/lib/publisher/recommend";

/**
 * Phân tích TỪNG TRANG, không phải mức site.
 *
 * `recommend()` trả lời "site này đang mắc ở đâu". Câu đó đúng nhưng không
 * làm được: nó không nói SỬA TRANG NÀO. Với một site pSEO 158 trang, khoảng
 * cách giữa hai câu đó là toàn bộ công việc.
 *
 * MỖI PHÁT HIỆN PHẢI KÈM SỐ ĐÃ ĐO. Một dòng "nên tối ưu tiêu đề" mà không nói
 * trang nào, hiển thị bao nhiêu, hạng bao nhiêu, thì không kiểm chứng được —
 * và thứ không kiểm chứng được sẽ được làm theo hoặc bị bỏ qua tuỳ tâm trạng,
 * chứ không tuỳ dữ liệu.
 *
 * NGƯỠNG VIẾT RA THÀNH HẰNG SỐ CÓ TÊN. Một con số nằm giữa biểu thức là một
 * con số không ai chất vấn được.
 */

/** Hạng 11–20: đã vào trang 2. Đây là nhóm rẻ nhất để đẩy, vì nó đã được
 *  Google coi là liên quan — chỉ chưa đủ mạnh. */
const NEAR_MISS_MIN = 10.5;
const NEAR_MISS_MAX = 20.5;

/** Dưới ngưỡng này thì một tỷ lệ nhấp bằng 0 chưa nói lên điều gì: 5 lần hiển
 *  thị mà 0 nhấp là chuyện bình thường của xác suất, không phải của tiêu đề. */
const MIN_IMPRESSIONS_FOR_CTR = 30;

/** Đã ở trang 1 mà vẫn không ai bấm — lúc đó tiêu đề và mô tả mới là nghi
 *  phạm thật, vì vị trí đã không còn là lý do. */
const CTR_POSITION_MAX = 10.5;

/** Giây. Ngắn hơn thế thì phiên đó gần như chắc chắn là vào rồi thoát ngay. */
const SHORT_SESSION_SECONDS = 15;
const MIN_SESSIONS_FOR_ENGAGEMENT = 20;

export type FindingKind = "near-miss" | "low-ctr" | "no-impressions" | "thin-engagement";

export interface PageFinding {
  path: string;
  kind: FindingKind;
  /** Con số đã đo, viết ra để người đọc kiểm được kết luận. */
  evidence: string;
  action: string;
  /** Dùng để xếp thứ tự; cao hơn = đáng làm trước. Là tiềm năng ĐÃ ĐO
   *  (hiển thị hoặc phiên), không phải điểm do ai đó gán. */
  weight: number;
}

export interface AnalysisInput {
  siteUrl: string;
  pages: PageSearchRow[] | null;
  queries: QuerySearchRow[] | null;
  landing: LandingPageRow[] | null;
  /** Mọi đường dẫn site đang phục vụ, từ /api/inventory của publisher. Cần để
   *  phát hiện trang KHÔNG có hiển thị — thứ không thể suy ra từ một danh sách
   *  chỉ chứa trang CÓ hiển thị. */
  servedPaths: string[] | null;
}

export interface AnalysisResult {
  findings: PageFinding[];
  /** Tín hiệu KHÔNG chạy được, và thiếu gì. Bỏ trống mục này thì một nguồn
   *  hỏng trông giống hệt một site không có vấn đề nào. */
  unavailable: { signal: string; missing: string }[];
  /** Truy vấn đã có hiển thị nhưng chưa có trang nào đứng tốt — gợi ý nội
   *  dung còn thiếu, không phải trang cần sửa. */
  queryGaps: { query: string; impressions: number; position: number }[];
}

function pathOf(url: string, siteUrl: string): string {
  return url.replace(siteUrl.replace(/\/+$/, ""), "") || "/";
}

export function analysePages(goal: Goal, input: AnalysisInput): AnalysisResult {
  const findings: PageFinding[] = [];
  const unavailable: AnalysisResult["unavailable"] = [];
  const queryGaps: AnalysisResult["queryGaps"] = [];

  const { pages, queries, landing, servedPaths, siteUrl } = input;

  if (!pages) {
    unavailable.push({ signal: "thứ hạng và tỷ lệ nhấp theo trang", missing: "Search Console không trả dữ liệu trang." });
  }

  // ---- Trang đã vào trang 2 ----
  // Chạy cho MỌI mục tiêu: đẩy một trang từ hạng 14 lên hạng 8 phục vụ cả ba
  // mục tiêu, chỉ khác lý do.
  if (pages) {
    for (const p of pages) {
      if (p.position < NEAR_MISS_MIN || p.position > NEAR_MISS_MAX) continue;
      findings.push({
        path: pathOf(p.page, siteUrl),
        kind: "near-miss",
        evidence: `hạng ${p.position.toFixed(1)}, ${p.impressions.toLocaleString("vi-VN")} hiển thị, ${p.clicks} nhấp`,
        action:
          "Đã ở trang 2 — Google coi là liên quan, chỉ chưa đủ mạnh. Thêm liên kết nội bộ từ trang bang và trang cụm " +
          "cùng khu vực, và bổ sung một đoạn trả lời trực tiếp truy vấn.",
        weight: p.impressions,
      });
    }
  }

  // ---- Đã ở trang 1 mà không ai bấm ----
  if (goal === "traffic" || goal === "leads") {
    if (pages) {
      for (const p of pages) {
        if (p.impressions < MIN_IMPRESSIONS_FOR_CTR) continue;
        if (p.position > CTR_POSITION_MAX) continue;
        if (p.clicks > 0 && p.ctr >= 0.01) continue;
        findings.push({
          path: pathOf(p.page, siteUrl),
          kind: "low-ctr",
          evidence: `hạng ${p.position.toFixed(1)}, ${p.impressions.toLocaleString("vi-VN")} hiển thị, chỉ ${p.clicks} nhấp (CTR ${(p.ctr * 100).toFixed(2)}%)`,
          action:
            "Vị trí đã không còn là lý do, nên nghi phạm là tiêu đề và mô tả. Viết lại tiêu đề để nó chứa con số " +
            "cụ thể của trang — trang này có số liệu mà đối thủ không có, và tiêu đề đang không nói điều đó.",
          weight: p.impressions,
        });
      }
    }
  }

  // ---- Trang đang phục vụ mà KHÔNG có hiển thị nào ----
  if (goal === "index-coverage") {
    if (!servedPaths) {
      unavailable.push({
        signal: "trang chưa có hiển thị",
        missing: "Không đọc được /api/inventory của publisher, nên không biết site đang phục vụ những trang nào.",
      });
    } else if (!pages) {
      // đã báo ở trên
    } else {
      const withImpressions = new Set(pages.filter((p) => p.impressions > 0).map((p) => pathOf(p.page, siteUrl)));
      for (const path of servedPaths) {
        if (withImpressions.has(path)) continue;
        findings.push({
          path,
          kind: "no-impressions",
          evidence: "0 hiển thị trong khoảng đang xem",
          action:
            "Trang tồn tại nhưng chưa từng xuất hiện trong kết quả. Kiểm nó có trong sitemap không, rồi dùng URL " +
            "Inspection ở tab Theo dõi index để biết Google đã thấy chưa — 0 hiển thị có hai nguyên nhân rất khác " +
            "nhau: chưa được index, hoặc đã index mà không có ai tìm.",
          // Không có hiển thị thì không có tiềm năng đo được. Xếp sau mọi
          // phát hiện có số, thay vì gán cho nó một điểm bịa.
          weight: 0,
        });
      }
    }
  }

  // ---- Vào rồi thoát ngay ----
  if (goal === "leads") {
    if (!landing) {
      unavailable.push({ signal: "thời lượng phiên theo trang", missing: "GA4 không trả dữ liệu trang vào." });
    } else {
      for (const l of landing) {
        if (l.sessions < MIN_SESSIONS_FOR_ENGAGEMENT) continue;
        if (l.avgSessionSeconds >= SHORT_SESSION_SECONDS) continue;
        findings.push({
          path: l.path,
          kind: "thin-engagement",
          evidence: `${l.sessions.toLocaleString("vi-VN")} phiên, thời lượng trung bình ${Math.round(l.avgSessionSeconds)} giây`,
          action:
            "Người vào rồi thoát gần như ngay. Trang trả lời sai câu họ hỏi, hoặc trả lời đúng mà không có bước " +
            "tiếp theo. Thêm liên kết sang trang dịch vụ và trang khu vực lân cận ngay dưới bảng số liệu.",
          weight: l.sessions,
        });
      }
    }
  }

  // ---- Truy vấn có nhu cầu mà site chưa đứng được ----
  if (!queries) {
    unavailable.push({ signal: "truy vấn", missing: "Search Console không trả dữ liệu truy vấn." });
  } else {
    for (const q of queries) {
      if (q.impressions < MIN_IMPRESSIONS_FOR_CTR) continue;
      if (q.position <= NEAR_MISS_MAX) continue;
      queryGaps.push({ query: q.query, impressions: q.impressions, position: q.position });
    }
  }

  findings.sort((a, b) => b.weight - a.weight);
  queryGaps.sort((a, b) => b.impressions - a.impressions);
  return { findings, unavailable, queryGaps };
}
