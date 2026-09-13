// ZIP nào có đoạn AI mà KHÔNG trang nào hiện.
//
// Trang riêng (market-view.tsx) render đoạn AI; trang cụm (cluster-view.tsx)
// không tham chiếu tới lớp AI. Nên mọi đoạn sinh cho một ZIP nằm trong cụm là
// chữ không ai đọc.
//
// Đo 13/9/2026 sau khi sinh lại theo ý định: 9/35 đoạn rơi vào nhóm đó,
// khoảng $0.20. Script này để lần sau biết trước thay vì biết sau.
//
// Dùng: tsx scripts/interpretations-shown.ts

import { prisma } from "../lib/db/prisma";
import { resolveSite, reportSiteError } from "../lib/scripts/resolve-site";
import { fetchServedInventory } from "../lib/publisher/inventory";

async function main() {
  let site: { id: string; url: string; vertical: string };
  try {
    site = await resolveSite<{ id: string; url: string; vertical: string }>();
  } catch (err) {
    if (reportSiteError(err)) return;
    throw err;
  }

  const inv = await fetchServedInventory(site.url);
  const gens = await prisma.aiGeneration.findMany({
    where: { vertical: site.vertical },
    select: { zip: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const newest = new Map<string, Date>();
  for (const g of gens) if (g.zip && !newest.has(g.zip)) newest.set(g.zip, g.createdAt);

  let shown = 0, hidden = 0, unserved = 0;
  const hiddenZips: string[] = [];
  for (const zip of newest.keys()) {
    const kind = inv.kindByZip.get(zip);
    if (!kind) { unserved++; continue; }
    if (kind === "market") shown++;
    else { hidden++; hiddenZips.push(zip); }
  }

  console.log(`${newest.size} ZIP có đoạn AI (bản mới nhất mỗi ZIP)\n`);
  console.log(`  hiện trên trang riêng      : ${shown}`);
  console.log(`  KHÔNG hiện (nằm trong cụm) : ${hidden}`);
  console.log(`  publisher không phục vụ    : ${unserved}`);
  if (hidden > 0) {
    console.log(`\nZIP có đoạn văn không trang nào hiện:\n  ${hiddenZips.join(", ")}`);
    console.log("\nHai cách xử: hoặc thôi sinh cho nhóm này, hoặc để cluster-view hiện");
    console.log("một đoạn cấp cụm. Hiện tại là sinh mà không hiện — tốn tiền, không ai đọc.");
  }
  await prisma.$disconnect();
}
main();
