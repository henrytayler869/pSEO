// Thứ tự nên bấm "Request Indexing" trong Search Console.
//
// Nút đó là thao tác TAY, mỗi lần một URL, hạn mức khoảng 10–13 URL/ngày —
// Google không mở nó ra API (đọc discovery document 13/9/2026:
// urlInspection chỉ có đúng một phương thức, `inspect`). Với 158 trang thì
// phải chọn, và script này chọn.
//
// Hub bang đứng trước trang thị trường, dù volume của hub thấp hơn: index
// một hub là mở đường crawl tới mọi trang nó trỏ tới, còn index một trang
// thị trường chỉ được đúng trang đó. Đây là ưu tiên theo CẤU TRÚC, không
// theo nhu cầu tìm kiếm — nên nó nằm ở nhóm riêng chứ không trộn vào bảng
// xếp theo volume.
//
// Dùng: tsx scripts/index-priority.ts [số URL mỗi ngày]

import { prisma } from "../lib/db/prisma";
import { fetchServedInventory } from "../lib/publisher/inventory";
import { fetchSitemapCounts } from "../lib/sitemap/count";

interface Lead {
  keyword: string;
  volume: number;
}

async function main() {
  const site = await prisma.website.findFirst();
  if (!site) { console.error("Không có website nào."); process.exitCode = 1; return; }

  const [inv, sm] = await Promise.all([fetchServedInventory(site.url), fetchSitemapCounts(site.url)]);

  const identities = await prisma.marketIdentity.findMany({
    where: { vertical: site.vertical },
    select: { zip: true, keywordMetrics: { select: { keyword: true, searchVolume: true } } },
  });

  // Đọc `searchVolume` rồi mới đặt tên `volume`. Bản đầu của script này lưu
  // thẳng bản ghi keywordMetric vào một Map khai kiểu { keyword, volume }, nên
  // `v.volume` là undefined và rơi về 0 — bảng in ra tên từ khoá đúng cạnh
  // con số sai, trông hoàn toàn hợp lý. tsc bắt được, nhưng script nằm ở
  // scratchpad chạy bằng tsx thì không qua typecheck. Đó là lý do nó ở trong
  // repo bây giờ.
  const leadByZip = new Map<string, Lead>();
  for (const i of identities) {
    const top = [...i.keywordMetrics].sort((a, b) => b.searchVolume - a.searchVolume)[0];
    if (top) leadByZip.set(i.zip, { keyword: top.keyword, volume: top.searchVolume });
  }

  // Một trang cụm gộp nhiều ZIP; volume của trang là volume CAO NHẤT trong
  // các thành viên, vì mọi thành viên chung một từ khoá.
  const pages = new Map<string, { volume: number; keyword: string; zips: number; kind: string }>();
  for (const [zip, path] of inv.byZip) {
    const lead = leadByZip.get(zip);
    const cur = pages.get(path);
    if (!cur) {
      pages.set(path, {
        volume: lead?.volume ?? 0,
        keyword: lead?.keyword ?? "(chưa đo)",
        zips: 1,
        kind: inv.kindByZip.get(zip) ?? "?",
      });
      continue;
    }
    cur.zips++;
    if (lead && lead.volume > cur.volume) {
      cur.volume = lead.volume;
      cur.keyword = lead.keyword;
    }
  }

  const hubs = sm.urls
    .map((u) => new URL(u).pathname.replace(/\/+$/, ""))
    .filter((p) => p.split("/").filter(Boolean).length === 2)
    .sort();

  const ranked = [...pages].sort((a, b) => b[1].volume - a[1].volume || a[0].localeCompare(b[0]));
  const perDay = Number(process.argv[2] ?? 10);

  console.log(`${ranked.length} trang thị trường + ${hubs.length} hub bang. Hạn mức ~${perDay} URL/ngày.\n`);

  const zeroVolume = ranked.filter(([, m]) => m.volume === 0).length;
  if (zeroVolume > 0) {
    console.log(`⚠ ${zeroVolume}/${ranked.length} trang chưa tra được volume — chúng xuống cuối, không phải vì nhu cầu bằng 0.\n`);
  }

  /**
   * Trộn hub với trang, không xếp hết hub lên trước.
   *
   * Bản đầu nối [...hubs, ...ranked] và 26 hub chiếm trọn ba ngày đầu — trang
   * volume cao nhất phải chờ tới ngày 4. Hub đáng ưu tiên vì mở đường crawl,
   * nhưng "đáng ưu tiên" không có nghĩa là "chiếm hết".
   *
   * Hub xếp theo TỔNG volume các trang nằm dưới nó, chứ không theo bảng chữ
   * cái: hub NY mở đường tới cụm Brooklyn 18.100 lượt, hub ID thì không.
   */
  const hubValue = new Map<string, number>();
  for (const [path, m] of pages) {
    const hub = "/" + path.split("/").filter(Boolean).slice(0, 2).join("/");
    hubValue.set(hub, (hubValue.get(hub) ?? 0) + m.volume);
  }
  const rankedHubs = [...hubs].sort((a, b) => (hubValue.get(b) ?? 0) - (hubValue.get(a) ?? 0));

  const HUBS_PER_DAY = 3;
  const queue: string[] = [];
  const pageQueue = ranked.map(([p]) => p);
  let h = 0;
  let g = 0;
  while (h < rankedHubs.length || g < pageQueue.length) {
    for (let k = 0; k < HUBS_PER_DAY && h < rankedHubs.length; k++) queue.push(rankedHubs[h++]);
    for (let k = 0; k < perDay - HUBS_PER_DAY && g < pageQueue.length; k++) queue.push(pageQueue[g++]);
  }
  const days = Math.ceil(queue.length / perDay);
  const showDays = Math.min(days, 3);

  for (let d = 0; d < showDays; d++) {
    console.log(`NGÀY ${d + 1}`);
    for (const path of queue.slice(d * perDay, (d + 1) * perDay)) {
      const m = pages.get(path);
      if (!m) {
        const v = hubValue.get(path) ?? 0;
        console.log(`  ${site.url}${path}`.padEnd(70) + `HUB · ${v.toLocaleString("vi-VN")} lượt/tháng nằm dưới nó`);
      } else {
        const vol = m.volume > 0 ? `${m.volume.toLocaleString("vi-VN")} lượt/tháng` : "chưa đo volume";
        console.log(`  ${site.url}${path}`.padEnd(70) + `${vol} · ${m.keyword}${m.kind === "cluster" ? ` · cụm ${m.zips} ZIP` : ""}`);
      }
    }
    console.log();
  }
  if (days > showDays) console.log(`… còn ${days - showDays} ngày nữa cho ${queue.length - showDays * perDay} URL còn lại.`);
  await prisma.$disconnect();
}
main();
