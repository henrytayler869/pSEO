import { prisma } from "@/lib/db/prisma";
import { getCredential } from "@/lib/settings/credentials";
import { copyCacheRules, HostLeftInRuleError } from "@/lib/cloudflare/cache-rule";

/**
 * Chép quy tắc cache HTML từ một zone đã chạy sang một zone mới.
 *
 *   tsx scripts/ensure-cache-rule.ts --name <domain-mới> --like <domain-nguồn>
 *
 * Lý do tồn tại, và vì sao CHÉP chứ không tự viết: xem
 * `lib/cloudflare/cache-rule.ts`. File này chỉ là lớp dòng lệnh.
 *
 * VÌ SAO VẪN GIỮ LỆNH NÀY khi `provisionSite` đã tự làm: nút Dựng Site chọn zone
 * nguồn tự động (zone đầu tiên CÓ quy tắc). Khi cần chỉ rõ nguồn — ví dụ hai
 * zone cũ đã trôi khác nhau và chỉ một cái đúng — thì `--like` là đường duy
 * nhất nói ra điều đó.
 */

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

async function zoneIdOf(name: string): Promise<string> {
  const d = await prisma.domain.findFirst({ where: { name }, select: { cloudflareZoneId: true } });
  if (!d?.cloudflareZoneId) throw new Error(`Domain "${name}" chưa có zone Cloudflare trong HQ.`);
  return d.cloudflareZoneId;
}

async function main() {
  const name = arg("--name")?.trim().toLowerCase();
  const like = arg("--like")?.trim().toLowerCase();
  if (!name || !like) {
    console.error("Cần --name <domain-mới> và --like <domain-nguồn>.");
    process.exit(1);
  }

  const token = await getCredential("CLOUDFLARE_API_TOKEN");
  if (!token) {
    console.error("Chưa có CLOUDFLARE_API_TOKEN trong Cài đặt.");
    process.exit(1);
  }

  const [target, source] = await Promise.all([zoneIdOf(name), zoneIdOf(like)]);

  let result;
  try {
    result = await copyCacheRules({
      token,
      targetZoneId: target,
      targetHost: name,
      sourceZoneId: source,
      sourceHost: like,
    });
  } catch (e) {
    if (e instanceof HostLeftInRuleError) {
      console.error(`✗ ${e.message}`);
      console.error("  Dừng lại thay vì ghi một quy tắc không bao giờ khớp.");
      process.exit(1);
    }
    throw e;
  }

  if (result.status === "already") {
    console.log(`"${name}" ĐÃ có ${result.rules.length} quy tắc cache — không đụng tới.`);
    for (const r of result.rules) console.log(`  ${r.description ?? r.action}: ${r.expression.slice(0, 80)}`);
    console.log("  Ghi đè quy tắc đang chạy là đổi hành vi cache của một site đang phục vụ.");
    return;
  }

  if (result.status === "no-source") {
    console.error(`✗ Zone nguồn "${like}" KHÔNG có quy tắc cache nào để chép.`);
    process.exit(1);
  }

  console.log(`Đã chép ${result.rules.length} quy tắc cache từ ${like} sang ${name}:`);
  for (const r of result.rules) console.log(`  ${r.description ?? r.action}: ${r.expression}`);
  console.log(`\nKiểm: curl -sI https://${name}/ | grep cf-cache-status`);
  console.log("  Phải chuyển từ DYNAMIC sang MISS/HIT. DYNAMIC = không đủ điều kiện cache;");
  console.log("  MISS = đủ điều kiện, node biên này chưa lưu. MISS/HIT đổi qua lại là bình thường.");
}

void main().finally(() => prisma.$disconnect());
