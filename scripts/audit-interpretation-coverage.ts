import { prisma } from "@/lib/db/prisma";
import { resolveSite } from "@/lib/scripts/resolve-site";
import { groupByPage, auditPage, summarize, exitCodeFor, type InventoryEntry, type PageCoverage } from "@/lib/ai/coverage";

/**
 * Cổng canh cho một sự cố IM LẶNG: trang publish mất đoạn diễn giải mà không
 * gì kêu lên.
 *
 *   node_modules/.bin/tsx scripts/audit-interpretation-coverage.ts [--site <id|tên>]
 *
 * Thoát mã 1 khi có trang ở trạng thái `stale` — đã trả tiền sinh đoạn nhưng
 * site không nhận được. In ra thôi thì không phải cổng: thứ này hỏng đúng
 * vào lúc không ai đang nhìn màn hình.
 *
 * `never` KHÔNG làm đỏ. Chưa sinh đoạn cho một trang là việc còn phải làm,
 * không phải hồi quy — gộp hai thứ vào một cảnh báo là cách biến cảnh báo
 * thành thứ người ta tắt.
 *
 * CHẬM có chủ ý: mỗi trang dựng lại fact set qua đúng hàm mà endpoint dùng.
 * Một bản nhanh hơn sẽ phải tự cài lại phép so fingerprint, tức là dựng định
 * nghĩa thứ hai về "đoạn này còn dùng được không" — và định nghĩa thứ hai sẽ
 * trôi lệch khỏi cái thật đúng vào lúc không ai nhìn. Chạy theo lịch, không
 * chạy trong request.
 */

function bar(n: number, total: number, width = 28): string {
  const filled = total === 0 ? 0 : Math.round((n / total) * width);
  return "█".repeat(filled) + "·".repeat(width - filled);
}

async function main() {
  const site = await resolveSite<{ id: string; url: string; vertical: string; name: string }>({
    select: { name: true },
  });
  console.log(`${site.name} — niche ${site.vertical}`);

  const invUrl = `${site.url.replace(/\/+$/, "")}/api/inventory`;
  const res = await fetch(invUrl, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    console.error(`✗ ${invUrl} trả ${res.status}. Không có inventory thì không biết site publish gì — xem guide §3.9.`);
    process.exit(1);
  }
  const inv = (await res.json()) as { entries?: InventoryEntry[] };
  if (!inv.entries?.length) {
    console.error(`✗ ${invUrl} không liệt kê trang nào.`);
    process.exit(1);
  }

  const pages = groupByPage(inv.entries);
  console.log(`${inv.entries.length} ZIP → ${pages.length} trang. Đang soi từng trang qua đúng hàm mà endpoint dùng…\n`);

  const done: PageCoverage[] = [];
  for (const p of pages) {
    done.push(await auditPage(site.vertical, p));
    if (done.length % 25 === 0) process.stdout.write(`  …${done.length}/${pages.length}\n`);
  }

  const r = summarize(done);
  const total = r.pages.length;
  console.log("");
  console.log(`  có chữ    ${String(r.fresh).padStart(4)}  ${bar(r.fresh, total)}`);
  console.log(`  MẤT CHỮ   ${String(r.stale).padStart(4)}  ${bar(r.stale, total)}   đã trả tiền, site không nhận được`);
  console.log(`  chưa làm  ${String(r.never).padStart(4)}  ${bar(r.never, total)}`);

  if (r.stale > 0) {
    const byKind = { market: 0, cluster: 0 };
    for (const p of r.pages) if (p.state === "stale") byKind[p.kind]++;
    console.log(`\n${r.stale} trang mất chữ (${byKind.market} thị trường, ${byKind.cluster} cụm). Mười trang đầu:`);
    for (const p of r.pages.filter((x) => x.state === "stale").slice(0, 10)) {
      console.log(`  ${p.path}${p.zips.length > 1 ? `  (${p.zips.length} ZIP)` : ""}`);
    }
    console.log(
      "\nNguyên nhân gần như luôn là: đã thu thập thêm dữ liệu, factsFingerprint đổi,\n" +
        "và mọi đoạn viết trước đó bị coi như không tồn tại. Sinh lại để lấy lại chữ."
    );
  }

  await prisma.$disconnect();
  // Quyết định nằm ở exitCodeFor, không viết lại tại đây — xem chú thích của
  // nó về lý do. Đừng chạy script này qua `| grep`: đường ống nuốt mã thoát.
  process.exit(exitCodeFor(r));
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
