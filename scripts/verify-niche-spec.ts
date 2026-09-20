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
const PLACEHOLDERS = new Set(["count", "place", "counties"]);
/** Trang một ZIP có chỗ thay khác: nó biết ZIP, không biết "bao nhiêu ZIP". */
const MARKET_PLACEHOLDERS = new Set(["zip", "place", "detail"]);

function checkClusterSpec(spec: NicheContentSpec): string[] {
  const c = spec.cluster;
  if (!c) return [];
  const errors: string[] = [];

  const strings: [string, string][] = [
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

  const named = metricsNamedBy(spec);
  for (const tile of c.tiles) {
    if (!named.has(tile.metric)) {
      errors.push(`${spec.vertical}: tiles trỏ chỉ số "${tile.metric}" mà đặc tả không nhắc tới ở đâu cả`);
    }
  }

  // Từ của nghề KHÁC. Danh sách nhỏ và cụ thể, không phải bộ lọc chung: nó
  // canh đúng ca đã xảy ra, và một danh sách rộng sẽ chặn cả câu hợp lệ.
  const FOREIGN: Record<string, readonly string[]> = {
    "auto-accident-attorney": ["household moves", "Household migration", "moving company", "housing stock"],
    "moving-services": ["fatal crash", "crash fatalit"],
  };
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

const clusterErrors = [...allSpecs().flatMap(checkClusterSpec), ...allSpecs().flatMap(checkMarketSpec)];
if (clusterErrors.length > 0) {
  for (const e of clusterErrors) console.error(`  ✗ ${e}`);
  console.error(`\n✗ ${clusterErrors.length} vấn đề trong khối đặc tả trang cụm.`);
  process.exit(1);
}
console.log(`  ✓ khối trang một ZIP: ${allSpecs().filter((s) => s.market).length}/${allSpecs().length} nghề có.`);
console.log(`  ✓ khối trang cụm: ${allSpecs().filter((s) => s.cluster).length}/${allSpecs().length} nghề có, chỗ thay hợp lệ, không nghề nào nhắc chữ của nghề khác.`);
