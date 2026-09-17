import { prisma } from "@/lib/db/prisma";

/**
 * Chép revalidate secret từ một Website sang một Website khác.
 *
 *   tsx scripts/share-revalidate-secret.ts --from <host|url> --to <host|url>
 *
 * VÌ SAO CẦN — MỘT SEAM CỦA KIẾN TRÚC, KHÔNG PHẢI MỘT TIỆN ÍCH
 *
 * `REVALIDATE_SECRET` là biến môi trường của BẢN TRIỂN KHAI publisher. Từ khi
 * một app phục vụ nhiều domain, mọi site trên cùng bản triển khai dùng CHUNG
 * đúng một secret — endpoint /api/hq-key và /api/revalidate so với
 * `process.env.REVALIDATE_SECRET`, và nó không biết gì về host.
 *
 * Nhưng HQ lưu secret đó theo TỪNG Website. Hai mô hình lệch nhau, và chỗ
 * lệch lộ ra đúng lúc nối site thứ hai: site mới có secret rỗng, nên nút đẩy
 * khoá báo "chưa có revalidate secret" — một câu đúng về dữ liệu HQ và vô
 * nghĩa về thực tế, vì secret ĐANG chạy trên chính máy chủ đó.
 *
 * KHÔNG IN SECRET. Không ra stdout, không vào log, không qua tham số dòng
 * lệnh. Giá trị chỉ đi từ hàng này sang hàng kia bên trong một transaction;
 * người chạy lệnh không cần thấy nó, và không nên thấy.
 *
 * KHÔNG ghi đè khi đích đã có secret. Đích đã có nghĩa là hoặc nó đã đúng,
 * hoặc nó thuộc một bản triển khai khác — cả hai trường hợp, đè lên là làm
 * chết một đường đang chạy để sửa một đường chưa chạy.
 */

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function hostOf(raw: string): string {
  const s = raw.trim().toLowerCase();
  try {
    return new URL(s.includes("://") ? s : `https://${s}`).hostname.replace(/^www\./, "");
  } catch {
    return s;
  }
}

async function findByHost(host: string) {
  const all = await prisma.website.findMany({
    select: { id: true, url: true, name: true, revalidateSecret: true },
  });
  return all.find((w) => hostOf(w.url) === host) ?? null;
}

async function main() {
  const fromRaw = arg("--from");
  const toRaw = arg("--to");
  if (!fromRaw || !toRaw) {
    console.error("Cần --from <host|url> và --to <host|url>.");
    process.exit(1);
  }

  const from = await findByHost(hostOf(fromRaw));
  const to = await findByHost(hostOf(toRaw));
  if (!from) { console.error(`✗ Không thấy Website nào cho "${fromRaw}".`); process.exit(1); }
  if (!to) { console.error(`✗ Không thấy Website nào cho "${toRaw}".`); process.exit(1); }
  if (from.id === to.id) { console.error("✗ --from và --to là cùng một site."); process.exit(1); }

  if (!from.revalidateSecret) {
    console.error(`✗ "${from.url}" chưa có revalidate secret — không có gì để chép.`);
    process.exit(1);
  }
  if (to.revalidateSecret) {
    console.log(`"${to.url}" ĐÃ có revalidate secret — không đụng tới.`);
    console.log("  Đích đã có nghĩa là hoặc nó đã đúng, hoặc nó thuộc bản triển khai khác.");
    console.log("  Cả hai trường hợp, đè lên là làm chết một đường đang chạy để sửa một đường chưa chạy.");
    return;
  }

  await prisma.website.update({
    where: { id: to.id },
    data: { revalidateSecret: from.revalidateSecret },
  });

  console.log(`Đã chép revalidate secret: ${from.url} → ${to.url}`);
  console.log("  Giá trị không được in ra, không vào log, không qua tham số dòng lệnh.");
  console.log(`  Kiểm: nút đẩy khoá cho ${to.url} giờ phải chạy được.`);
}

void main().finally(() => prisma.$disconnect());
