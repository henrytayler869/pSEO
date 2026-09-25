/**
 * Quy tắc cache HTML ở tầng zone: đọc, và CHÉP từ một zone đang chạy.
 *
 * ═══ VÌ SAO TỒN TẠI ═══
 *
 * Cloudflare MẶC ĐỊNH không cache HTML, kể cả khi origin gửi `s-maxage=86400`.
 * Zone có quy tắc thì trả `cf-cache-status: MISS` rồi `HIT`; zone không có quy
 * tắc trả `DYNAMIC` mãi mãi. Phép phân biệt thật là DYNAMIC vs MISS — `DYNAMIC`
 * nghĩa là KHÔNG ĐỦ ĐIỀU KIỆN cache, `MISS` nghĩa là đủ điều kiện mà node biên
 * này chưa lưu. MISS/HIT đổi qua lại giữa các request là bình thường: mỗi node
 * biên tự lưu lần đầu của nó.
 *
 * Không có gì hỏng khi thiếu quy tắc: trang vẫn 200, nội dung vẫn đúng. Chỉ là
 * mọi request HTML chạm thẳng VPS, và cả kiến trúc revalidate — `/api/revalidate`
 * tồn tại để purge lớp biên — trở thành purge một thứ rỗng.
 *
 * Đo 17/9/2026 (publisher thứ hai) và LẶP LẠI 25/9/2026 (publisher thứ ba), cùng
 * một chỗ, vì `provisionSite` không gọi tới đây. Lần này thì có.
 *
 * ═══ CHÉP, KHÔNG TỰ VIẾT ═══
 *
 * Quy tắc của zone đang chạy là đặc tả duy nhất đã được kiểm chứng bằng việc nó
 * đang chạy. Viết lại từ trí nhớ là tạo bản thứ hai của một thứ chỉ đúng khi
 * giống hệt bản thứ nhất — và phần dễ mất nhất là vế loại trừ `/api/`, thứ giữ
 * cho `/api/revalidate` và `/api/version` không bị cache.
 */

export interface CacheRule {
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

/** Quy tắc cache ở tầng zone, mảng rỗng nếu zone chưa có ruleset nào. */
export async function cacheRules(zoneId: string, token: string): Promise<CacheRule[]> {
  const list = (await cf(`/zones/${zoneId}/rulesets?phase=http_request_cache_settings`, token)) as {
    id: string;
    phase: string;
    kind: string;
  }[];
  const entry = list.find((x) => x.phase === "http_request_cache_settings" && x.kind === "zone");
  if (!entry) return [];
  const full = (await cf(`/zones/${zoneId}/rulesets/${entry.id}`, token)) as { rules?: CacheRule[] };
  return full.rules ?? [];
}

export class HostLeftInRuleError extends Error {}

/**
 * Đổi host trong biểu thức, giữ nguyên mọi vế khác. Hàm THUẦN, và phần đáng
 * canh nhất của cả file này — `scripts/test-cache-rule-rewrite.ts` chứng minh
 * từng nhánh.
 *
 * DANH SÁCH CHO PHÉP, không phải `...r`. Quy tắc đọc về mang theo `id`, `ref`,
 * `version`, `last_updated` — danh tính của quy tắc NGUỒN. Cloudflare từ chối
 * thẳng khi tạo mới:
 *
 *   400 code 20173: the rule public id cannot be provided on ruleset creation
 *
 * Từ chối ồn ào ở đây là may. Một trường lạ khác có thể được nhận âm thầm và
 * mang theo trạng thái của zone khác.
 *
 * NÉM LỖI khi biểu thức còn sót tên miền nguồn. Một quy tắc mang host của site
 * khác thì không bao giờ khớp, và nó sẽ trông như đã cấu hình xong — tức đúng
 * loại hỏng mà cả file này sinh ra để chặn.
 */
export function rewriteHostInRules(rules: CacheRule[], fromHost: string, toHost: string): CacheRule[] {
  const from = fromHost.trim().toLowerCase();
  const to = toHost.trim().toLowerCase();
  if (!from || !to) throw new HostLeftInRuleError("Thiếu host nguồn hoặc host đích.");

  const out = rules.map((r) => ({
    action: r.action,
    action_parameters: r.action_parameters,
    description: r.description,
    enabled: r.enabled,
    expression: r.expression.replace(
      new RegExp(`"(?:www\\.)?${from.replace(/\./g, "\\.")}"`, "g"),
      (m) => (m.includes("www.") ? `"www.${to}"` : `"${to}"`)
    ),
  }));

  for (const r of out) {
    if (r.expression.includes(from)) {
      throw new HostLeftInRuleError(
        `Biểu thức còn sót tên miền nguồn "${from}" sau khi thay: ${r.expression}. ` +
          `Một quy tắc mang host của site khác thì không bao giờ khớp, và nó sẽ trông như đã cấu hình xong.`
      );
    }
  }
  return out;
}

export type CopyCacheRulesResult =
  | { status: "copied"; rules: CacheRule[] }
  | { status: "already"; rules: CacheRule[] }
  | { status: "no-source" };

/**
 * Chép quy tắc cache sang zone đích, nếu zone đó chưa có quy tắc nào.
 *
 * KHÔNG GHI ĐÈ. Zone đã có quy tắc là zone có người đã quyết định hành vi cache
 * của nó; ghi đè là đổi cách một site đang phục vụ mà không ai chọn điều đó.
 * Trả `already` kèm quy tắc đang có để chỗ gọi nói ra được.
 */
export async function copyCacheRules(args: {
  token: string;
  targetZoneId: string;
  targetHost: string;
  sourceZoneId: string;
  sourceHost: string;
}): Promise<CopyCacheRulesResult> {
  const { token, targetZoneId, targetHost, sourceZoneId, sourceHost } = args;

  const existing = await cacheRules(targetZoneId, token);
  if (existing.length > 0) return { status: "already", rules: existing };

  const model = await cacheRules(sourceZoneId, token);
  if (model.length === 0) return { status: "no-source" };

  const rules = rewriteHostInRules(model, sourceHost, targetHost);
  await cf(`/zones/${targetZoneId}/rulesets/phases/http_request_cache_settings/entrypoint`, token, {
    method: "PUT",
    body: { rules },
  });
  return { status: "copied", rules };
}
