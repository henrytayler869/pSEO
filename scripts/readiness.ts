/**
 * In bảng "nghề này đã đủ để dựng site chưa" ra terminal.
 *
 *     npm run readiness -- bong-da-nam
 *
 * Cùng một hàm mà nút "Dựng Site" gọi (`checkReadiness`), nên bảng ở đây và
 * phán quyết ở đó không thể nói khác nhau. Hai đường đọc hai nguồn sẽ trôi
 * lệch, và độ lệch hiện ra dưới dạng một terminal nói xanh trong khi cái nút
 * từ chối.
 */
import { checkReadiness } from "@/lib/publisher/readiness";
import { prisma } from "@/lib/db/prisma";

async function main(): Promise<void> {
  const vertical = process.argv[2];
  if (!vertical) {
    console.error("Thiếu tên nghề. Ví dụ: npm run readiness -- bong-da-nam");
    process.exit(1);
  }

  const r = await checkReadiness(vertical);
  console.log(`\n${r.vertical} — ${r.ready ? "ĐỦ ĐỂ DỰNG" : "CHƯA đủ"}`);
  console.log(`${r.blockers} chặn, ${r.warnings} nhắc\n`);

  for (const c of r.checks) {
    const mark = c.ok ? "✓" : c.severity === "blocker" ? "✗" : "!";
    console.log(`${mark} ${c.title}`);
    console.log(`    ${c.detail}`);
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
