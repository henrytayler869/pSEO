import { prisma } from "@/lib/db/prisma";
import { mintKey, PREFIX_LEN } from "@/lib/api/publisher-key";

/**
 * Khoá API — giờ mỗi publisher một khoá, không còn một khoá dùng chung.
 *
 * Bí mật ở đây KHÔNG lưu nguyên văn, khác với mọi bí mật còn lại trong bảng
 * Website (wpAppPassword, revalidateSecret). Đó là chủ ý, không phải bất
 * nhất: những cái kia HQ phải GỬI ĐI nên buộc phải đọc lại được; khoá này HQ
 * chỉ cần ĐỐI CHIẾU, nên nó không cần đọc lại được — và cái không cần đọc
 * lại được thì không nên lưu ở dạng đọc lại được.
 *
 * Hệ quả cần biết trước khi bấm: khoá hiện đúng một lần, lúc sinh ra. Mất là
 * sinh khoá mới, không phải đi tìm lại.
 */

export type PublisherKeyRow = {
  id: string;
  label: string;
  masked: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

function mask(keyPrefix: string): string {
  return `${keyPrefix}${"•".repeat(12)}`;
}

/** Sinh khoá cho một publisher. Trả về giá trị đầy đủ ĐÚNG MỘT LẦN — không
 * hàm nào khác trong hệ này đọc lại được nó. */
export async function createPublisherKey(websiteId: string, label: string): Promise<{ key: string; id: string }> {
  const { key, keyPrefix, keyHash } = mintKey();
  const row = await prisma.publisherApiKey.create({
    data: { websiteId, keyPrefix, keyHash, label: label.trim() || "không đặt tên" },
    select: { id: true },
  });
  return { key, id: row.id };
}

export async function listPublisherKeys(websiteId: string): Promise<PublisherKeyRow[]> {
  const rows = await prisma.publisherApiKey.findMany({
    where: { websiteId },
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    select: { id: true, label: true, keyPrefix: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
  return rows.map(({ keyPrefix, ...r }) => ({ ...r, masked: mask(keyPrefix) }));
}

/** Đánh dấu thu hồi, không xoá hàng: sau một lần lộ khoá, câu hỏi đầu tiên
 * là "khoá đó dùng lần cuối lúc nào" và xoá hàng là xoá mất câu trả lời. */
export async function revokePublisherKey(id: string): Promise<void> {
  await prisma.publisherApiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
}

/**
 * Khoá dùng chung cũ — hàng có websiteId null, đọc được MỌI niche.
 *
 * Trả về để màn hình Settings hiện nó ra như một thứ đang đếm ngược, kèm mốc
 * dùng lần cuối. Mốc đó là điều kiện để thu hồi: không có nó thì "thu hồi có
 * làm chết site nào không" là câu hỏi không ai trả lời được, và người ta sẽ
 * chọn không thu hồi — tức là khoá sống mãi.
 */
export async function getLegacyKeyStatus(): Promise<{
  exists: boolean;
  masked?: string;
  lastUsedAt?: Date | null;
  revokedAt?: Date | null;
}> {
  const row = await prisma.publisherApiKey.findFirst({
    where: { websiteId: null },
    orderBy: { createdAt: "desc" },
    select: { keyPrefix: true, lastUsedAt: true, revokedAt: true },
  });
  if (!row) return { exists: false };
  return { exists: true, masked: mask(row.keyPrefix), lastUsedAt: row.lastUsedAt, revokedAt: row.revokedAt };
}

export async function revokeLegacyKey(): Promise<void> {
  await prisma.publisherApiKey.updateMany({ where: { websiteId: null, revokedAt: null }, data: { revokedAt: new Date() } });
}

export { PREFIX_LEN };
