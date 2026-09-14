// Kiểm buildOnPageSummary — cách đọc phản hồi OnPage của DataForSEO.
//
// Dữ liệu vào lấy từ HÌNH DẠNG THẬT, đo 14/9/2026 trên atmovingservices.com
// (194 trang crawl). Hai lỗi đã sống trong hàm này và cả hai đều thuộc loại
// "không bao giờ nổ":
//   1. đọc pages_crawled sai đường → mọi phép trừ tự tắt trong im lặng
//   2. đọc họ *_check ngược → 193 trang ĐẠT hiện thành 193 trang LỖI

import { buildOnPageSummary } from "../lib/dataforseo/on-page";

let pass = 0;
const fails: string[] = [];
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fails.push(`${name}\n      ${e instanceof Error ? e.message : e}`); console.log(`✗ ${name}`); }
}
function eq(a: unknown, b: unknown, what: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: nhận ${JSON.stringify(a)}, cần ${JSON.stringify(b)}`);
}

/** Hình dạng thật: pages_crawled nằm TRONG crawl_status. */
const REAL = {
  crawl_progress: "finished",
  crawl_status: { pages_crawled: 194, pages_in_queue: 0 },
  page_metrics: {
    onpage_score: 97.2,
    checks: {
      seo_friendly_url_characters_check: 193,
      seo_friendly_url_dynamic_check: 193,
      seo_friendly_url_relative_length_check: 193,
      seo_friendly_url_keywords_check: 192,
      seo_friendly_url: 192,
      canonical: 193,
      has_html_doctype: 193,
      is_https: 194,
      has_render_blocking_resources: 193,
      low_content_rate: 192,
      title_too_long: 78,
      low_character_count: 13,
      title_too_short: 4,
      is_broken: 1,
      is_4xx_code: 1,
    },
  },
};

const find = (s: ReturnType<typeof buildOnPageSummary>, k: string) => s.issues.find((i) => i.key === k);

check("pages_crawled đọc từ crawl_status, không phải cấp result", () => {
  eq(buildOnPageSummary(REAL).pagesCrawled, 194, "pagesCrawled");
});

check("193/194 ĐẠT → báo 1 trang lỗi, KHÔNG phải 193", () => {
  const s = buildOnPageSummary(REAL);
  eq(find(s, "seo_friendly_url_characters_check")?.count, 1, "số trang lỗi");
});

check("192/194 ĐẠT → 2 trang lỗi", () => {
  eq(find(buildOnPageSummary(REAL), "seo_friendly_url_keywords_check")?.count, 2, "số trang lỗi");
});

check("check ĐẠT hết → KHÔNG hiện thành issue", () => {
  // is_https = 194/194. Một dòng "0 trang" hay tệ hơn "194 trang lỗi HTTPS"
  // đều sai; đúng là không có dòng nào.
  eq(find(buildOnPageSummary(REAL), "is_https"), undefined, "is_https");
});

check("check dạng LỖI vẫn đọc xuôi — 193 nghĩa là 193 trang dính", () => {
  eq(find(buildOnPageSummary(REAL), "has_render_blocking_resources")?.count, 193, "số trang");
});

check("canonical 193/194 → 1 trang thiếu canonical (yêu cầu của QC §7b)", () => {
  eq(find(buildOnPageSummary(REAL), "canonical")?.count, 1, "số trang");
});

check("lỗi nặng xếp trước cảnh báo", () => {
  const s = buildOnPageSummary(REAL);
  eq(s.issues[0].severity, "error", "mức của dòng đầu");
});

check("low_character_count có nhãn, không rơi vào 'chưa phân loại'", () => {
  const s = buildOnPageSummary(REAL);
  eq(s.unclassified.find((u) => u.key === "low_character_count"), undefined, "unclassified");
  eq(find(s, "low_character_count")?.count, 13, "số trang");
});

check("khoá lạ vẫn rơi vào 'chưa phân loại', không bị nuốt", () => {
  const s = buildOnPageSummary({ ...REAL, page_metrics: { checks: { ...REAL.page_metrics.checks, some_new_check_2027: 5 } } });
  eq(s.unclassified.find((u) => u.key === "some_new_check_2027")?.count, 5, "unclassified");
});

check("KHÔNG biết tổng trang → bỏ qua check dạng ĐẠT và NÓI RA", () => {
  // Đây là ca đã xảy ra thật. Im lặng bỏ qua sẽ làm bảng trông sạch hơn sự
  // thật — tệ hơn cả việc báo sai số.
  const s = buildOnPageSummary({ crawl_progress: "finished", page_metrics: { checks: REAL.page_metrics.checks } });
  eq(s.pagesCrawled, 0, "pagesCrawled");
  eq(find(s, "seo_friendly_url_characters_check"), undefined, "không suy được thì không báo bừa");
  eq(s.countsUnavailable, true, "cờ cảnh báo");
});

check("biết tổng trang → cờ cảnh báo TẮT", () => {
  eq(buildOnPageSummary(REAL).countsUnavailable, false, "countsUnavailable");
});

console.log(`\n${pass}/${pass + fails.length} đúng.`);
if (fails.length > 0) { console.error(`\nTRƯỢT:\n  ${fails.join("\n  ")}`); process.exitCode = 1; }
