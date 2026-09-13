// Gửi URL chưa index tới Omega Indexer, GIỮ LẠI một nhóm đối chứng.
//
// Vì sao có nhóm đối chứng: một trang mới cuối cùng cũng được index dù có
// gửi hay không. "Gửi rồi thấy index" là quan sát tương thích với cả hai khả
// năng — dịch vụ có tác dụng, và thời gian trôi qua. Chỉ chênh lệch giữa hai
// nhóm mới phân biệt được, và nhóm đối chứng phải chọn TRƯỚC khi gửi.
//
// Ghép cặp theo THỨ HẠNG volume: URL thứ 1 gửi, thứ 2 đối chứng, thứ 3 gửi…
// Chia ngẫu nhiên có thể dồn hết trang lớn vào một nhóm, và khi đó chênh
// lệch đọc được là chênh lệch về độ quan trọng chứ không về dịch vụ.
//
// Dùng:
//   tsx scripts/omega-submit.ts --dry              # xem sẽ gửi gì, không gửi
//   tsx scripts/omega-submit.ts --limit 20 --drip 7

import { prisma } from "../lib/db/prisma";
import { fetchServedInventory } from "../lib/publisher/inventory";
import { fetchSitemapCounts } from "../lib/sitemap/count";
import { fetchUrlIndexStatus } from "../lib/google/search-console";
import { submitToOmega } from "../lib/indexing/omega";

const PROVIDER = "omega-indexer";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const limit = Number(arg("limit", "20"));
  const drip = Number(arg("drip", "7"));

  const site = await prisma.website.findFirst();
  if (!site) { console.error("Không có website nào."); process.exitCode = 1; return; }

  const [inv, sm] = await Promise.all([fetchServedInventory(site.url), fetchSitemapCounts(site.url)]);

  const ids = await prisma.marketIdentity.findMany({
    where: { vertical: site.vertical },
    select: { zip: true, keywordMetrics: { select: { searchVolume: true } } },
  });
  const volByZip = new Map<string, number>();
  for (const i of ids) {
    const top = [...i.keywordMetrics].sort((a, b) => b.searchVolume - a.searchVolume)[0];
    if (top) volByZip.set(i.zip, top.searchVolume);
  }
  const volByPath = new Map<string, number>();
  for (const [zip, path] of inv.byZip) {
    volByPath.set(path, Math.max(volByPath.get(path) ?? 0, volByZip.get(zip) ?? 0));
  }

  // Chỉ trang nội dung. Hub và trang mục đã ở trong danh sách bấm tay
  // (npm run index:priority) và trộn chúng vào đây sẽ làm hai phép can thiệp
  // chồng lên nhau — lúc đó không tách được tác dụng của cái nào.
  // --dry không đọc bảng: nó tồn tại để xem TRƯỚC khi quyết định có dựng
  // bảng hay không, và bắt chạy migration mới xem được là đảo ngược thứ tự
  // đó.
  const already = dry
    ? new Set<string>()
    : new Set(
        (
          await prisma.indexSubmission.findMany({
            where: { websiteId: site.id, provider: PROVIDER },
            select: { url: true },
          })
        ).map((r) => r.url)
      );
  const candidates = sm.urls
    .filter((u) => new URL(u).pathname.split("/").filter(Boolean).length === 3)
    .filter((u) => !already.has(u))
    .sort((a, b) => (volByPath.get(new URL(b).pathname) ?? 0) - (volByPath.get(new URL(a).pathname) ?? 0))
    .slice(0, limit);

  if (candidates.length < 2) { console.log("Không đủ URL để chia hai nhóm."); return; }

  const submitted: string[] = [];
  const control: string[] = [];
  candidates.forEach((u, i) => (i % 2 === 0 ? submitted : control).push(u));

  console.log(`${candidates.length} URL: gửi ${submitted.length}, đối chứng ${control.length}, drip ${drip} ngày\n`);
  for (const u of submitted.slice(0, 5)) console.log(`  GỬI       ${u.replace(site.url, "")}  ${volByPath.get(new URL(u).pathname) ?? 0} lượt`);
  for (const u of control.slice(0, 5)) console.log(`  đối chứng ${u.replace(site.url, "")}  ${volByPath.get(new URL(u).pathname) ?? 0} lượt`);
  if (candidates.length > 10) console.log(`  … và ${candidates.length - 10} URL nữa`);

  if (dry) { console.log("\n--dry: không gửi, không ghi gì."); await prisma.$disconnect(); return; }

  // Đo trạng thái index TRƯỚC khi gửi, cả hai nhóm. Không có mốc này thì
  // phép so sau vài ngày không biết trang nào vốn đã index từ đầu.
  console.log("\nđo trạng thái index trước khi gửi…");
  const before = new Map<string, boolean | null>();
  for (const u of candidates) {
    try {
      before.set(u, await fetchUrlIndexStatus(site.gscPropertyUrl, u));
    } catch {
      before.set(u, null);
    }
  }
  const indexedAlready = [...before.values()].filter(Boolean).length;
  console.log(`  ${indexedAlready}/${candidates.length} đã index sẵn`);

  const campaignName = `hq-${new URL(site.url).hostname}-${arg("tag", "batch")}`;
  const result = await submitToOmega({ urls: submitted, campaignName, dripfeedDays: drip });
  console.log(`\ngửi: ${result.ok ? "OK" : "THẤT BẠI"} — ${result.detail}`);

  // Ghi CẢ hai nhóm, kể cả khi gửi thất bại — nhóm đối chứng vẫn là đối
  // chứng, và biết một lần gửi đã hỏng cũng là dữ liệu.
  for (const [arm, urls] of [["submitted", result.ok ? submitted : []], ["control", control]] as const) {
    for (const url of urls) {
      await prisma.indexSubmission.upsert({
        where: { websiteId_url_provider: { websiteId: site.id, url, provider: PROVIDER } },
        create: {
          websiteId: site.id, url, arm, provider: PROVIDER,
          campaignName: arm === "submitted" ? campaignName : null,
          dripfeedDays: arm === "submitted" ? drip : null,
          indexedAtSubmit: before.get(url) ?? null,
        },
        update: {},
      });
    }
  }
  const n = await prisma.indexSubmission.count({ where: { websiteId: site.id, provider: PROVIDER } });
  console.log(`đã ghi, tổng ${n} URL trong phép thử.`);
  console.log(`\nĐo lại sau 3 và 7 ngày:  tsx scripts/index-experiment.ts`);
  await prisma.$disconnect();
}
main();
