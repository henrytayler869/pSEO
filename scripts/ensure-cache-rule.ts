import { prisma } from "@/lib/db/prisma";
import { getCredential } from "@/lib/settings/credentials";

/**
 * Chép quy tắc cache HTML từ một zone đã chạy sang một zone mới.
 *
 *   tsx scripts/ensure-cache-rule.ts --name <domain-mới> --like <domain-nguồn>
 *
 * VÌ SAO CẦN — MỘT CHÊNH LỆCH KHÔNG TỰ LỘ RA
 *
 * Cloudflare MẶC ĐỊNH không cache HTML, kể cả khi origin gửi
 * `s-maxage=86400`. Zone cũ có quy tắc; zone mới thì không. Đo 17/9/2026,
 * ngay sau khi bật đám mây cam cho publisher thứ hai:
 *
 *   atmovingservices.com    cf=HIT       s-maxage=86400
 *   theaccidentrecord.com   cf=DYNAMIC   s-maxage=86400   ← cùng header
 *
 * Không có gì hỏng: trang vẫn 200, nội dung vẫn đúng. Chỉ là mọi request HTML
 * chạm thẳng VPS, và cả kiến trúc revalidate — /api/revalidate tồn tại để
 * purge lớp biên — trở thành purge một thứ rỗng. Site thứ ba sẽ gặp lại đúng
 * chỗ này, nên nó là một lệnh chứ không phải một cú bấm trong dashboard.
 *
 * CHÉP chứ không tự viết: quy tắc của zone đang chạy là đặc tả duy nhất đã
 * được kiểm chứng bằng việc nó đang chạy. Viết lại từ trí nhớ là tạo bản thứ
 * hai của một thứ chỉ đúng khi giống hệt bản thứ nhất.
 */

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

interface Rule {
  action: string;
  action_parameters?: unknown;
  description?: string;
  enabled?: boolean;
  expression: string;
}

async function cf(path: string, token: string, init?: { method: string; body?: unknown }): Promise<unknown> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: "no-store",
  });
  const j = (await res.json()) as { success: boolean; result?: unknown; errors?: unknown };
  if (!j.success) {
    throw new Error(`Cloudflare từ chối (HTTP ${res.status}) ${path}: ${JSON.stringify(j.errors).slice(0, 300)}`);
  }
  return j.result;
}

async function zoneIdOf(name: string): Promise<string> {
  const d = await prisma.domain.findFirst({ where: { name }, select: { cloudflareZoneId: true } });
  if (!d?.cloudflareZoneId) throw new Error(`Domain "${name}" chưa có zone Cloudflare trong HQ.`);
  return d.cloudflareZoneId;
}

/** Quy tắc cache ở tầng zone, nếu có. */
async function cacheRules(zoneId: string, token: string): Promise<Rule[]> {
  const list = (await cf(`/zones/${zoneId}/rulesets?phase=http_request_cache_settings`, token)) as {
    id: string;
    phase: string;
    kind: string;
  }[];
  const entry = list.find((x) => x.phase === "http_request_cache_settings" && x.kind === "zone");
  if (!entry) return [];
  const full = (await cf(`/zones/${zoneId}/rulesets/${entry.id}`, token)) as { rules?: Rule[] };
  return full.rules ?? [];
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
  const existing = await cacheRules(target, token);
  if (existing.length > 0) {
    console.log(`"${name}" ĐÃ có ${existing.length} quy tắc cache — không đụng tới.`);
    for (const r of existing) console.log(`  ${r.description ?? r.action}: ${r.expression.slice(0, 80)}`);
    console.log("  Ghi đè quy tắc đang chạy là đổi hành vi cache của một site đang phục vụ.");
    return;
  }

  const model = await cacheRules(source, token);
  if (model.length === 0) {
    console.error(`✗ Zone nguồn "${like}" KHÔNG có quy tắc cache nào để chép.`);
    process.exit(1);
  }

  /**
   * Thay host trong biểu thức. Chỉ đổi tên miền, giữ nguyên mọi thứ khác —
   * biểu thức của site đầu loại trừ `/api/`, và đánh mất vế đó sẽ làm
   * Cloudflare cache cả /api/revalidate và /api/version.
   */
  /**
   * DANH SÁCH CHO PHÉP, không phải `...r`.
   *
   * Quy tắc đọc về mang theo `id`, `ref`, `version`, `last_updated` — danh
   * tính của quy tắc NGUỒN. Cloudflare từ chối thẳng khi tạo mới:
   *
   *   400 code 20173: the rule public id cannot be provided on ruleset creation
   *
   * Từ chối ồn ào ở đây là may. Một trường lạ khác có thể được nhận âm thầm và
   * mang theo trạng thái của zone khác.
   */
  const rules = model.map((r) => ({
    action: r.action,
    action_parameters: r.action_parameters,
    description: r.description,
    enabled: r.enabled,
    expression: r.expression.replace(
      new RegExp(`"(?:www\\.)?${like.replace(/\./g, "\\.")}"`, "g"),
      (m) => (m.includes("www.") ? `"www.${name}"` : `"${name}"`)
    ),
  }));

  for (const r of rules) {
    if (r.expression.includes(like)) {
      console.error(`✗ Biểu thức còn sót tên miền nguồn sau khi thay:\n  ${r.expression}`);
      console.error("  Dừng lại: một quy tắc mang host của site khác thì không bao giờ khớp, và");
      console.error("  nó sẽ trông như đã cấu hình xong.");
      process.exit(1);
    }
  }

  await cf(`/zones/${target}/rulesets/phases/http_request_cache_settings/entrypoint`, token, {
    method: "PUT",
    body: { rules },
  });

  console.log(`Đã chép ${rules.length} quy tắc cache từ ${like} sang ${name}:`);
  for (const r of rules) console.log(`  ${r.description ?? r.action}: ${r.expression}`);
  console.log(`\nKiểm: curl -sI https://${name}/ | grep cf-cache-status — lần hai phải là HIT.`);
}

void main().finally(() => prisma.$disconnect());
