/**
 * Google đã CRAWL tới đâu — đọc đủ `indexStatusResult`, không chỉ verdict.
 *
 *     tsx scripts/probe-index-coverage.ts <host> [url...]
 *
 * ═══ VÌ SAO KHÔNG DÙNG `fetchUrlIndexStatus()` ═══
 *
 * Hàm đó trả `verdict === "PASS"`, tức một boolean. Nó đúng cho câu hỏi "trang
 * này đã index chưa", nhưng với một site VỪA lên sóng thì mọi URL đều `false`,
 * và một cột toàn `false` không phân biệt được ba trạng thái hoàn toàn khác
 * nhau:
 *
 *     Google CHƯA BIẾT URL này          -> việc cần làm: nộp sitemap, chờ crawl
 *     Google ĐÃ CRAWL, thấy 404         -> việc cần làm: sửa rồi XIN CRAWL LẠI
 *     Google ĐÃ CRAWL, chặn bởi robots  -> việc cần làm: sửa robots
 *
 * Ba chẩn đoán, ba việc, và `false` gộp cả ba. `coverageState` +
 * `lastCrawlTime` + `robotsTxtState` tách chúng ra.
 *
 * Đây đúng cái lỗi mà kho này gặp nhiều lần: một phép đo CHẠY, trả về giá trị
 * hợp lệ, và trả lời một câu hẹp hơn câu mình đang hỏi.
 *
 * ═══ "COVERAGE" KHÔNG TỒN TẠI Ở API — ĐỪNG GỌI NÓ BẰNG TÊN ĐÓ ═══
 *
 * Báo cáo Index Coverage của Search Console **không có API công khai**. Thứ
 * duy nhất công khai là URL Inspection, MỘT url mỗi lời gọi, quota 2.000/ngày
 * mỗi property. Bản đầu của file này viết "đo coverage trước impressions" —
 * lý lẽ đúng, cái tên sai, và một cái tên sai cho một số có thật là cách
 * nhanh nhất để người sau đi tìm một endpoint không tồn tại.
 *
 * Lý lẽ thì giữ: impressions = 0 trên site vừa lên sóng KHÔNG phân biệt được
 * "chưa ai tìm" với "chưa ai crawl". Ba tín hiệu crawl THẬT, rẻ → đắt:
 *
 *   1. `listSitemaps().lastDownloaded`  Google đã TẢI sitemap chưa. Một lời
 *      gọi, KHÔNG tốn quota. Phân biệt "chưa biết tới site" với "biết rồi mà
 *      chưa crawl trang". Đây là số đầu tiên đáng xin.
 *   2. URL Inspection (file này)        thật cho từng URL. LẤY MẪU, đừng quét
 *      cả sitemap — 358 URL là 358 lần quota.
 *   3. access log ở origin             Googlebot có tới không. Không qua
 *      Google, không quota. Nhưng IP ở origin chỉ BÁC được bot giả, không
 *      khẳng định được bot thật.
 *
 * VÀ MỘT TRƯỜNG BẪY: `sitemaps.contents[].indexed` CÓ trong phản hồi và trả
 * **0** cho cả hai property ngày 20/9/2026, trong khi URL Inspection nói 14 và
 * 37 trang đã index. `listSitemaps` cố ý không đọc nó — một con số sai mà
 * trông như số thật thì tệ hơn không có số.
 *
 * ═══ QUOTA ═══
 *
 * URL Inspection giới hạn 2.000/ngày và 600/phút mỗi property. Script này chỉ
 * soi danh sách được truyền vào — KHÔNG quét cả sitemap. In số URL trước khi
 * gọi để người chạy thấy mình đang xin bao nhiêu.
 */
/**
 * IPv4 BẮT BUỘC, và phải đặt TRƯỚC mọi import gọi mạng.
 *
 * Từ máy này, lời gọi Google API trong Node chết với `connect ENETUNREACH` tới
 * một địa chỉ IPv6 của Google. `curl` không bị vì nó tự rơi về IPv4; Node thì
 * không. Và nó KHÔNG tất định — đo 25/9/2026, cùng một script cùng một phút:
 * hai property trả `fetch failed` còn property thứ ba đi tới đích và trả 403.
 * Một lỗi mạng không tất định đọc y hệt một lỗi quyền, hoặc một API đang sập.
 *
 * `NODE_OPTIONS=--dns-result-order=ipv4first` KHÔNG cứu được — đã thử.
 *
 * Thông báo lỗi không nhắc một chữ nào về IPv6 hay Google, nên nó đọc như
 * "mạng hỏng" hoặc "credential sai" — hai chẩn đoán dẫn đi hai hướng khác.
 */
import { setGlobalDispatcher, Agent } from "undici";
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

import { prisma } from "@/lib/db/prisma";
import { listSitemaps } from "@/lib/google/search-console";
import { getGoogleAccessToken } from "@/lib/google/service-account";

interface IndexStatus {
  verdict?: string;
  coverageState?: string;
  robotsTxtState?: string;
  indexingState?: string;
  lastCrawlTime?: string;
  pageFetchState?: string;
  googleCanonical?: string;
  userCanonical?: string;
}

async function inspect(token: string, siteUrl: string, inspectionUrl: string): Promise<IndexStatus | string> {
  const res = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inspectionUrl, siteUrl }),
  });
  if (!res.ok) {
    const body = await res.text();
    return `HTTP ${res.status} — ${body.slice(0, 200)}`;
  }
  const json = (await res.json()) as { inspectionResult?: { indexStatusResult?: IndexStatus } };
  return json.inspectionResult?.indexStatusResult ?? "phản hồi thiếu indexStatusResult (schema drift)";
}

async function main(): Promise<void> {
  const [host, ...urls] = process.argv.slice(2);
  if (!host) throw new Error("Dùng: tsx scripts/probe-index-coverage.ts <host> [url...]");

  const site = await prisma.website.findFirst({
    where: { url: { contains: host } },
    select: { name: true, url: true, gscPropertyUrl: true },
  });
  if (!site?.gscPropertyUrl) {
    throw new Error(`Site "${host}" chưa có gscPropertyUrl trong hàng Website.`);
  }

  const targets = urls.length > 0 ? urls : [site.url];
  console.log(`site     ${site.name} — ${site.url}`);
  console.log(`property ${site.gscPropertyUrl}`);
  console.log(`soi      ${targets.length} URL (quota 2.000/ngày mỗi property)\n`);

  /**
   * Tín hiệu RẺ NHẤT trước, và in nó ra dù có soi URL hay không.
   *
   * `lastDownloaded` trả lời "Google đã biết tới site này chưa" bằng MỘT lời
   * gọi không tốn quota. Nếu nó là "CHƯA BAO GIỜ" thì mọi URL Inspection phía
   * dưới đã biết trước câu trả lời, và 358 lần quota là 358 lần hỏi một câu đã
   * có đáp án.
   */
  console.log("── Google đã tải sitemap chưa (không tốn quota)");
  try {
    const maps = await listSitemaps(site.gscPropertyUrl);
    if (maps.length === 0) console.log("   (chưa nộp sitemap nào)");
    for (const m of maps) {
      console.log(`   ${m.path}`);
      console.log(`      nộp:        ${m.lastSubmitted ?? "—"}`);
      console.log(`      Google TẢI: ${m.lastDownloaded ?? "CHƯA BAO GIỜ"}   warn=${m.warnings} err=${m.errors}`);
    }
  } catch (e) {
    console.log(`   ✗ ${e instanceof Error ? e.message.slice(0, 140) : e}`);
  }
  console.log("");

  const token = await getGoogleAccessToken(["https://www.googleapis.com/auth/webmasters.readonly"]);

  for (const u of targets) {
    const r = await inspect(token, site.gscPropertyUrl, u);
    const path = u.replace(site.url, "") || "/";
    if (typeof r === "string") {
      console.log(`✗ ${path}\n    ${r}`);
      continue;
    }
    console.log(`── ${path}`);
    console.log(`   verdict        ${r.verdict ?? "—"}`);
    console.log(`   coverageState  ${r.coverageState ?? "—"}`);
    console.log(`   lastCrawlTime  ${r.lastCrawlTime ?? "CHƯA BAO GIỜ crawl"}`);
    console.log(`   robotsTxtState ${r.robotsTxtState ?? "—"}`);
    console.log(`   pageFetchState ${r.pageFetchState ?? "—"}`);
    /**
     * CHỈ cảnh báo khi CẢ HAI có giá trị và chúng khác nhau.
     *
     * Bản đầu chỉ kiểm `googleCanonical && !== userCanonical`, nên khi API
     * không trả `userCanonical` thì nó in "trang khai undefined · Google chọn
     * …" — một cảnh báo GIẢ, và đúng loại nhiễu làm người ta thôi đọc cảnh
     * báo. Bắt được nhờ chạy đối chứng trên site đã hoạt động lâu.
     */
    if (r.googleCanonical && r.userCanonical && r.googleCanonical !== r.userCanonical) {
      console.log(`   ⚠ canonical LỆCH: trang khai ${r.userCanonical} · Google chọn ${r.googleCanonical}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
