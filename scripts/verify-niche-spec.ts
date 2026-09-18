import { prisma } from "@/lib/db/prisma";
import { specFor, metricsNamedBy } from "@/lib/content-spec/niche-spec";

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
    const rows = await prisma.$queryRawUnsafe<{ metric: string }[]>(
      `SELECT DISTINCT dp.metric
       FROM "DataPoint" dp
       JOIN "DataSnapshot" ds ON ds.id = dp."snapshotId"
       JOIN "DataSource" s ON s.id = ds."sourceId"
       WHERE s."isActive" = true AND $1 = ANY(s."relevantVerticals")`,
      vertical
    );
    const real = new Set(rows.map((r) => r.metric));
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
  }

  if (problems.length) {
    console.log(`\n✗ ${problems.length} vấn đề:`);
    for (const p of problems) console.log(`  ${p}`);
    process.exit(1);
  }
  console.log(`\n✓ ${verticals.length} nghề: đặc tả khớp dữ liệu cả hai chiều.`);
}

void main().finally(() => prisma.$disconnect());
