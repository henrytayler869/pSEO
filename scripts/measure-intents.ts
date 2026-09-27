// Đo ý định tìm kiếm cho những từ khoá CHƯA có nhãn, rồi lưu vào KeywordMetric.
//
//     tsx scripts/measure-intents.ts <vertical> [--all] [--dry-run]
//
// Vì sao script này tồn tại: `refresh-keywords-for-vertical.ts` ghi
// searchVolume và keywordDifficulty nhưng KHÔNG ghi mainIntent, và
// `measureAndStoreIntents()` — hàm điền cột đó — không có chỗ nào gọi. Đo
// 26/9/2026: một lượt đo từ khoá cho 44 zip của moving-services trả về 2 thị
// trường có dữ liệu, cả hai `mainIntent = null`, và nhánh bài viết TỪ CHỐI
// viết khi ý định null ("chưa đo ý định từ khoá — đừng viết theo phỏng
// đoán"). Tức hai bước bắt buộc phải đi cùng nhau, nhưng chỉ bước đầu có
// lệnh chạy. Hàng đợi trông như hết ứng viên trong khi thật ra thiếu một
// lệnh không ai viết.
//
// KHÔNG gộp nó vào refresh-keywords: đo ý định là một endpoint DataForSEO
// KHÁC, tính tiền riêng, và có lúc người ta muốn đo lại từ khoá mà không
// muốn trả tiền cho ý định (đổi cách viết thì volume đổi, ý định của cùng
// một chuỗi thì không). Hai lệnh, hai hoá đơn, gọi được riêng.
//
// --all đo lại MỌI chuỗi và ghi đè nhãn đang có. Nhãn ý định chọn template và
// chọn tiêu đề, nên ghi đè nó là đổi hình dạng những trang đã xuất bản — phải
// gõ ra bằng tay, không bao giờ là mặc định.

import { measureAndStoreIntents } from "../lib/keywords/search-intent";
import { prisma } from "../lib/db/prisma";

/** $0,03576 cho 198 chuỗi, đo 11/9/2026 — dùng để in ước tính TRƯỚC khi gọi. */
const USD_PER_KEYWORD = 0.03576 / 198;

async function main() {
  const vertical = process.argv[2];
  const all = process.argv.includes("--all");
  const dryRun = process.argv.includes("--dry-run");
  if (!vertical) {
    console.error("Cách dùng: tsx scripts/measure-intents.ts <vertical> [--all] [--dry-run]");
    process.exitCode = 1;
    return;
  }

  const rows = await prisma.keywordMetric.findMany({
    where: { marketIdentity: { vertical } },
    select: { keyword: true, mainIntent: true },
  });
  if (rows.length === 0) {
    console.error(`Không có hàng KeywordMetric nào cho "${vertical}" — chạy refresh-keywords-for-vertical trước.`);
    process.exitCode = 1;
    return;
  }

  const missing = new Set(rows.filter((r) => !r.mainIntent).map((r) => r.keyword));
  const allKeywords = new Set(rows.map((r) => r.keyword));
  const target = all ? allKeywords : missing;

  console.log(`Ngành: ${vertical}`);
  console.log(`  hàng KeywordMetric   ${rows.length}`);
  console.log(`  chuỗi riêng biệt     ${allKeywords.size}`);
  console.log(`  chuỗi chưa có nhãn   ${missing.size}`);
  console.log(`  sẽ đo                ${target.size} chuỗi${all ? "  (--all: GHI ĐÈ nhãn đang có)" : ""}`);
  console.log(`  chi phí ước tính     $${(target.size * USD_PER_KEYWORD).toFixed(4)}`);

  if (target.size === 0) {
    console.log("\nKhông có chuỗi nào cần đo. Không gọi DataForSEO.");
    return;
  }
  if (dryRun) {
    console.log("\n--dry-run: dừng trước khi gọi DataForSEO.");
    console.log(`Chuỗi sẽ đo: ${[...target].slice(0, 20).join(" | ")}${target.size > 20 ? ` … (+${target.size - 20})` : ""}`);
    return;
  }

  const r = await measureAndStoreIntents(vertical, { onlyMissing: !all });

  console.log(`\nDataForSEO trả về ${r.measured}/${r.keywords} chuỗi.`);
  console.log(`Đã ghi nhãn cho ${r.updated} hàng KeywordMetric.`);
  if (Object.keys(r.byIntent).length > 0) {
    console.log("\nTheo ý định (số HÀNG được ghi):");
    for (const [k, n] of Object.entries(r.byIntent).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(5)} | ${k}`);
  }
  if (r.unresolved.length > 0) {
    // In ra, không đếm im lặng: một chuỗi không có nhãn sẽ khiến thị trường
    // của nó bị nhánh bài viết từ chối, và người chạy cần thấy CHUỖI NÀO chứ
    // không chỉ thấy còn sót bao nhiêu.
    console.log(`\n${r.unresolved.length} chuỗi KHÔNG có nhãn — vẫn null, thị trường của chúng vẫn chưa viết được:`);
    for (const k of r.unresolved.slice(0, 30)) console.log(`  ${k}`);
    if (r.unresolved.length > 30) console.log(`  … (+${r.unresolved.length - 30})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
