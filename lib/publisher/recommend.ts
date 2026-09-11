import type { SiteSearchTotals, PageSearchRow, SubmittedSitemap } from "@/lib/google/search-console";
import type { SiteTrafficTotals, TrafficBreakdownRow } from "@/lib/google/analytics-data";
import type { SitemapCount } from "@/lib/sitemap/count";

/**
 * Chỉ số → đề xuất, theo mục tiêu site đang đuổi.
 *
 * Ba trạng thái, không phải hai. Một luật có thể "kêu", "đã ổn", hoặc KHÔNG
 * ĐO ĐƯỢC — và trạng thái thứ ba là lý do file này tồn tại ở dạng này.
 *
 * Nếu chỉ có kêu/không-kêu thì một lần GSC trả 403 sẽ hiện ra y hệt một site
 * khoẻ mạnh: danh sách đề xuất rỗng. Toàn bộ dự án này liên tục bắt được đúng
 * một kiểu lỗi — tín hiệu không thể kêu trông giống hệt tín hiệu không có gì
 * để kêu — nên ở đây nó được dựng vào kiểu dữ liệu chứ không để trong đầu
 * người đọc.
 *
 * Mục tiêu quyết định luật nào CHẠY, không phải luật nào được tô đậm. Một site
 * đang đuổi index coverage không cần nghe về CTR, và trộn cả hai vào một danh
 * sách dài là cách không việc nào được làm.
 */

export type Goal = "index-coverage" | "traffic" | "leads";

export const GOALS: { id: Goal; label: string; hint: string }[] = [
  { id: "index-coverage", label: "Được index", hint: "Trang đã dựng nhưng Google chưa thấy — lo việc này trước khi lo thứ hạng." },
  { id: "traffic", label: "Tăng truy cập", hint: "Đã có hiển thị, cần biến hiển thị thành click." },
  { id: "leads", label: "Ra lead", hint: "Đã có truy cập, cần đưa người đọc sang trang dịch vụ." },
];

export interface MetricsInput {
  windowDays: number;
  search: SiteSearchTotals | null;
  gscError: string | null;
  topPages: PageSearchRow[] | null;
  sitemaps: SubmittedSitemap[] | null;
  sitemapsError: string | null;
  sitemapCount: SitemapCount | null;
  sitemapError: string | null;
  postCount: number | null;
  postCountError: string | null;
  traffic: SiteTrafficTotals | null;
  trafficBySource: TrafficBreakdownRow[] | null;
  ga4Error: string | null;
}

export type Verdict =
  | { status: "fired"; evidence: string; action: string; severity: "cao" | "vừa" }
  | { status: "ok"; evidence: string }
  /** Thiếu số liệu để kết luận. `missing` nói thiếu cái gì, `fix` nói nối lại
   * thế nào — một dòng "không đo được" mà không nói thiếu gì thì cũng câm như
   * việc không hiện dòng nào. */
  | { status: "unmeasurable"; missing: string; fix: string };

export interface Recommendation {
  id: string;
  goal: Goal;
  title: string;
  verdict: Verdict;
}

interface Rule {
  id: string;
  goal: Goal;
  title: string;
  run: (m: MetricsInput) => Verdict;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

const RULES: Rule[] = [
  {
    id: "sitemap-submitted",
    goal: "index-coverage",
    title: "Sitemap đã nộp cho Search Console",
    run: (m) => {
      if (m.sitemaps === null) {
        return { status: "unmeasurable", missing: m.sitemapsError ?? "Không đọc được danh sách sitemap từ Search Console.", fix: "Kiểm Service Account đã được cấp quyền trên property trong Cài đặt." };
      }
      if (m.sitemaps.length === 0) {
        return { status: "fired", severity: "cao", evidence: "Search Console không biết sitemap nào của site này.", action: "Nộp sitemap ở tab Tổng quan. Chưa nộp thì Google chỉ tìm thấy trang qua link, và trang mới nhất là trang đợi lâu nhất." };
      }
      return { status: "ok", evidence: `${m.sitemaps.length} sitemap đã nộp.` };
    },
  },
  {
    id: "sitemap-errors",
    goal: "index-coverage",
    title: "Sitemap không có lỗi",
    run: (m) => {
      if (m.sitemaps === null) {
        return { status: "unmeasurable", missing: m.sitemapsError ?? "Không đọc được danh sách sitemap.", fix: "Xem luật phía trên." };
      }
      const bad = m.sitemaps.filter((s) => s.errors > 0);
      if (bad.length > 0) {
        return { status: "fired", severity: "cao", evidence: `${bad.length} sitemap đang báo lỗi: ${bad.map((s) => `${s.path} (${s.errors})`).join(", ")}.`, action: "Mở báo cáo Sitemaps trong Search Console đọc lỗi. Một sitemap lỗi có thể khiến cả lô URL trong đó không được đọc." };
      }
      return { status: "ok", evidence: "Không sitemap nào báo lỗi." };
    },
  },
  {
    id: "posts-in-sitemap",
    goal: "index-coverage",
    title: "Bài đã đăng đều nằm trong sitemap",
    run: (m) => {
      if (m.postCount === null || m.sitemapCount === null) {
        return {
          status: "unmeasurable",
          missing: m.postCountError ?? m.sitemapError ?? "Thiếu số bài đã đăng hoặc số URL trong sitemap.",
          fix: "Kiểm REST API của WordPress và đường dẫn sitemap ở tab Tổng quan.",
        };
      }
      if (m.postCount > m.sitemapCount.total) {
        return {
          status: "fired",
          severity: "cao",
          evidence: `WordPress có ${m.postCount} bài đã đăng, sitemap chỉ liệt kê ${m.sitemapCount.total} URL.`,
          action: "Sitemap đang bỏ sót bài. Kiểm plugin sinh sitemap — bài không có trong sitemap là bài Google phải tự tìm ra.",
        };
      }
      return { status: "ok", evidence: `${m.postCount} bài đã đăng, ${m.sitemapCount.total} URL trong sitemap.` };
    },
  },
  {
    id: "impression-coverage",
    goal: "index-coverage",
    title: "Tỷ lệ trang có hiển thị",
    run: (m) => {
      if (m.search === null || m.sitemapCount === null) {
        return {
          status: "unmeasurable",
          missing: m.gscError ?? m.sitemapError ?? "Thiếu số liệu Search Console hoặc sitemap.",
          fix: "Nối Search Console trong Cài đặt.",
        };
      }
      if (m.sitemapCount.content === 0) {
        return { status: "unmeasurable", missing: "Sitemap chưa có URL nội dung nào để so.", fix: "Tạo bài trước đã — chưa có trang thì không có gì để đo phủ." };
      }
      const share = m.search.pagesWithImpressions / m.sitemapCount.content;
      // pagesWithImpressions là PROXY và nó ĐẾM THIẾU: một trang đã index
      // nhưng chưa xếp hạng cho truy vấn nào vẫn ra 0 hiển thị. Nói rõ ở đây
      // vì con số này rất dễ bị đọc thành phán quyết index của Google.
      const note = `${m.search.pagesWithImpressions}/${m.sitemapCount.content} trang nội dung có hiển thị trong ${m.windowDays} ngày (${pct(share)}). Đây là ƯỚC LƯỢNG đếm thiếu: trang đã index nhưng chưa xếp hạng cho truy vấn nào cũng ra 0.`;
      if (share < 0.6) {
        return { status: "fired", severity: "vừa", evidence: note, action: "Kiểm vài URL bằng URL Inspection để biết là chưa index hay đã index mà chưa xếp hạng — hai việc này cần hai cách xử lý khác nhau." };
      }
      return { status: "ok", evidence: note };
    },
  },
  {
    id: "low-ctr",
    goal: "traffic",
    title: "Trang nhiều hiển thị nhưng ít click",
    run: (m) => {
      if (m.topPages === null) {
        return { status: "unmeasurable", missing: m.gscError ?? "Không đọc được số liệu theo trang từ Search Console.", fix: "Nối Search Console trong Cài đặt." };
      }
      const weak = m.topPages.filter((p) => p.impressions >= 100 && p.ctr < 0.02);
      if (weak.length > 0) {
        const top = [...weak].sort((a, b) => b.impressions - a.impressions).slice(0, 5);
        return {
          status: "fired",
          severity: "vừa",
          evidence: `${weak.length} trang có ≥100 hiển thị mà CTR <2%: ${top.map((p) => `${p.page} (${p.impressions} hiển thị, ${pct(p.ctr)})`).join("; ")}.`,
          action: "Viết lại tiêu đề và meta description của những trang này trong trình sửa template — hiển thị đã có, thứ thiếu là lý do để bấm.",
        };
      }
      return { status: "ok", evidence: `Không trang nào có ≥100 hiển thị mà CTR dưới 2% (xét ${m.topPages.length} trang).` };
    },
  },
  {
    id: "near-miss",
    goal: "traffic",
    title: "Trang đứng sát trang 1",
    run: (m) => {
      if (m.topPages === null) {
        return { status: "unmeasurable", missing: m.gscError ?? "Không đọc được số liệu theo trang.", fix: "Nối Search Console trong Cài đặt." };
      }
      const near = m.topPages.filter((p) => p.position > 10 && p.position <= 20 && p.impressions >= 30);
      if (near.length > 0) {
        const top = [...near].sort((a, b) => a.position - b.position).slice(0, 5);
        return {
          status: "fired",
          severity: "vừa",
          evidence: `${near.length} trang đang ở vị trí 11–20: ${top.map((p) => `${p.page} (vị trí ${p.position.toFixed(1)})`).join("; ")}.`,
          action: "Đây là nhóm rẻ nhất để cải thiện: thêm link nội bộ trỏ tới chúng từ các trang cùng chủ đề, thay vì viết bài mới.",
        };
      }
      return { status: "ok", evidence: "Không trang nào kẹt ở vị trí 11–20 với đủ hiển thị để đáng động vào." };
    },
  },
  {
    id: "zero-click",
    goal: "traffic",
    title: "Trang có hiển thị nhưng chưa click nào",
    run: (m) => {
      if (m.topPages === null) {
        return { status: "unmeasurable", missing: m.gscError ?? "Không đọc được số liệu theo trang.", fix: "Nối Search Console trong Cài đặt." };
      }
      const zero = m.topPages.filter((p) => p.impressions >= 50 && p.clicks === 0);
      if (zero.length > 0) {
        return {
          status: "fired",
          severity: "vừa",
          evidence: `${zero.length} trang có ≥50 hiển thị mà 0 click trong ${m.windowDays} ngày.`,
          action: "Xem chúng đang hiển thị cho truy vấn gì. Hiển thị cho truy vấn sai thì viết lại tiêu đề cũng không cứu được — đó là vấn đề chọn chủ đề, không phải vấn đề câu chữ.",
        };
      }
      return { status: "ok", evidence: "Không trang nào có nhiều hiển thị mà hoàn toàn không có click." };
    },
  },
  {
    id: "organic-share",
    goal: "leads",
    title: "Tỷ trọng truy cập từ tìm kiếm tự nhiên",
    run: (m) => {
      if (m.trafficBySource === null || m.traffic === null) {
        return { status: "unmeasurable", missing: m.ga4Error ?? "Không đọc được GA4.", fix: "Nối GA4 trong Cài đặt (cùng Service Account với Search Console)." };
      }
      const total = m.trafficBySource.reduce((s, r) => s + r.sessions, 0);
      if (total === 0) {
        return { status: "unmeasurable", missing: `GA4 báo 0 phiên trong ${m.windowDays} ngày.`, fix: "Kiểm measurement ID đã gắn đúng lên site — 0 phiên thường là chưa gắn, không phải không ai vào." };
      }
      const organic = m.trafficBySource.filter((r) => /organic/i.test(r.dimensionValue)).reduce((s, r) => s + r.sessions, 0);
      const share = organic / total;
      const note = `${organic}/${total} phiên đến từ tìm kiếm tự nhiên (${pct(share)}).`;
      if (share < 0.3) {
        return { status: "fired", severity: "vừa", evidence: note, action: "Phần lớn truy cập không đến từ tìm kiếm, nên thêm bài pSEO chưa chắc là việc đáng làm tiếp theo. Xem nguồn nào đang mang người tới trước khi tăng sản lượng." };
      }
      return { status: "ok", evidence: note };
    },
  },
  {
    id: "lead-measurement",
    goal: "leads",
    title: "Lead có đang được đo không",
    run: () => ({
      // Luật này KHÔNG BAO GIỜ báo ổn, và đó là chủ ý: Control Panel hiện
      // không đọc sự kiện chuyển đổi của GA4, nên nó không có cách nào biết
      // một phiên có thành lead hay không. Trả về "ổn" ở đây sẽ là khẳng định
      // một điều chưa ai đo.
      status: "unmeasurable",
      missing: "Control Panel chưa đọc sự kiện chuyển đổi của GA4, nên không biết phiên nào thành lead.",
      fix: "Đặt một sự kiện chuyển đổi trong GA4 (gửi form, bấm số điện thoại) rồi báo lại — phần đọc sự kiện đó chưa được viết. Tới lúc đó, mọi con số dưới đây là truy cập, không phải lead.",
    }),
  },
];

/**
 * Đề xuất cho một mục tiêu.
 *
 * goal null trả về mảng rỗng kèm cờ — bảng điều khiển nói "chưa chọn mục
 * tiêu" chứ không đoán là "traffic". Đoán ra một mục tiêu rồi tự tin khuyên
 * cho mục tiêu chủ site chưa từng đặt là cách tệ nhất để sai.
 */
export function recommend(goal: Goal | null, m: MetricsInput): Recommendation[] {
  if (goal === null) return [];
  return RULES.filter((r) => r.goal === goal).map((r) => ({ id: r.id, goal: r.goal, title: r.title, verdict: r.run(m) }));
}

export function isGoal(v: string | null): v is Goal {
  return v === "index-coverage" || v === "traffic" || v === "leads";
}
