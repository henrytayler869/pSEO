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
  //
  // --dry ĐỌC bảng như lần chạy thật. Ban đầu nó không đọc, để xem trước
  // được khi bảng chưa tồn tại; giờ bảng đã có, và một bản xem trước bỏ qua
  // danh sách loại trừ sẽ in ra một kế hoạch mà lần chạy thật không làm
  // theo — đúng những URL bạn đã bấm tay là những URL nó không biết để bỏ.
  // Xem trước sai còn tệ hơn không có xem trước.
  //
  // Nếu bảng chưa tồn tại (chưa chạy migration), --dry vẫn chạy được và nói
  // rõ là chưa loại trừ được gì, thay vì chết với lỗi Prisma.
  let already: Set<string>;
  try {
    // MỌI provider, không chỉ Omega. Một URL đã bấm tay trong Search
    // Console cũng phải bị loại — nó đã nhận một can thiệp, và để nó
    // vào nhóm đối chứng sẽ làm nhóm đối chứng trông tốt lên vì lý do
    // không liên quan gì tới đối chứng.
    const rows = await prisma.indexSubmission.findMany({
      where: { websiteId: site.id },
      select: { url: true },
    });
    already = new Set(rows.map((r) => r.url));
  } catch (err) {
    if (!dry) throw err;
    console.log("⚠ chưa đọc được bảng IndexSubmission — xem trước NÀY chưa loại trừ gì.");
    console.log(`  (${err instanceof Error ? err.message.split("\n")[0] : String(err)})\n`);
    already = new Set<string>();
  }
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
  // In xen kẽ theo cặp, không gộp nhóm. Điều cần kiểm bằng mắt là hai nhánh
  // có CÂN về độ quan trọng không; in gộp thì hai cột volume nằm cách nhau
  // năm dòng và không so được. Xen kẽ thì lệch cặp nào đập ngay vào mắt.
  const vol = (u: string) => volByPath.get(new URL(u).pathname) ?? 0;
  for (let i = 0; i < Math.min(5, submitted.length); i++) {
    console.log(`  GỬI       ${submitted[i].replace(site.url, "").padEnd(44)} ${String(vol(submitted[i])).padStart(6)} lượt`);
    if (control[i]) console.log(`  đối chứng ${control[i].replace(site.url, "").padEnd(44)} ${String(vol(control[i])).padStart(6)} lượt`);
  }
  if (candidates.length > 10) console.log(`  … và ${candidates.length - 10} URL nữa`);

  // Tổng volume hai nhánh. Chia xen kẽ theo hạng làm hai nhánh cân, nhưng
  // "làm cho cân" và "đã cân" là hai việc khác nhau — với danh sách lẻ hoặc
  // một trang lớn bất thường, chênh lệch có thật. In ra để thấy, vì nếu hai
  // nhánh lệch nhiều thì kết quả đọc được là chênh lệch độ quan trọng chứ
  // không phải tác dụng của dịch vụ.
  const sum = (a: string[]) => a.reduce((t, u) => t + vol(u), 0);
  const [sv, cv] = [sum(submitted), sum(control)];
  const skew = sv + cv === 0 ? 0 : Math.abs(sv - cv) / ((sv + cv) / 2);
  console.log(`\ntổng volume — gửi ${sv}, đối chứng ${cv} (lệch ${(skew * 100).toFixed(1)}%)`);
  if (skew > 0.2) console.log("  ⚠ lệch trên 20%: hai nhánh không so được trực tiếp.");

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
