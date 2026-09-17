import fs from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { createPublisherKey } from "@/lib/settings/api-key";

/**
 * Cấp một khoá cho MỖI publisher và ghi thành bảng {host: khoá} vào một FILE.
 *
 *   tsx scripts/mint-build-keys.ts --out /đường/dẫn/keys.json [--label "..."]
 *
 * VÌ SAO TỒN TẠI
 *
 * Khoá HQ giới hạn theo publisher: một khoá đọc được đúng một publisher. Đúng
 * khi mỗi site là một bản build riêng. Từ khi MỘT bản build phục vụ nhiều
 * site, việc build cần khoá của MỌI site — nó dựng sẵn trang cho tất cả.
 *
 * Trên máy chủ, file .hq-key đã giữ đủ bảng đó. CI thì không có file; nó chỉ
 * có một biến HQ_API_KEY mang đúng một chuỗi. Đo 17/9/2026, lần build đầu có
 * hai site: mọi trang của site thứ hai gãy 403 và build dừng.
 *
 * KHÔNG IN KHOÁ. Chỉ in host, 13 ký tự đầu và id để thu hồi. Bảng đi thẳng
 * vào file với quyền 0600; nạp vào CI bằng `gh secret set HQ_API_KEYS < file`,
 * rồi xoá file. Khoá không bao giờ đi qua màn hình, argv hay log.
 */

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
}

async function main() {
  const out = arg("--out");
  if (!out) {
    console.error("Cần --out <đường dẫn file>. Khoá chỉ đi vào file, không ra màn hình.");
    process.exit(1);
  }
  if (fs.existsSync(out)) {
    console.error(`✗ ${out} đã tồn tại. Từ chối ghi đè — file cũ có thể đang giữ khoá còn sống.`);
    process.exit(1);
  }

  const sites = await prisma.website.findMany({
    select: { id: true, name: true, url: true },
    orderBy: { createdAt: "asc" },
  });
  if (sites.length === 0) {
    console.error("✗ Chưa có publisher nào trong HQ.");
    process.exit(1);
  }

  const label = arg("--label") ?? "khoá build cho CI";
  const map: Record<string, string> = {};
  const issued: { host: string; prefix: string; id: string }[] = [];

  for (const site of sites) {
    const host = hostOf(site.url);
    const { key, id } = await createPublisherKey(site.id, label);
    map[host] = key;
    issued.push({ host, prefix: `${key.slice(0, 13)}…`, id });
  }

  // Ghi với quyền 0600 NGAY LÚC TẠO, không phải chmod sau: giữa hai lệnh đó có
  // một khoảng file nằm đó với quyền mặc định, và trên máy nhiều người dùng
  // khoảng đó là đủ.
  fs.writeFileSync(out, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 });

  console.log(`Đã cấp ${issued.length} khoá và ghi bảng vào ${out} (quyền 0600).`);
  for (const i of issued) console.log(`  ${i.host.padEnd(28)} ${i.prefix}  id=${i.id}`);
  console.log("\nNạp vào CI:  gh secret set HQ_API_KEYS < " + out);
  console.log("Rồi XOÁ file. Khoá cũ của CI nên thu hồi sau khi bản build mới xanh.");
}

void main().finally(() => prisma.$disconnect());
