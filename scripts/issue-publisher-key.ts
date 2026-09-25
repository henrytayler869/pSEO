import { prisma } from "@/lib/db/prisma";
import { createPublisherKey, revokePublisherKey } from "@/lib/settings/api-key";
import { pushKeyToSite } from "@/lib/publisher/push-key";
import { resolveSite } from "@/lib/scripts/resolve-site";
import { positionals } from "@/lib/scripts/argv";
import { resolveCourier } from "@/lib/publisher/couriers";

/**
 * Cấp khoá cho một publisher và đẩy thẳng sang site — bản dòng lệnh của cái
 * nút trong UI, gọi đúng hai hàm đó.
 *
 *   node_modules/.bin/tsx scripts/issue-publisher-key.ts --site <id|tên> [nhãn]
 *   … --via <id site khác>   đẩy QUA site đó, khi site đích chưa trả lời được
 *
 * KHÔNG IN KHOÁ. Không in ra stdout, không ghi vào file, không vào log. Khoá
 * chỉ tồn tại trong bộ nhớ tiến trình này đúng quãng giữa lúc sinh ra và lúc
 * gửi đi; HQ giữ bản băm, site giữ bản thật. Đó là lý do cấp được khoá mà
 * không ai — kể cả người chạy lệnh — phải nhìn thấy nó.
 *
 * ĐẨY HỤT THÌ THU HỒI NGAY. HQ chỉ lưu băm, nên một khoá đã tạo mà không tới
 * được site là khoá không ai cầm: không dùng được, không lấy lại được, và
 * nằm đó trông như một khoá còn sống. Để lại thì lần sau nhìn bảng sẽ không
 * biết cái nào thật.
 */

async function main() {
  const site = await resolveSite<{
    id: string;
    url: string;
    vertical: string;
    name: string;
    revalidateSecret: string | null;
  }>({ select: { name: true, revalidateSecret: true } });
  const label = positionals()[0] ?? "cấp bằng scripts/issue-publisher-key.ts";

  console.log(`publisher : ${site.name}  (${site.url})`);
  console.log(`niche     : ${site.vertical}`);

  // `--via` giải quyết TRƯỚC khi sinh khoá, cùng lý do như trong action: khoá
  // đã tạo mà đẩy hụt là khoá phải thu hồi, nên thứ biết trước được thì kiểm
  // trước. Xem lib/publisher/couriers.ts về vì sao đường này tới đúng chỗ.
  const viaIdx = process.argv.indexOf("--via");
  const viaId = viaIdx >= 0 ? process.argv[viaIdx + 1] : undefined;
  let via: { url: string; revalidateSecret: string; name: string } | undefined;
  if (viaId) {
    const resolved = await resolveCourier(viaId, site.id);
    if ("error" in resolved) {
      console.error(`\n✗ ${resolved.error}`);
      process.exit(1);
    }
    via = resolved;
    console.log(`trung chuyển: ${via.name} (${via.url})`);
  }

  if (!via && !site.revalidateSecret) {
    console.error("\n✗ Site này chưa có revalidate secret, nên không đẩy khoá sang được.");
    console.error("  Đặt secret ở trang Publisher trước, hoặc đẩy qua site khác bằng --via <id site>.");
    process.exit(1);
  }

  const { key, id } = await createPublisherKey(site.id, label);
  console.log(`\nĐã sinh khoá ${key.slice(0, 13)}…  (phần còn lại không in ra)`);

  const push = await pushKeyToSite(site, key, via);
  if (!push.ok) {
    await revokePublisherKey(id);
    console.error(`\n✗ Đẩy hụt: ${push.detail}`);
    console.error("  Đã thu hồi khoá vừa tạo — HQ chỉ lưu băm, nên một khoá không tới được site là khoá không ai cầm.");
    process.exit(1);
  }

  console.log(`✓ ${push.detail}`);
  console.log("  Site đang dùng khoá mới. Không ai phải mở .env, và khoá chưa từng hiện ra màn hình nào.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
