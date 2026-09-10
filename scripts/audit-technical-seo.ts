// Đo Technical SEO của một publisher đang chạy, từ BÊN NGOÀI.
//
// TẠI SAO LÀ SCRIPT, KHÔNG PHẢI CHECKLIST
//
// Một checklist Technical SEO viết bằng văn xuôi sẽ được thực hiện lại ở mỗi
// site, và hai lần thực hiện đó trôi lệch mà không ai thấy — đúng lý do
// lib/content-rules/registry.ts tồn tại. Khác biệt là luật nội dung PHẢI chạy
// trong build của publisher (chỉ build mới thấy văn bản trước khi nó lên
// sóng), còn mọi thứ ở đây đều nằm trong HTML công khai. Head Quarter chỉ cần
// HỎI site. Nên publisher mới thừa hưởng phép kiểm mà không phải viết gì, và
// không thể quên một phép kiểm nó chưa từng phải cài — cùng mô hình
// lib/publisher/required-pages.ts đã dùng.
//
// MỌI KẾT LUẬN Ở ĐÂY LÀ ĐO ĐƯỢC. Script không khẳng định "site nên có
// canonical"; nó tải trang, tìm thẻ, và in ra thứ nó thấy. Một phát hiện không
// tái lập được bằng lệnh này thì không nên nằm trong tài liệu bàn giao.
//
// Usage:
//   tsx scripts/audit-technical-seo.ts https://atmovingservices.com
//   tsx scripts/audit-technical-seo.ts https://atmovingservices.com --sample 60 --json out.json
//
// Exit code 1 nếu có bất kỳ finding severity "error" — để CI của publisher có
// thể gọi thẳng script này làm cổng chặn deploy.

interface Finding {
  id: string;
  severity: "error" | "warning" | "info";
  where: string;
  /** Điều đo được, kèm con số. Không có câu nào ở đây được viết mà không có bằng chứng đi kèm. */
  detail: string;
  /** Vì sao nó là vấn đề. Thiếu phần này thì finding chỉ là một dòng log. */
  why: string;
}

const findings: Finding[] = [];
const add = (f: Finding) => findings.push(f);

/**
 * Cloudflare trả một tài liệu KHÁC cho `Accept: * / *` so với `Accept: text/html`
 * (đo 2026-09-10 ở lib/publisher/required-pages.ts: 28.309 vs 28.676 byte).
 * Kiểm một tài liệu không trình duyệt nào nhận được thì kết luận nói về một
 * trang không ai xem.
 */
const BROWSER_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent": "Mozilla/5.0 (compatible; HQ-TechnicalSEO-Audit/1)",
};

async function get(url: string, redirect: RequestRedirect = "manual") {
  const res = await fetch(url, { headers: BROWSER_HEADERS, redirect });
  const body = res.status === 200 ? await res.text() : "";
  return { status: res.status, location: res.headers.get("location"), headers: res.headers, body };
}

const attr = (html: string, re: RegExp): string | null => (html.match(re) ?? [])[1] ?? null;
const all = (html: string, re: RegExp): string[] => [...html.matchAll(re)].map((m) => m[1]);

/** Bỏ script/style trước khi lấy text: giá trị thô trong JSON-LD nằm trong
 * <script>, nên nếu không bỏ thì phép so "số này có hiển thị không" luôn đúng
 * và không kiểm được gì. */
const visibleText = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");

// ---------------------------------------------------------------- site level

async function auditOrigin(origin: string) {
  const host = new URL(origin).hostname;
  const apex = host.replace(/^www\./, "");

  // Một tài nguyên chỉ được phục vụ ở MỘT URL. Mỗi biến thể dưới đây là một
  // bản sao của trang chủ nếu nó trả 200 thay vì chuyển hướng.
  const variants: { url: string; expect: "redirect"; label: string }[] = [
    { url: `http://${apex}/`, expect: "redirect", label: "HTTP → HTTPS" },
    { url: `https://www.${apex}/`, expect: "redirect", label: "www → apex" },
  ];
  for (const v of variants) {
    try {
      const { status, location } = await get(v.url);
      if (status >= 300 && status < 400) {
        add({ id: "canonical-host", severity: "info", where: v.url, detail: `${status} → ${location}`, why: `${v.label} đã gom về một host.` });
      } else {
        add({
          id: "canonical-host",
          severity: "error",
          where: v.url,
          detail: `trả HTTP ${status}, không chuyển hướng`,
          why: "Cùng nội dung phục vụ ở hai host là hai bản sao. Google sẽ tự chọn một bản, và lựa chọn đó không do site quyết.",
        });
      }
    } catch (err) {
      add({ id: "canonical-host", severity: "warning", where: v.url, detail: String(err instanceof Error ? err.message : err).slice(0, 80), why: `Không kiểm được ${v.label}.` });
    }
  }

  // Một URL không tồn tại phải trả 404. Trả 200 kèm trang "không tìm thấy" là
  // soft 404: crawler tiêu ngân sách thu thập vào những trang rỗng vô hạn.
  const bogus = `${origin}/hq-audit-${Date.now().toString(36)}-does-not-exist`;
  const notFound = await get(bogus, "follow");
  add({
    id: "hard-404",
    severity: notFound.status === 404 ? "info" : "error",
    where: bogus,
    detail: `URL không tồn tại trả HTTP ${notFound.status}`,
    why: "404 mềm (200 kèm trang lỗi) khiến crawler coi mọi URL sai chính tả là một trang thật.",
  });

  // robots.txt
  const robots = await get(`${origin}/robots.txt`, "follow");
  if (robots.status !== 200) {
    add({ id: "robots", severity: "error", where: "/robots.txt", detail: `HTTP ${robots.status}`, why: "Không có robots.txt thì không khai báo được sitemap, và mọi quyết định thu thập là mặc định của crawler." });
  } else {
    const declaresSitemap = /^\s*sitemap:/im.test(robots.body);
    add({
      id: "robots-sitemap",
      severity: declaresSitemap ? "info" : "warning",
      where: "/robots.txt",
      detail: declaresSitemap ? robots.body.match(/^\s*sitemap:.*/im)![0].trim() : "không có dòng Sitemap:",
      why: "Sitemap khai trong robots.txt là đường duy nhất crawler tìm ra nó mà không cần ai submit tay.",
    });
    const blocked = all(robots.body, /^User-agent:\s*(.+)$/gim)
      .map((s) => s.trim())
      .filter((ua, i, arr) => arr.indexOf(ua) === i && ua !== "*");
    if (blocked.length > 0) {
      add({
        id: "robots-ai-bots",
        severity: "info",
        where: "/robots.txt",
        detail: `${blocked.length} user-agent được khai riêng: ${blocked.join(", ")}`,
        why: "Danh sách này thường do Cloudflare quản lý và bật mặc định. Nó là một QUYẾT ĐỊNH (site có muốn xuất hiện trong câu trả lời của AI không), không phải mặc định kỹ thuật — nên phải được chọn có ý thức, không phải thừa hưởng im lặng.",
      });
    }
  }

  // favicon: Google cần một icon để hiện cạnh kết quả tìm kiếm.
  const home = await get(`${origin}/`, "follow");
  const iconTag = /<link[^>]+rel="[^"]*icon[^"]*"/i.test(home.body);
  const iconFile = await get(`${origin}/favicon.ico`, "follow");
  if (!iconTag && iconFile.status !== 200) {
    add({
      id: "favicon",
      severity: "warning",
      where: "/favicon.ico",
      detail: `không có <link rel="icon"> trong HTML và /favicon.ico trả HTTP ${iconFile.status}`,
      why: "Google chỉ hiện favicon trong kết quả tìm kiếm nếu tìm được một cái. Không có thì mọi kết quả của site hiện icon mặc định — mất một tín hiệu nhận diện ở đúng nơi người dùng chọn click.",
    });
  }

  // Tham số truy vấn nhân bản mọi trang. Canonical là thứ gom chúng lại.
  const param = await get(`${origin}/?utm_source=hq-audit`, "follow");
  const paramCanonical = attr(param.body, /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i);
  if (param.status === 200 && !paramCanonical) {
    add({
      id: "canonical-missing",
      severity: "error",
      where: "/?utm_source=…",
      detail: "trang trả 200 và KHÔNG có thẻ canonical",
      why: "Mỗi tham số quảng cáo, mỗi link chia sẻ mang utm_* là một URL riêng cùng nội dung. Không có canonical thì không có gì gom chúng về một bản.",
    });
  }
  return home.body;
}

// ------------------------------------------------------------- sitemap

async function readSitemap(origin: string): Promise<{ urls: string[]; lastmods: string[]; withoutLastmod: string[] }> {
  const seen = new Set<string>();
  const queue = [`${origin}/sitemap.xml`];
  const urls: string[] = [];
  const lastmods: string[] = [];
  const withoutLastmod: string[] = [];

  while (queue.length > 0 && seen.size < 50) {
    const target = queue.shift()!;
    if (seen.has(target)) continue;
    seen.add(target);
    const { status, body } = await get(target, "follow");
    if (status !== 200) {
      add({ id: "sitemap", severity: "error", where: target, detail: `HTTP ${status}`, why: "Không đọc được sitemap thì không biết site đã nộp gì cho index." });
      continue;
    }
    // <sitemapindex> liệt kê sitemap, <urlset> liệt kê trang. Cả hai dùng <loc>,
    // nên thẻ BAO NGOÀI là thứ duy nhất phân biệt.
    if (/<sitemapindex[\s>]/i.test(body)) {
      queue.push(...all(body, /<loc>\s*([^<\s]+)\s*<\/loc>/gi));
      continue;
    }
    for (const block of body.match(/<url>[\s\S]*?<\/url>/gi) ?? []) {
      const loc = attr(block, /<loc>\s*([^<\s]+)\s*<\/loc>/i);
      if (!loc) continue;
      urls.push(loc);
      const lm = attr(block, /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i);
      if (lm) lastmods.push(lm);
      else withoutLastmod.push(loc);
    }
  }

  const distinct = new Set(lastmods);
  if (lastmods.length > 0 && distinct.size === 1 && urls.length > 1) {
    add({
      id: "sitemap-lastmod-uniform",
      severity: "warning",
      where: "/sitemap.xml",
      detail: `${lastmods.length}/${urls.length} URL dùng CHUNG một lastmod: ${[...distinct][0]}`,
      why: "Một lastmod giống hệt nhau ở mọi URL là dấu thời gian BUILD, không phải ngày trang đổi nội dung. Google nói rõ sẽ bỏ qua lastmod khi thấy nó không đáng tin — và bỏ qua theo cả site, kể cả những trang khai đúng.",
    });
  }
  if (withoutLastmod.length > 0) {
    add({
      id: "sitemap-lastmod-missing",
      severity: "info",
      where: "/sitemap.xml",
      detail: `${withoutLastmod.length} URL không có lastmod: ${withoutLastmod.slice(0, 6).join(", ")}`,
      why: "Không sai, nhưng lastmod có ở 98% URL rồi vắng ở vài URL là dấu hiệu hai đường sinh sitemap khác nhau — thứ sẽ lệch tiếp.",
    });
  }
  return { urls, lastmods, withoutLastmod };
}

// ------------------------------------------------------------- page level

interface PageFacts {
  url: string;
  status: number;
  html: string;
  jsonld: unknown[];
  internalLinks: string[];
}

async function readPage(url: string): Promise<PageFacts | null> {
  const { status, body } = await get(url, "follow");
  if (status !== 200) {
    add({ id: "sitemap-url-not-200", severity: "error", where: url, detail: `URL trong sitemap trả HTTP ${status}`, why: "Sitemap là danh sách site TỰ nộp. Một URL chết trong đó là site tự khai một trang không tồn tại." });
    return null;
  }
  const jsonld: unknown[] = [];
  for (const raw of all(body, /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      jsonld.push(JSON.parse(raw));
    } catch (err) {
      add({
        id: "jsonld-parse",
        severity: "error",
        where: url,
        detail: `khối JSON-LD không parse được: ${(err as Error).message.slice(0, 60)}`,
        why: "JSON-LD hỏng bị bỏ TOÀN BỘ khối, im lặng. Trang mất mọi structured data mà không có lỗi nào hiện ở đâu.",
      });
    }
  }
  return { url, status, html: body, jsonld, internalLinks: all(body, /<a[^>]+href="(\/[^"#]*)"/gi) };
}

/** Trải @graph ra phẳng để hỏi "trang này có node loại X không". */
const nodes = (jsonld: unknown[]): Record<string, any>[] =>
  jsonld.flatMap((j: any) => (Array.isArray(j) ? j : j?.["@graph"] ? j["@graph"] : [j])).filter(Boolean);

function auditPage(p: PageFacts) {
  const { url, html } = p;
  const path = new URL(url).pathname;

  const canonical = attr(html, /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i);
  if (!canonical) {
    add({ id: "canonical-missing", severity: "error", where: path, detail: "không có <link rel=\"canonical\">", why: "Trang không tự khai địa chỉ chính thức của mình. Mọi biến thể URL (tham số, slash, hoa/thường) trở thành ứng viên ngang nhau." });
  } else if (canonical.replace(/\/$/, "") !== url.replace(/\/$/, "")) {
    add({ id: "canonical-mismatch", severity: "warning", where: path, detail: `canonical trỏ ${canonical}`, why: "Canonical trỏ đi nơi khác nghĩa là trang tự xin đừng index chính nó. Đúng thì tốt, nhầm thì trang biến mất khỏi kết quả." });
  }

  const title = attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i)?.trim() ?? null;
  if (!title) add({ id: "title-missing", severity: "error", where: path, detail: "không có <title>", why: "Không có title thì Google tự viết một cái từ nội dung trang." });
  else if (title.length > 60)
    add({ id: "title-length", severity: "warning", where: path, detail: `title dài ${title.length} ký tự: "${title}"`, why: "Quá ~60 ký tự thì phần đuôi bị cắt trên SERP. Ở site này phần bị cắt hay là tên thương hiệu, nhưng khi tiêu đề dài hơn nữa thì thứ bị cắt là ĐỊA DANH — chính từ khoá của trang." });

  const desc = attr(html, /<meta[^>]+name="description"[^>]+content="([^"]*)"/i);
  if (!desc) add({ id: "description-missing", severity: "warning", where: path, detail: "không có meta description", why: "Google tự trích một đoạn, và đoạn đó thường không phải đoạn site muốn khoe." });
  else if (desc.length > 160) add({ id: "description-length", severity: "info", where: path, detail: `description dài ${desc.length} ký tự`, why: "Quá ~160 ký tự thì phần cuối bị cắt. Không phạt gì, nhưng câu chốt viết ở cuối sẽ không ai đọc." });

  const h1 = all(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi);
  if (h1.length !== 1) add({ id: "h1-count", severity: h1.length === 0 ? "error" : "warning", where: path, detail: `có ${h1.length} thẻ h1`, why: "Đúng một h1 là cách trang nói chủ đề chính của nó. Không có, hoặc có nhiều, đều bỏ ngỏ câu đó." });

  if (!attr(html, /<html[^>]*\slang="([^"]*)"/i)) add({ id: "html-lang", severity: "warning", where: path, detail: "thẻ <html> không có lang", why: "Không khai ngôn ngữ thì công cụ tìm kiếm và trình đọc màn hình phải đoán." });
  if (!attr(html, /<meta[^>]+name="viewport"[^>]+content="([^"]*)"/i)) add({ id: "viewport", severity: "error", where: path, detail: "không có meta viewport", why: "Không có viewport thì trang không đạt mobile-friendly, và index của Google là mobile-first." });

  const ns = nodes(p.jsonld);
  const types = new Set(ns.map((n) => n["@type"]).flat().filter(Boolean) as string[]);

  if (ns.length === 0) {
    add({ id: "jsonld-absent", severity: "warning", where: path, detail: "không có JSON-LD nào", why: "Không phải mọi trang đều cần schema riêng, nhưng Organization + WebSite có mặt ở mọi trang KHÁC của site. Một trang lẻ không có là dấu hiệu nó đi bằng đường render khác — và sẽ tiếp tục lệch." });
  } else {
    for (const required of ["Organization", "WebSite"]) {
      if (!types.has(required))
        add({ id: "jsonld-site-identity", severity: "warning", where: path, detail: `thiếu node ${required}`, why: "Danh tính site phải nhất quán ở mọi trang; thiếu ở một trang làm gãy chuỗi @id mà các node khác trỏ tới." });
    }
  }

  // Breadcrumb: kiểm CẤU TRÚC, vì lỗi hay gặp là position nhảy cóc hoặc thiếu item.
  for (const bc of ns.filter((n) => n["@type"] === "BreadcrumbList")) {
    const items: any[] = bc.itemListElement ?? [];
    const positions = items.map((i) => i.position);
    const ok = positions.every((v, i) => v === i + 1) && items.every((i) => i.name && i.item);
    if (!ok) add({ id: "breadcrumb-shape", severity: "error", where: path, detail: `BreadcrumbList có position=[${positions.join(",")}], ${items.filter((i) => !i.item).length} mục thiếu item`, why: "Breadcrumb sai cấu trúc bị bỏ hoàn toàn — mất luôn đường dẫn hiển thị trên SERP." });
  }

  // Dataset: đây là schema mang giá trị thật của site dữ liệu. Kiểm trường
  // Google dùng, và kiểm ĐỘ CHÍNH XÁC của con số công bố.
  for (const ds of ns.filter((n) => n["@type"] === "Dataset")) {
    for (const field of ["name", "description", "url", "creator"]) {
      if (!ds[field]) add({ id: "dataset-required", severity: "error", where: path, detail: `Dataset thiếu ${field}`, why: "Thiếu trường bắt buộc thì Dataset không đủ điều kiện cho Google Dataset Search — thứ duy nhất biến schema này thành lưu lượng." });
    }
    for (const field of ["license", "temporalCoverage"]) {
      if (!ds[field])
        add({
          id: "dataset-recommended",
          severity: "warning",
          where: path,
          detail: `Dataset thiếu ${field}`,
          why: field === "temporalCoverage"
            ? "Không có temporalCoverage thì không máy nào biết con số thuộc kỳ nào. Với ước lượng 5 năm của ACS, 'năm nào' là nửa ý nghĩa của con số."
            : "Không có license thì bên muốn dùng lại dữ liệu phải đoán — và dữ liệu liên bang vốn thuộc phạm vi công cộng, nên đây là thứ khai được mà không mất gì.",
        });
    }

    const shown = visibleText(p.html);
    for (const v of (ds.variableMeasured ?? []) as any[]) {
      if (!v.measurementTechnique)
        add({ id: "variable-no-technique", severity: "error", where: path, detail: `PropertyValue "${v.name}" không khai measurementTechnique`, why: "Luật aggregate-must-declare-scope yêu cầu phạm vi và phép tính phải vào measurementTechnique. Không có nó thì một số cấp hạt và một số cấp zip trông y hệt nhau." });

      // Con số công bố cho MÁY phải là con số đã hiện cho NGƯỜI.
      const s = String(v.value);
      const decimals = (s.split(".")[1] ?? "").length;
      if (decimals > 2 && !shown.includes(s))
        add({
          id: "jsonld-precision",
          severity: "error",
          where: path,
          detail: `PropertyValue "${v.name}" = ${s} (${v.unitText ?? "?"}) — chuỗi này không xuất hiện ở đâu trên trang`,
          why: "Site đã có luật 'displayed-only' cho văn bản: mọi chữ số vượt quá mức đã in ra là chữ số bịa. Luật đó dừng ở ranh giới HTML — JSON-LD không ai kiểm, nên nó công bố giá trị thô. Đây lại chính là bề mặt máy đọc: một ước lượng ACS có sai số ±1-2 điểm phần trăm đang được khai với 14 chữ số thập phân.",
        });
    }
  }

  // FAQ trong schema mà không có trên trang là structured data không khớp nội dung.
  for (const faq of ns.filter((n) => n["@type"] === "FAQPage")) {
    const shown = visibleText(p.html);
    const missing = ((faq.mainEntity ?? []) as any[]).filter((q) => q.name && !shown.includes(String(q.name).slice(0, 40)));
    if (missing.length > 0)
      add({ id: "faq-not-visible", severity: "error", where: path, detail: `${missing.length}/${(faq.mainEntity ?? []).length} câu hỏi trong FAQPage không có trên trang`, why: "Chính sách structured data của Google: nội dung đánh dấu phải nhìn thấy được. Đánh dấu nội dung ẩn là lý do bị phạt thủ công, không phải lý do mất rich result." });
  }
}

// ------------------------------------------------------------------- main

async function main() {
  const [rawUrl, ...rest] = process.argv.slice(2);
  if (!rawUrl) {
    console.error("Usage: tsx scripts/audit-technical-seo.ts <site-url> [--sample N] [--json out.json]");
    process.exit(2);
  }
  const origin = new URL(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`).origin;
  const sampleSize = Number(rest[rest.indexOf("--sample") + 1]) || 40;
  const jsonOut = rest.includes("--json") ? rest[rest.indexOf("--json") + 1] : null;

  console.log(`Đo Technical SEO: ${origin}\n`);

  const homeHtml = await auditOrigin(origin);
  const { urls } = await readSitemap(origin);
  console.log(`sitemap: ${urls.length} URL\n`);

  // Lấy mẫu THEO ĐỘ SÂU, không lấy N URL đầu: các trang cùng độ sâu do cùng
  // template sinh ra, nên 40 trang zip đầu tiên chỉ chứng minh một template.
  const byDepth = new Map<number, string[]>();
  for (const u of urls) {
    const d = new URL(u).pathname.split("/").filter(Boolean).length;
    byDepth.set(d, [...(byDepth.get(d) ?? []), u]);
  }
  const sample: string[] = [];
  for (const [, group] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    // Nhóm nhỏ thì lấy HẾT, không lấy theo tỷ lệ. Lấy theo tỷ lệ thuần khiến
    // các loại trang hiếm (mục /blog, trang tin cậy) bị bỏ qua — mà đó đúng là
    // chỗ lệch template hay xảy ra, vì chúng đi đường render riêng. Đo được:
    // vòng chạy đầu bỏ /blog, nên bỏ luôn bài giữ chỗ WordPress nằm dưới nó.
    const take = group.length <= 12 ? group.length : Math.max(1, Math.round((sampleSize * group.length) / urls.length));
    const step = Math.max(1, Math.floor(group.length / take));
    for (let i = 0; i < group.length && sample.length < sampleSize * 1.5; i += step) sample.push(group[i]);
  }

  const pages: PageFacts[] = [];
  for (const u of sample) {
    const p = await readPage(u);
    if (p) {
      pages.push(p);
      auditPage(p);
    }
  }

  // Trùng title/description: đo trên mẫu, nên chỉ báo khi THẤY trùng thật.
  for (const [field, re] of [["title", /<title[^>]*>([\s\S]*?)<\/title>/i], ["description", /<meta[^>]+name="description"[^>]+content="([^"]*)"/i]] as const) {
    const seen = new Map<string, string[]>();
    for (const p of pages) {
      const v = attr(p.html, re as RegExp);
      if (!v) continue;
      seen.set(v, [...(seen.get(v) ?? []), new URL(p.url).pathname]);
    }
    for (const [value, where] of seen) {
      if (where.length > 1) add({ id: `duplicate-${field}`, severity: "error", where: where.join(", "), detail: `${where.length} trang dùng chung ${field}: "${value.slice(0, 60)}"`, why: "Trùng title/description trên các trang khác nhau là tín hiệu trực tiếp của trang mỏng nhân bản — đúng thứ site pSEO phải chứng minh nó không phải." });
    }
  }

  // Trang index được mà không nằm trong sitemap.
  //
  // Không chỉ là thiếu sót khai báo: mẫu số của tỷ lệ index ở HQ chính là số
  // URL trong sitemap (lib/sitemap/count.ts), còn tử số là số trang có
  // impression trên GSC — gồm cả những trang này. Thiếu chúng ở mẫu số làm tỷ
  // lệ vượt 100% trong khi trông vẫn như một phần trăm bình thường.
  const inSitemap = new Set(urls.map((u) => new URL(u).pathname.replace(/\/$/, "")));
  const linked = new Set<string>();
  for (const p of [...pages, { html: homeHtml, internalLinks: all(homeHtml, /<a[^>]+href="(\/[^"#]*)"/gi) } as PageFacts])
    for (const href of p.internalLinks) linked.add(href.split("?")[0].replace(/\/$/, ""));

  const orphanCandidates = [...linked]
    .filter((href) => href && !inSitemap.has(href) && !href.startsWith("/api"))
    .sort();
  for (const href of orphanCandidates.slice(0, 40)) {
    const res = await fetch(`${origin}${href}`, { headers: BROWSER_HEADERS, redirect: "follow" });
    // Chỉ trang HTML mới có chuyện "index hay không". /sitemap.xml, ảnh, feed
    // đều trả 200 và đều không thuộc câu hỏi này — lọc bằng content-type chứ
    // không bằng danh sách đuôi file, vì danh sách đuôi file sẽ thiếu một cái.
    if (res.status !== 200 || !(res.headers.get("content-type") ?? "").includes("text/html")) continue;
    const status = res.status;
    const body = await res.text();
    const robotsMeta = attr(body, /<meta[^>]+name="robots"[^>]+content="([^"]*)"/i) ?? "";
    if (/noindex/i.test(robotsMeta)) continue;
    add({
      id: "indexable-not-in-sitemap",
      severity: "warning",
      where: href,
      detail: `trả 200, meta robots "${robotsMeta || "không khai"}", nhưng không có trong sitemap`,
      why: "Trang được link, index được, mà site không nộp. Hai hệ quả: Google index một trang site không chủ ý nộp, và mẫu số tỷ lệ index của HQ (đếm theo sitemap) thiếu nó — tỷ lệ có thể vượt 100%.",
    });
  }

  // ------------------------------------------------------------ báo cáo
  const rank = { error: 0, warning: 1, info: 2 } as const;
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;

  console.log(`Đã đọc ${pages.length} trang trong ${urls.length} URL của sitemap.\n`);
  let lastId = "";
  for (const f of findings) {
    if (f.id !== lastId) {
      console.log(`\n[${f.severity.toUpperCase()}] ${f.id}`);
      console.log(`  → ${f.why}`);
      lastId = f.id;
    }
    console.log(`     ${f.where}: ${f.detail}`);
  }
  console.log(`\n${counts.error} lỗi · ${counts.warning} cảnh báo · ${counts.info} ghi nhận`);

  if (jsonOut) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(jsonOut, JSON.stringify({ origin, measuredAt: new Date().toISOString(), sitemapUrls: urls.length, pagesRead: pages.length, findings }, null, 2));
    console.log(`Đã ghi ${jsonOut}`);
  }
  process.exit(counts.error > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
