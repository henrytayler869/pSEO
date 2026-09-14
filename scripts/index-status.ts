// Hỏi Google từng URL: đã index chưa.
//
// Dùng URL Inspection API, nguồn duy nhất nói được sự thật cho MỘT url. Ba
// thứ khác thường bị nhầm là câu trả lời:
//   - "URL trong sitemap"     = ta đã nộp gì, không phải Google nhận gì
//   - "trang có impression"   = đã index VÀ đã có người tìm trúng
//   - site:atmovingservices   = ước lượng thô, Google không cam kết
//
// KHÔNG dùng fetchUrlIndexStatus(): nó trả boolean, gộp "chưa index", "đã
// crawl nhưng loại", và "lỗi khi hỏi" thành cùng một false. Ba trạng thái
// đó dẫn tới ba hành động khác nhau.
//
// Dùng:
//   tsx scripts/index-status.ts            # toàn bộ sitemap
//   tsx scripts/index-status.ts 30         # 30 URL đầu theo thứ tự ưu tiên

import { prisma } from "../lib/db/prisma";
import { getGoogleAccessToken } from "../lib/google/service-account";
import { fetchSitemapCounts } from "../lib/sitemap/count";
import { resolveSite, reportSiteError } from "../lib/scripts/resolve-site";
import { numberArg, reportArgError } from "../lib/scripts/argv";

interface Inspection {
  url: string;
  verdict: string;
  coverageState: string;
  lastCrawl: string | null;
  error: string | null;
}

async function inspect(token: string, siteUrl: string, url: string): Promise<Inspection> {
  const res = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inspectionUrl: url, siteUrl }),
  });
  if (!res.ok) {
    // Lỗi là một TRẠNG THÁI, không phải "chưa index". Gộp chúng sẽ biến một
    // sự cố quota thành kết luận "Google chưa index gì cả".
    return { url, verdict: "ERROR", coverageState: `HTTP ${res.status}`, lastCrawl: null, error: (await res.text()).slice(0, 120) };
  }
  const b = (await res.json()) as {
    inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string; lastCrawlTime?: string } };
  };
  const r = b.inspectionResult?.indexStatusResult;
  if (!r?.verdict) return { url, verdict: "ERROR", coverageState: "thiếu indexStatusResult", lastCrawl: null, error: "schema drift" };
  return {
    url,
    verdict: r.verdict,
    coverageState: r.coverageState ?? "(không rõ)",
    lastCrawl: r.lastCrawlTime ?? null,
    error: null,
  };
}

async function main() {
  const site = await resolveSite<{ id: string; url: string; vertical: string; gscPropertyUrl: string }>({
    select: { gscPropertyUrl: true },
  });
  const limit = numberArg(0, Number.POSITIVE_INFINITY);

  const sitemap = await fetchSitemapCounts(site.url);
  if (sitemap.urls.length === 0) {
    console.error("Sitemap không có URL nào — không có gì để hỏi.");
    process.exitCode = 1;
    return;
  }

  // Thứ tự: trang chủ, rồi hub, rồi trang nội dung. Nếu cắt bằng limit thì
  // phần được hỏi là phần quan trọng nhất, không phải phần đứng đầu bảng
  // chữ cái.
  const depth = (u: string) => new URL(u).pathname.split("/").filter(Boolean).length;
  const urls = [...sitemap.urls].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  const targets = Number.isFinite(limit) ? urls.slice(0, limit) : urls;

  console.log(`${site.url} — hỏi Google ${targets.length}/${urls.length} URL trong sitemap\n`);
  const token = await getGoogleAccessToken(["https://www.googleapis.com/auth/webmasters.readonly"]);

  const results: Inspection[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = await Promise.all(targets.slice(i, i + CONCURRENCY).map((u) => inspect(token, site.gscPropertyUrl, u)));
    results.push(...batch);
    if ((i + CONCURRENCY) % 40 === 0 || i + CONCURRENCY >= targets.length) {
      process.stdout.write(`  …${Math.min(i + CONCURRENCY, targets.length)}/${targets.length}\r`);
    }
  }
  console.log(" ".repeat(40) + "\r");

  const byState = new Map<string, Inspection[]>();
  for (const r of results) {
    const k = `${r.verdict} · ${r.coverageState}`;
    byState.set(k, [...(byState.get(k) ?? []), r]);
  }

  console.log("trạng thái                                         số URL");
  for (const [k, v] of [...byState].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${k.padEnd(48)} ${String(v.length).padStart(5)}`);
  }

  const indexed = results.filter((r) => r.verdict === "PASS");
  console.log(`\nĐÃ INDEX: ${indexed.length}/${results.length}`);
  for (const r of indexed.slice(0, 20)) {
    console.log(`  ✓ ${new URL(r.url).pathname}${r.lastCrawl ? `  (crawl ${r.lastCrawl.slice(0, 10)})` : ""}`);
  }
  if (indexed.length > 20) console.log(`  … và ${indexed.length - 20} URL nữa`);

  // Đã crawl mà chưa index là trạng thái KHÁC hẳn chưa crawl: Google đã đọc
  // trang rồi quyết định không đưa vào. Thêm liên kết hay ép index không
  // chữa được nó — nội dung mới chữa được.
  const crawledNotIndexed = results.filter((r) => r.verdict !== "PASS" && r.lastCrawl);
  console.log(`\nđã crawl nhưng CHƯA index: ${crawledNotIndexed.length}  ← nhóm đáng đọc nhất`);
  for (const r of crawledNotIndexed) {
    console.log(`  · ${new URL(r.url).pathname.padEnd(46)} crawl ${r.lastCrawl!.slice(0, 10)}`);
  }

  // "URL is unknown to Google" cho một URL CÓ trong sitemap là mâu thuẫn
  // đáng chú ý: sitemap đã nộp và đã xử lý, nhưng Google chưa ghi nhận URL
  // này. Thường là chưa tới lượt; nếu tụ lại theo một hình dạng đường dẫn
  // thì lại là chuyện khác.
  const unknown = results.filter((r) => r.coverageState.includes("unknown"));
  if (unknown.length > 0) {
    console.log(`\nGoogle CHƯA BIẾT tới: ${unknown.length} (dù có trong sitemap)`);
    const bySeg = new Map<string, number>();
    for (const u of unknown) {
      const seg = new URL(u.url).pathname.split("/").filter(Boolean).slice(0, 2).join("/");
      bySeg.set(seg, (bySeg.get(seg) ?? 0) + 1);
    }
    for (const [k, v] of [...bySeg].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  /${k.padEnd(40)} ${v}`);
  }

  const neverCrawled = results.filter((r) => r.verdict !== "PASS" && !r.lastCrawl && r.verdict !== "ERROR");
  console.log(`\nchưa từng crawl:           ${neverCrawled.length}`);
  const errors = results.filter((r) => r.verdict === "ERROR");
  if (errors.length > 0) {
    console.log(`\n⚠ ${errors.length} URL KHÔNG hỏi được — không phải "chưa index", là chưa biết:`);
    for (const e of errors.slice(0, 5)) console.log(`   ${new URL(e.url).pathname} — ${e.coverageState}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  if (reportSiteError(err) || reportArgError(err)) return;
  throw err;
});
