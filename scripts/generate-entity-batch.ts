/**
 * Sinh đoạn diễn giải cho MỌI trang của một nghề trục thực thể.
 *
 *     npm run entity:batch -- --dry          # đếm, không gọi model
 *     npm run entity:batch                   # sinh
 *     npm run entity:batch -- --limit 50     # sinh tối đa 50 trang
 *
 * ═══ CHẠY LẠI ĐƯỢC, VÀ ĐÓ LÀ TÍNH CHẤT CHÍNH ═══
 *
 * Mỗi trang đi qua `getOrGenerateEntityInterpretation`, nên trang nào đã có
 * văn khớp vân tay thì KHÔNG gọi model. Đứt giữa chừng thì chạy lại chỉ tốn
 * phần còn thiếu. Không cần sổ tiến độ riêng — cache CHÍNH LÀ sổ.
 *
 * ═══ TRANG KHÔNG CÓ FACT THÌ BỎ QUA, KHÔNG PHẢI LỖI ═══
 *
 * 876 cặp đối đầu tồn tại từ đầu mùa, nhưng đầu mùa hầu hết CHƯA gặp nhau —
 * `fixtureFacts` trả rỗng và `getOrGenerate` trả null. Đó là hành vi đúng: bắt
 * model viết về một tập rỗng là mời nó bịa. Số trang sinh được sẽ TĂNG DẦN
 * theo mùa, và script chạy lại mỗi vòng đấu sẽ bắt kịp.
 *
 * ═══ TRƯỢT VALIDATOR KHÔNG DỪNG CẢ LÔ ═══
 *
 * Một trang trượt là một trang không có văn; chín trăm trang còn lại không
 * liên quan. Dừng cả lô ở trang đầu tiên trượt sẽ biến một lỗi cục bộ thành
 * một đêm không sinh được gì. Đếm và báo ở cuối.
 */
import { getOrGenerateEntityInterpretation } from "@/lib/ai/entity-generate";
import { FOOTBALL_VERTICAL } from "@/lib/page-axis/axes";
import { prisma } from "@/lib/db/prisma";

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

  const rows = await prisma.entityIdentity.findMany({
    where: { vertical: FOOTBALL_VERTICAL },
    select: { axis: true, key: true, displayName: true },
    // Đội trước, rồi giải, rồi cặp đối đầu: trang đội là thứ brief xếp ưu tiên
    // cao nhất, nên nếu lô bị cắt giữa chừng thì phần đã xong là phần đáng giá
    // nhất.
    orderBy: [{ axis: "asc" }, { key: "asc" }],
  });
  const order = { team: 0, league: 1, fixture: 2 } as Record<string, number>;
  rows.sort((a, b) => (order[a.axis] ?? 9) - (order[b.axis] ?? 9) || a.key.localeCompare(b.key));

  console.log(`${rows.length} trang trong kho hàng trang.`);
  if (dry) {
    const byAxis = new Map<string, number>();
    for (const r of rows) byAxis.set(r.axis, (byAxis.get(r.axis) ?? 0) + 1);
    console.log([...byAxis].map(([a, n]) => `  ${a}: ${n}`).join("\n"));
    console.log("\n--dry: không gọi model. Trang chưa có fact (cặp chưa gặp nhau) sẽ tự bỏ qua khi chạy thật.");
    return;
  }

  let generated = 0;
  let cached = 0;
  let skipped = 0;
  let failed = 0;
  let cost = 0;
  const failures: string[] = [];
  let done = 0;

  for (const r of rows) {
    if (generated >= limit) break;
    done++;
    let out;
    try {
      out = await getOrGenerateEntityInterpretation(FOOTBALL_VERTICAL, r.axis, r.key);
    } catch (err) {
      failed++;
      failures.push(`${r.key}: ${err instanceof Error ? err.message.slice(0, 120) : "lỗi không rõ"}`);
      continue;
    }
    if (!out) {
      skipped++;
      continue;
    }
    cost += out.costUsd;
    if (out.cached) {
      cached++;
    } else if (out.validation.passed) {
      generated++;
      console.log(
        `[${done}/${rows.length}] ${r.displayName} — ${out.attempts} lượt, $${cost.toFixed(2)} tích luỹ`
      );
    } else {
      failed++;
      failures.push(`${r.key}: ${out.validation.issues.map((i) => i.rule).join(", ")}`);
    }
  }

  console.log(
    `\nsinh mới ${generated} · cache ${cached} · bỏ qua (chưa có fact) ${skipped} · trượt ${failed}` +
      `\nchi phí lượt này: $${cost.toFixed(4)}`
  );
  if (failures.length > 0) {
    console.log("\nTrượt:");
    for (const f of failures.slice(0, 25)) console.log(`  ${f}`);
    if (failures.length > 25) console.log(`  … và ${failures.length - 25} trang nữa`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
