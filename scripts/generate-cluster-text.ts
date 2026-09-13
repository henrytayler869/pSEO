// Sinh đoạn diễn giải cho các trang CỤM chưa có.
//
// Thứ tự theo VOLUME giảm dần. Ngân sách có thể hết giữa chừng, và khi đó
// thứ đã sinh phải là thứ đáng nhất — không phải cụm nào tình cờ đứng đầu
// bảng chữ cái.
//
// Dùng: tsx scripts/generate-cluster-text.ts [số cụm tối đa]

import { prisma } from "../lib/db/prisma";
import { fetchServedInventory } from "../lib/publisher/inventory";
import { generateForCluster } from "../lib/ai/cluster-generate";
import { SpendCapExceededError } from "../lib/ai/anthropic";

async function main() {
  const site = await prisma.website.findFirst({ select: { url: true, vertical: true } });
  if (!site) { console.error("Không có website nào."); process.exitCode = 1; return; }

  const inv = await fetchServedInventory(site.url);

  // Gom ZIP theo đường dẫn trang cụm. Publisher quyết định cụm gồm những ai;
  // HQ chỉ đọc, không tính lại.
  const byPath = new Map<string, string[]>();
  for (const [zip, path] of inv.byZip) {
    if (inv.kindByZip.get(zip) !== "cluster") continue;
    byPath.set(path, [...(byPath.get(path) ?? []), zip]);
  }

  // Volume của cụm = volume từ khoá của thành viên cao nhất. Mọi thành viên
  // chung một từ khoá nên con số này là của cả cụm.
  const ids = await prisma.marketIdentity.findMany({
    where: { vertical: site.vertical },
    select: { zip: true, keywordMetrics: { select: { keyword: true, searchVolume: true } } },
  });
  const volByZip = new Map<string, { keyword: string; volume: number }>();
  for (const i of ids) {
    const lead = [...i.keywordMetrics].sort((a, b) => b.searchVolume - a.searchVolume)[0];
    if (lead) volByZip.set(i.zip, { keyword: lead.keyword, volume: lead.searchVolume });
  }

  const clusters = [...byPath].map(([path, zips]) => {
    const best = zips.map((z) => volByZip.get(z)).filter(Boolean).sort((a, b) => b!.volume - a!.volume)[0];
    return { path, zips, keyword: best?.keyword ?? "?", volume: best?.volume ?? 0 };
  }).sort((a, b) => b.volume - a.volume);

  const limit = Number(process.argv[2] ?? clusters.length);
  console.log(`${clusters.length} cụm, chạy ${Math.min(limit, clusters.length)} theo volume giảm dần\n`);

  let done = 0, failed = 0, cached = 0, cost = 0, capped = false;
  for (const c of clusters.slice(0, limit)) {
    try {
      const r = await generateForCluster(site.vertical, c.zips, c.path);
      if (!r) { failed++; console.log(`  ✗ ${c.path} — không dựng được fact set (dưới 2 ZIP có dữ liệu)`); continue; }
      cost += r.costUsd;
      if (r.attempts === 0) { cached++; console.log(`  · ${c.path} — đã có, bỏ qua`); continue; }
      if (r.passed) { done++; console.log(`  ✓ ${String(c.volume).padStart(6)} ${c.path.padEnd(42)} ${r.attempts} lần $${r.costUsd.toFixed(4)}`); }
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

  console.log(`\nsinh mới ${done} | đã có ${cached} | trượt ${failed} | chạm trần ${capped} | chi phí $${cost.toFixed(4)}`);
  await prisma.$disconnect();
}
main();
