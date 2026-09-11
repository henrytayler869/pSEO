// Chứng minh mỗi luật đề xuất đều KÊU được, và — quan trọng hơn — chứng minh
// chỉ số thiếu ra "không đo được" chứ không ra "đã ổn".
//
// Khẳng định thứ hai mới là lý do file này tồn tại. Nếu thiếu số liệu mà ra
// "ổn", thì một lần GSC trả 403 sẽ hiện ra y hệt một site khoẻ mạnh, và người
// đọc bảng điều khiển sẽ tin là không có việc gì phải làm.
//
// Dùng: tsx scripts/test-recommend.ts

import { recommend, GOALS, type Goal, type MetricsInput } from "../lib/publisher/recommend";

/** Mọi chỉ số đều có, và đều lành. Từng ca bên dưới phá đúng một thứ. */
function healthy(): MetricsInput {
  return {
    windowDays: 28,
    search: { clicks: 500, impressions: 20000, ctr: 0.025, avgPosition: 8.2, pagesWithImpressions: 95 },
    gscError: null,
    topPages: [
      { page: "/a", clicks: 100, impressions: 2000, ctr: 0.05, position: 4.1 },
      { page: "/b", clicks: 40, impressions: 900, ctr: 0.044, position: 6.5 },
    ],
    sitemaps: [{ path: "/sitemap.xml", lastSubmitted: "2026-09-01", isPending: false, warnings: 0, errors: 0, submittedUrls: 120 }],
    sitemapsError: null,
    sitemapCount: { total: 120, content: 100, breakdown: [], sourcesRead: [], urls: [] },
    sitemapError: null,
    postCount: 110,
    postCountError: null,
    traffic: { activeUsers: 800, sessions: 1000, screenPageViews: 2200 },
    trafficBySource: [
      { dimensionValue: "Organic Search", sessions: 700, activeUsers: 700 },
      { dimensionValue: "Direct", sessions: 300, activeUsers: 300 },
    ],
    ga4Error: null,
  };
}

function verdictOf(goal: Goal, id: string, m: MetricsInput) {
  return recommend(goal, m).find((r) => r.id === id)?.verdict;
}

interface Case {
  name: string;
  goal: Goal;
  id: string;
  want: "fired" | "ok" | "unmeasurable";
  make: (m: MetricsInput) => MetricsInput;
}

const CASES: Case[] = [
  // --- kêu được ---
  { name: "chưa nộp sitemap -> kêu", goal: "index-coverage", id: "sitemap-submitted", want: "fired", make: (m) => ({ ...m, sitemaps: [] }) },
  {
    name: "sitemap báo lỗi -> kêu",
    goal: "index-coverage",
    id: "sitemap-errors",
    want: "fired",
    make: (m) => ({ ...m, sitemaps: [{ ...m.sitemaps![0], errors: 3 }] }),
  },
  { name: "bài nhiều hơn URL trong sitemap -> kêu", goal: "index-coverage", id: "posts-in-sitemap", want: "fired", make: (m) => ({ ...m, postCount: 300 }) },
  {
    name: "ít trang có hiển thị -> kêu",
    goal: "index-coverage",
    id: "impression-coverage",
    want: "fired",
    make: (m) => ({ ...m, search: { ...m.search!, pagesWithImpressions: 10 } }),
  },
  {
    name: "hiển thị nhiều mà CTR thấp -> kêu",
    goal: "traffic",
    id: "low-ctr",
    want: "fired",
    make: (m) => ({ ...m, topPages: [{ page: "/a", clicks: 2, impressions: 5000, ctr: 0.0004, position: 7 }] }),
  },
  {
    name: "kẹt vị trí 11-20 -> kêu",
    goal: "traffic",
    id: "near-miss",
    want: "fired",
    make: (m) => ({ ...m, topPages: [{ page: "/a", clicks: 3, impressions: 400, ctr: 0.0075, position: 13.4 }] }),
  },
  {
    name: "hiển thị nhiều, 0 click -> kêu",
    goal: "traffic",
    id: "zero-click",
    want: "fired",
    make: (m) => ({ ...m, topPages: [{ page: "/a", clicks: 0, impressions: 600, ctr: 0, position: 22 }] }),
  },
  {
    name: "tự nhiên chiếm tỷ trọng nhỏ -> kêu",
    goal: "leads",
    id: "organic-share",
    want: "fired",
    make: (m) => ({ ...m, trafficBySource: [{ dimensionValue: "Organic Search", sessions: 50, activeUsers: 50 }, { dimensionValue: "Direct", sessions: 950, activeUsers: 950 }] }),
  },

  // --- thiếu số liệu phải ra "không đo được", KHÔNG được ra "ổn" ---
  { name: "GSC hỏng -> low-ctr không đo được", goal: "traffic", id: "low-ctr", want: "unmeasurable", make: (m) => ({ ...m, topPages: null, gscError: "403" }) },
  { name: "GSC hỏng -> near-miss không đo được", goal: "traffic", id: "near-miss", want: "unmeasurable", make: (m) => ({ ...m, topPages: null, gscError: "403" }) },
  { name: "GSC hỏng -> zero-click không đo được", goal: "traffic", id: "zero-click", want: "unmeasurable", make: (m) => ({ ...m, topPages: null, gscError: "403" }) },
  { name: "GSC hỏng -> impression-coverage không đo được", goal: "index-coverage", id: "impression-coverage", want: "unmeasurable", make: (m) => ({ ...m, search: null, gscError: "403" }) },
  { name: "không đọc được sitemap -> sitemap-submitted không đo được", goal: "index-coverage", id: "sitemap-submitted", want: "unmeasurable", make: (m) => ({ ...m, sitemaps: null, sitemapsError: "401" }) },
  { name: "không đọc được sitemap -> sitemap-errors không đo được", goal: "index-coverage", id: "sitemap-errors", want: "unmeasurable", make: (m) => ({ ...m, sitemaps: null, sitemapsError: "401" }) },
  { name: "WP không trả số bài -> posts-in-sitemap không đo được", goal: "index-coverage", id: "posts-in-sitemap", want: "unmeasurable", make: (m) => ({ ...m, postCount: null, postCountError: "timeout" }) },
  { name: "GA4 hỏng -> organic-share không đo được", goal: "leads", id: "organic-share", want: "unmeasurable", make: (m) => ({ ...m, trafficBySource: null, ga4Error: "403" }) },
  { name: "GA4 báo 0 phiên -> không đo được, không phải ổn", goal: "leads", id: "organic-share", want: "unmeasurable", make: (m) => ({ ...m, trafficBySource: [] }) },
  { name: "lead: chưa đọc sự kiện chuyển đổi -> luôn không đo được", goal: "leads", id: "lead-measurement", want: "unmeasurable", make: (m) => m },

  // --- site lành thì báo ổn, không kêu bừa ---
  { name: "site lành -> sitemap-submitted ổn", goal: "index-coverage", id: "sitemap-submitted", want: "ok", make: (m) => m },
  { name: "site lành -> low-ctr ổn", goal: "traffic", id: "low-ctr", want: "ok", make: (m) => m },
  { name: "site lành -> organic-share ổn", goal: "leads", id: "organic-share", want: "ok", make: (m) => m },
];

let ok = 0;
const failures: string[] = [];

for (const c of CASES) {
  const v = verdictOf(c.goal, c.id, c.make(healthy()));
  const good = v?.status === c.want;
  if (good) ok++;
  else failures.push(`${c.name}\n      nhận "${v?.status ?? "(không có luật này)"}", kỳ vọng "${c.want}"`);
  console.log(`${good ? "✓" : "✗"} ${c.name}`);
}

console.log();

// Mỗi mục tiêu phải có luật. Một mục tiêu chọn được mà không luật nào chạy sẽ
// cho ra màn hình trống, đọc y như "không có việc gì phải làm".
for (const g of GOALS) {
  const n = recommend(g.id, healthy()).length;
  const good = n > 0;
  if (good) ok++;
  else failures.push(`mục tiêu "${g.id}" không có luật nào`);
  console.log(`${good ? "✓" : "✗"} mục tiêu "${g.label}" có ${n} luật`);
}

// Chưa chọn mục tiêu thì KHÔNG đề xuất gì — và màn hình phải nói lý do, chứ
// không đoán bừa một mục tiêu rồi khuyên tự tin cho thứ chủ site chưa đặt.
{
  const good = recommend(null, healthy()).length === 0;
  if (good) ok++;
  else failures.push("chưa chọn mục tiêu mà vẫn đề xuất");
  console.log(`${good ? "✓" : "✗"} chưa chọn mục tiêu -> không đề xuất gì`);
}

// Không luật nào được trả "ok" khi đầu vào của nó là null. Khẳng định này quét
// TẤT CẢ luật, kể cả luật thêm sau này — bộ ca ở trên chỉ phủ luật đã biết.
{
  const blank: MetricsInput = {
    windowDays: 28,
    search: null, gscError: "không nối được", topPages: null,
    sitemaps: null, sitemapsError: "không nối được", sitemapCount: null, sitemapError: "không nối được",
    postCount: null, postCountError: "không nối được",
    traffic: null, trafficBySource: null, ga4Error: "không nối được",
  };
  const wrong = GOALS.flatMap((g) => recommend(g.id, blank)).filter((r) => r.verdict.status !== "unmeasurable");
  const good = wrong.length === 0;
  if (good) ok++;
  else failures.push(`không chỉ số nào mà vẫn kết luận: ${wrong.map((r) => `${r.id}=${r.verdict.status}`).join(", ")}`);
  console.log(`${good ? "✓" : "✗"} không có chỉ số nào -> mọi luật đều "không đo được"`);
}

const total = CASES.length + GOALS.length + 2;
console.log(`\n${ok}/${total} kiểm tra đúng.`);
if (failures.length > 0) {
  console.error(`\nTHẤT BẠI:\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
}
