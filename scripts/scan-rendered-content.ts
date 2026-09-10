// Quét NỘI DUNG ĐÃ PUBLISH của một publisher — HTML mà người đọc và Googlebot
// thật sự nhận — thay vì chuỗi văn bản trước khi nó được render.
//
// TẠI SAO CẦN THÊM MỘT BỘ QUÉT NỮA
//
// scripts/scan-generated-copy.ts quét các generation đã lưu trong DB của HQ.
// lib/ai/validate.ts chạy trên chuỗi model vừa trả về. lib/ai/generate.ts mang
// luật trong prompt. Cả ba đều soi cùng một thứ: VĂN DO MODEL SINH.
//
// Nhưng một trang publish ra không chỉ có văn model sinh. Phần lớn nó là
// TEMPLATE — câu do code của site viết, nối quanh các con số. Văn template
// không đi qua model, nên không đi qua bất cứ chỗ nào biết tới luật.
//
// Đo được trên atmovingservices.com ngày 2026-09-10, crawl toàn bộ 192 URL
// trong sitemap: 368 câu vi phạm no-supply-side-bridge, thuộc 9 template, lặp
// 127/97/57/44/16/13/12 lần. Không câu nào từng đi qua validateGeneratedText().
// Nguyên văn một câu, xuất hiện y hệt trên 97 trang:
//
//   "Most moves into Duluth, GA started nearby, which is local-crew work:
//    hourly rates, same-day jobs, and no long-haul logistics."
//
// Rule 9 trong lib/ai/generate.ts cấm đúng hình dạng đó bằng chữ. Luật không
// hở vì thiếu vector — nó hở vì đối tượng nó soi không phải thứ được publish.
//
// HQ KIỂM ĐƯỢC TỪ XA
//
// Cùng mô hình lib/publisher/required-pages.ts: nội dung này công khai, nên HQ
// chỉ cần HỎI site. Publisher mới thừa hưởng phép kiểm mà không phải cài gì, và
// không thể quên một phép kiểm nó chưa từng phải viết.
//
// Usage:
//   tsx scripts/scan-rendered-content.ts https://atmovingservices.com moving-services
//   tsx scripts/scan-rendered-content.ts https://atmovingservices.com moving-services --sample 40
//   tsx scripts/scan-rendered-content.ts --self-test moving-services
//   tsx scripts/scan-rendered-content.ts --from-dir ./crawl moving-services
//
// Exit 1 khi có câu bị bắt, hoặc khi tự kiểm thất bại.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { patternsFor, type Pattern } from "../lib/content-rules/copy-patterns";
import {
  isSupplySideBridge,
  findScopeCountMismatches,
  runVectors,
  runScopeVectors,
  proveSupplyBridgeBranches,
  proveScopeBranches,
  SUPPLY_BRIDGE_VECTORS,
  SCOPE_COUNT_VECTORS,
} from "../lib/content-rules/rendered-rules";
import { REQUIRED_PAGES } from "../lib/content-rules/registry";

/**
 * Cloudflare trả một tài liệu KHÁC cho `Accept: * / *` so với `Accept: text/html`
 * (đo 2026-09-10 ở lib/publisher/required-pages.ts: 28.309 vs 28.676 byte).
 * Quét một tài liệu không trình duyệt nào nhận được thì kết luận nói về một
 * trang không ai đọc.
 */
const BROWSER_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent": "Mozilla/5.0 (compatible; HQ-ContentQC/1)",
};

function assertScannerWorks(): boolean {
  const results = runVectors();
  const failed = results.filter((r) => !r.ok);

  console.log(`Tự kiểm luật rendered-supply-side-bridge — ${SUPPLY_BRIDGE_VECTORS.length} vector:`);
  for (const r of results) {
    console.log(`  ${r.ok ? "OK  " : "SAI "} mong ${r.expect}, được ${r.got}  "${r.text.slice(0, 84)}…"`);
  }

  const rejects = results.filter((r) => r.expect === "reject").length;
  const accepts = results.filter((r) => r.expect === "accept").length;
  if (rejects === 0 || accepts === 0) {
    console.error(`\nBộ vector MỘT CHIỀU (${rejects} reject / ${accepts} accept) — không phát hiện được một luật bắt mọi thứ hoặc không bắt gì.`);
    return false;
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length}/${results.length} vector SAI. Số liệu quét bên dưới không dùng được cho tới khi luật khớp lại.`);
    return false;
  }

  // Bằng chứng nhánh được ép chạy nằm ở lib/content-rules/rendered-rules.ts,
  // để registry cũng chạy được nó chứ không phải đọc mô tả rằng nó từng chạy.
  const proofs = proveSupplyBridgeBranches();
  const silent = proofs.filter((p) => p.vectorsChanged === 0).map((p) => p.branch);
  if (silent.length > 0) {
    console.error(
      `\nNhánh KHÔNG được ca nào ép chạy: ${silent.join(", ")}.\n` +
        `Xoá nhánh đó đi mà cả ${results.length} vector vẫn ra y hệt — nó đang là code chết trong bộ vector này.\n` +
        `Thêm một câu mà CHỈ nhánh đó cứu được, trước khi tin phần thu hẹp có thật.`
    );
    return false;
  }

  console.log(
    `\nCả ${results.length} vector khớp (${rejects} reject / ${accepts} accept).\n` +
      `Đột biến: ${proofs.map((p) => `vô hiệu ${p.branch} làm ${p.vectorsChanged} vector đổi kết quả`).join("; ")} — cả hai nhánh thu hẹp đều chạy thật.`
  );

  return assertScopeRuleWorks();
}

/** Tự kiểm luật hai, cùng kỷ luật: hai chiều, verdict đo, và ép từng nhánh nổ. */
function assertScopeRuleWorks(): boolean {
  const results = runScopeVectors();
  console.log(`\nTự kiểm luật cluster-scope-count-mismatch — ${SCOPE_COUNT_VECTORS.length} vector:`);
  for (const r of results) {
    console.log(`  ${r.ok ? "OK  " : "SAI "} mong ${r.expect}, được ${r.got}  [${r.label}]`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length}/${results.length} vector SAI.`);
    return false;
  }

  const proofs = proveScopeBranches();
  const silent = proofs.filter((p) => p.vectorsChanged === 0);
  if (silent.length > 0) {
    console.error(
      `\nNhánh không được ép chạy: ${silent.map((p) => p.branch).join(", ")}.\n` +
        `Nhánh nào 0 ca đổi là nhánh có thể xoá mà cả bộ vector vẫn xanh.`
    );
    return false;
  }

  const rejects = results.filter((r) => r.expect === "reject").length;
  console.log(
    `\nCả ${results.length} vector khớp (${rejects} reject / ${results.length - rejects} accept).\n` +
      `Đột biến: ${proofs.map((p) => `${p.branch} -> ${p.vectorsChanged} vector đổi`).join("; ")} — cả hai nhánh đều chạy thật.`
  );
  return true;
}

// ---------------------------------------------------------------------------
// Trích văn bản người đọc thật sự thấy
// ---------------------------------------------------------------------------

function visibleSentences(html: string): string[] {
  const main = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  let body = main ? main[1] : html;
  body = body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  // Đóng khối thành dấu chấm: không có bước này, một tiêu đề dính liền câu đầu
  // của đoạn sau nó và tạo ra một "câu" chưa từng tồn tại trên trang.
  body = body.replace(/<\/(p|li|h[1-6]|td|div|section)>/gi, ". ");
  body = body.replace(/<[^>]+>/g, " ");
  body = body
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return body
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Gom theo TEMPLATE, không theo trang.
 *
 * Trên một site pSEO, một câu template sai xuất hiện trên hàng trăm trang. Báo
 * "368 câu trên 127 trang" nghe như 368 việc phải làm; sự thật là 9. Con số
 * hành động được là số template, và số trang là mức độ lan.
 */
function templateKey(sentence: string): string {
  return sentence
    .replace(/[\d][\d,.]*%?/g, "N")
    .replace(/\b[A-Z][a-z]+(?:[ -][A-Z][a-z]+)*,?\s?(?:[A-Z]{2})?\b/g, "PLACE")
    .slice(0, 160);
}

interface Hit {
  rule: string;
  why: string;
  /** Mẫu mà HQ khai là CHỈ ĐỂ NGƯỜI XEM khi chạy trên văn đã render
   * (`Pattern.advisoryOnRendered`). Không tính vào exit code. */
  advisory: boolean;
  template: string;
  example: string;
  pages: Set<string>;
  sentences: number;
}

/**
 * Miễn trừ theo ĐƯỜNG DẪN, đọc từ hợp đồng chứ không tự suy.
 *
 * `stay-in-trade` (mẫu `off_trade` cài đặt nó) cấm hứa bảo hành, còn trang điều
 * khoản BẮT BUỘC phải từ chối bảo hành — và chính `requiredPages` đòi site có
 * trang đó. Đo được trên atmovingservices: tiêu đề "No warranty" ở /terms bị
 * tính là lạc nghề. Danh sách đường dẫn lấy thẳng từ REQUIRED_PAGES, không chép:
 * chép là bản thứ hai, và nó sẽ trôi lệch lần đầu ai đó thêm một trang bắt buộc.
 */
const PATTERN_TO_CONTRACT_RULE: Record<string, string> = { off_trade: "stay-in-trade" };
const EXEMPT_PATHS = new Set(REQUIRED_PAGES.flatMap((p) => p.paths));

function isExempt(patternName: string, url: string): boolean {
  if (PATTERN_TO_CONTRACT_RULE[patternName] !== "stay-in-trade") return false;
  const path = url.startsWith("http") ? new URL(url).pathname : "/" + url.replace(/\.html$/, "").replace(/__/g, "/");
  return EXEMPT_PATHS.has(path.replace(/\/+$/, "") || "/");
}

function scan(pages: { url: string; html: string }[], patterns: Pattern[]): Hit[] {
  const hits = new Map<string, Hit>();
  const record = (rule: string, why: string, url: string, sentence: string, advisory = false) => {
    const key = `${rule}::${templateKey(sentence)}`;
    const hit = hits.get(key) ?? { rule, why, advisory, template: templateKey(sentence), example: sentence, pages: new Set<string>(), sentences: 0 };
    hit.pages.add(url);
    hit.sentences += 1;
    hits.set(key, hit);
  };

  for (const page of pages) {
    // Luật cấp TRANG, chạy trước: hai vế của mâu thuẫn nằm ở hai đoạn cách
    // nhau, nên vòng lặp theo câu bên dưới không thể thấy nó.
    const sentences = visibleSentences(page.html);
    for (const m of findScopeCountMismatches(sentences.join(" "))) {
      record(
        "cluster-scope-count-mismatch",
        "Một con số dẫn xuất khai SAI số lượng geography góp vào nó. Mệnh đề phạm vi là thứ duy nhất cho người đọc kiểm được con số, và trang tự mâu thuẫn với chính nó.",
        page.url,
        `trang tự khai ${m.declared} county, con số dẫn xuất nói "${m.phrase}"`
      );
    }

    for (const sentence of sentences) {
      if (isSupplySideBridge(sentence)) {
        record("rendered-supply-side-bridge", "Treo một khẳng định về công việc hoặc bên cung lên một đại lượng đo. Không nguồn nào trong dataset đo phía cung.", page.url, sentence);
      }
      // Các mẫu đã có, chạy trên văn ĐÃ RENDER thay vì trên generation trong DB.
      for (const p of patterns) {
        if (!p.test.test(sentence)) continue;
        if (isExempt(p.name, page.url)) continue;
        record(p.name, p.why, page.url, sentence, p.advisoryOnRendered === true);
      }
    }
  }
  return [...hits.values()].sort((a, b) => b.pages.size - a.pages.size);
}

// ---------------------------------------------------------------------------

async function fetchSitemapUrls(origin: string): Promise<string[]> {
  const res = await fetch(`${origin}/sitemap.xml`, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`sitemap.xml trả HTTP ${res.status} — không có danh sách trang để quét.`);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

/** Mẫu trải đều theo thứ tự sitemap, không phải N trang đầu: trang đầu sitemap
 * thường là trang tĩnh, và một mẫu toàn trang tĩnh không nói gì về 158 trang
 * pSEO phía sau. */
function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]);
}

async function main() {
  const args = process.argv.slice(2);
  const selfTestOnly = args.includes("--self-test");
  const fromDirIdx = args.indexOf("--from-dir");
  const sampleIdx = args.indexOf("--sample");
  const sample = sampleIdx >= 0 ? Number(args[sampleIdx + 1]) : 60;
  const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--sample" && args[i - 1] !== "--from-dir");
  const vertical = positional[positional.length - 1];

  if (!vertical) {
    console.error("Cách dùng: tsx scripts/scan-rendered-content.ts <url|--from-dir DIR|--self-test> <vertical>");
    process.exitCode = 1;
    return;
  }

  if (!assertScannerWorks()) {
    process.exitCode = 1;
    return;
  }
  if (selfTestOnly) return;

  const patterns = patternsFor(vertical);

  let pages: { url: string; html: string }[];
  if (fromDirIdx >= 0) {
    const dir = args[fromDirIdx + 1];
    pages = readdirSync(dir)
      .filter((f) => f.endsWith(".html"))
      .map((f) => ({ url: f, html: readFileSync(join(dir, f), "utf8") }));
    console.log(`\nQuét ${pages.length} trang đã tải sẵn từ ${dir}\n`);
  } else {
    const origin = positional[0]?.replace(/\/+$/, "");
    if (!origin?.startsWith("http")) {
      console.error("Thiếu URL site (hoặc --from-dir).");
      process.exitCode = 1;
      return;
    }
    const urls = spread(await fetchSitemapUrls(origin), sample);
    console.log(`\nTải ${urls.length} trang (mẫu trải đều trên sitemap)…`);
    pages = [];
    for (const url of urls) {
      const res = await fetch(url, { headers: BROWSER_HEADERS });
      if (res.ok) pages.push({ url, html: await res.text() });
    }
    console.log(`Tải được ${pages.length}/${urls.length}\n`);
  }

  const hits = scan(pages, patterns);
  if (hits.length === 0) {
    console.log(`Không câu nào bị bắt trên ${pages.length} trang.`);
    return;
  }

  const byRule = new Map<string, Hit[]>();
  for (const h of hits) byRule.set(h.rule, [...(byRule.get(h.rule) ?? []), h]);

  const show = (title: string, entries: [string, Hit[]][]) => {
    if (entries.length === 0) return;
    console.log(`${title}\n`);
    for (const [rule, rows] of entries) {
      const pages_ = new Set(rows.flatMap((r) => [...r.pages]));
      const sentences = rows.reduce((n, r) => n + r.sentences, 0);
      console.log(`### ${rule} — ${rows.length} template, ${sentences} câu, ${pages_.size} trang`);
      console.log(`    ${rows[0].why}`);
      for (const r of rows.slice(0, 8)) console.log(`    [${r.pages.size} trang] "${r.example.slice(0, 150)}"`);
      if (rows.length > 8) console.log(`    … và ${rows.length - 8} template nữa`);
      console.log();
    }
  };

  const entries = [...byRule.entries()];
  const gating = entries.filter(([, rows]) => !rows[0].advisory);
  const advisory = entries.filter(([, rows]) => rows[0].advisory);

  show("== VI PHẠM ==", gating);
  // Tách riêng, và tách vì một lý do đo được: 32 câu migration_bridge trên văn
  // render phần lớn là câu giải thích phương pháp, đúng và minh bạch. Một bộ
  // quét báo chúng như vi phạm sẽ dạy người đọc lướt, và lướt là cách cái thật
  // bị bỏ sót. HQ công bố điều đó thành dữ liệu (`Pattern.advisoryOnRendered`)
  // thay vì để mỗi scanner tự nghĩ ra ngưỡng của riêng mình.
  show("== CẦN NGƯỜI XEM (HQ khai advisoryOnRendered — không tính vào exit code) ==", advisory);

  const gatingPages = new Set(gating.flatMap(([, rows]) => rows.flatMap((r) => [...r.pages]))).size;
  const gatingTemplates = gating.reduce((n, [, rows]) => n + rows.length, 0);
  const advisoryTemplates = advisory.reduce((n, [, rows]) => n + rows.length, 0);
  console.log(
    `=== ${gatingTemplates} template VI PHẠM, lan ra ${gatingPages}/${pages.length} trang đã quét` +
      (advisoryTemplates > 0 ? ` · ${advisoryTemplates} template cần người xem` : "") +
      ` ===\n` +
      `Số phải sửa là số TEMPLATE, không phải số trang: một câu trong code site lặp trên hàng trăm URL.`
  );
  if (gatingTemplates === 0) return;
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
