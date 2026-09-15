import { prisma } from "@/lib/db/prisma";
import { getCredential, clearCredential } from "@/lib/settings/credentials";
import { hashKey, PREFIX_LEN } from "@/lib/api/publisher-key";

/**
 * Chuyển khoá dùng chung cũ từ AppConfig (nguyên văn) vào bảng
 * PublisherApiKey (băm), để đường xác thực chỉ còn MỘT nhánh.
 *
 * Vì sao là script chứ không phải SQL trong migration: băm cần SHA-256, mà
 * Postgres chỉ có digest() khi bật pgcrypto — thêm một extension cho một
 * hàng dữ liệu là đổi hình dạng database vĩnh viễn để tiết kiệm một lần chạy.
 *
 * THỨ TỰ. Chạy script này SAU migration và TRƯỚC khi deploy mã mới. Deploy
 * trước thì mã mới đọc bảng rỗng và site đang chạy mất xác thực.
 *
 * KHÔNG in khoá ra. Chỉ in prefix — đủ để đối chiếu, không đủ để dùng.
 *
 *   node_modules/.bin/tsx scripts/backfill-legacy-api-key.ts
 *   node_modules/.bin/tsx scripts/backfill-legacy-api-key.ts --clear-legacy-plaintext
 *
 * Cờ thứ hai là BƯỚC RIÊNG, chạy sau khi deploy đã ổn định: nó xoá bản
 * nguyên văn trong AppConfig. Gộp vào bước một thì một lần rollback sẽ trả
 * về mã cũ — thứ chỉ đọc AppConfig — và không còn gì ở đó để đọc.
 */

const FIELD = "PSEO_API_KEY";

async function main() {
  const clearPlaintext = process.argv.includes("--clear-legacy-plaintext");

  const existing = await prisma.publisherApiKey.findMany({
    where: { websiteId: null },
    select: { id: true, keyPrefix: true, revokedAt: true, lastUsedAt: true },
  });

  if (clearPlaintext) {
    if (existing.length === 0) {
      console.error("✗ Chưa có hàng khoá dùng chung nào trong PublisherApiKey. Chạy bước 1 trước.");
      process.exit(1);
    }
    const plaintext = await getCredential(FIELD);
    if (!plaintext) {
      console.log("Bản nguyên văn trong AppConfig đã không còn. Không có gì để làm.");
      return;
    }
    await clearCredential(FIELD);
    console.log(`✓ Đã xoá bản nguyên văn ${FIELD} khỏi AppConfig. Khoá giờ chỉ tồn tại dạng băm.`);
    return;
  }

  if (existing.length > 0) {
    // Ràng buộc "chỉ một khoá không giới hạn" nằm ở đây chứ không ở database
    // — xem ghi chú trong prisma/schema.prisma về vì sao không dùng partial
    // unique index.
    console.log(`Đã có ${existing.length} khoá dùng chung trong bảng, không thêm nữa:`);
    for (const r of existing) {
      console.log(`  ${r.keyPrefix}…  ${r.revokedAt ? "đã thu hồi" : "còn sống"}  ·  dùng lần cuối ${r.lastUsedAt?.toISOString() ?? "chưa lần nào"}`);
    }
    return;
  }

  const plaintext = await getCredential(FIELD);
  if (!plaintext) {
    console.log("Không có khoá dùng chung trong AppConfig. Không cần chuyển — mọi publisher dùng khoá riêng ngay từ đầu.");
    return;
  }

  const keyPrefix = plaintext.slice(0, PREFIX_LEN);
  await prisma.publisherApiKey.create({
    data: {
      websiteId: null,
      keyPrefix,
      keyHash: hashKey(plaintext),
      label: "khoá dùng chung cũ — chuyển từ AppConfig, cần thu hồi sau khi mọi publisher đã có khoá riêng",
    },
  });

  console.log(`✓ Đã chuyển khoá dùng chung vào PublisherApiKey: ${keyPrefix}…`);
  console.log("  Nó vẫn đọc được MỌI niche. Bản nguyên văn trong AppConfig vẫn còn — cố ý, để rollback không làm đứt site.");
  console.log("  Sau khi deploy ổn định: chạy lại với --clear-legacy-plaintext.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
