// Sinh lại TOÀN BỘ đoạn diễn giải của một niche, bắt buộc khác văn cũ.
//
// Dùng khi bỏ một publisher và dựng lại site mới trong CÙNG ngành. Cache
// khoá theo (vertical, zip, factsFingerprint) nên site mới sẽ nhận lại đúng
// đoạn cũ — thứ có thể vẫn đang nằm trong chỉ mục Google của site đã bỏ.
//
// Mặc định CHẠY KHÔ. Phải --apply mới gọi model.
//
// Dùng:
//   tsx scripts/regenerate-niche.ts moving-services            # xem trước
//   tsx scripts/regenerate-niche.ts moving-services --apply
//   tsx scripts/regenerate-niche.ts moving-services --apply 20 # giới hạn 20 ZIP

import { prisma } from "../lib/db/prisma";
import { regenerateInterpretation } from "../lib/ai/generate";
import { MAX_SHARED_RUN_WORDS } from "../lib/ai/distinctness";
import { SpendCapExceededError } from "../lib/ai/anthropic";
import { getBudgetStatus } from "../lib/ai/budget";
import { positionals, numberArg, reportArgError } from "../lib/scripts/argv";

/** Đo trên moving-services, ZIP 02301: $0,0684 cho 2 lần thử. Prompt dài
 * hơn đường thường vì mang theo nguyên văn các bản cũ, và hai cổng cùng gác
 * nên thử lại là chuyện bình thường chứ không phải sự cố.
 *
 * Một mẫu, nên đây là ước tính TRƯỚC để quyết định có chạy hay không —
 * không phải con số để đối soát SAU. Số thật đọc từ sổ chi. */
const EST_USD_PER_ZIP = 0.07;

async function main() {
  const [vertical] = positionals();
  if (!vertical) {
    console.error("Thiếu niche. Ví dụ: tsx scripts/regenerate-niche.ts moving-services");
    process.exitCode = 1;
    return;
  }
  const apply = process.argv.includes("--apply");
  const limitArg = numberArg(1, Number.POSITIVE_INFINITY);

  const zips = await prisma.aiGeneration.findMany({
    where: { vertical, validationPassed: true },
    distinct: ["zip"],
    orderBy: { zip: "asc" },
    select: { zip: true },
  });
  if (zips.length === 0) {
    console.log(`Niche "${vertical}" chưa có đoạn nào — không có gì để sinh lại. Dùng đường sinh thường.`);
    return;
  }

  const targets = zips.slice(0, Number.isFinite(limitArg) ? limitArg : zips.length);
  console.log(`${vertical}: ${zips.length} ZIP có văn, sẽ sinh lại ${targets.length}`);
  console.log(`ước tính ~$${(targets.length * EST_USD_PER_ZIP).toFixed(2)} (${EST_USD_PER_ZIP}/ZIP, đo trên moving-services)`);
  console.log(`trần mạch trùng: ${MAX_SHARED_RUN_WORDS} từ liên tiếp so với MỌI bản đã publish\n`);

  const site = await prisma.website.findFirst({ where: { vertical }, select: { id: true } });
  if (site) {
    const b = await getBudgetStatus(site.id);
    if (b?.verdict === "over") console.log(`⛔ Publisher của niche này đã vượt ngân sách: $${b.totalUsd.toFixed(4)} / $${b.budgetUsd!.toFixed(2)}\n`);
  }

  if (!apply) {
    console.log("--dry (mặc định): chưa gọi model. Thêm --apply để chạy thật.");
    await prisma.$disconnect();
    return;
  }

  let ok = 0, factFail = 0, dupFail = 0, cost = 0;
  const stuck: string[] = [];

  for (const { zip } of targets) {
    try {
      const r = await regenerateInterpretation(vertical, zip);
      if (!r) { console.log(`  · ${zip} — không dựng được fact set`); continue; }
      cost += r.costUsd;
      if (r.failure === null) {
        ok++;
        console.log(`  ✓ ${zip}  ${r.attempts} lần  trùng ${r.sharedRunWords} từ  $${r.costUsd.toFixed(4)}`);
      } else if (r.failure === "not-distinct") {
        dupFail++;
        stuck.push(zip);
        console.log(`  ✗ ${zip} — vẫn trùng ${r.sharedRunWords} từ sau ${r.attempts} lần: "${r.sharedPhrase?.slice(0, 70)}…"`);
      } else {
        factFail++;
        console.log(`  ✗ ${zip} — sai sự thật sau ${r.attempts} lần: ${r.validation.issues[0]?.detail?.slice(0, 70)}`);
      }
    } catch (err) {
      if (err instanceof SpendCapExceededError) {
        console.log(`\n  CHẠM TRẦN CHI TIÊU — dừng. ZIP chưa sinh lại giữ nguyên văn CŨ.`);
        break;
      }
      throw err;
    }
  }

  console.log(`\nđạt ${ok} | trượt vì trùng ${dupFail} | trượt vì sai số ${factFail} | chi phí $${cost.toFixed(4)}`);
  if (stuck.length > 0) {
    // Nói thẳng hệ quả: ZIP trượt KHÔNG phải "chưa xong", nó vẫn đang phục
    // vụ văn cũ — thứ site mới không được dùng. Im lặng ở đây là để người ta
    // publish nội dung trùng mà tưởng đã xử lý xong.
    console.log(`\n⚠ ${stuck.length} ZIP vẫn đang phục vụ VĂN CŨ: ${stuck.slice(0, 10).join(", ")}${stuck.length > 10 ? "…" : ""}`);
    console.log(`  Site mới KHÔNG được publish những ZIP này cho tới khi có văn khác.`);
    console.log(`  Nếu nhiều ZIP cùng kẹt: fact set quá hẹp để diễn đạt cách khác — đo lại ngưỡng, đừng nâng trần cho khuất mắt.`);
  }
  await prisma.$disconnect();
}

main().catch((err) => { if (reportArgError(err)) return; throw err; });
