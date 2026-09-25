import { rewriteHostInRules, HostLeftInRuleError, type CacheRule } from "@/lib/cloudflare/cache-rule";

/**
 * Chạy: npm run test:cache-rule
 *
 * Không mạng, không DB: hàm thuần, quy tắc nạp từ HÌNH DẠNG THẬT đọc về từ
 * Cloudflare ngày 25/9/2026.
 *
 * Thứ đáng canh KHÔNG phải "có thay được host không" mà là HAI ca im lặng:
 *
 *   - vế loại trừ `/api/` phải SỐNG SÓT. Mất nó thì Cloudflare cache cả
 *     `/api/revalidate` và `/api/version` — tức nút purge tự purge chính nó, và
 *     `/api/version` trả một bản build đã cũ. Không có gì đỏ; site vẫn 200.
 *   - biểu thức còn sót host NGUỒN phải NÉM LỖI. Một quy tắc mang host của site
 *     khác không bao giờ khớp, nên hậu quả là "đã cấu hình xong" mà cache không
 *     bao giờ bật — đúng cái hình dạng mà cả module này sinh ra để chặn.
 */

const REAL: CacheRule = {
  action: "set_cache_settings",
  description: "Cache HTML",
  enabled: true,
  expression:
    '(http.host in {"atmovingservices.com" "www.atmovingservices.com"} and not starts_with(http.request.uri.path, "/api/"))',
  action_parameters: {
    browser_ttl: { mode: "respect_origin" },
    cache: true,
    edge_ttl: { mode: "bypass_by_default" },
  },
};

let pass = 0;
const fails: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`✓ ${name}`);
  } catch (e) {
    fails.push(`${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}
function eq(got: unknown, want: unknown, label: string) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) throw new Error(`${label}: nhận ${g}, cần ${w}`);
}

check("đổi cả apex và www, giữ nguyên thứ tự", () => {
  const [r] = rewriteHostInRules([REAL], "atmovingservices.com", "solieubongda.com");
  eq(
    r.expression,
    '(http.host in {"solieubongda.com" "www.solieubongda.com"} and not starts_with(http.request.uri.path, "/api/"))',
    "expression"
  );
});

check("vế loại trừ /api/ SỐNG SÓT — mất nó là purge một thứ tự cache", () => {
  const [r] = rewriteHostInRules([REAL], "atmovingservices.com", "solieubongda.com");
  if (!r.expression.includes('not starts_with(http.request.uri.path, "/api/")')) {
    throw new Error(`vế /api/ biến mất: ${r.expression}`);
  }
});

check("action_parameters đi nguyên vẹn", () => {
  const [r] = rewriteHostInRules([REAL], "atmovingservices.com", "solieubongda.com");
  eq(r.action_parameters, REAL.action_parameters, "action_parameters");
  eq([r.action, r.description, r.enabled], [REAL.action, REAL.description, REAL.enabled], "action/description/enabled");
});

check("KHÔNG mang theo id/ref/version của quy tắc nguồn", () => {
  // Cloudflare từ chối thẳng: 400 code 20173 "the rule public id cannot be
  // provided on ruleset creation". Nhưng một trường lạ khác có thể được nhận
  // ÂM THẦM và mang theo trạng thái của zone khác — nên danh sách cho phép.
  const dirty = { ...REAL, id: "abc123", ref: "abc123", version: "7", last_updated: "2026-09-25" } as CacheRule;
  const [r] = rewriteHostInRules([dirty], "atmovingservices.com", "solieubongda.com");
  eq(Object.keys(r).sort(), ["action", "action_parameters", "description", "enabled", "expression"], "khoá");
});

check("host nguồn còn sót → NÉM HostLeftInRuleError", () => {
  // Ca thật: biểu thức viết host không có dấu ngoặc kép (dạng `eq` thay vì
  // `in {}`), nên mẫu tìm theo ngoặc kép không khớp và host cũ ở lại.
  const odd: CacheRule = { ...REAL, expression: "(http.host eq atmovingservices.com)" };
  let threw: unknown = null;
  try {
    rewriteHostInRules([odd], "atmovingservices.com", "solieubongda.com");
  } catch (e) {
    threw = e;
  }
  if (!(threw instanceof HostLeftInRuleError)) {
    throw new Error("không ném — quy tắc mang host site khác sẽ ghi được và không bao giờ khớp");
  }
});

check("host rỗng → NÉM, không ghi một quy tắc vô nghĩa", () => {
  let n = 0;
  for (const [a, b] of [
    ["", "x.com"],
    ["x.com", ""],
  ]) {
    try {
      rewriteHostInRules([REAL], a, b);
    } catch (e) {
      if (e instanceof HostLeftInRuleError) n++;
    }
  }
  if (n !== 2) throw new Error(`chỉ ${n}/2 ca ném lỗi`);
});

check("dấu chấm trong host là dấu chấm, không phải ký tự bất kỳ", () => {
  // `atmovingservicesXcom` KHÔNG được coi là host nguồn: regex phải escape `.`,
  // nếu không nó khớp rộng hơn ý định và đổi cả host của site khác.
  const other: CacheRule = { ...REAL, expression: '(http.host in {"atmovingservicesXcom"})' };
  const [r] = rewriteHostInRules([other], "atmovingservices.com", "solieubongda.com");
  eq(r.expression, '(http.host in {"atmovingservicesXcom"})', "expression");
});

check("nhiều quy tắc: mỗi cái đổi độc lập, không mất cái nào", () => {
  const second: CacheRule = {
    ...REAL,
    description: "Bypass cache cho preview",
    expression: '(http.host eq "www.atmovingservices.com" and http.cookie contains "preview")',
  };
  const out = rewriteHostInRules([REAL, second], "atmovingservices.com", "solieubongda.com");
  eq(out.length, 2, "số quy tắc");
  eq(out[1].expression, '(http.host eq "www.solieubongda.com" and http.cookie contains "preview")', "quy tắc 2");
});

check("mảng rỗng → mảng rỗng, không ném", () => {
  eq(rewriteHostInRules([], "a.com", "b.com"), [], "kết quả");
});

console.log(`\n${pass}/${pass + fails.length} đạt.`);
if (fails.length > 0) {
  console.error(`\nTRƯỢT:\n  ${fails.join("\n  ")}`);
  process.exitCode = 1;
}
