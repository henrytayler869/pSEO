import { prisma } from "@/lib/db/prisma";
import { specFor, metricsNamedBy, allSpecs, type NicheContentSpec } from "@/lib/content-spec/niche-spec";

/**
 * Chạy: npm run verify:niche-spec
 *
 * Đặc tả nội dung của mỗi nghề phải khớp DỮ LIỆU THẬT, theo ba chiều. Cả ba
 * đều là những cách đặc tả có thể trôi khỏi thực tế mà không ai thấy.
 *
 *   1. Site có nghề nào thì nghề đó phải có đặc tả.
 *      Thiếu → trang thị trường của site đó không có mục nào để dựng, và
 *      hôm nay nó sẽ lặng lẽ rơi về khung của nghề khác.
 *
 *   2. Mọi chỉ số đặc tả nhắc tới phải THẬT SỰ có trong nguồn được khai liên
 *      quan cho nghề đó. Gõ sai một tên chỉ số không gây lỗi ở đâu cả — mục
 *      chỉ đơn giản không bao giờ render, và trang mỏng đi mà không ai biết
 *      vì sao.
 *
 *   3. Chiều NGƯỢC LẠI, và đây là chiều đáng giá: mọi chỉ số có trong nguồn
 *      liên quan phải được đặc tả nhắc tới — dùng, hoặc `excluded` kèm lý do.
 *      Không có chiều này thì thêm một chỉ số mới vào adapter sẽ không xuất
 *      hiện ở đâu, và "chưa ai viết mục cho nó" trông giống hệt "đã quyết định
 *      không dùng".
 *
 * Cần DB nên KHÔNG chạy trong job `static` của CI. Chạy sau mỗi lần thu thập
 * và trước mỗi lần đổi đặc tả — đó là hai lúc dữ liệu và đặc tả có thể lệch.
 */

async function main() {
  const sites = await prisma.website.findMany({ select: { url: true, vertical: true } });
  if (sites.length === 0) {
    console.log("✗ Chưa có Website nào — phép kiểm này đang không kiểm gì cả.");
    process.exit(1);
  }

  const problems: string[] = [];
  const verticals = [...new Set(sites.map((s) => s.vertical))].sort();

  for (const vertical of verticals) {
    const hosts = sites.filter((s) => s.vertical === vertical).map((s) => s.url.replace(/^https?:\/\//, ""));
    const spec = specFor(vertical);
    if (!spec) {
      console.log(`  THIẾU  ${vertical.padEnd(26)} (${hosts.join(", ")})`);
      problems.push(`Nghề "${vertical}" chưa có đặc tả nội dung, nhưng ${hosts.length} site đang dùng nó.`);
      continue;
    }

    // Chỉ số THẬT SỰ có, cho đúng nghề này, qua đúng đường mà fact set đi.
    const rows = await prisma.$queryRawUnsafe<{ metric: string; res: string }[]>(
      `SELECT DISTINCT dp.metric, dp."resolvedAtResolution"::text AS res
       FROM "DataPoint" dp
       JOIN "DataSnapshot" ds ON ds.id = dp."snapshotId"
       JOIN "DataSource" s ON s.id = ds."sourceId"
       WHERE s."isActive" = true AND $1 = ANY(s."relevantVerticals")`,
      vertical
    );
    const real = new Set(rows.map((r) => r.metric));
    const resolutionOf = new Map(rows.map((r) => [r.metric, r.res]));
    const named = metricsNamedBy(spec);

    const invented = [...named].filter((m) => !real.has(m)).sort();
    const unnamed = [...real].filter((m) => !named.has(m)).sort();

    console.log(
      `    ok  ${vertical.padEnd(26)} ${spec.sections.length} mục, ${named.size} chỉ số được nhắc, ${real.size} chỉ số có thật`
    );
    for (const m of invented) {
      console.log(`          ✗ đặc tả nhắc "${m}" nhưng nguồn liên quan không phát chỉ số đó`);
      problems.push(`${vertical}: "${m}" không tồn tại — mục dùng nó sẽ KHÔNG BAO GIỜ render, lặng lẽ.`);
    }
    for (const m of unnamed) {
      console.log(`          ✗ chỉ số "${m}" có thật nhưng đặc tả không nhắc tới`);
      problems.push(
        `${vertical}: "${m}" chưa được dùng cũng chưa được ghi vào excluded. ` +
          `"Chưa ai viết mục cho nó" và "đã quyết định không dùng" phải phân biệt được.`
      );
    }

    /**
     * CHIỀU THỨ TƯ: `scope` của mục phải khớp độ phân giải THẬT của từng chỉ số.
     *
     * Thêm sau khi cổng phía publisher để lọt đúng đột biến này. Cổng đó dựng
     * sự kiện giả bằng CHÍNH `section.scope`, nên nó kiểm đặc tả với chính nó:
     * đổi COUNTY thành ZIP thì sự kiện giả cũng thành ZIP, khớp, và xanh. Một
     * phép kiểm tự nhất quán không phải một phép kiểm.
     *
     * Hậu quả nếu lọt: mục in "Measured for this ZIP code" ngay dưới một con
     * số cấp HẠT — sai phạm vi, đọc trôi chảy, và vi phạm đúng luật
     * `aggregate-must-declare-scope` mà HQ tự công bố.
     *
     * Chỉ HQ kiểm được: publisher không có bảng DataPoint nên không biết độ
     * phân giải thật của bất kỳ chỉ số nào.
     */
    for (const section of spec.sections) {
      for (const metric of [...section.requires, ...(section.optional ?? [])]) {
        const actual = resolutionOf.get(metric);
        if (!actual || actual === section.scope) continue;
        console.log(`          ✗ mục "${section.key}" khai ${section.scope} nhưng "${metric}" thật sự là ${actual}`);
        problems.push(
          `${vertical}: mục "${section.key}" khai ${section.scope}, chỉ số "${metric}" là ${actual}. ` +
            `Mục sẽ in câu nói phạm vi SAI ngay cạnh con số nó mô tả.`
        );
      }
    }
  }

  if (problems.length) {
    console.log(`\n✗ ${problems.length} vấn đề:`);
    for (const p of problems) console.log(`  ${p}`);
    process.exit(1);
  }
  console.log(`\n✓ ${verticals.length} nghề: đặc tả khớp dữ liệu cả hai chiều.`);
}

void main().finally(() => prisma.$disconnect());

/**
 * Khối đặc tả trang CỤM.
 *
 * Ba phép kiểm, mỗi phép cho một cách hỏng đã thấy hoặc thấy được trước:
 *
 * 1. Chỗ thay phải nằm trong tập đã khai. Chuỗi đi qua JSON nên không trình
 *    biên dịch nào đọc chúng; một "{cuont}" gõ sai sẽ in nguyên văn lên trang
 *    production và trông như một lỗi hiển thị chứ không như lỗi đặc tả.
 * 2. Chỉ số trong `tiles` phải là chỉ số nghề này thật sự có — tức phải được
 *    chính đặc tả nhắc tới ở đâu đó. Một ô thống kê trỏ chỉ số không tồn tại
 *    thì im lặng biến mất, và không ai biết nó từng được định hiện.
 * 3. Chữ của nghề này KHÔNG được nhắc nghề khác. Đây là phép kiểm thô và nó
 *    bắt đúng ca đã xảy ra: 27 trang của site tai nạn in "Household migration"
 *    và "household moves".
 */
/** Chữ của nghề khác, dùng cho MỌI chuỗi hiện trên trang mà đặc tả cấp. */
const FOREIGN_WORDS_FOR: Record<string, readonly string[]> = {
  "auto-accident-attorney": ["household moves", "Household migration", "moving compan", "moving", "housing stock"],
  "moving-services": ["fatal crash", "crash fatalit"],
};

const PLACEHOLDERS = new Set(["count", "place", "counties"]);
/** Trang một ZIP có chỗ thay khác: nó biết ZIP, không biết "bao nhiêu ZIP". */
const MARKET_PLACEHOLDERS = new Set(["zip", "place", "detail"]);
/** Title trang một ZIP: KHÔNG có {detail} — xem ghi chú ở NicheMarketSpec. */
const MARKET_TITLE_PLACEHOLDERS = new Set(["zip", "place"]);
const STATE_HUB_PLACEHOLDERS = new Set(["state", "stateName", "count"]);

/**
 * NGƯỠNG CẮT TITLE, và vì sao nó là CẢNH BÁO chứ không phải lỗi.
 *
 * Google cắt title theo BỀ RỘNG PIXEL (~600px), không theo số ký tự, nên
 * không có con số nào đúng tuyệt đối. 60 ký tự là ước lượng thô quen dùng.
 * Vượt ngưỡng nghĩa là phần đuôi nhiều khả năng bị cắt trên SERP — khó chịu,
 * nhưng không sai sự thật và không hỏng trang. Làm đỏ cổng vì nó là biến một
 * chuyện thẩm mỹ thành chuyện chặn merge.
 *
 * Nhưng IM LẶNG thì cũng sai: title dài chỉ lộ ra khi chỗ thay gặp giá trị
 * DÀI NHẤT, mà giá trị dài nhất thì hiếm. Đo 22/9/2026 trên
 * data/sites/theaccidentrecord.com/markets.json (184 thị trường, chính dữ
 * liệu các trang này render):
 *
 *   {place} trang cụm      "Nashville-Davidson"       18
 *   {place} trang một ZIP  "Nashville-Davidson, TN"   22
 *   {zip}                  luôn 5
 *   {state}                luôn 2
 *   {stateName}            "Massachusetts"            13  (chưa có bang dài hơn)
 *   {count}                tới 3 chữ số
 *   {counties}             DANH SÁCH — không chặn trên được
 *
 * Số này sẽ trôi khi tập thị trường đổi. Đo lại bằng cách đọc lại chính file
 * markets.json ở kho publisher.
 */
const TITLE_LIMIT = 60;

/**
 * BỀ RỘNG TÁCH THEO LOẠI TRANG, không dùng chung một bảng.
 *
 * `{place}` là cùng một cái tên nhưng KHÔNG cùng một tập giá trị: trang cụm
 * điền tên cụm ("Nashville-Davidson", 18), trang một ZIP điền thành phố kèm
 * bang ("Nashville-Davidson, TN", 22). Dùng chung số 22 cho cả hai thì title
 * cụm bị báo 61 trong khi thật ra dài nhất là 57 — một cảnh báo sai, và cảnh
 * báo sai làm hỏng cổng nhanh hơn là không có cảnh báo.
 */
const WORST_CASE_WIDTH: Record<string, Record<string, number>> = {
  cluster: { place: 18, count: 3, counties: 40 },
  market: { place: 22, zip: 5 },
  stateHub: { state: 2, stateName: 13, count: 3 },
};

const warnings: string[] = [];

/** Độ dài title khi mọi chỗ thay nhận giá trị dài nhất đã đo cho LOẠI TRANG đó. */
function titleWorstCase(kind: string, template: string): number {
  const widths = WORST_CASE_WIDTH[kind] ?? {};
  return template.replace(/\{([^}]*)\}/g, (_, name: string) =>
    "X".repeat(widths[name] ?? 10)
  ).length;
}

function checkTitleLength(vertical: string, kind: string, template: string | undefined): void {
  if (!template) return;
  const where = `${kind}.title`;
  const n = titleWorstCase(kind, template);
  if (n > TITLE_LIMIT) {
    warnings.push(
      `${vertical}: ${where} dài tới ${n} ký tự khi chỗ thay nhận giá trị dài nhất đã đo ` +
        `(ngưỡng ${TITLE_LIMIT}) — phần đuôi nhiều khả năng bị cắt trên SERP ở những thị trường đó`
    );
  }
}

function checkClusterSpec(spec: NicheContentSpec): string[] {
  const c = spec.cluster;
  if (!c) return [];
  const errors: string[] = [];

  const strings: [string, string][] = [
    // title nằm TRONG danh sách này, không phải kiểm riêng: nó là chuỗi hiện
    // trên trang mà đặc tả cấp, nên nó phải chịu cả phép kiểm chỗ thay lẫn
    // phép kiểm chữ của nghề khác — và title là chuỗi DỄ LỘ NHẤT trong cả
    // khối, vì nó hiện trên SERP kể cả khi không ai mở trang.
    ...(c.title ? ([["cluster.title", c.title]] as [string, string][]) : []),
    ["description", c.description],
    ["comparison.heading", c.comparison.heading],
    ["comparison.lead", c.comparison.lead],
    ["county.heading", c.county.heading],
    ["county.headingMulti", c.county.headingMulti],
    ["county.lead", c.county.lead],
    ["distinguishing", c.distinguishing],
    ["topicsHeading", c.topicsHeading],
  ];

  for (const [where, text] of strings) {
    for (const m of text.matchAll(/\{([^}]*)\}/g)) {
      if (!PLACEHOLDERS.has(m[1])) {
        errors.push(`${spec.vertical}: ${where} dùng chỗ thay "{${m[1]}}" không có trong tập [${[...PLACEHOLDERS].join(", ")}]`);
      }
    }
  }

  checkTitleLength(spec.vertical, "cluster", c.title);

  const named = metricsNamedBy(spec);
  for (const tile of c.tiles) {
    if (!named.has(tile.metric)) {
      errors.push(`${spec.vertical}: tiles trỏ chỉ số "${tile.metric}" mà đặc tả không nhắc tới ở đâu cả`);
    }
  }

  // Từ của nghề KHÁC. Danh sách nhỏ và cụ thể, không phải bộ lọc chung: nó
  // canh đúng ca đã xảy ra, và một danh sách rộng sẽ chặn cả câu hợp lệ.
  const FOREIGN = FOREIGN_WORDS_FOR;
  for (const word of FOREIGN[spec.vertical] ?? []) {
    for (const [where, text] of strings) {
      if (text.toLowerCase().includes(word.toLowerCase())) {
        errors.push(`${spec.vertical}: ${where} nhắc "${word}" — chữ của nghề khác`);
      }
    }
  }

  return errors;
}

function checkMarketSpec(spec: NicheContentSpec): string[] {
  const m = spec.market;
  if (!m) return [];
  const errors: string[] = [];
  const strings: [string, string][] = [
    ["market.description", m.description],
    ["market.descriptionWithDetail", m.descriptionWithDetail],
    ["market.interpretationHeading", m.interpretationHeading],
  ];
  for (const [where, text] of strings) {
    for (const ph of text.matchAll(/\{([^}]*)\}/g)) {
      if (!MARKET_PLACEHOLDERS.has(ph[1])) {
        errors.push(`${spec.vertical}: ${where} dùng chỗ thay "{${ph[1]}}" không có trong tập [${[...MARKET_PLACEHOLDERS].join(", ")}]`);
      }
    }
  }
  // Title kiểm RIÊNG vì tập chỗ thay hẹp hơn phần còn lại của khối.
  if (m.title) {
    for (const ph of m.title.matchAll(/\{([^}]*)\}/g)) {
      if (!MARKET_TITLE_PLACEHOLDERS.has(ph[1])) {
        errors.push(
          `${spec.vertical}: market.title dùng chỗ thay "{${ph[1]}}" không có trong tập ` +
            `[${[...MARKET_TITLE_PLACEHOLDERS].join(", ")}]`
        );
      }
    }
    for (const word of FOREIGN_WORDS_FOR[spec.vertical] ?? []) {
      if (m.title.toLowerCase().includes(word.toLowerCase())) {
        errors.push(`${spec.vertical}: market.title nhắc "${word}" — chữ của nghề khác`);
      }
    }
    checkTitleLength(spec.vertical, "market", m.title);
  }

  const named = metricsNamedBy(spec);
  for (const lead of m.leadMetrics) {
    if (!named.has(lead.metric)) {
      errors.push(`${spec.vertical}: market.leadMetrics trỏ chỉ số "${lead.metric}" mà đặc tả không nhắc tới`);
    }
    // {display} là chỗ thay DUY NHẤT ở đây: câu dẫn nói về một chỉ số, và nó
    // không biết gì khác ngoài giá trị đã định dạng của chỉ số đó.
    for (const ph of lead.phrase.matchAll(/\{([^}]*)\}/g)) {
      if (ph[1] !== "display") {
        errors.push(`${spec.vertical}: leadMetrics["${lead.metric}"] dùng chỗ thay "{${ph[1]}}" — chỉ {display} hợp lệ`);
      }
    }
    if (!lead.phrase.includes("{display}")) {
      errors.push(`${spec.vertical}: leadMetrics["${lead.metric}"] không chứa {display} — câu dẫn sẽ không có số nào`);
    }
  }

  // Bản có câu dẫn PHẢI dùng {detail}; không thì hai bản giống hệt nhau và
  // câu dẫn biến mất mà không ai thấy.
  if (!m.descriptionWithDetail.includes("{detail}")) {
    errors.push(`${spec.vertical}: market.descriptionWithDetail không chứa {detail} — câu dẫn sẽ bị bỏ lặng lẽ`);
  }
  return errors;
}

/**
 * Khối FAQ.
 *
 * Bốn phép kiểm, mỗi phép cho một cách hỏng:
 *
 * 1. `{metric:X}` phải nằm trong `requires` của chính câu đó. Không thì câu
 *    render ra chuỗi "{metric:X}" nguyên văn trên trang — hoặc tệ hơn, chỉ số
 *    vắng mặt mà câu vẫn render vì `requires` không nhắc nó.
 * 2. Chỉ số trong `requires` phải là chỉ số nghề này thật sự có. Một câu đòi
 *    chỉ số không tồn tại thì KHÔNG BAO GIỜ render, và im lặng.
 * 3. Chỗ thay giới hạn ở {place} {zip} {county} — gõ sai thì in nguyên văn.
 * 4. `key` không trùng: hai câu cùng key thì React dựng danh sách sai.
 */
const FAQ_PLACEHOLDERS = new Set(["place", "zip", "county"]);

function checkFaq(spec: NicheContentSpec): string[] {
  const faq = spec.faq;
  if (!faq) return [];
  const errors: string[] = [];

  // Tiêu đề mục CŨNG là chữ hiện trên trang, nên nó chịu đúng luật như mọi
  // chuỗi khác: không được nhắc nghề khác. Ca đã xảy ra là chuỗi viết cứng
  // "Questions about moving in this area" in trên 63 trang site tai nạn.
  if (faq.heading.trim().length === 0) {
    errors.push(`${spec.vertical}: faq.heading rỗng — mục FAQ sẽ render không tiêu đề`);
  }
  for (const word of FOREIGN_WORDS_FOR[spec.vertical] ?? []) {
    if (faq.heading.toLowerCase().includes(word.toLowerCase())) {
      errors.push(`${spec.vertical}: faq.heading nhắc "${word}" — chữ của nghề khác`);
    }
  }
  const named = metricsNamedBy(spec);
  const keys = new Set<string>();

  for (const entry of faq.entries) {
    if (keys.has(entry.key)) errors.push(`${spec.vertical}: faq có hai câu cùng key "${entry.key}"`);
    keys.add(entry.key);

    for (const m of entry.requires) {
      if (!named.has(m)) {
        errors.push(`${spec.vertical}: faq["${entry.key}"].requires trỏ chỉ số "${m}" mà đặc tả không nhắc tới — câu này sẽ không bao giờ render`);
      }
    }

    for (const text of [entry.question, entry.answer]) {
      for (const ph of text.matchAll(/\{([^}]*)\}/g)) {
        const raw = ph[1];
        if (raw.startsWith("metric:")) {
          const metric = raw.slice("metric:".length);
          if (!entry.requires.includes(metric)) {
            errors.push(`${spec.vertical}: faq["${entry.key}"] dùng {metric:${metric}} mà KHÔNG khai trong requires — câu có thể render khi chỉ số vắng mặt`);
          }
          continue;
        }
        if (!FAQ_PLACEHOLDERS.has(raw)) {
          errors.push(`${spec.vertical}: faq["${entry.key}"] dùng chỗ thay "{${raw}}" không hợp lệ`);
        }
      }
    }
  }
  return errors;
}

function checkStateHub(spec: NicheContentSpec): string[] {
  const h = spec.stateHub;
  if (!h) return [];
  const errors: string[] = [];
  for (const ph of h.title.matchAll(/\{([^}]*)\}/g)) {
    if (!STATE_HUB_PLACEHOLDERS.has(ph[1])) {
      errors.push(
        `${spec.vertical}: stateHub.title dùng chỗ thay "{${ph[1]}}" không có trong tập ` +
          `[${[...STATE_HUB_PLACEHOLDERS].join(", ")}]`
      );
    }
  }
  for (const word of FOREIGN_WORDS_FOR[spec.vertical] ?? []) {
    if (h.title.toLowerCase().includes(word.toLowerCase())) {
      errors.push(`${spec.vertical}: stateHub.title nhắc "${word}" — chữ của nghề khác`);
    }
  }
  checkTitleLength(spec.vertical, "stateHub", h.title);
  return errors;
}

const clusterErrors = [
  ...allSpecs().flatMap(checkClusterSpec),
  ...allSpecs().flatMap(checkMarketSpec),
  ...allSpecs().flatMap(checkFaq),
  ...allSpecs().flatMap(checkStateHub),
];
if (clusterErrors.length > 0) {
  for (const e of clusterErrors) console.error(`  ✗ ${e}`);
  console.error(`\n✗ ${clusterErrors.length} vấn đề trong khối đặc tả trang cụm.`);
  process.exit(1);
}
console.log(`  ✓ khối FAQ: ${allSpecs().filter((s) => s.faq).length}/${allSpecs().length} nghề có, tổng ${allSpecs().reduce((n, s) => n + (s.faq?.entries.length ?? 0), 0)} câu, mọi {metric:…} đều khai trong requires.`);
console.log(`  ✓ khối trang một ZIP: ${allSpecs().filter((s) => s.market).length}/${allSpecs().length} nghề có.`);
console.log(`  ✓ khối trang cụm: ${allSpecs().filter((s) => s.cluster).length}/${allSpecs().length} nghề có, chỗ thay hợp lệ, không nghề nào nhắc chữ của nghề khác.`);
const withTitle = allSpecs().filter((s) => s.cluster?.title || s.market?.title || s.stateHub?.title).length;
console.log(`  ✓ title do đặc tả cấp: ${withTitle}/${allSpecs().length} nghề có; nghề chưa khai thì publisher giữ nguyên chuỗi cũ.`);
// Cảnh báo in SAU dấu ✓ và KHÔNG làm đỏ cổng — xem ghi chú ở TITLE_LIMIT.
for (const w of warnings) console.log(`  ! ${w}`);
