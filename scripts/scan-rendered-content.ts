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
// trong sitemap: 369 câu vi phạm no-supply-side-bridge, thuộc 7 template, lặp
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

// ---------------------------------------------------------------------------
// Luật mới: supply-side bridge trong văn ĐÃ RENDER
// ---------------------------------------------------------------------------

/**
 * Ba mảnh, và mảnh thứ ba là mảnh quan trọng nhất.
 *
 * ANTECEDENT — câu phải treo hệ quả lên một ĐẠI LƯỢNG ĐO. Không có mảnh này,
 * "the disagreement is the signal, and working out why is this end's job" trên
 * trang /data bị bắt: một câu về quy trình nội bộ, không hề nói về thị trường.
 * Đó là một câu, trên 369 — nhưng một cảnh báo sai là thứ dạy người đọc lướt
 * qua, và lướt qua là cách cái thật bị bỏ sót.
 *
 * SUPPLY — hệ quả phải KHẲNG ĐỊNH về phía cung. Cố tình không nhận `work` hay
 * `crew` trần: "moves involve rented apartments" nói về người thuê nhà, không
 * nói về bên cung, và rule 8 cho phép nó như một phép trừ số học.
 *
 * ADVICE — lối thoát mà rule 8 nêu đích danh. "Homes date from 1966, so ask how
 * the crew protects narrow stairways" là lời khuyên gắn vào một dữ kiện, không
 * khẳng định gì về thị trường. Quét TOÀN CÂU chứ không chỉ phần sau connector:
 * "When you call for quotes, say plainly which distance applies — ... so the
 * estimate should match the job" mở đầu bằng lời khuyên và kết thúc bằng chữ
 * "job", và cắt câu ở connector sẽ bắt nhầm đúng nó.
 *
 * Đây KHÔNG phải mở rộng của migration_bridge trong copy-patterns.ts. Cái kia
 * cố ý chỉ soi số DI CƯ, đúng phạm vi rule 9 cấm tuyệt đối, và đã bị thu hẹp
 * một lần sau khi nó báo nhầm một câu rule 8 cho phép. Luật này soi hình dạng
 * "đại lượng đo → khẳng định về công việc/bên cung" trên mọi loại figure, và
 * chỉ chạy trên văn đã render — nơi cái kia không bao giờ nhìn tới.
 */
const ANTECEDENT =
  /(?:\d|\b(?:most|majority|more\s+\w+\s+than|close\s+to\s+even|typical|median|rate|balance|arrivals?|departures?|moves?|migration)\b)/i;

const CONNECTOR =
  /(?:\b(?:so|therefore|meaning|that\s+means)\b|\bwhich\s+(?:is|means|in\s+practice\s+means)\b|—)/i;

const SUPPLY_ASSERTION = new RegExp(
  [
    String.raw`\b(?:jobs?|workload|logistics|bookings?|capacity)\b`,
    String.raw`\bdemand\s+(?:splits?|is|runs?|means)\b`,
    String.raw`\b(?:hourly|flat)\s+rates?\b`,
    String.raw`\bcrews?\s+(?:is|are|work\w*|handles?)\b`,
    String.raw`\b(?:movers?|companies|providers?|contractors?)\s+(?:here\s+|locally\s+)?(?:handle|are|tend|book|charge|do)\b`,
    String.raw`\b(?:inbound|outbound)\s+work\b`,
  ].join("|"),
  "i"
);

const READER_ADVICE =
  /\b(?:ask|asking|confirm|check|point\s+out|mention|mentioning|say|tell|walk|compare|call|calling|choose|worth\s+\w+ing|if\s+that\s+applies|when\s+you|your\s+move|leave\s+the\s+number)\b/i;

/** Toàn bộ luật, ở dạng một vị ngữ máy chạy được trên MỘT câu. */
export function isSupplySideBridge(sentence: string): boolean {
  if (READER_ADVICE.test(sentence)) return false;

  const conn = CONNECTOR.exec(sentence);
  if (!conn) return false;

  const antecedent = sentence.slice(0, conn.index);
  if (!ANTECEDENT.test(antecedent)) return false;

  const consequent = sentence.slice(conn.index, conn.index + 200);
  return SUPPLY_ASSERTION.test(consequent);
}

// ---------------------------------------------------------------------------
// Vector — verdict ĐO bằng cách chạy hàm trên, không phải khai bằng tay
// ---------------------------------------------------------------------------

/**
 * Mọi câu ở đây là NGUYÊN VĂN từ atmovingservices.com, crawl 2026-09-10. Không
 * câu nào được viết ra để test.
 *
 * `expect` là điều luật PHẢI kết luận. Chương trình chạy vector và so — nó
 * không ghi lại kết luận của chính nó rồi gọi đó là kết quả.
 */
export const SUPPLY_BRIDGE_VECTORS: { expect: "reject" | "accept"; text: string; why: string }[] = [
  {
    expect: "reject",
    text: "Most moves into Duluth, GA started nearby, which is local-crew work: hourly rates, same-day jobs, and no long-haul logistics.",
    why: "97 trang. Từ 'phần lớn cuộc chuyển nhà đến từ gần' suy ra loại công việc VÀ cách tính tiền của bên cung. Không nguồn nào trong dataset đo cả hai.",
  },
  {
    expect: "reject",
    text: "The balance is -3,389 households a year — more households leave than arrive, which in practice means more long-distance and out-of-state jobs than a purely local market would see.",
    why: "57 trang. 'which in practice means' + khẳng định so sánh khối lượng việc với một thị trường giả định.",
  },
  {
    expect: "reject",
    text: "The balance is 687 households a year — more people move into this area than out of it, so local movers here handle a steady flow of inbound jobs alongside local ones.",
    why: "44 trang. Nói thẳng công ty ở đây làm gì. Đây là câu duy nhất trong bốn câu mà supply_side_claim của copy-patterns.ts cũng bắt được.",
  },
  {
    expect: "reject",
    text: "Arrivals and departures are close to even at 647 households a year, so demand splits between inbound and outbound work.",
    why: "25 trang. 'demand splits' — một khẳng định về cầu của thị trường lao động, suy từ số hộ khai thuế.",
  },
  {
    expect: "reject",
    text: "The typical home in 78666 dates to 1997, which is what decides whether a crew is working around stairs, narrow stairwells and no elevator, or a modern layout with a driveway to park in.",
    why: "127 trang — nhiều nhất. Rule 8 nêu ĐÍCH DANH biến thể hợp lệ của câu này: 'Homes date from 1966, so ASK how the crew protects narrow stairways'. Bỏ chữ 'ask' đi thì lời khuyên thành khẳng định về điều kiện làm việc, và năm xây nhà không quyết định được điều đó.",
  },
  {
    expect: "accept",
    text: "The typical home here was built around 1940, so when you walk the job with an estimator, point out narrow staircases, tight doorways and street parking constraints and ask how the crew will protect them.",
    why: "Lời khuyên cho người đọc gắn vào một dữ kiện — rule 8 cho phép. Cùng con số, cùng chữ 'crew', khác ở chỗ nó không khẳng định gì về thị trường.",
  },
  {
    expect: "accept",
    text: "The homeownership rate here is 38.4%, so the majority of households are renting — worth mentioning when you call for quotes, since apartment and student-housing moves often involve stair carries, elevator reservations and longer walks.",
    why: "Phép trừ số học rồi tới lời khuyên. Rule 8 nêu đích danh hình dạng này là hợp lệ.",
  },
  {
    expect: "accept",
    text: "When you call for quotes, say plainly which of those distances applies to you — a crosstown move within the county and an out-of-state haul are priced and scheduled in different ways, so the estimate should match the job.",
    why: "Kết thúc bằng chữ 'job' ngay sau 'so'. Cắt câu ở connector rồi mới xét sẽ bắt nhầm đúng câu này — nên phần miễn trừ phải quét TOÀN CÂU.",
  },
  {
    expect: "accept",
    text: "Rather than generate a plausible-looking range, these pages publish the local conditions a quote is actually built from — housing age, stairs versus lift access, owner-occupied versus rental — and leave the number to the companies that can actually see your belongings.",
    why: "Câu TỪ CHỐI nêu giá, tức là luật no-price-claims đang chạy đúng. Một bộ quét bắt cả câu này sẽ dạy người đọc bỏ qua nó.",
  },
  {
    expect: "accept",
    text: "No explanation needed — the disagreement is the signal, and working out why is this end's job.",
    why: "Câu về quy trình nội bộ trên /data, không nói gì về thị trường. Có dấu gạch dài và chữ 'job', và CHỈ nhánh ANTECEDENT cứu nó — không nhánh nào khác thấy nó khác gì một khẳng định về công việc.",
  },
];

interface VectorResult {
  expect: string;
  got: string;
  ok: boolean;
  text: string;
  why: string;
}

export function runVectors(): VectorResult[] {
  return SUPPLY_BRIDGE_VECTORS.map((v) => {
    const got = isSupplySideBridge(v.text) ? "reject" : "accept";
    return { expect: v.expect, got, ok: got === v.expect, text: v.text, why: v.why };
  });
}

/**
 * Tự kiểm, và một điều kiện mà "9/9 vector xanh" KHÔNG chứng minh được.
 *
 * HQ trả bằng máu hôm nay: có ca test cho một nhánh, xoá nhánh đi mà cả bộ vẫn
 * xanh. Ở đây nhánh dễ chết lặng nhất là READER_ADVICE — nếu nó biến mất, luật
 * chỉ đơn giản bắt nhiều hơn, và mọi vector `reject` vẫn xanh y nguyên.
 *
 * Nên bộ vector phải chứa ít nhất một ca mà CHỈ nhánh đó cứu. Kiểm bằng cách
 * chạy lại vector với nhánh bị vô hiệu và đòi hỏi có ca đổi kết quả — tức là ép
 * nhánh nổ, chứ không đọc code rồi tin là nó có chạy.
 */
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

  // Đột biến, một nhánh mỗi lần: vô hiệu hoá nhánh rồi đòi hỏi có vector đổi
  // kết quả. Nhánh nào không làm vector nào đổi là nhánh mà bộ vector này chưa
  // bao giờ chạy tới — và một nhánh như thế có thể bị xoá mà cả bộ vẫn xanh.
  //
  // Chỉ đột biến hai nhánh THU HẸP (ANTECEDENT, READER_ADVICE). SUPPLY_ASSERTION
  // là nhánh MỞ RỘNG: vô hiệu nó thì không có gì bị bắt nữa, nên mọi vector
  // reject đổi kết quả và phép thử luôn xanh mà không chứng minh điều gì.
  const silent: string[] = [];
  const rescued = new Map<string, number>();
  for (const [name, re] of [["ANTECEDENT", ANTECEDENT], ["READER_ADVICE", READER_ADVICE]] as const) {
    const saved = re.test.bind(re);
    (re as unknown as { test: (s: string) => boolean }).test = name === "READER_ADVICE" ? () => false : () => true;
    const mutated = runVectors();
    (re as unknown as { test: (s: string) => boolean }).test = saved;

    const changed = mutated.filter((r, i) => r.got !== results[i].got).length;
    rescued.set(name, changed);
    if (changed === 0) silent.push(name);
  }

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
      `Đột biến: ${[...rescued].map(([n, c]) => `vô hiệu ${n} làm ${c} vector đổi kết quả`).join("; ")} — cả hai nhánh thu hẹp đều chạy thật.`
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
 * "369 câu trên 158 trang" nghe như 369 việc phải làm; sự thật là 7. Con số
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
  template: string;
  example: string;
  pages: Set<string>;
  sentences: number;
}

function scan(pages: { url: string; html: string }[], patterns: Pattern[]): Hit[] {
  const hits = new Map<string, Hit>();
  const record = (rule: string, why: string, url: string, sentence: string) => {
    const key = `${rule}::${templateKey(sentence)}`;
    const hit = hits.get(key) ?? { rule, why, template: templateKey(sentence), example: sentence, pages: new Set<string>(), sentences: 0 };
    hit.pages.add(url);
    hit.sentences += 1;
    hits.set(key, hit);
  };

  for (const page of pages) {
    for (const sentence of visibleSentences(page.html)) {
      if (isSupplySideBridge(sentence)) {
        record("rendered-supply-side-bridge", "Treo một khẳng định về công việc hoặc bên cung lên một đại lượng đo. Không nguồn nào trong dataset đo phía cung.", page.url, sentence);
      }
      // Các mẫu đã có, chạy trên văn ĐÃ RENDER thay vì trên generation trong DB.
      for (const p of patterns) {
        if (p.test.test(sentence)) record(p.name, p.why, page.url, sentence);
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

  for (const [rule, rows] of byRule) {
    const pages_ = new Set(rows.flatMap((r) => [...r.pages]));
    const sentences = rows.reduce((n, r) => n + r.sentences, 0);
    console.log(`### ${rule} — ${rows.length} template, ${sentences} câu, ${pages_.size} trang`);
    console.log(`    ${rows[0].why}`);
    for (const r of rows.slice(0, 8)) console.log(`    [${r.pages.size} trang] "${r.example.slice(0, 150)}"`);
    if (rows.length > 8) console.log(`    … và ${rows.length - 8} template nữa`);
    console.log();
  }

  const totalPages = new Set(hits.flatMap((h) => [...h.pages])).size;
  console.log(
    `=== ${hits.length} template bị bắt, lan ra ${totalPages}/${pages.length} trang đã quét ===\n` +
      `Số phải sửa là số TEMPLATE, không phải số trang: một câu trong code site lặp trên hàng trăm URL.`
  );
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
