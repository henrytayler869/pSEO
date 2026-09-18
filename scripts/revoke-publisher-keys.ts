import { prisma } from "@/lib/db/prisma";
import { revokePublisherKey } from "@/lib/settings/api-key";

/**
 * Thu hồi khoá publisher theo tiền tố.
 *
 *   tsx scripts/revoke-publisher-keys.ts --prefix pseo_aaaaaaaa --prefix pseo_bbbbbbbb [--yes]
 *
 * Không có --yes thì chỉ IN RA dự định, không đụng gì. Thu hồi nhầm một khoá
 * đang chạy làm site nhận 401 từ HQ và phục vụ trang đã cache cho tới khi có
 * người đẩy khoá mới — hỏng chậm, và hỏng ở nơi không ai đang nhìn.
 *
 * ═══ RÀNG BUỘC KIỂM ĐƯỢC: MỖI SITE PHẢI CÒN ÍT NHẤT MỘT KHOÁ SỐNG ═══
 *
 * Đây là thứ duy nhất ở đây kiểm được bằng dữ liệu, nên nó là thứ được ép.
 * "Khoá này có đang nằm trên máy chủ không" thì HQ KHÔNG biết — HQ chỉ giữ
 * bản băm, và đó là chủ ý. Nên lệnh này không giả vờ biết; nó chặn đúng cái
 * hậu quả nặng nhất: một site bị thu hồi sạch khoá.
 *
 * Phần còn lại — "khoá này có phải khoá đang dùng không" — là việc của người
 * chạy lệnh, và cách duy nhất để biết là đọc tiền tố trên chính máy chủ:
 *
 *   node -e 'console.log(require("/srv/<app>/.hq-key"))'
 */

function args(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && i + 1 < process.argv.length) out.push(process.argv[i + 1]);
  }
  return out;
}

async function main() {
  const prefixes = args("--prefix").map((p) => p.trim());
  const confirmed = process.argv.includes("--yes");
  if (prefixes.length === 0) {
    console.error("Cần ít nhất một --prefix. Thêm --yes để thực sự thu hồi.");
    process.exit(1);
  }

  const all = await prisma.publisherApiKey.findMany({
    include: { website: { select: { url: true } } },
    orderBy: { createdAt: "asc" },
  });

  const targets = all.filter((k) => prefixes.includes(k.keyPrefix));
  const missing = prefixes.filter((p) => !all.some((k) => k.keyPrefix === p));
  if (missing.length) {
    console.error(`✗ Không có khoá nào mang tiền tố: ${missing.join(", ")}`);
    process.exit(1);
  }

  const already = targets.filter((k) => k.revokedAt);
  const live = targets.filter((k) => !k.revokedAt);

  /**
   * Sau khi thu hồi, mỗi site còn bao nhiêu khoá sống.
   *
   * Đếm TRƯỚC khi ghi, và từ chối cả lô nếu có site nào về 0. Từ chối cả lô
   * chứ không bỏ qua từng cái: một lệnh thu hồi chạy một nửa để lại trạng
   * thái mà người chạy không mô tả được.
   */
  const remaining = new Map<string, number>();
  for (const k of all) {
    if (k.revokedAt) continue;
    if (targets.some((t) => t.id === k.id)) continue;
    const host = k.website?.url ?? "(không rõ)";
    remaining.set(host, (remaining.get(host) ?? 0) + 1);
  }

  console.log(`${live.length} khoá sẽ thu hồi${already.length ? `, ${already.length} đã thu hồi từ trước (bỏ qua)` : ""}:\n`);
  for (const k of live) {
    const host = (k.website?.url ?? "?").replace(/^https?:\/\//, "");
    const used = k.lastUsedAt ? k.lastUsedAt.toISOString().replace("T", " ").slice(0, 16) : "CHƯA DÙNG";
    console.log(`  ${k.keyPrefix}  ${host.padEnd(24)} dùng lần cuối ${used}`);
    console.log(`      ${k.label ?? ""}`);
  }

  const starved = [...new Set(live.map((k) => k.website?.url ?? "(không rõ)"))].filter(
    (host) => (remaining.get(host) ?? 0) === 0
  );
  if (starved.length) {
    console.error(`\n✗ TỪ CHỐI: những site này sẽ không còn khoá sống nào:`);
    for (const h of starved) console.error(`  ${h}`);
    console.error("  Site mất hết khoá sẽ nhận 401 từ HQ và phục vụ trang đã cache cho tới khi có người đẩy khoá mới.");
    process.exit(1);
  }

  console.log("\nCòn lại sau khi thu hồi:");
  for (const [host, n] of [...remaining.entries()].sort()) {
    console.log(`  ${host.replace(/^https?:\/\//, "").padEnd(24)} ${n} khoá sống`);
  }

  if (!confirmed) {
    console.log("\n(chạy thử — chưa đụng gì. Thêm --yes để thu hồi thật.)");
    return;
  }

  for (const k of live) await revokePublisherKey(k.id);
  console.log(`\nĐã thu hồi ${live.length} khoá.`);
  console.log("Kiểm ngay: hai site phải vẫn phục vụ, và CI phải vẫn xanh.");
}

void main().finally(() => prisma.$disconnect());
