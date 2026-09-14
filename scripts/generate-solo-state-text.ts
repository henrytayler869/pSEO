// Sinh đoạn cho hub của bang chỉ có MỘT ZIP được publish.
//
// 7 bang như vậy trên atmovingservices (sc, ct, nm, ok, ma, id, oh), hub
// 111-171 từ. Cách chữa cho 17 bang kia — dải giữa các ZIP trong bang —
// không áp được: một ZIP không tạo thành dải.
//
// Thứ hub một-ZIP nói được mà trang ZIP bên dưới KHÔNG nói được: vị trí của
// ZIP đó trong toàn bộ tập đã publish. Trang ZIP chỉ có số của chính nó.
//
// Mặc định CHẠY KHÔ.

import { prisma } from "../lib/db/prisma";
import { fetchServedInventory } from "../lib/publisher/inventory";
import { generateForSoloState } from "../lib/ai/solo-state-generate";
import { buildZipPool } from "../lib/ai/solo-state-facts";
import { SpendCapExceededError } from "../lib/ai/anthropic";
import { resolveSite, reportSiteError } from "../lib/scripts/resolve-site";
import { reportArgError } from "../lib/scripts/argv";

async function main() {
  const apply = process.argv.includes("--apply");
  const site = await resolveSite<{ id: string; url: string; vertical: string }>();
  const inv = await fetchServedInventory(site.url);

  const byState = new Map<string, string[]>();
  for (const [zip, path] of inv.byZip) {
    const seg = path.split("/").filter(Boolean);
    if (seg.length < 2) continue;
    byState.set(seg[1], [...(byState.get(seg[1]) ?? []), zip]);
  }
  const niche = [...inv.byZip.values()][0]?.split("/").filter(Boolean)[0] ?? "moving-services";
  const solo = [...byState].filter(([, z]) => z.length === 1).map(([state, z]) => ({ state, zip: z[0], path: `/${niche}/${state}` }));
  const allZips = [...inv.byZip.keys()];

  console.log(`${solo.length} bang chỉ có 1 ZIP | tập so sánh: ${allZips.length} ZIP đã publish\n`);
  for (const s of solo) console.log(`  ${s.path.padEnd(26)} ZIP ${s.zip}`);

  if (!apply) {
    console.log(`\nước tính ~$${(solo.length * 0.05).toFixed(2)}`);
    console.log("--dry (mặc định): chưa gọi model. Thêm --apply để chạy thật.");
    await prisma.$disconnect();
    return;
  }

  // Dựng tập so sánh MỘT lần cho cả 7 bang.
  console.log(`\ndựng phân bố trên ${allZips.length} ZIP (một lần, dùng chung)…`);
  const pool = await buildZipPool(site.vertical, allZips);
  console.log(`  ${pool.size} chỉ số có phân bố\n`);

  let ok = 0, failed = 0, cost = 0;
  for (const s of solo) {
    try {
      const r = await generateForSoloState(site.vertical, s.zip, s.path, pool, site.id);
      if (!r) { failed++; console.log(`  ✗ ${s.path} — không dựng được fact set (tập so sánh quá nhỏ hoặc ZIP thiếu dữ liệu)`); continue; }
      cost += r.costUsd;
      if (r.passed) { ok++; console.log(`  ✓ ${s.path.padEnd(26)} ${r.attempts} lần  trùng ${r.sharedWithZipPage} từ với trang ZIP  $${r.costUsd.toFixed(4)}`); }
      else { failed++; console.log(`  ✗ ${s.path} — trượt sau ${r.attempts} lần: ${r.issues[0]?.slice(0, 100)}`); }
    } catch (err) {
      if (err instanceof SpendCapExceededError) { console.log(`\n  CHẠM TRẦN CHI TIÊU — dừng.`); break; }
      throw err;
    }
  }
  console.log(`\nđạt ${ok} | trượt ${failed} | chi phí $${cost.toFixed(4)}`);
  await prisma.$disconnect();
}

main().catch((err) => { if (reportSiteError(err) || reportArgError(err)) return; throw err; });
