// Sinh đoạn diễn giải cho các trang CỤM chưa có.
//
// Thứ tự theo VOLUME giảm dần. Ngân sách có thể hết giữa chừng, và khi đó
// thứ đã sinh phải là thứ đáng nhất — không phải cụm nào tình cờ đứng đầu
// bảng chữ cái.
//
// Hàng đợi dựng bằng CHÍNH hàm mà nút "Điền cụm" trên UI gọi
// (lib/queries/cluster-fill-queue.ts). Trước đây script tự gom cụm và tự xếp
// hạng, và bản sao thứ hai đó là bản sẽ trôi lệch: một sửa đổi ở màn hình
// không chạm tới nó, nên hai bên sẽ nói hai con số "còn thiếu" khác nhau mà
// không bên nào sai rõ ràng.
//
// Dùng: tsx scripts/generate-cluster-text.ts [số cụm tối đa]

import { prisma } from "../lib/db/prisma";
import { resolveSite, reportSiteError } from "../lib/scripts/resolve-site";
import { numberArg, reportArgError } from "../lib/scripts/argv";
import { buildClusterFillQueue } from "../lib/queries/cluster-fill-queue";
import { generateForCluster } from "../lib/ai/cluster-generate";
import { SpendCapExceededError } from "../lib/ai/anthropic";
import { getBudgetStatus } from "../lib/ai/budget";

async function main() {
  let site: { id: string; url: string; vertical: string };
  try {
    site = await resolveSite<{ id: string; url: string; vertical: string }>();
  } catch (err) {
    if (reportSiteError(err)) return;
    throw err;
  }

  const queue = await buildClusterFillQueue(site);
  if (queue.unavailable) {
    console.log(`⛔ ${queue.unavailable}`);
    await prisma.$disconnect();
    return;
  }

  // Trạng thái ngân sách in TRƯỚC khi tiêu, không phải sau. In sau thì nó
  // là biên lai; in trước thì nó là thứ người ta còn kịp làm gì đó.
  const budget = await getBudgetStatus(site.id);
  if (budget?.verdict === "over") {
    console.log(`⛔ Publisher này đã VƯỢT ngân sách AI: $${budget.totalUsd.toFixed(4)} / $${budget.budgetUsd!.toFixed(2)} (vượt $${budget.overUsd.toFixed(4)}).`);
    console.log(`   Vẫn chạy tiếp — ngân sách là mềm. Ctrl-C nếu không định tiêu thêm.\n`);
  } else if (budget?.verdict === "no-budget") {
    console.log(`· Chưa đặt ngân sách AI cho publisher này (đã tiêu $${budget.totalUsd.toFixed(4)}). Đặt ở /publisher/${site.id}.\n`);
  }

  const limit = numberArg(0, queue.pending.length);
  console.log(
    `${queue.summary.total} cụm, ${queue.summary.served} đã có chữ, ` +
      `chạy ${Math.min(limit, queue.pending.length)} theo volume giảm dần\n`
  );

  let done = 0, failed = 0, cost = 0, capped = false;
  for (const c of queue.pending.slice(0, limit)) {
    try {
      const r = await generateForCluster(site.vertical, c.zips, c.path, site.id);
      if (!r) { failed++; console.log(`  ✗ ${c.path} — không dựng được fact set (dưới 2 ZIP có dữ liệu)`); continue; }
      cost += r.costUsd;
      if (r.passed) { done++; console.log(`  ✓ ${String(c.searchVolume ?? 0).padStart(6)} ${c.path.padEnd(42)} ${r.attempts} lần $${r.costUsd.toFixed(4)}`); }
      else { failed++; console.log(`  ✗ ${c.path} — trượt sau ${r.attempts} lần: ${r.issues[0]?.slice(0, 90)}`); }
    } catch (err) {
      if (err instanceof SpendCapExceededError) {
        capped = true;
        console.log(`\n  CHẠM TRẦN NGÂN SÁCH — dừng. Cụm chưa sinh giữ nguyên trạng thái chưa có.`);
        break;
      }
      failed++;
      console.log(`  ✗ ${c.path} — ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    }
  }

  console.log(`\nsinh mới ${done} | trượt ${failed} | chạm trần ${capped} | chi phí $${cost.toFixed(4)}`);
  await prisma.$disconnect();
}
main().catch((err) => {
  if (reportArgError(err)) return;
  throw err;
});
